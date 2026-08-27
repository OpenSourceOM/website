---
title: "Securing Terraform State in S3"
description: "Terraform state in S3 is a secret store: encrypt it, Block Public Access, lock it, and treat s3:GetObject on the state key as production credential access."
pubDate: 2026-08-27
updatedDate: 2026-08-27
author: OpenSourceOM Team
tags:
  - Terraform
  - S3
  - AWS
  - secrets
  - IAM
focusKeyword: Terraform state S3 security
faq:
  - question: Why is Terraform state in S3 a secret?
    answer: >-
      terraform.tfstate stores resource attributes in plaintext JSON, including
      database passwords, private keys, and IAM access key IDs the provider
      returned. Anyone who can GetObject that key can reconstruct production.
      Treat the bucket like a vault, not like a logs bucket.
  - question: Is S3 encryption enough to protect state?
    answer: >-
      Encryption at rest (SSE-KMS) stops disk-level disclosure in AWS’s
      facilities. It does not stop an IAM principal with s3:GetObject and kms:Decrypt.
      Bucket policy, BPA, versioning, and a narrow role for CI are the access
      controls. KMS is necessary and not sufficient.
  - question: Who should be allowed to run terraform state pull?
    answer: >-
      The same principals who may apply the stack, plus a break-glass role with
      MFA. Not the developer AWSPowerUser group, not a shared CI role used by
      every repo, and not a read-only “security scanner” role unless that scanner
      is allowed to see every secret in the state.
---

```bash
terraform state pull | jq -r '.. | objects | to_entries[] | select(.key|test("password|secret|access_key|private_key";"i")) | .key'
```

That command is why **Terraform state S3 security** is not “turn on versioning.” State is a replica of every sensitive attribute Terraform ever saw. This is not an IaC scanner post and not a drift-detector bake-off. It is the backend.

Human and org IAM around the account still follow [AWS security best practices](/blog/aws-security-best-practices-2026/). The state bucket is one more account that should live in the security or platform OU, not in the app account next to the RDS instance.

```
terraform apply (CI role)
    → s3://tfstate-prod/payments/terraform.tfstate
    → dynamodb://tfstate-locks (LockID)
```

## Secrets in state

Providers write values back into state: `aws_db_instance.password`, `tls_private_key.private_key_pem`, `aws_iam_access_key.secret`, Helm release manifests, Kubernetes Secret data if you used the Kubernetes provider against live Secrets.

`sensitive = true` in your module redacts `terraform plan` output. It does **not** omit the value from state. Redact is a UI feature.

Mitigations that actually reduce state secrets:

| Pattern | What leaves state |
| --- | --- |
| RDS password from Secrets Manager; Terraform only stores the secret **ARN** | Password stays in SM; state has ARN |
| IAM roles via OIDC; no `aws_iam_access_key` resources | No AKIA in state |
| TLS at ACM; no `tls_private_key` in Terraform | No PEM in state |
| `ignore_changes` on a password you set out of band | Still often stored on first apply — avoid creating it in TF |

You will not get to zero attributes. Assume state is classified **secret**. Bucket policy and IAM follow from that, not from “it’s just JSON.”

Never:

- Email `terraform.tfstate` for debugging
- Commit local state (`terraform.tfstate` in git)
- `terraform state pull` into Slack
- Grant `s3:*` on `arn:aws:s3:::tfstate-prod` to the data-science account for “analytics”

`terraform state mv` and `taint` rewrite state; they need the same write path as apply. Read-only pull is already enough to steal secrets.

## Bucket BPA + encryption + locking

Create the backend bucket as if it were a log-archive bucket:

```bash
aws s3api create-bucket --bucket tfstate-prod --region us-east-1 \
  --create-bucket-configuration LocationConstraint=us-east-1

aws s3api put-public-access-block --bucket tfstate-prod \
  --public-access-block-configuration \
  'BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true'

aws s3api put-bucket-encryption --bucket tfstate-prod \
  --server-side-encryption-configuration '{
    "Rules": [{
      "ApplyServerSideEncryptionByDefault": {
        "SSEAlgorithm": "aws:kms",
        "KMSMasterKeyID": "arn:aws:kms:us-east-1:123456789012:key/YOUR-KEY"
      },
      "BucketKeyEnabled": true
    }]
  }'

aws s3api put-bucket-versioning --bucket tfstate-prod \
  --versioning-configuration Status=Enabled

aws s3api put-bucket-logging --bucket tfstate-prod \
  --bucket-logging-status '{
    "LoggingEnabled": {
      "TargetBucket": "tfstate-access-logs",
      "TargetPrefix": "tfstate-prod/"
    }
  }'
```

