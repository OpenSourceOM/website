---
title: "AWS S3 Bucket Security Hardening: Block Public Access and Beyond"
description: "Harden AWS S3 with account-level Block Public Access, bucket policies over ACLs, KMS encryption, VPC endpoints, and Access Analyzer—then rank leftover risk by attack path."
pubDate: 2026-08-24
updatedDate: 2026-08-30
author: OpenSourceOM Team
tags:
  - AWS
  - S3
  - data security
  - CSPM
  - cloud security
focusKeyword: AWS S3 security
faq:
  - question: What is the first AWS S3 security control to turn on?
    answer: Enable S3 Block Public Access at the account level, then on every bucket that is not an explicit public static site. Account BPA stops a single bucket ACL or policy from making objects world-readable. Pair it with a deny in Organizations SCPs so a new account cannot turn BPA off.
  - question: Are S3 ACLs still required for AWS S3 security?
    answer: No. Set Object Ownership to Bucket owner enforced, which disables ACLs. Authorize with IAM plus a bucket policy. ACLs are a second, easy-to-miss grant path that Access Analyzer and humans both miss.
  - question: How does attack path analysis change S3 hardening?
    answer: >-
      A private bucket with a role that any internet-facing task can assume is still
      an exfil path. Graph Internet to workload to identity to GetObject on the
      bucket. If that walk exists, Block Public Access alone did not close the incident.
  - question: Can open-source tools operationalize AWS S3 security?
    answer: Yes. Config rules and Access Analyzer findings are inputs. A graph such as OpenSourceOM joins those findings to IAM and network edges so you fix reachable buckets first, not every PublicAccessBlock finding in the same sprint.
---

**AWS S3 security** is not a bucket checkbox. Attackers steal data through three grants: a public ACL or policy, a resource policy that trusts the wrong principal, or an IAM role an internet-reachable workload can assume. Hardening is shutting those grants, then proving no walk remains from the internet to `s3:GetObject` on production prefixes.

This is the operator checklist. For how to pick which remaining finding to fix, see [attack path analysis](/blog/attack-path-analysis-cloud-security/) and [how to break a path](/blog/how-to-break-cloud-attack-paths/).

## The paths that actually leak S3 data

```
Internet ──public ACL / policy──▶ Bucket (GetObject)
Internet ──REACHABLE──▶ Task / EC2 / Lambda
                         └──ASSUMES──▶ Role ──CAN_ACCESS──▶ Bucket
Partner / confused deputy ──bucket policy Principal──▶ Bucket
```

| Path | Typical miss | Cut |
| ---- | ------------ | --- |
| Public read | Website “just for staging,” `Principal: "*"` with a bad `StringNotEquals` | Account + bucket Block Public Access; delete ACLs |
| Role from a public task | IRSA role with `s3:*` on `*` | Scope the role to prefixes; remove `s3:ListBucket` on unused buckets |
| Resource policy | `aws:PrincipalOrgID` missing; account in another org | Explicit `Principal` + `aws:SourceAccount` / VPC endpoint conditions |
| Unsigned URL sprawl | Presigned URLs in tickets, 7-day expiry | Short TTL, CloudFront signed cookies for human download |

A **private** bucket on a **live** identity path is still a P1. [Toxic combinations](/blog/toxic-combinations-aws-azure/) are exactly this: exposure × privilege × data class.

## 1. Block Public Access, then kill ACLs

Turn **S3 Block Public Access** on at the **account**, then on every bucket that is not a documented public origin (and even then, prefer CloudFront + OAC, not a public bucket).

```json
{
  "BlockPublicAcls": true,
  "IgnorePublicAcls": true,
  "BlockPublicPolicy": true,
  "RestrictPublicBuckets": true
}
```

Set **Object Ownership** to **Bucket owner enforced**. That disables ACLs. New objects cannot be made public with `canned-acl=public-read`.

Guardrails:

- Organizations SCP: deny `s3:PutBucketPublicAccessBlock` and `s3:PutAccountPublicAccessBlock` except a break-glass role.
- AWS Config `S3_BUCKET_LEVEL_PUBLIC_ACCESS_PROHIBITED` and `S3_ACCOUNT_LEVEL_PUBLIC_ACCESS_BLOCKS`.
- IAM Access Analyzer: external access findings on every bucket weekly.

If you must serve public objects, put CloudFront in front with Origin Access Control. The bucket policy allows only the CloudFront service principal. The bucket stays non-public in the S3 console.

## 2. Authorize with IAM + one bucket policy

