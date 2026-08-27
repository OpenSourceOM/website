---
title: "DSPM vs CIEM: Data Location vs Who Can Read It"
description: "DSPM vs CIEM splits classification of data from classification of principals. Empty public buckets, private buckets with Owner ACL, and IAM that ignores data tags are different failures."
pubDate: 2026-08-27
updatedDate: 2026-08-27
author: OpenSourceOM Team
tags:
  - DSPM
  - CIEM
  - data security
  - IAM
  - S3
focusKeyword: DSPM vs CIEM
faq:
  - question: If DSPM says a public bucket has no sensitive objects, can I leave it public?
    answer: >-
      Only if you accept the non-data risks: malware hosting, phishing drop, bill
      shock, and a future object that inherits the public ACL. DSPM cleared
      classification, not exposure policy. Account-level Block Public Access is
      still the default; exceptions need an owner and an expiry, not a DSPM
      screenshot.
  - question: Why is a private bucket with ACL Owner still a CIEM problem?
    answer: >-
      s3:GetObject for the object owner, plus any principal with s3:* or
      s3:GetObject on the prefix, still reads the data. Private to the internet
      is not private to the account. CIEM lists who those principals are;
      DSPM only told you the objects are PII.
  - question: Can object tags replace IAM?
    answer: >-
      No. Tags are attributes you can condition on (s3:ExistingObjectTag,
      ResourceTag). Without IAM or a bucket policy that requires the tag, anyone
      with GetObject still reads untagged objects. Untagged PII is the usual
      hole after a “we classified everything” project.
  - question: How do toxic combinations show up here?
    answer: >-
      Public or cross-account access (posture) plus a principal that can read
      classified objects (CIEM) plus confirmed PII (DSPM) is the combination.
      Isolated DSPM “has PAN” on an air-gapped account is a data-governance
      ticket, not an incident. See toxic combinations and CIEM explained.
---

Two buckets, same account.

`s3://marketing-static` is `GetObject` for `Principal: *`. DSPM scans it and finds HTML and a favicon. CIEM barely cares: the principals are the internet.

`s3://payments-ledger` is Block Public Access, KMS CMK, VPC-only. DSPM finds PAN. CIEM finds twelve roles with `s3:GetObject` on `payments-ledger/*`, including a sandbox CI role trusted from GitHub with no environment pin.

**DSPM vs CIEM** is that split: *where the bytes are and what they are* versus *which identities can read them*. Mixing the tools produces either “public but empty = critical” or “private PII = fine.”

Identity mechanics live in [CIEM explained](/blog/ciem-explained-for-cloud-teams/). Named pairs (exposure + privilege + data) are [toxic combinations](/blog/toxic-combinations-aws-azure/). This page is only the **classification mismatch**.

## Classifying data vs classifying principals

DSPM inventories **objects and stores**: buckets, volumes, warehouses, snapshots, and a label (PII, secrets, source code, “unknown”). It may add sensitivity from content, not from the folder name.

CIEM inventories **principals and effective access**: users, roles, service accounts, group inheritance, resource policies, and “can this identity `GetObject` / `rds:DownloadDBLogFiles` / `bigquery.tables.getData`.”

| Question | DSPM | CIEM |
| --- | --- | --- |
| Is there PAN in prefix X? | Yes | Irrelevant |
| Can `role/ci-sandbox` read prefix X? | Irrelevant | Yes / no |
| Is the bucket on the internet? | Exposure overlay, often borrowed from CSPM | Only if a principal is `*` or anonymous |

A CNAPP that “includes DSPM and CIEM” still has two graphs. Join them on **resource ARN**. Do not join on account name (“prod has PII so every role in prod is critical”).

RDS snapshots, EBS volumes, and warehouse extracts are DSPM objects too. A private bucket with no PAN can still feed a public snapshot or an export role. Classify the **copy**, not only the online prefix. CIEM must follow the identity that can `rds:RestoreDBInstanceFromDBSnapshot` or `ec2:CreateVolume` from that snapshot—not stop at `s3:GetObject`.

Failure mode: DSPM tags the bucket `classification=public` because the *bucket* is public. That is exposure, not content. Content tags belong on objects or on a scan result, not as a substitute for Block Public Access.

## Public bucket with no data