Account-level S3 Block Public Access should already be on; bucket BPA is defense in depth if someone later attaches a public policy.

KMS key policy: only the terraform CI role, the break-glass role, and the logging/audit role may `kms:Decrypt`. A CMK with `EnableIamUserPermissions` and an account-wide `kms:*` is encryption theater.

Backend block:

```hcl
terraform {
  backend "s3" {
    bucket         = "tfstate-prod"
    key            = "payments/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "tfstate-locks"
    encrypt        = true
    kms_key_id     = "arn:aws:kms:us-east-1:123456789012:key/YOUR-KEY"
  }
}
```

`encrypt = true` without a CMK uses SSE-S3. Prefer SSE-KMS so you can revoke decrypt without deleting the object.

Object ownership: Bucket owner enforced. ACLs off.

Lifecycle: do not expire current versions of state. Expire *noncurrent* versions after N days only if you are sure you will not need to `state pull` an old version after a bad apply. Access logs go to a different bucket.

## Who can terraform state pull

`terraform state pull` is `s3:GetObject` on that key plus `kms:Decrypt`. List the principals:

```bash
aws s3api get-bucket-policy --bucket tfstate-prod --query Policy --output text | jq .
```

Bucket policy pattern: deny everyone except named roles; deny `PutObject` that is not KMS-encrypted; deny non-TLS.

```json
{
  "Sid": "DenyInsecureTransport",
  "Effect": "Deny",
  "Principal": "*",
  "Action": "s3:*",
  "Resource": [
    "arn:aws:s3:::tfstate-prod",
    "arn:aws:s3:::tfstate-prod/*"
  ],
  "Condition": {
    "Bool": { "aws:SecureTransport": "false" }
  }
}
```

IAM on the CI role: `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` on `arn:aws:s3:::tfstate-prod/payments/*` — not on `/*` for the whole bucket if other products share it. `s3:ListBucket` with `s3:prefix` = `payments/`.

Humans: platform team via SSO permission set `TerraformStatePayments`, MFA required, not `AdministratorAccess`. Developers run plan in CI; they do not need GetObject on prod state from laptops. If they do, they have every secret.

A “read-only” security role that scans buckets will download state. Either exclude this bucket from the scanner or treat the scanner as a secret-access system (logging, no world-readable results).

CloudTrail data events on the bucket (`PutObject`, `GetObject`) go to the org trail. Alert on `GetObject` from principals that are not the CI role and not break-glass.

Workspaces: `env:/` keys in S3. Same policy, prefix per workspace. Do not put prod and sandbox in one prefix with a shared role.

## DynamoDB lock table IAM

The lock table prevents two applies. It is not a secret store, but a missing lock is how two pipelines corrupt state (and how you then `state pull` the broken version).

```bash
aws dynamodb create-table \
  --table-name tfstate-locks \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST
```

IAM for the same CI role:

```json
{
  "Effect": "Allow",
  "Action": [
    "dynamodb:GetItem",
    "dynamodb:PutItem",
    "dynamodb:DeleteItem",
    "dynamodb:DescribeTable"
  ],
  "Resource": "arn:aws:dynamodb:us-east-1:123456789012:table/tfstate-locks"
}
```

Do not grant `dynamodb:*` on `*`. Do not use the same table as an application table.

Lock abuse: a principal with `DeleteItem` can steal the lock and apply. That principal is already an apply principal if you scoped it right. A principal with only `DeleteItem` and no S3 write is a denial-of-service on applies — still restrict it.

S3 native locking (Terraform 1.10+ `use_lockfile`) is an alternative to DynamoDB. If you use it, the lock object is in the same bucket: same BPA, same KMS, same IAM. Do not mix two lock mechanisms on one `key`.

Point-in-time recovery on DynamoDB is optional; the lock rows are ephemeral. State durability is the S3 versioning, not DynamoDB.

## Checklist

- [ ] State bucket: BPA on, versioning on, SSE-KMS CMK, TLS-only bucket policy, access logging
- [ ] CMK policy: terraform CI + break-glass + audit only
- [ ] IAM: prefix-scoped Get/Put/Delete on state keys; no account-wide `s3:*`
- [ ] `terraform state pull` from a laptop is break-glass, MFA, logged
- [ ] DynamoDB lock table (or S3 lockfile) IAM is the same CI role, not `dynamodb:*`
- [ ] No `aws_iam_access_key` / raw DB passwords in Terraform if you can use SM + OIDC
- [ ] CloudTrail data events + alert on unexpected GetObject

State is a **secret file with a locking protocol**. Encrypting the bucket without restricting `GetObject` is a checkbox. Put the backend in a locked account and treat `state pull` like `secretsmanager:GetSecretValue`.
