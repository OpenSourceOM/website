---
title: "Amazon RDS Security: Encryption, IAM Auth, and Public Access"
description: "Lock down Amazon RDS: KMS at rest, TLS in transit, IAM database auth, PubliclyAccessible false, snapshot exposure, and the security-group mistakes that still publish Postgres to 0.0.0.0/0."
pubDate: 2026-08-29
updatedDate: 2026-08-29
author: OpenSourceOM Team
tags:
  - AWS
  - RDS
  - encryption
  - IAM
  - database security
focusKeyword: Amazon RDS security
faq:
  - question: Does storage encryption stop a stolen snapshot from being restored in another account?
    answer: >-
      Only if the snapshot is encrypted with a KMS key the attacker cannot use.
      An unencrypted public snapshot is a full copy of the data. An encrypted
      snapshot shared to another account is usable if that account is also
      allowed on the CMK. Treat snapshot ACL and KMS grants as one control.
  - question: Is IAM database authentication a replacement for Secrets Manager?
    answer: >-
      It replaces static DB passwords for IAM principals that can call
      rds-db:connect. Apps still need a way to mint the token (SDK, RDS Proxy).
      Master users, some engines, and break-glass humans often still use a
      secret. IAM auth does not replace TLS or security groups.
  - question: Why is PubliclyAccessible false not enough?
    answer: >-
      The flag only controls whether RDS assigns a public IP and a public DNS
      name. A private instance with a security group that allows 0.0.0.0/0 on
      5432 is still reachable from any ENI that can route to that subnet,
      including a compromised VPN, peering, or a mis-attached Lambda in the VPC.
---

The finding is almost never “RDS exists.” It is a **public hostname**, a snapshot shared to `all`, or a security group that still allows `0.0.0.0/0` on 5432 because someone tested from home. **Amazon RDS security** here is the instance and snapshot perimeter: encryption, IAM DB auth, and network exposure. It is not Aurora Serverless v2 tuning, not a Postgres GRANT tutorial, and not org SCPs ([AWS security best practices](/blog/aws-security-best-practices-2026/)). Official API behavior stays in [Amazon RDS security](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.html).

```
Client / app role
  → (TLS) endpoint
       → security group + subnet (public IP or not)
            → engine (IAM auth token or password)
                 → storage (KMS) + automated snapshots (ACL)
```

If the graph shows `Internet —REACHABLE→ RDS`, encryption at rest does not save you. If the snapshot is public, neither does `PubliclyAccessible: false` on the live instance.

## 1. Public access is a DNS and IP decision

`PubliclyAccessible` tells RDS to put the instance on a public subnet path with a public IP. Turn it off unless you have a documented exception with an expiry.

```bash
aws rds describe-db-instances --query \
  'DBInstances[].[DBInstanceIdentifier,PubliclyAccessible,Endpoint.Address]' \
  --output table

aws rds modify-db-instance --db-instance-identifier payments \
  --no-publicly-accessible --apply-immediately
```

Modify is not instant: RDS may reboot. A subnet group that only contains public subnets plus a wide SG still looks “private” in CSPM that only keys off the flag. Put the instance in **private subnets** with no IGW route, and reach it through a bastion, SSM, RDS Proxy in the VPC, or a VPN.

**Failure mode:** `PubliclyAccessible: false` and `0.0.0.0/0` on the SG. The instance has no public IP; a compromised workload in the same VPC still connects. Treat SG source as the real ACL.

Same class of mistake as a [public EBS snapshot](/blog/aws-ebs-snapshot-public-exposure/).

## 2. Security groups are the listener ACL

RDS does not have a host firewall you SSH into. The **DB security group** (VPC SG on the ENI) is the control.

| Intent | SG rule |
| --- | --- |
| App in `sg-api` | Inbound 5432/3306 **from `sg-api` only** |
| Break-glass | From a bastion SG, not your laptop /32 forever |
| Never | `0.0.0.0/0` or `::/0` on the engine port |

```bash
aws ec2 describe-security-groups --group-ids sg-0123456789abcdef0 \
  --query 'SecurityGroups[0].IpPermissions'
```

RDS Proxy sits in the VPC and holds the connection pool. It does not make a public instance private. Put Proxy in private subnets and point the SG at the Proxy ENIs, not at the world.

## 3. Encryption at rest is the CMK, not a checkbox

`--storage-encrypted` with `aws/rds` is better than nothing. It does not stop:

- The same account reading the data through IAM
- A snapshot copied with `aws rds modify-db-snapshot-attribute --attribute-name restore --values-to-add all`

Use a **customer managed key**, restrict `kms:Decrypt` to the RDS service role and the break-glass role, and deny `rds:ModifyDBSnapshotAttribute` for `all` in IAM where you can survive it.

```bash
aws rds describe-db-snapshots --snapshot-type manual \
  --query 'DBSnapshots[].[DBSnapshotIdentifier,Encrypted,KmsKeyId]'

# Who can restore this snapshot?
aws rds describe-db-snapshot-attributes --db-snapshot-identifier payments-final
```

If `restore` includes `all`, that snapshot is a public backup of production. Remove it the same day you would remove a public AMI.

## 4. TLS in transit is a client parameter

RDS can require TLS (`rds.force_ssl` on Postgres parameter groups; `require_secure_transport` on MySQL 8.0.30+ in some versions—confirm on your engine). The app must use the **RDS CA bundle**, not `sslmode=disable`.

```
# Postgres example — fail closed
sslmode=verify-full
sslrootcert=/etc/ssl/certs/rds-ca.pem
```

IAM database authentication still wraps the token in TLS. Turning on IAM auth without `verify-full` is a password replacement on a cleartext channel.

## 5. IAM database authentication

Supported engines can mint a short-lived token (`rds-db:connect` on `arn:aws:rds-db:region:account:dbuser:db-id/db_user`). The DB user must be created as an IAM user inside the engine (`AWSAuthenticationPlugin` on MySQL; `rds_iam` on Postgres).

```json
{
  "Effect": "Allow",
  "Action": "rds-db:connect",
  "Resource": "arn:aws:rds-db:us-east-1:123456789012:dbuser:db-ABCDEF/app_iam"
}
```

Map that IAM principal to the **workload role** (IRSA, Lambda execution role), not to `DeveloperAccess`. Tokens last 15 minutes. RDS Proxy can cache IAM auth so you do not stampede `GenerateDBAuthToken`.

**Failure mode:** enabling IAM auth but leaving the master password in a Lambda environment variable “for migrations.” Attackers use the env var.

## Checklist

- [ ] `PubliclyAccessible` false; subnet group is private
- [ ] Engine port allowed only from app / Proxy / bastion SGs
- [ ] Storage encrypted with a CMK you control
- [ ] No snapshot `restore=all`; copy-tags and backup vault policy reviewed
- [ ] Clients `verify-full` against the RDS CA
- [ ] App roles use IAM DB auth or a rotated secret in Secrets Manager—not both forever
- [ ] Deletion protection on prod; no `skip-final-snapshot` in the runbook

A public RDS instance is an **exposure** node on the path to data, not a CVE. Rank it with [attack path analysis](/blog/attack-path-analysis-cloud-security/) and [how to prioritize cloud vulnerabilities](/blog/how-to-prioritize-cloud-vulnerabilities/).

**Related:** [Public EBS snapshots](/blog/aws-ebs-snapshot-public-exposure/) · [VPC endpoints vs NAT](/blog/aws-vpc-endpoints-vs-nat-security/) · [AWS security best practices](/blog/aws-security-best-practices-2026/)
