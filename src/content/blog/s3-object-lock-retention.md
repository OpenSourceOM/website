---
title: "S3 Object Lock: Governance, Compliance, and Delete Markers"
description: "S3 Object Lock is a retention ceiling: governance can be bypassed, compliance cannot, and a delete marker hides versions it does not remove."
pubDate: 2026-09-25
updatedDate: 2026-09-25
author: OpenSourceOM Team
tags:
  - AWS
  - S3
  - Object Lock
  - ransomware
  - immutability
focusKeyword: S3 Object Lock
faq:
  - question: Can the root user delete an object in compliance mode?
    answer: >-
      Not before the retain-until date. Compliance mode ignores root and
      ignores s3:BypassGovernanceRetention. Governance mode does not: a
      principal with that action and the bypass header can delete or
      shorten retention. Pick compliance only for data you are sure you
      can keep for the whole period, including account-closure friction.
  - question: Why does the object look deleted when Object Lock is on?
    answer: >-
      A delete without a version id writes a delete marker. The locked
      version is still in the bucket. Console and GetObject show the
      marker, so the object appears gone. Retention did its job. List
      object versions before you call it a wipe, and do not grant
      s3:DeleteObject plus BypassGovernanceRetention to the same role
      that runs the application.
  - question: Can I turn Object Lock off later?
    answer: >-
      No. You can enable it on a new bucket or on an existing bucket that
      already has versioning, and you cannot disable it or suspend
      versioning afterward. You also cannot shorten a compliance
      retention. Enable it on the log and backup buckets you named, not
      on a high-churn application bucket you might have to empty.
---

```bash
aws s3api put-object-lock-configuration \
  --bucket cloudtrail-logs-prod \
  --object-lock-configuration '{
    "ObjectLockEnabled": "Enabled",
    "Rule": {
      "DefaultRetention": { "Mode": "GOVERNANCE", "Days": 365 }
    }
  }'
```

**S3 Object Lock** is that configuration: versioning stays on, each version can carry a retain-until date, and a delete API is not allowed to honor it early unless the mode is governance and the caller is explicitly allowed to bypass. Bucket public access, encryption, and the bucket policy are the [S3 hardening](/blog/aws-s3-bucket-security-hardening/) baseline. This page is retention. AWS documents the modes in [S3 Object Lock](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html).

Enabling Object Lock on an existing versioned bucket is allowed. Disabling it later is not. Turn it on for the buckets you will still want in a year.

## Governance versus compliance

| | Governance | Compliance |
| --- | --- | --- |
| Shorten or delete early | Yes, with `s3:BypassGovernanceRetention` and header `x-amz-bypass-governance-retention: true` | No, including the root user |
| Extend retention | Yes, with `s3:PutObjectRetention` | Yes. Extend only |
| Account closure while objects remain | Possible | AWS can refuse to close the account until retention ends |
| Fit | CloudTrail, Terraform state, backups you might have to fix | Regulated archives you must not be able to fix |

Default retention on the bucket applies to new objects that do not set their own. It does not retroactively lock versions already written. After you enable it, confirm a new `PutObject` actually has a retain-until (`head-object` shows `ObjectLockMode` and `ObjectLockRetainUntilDate`). A bucket “with Object Lock enabled” and no default retention and no per-object retention is just versioning.

Deny bypass on every role except break-glass:

```json
{
  "Effect": "Deny",
  "Action": "s3:BypassGovernanceRetention",
  "Resource": "arn:aws:s3:::cloudtrail-logs-prod/*",
  "Condition": {
    "StringNotEquals": {
      "aws:PrincipalArn": "arn:aws:iam::123456789012:role/break-glass-s3"
    }
  }
}
```

The break-glass role should not be the Terraform role and should not be the application role. Governance plus a pipeline that holds `BypassGovernanceRetention` is compliance theater. [Terraform state](/blog/terraform-state-security-s3-backend/) buckets are a good governance candidate: you want an attacker with state access to be unable to quietly expire history, and you want a human to be able to repair a bad key. Compliance mode on a state bucket will also stop you.

## Delete markers

`s3:DeleteObject` without `versionId` creates a delete marker. The marker is the current version. The locked bytes remain. Listing without versions shows an empty key. Incident notes then say the logs were wiped.

```bash
aws s3api list-object-versions --bucket cloudtrail-logs-prod --prefix AWSLogs/
```

You want to see prior versions with `ObjectLockRetainUntilDate` still in the future. Recovery is copying that version out, not turning retention down.

A role used by the app should not have `s3:DeleteObject` on a log bucket at all. Lifecycle expiration does not delete a locked version before retain-until; it will delete once retention has passed. That is fine. A lifecycle rule is not a bypass, and it is not a reason to skip the deny on `BypassGovernanceRetention`.

## Legal hold

A legal hold is independent of mode. `put-object-legal-hold` with `Status=ON` blocks deletion until the hold is off, even for a governance object whose retain-until has passed. The action is `s3:PutObjectLegalHold`. Grant it to the legal/incident role, not to the log writer. A writer that can set and unset the hold can clear it and then delete.

Replication: the destination bucket needs Object Lock as well, or retention does not survive the copy. A replica in another account without Object Lock is the copy an attacker will delete. Same org, same mode, same deny on bypass.

## Where not to enable it

Compliance mode on a bucket that receives user uploads, build artifacts, or debug dumps will fill with versions you cannot delete, and it can block closing the account. Governance with a short default (days, not years) is the most you want there, and often you want neither.

Do not enable Object Lock to compensate for a public bucket. Lock keeps versions. It does not remove `Principal: *`. Fix exposure on the hardening page first.

## Checklist

- [ ] Object Lock only on named log, backup, and state buckets
- [ ] Mode is governance unless counsel asked for compliance and account closure was explained
- [ ] Default retention verified with `head-object` on a new write
- [ ] `s3:BypassGovernanceRetention` denied except one break-glass role
- [ ] App and CI roles lack `s3:DeleteObject` on those buckets
- [ ] Version listing is part of the incident step, so a delete marker is not called a wipe
- [ ] Replica buckets have Object Lock and the same bypass deny

Retention that any deploy role can bypass is versioning with extra steps. Retention nobody can lift is a bucket you must be willing to keep.
