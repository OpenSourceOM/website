---
title: "Public EBS Snapshots: Finding and Killing Them"
description: "Public EBS snapshot exposure is CreateVolumePermission group=all, not a bucket ACL. Account-level block-all-sharing, hunt commands, and the AMI side channel Block Public Access for snapshots does not close."
pubDate: 2026-08-27
updatedDate: 2026-08-27
author: OpenSourceOM Team
tags:
  - AWS
  - EBS
  - snapshots
  - data exposure
  - EC2
focusKeyword: public EBS snapshot
faq:
  - question: Does S3 Block Public Access stop public EBS snapshots?
    answer: >-
      No. Snapshots are EC2/EBS APIs (ModifySnapshotAttribute,
      CreateVolumePermission). S3 BPA is a different control plane. You need
      EnableSnapshotBlockPublicAccess per Region (or an Organizations
      declarative policy) plus a hunt for snapshots already shared as group
      all.
  - question: What is the difference between block-new-sharing and block-all-sharing?
    answer: >-
      block-new-sharing refuses new public CreateVolumePermission grants;
      snapshots that are already public stay listable. block-all-sharing also
      treats currently public snapshots as private for new describes, even if
      the attribute still looks public. Use block-all-sharing unless you
      deliberately publish marketplace snapshots.
  - question: If I block public snapshots, can AMIs still leak the disk?
    answer: >-
      Yes. Public AMIs remain a separate setting (EnableImageBlockPublicAccess).
      An AMI that is public includes references to snapshots; blocking snapshot
      public sharing does not unpublish AMIs. Hunt Public=true images in every
      Region.
  - question: How do snapshots become public without anyone clicking Public in the console?
    answer: >-
      Backup scripts and Terraform using create-volume-permission group all,
      copied snapshots that inherited sharing, third-party backup products with
      a “share for support” checkbox, and old training accounts that published
      gold images. CloudTrail eventName ModifySnapshotAttribute is the audit.
---

Someone in another AWS account ran `describe-snapshots --restorable-by-user-ids all` and your `snap-0abc` appeared with a volume that still had `/var/lib/mysql`. That is a **public EBS snapshot**: `createVolumePermission` includes group `all`. It is not an S3 ACL and it is not “the AMI is private so we are fine.”

This page is **find, block, and unshare**. Encryption-at-rest checklists and org CloudTrail belong in [AWS security best practices](/blog/aws-security-best-practices-2026/). If the snapshot held production data, treat readers as unknown principals and rank blast radius with [attack path analysis](/blog/attack-path-analysis-cloud-security/) only after it is no longer public.

## How snapshots go public

EBS snapshots start private. Public means:

```bash
aws ec2 modify-snapshot-attribute \
  --snapshot-id snap-0abc \
  --attribute createVolumePermission \
  --operation-type add \
  --group-names all
```

That API is also what Terraform `aws_ebs_snapshot` + `create_volume_permission { group = "all" }` and some “share this backup with AWS Support” helpers call.

Other paths:

- **CopySnapshot** in another Region; sharing is per snapshot ID, and people re-share the copy
- **Data Lifecycle Manager / backup vaults** that still use an old share step
- **Training / demo accounts** in the same org that published a “golden AMI” by sharing the underlying snap

Encrypted snapshots can still be public. The recipient needs KMS access as well; unencrypted public snaps are readable by every account. Do not use encryption as a substitute for unsharing. A public encrypted snap plus a KMS key policy that allows `kms:Decrypt` for `*` is the same breach with extra steps.

CloudTrail names: `ModifySnapshotAttribute`, `CreateSnapshots`, `CopySnapshot`. Alert on `group: all` in request parameters. Data Lifecycle Manager and AWS Backup copies are new snapshot IDs—a share on the source is not automatically a share on the copy, but backup products often re-apply the same `createVolumePermission` block. Hunt both.

## Account-level block public sharing

This setting is **per account, per Region**. Organizations **declarative policies** can force it across accounts; while a declarative policy is attached, the account console cannot weaken it.

```bash
# Current mode: unblocked | block-new-sharing | block-all-sharing
aws ec2 get-snapshot-block-public-access-state --region us-east-1

aws ec2 enable-snapshot-block-public-access \
  --state block-all-sharing \
  --region us-east-1
```

