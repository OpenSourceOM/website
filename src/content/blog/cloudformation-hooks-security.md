---
title: "CloudFormation Hooks as Preventive Guardrails"
description: "CloudFormation Hooks versus Config and SCPs: a deny-public-S3 hook on create, the IAM role the hook runs as, and the failure modes that fail open."
pubDate: 2026-08-27
updatedDate: 2026-08-27
author: OpenSourceOM Team
tags:
  - CloudFormation
  - AWS
  - Hooks
  - guardrails
  - preventive controls
focusKeyword: CloudFormation Hooks security
faq:
  - question: How are CloudFormation Hooks different from AWS Config rules?
    answer: >-
      Hooks run during a CloudFormation create/update/delete and can FAIL the
      stack operation before the resource exists. Config evaluates after the
      fact (or with proactive mode on a subset of types) and records
      NON_COMPLIANT. A public bucket that Config finds in five minutes already
      existed. A Hook can refuse CreateBucket.
  - question: Do Hooks replace Service Control Policies?
    answer: >-
      No. SCPs apply to IAM principals in member accounts regardless of
      CloudFormation, Terraform, console, or SDK. Hooks only see resources
      going through CloudFormation (and the CloudFormation public registry
      resource types). Terraform aws_s3_bucket does not invoke your Hook.
  - question: What happens if the Hook’s Lambda times out?
    answer: >-
      Depends on HookTarget and failure mode. If the Hook is configured to
      fail closed, the stack operation fails. If you set a warning-only or
      skip-on-error path, the bucket is created. Read HookInvocationStatus
      in CloudTrail; do not assume timeout equals deny.
---

AWS Config told you at 09:12 that the bucket was public. The stack finished at 09:07. **CloudFormation Hooks security** is the five minutes you do not get back: a preventive check on the CloudFormation resource operation, not a detective ticket.

This is not a Terraform scanner, not an SCP tutorial (those still matter at the org layer in [AWS security best practices](/blog/aws-security-best-practices-2026/)), and not a full CloudFormation primer. It is Hooks versus the other two guardrail planes, one S3 example, IAM for the hook, and how it fail-opens.

```
CreateStack / UpdateStack
    → CloudFormation
        → Hook (Lambda or Guard)  — FAIL → stack rollback, no bucket
        → resource handler       — SUCCESS → bucket exists
             → Config (later)    — NON_COMPLIANT ticket
```

## Hooks vs Config vs SCPs

Three planes people mash together on a slide:

| Plane | When it runs | What it sees | Bypass |
| --- | --- | --- | --- |
| **SCP** | Every IAM request in a member account | API action + conditions | Management account; not CloudFormation-specific |
| **CloudFormation Hook** | CFN resource pre-create / pre-update / pre-delete | CFN resource properties (and some change sets) | Console/SDK/Terraform direct API; resources CFN does not manage |
| **Config** | Periodic or configuration-item change | Recorded resource state | Timing; resource types Config does not support |

Use all three:

- SCP: `s3:PutBucketPublicAccessBlock` cannot be turned off, or `s3:PutBucketAcl` denied except a break-glass role. That stops Terraform and the console.
- Hook: teams that **must** use CloudFormation get a fast fail in `CreateStack` with a message in the events tab, before you rely on SCP error strings.
- Config: drift after someone used the console anyway; evidence for audit.

Proactive Config (evaluation before provision) exists for some resource types and is not a Hook. Hooks are CloudFormation-native, authored as Guard rules or as a Lambda-backed private extension.

If the estate is 90% Terraform, a CloudFormation-only Hook is a false sense of coverage. Put the deny in SCP + IAM; use Hooks where CFN is the source of truth (Control Tower, Service Catalog, some landing zones).

## Example deny public S3 on create

Goal: `AWS::S3::Bucket` cannot ship with public ACLs or with Block Public Access disabled.