CSPM will still scream. It should. Empty public buckets become:

- **Writeable** if `PutObject` leaked onto `Principal: *` (malware, crypto miners of someone else’s bill)
- **Read-once-write-later** when a pipeline drops a CSV “temporarily”
- **Confused deputy** listings that leak key names even without object bodies

DSPM’s job here is to **deprioritize data-breach severity**, not to close the finding. Cloud security still blocks public access at the account ([AWS security best practices](/blog/aws-security-best-practices-2026/)).

```bash
# Objects exist? Classification can wait if the prefix is empty.
aws s3api list-objects-v2 --bucket marketing-static --max-items 5
# Anonymous get (expect AccessDenied once BPA is on)
aws s3api get-object --bucket marketing-static --key index.html /tmp/out --no-sign-request
```

If `get-object --no-sign-request` succeeds and `list-objects` is empty, you still have a **public endpoint**. DSPM “zero sensitive objects” is true and insufficient.

## Private bucket with Owner

S3 ACL `FULL_CONTROL` for the object owner, canned `private`, encryption on: DSPM still finds PII. The internet cannot `GetObject`. CIEM now owns the severity.

Typical readers that DSPM will never list:

- The **application role** (expected)
- A **shared “data-lake-reader”** role used by three BI tools and a contractor SSO permission set
- **Account root** and `AdministratorAccess` permission sets
- A **cross-account** analytics account in the bucket policy with `"Principal": {"AWS": "arn:aws:iam::999999999999:root"}` and no `aws:PrincipalArn` condition
- **Object ACL** `AuthenticatedUsers` from a 2018 migration (not “the internet,” still every AWS account)

“Owner” in the ACL sense is not “the payments team.” It is often the identity that `PutObject`’d, which might be a broken Glue job using the default Compute-style role.

Query effective access, not the ACL column in the console. Then rank with [attack path analysis](/blog/attack-path-analysis-cloud-security/): is `ci-sandbox` reachable from GitHub without environment protection? That path is the incident shape.

## Combining tags with IAM

Classification tags are useful **only as IAM conditions**.

```json
{
  "Sid": "ReadPiiOnlyIfTaggedAndFromApp",
  "Effect": "Allow",
  "Action": ["s3:GetObject"],
  "Resource": "arn:aws:s3:::payments-ledger/*",
  "Condition": {
    "StringEquals": {
      "s3:ExistingObjectTag/data-class": "pci",
      "aws:PrincipalTag/team": "payments"
    }
  }
}
```

This does nothing to untagged objects. DSPM’s operational output should be **coverage of tags** (or a default-deny on untagged prefixes), not a PDF of findings.

Pair with CIEM: principals that have `s3:GetObject` **without** the tag condition are the queue. Principals that only pass the condition are in policy. Re-scan when someone adds `s3:GetObject` on `*` in a permission set.

Graph join ([the graph](/docs/the-graph/), [OpenSourceOM](https://github.com/OpenSourceOM/core)): node `object/prefix` with `data-class`, edge `CAN_READ` from principal, edge `EXPOSED` if public. [Toxic combinations](/blog/toxic-combinations-aws-azure/) are those three together—not DSPM alone, not CIEM alone.

Failure mode: Macie or a DSPM scanner writes tags the IAM policy does not read, while Terraform IAM still grants `s3:*` to the team group. Tags become folklore.

Default-deny on untagged prefixes is noisy the first week (legacy objects). Run DSPM coverage as a percentage of bytes tagged, then flip the Deny. Do not wait for 100% labels on a 40 TB bucket before CIEM shrinks the `s3:*` group—that group can already read the untagged remainder.

## Checklist

- [ ] DSPM labels content (and unknown); it does not close public-access findings by itself
- [ ] Empty public buckets: still blocked at account BPA; severity for *breach* can drop
- [ ] Private classified buckets: CIEM list of GetObject principals, including cross-account `root`
- [ ] Object ACLs audited for AuthenticatedUsers / AllUsers leftover
- [ ] IAM Allow for classified prefixes uses tag (or prefix) conditions; untagged = deny or quarantine prefix
- [ ] Join key is resource ARN + principal ARN, not “the prod account”
- [ ] Tickets that combine public/cross-account + classified + reader identity use the toxic-combination path, not two tools arguing
---
