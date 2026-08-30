---
title: "Amazon SageMaker Security for ML Workloads in Production"
description: "Lock down SageMaker Studio, training jobs, and endpoints: VPC-only, scoped execution roles, no root on notebooks, encrypted data, and private model APIs."
pubDate: 2026-08-24
updatedDate: 2026-08-30
author: OpenSourceOM Team
tags:
  - AWS
  - SageMaker
  - ML security
  - IAM
  - cloud security
focusKeyword: AWS SageMaker security
faq:
  - question: What is the highest-impact AWS SageMaker security control?
    answer: >-
      Put the SageMaker domain in VPC-only mode so Studio, training, and processing
      jobs have no direct internet path. Pair that with an execution role that cannot
      PassRole to admin and cannot use s3:* on the whole account.
  - question: Should SageMaker notebooks have root access?
    answer: >-
      No for shared production domains. Disable root access on the user profile.
      Root plus a broad execution role is a workstation-to-cloud-admin path. Use
      lifecycle configs and a custom image instead of package installs as root.
  - question: How do SageMaker endpoints get compromised?
    answer: >-
      A public or weakly authenticated inference endpoint, plus the endpoint
      execution role that can read training buckets or invoke other models. Treat
      the endpoint like any internet-facing API. Use private link or IAM auth, not
      an open HTTPS URL.
  - question: How does a security graph help SageMaker?
    answer: >-
      Notebooks, training jobs, and endpoints are workloads that assume execution
      roles with access to S3, ECR, and Secrets Manager. Graph those edges and you
      see whether a stolen notebook token reaches production data, not just whether
      the domain is in a VPC.
---

**AWS SageMaker security** is IAM and network design around three principals: the **Studio user**, the **training/processing job**, and the **real-time (or serverless) endpoint**. Each assumes an execution role. If that role can read production data or `iam:PassRole` to a privileged role, a notebook is as dangerous as a public EC2 instance.

This guide is the production baseline. Path ranking is [attack path analysis](/blog/attack-path-analysis-cloud-security/). Identity blast radius is [CIEM](/blog/ciem-explained-for-cloud-teams/).

## The SageMaker attack surface

```
Analyst laptop → Studio (Jupyter)
                    └──ASSUMES──▶ execution role ──CAN_ACCESS──▶ training bucket
                                                         ──CAN_ACCESS──▶ Secrets / ECR

Internet ──REACHABLE──▶ inference endpoint
                           └──ASSUMES──▶ endpoint role ──CAN_ACCESS──▶ model artifacts
```

| Component | Default footgun | Production cut |
| --------- | --------------- | -------------- |
| Domain | Public internet; user can attach any role | VPC-only; domain execution role cannot `PassRole` to `*` |
| Notebook | Root enabled; conda installs anything | Root off; custom image; lifecycle from a signed repo |
| Training | Job role = data-scientist-admin | Job role: specific S3 prefixes, specific ECR repos, KMS decrypt |
| Endpoint | Public HTTPS, no IAM auth | Private API Gateway / VPC endpoint; IAM or SageMaker IAM auth |
| JumpStart / Canvas | Pulls models and data on a wide role | Separate domain or blocked; no prod bucket access |

## 1. Domain: VPC-only and a boring execution role

Create the domain with **VPC only**. Studio apps, training, processing, and Transform jobs get ENIs in private subnets. Egress to AWS APIs goes through **VPC endpoints** (SageMaker API, SageMaker Runtime, S3, ECR, CloudWatch, STS, KMS). Do not give the domain a NAT “so pip works.” Bake dependencies into a **custom image**.

Domain settings that matter:

- **AppNetworkAccessType = VpcOnly**
- Subnets with no default route to an IGW
- Security group: egress only to prefix lists for those endpoints (or a shared SG the endpoints allow)
- **Execution role** for the domain: CloudWatch logs, a *domain artifact* bucket prefix, ECR pull for the allowed image repo. **No** `iam:CreateRole`, no `iam:PassRole` except the training/endpoint roles you name.

```json
{
  "Effect": "Allow",
  "Action": "iam:PassRole",
  "Resource": [
    "arn:aws:iam::123456789012:role/sagemaker-training-prod",
    "arn:aws:iam::123456789012:role/sagemaker-endpoint-prod"
  ],
  "Condition": {
    "StringEquals": {
      "iam:PassedToService": "sagemaker.amazonaws.com"
    }
  }
}
```

