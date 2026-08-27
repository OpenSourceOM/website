---
title: "Multi-Account AWS Attack Paths: Trust Policies and SCPs"
description: "How AssumeRole, resource policies, and SCPs create org-wide AWS attack paths, including trusts and denies that do not apply where you think."
pubDate: 2026-08-27
updatedDate: 2026-08-27
author: OpenSourceOM Team
tags:
  - AWS
  - AssumeRole
  - SCP
  - multi-account
  - attack path analysis
focusKeyword: multi-account AWS attack path
faq:
  - question: Does an SCP on the Sandbox OU stop a role in Sandbox from assuming prod-admin?
    answer: >-
      Only if the SCP denies sts:AssumeRole (or the specific resource) for that principal
      in the Sandbox account. SCPs restrict what principals in the attached account can
      do; they do not rewrite the trust policy on prod-admin. If prod-admin's trust allows
      the Sandbox account root, and the SCP does not deny AssumeRole, the hop exists.
      SCPs also never apply in the management account.
  - question: Why does Access Analyzer miss some org-wide trusts?
    answer: >-
      Analyzer is zone-of-trust based. An allowed principal inside the org can look
      "internal" while still being a sandbox account you consider hostile. OpenSourceOM
      draws CAN_ASSUME from the trust JSON, including "AWS": "arn:aws:iam::ACCOUNT:root"
      and org-id conditions, then walks from workloads in that ACCOUNT. Internal to the
      org is not the same as internal to prod.
  - question: Can a resource policy bypass an SCP?
    answer: >-
      The evaluation order is SCP AND identity policy AND resource policy (and
      permission boundaries, session policies). An SCP Deny wins. An SCP that does not
      mention s3:GetObject does not stop a bucket policy that grants the org. Teams
      confuse "we have an SCP" with "resource policies cannot invite the org." Read both.
  - question: Where do org CloudTrail and Identity Center fit?
    answer: >-
      They are control-plane hygiene, not path cuts. Org CloudTrail tells you the
      AssumeRole happened. Identity Center removes long-lived IAM users. Neither deletes
      a trust that allows account 999999999999 to assume prod-admin. Those controls are
      in the AWS best-practices post; this page is the trust/SCP walk.
---

A **multi-account AWS attack path** is a walk that **leaves the account where the CVE or public SG lives** and lands on data or admin in another account. The hop is almost always `sts:AssumeRole`, a **resource policy** that names the org or another account, or a service that assumes a role for you (`iam:PassRole`). Account isolation is a billing and blast-radius *intention*. OpenSourceOM will draw `CAN_ASSUME` across account ids whenever collectors see both sides. Org-level hygiene (Identity Center, org CloudTrail, management account empty) is [AWS security best practices](/blog/aws-security-best-practices-2026/). This page is **the edges those controls do not automatically delete**.

```
Account A (sandbox)                    Account B (prod)
-------------------                    ----------------
Internet → jumphost                    role/prod-admin
             │                         trust: A:root
             └─ instance profile  --CAN_ASSUME-->  prod-admin
                                   --CAN_ACCESS-->  s3/prod-pii
```

If you only ingest Account B, OpenSourceOM cannot start the walk at the jumphost. Ingest the org.

## AssumeRole across accounts

Trust policies are inbound `CAN_ASSUME`. The dangerous patterns:

**1. Account root in `Principal`**

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "AWS": "arn:aws:iam::999999999999:root" },
    "Action": "sts:AssumeRole"
  }]
}
```

`root` here does **not** mean the root user only. It means **any principal in 999999999999** that is allowed `sts:AssumeRole` on this role (identity policy + SCP). A sandbox instance profile with `sts:AssumeRole` on `*` becomes prod-admin.

**2. Missing `ExternalId` / confused deputy on a vendor role**

Third-party roles that trust a vendor account without `sts:ExternalId` (or a condition the vendor cannot guess) are [third-party] paths. Same graph verb: `CAN_ASSUME` from that account.

**3. `aws:PrincipalOrgID` that treats the whole org as friendly**

```json
"Condition": {
  "StringEquals": { "aws:PrincipalOrgID": "o-xxxxxxxxxx" }
}
```

Every account in the org, including the one a contractor uses for pentest tooling, can match. Prefer `aws:PrincipalAccount` or a specific role ARN. Org-id conditions are useful on **buckets** to keep data in-org; they are a wide trust on **admin roles**.

Enumerate:

```
aws iam list-roles --query 'Roles[].[RoleName,Arn]' --output text
# For each role that looks cross-account:
aws iam get-role --role-name "$NAME" --query 'Role.AssumeRolePolicyDocument'
aws iam list-roles --path-prefix / --query 'Roles[?AssumeRolePolicyDocument]'
```

OpenSourceOM should create `CAN_ASSUME` from a placeholder `Account{id:999999999999}` node to the role if the destination account is not ingested, and from concrete workloads once it is. A placeholder is a **warning**, not a closed investigation.

Failure mode: “Access Analyzer shows no external findings” because 999999999999 is in the same org. Analyzer’s zone of trust is not your prod boundary.

## Resource policies that invite the org

Identity policies are not the only `CAN_ACCESS`. Bucket, KMS, SQS, SNS, Secrets Manager, ECR, and Lambda resource policies can grant `Principal: *` or `arn:aws:iam::org-id:root`-shaped org principals.

```json
{
  "Effect": "Allow",
  "Principal": { "AWS": "*" },
  "Action": "s3:GetObject",
  "Resource": "arn:aws:s3:::prod-pii/*",
  "Condition": {
    "StringEquals": { "aws:PrincipalOrgID": "o-xxxxxxxxxx" }
  }
}
```

Any principal in the org that can call `s3:GetObject` (including a sandbox role with `AmazonS3ReadOnlyAccess`) **CAN_ACCESS** prod-pii **without AssumeRole**. OpenSourceOM must attach `CAN_ACCESS` from those identities to the bucket even when there is no role in the prod account. If the collector only reads IAM in prod, it will miss this.

KMS key policies that allow `kms:Decrypt` to the org are the same hop with nicer JSON.

```
aws s3api get-bucket-policy --bucket prod-pii
aws kms get-key-policy --key-id alias/prod-pii --policy-name default
```

Failure mode: enabling S3 Block Public Access and declaring the bucket closed. BPA stops *anonymous* and some public ACL paths. It does not stop an org-id condition. Different edge.

## SCPs that do not apply

SCPs are often cited as the reason a sandbox cannot hurt prod. They fail in specific, documentable ways—also summarized in the [AWS best practices](/blog/aws-security-best-practices-2026/) post; the path implications are here.

| Belief | Actual evaluation |
| --- | --- |
| SCP on Sandbox OU blocks assuming prod roles | SCP must deny `sts:AssumeRole` (resource-constrained) **in the sandbox account**. Trust on the prod role is unchanged. |
| SCP applies to every account | **Never** the management account. Workloads there skip every SCP. |
| SCP Deny on `iam:*` stops privilege minting in sandbox | Service-linked roles and some AWS services are not restricted the way you think; test in a sandbox OU. |
| FullAWSAccess only SCP means “locked down” | That SCP is an allow of `*`. It does not deny cross-account. |
| SCP replaces resource policies | Evaluation is **AND**. Missing Deny in SCP + inviting bucket policy = path. |

```
# Who is attached, and is this the management account?
aws organizations describe-organization
aws organizations list-parents --child-id 999999999999
aws organizations list-policies-for-target --target-id 999999999999 --filter SERVICE_CONTROL_POLICY
```

OpenSourceOM does not treat “has SCPs” as a deleted `CAN_ASSUME`. It should treat an **explicit Deny** that matches the action and resource as cutting the edge—**if** the collector ingested the SCP and the principal is not in the management account. If your graph cannot parse SCP conditions, assume the edge exists and verify with `simulate-principal-policy` from a sandbox role.

Failure mode: attaching a Deny SCP to the prod OU (so prod cannot be assumed *from prod*) and leaving sandbox unrestricted. The attacker is not in prod yet.

## Example path org-wide

A path OpenSourceOM should return after org ingest:

```
Internet
  REACHABLE  account-9999  sg-jumphost  0.0.0.0/0:22     (sandbox)
  AFFECTS    CVE on jumphost AMI
  ASSUMES    role/sandbox-jump  (instance profile)
  CAN_ASSUME role/prod-admin in account-1111
             trust Principal = arn:aws:iam::999999999999:root
             no ExternalId, no aws:SourceAccount
  CAN_ACCESS s3://prod-pii  (identity policy AdministratorAccess)
  CAN_ACCESS organizations:LeaveOrganization?  (if that action is allowed)
```

Cuts that work, cheapest first ([how to break a cloud attack path](/blog/how-to-break-cloud-attack-paths/)):

1. **Trust:** replace `999999999999:root` with `arn:aws:iam::999999999999:role/sandbox-jump` **only if** you still need it; otherwise delete the statement. Better: delete cross-account admin trusts; use Identity Center permission sets in prod.
2. **SCP on Sandbox OU:** `Deny` `sts:AssumeRole` on `arn:aws:iam::111111111111:role/*` except a named break-glass role.
3. **Network:** close `0.0.0.0/0:22` on the jumphost (does not delete the trust; deletes this entry).
4. **Do not** rely on “sandbox is not prod” as a cut.

Prove with:

```
aws sts assume-role \
  --role-arn arn:aws:iam::111111111111:role/prod-admin \
  --role-session-name proof \
  --profile sandbox-jump
# Must fail after the trust/SCP cut
```

Then re-run the OpenSourceOM MATCH from `Internet` to `prod-pii` with collectors that include both accounts.

Failure mode: deleting the jumphost and leaving the trust to `:root`. The next EC2 in 999999999999 with `sts:AssumeRole` reconstitutes the path.

## Checklist

- [ ] Collectors ingest every account that appears in a prod trust `Principal` or org-id condition
- [ ] Trust policies with `:root` or org-id on admin roles are listed and replaced with role ARNs or deleted
- [ ] Bucket/KMS/SQS resource policies that grant the org are walked as `CAN_ACCESS` without AssumeRole
- [ ] Block Public Access is not treated as an org-policy cut
- [ ] SCPs: Deny actually matches `sts:AssumeRole` / data actions; management account excluded from the fairy tale
- [ ] `assume-role` from the sandbox profile fails after the cut; OpenSourceOM MATCH is empty after sync
- [ ] Identity Center and org CloudTrail exist (best-practices post) *and* the trust JSON still got edited

---
**Related:** [AWS security best practices](/blog/aws-security-best-practices-2026/) · [Attack path analysis](/blog/attack-path-analysis-cloud-security/) · [CIEM explained](/blog/ciem-explained-for-cloud-teams/)