Guard-shaped Hook (concept; property names must match the current [Hook development docs](https://docs.aws.amazon.com/cloudformation-cli/latest/userguide/hooks.html)):

```
let public_acl = ["PublicRead", "PublicReadWrite", "AuthenticatedRead"]

rule deny_public_bucket when %resource_type == "AWS::S3::Bucket" {
  %properties.PublicAccessBlockConfiguration exists
  %properties.PublicAccessBlockConfiguration.BlockPublicAcls == true
  %properties.PublicAccessBlockConfiguration.BlockPublicPolicy == true
  %properties.PublicAccessBlockConfiguration.IgnorePublicAcls == true
  %properties.PublicAccessBlockConfiguration.RestrictPublicBuckets == true
  %properties.AccessControl not in %public_acl
}
```

Lambda-backed equivalent: on `Create`/`Update` for `AWS::S3::Bucket`, inspect `resourceProperties`, return `FAILURE` with a message if `PublicAccessBlockConfiguration` is missing or any flag is false.

Register and bind:

```bash
# After cfn submit / private registry publish
aws cloudformation set-type-configuration \
  --type HOOK \
  --type-name YourOrg::S3::DenyPublic \
  --configuration-alias default \
  --configuration '{"CloudFormationConfiguration":{"HookConfiguration":{"TargetStacks":"ALL","FailureMode":"FAIL"}}}'
```

`FailureMode: FAIL` is the control. `WARN` writes a warning and **creates the bucket**. Do not ship WARN in prod and call it preventive.

Test:

```yaml
# This stack must fail at hook invocation, not at a later Config rule
Resources:
  Bad:
    Type: AWS::S3::Bucket
    Properties:
      AccessControl: PublicRead
```

```bash
aws cloudformation deploy --stack-name hook-test-bad --template-file bad-bucket.yaml
# Expect: Hook returned FAILURE. No bucket in s3api list-buckets.
```

Account-level S3 Block Public Access still belongs on. The Hook catches templates that set ACLs **inside** CFN when BPA is not yet on, or a stack that tries to put a public bucket policy as another resource in the same template — add `AWS::S3::BucketPolicy` to the Hook’s target types or you only gated the bucket resource.

Service Catalog products that wrap CFN invoke Hooks if the product uses CloudFormation. Third-party registry types need their own targets.

## IAM for the hook

The Hook execution role is a **privileged inspector**. It receives resource properties, which can include secrets in other resource types (RDS master password in the template — you should not put that in the template, but people do).

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject"
      ],
      "Resource": "arn:aws:s3:::cfn-hooks-artifacts/deny-public/*",
      "Condition": {
        "StringEquals": { "aws:PrincipalAccount": "123456789012" }
      }
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:us-east-1:123456789012:log-group:/aws/lambda/cfn-hook-*"
    }
  ]
}
```

Do **not** attach `AdministratorAccess` so the Hook can “call Describe* to be extra sure.” The Hook should decide from **template properties**, not from live AWS APIs that a race can change. If the Lambda can `iam:CreateUser`, a RCE in the Hook is a management-account-class incident.

Trust policy: CloudFormation’s hook service principal only (`hooks.cloudformation.amazonaws.com` — confirm the current principal in AWS docs), with `aws:SourceAccount` and `aws:SourceArn` conditions.

KMS: if properties are encrypted, the Hook needs decrypt on that CMK. Scope it.

Org-wide Hooks (CloudFormation StackSets / Organizations delegated admin) multiply the blast radius: one Lambda in the management or delegated account sees **every** stack’s properties. Treat that repo like an SCP: CODEOWNERS, no `curl | bash` in the Lambda image, signed artifacts.

CloudTrail: `HookInvocation` events. Alert on `FailureMode` changes and on `SetTypeConfiguration` from principals that are not the platform pipeline.

## Failure modes that skip the hook

| Mode | What the engineer sees | Security outcome |
| --- | --- | --- |
| `FailureMode: FAIL` + Lambda 200 FAILURE | Stack fails, Hook reason in events | Preventive |
| `FailureMode: WARN` | Yellow warning, stack continues | Detective with extra latency |
| Lambda timeout / 500 and FAIL | Stack fails | Fail closed (good) if configured |
| Lambda timeout and WARN / skip | Stack continues | **Fail open** |
| Hook not bound (`TargetStacks` not ALL, stack excluded) | Silent success | No control |
| Resource created outside CFN | Nothing | Need SCP/Config |
| Hook targets `AWS::S3::Bucket` but public is via `BucketPolicy` only | Bucket created, policy applied | Incomplete target list |
| Type version pinned to v1 with a bug; v2 never deployed | Old rules | Registry drift |
| Management account stacks | SCP does not apply; Hook might | Bind Hooks there too or forbid CFN in mgmt |

Change sets: a Hook that only runs on execute and not on change-set create will surprise at execute time. That is still better than Config-after. Document it.

Throttling: a slow Hook on every resource in a 200-resource stack will timeout the stack. Teams then switch to WARN. Performance is a security control: keep the Lambda hot, Guard rules cheap, target only high-risk types (`AWS::S3::Bucket`, `AWS::IAM::Role`, `AWS::EC2::SecurityGroup`) instead of `ALL` resource types on day one.

Do not log full `resourceProperties` to CloudWatch if they contain secrets. Log the rule name and the failing JSON path.

## Checklist

- [ ] `FailureMode: FAIL` in prod; WARN is not a guardrail
- [ ] Targets include Bucket **and** BucketPolicy (and IAM Role, SG) you claim to cover
- [ ] Hook role is least privilege; no `*` ; CFN principal condition on trust
- [ ] Test stack with `AccessControl: PublicRead` fails; no bucket remains
- [ ] SCP still denies public access APIs for non-CFN paths
- [ ] Config still records drift; Hooks are not the audit log
- [ ] `SetTypeConfiguration` and Hook code deploys are pipeline-only, CloudTrail-alerted

A Hook is a **CloudFormation admission controller**. It does not see Terraform, the console, or the management account unless you designed for those. Pair it with SCPs, then let Config pick up whatever still leaked. That layering is how you keep a public bucket from being a five-minute production fact.
