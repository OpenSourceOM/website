---
title: "Amazon DocumentDB Security Hardening: TLS, IAM, and No Public 27017"
description: "Harden Amazon DocumentDB with TLS 1.2, encryption at rest, no public access, scoped IAM or secrets, audit logs, and snapshot controls—then verify no internet path to the cluster."
pubDate: 2026-08-24
updatedDate: 2026-08-30
author: OpenSourceOM Team
tags:
  - AWS
  - DocumentDB
  - database security
  - IAM
  - cloud security
focusKeyword: AWS DocumentDB security
faq:
  - question: Should Amazon DocumentDB be publicly accessible?
    answer: No. Set PubliclyAccessible = false, place instances in private subnets, and allow TCP 27017 only from app security groups. A 0.0.0.0/0 rule on 27017 is an internet-to-data path even with a strong password.
  - question: Does DocumentDB support IAM authentication?
    answer: >-
      Yes for many workloads. IAM database authentication works with Mongo-compatible
      drivers. Prefer IAM over a long-lived master password in Secrets Manager shared
      by every microservice. If you use passwords, rotate them and never put them in
      Git or AMI userdata.
  - question: Is TLS optional on DocumentDB?
    answer: >-
      Treat it as required. Use tls=true and tlsCAFile with the Amazon RDS CA.
      Parameter groups should not leave TLS disabled. In-transit encryption is the
      difference between a sniffed VPC span and a stolen password on the wire.
  - question: How do I prioritize DocumentDB findings?
    answer: >-
      Graph Internet to app to identity to DocumentDB. Close public SG and
      over-broad IAM first. CVEs on a bastion wait. A private cluster whose task
      role can still dump collections from an internet-facing API is a live path.
---

**AWS DocumentDB security** is the same story as any datastore: **no public listener**, **encryption**, **least-privilege identities**, **audit**, **locked snapshots**. DocumentDB speaks the MongoDB wire protocol on **27017**. Attackers do not need a novel CVE if that port is open to the internet or if an app role can `find()` every database.

This is the production checklist. S3 next to the cluster follows [S3 hardening](/blog/aws-s3-bucket-security-hardening/). Paths: [attack path analysis](/blog/attack-path-analysis-cloud-security/).

## The DocumentDB path

```
Internet ──SG 0.0.0.0/0:27017──▶ DocumentDB   (do not allow)

App / Lambda / pod ──SG + TLS──▶ DocumentDB
         └──ASSUMES──▶ task role ──(IAM auth or secret)──▶ cluster
```

| Control | Fail | Pass |
| ------- | ---- | ---- |
| Network | `PubliclyAccessible=true` or SG `0.0.0.0/0` | Private subnets, SG source = app SG only |
| TLS | Client `tls=false` | `tls=true`, Amazon CA bundle, parameter `tls` enabled |
| Auth | Master password in the app image | IAM auth or Secrets Manager + rotation; no shared admin |
| Encryption at rest | AWS managed default with no key policy story | CMK, snapshot copy encrypted |
| Audit | None | Profiler / audit logs to CloudWatch, alarms on auth failures |

DocumentDB is **not** a drop-in for every MongoDB feature. Do not copy Atlas “IP allowlist 0.0.0.0/0 for convenience” into AWS.

## 1. Network: private cluster, tight SG

- `PubliclyAccessible = false` on instances.
- Subnets: private, no IGW route. Apps reach DocumentDB in-VPC or via **PrivateLink** (if you use the pattern for cross-VPC).
- Security group inbound: **27017 from the application SG** (and a bastion SG if you still use one). Not from `0.0.0.0/0`, not from the whole VPC CIDR if you can avoid it.
- NACL: optional defense in depth; SG is the control you page on.
- Prefer **IAM authentication** so compromised pods do not reuse a cluster password that also works from a laptop.

Config / Security Hub controls for public RDS-family instances apply in spirit: DocumentDB public access should be a P1, not a weekly backlog item.

## 2. TLS and parameters

Require TLS on the cluster parameter group. Clients:

```
mongodb://docdb-cluster:27017/?tls=true&tlsCAFile=global-bundle.pem&retryWrites=false
```

(`retryWrites` is a Mongo compatibility detail—set what DocumentDB supports; do not cargo-cult Atlas URI flags.)

Disable deprecated TLS versions in the parameter group. Rotate to the current Amazon RDS CA before expiry; leftover `rds-ca-2019` in AMIs is a silent outage *and* a finding.

## 3. Identity: IAM first, secrets second

**IAM database authentication:** the app’s IRSA / instance role is the principal. Scope the IAM policy to this cluster ARN. Do not attach `docdb:*` or `rds:*` on `*` to a web task.

**Password auth:** store the password in Secrets Manager, rotate, inject at runtime ([cloud-native secrets pattern](/blog/cloud-native-application-security/)). Never:

- Master user in Terraform state plaintext without encryption and tight state IAM ([state security](/blog/terraform-state-security-s3-backend/))
- One password for read-only reporting and the write path
- `root` from BI tools on the public internet

Create application users with the least Mongo roles you need (`readWrite` on one database, not `root`).

## 4. Encryption, backups, snapshots

- Storage encryption: **CMK** you control. Snapshot copies inherit encryption; do not copy snapshots to a public account.
- Backup window and retention per RPO; backup SG and IAM so restore does not require a human with `*`.
- **Deletion protection** on production clusters.
- Export / copy snapshot to S3 only into a BPA + KMS bucket from the S3 guide.

A public **snapshot** is a data breach without touching 27017. Include snapshots in the same graph as the cluster ([public EBS-style exposure](/blog/aws-ebs-snapshot-public-exposure/) is the sibling failure mode).

## 5. Logging and operations

- Enable **audit logs** and **profiler** to CloudWatch (auth, slow ops). Retain in a log account.
- Alarm: surge of authentication failures; change of SG; `ModifyDBCluster` by unexpected role.
- Patch the engine version on a published cadence; DocumentDB lags Mongo community versions—track AWS’s supported versions, not “whatever Mongo 8 does.”

## Prove there is no internet-to-collection walk

1. `DescribeDBClusters` / instances: `PubliclyAccessible=false`.
2. SG: no `0.0.0.0/0` on 27017.
3. `simulate-principal-policy` for the app role: cannot `rds:ModifyDBCluster` or dump via over-broad data-plane IAM.
4. Graph: no `Internet --REACHABLE--> DocumentDB`; app `CAN_ACCESS` only the intended cluster.

Connect collectors and run that MATCH in OpenSourceOM ([getting started](/docs/getting-started/), [the graph](/docs/the-graph/)).

## Cadence

| When | What |
| ---- | ---- |
| Create | Private, TLS, CMK, deletion protection, audit logs |
| App deploy | IAM auth or rotated secret; SG from app only |
| Weekly | Public flag, SG diffs, unused admin users |
| Quarterly | CA rotation, engine upgrade, snapshot copy policy |

## Key takeaways

- **No public 27017** is non-negotiable; password strength does not offset `0.0.0.0/0`.
- Prefer **IAM auth** and **CMK**; treat snapshots as copies of the database.
- Rank DocumentDB tickets by **reachability and identity**, not by whether the engine version is one behind.

**Related:** [AWS S3 security](/blog/aws-s3-bucket-security-hardening/) · [Attack path analysis](/blog/attack-path-analysis-cloud-security/) · [Cloud-native application security](/blog/cloud-native-application-security/)
