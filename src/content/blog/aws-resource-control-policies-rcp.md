---
title: "AWS Resource Control Policies (RCPs) vs SCPs"
description: "AWS resource control policies are Organizations resource-based guardrails: they cap what any caller—including principals outside the org—can do to member-account resources. SCP vs RCP vs IAM, a public-S3 deny, sandbox OU tests."
pubDate: 2026-08-27
updatedDate: 2026-08-27
author: OpenSourceOM Team
tags:
  - AWS
  - Organizations
  - RCP
  - SCP
  - IAM
focusKeyword: AWS resource control policies
faq:
  - question: Do RCPs apply to the management account?
    answer: >-
      No. Like SCPs, RCPs do not affect resources in the management account.
      They apply to member accounts, including accounts that are delegated
      administrators. Workloads in the management account skip both guardrails.
  - question: Can an RCP stop a public bucket policy that SCPs missed?
    answer: >-
      Yes, that is the point. SCPs restrict principals *in* the org. A bucket
      policy Principal "*" is evaluated against the resource. An RCP Deny on
      s3:* unless aws:PrincipalOrgID matches still applies when the caller is
      anonymous or another AWS account. SCPs never saw that caller.
  - question: Do RCPs grant access if I Allow s3:*?
    answer: >-
      No. The default RCPFullAWSAccess is a pass-through so evaluation can
      succeed. An Allow in an RCP does not give anyone GetObject. Identity
      policies and the bucket policy still must Allow. Use Deny statements to
      constrain.
  - question: Why did CloudTrail still write after an S3 RCP Deny?
    answer: >-
      Service principals need an exception (aws:PrincipalIsAWSService). RCPs
      also do not restrict service-linked roles. Without BoolIfExists
      aws:PrincipalIsAWSService false on the Deny, you break AWS services that
      write to your buckets.
---

A bucket policy with `"Principal": "*"` is a **resource** document. An SCP on the account that owns the bucket does **not** apply to the anonymous caller or to `arn:aws:iam::999999999999:root`. **AWS resource control policies** (RCPs) are the Organizations policy type that *does* sit on that resource when someone outside the org calls it.

Official behavior: [Resource control policies](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_rcps.html). Org topology and SCPs: [AWS security best practices](/blog/aws-security-best-practices-2026/). This page is **RCP vs SCP vs IAM**, not a full data-perimeter whitepaper.

## What RCPs attach to

RCPs attach to the **same targets as SCPs**: organization root, OUs, and member accounts. Enable the policy type on the org (all features, not consolidated billing only) in the Organizations console under policy types, or via the Organizations `EnablePolicyType` API with type `RESOURCE_CONTROL_POLICY`. Then create a policy document and attach it to a **sandbox OU** first.

Effective permission on a resource is the intersection of:

- Every RCP on the account and **every parent** (root / OUs)
- Every SCP on the **caller’s** account (if the caller is in an org at all)
- Identity-based policy of the caller
- Resource-based policy on the resource

RCPs apply only to **supported services** (the list grows; S3, STS, KMS, SQS, Secrets Manager, CloudFront, and others are documented). An RCP that Denies `ec2:*` does not do what you think if EC2 is not in the resource-control set for that action.

They **do not** apply to:

- Resources in the **management account**
- Calls made by **service-linked roles**
- **AWS managed KMS keys**
- `kms:RetireGrant` (special-cased)

When you enable RCPs, AWS attaches `RCPFullAWSAccess` (allow all through the RCP layer) to root, OUs, and accounts. Removing that without a replacement is how you freeze S3.

## SCP vs RCP vs IAM

| | SCP | RCP | IAM identity / resource policy |
| --- | --- | --- | --- |
| Guardrail on | Principals **in** member accounts | **Resources** in member accounts | The principal or the resource you edit |
| External caller | Not evaluated | Evaluated | Resource policy yes; SCP no |
| Grants access? | Never | Never | Yes (this is what grants) |
| Typical use | No `CreateUser`, no leave-org, Region deny | No public S3, org-only STS assume, TLS on S3 | App role GetObject, bucket policy for CloudFront OAC |