Write a bucket policy that is **deny-by-default** for the cases IAM cannot express: encryption, TLS, and VPC endpoint.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyInsecureTransport",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:*",
      "Resource": [
        "arn:aws:s3:::prod-app-data",
        "arn:aws:s3:::prod-app-data/*"
      ],
      "Condition": {
        "Bool": { "aws:SecureTransport": "false" }
      }
    },
    {
      "Sid": "DenyUnencryptedObjectUploads",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::prod-app-data/*",
      "Condition": {
        "StringNotEquals": {
          "s3:x-amz-server-side-encryption": "aws:kms"
        }
      }
    },
    {
      "Sid": "AllowFromAppVpcEndpointOnly",
      "Effect": "Allow",
      "Principal": { "AWS": "arn:aws:iam::123456789012:role/payments-api" },
      "Action": ["s3:GetObject", "s3:PutObject"],
      "Resource": "arn:aws:s3:::prod-app-data/payments/*",
      "Condition": {
        "StringEquals": {
          "aws:SourceVpce": "vpce-0abc"
        }
      }
    }
  ]
}
```

Do not grant `s3:*` on `arn:aws:s3:::*` to a task role. `ListBucket` on the bucket ARN plus `GetObject` on a prefix is enough for most apps. [CIEM](/blog/ciem-explained-for-cloud-teams/) is how you find the roles that still have `s3:*`.

## 3. Encryption, keys, and object lock

| Control | Production default |
| ------- | ------------------ |
| Default encryption | SSE-KMS with a CMK you own, bucket keys on |
| Key policy | App role `kms:Decrypt` / `GenerateDataKey` on that CMK only; no `kms:*` |
| TLS | Bucket policy deny `aws:SecureTransport=false` |
| Versioning | On for buckets you might need to undelete |
| MFA delete | On for backup / audit buckets (root + MFA) |
| Object Lock | Compliance mode only where regulation requires immutability |

SSE-S3 is fine for non-sensitive bulk. Customer data, backups, and Terraform state use CMKs so you can revoke a role without rewriting every object.

## 4. Network: endpoints beat public NAT to S3

Give the VPC a **gateway endpoint** for S3. Point bucket policies at `aws:SourceVpce`. Workloads never need a NAT path to `s3.amazonaws.com` for private data.

If the bucket must be reached from another VPC or account, use a VPC endpoint in that VPC plus `aws:SourceAccount` / `aws:PrincipalOrgID`. Avoid `Principal: "*"` with a CIDR condition—it is easy to get wrong and Access Analyzer will flag it.

## 5. Logging and detection

- **CloudTrail data events** for `GetObject` / `PutObject` / `DeleteObject` on production buckets (management events alone do not show reads).
- **S3 server access logging** or **CloudTrail + Lake** if you need requester-pays style forensics.
- **GuardDuty S3** protection for anomalous GetObject volume.
- **Macie** only on buckets classified as PII/PHI—not every log bucket.

A finding of “bucket is private” with no data-event trail is incomplete. You cannot prove exfil after a stolen IRSA token without the GetObject records.

## Prove the path is gone

After BPA, ACL disable, and role scope:

1. Access Analyzer: zero external-access findings on the bucket.
2. `aws iam simulate-principal-policy` for the task role: `s3:GetObject` denied on prefixes it should not read.
3. Graph query: no `Internet --REACHABLE--> Workload --ASSUMES--> Identity --CAN_ACCESS-->` this bucket.

OpenSourceOM stores that last walk as first-class edges ([the graph](/docs/the-graph/)). Install a collector and run the same MATCH after each Terraform apply ([getting started](/docs/getting-started/)).

## Cadence

| When | What |
| ---- | ---- |
| Account create | BPA on; SCP deny disable |
| Every bucket | Ownership enforced, default KMS, TLS deny, Config rules |
| Weekly | Access Analyzer, unused `s3:*` on task roles |
| Continuous | GuardDuty S3, graph `internet-to-bucket` |

## Key takeaways

- Account-level **Block Public Access** plus **Bucket owner enforced** removes the two cheapest public-grant bugs.
- Remaining risk is almost always **IAM or resource-policy** `CAN_ACCESS`, not a yellow “public ACL” badge.
- Rank leftover S3 findings by whether a walk from the internet (or a compromised pod) can `GetObject` production prefixes—not by Config severity.

**Related:** [Attack path analysis](/blog/attack-path-analysis-cloud-security/) · [Break a cloud attack path](/blog/how-to-break-cloud-attack-paths/) · [CIEM](/blog/ciem-explained-for-cloud-teams/)