| Mode | New public shares | Already public snaps |
| --- | --- | --- |
| `unblocked` | Allowed | Stay public |
| `block-new-sharing` | Denied | Stay public |
| `block-all-sharing` | Denied | Treated as private for new list/restore |

`block-new-sharing` is how teams “enable the control” and still leak last year’s public gold image. Prefer `block-all-sharing` unless you operate a public snapshot catalog on purpose.

IAM: callers need `ec2:EnableSnapshotBlockPublicAccess` / `GetSnapshotBlockPublicAccessState`. Repeat every Region; a single `us-east-1` enable leaves `eu-west-1` open.

SCP/RCP thought: you can Deny `ec2:ModifySnapshotAttribute` for public groups in member accounts. Still enable the account block—click-ops and forgotten automation both exist. Test Denies in a sandbox OU like other org policies ([AWS security best practices](/blog/aws-security-best-practices-2026/)).

## Hunting existing public snaps

Block does not inventory. Hunt **owned-by-you and restorable by everyone**:

```bash
aws ec2 describe-snapshots \
  --owner-ids self \
  --restorable-by-user-ids all \
  --query 'Snapshots[].[SnapshotId,VolumeSize,StartTime,Description,Encrypted]' \
  --output table
```

Empty output in one Region is not org-wide. Loop Regions. Then unshare explicitly so attributes match reality (especially if you only used `block-new-sharing`):

```bash
aws ec2 modify-snapshot-attribute \
  --snapshot-id snap-0abc \
  --attribute createVolumePermission \
  --operation-type remove \
  --group-names all
```

Confirm:

```bash
aws ec2 describe-snapshot-attribute \
  --snapshot-id snap-0abc \
  --attribute createVolumePermission
```

`CreateVolumePermissions` should have no `Group: all`. Specific account IDs in that list are **sharing with a partner**, not public; review those ARNs the same week.

Access Analyzer **external access** findings include `AWS::EC2::Snapshot` when the zone of trust is the account or org. That is a second hunt if CloudTrail retention is short. Unused-access analyzers will not list snapshots.

If a public snap existed, assume copies exist. You cannot un-describe it from the rest of AWS. Rotate data that lived on the volume (credentials, tokens, customer exports), not just the snapshot attribute.

Also hunt snapshots you **do not own** but can restore: partner shares. `describe-snapshots --restorable-by-user-ids self` (without `--owner-ids self`) lists inbound shares. Those are not “public,” but a forgotten share from a vendor account is still a copy of your disk in someone else’s billing.

## AMI side channel

`EnableSnapshotBlockPublicAccess` **does not** stop public AMIs. Registering an AMI can expose the same blocks through `describe-images --executable-users all`.

```bash
aws ec2 describe-images --owners self \
  --query 'Images[?Public==`true`].[ImageId,Name,CreationDate]' \
  --output table

aws ec2 get-image-block-public-access-state

# Blocks *new* public AMI shares; existing public AMIs stay public
aws ec2 enable-image-block-public-access \
  --image-block-public-access-state block-new-sharing
```

Then **un-publish** each image:

```bash
aws ec2 modify-image-attribute \
  --image-id ami-0abc \
  --launch-permission '{"Remove":[{"Group":"all"}]}'
```

Marketplace and shared AMIs you *consume* are unrelated; this is **your** `owners self` list. Community AMIs in the account that someone copied with `--copy-image` can become public again if launch permission is sloppy.

DSPM-style classification of snapshot contents is optional after the snap is private. While it is public, the finding is exposure, not a labeling debate. [Toxic combinations](/blog/toxic-combinations-aws-azure/) here are public snap + production volume origin + keys on disk.

## Checklist

- [ ] `block-all-sharing` for snapshots in every Region (or org declarative policy)
- [ ] `describe-snapshots --owner-ids self --restorable-by-user-ids all` empty in every Region
- [ ] Remaining `CreateVolumePermission` entries are named accounts, reviewed
- [ ] CloudTrail alert on `ModifySnapshotAttribute` adding group `all`
- [ ] Public AMIs hunted and unpublished; image block public access enabled
- [ ] Snapshot block and AMI block treated as two controls, not one
- [ ] If a snap was public: rotate secrets that were on the volume; do not only unshare
---
