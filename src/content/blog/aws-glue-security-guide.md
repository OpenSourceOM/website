---
title: "AWS Glue Security: Job Roles, Catalog Encryption, and Connections"
description: "AWS Glue security for ETL: least-privilege job roles, Lake Formation vs IAM, connection credentials, catalog encryption, and why a crawler role that can s3:* is an exfil path."
pubDate: 2026-08-29
updatedDate: 2026-08-29
author: OpenSourceOM Team
tags:
  - AWS
  - Glue
  - IAM
  - Lake Formation
  - data security
focusKeyword: AWS Glue security
faq:
  - question: Does Lake Formation replace the Glue job IAM role?
    answer: >-
      No. The job still assumes an IAM role to talk to Glue APIs, S3, KMS, and
      CloudWatch. Lake Formation adds a second grant layer on Data Catalog
      tables and S3 locations. A job role with s3:* on the data lake bypasses
      the point of LF column filters.
  - question: Are Glue connections encrypted?
    answer: >-
      JDBC passwords in connections are stored by Glue and retrieved at runtime
      by the job role. If that role can glue:GetConnection on every connection
      in the account, every warehouse password is in play. Scope GetConnection
      to named connections and put secrets in Secrets Manager with a resource
      policy the job role can read—one secret per connection.
  - question: Why do public Glue jobs keep showing up in CSPM?
    answer: >-
      Glue jobs do not have a public IP the way RDS does. The exposure is the
      role: network (can the ENI reach the internet?), S3 (can it write to an
      attacker bucket?), and catalog (can it drop tables?). Treat the job role
      as the blast radius, not the job name.
---

Glue runs Spark (or Python shell) under an **IAM role you chose**. That role can read every bucket you were too busy to name, call `glue:GetConnection` on prod JDBC, and write to a “scratch” prefix that is world-readable. **AWS Glue security** is the job role, the Data Catalog, and connections—not a Spark tuning guide, not Lake Formation marketing, and not [Amazon RDS security](/blog/aws-rds-security-guide/) (the warehouse behind JDBC is a different origin). AWS reference: [Security in AWS Glue](https://docs.aws.amazon.com/glue/latest/dg/security.html).

```
Scheduler / trigger
  → Glue job  —ASSUMES→  job role
       → S3 (source + junkyard)
       → Data Catalog / Lake Formation
       → JDBC connection secret
       → KMS
```

If the job role can `s3:PutObject` on a bucket your org does not own, ETL is an exfil pipeline.

## 1. One job role is not an org role

Do not reuse `GlueServiceRole` with `AdministratorAccess` “until we land.” Split:

| Role | Allowed to |
| --- | --- |
| `glue-payments-etl` | Read `s3://lake/payments/…`, write `s3://lake/payments/curated/…`, `glue:GetConnection` on `payments-pg` only |
| `glue-crawler-payments` | Crawl those prefixes; **no** `iam:PassRole` on the ETL role |
| Break-glass | Catalog admin in a separate account or permission set |

```json
{
  "Effect": "Allow",
  "Action": ["s3:GetObject", "s3:PutObject"],
  "Resource": [
    "arn:aws:s3:::lake/payments/raw/*",
    "arn:aws:s3:::lake/payments/curated/*"
  ]
}
```

`iam:PassRole` on the Glue service should allow **only** the job roles Glue may assume (`iam:PassedToService` = `glue.amazonaws.com`). A developer who can pass `OrganizationAccountAccessRole` into a Glue job owns the account.

```bash
aws glue get-job --job-name payments-daily \
  --query 'Job.[Role,GlueVersion,Command.Name]'
```

## 2. Connections and secrets

JDBC connections store a username/password Glue decrypts at runtime. Bound the job role:

```json
{
  "Effect": "Allow",
  "Action": "glue:GetConnection",
  "Resource": "arn:aws:glue:us-east-1:123456789012:connection/payments-pg"
}
```

Prefer **Secrets Manager** as the connection password source. The secret resource policy should allow the job role, not `glue.amazonaws.com` from every account. Rotate the warehouse password when a job role is retired.

**Failure mode:** one `glue-shared` connection used by twenty jobs. Every job role then needs `GetConnection` on that name; one over-privileged job dumps the warehouse.

Network: put Glue ENIs in **private subnets** with VPC endpoints for S3 and Glue ([VPC endpoints vs NAT](/blog/aws-vpc-endpoints-vs-nat-security/)). A job that NATs to the internet can `pip install` from anywhere and can PUT to an external bucket if IAM allows it.

## 3. Catalog encryption and Lake Formation

Encrypt the Data Catalog with a CMK. Encrypt CloudWatch logs for the job. At-rest encryption on S3 is the bucket CMK—Glue `SecurityConfiguration` must name the same keys the job role can use or the job fails closed (good) or someone adds `kms:*` (bad).

```bash
aws glue get-data-catalog-encryption-settings
aws glue get-security-configuration --name payments-glue-sec
```

If you use **Lake Formation**:

- Register the S3 location; do not also grant the job `s3:*` on that prefix.
- Grant the job role LF permissions on **named databases/tables**, not `ALL TABLES IN DATABASE`.
- Hybrid access mode exists so IAM-only tables do not silently ignore LF. Know which tables are which.

LF data filters do nothing if the job reads the parquet files with raw `s3:GetObject`.

## 4. Dev endpoints, notebooks, and bookmarks

Deprecated **dev endpoints** were long-lived Spark clusters with a role. Do not recreate them. Use Glue Studio / interactive sessions with the **same** least-privilege role as prod, or you will debug with prod credentials.

Job bookmarks and temp dirs (`--TempDir`) inherit the job role’s S3 rights. A world-readable temp bucket is a copy of last night’s PII.

## Checklist

- [ ] Unique job role per sensitivity boundary; no org-admin pass-role
- [ ] `GetConnection` and Secrets Manager ARNs named, not `*`
- [ ] Glue ENIs private; S3/Glue via endpoints, not open NAT plus `s3:*`
- [ ] Catalog + job logs encrypted; S3 CMK usable by the job without `kms:*`
- [ ] Lake Formation grants match IAM (no dual `s3:*` backdoor)
- [ ] TempDir and bookmark buckets are private and lifecycle-expired
- [ ] Triggers and crawlers use the crawler role, not the ETL role

A Glue job with `s3:*` and `glue:GetConnection` on `*` is a **path to data** with a scheduler. Rank it like any other over-privileged workload in [blast-radius analysis](/blog/blast-radius-analysis-cloud-iam/).

**Related:** [Amazon RDS security](/blog/aws-rds-security-guide/) · [VPC endpoints vs NAT](/blog/aws-vpc-endpoints-vs-nat-security/) · [AWS security best practices](/blog/aws-security-best-practices-2026/)