Data perimeter in AWS language is **identity** (SCP + identity policy) **and** **resource** (RCP + resource policy) **and** **network** (VPC endpoint policy). RCP is the missing middle when a member attaches `Principal: *`.

IAM in the account can still Deny. RCP is the org-enforced ceiling so a local admin cannot open the resource to the world.

[CIEM](/blog/ciem-explained-for-cloud-teams/) still lists who *inside* the org can read. RCP answers who *outside* cannot, even if the bucket policy says they can.

## Example deny on public S3

AWS’s usual pattern: Deny `s3:*` unless the caller is in your org **or** is an AWS service principal (CloudTrail, Config, replication).

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "EnforceOrgIdentitiesOnS3",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:*",
      "Resource": "*",
      "Condition": {
        "StringNotEqualsIfExists": {
          "aws:PrincipalOrgID": "o-xxxxxxxxxx"
        },
        "BoolIfExists": {
          "aws:PrincipalIsAWSService": "false"
        }
      }
    }
  ]
}
```

Replace `o-xxxxxxxxxx`. `StringNotEqualsIfExists` / `BoolIfExists` matter: missing keys must not accidentally fail open or fail closed the wrong way. AWS service calls inject `aws:PrincipalIsAWSService`.

This does **not** replace account-level S3 Block Public Access. BPA stops public *policies and ACLs* from being created; RCP still evaluates remaining resource policies and **cross-account** Allow to a foreign `root`. Use both.

If you need a **website bucket** or CloudFront with OAC, that principal is not your org ID. Exception must be explicit (named CloudFront service principal / OAC conditions), tested, and owned—not “Principal * because marketing.”

## Testing in a sandbox OU

AWS’s own guidance: do **not** attach a Deny RCP at the org root first. There is no audit mode.

1. Create an OU `rcp-sandbox` with one empty account. Attach only `RCPFullAWSAccess` plus your Deny.
2. From a **second account outside the org** (or a personal test account), `GetObject` / `ListBucket` on a bucket in the sandbox account whose bucket policy Allows that tester. Expect AccessDenied once the RCP is attached.
3. From a **role in the sandbox account**, `GetObject` with a normal identity policy. Expect success.
4. Confirm CloudTrail, Config, and (if used) S3 replication still write. If they stop, the service-principal exception is wrong.
5. Watch CloudTrail `AccessDenied` in the sandbox account for unexpected principals (backup vendors, GitHub OIDC in another org, Marketplace).
6. Promote the policy to a nonprod OU, then workloads. Never skip the external-caller test: that is the only test SCPs cannot substitute.

If a vendor **must** `AssumeRole` or `GetObject` from outside, put their account ID in a `StringNotEqualsIfExists` `aws:PrincipalAccount` list **on a dedicated statement**, not by omitting the RCP on prod.

Failure mode: RCP Deny `s3:*` without service exception → landing zone unable to deliver Config snapshots. Failure mode: attaching at root the same afternoon you enable the policy type.

Remaining public-or-cross-account edges after RCP belong on [attack path analysis](/blog/attack-path-analysis-cloud-security/) and [toxic combinations](/blog/toxic-combinations-aws-azure/)—the RCP should have killed anonymous `GetObject`.

## Checklist

- [ ] Policy type `RESOURCE_CONTROL_POLICY` enabled; `RCPFullAWSAccess` left in place
- [ ] First Deny attached to a sandbox OU/account, not the org root
- [ ] External-account GetObject test **fails**; in-org app role GetObject **succeeds**
- [ ] `aws:PrincipalIsAWSService` exception verified with Trail/Config
- [ ] Management account workloads not counted as “protected by RCP”
- [ ] BPA + RCP both on; website/OAC exceptions named and owned
- [ ] Vendor cross-account access listed in conditions, not by skipping RCP
---
