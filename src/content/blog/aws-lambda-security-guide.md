---
title: "AWS Lambda Security: Execution Roles, Resource Policies, and Function URLs"
description: "AWS Lambda security that matters in prod: execution-role blast radius, resource-based policies, Function URL auth, public layers, and env vars that are still plaintext secrets."
pubDate: 2026-08-29
updatedDate: 2026-08-29
author: OpenSourceOM Team
tags:
  - AWS
  - Lambda
  - IAM
  - Function URLs
  - serverless
focusKeyword: AWS Lambda security
faq:
  - question: Is a Function URL with AWS_IAM safer than a public Function URL?
    answer: >-
      AWS_IAM requires a SigV4-signed caller. NONE plus a “secret” header is
      not auth—the header is in every browser, log, and partner ticket. Prefer
      Function URLs only behind CloudFront+WAF or drop them and use API Gateway
      with an authorizer. IAM auth on the URL still needs a locked execution
      role; it does not shrink what the function can do in AWS.
  - question: Does putting Lambda in a VPC make it private?
    answer: >-
      It changes egress and ENI placement. The invoke path is still the Lambda
      API (or URL/API Gateway). VPC Lambda cannot reach S3 without a gateway
      endpoint or NAT. Teams “fix” that with 0.0.0.0/0 NAT and a role that
      still has s3:*. VPC is not a substitute for the resource policy.
  - question: Are environment variables encrypted?
    answer: >-
      At rest, Lambda can encrypt env with a CMK. In the console and in
      GetFunctionConfiguration, any principal with lambda:GetFunction can read
      them (unless you use encryption helpers the runtime decrypts). Do not put
      long-lived secrets in env. Use Secrets Manager or SSM with the execution
      role scoped to one secret ARN.
---

Lambda is an IAM principal that runs your code when something invokes it. **AWS Lambda security** is who can invoke, what the **execution role** can do, and whether a **Function URL** made the function a public app. It is not SAM/CDK syntax trivia, not a cold-start guide, and not [Amazon EventBridge security](/blog/aws-eventbridge-security-guide/) (that is the bus that may invoke you). AWS reference: [Lambda security](https://docs.aws.amazon.com/lambda/latest/dg/lambda-security.html).

```
Invoker (IAM / URL / API GW / event source)
  → resource-based policy on the function
       → execution role  —CAN_ACCESS→  S3, Secrets, RDS, STS
            → optional VPC ENI
```

If the execution role can `s3:GetObject` on the backup bucket, every XSS-in-a-dependency is a data path. Rank that with [pod-to-cloud-admin](/blog/kubernetes-pod-to-cloud-admin-path/) thinking, even without Kubernetes.

## 1. Execution role is the blast radius

One role per function (or per blast-radius group). No `AWSLambdaFullAccess`. No `s3:*` “because the handler might grow.”

```json
{
  "Effect": "Allow",
  "Action": ["s3:GetObject"],
  "Resource": "arn:aws:s3:::payments-inbox/*"
}
```

```bash
aws lambda get-function --function-name payments-ingest \
  --query 'Configuration.[Role,Environment.Variables]'
```

**Failure modes:**

- Shared role across twenty functions; one function’s SSRF becomes twenty products.
- Role has `iam:PassRole` and `lambda:CreateFunction`—the function can spawn a sibling with a better role.
- Env still holds `DATABASE_URL` with a password. Encrypt-at-rest does not hide it from `GetFunction`.

Prefer [IAM DB auth](/blog/aws-rds-security-guide/) or Secrets Manager with a single secret ARN.

## 2. Resource-based policy is who may invoke

The execution role is outbound. The **resource policy** is inbound (`lambda:InvokeFunction`).

```bash
aws lambda get-policy --function-name payments-ingest
```

Typical statements: `events.amazonaws.com` with `AWS:SourceArn` equal to **this** rule; `apigateway.amazonaws.com` with the API ARN; a specific IAM role for partners.

`Principal: "*"` with no `aws:SourceAccount` / `SourceArn` is a public invoke API. S3 event notifications that omit the source ARN let another account’s bucket trigger you (confused deputy). Always condition on the event source ARN.

## 3. Function URLs

```bash
aws lambda get-function-url-config --function-name payments-ingest
```

| `AuthType` | Meaning |
| --- | --- |
| `NONE` | Anyone who knows the URL (or scans `lambda-url.*.on.aws`) can invoke |
| `AWS_IAM` | SigV4; still internet-reachable; lock with resource policy + IAM |

`NONE` is a public app. Put CloudFront + WAF in front and **lock the URL** the same way you lock an ALB origin ([Amazon CloudFront security](/blog/aws-cloudfront-security-guide/)), or do not use Function URLs for prod.

CORS `AllowOrigins: *` on a `NONE` URL is a browser-callable endpoint for every site.

## 4. Layers, images, and /tmp

- **Layers:** you execute someone else’s zip. Pin layer version ARNs; do not use `:latest`. Treat a public layer as supply chain ([image provenance](/blog/kubernetes-image-provenance-slsa/) is the same idea for containers).
- **Container images:** pull by digest from a repo your account owns; scan in CI ([Trivy CI vs operator](/blog/trivy-operator-vs-ci-scanning/)).
- **`/tmp`:** 512–10 GB, shared across invokes on the same freeze. Do not write secrets there and assume the next customer is isolated; they are not across warm invokes of the **same** function, but you still should not persist credentials on disk.

## 5. Public invoke vs VPC

VPC attachment is for **reaching** private RDS, not for hiding invoke. Combine:

- Resource policy + no Function URL `NONE`
- RDS in private subnets, SG from the function SG ([Amazon RDS security](/blog/aws-rds-security-guide/))
- S3/STS interface or gateway endpoints so the function does not need `0.0.0.0/0` NAT ([VPC endpoints vs NAT](/blog/aws-vpc-endpoints-vs-nat-security/))

## Checklist

- [ ] Execution role: named resources, no `*` on data services, no PassRole to arbitrary roles
- [ ] No secrets in env; CMK on env if you still have non-secrets config
- [ ] Resource policy: every event source ARN-conditioned; no `Principal:*` without a hard condition
- [ ] Function URL: not `NONE` in prod, or fronted and origin-locked
- [ ] Layers pinned; images by digest
- [ ] CloudWatch logs group retained and not public via resource policy
- [ ] Reserved concurrency on the functions that can stampede downstream IAM/RDS

A `NONE` Function URL plus `s3:*` is an **internet-to-data** path. Put it at the top of [how to prioritize cloud vulnerabilities](/blog/how-to-prioritize-cloud-vulnerabilities/).

**Related:** [Amazon RDS security](/blog/aws-rds-security-guide/) · [Amazon CloudFront security](/blog/aws-cloudfront-security-guide/) · [Amazon EventBridge security](/blog/aws-eventbridge-security-guide/)