Disable **root access** on user profiles. Disable **Amazon SageMaker JumpStart** in prod accounts if you cannot inventory every pulled model. Canvas belongs in a sandbox account with its own buckets.

## 2. Training and processing jobs

The job role is not the user’s identity. Scope it like a batch worker:

- `s3:GetObject` / `PutObject` on `s3://ml-prod/train/*` and `s3://ml-prod/output/${TrainingJobName}/*`—not `s3:*`.
- `ecr:BatchGetImage` on one repo.
- `kms:Decrypt` on the training CMK.
- No `sagemaker:CreatePresignedDomainUrl` (that is a user-console permission).
- Encrypt job volumes (`VolumeKmsKeyId`) and output (`OutputDataConfig.KmsKeyId`).
- **NetworkIsolation** / **EnableNetworkIsolation** when the container does not need VPC egress beyond S3/ECR endpoints.
- **InterContainerTrafficEncryption** on distributed jobs.

Tag every job with `data-class` and `owner`. GuardDuty and your graph should be able to join `TrainingJob → Role → Bucket`.

## 3. Endpoints: private inference

A SageMaker endpoint is a long-lived workload with an execution role that reads model artifacts. Treat it as production compute:

1. Deploy in the same VPC-only pattern. **VpcConfig** on the model.
2. Do not put a public Application Load Balancer in front “for the data science demo.” Use **API Gateway private** or **VPC endpoint** for `runtime.sagemaker`, plus IAM SigV4.
3. Endpoint role: `s3:GetObject` on the model artifact prefix only. No training-bucket write. No `sts:AssumeRole` to other accounts unless that is a documented cross-account model registry.
4. Turn on **DataCaptureConfig** only into a locked-down bucket (predictions are often PII). Encrypt with a CMK.
5. Patch the inference image; pin a digest. Same supply-chain rules as [cloud-native application security](/blog/cloud-native-application-security/).

## 4. Data, secrets, and lineage

Training data in S3 follows the [S3 hardening](/blog/aws-s3-bucket-security-hardening/) baseline: BPA, KMS, no public, Access Analyzer. SageMaker Feature Store and Model Registry use the same KMS and IAM story—separate roles for write (pipeline) vs read (endpoint).

Put API keys for third-party model hosts in Secrets Manager. The notebook role should not have `secretsmanager:GetSecretValue` on `*`. Bind ARNs.

Model cards and lineage (who trained what on which prefix) are a compliance artifact. They are also how you answer “which endpoint can still decrypt last quarter’s dataset?”

## 5. Detect the path, don’t just CIS the domain

Config rules catch `SageMaker endpoint not in VPC`. They do not catch **notebook role → prod bucket**. After a domain change:

1. `iam simulate-principal-policy` on each execution role against `s3:GetObject` on prod prefixes.
2. Confirm Studio ENIs have no `0.0.0.0/0` SG egress except endpoints.
3. Graph: `Workload (SageMaker*) --ASSUMES--> Identity --CAN_ACCESS--> Datastore` with `Internet --REACHABLE-->` on the endpoint or on the notebook via stolen SSO.

Run those queries in OpenSourceOM after collectors sync ([getting started](/docs/getting-started/), [the graph](/docs/the-graph/)).

## Cadence

| When | What |
| ---- | ---- |
| Domain create | VPC-only, root off, PassRole allowlist, endpoints |
| Every job / endpoint | Dedicated role, KMS, tagged prefixes |
| Weekly | Unused Studio apps, over-broad job roles, public endpoint check |
| Quarterly | Image rebuild, JumpStart/Canvas review, tabletop stolen notebook cookie |

## Key takeaways

- **VPC-only** plus **named PassRole** removes internet and privilege-escalation from the default Studio path.
- Training jobs and endpoints need **their own roles**, not the data scientist’s.
- Rank SageMaker findings by whether a notebook or public endpoint can still `GetObject` production data—not by whether the domain exists in a VPC.

**Related:** [AWS S3 bucket security](/blog/aws-s3-bucket-security-hardening/) · [Attack path analysis](/blog/attack-path-analysis-cloud-security/) · [Cloud-native application security](/blog/cloud-native-application-security/)
