---
title: "AWS Security Best Practices: A Practitioner Checklist for 2026"
description: "Org-first AWS hardening: Identity Center over access keys, SCPs that actually deny, org CloudTrail, S3 Block Public Access, and the failure modes that keep those controls from working."
pubDate: 2026-08-27
updatedDate: 2026-08-29
author: OpenSourceOM Team
tags:
  - AWS
  - cloud security
  - CSPM
  - IAM
  - security best practices
focusKeyword: AWS security best practices
faq:
  - question: What should I lock down first in a new AWS organization?
    answer: Root MFA and a hardware or passkey second factor, an organization management account that nobody uses for workloads, Identity Center instead of IAM users, an organization CloudTrail trail to a locked log archive account, and account-level S3 Block Public Access. Do those before GuardDuty tuning or a CNAPP purchase.
  - question: Why do SCPs fail to stop the thing I thought they blocked?
    answer: SCPs never apply to the management account, do not restrict service-linked roles, and are an allow-list intersection with IAM—not a deny that always wins unless you write an explicit Deny. A Deny without a condition can also break AWS Config, CloudTrail, or org-wide GuardDuty. Test in a sandbox OU first.
  - question: Is an account CloudTrail enough?
    answer: No. A per-account trail misses management-account activity and is easy to disable with the same credentials that caused the incident. Use an organization trail, multi-region, log-file validation, a dedicated log-archive account, and a bucket policy that denies delete and public access from every other principal.
  - question: Where does this sit versus attack-path tools?
    answer: This page is the AWS control plane you should already have. Ranking which leftover finding is reachable is [how to prioritize cloud vulnerabilities](/blog/how-to-prioritize-cloud-vulnerabilities/) and [attack path analysis](/blog/attack-path-analysis-cloud-security/).
---

This is the **AWS organization control-plane** checklist: Identity Center, SCPs, org CloudTrail, and public-access blocks. It is not a multi-cloud CSPM overview, not an IAM-theory primer ([CIEM](/blog/ciem-explained-for-cloud-teams/)), and not how to score CVEs. Official behavior stays in [AWS Organizations](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_introduction.html) and [IAM Identity Center](https://docs.aws.amazon.com/singlesignon/latest/userguide/what-is.html).

```
Management account (no workloads)
  └── Root OU
        ├── Security OU     log-archive, audit, GuardDuty delegated admin
        ├── Sandbox OU      SCP test denials live here first
        └── Workloads OU    prod / nonprod accounts
```

If a control is missing at the **org** layer, every account-level “best practice” is optional for the next engineer with `AdministratorAccess`.

## 1. Management account is not a place to run apps

Workloads in the management account skip SCPs. Billing, Organizations, and Control Tower live there; CI, Jenkins, and “temporary” EC2 do not.

Failure mode: a CloudFormation stack in the management account with an instance profile that can `organizations:LeaveOrganization` or disable the org trail. Move the stack. Do not “SCP around it.”

## 2. Humans use Identity Center, not IAM users

Create IAM users only for break-glass, with hardware MFA, no access keys, and CloudTrail alerts on `CreateAccessKey` and `ConsoleLogin` without MFA.

```bash
# Find IAM user access keys that are still active (every account)
aws iam list-users --query 'Users[].UserName' --output text | tr '\t' '\n' | while read -r u; do
  aws iam list-access-keys --user-name "$u" --query 'AccessKeyMetadata[?Status==`Active`].[UserName,AccessKeyId,CreateDate]' --output table
done
```

Map permission sets to **job functions**, not to `AdministratorAccess`. Permission boundaries on the Identity Center provisioned roles cap what a delegated admin can grant in member accounts.

Failure mode: Identity Center is on, but developers still have long-lived keys in `~/.aws/credentials` from an old IAM user. Inventory keys; disable; delete. SSO sessions expire. Keys do not.

## 3. SCPs that deny, in a sandbox OU first

An SCP is **not** “IAM but for the org.” Effects:

| Rule | What it means |
| --- | --- |
| No SCP on management account | Root and management IAM still win |
| Allow statements are a ceiling | Member IAM cannot exceed the SCP |
| Explicit Deny wins | Use Deny + conditions, then test |
| Service-linked roles | Often exempt; do not assume they are blocked |

Example: deny creating IAM users in workload accounts (force Identity Center), except a named break-glass role:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyIamUsersOutsideBreakGlass",
      "Effect": "Deny",
      "Action": ["iam:CreateUser", "iam:CreateAccessKey"],
      "Resource": "*",
      "Condition": {
        "ArnNotLike": {
          "aws:PrincipalARN": "arn:aws:iam::*:role/BreakGlassAdmin"
        }
      }
    }
  ]
}
```

Attach to the **sandbox OU**, try to `iam:CreateUser`, then promote to workloads. A Deny on `iam:*` without exceptions will also break Auto Scaling, EKS node roles, and Config.

Pair with [toxic combinations](/blog/toxic-combinations-aws-azure/) only after these denials exist; otherwise the graph is ranking holes you already chose to leave open.

## 4. Public access is an org setting, not a ticket

Account-level **S3 Block Public Access** and the org-level equivalent beat bucket-by-bucket heroics.

```bash
aws s3control get-public-access-block --account-id "$ACCOUNT_ID"
aws s3control put-public-access-block --account-id "$ACCOUNT_ID" --public-access-block-configuration \
  'BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true'
```

Same idea for EC2: an SG with `0.0.0.0/0` on 22/3389/5432 is a path, not a “medium.” Use AWS Config `restricted-ssh` plus a periodic query of default VPCs that nobody owns.

Failure mode: BPA is on, but a CloudFront OAC or a website bucket needs a controlled exception. Document the bucket, the principal, and an expiry. An exemption with no owner is a public bucket with extra steps.

## 5. Organization CloudTrail, or you will not have a forensic trail

Requirements that actually survive an incident:

1. **Organization trail**, all regions, management events + data events for S3 and Lambda you care about.
2. Destination bucket in a **log-archive account**, versioning, Object Lock if you can afford it, bucket policy denying `s3:DeleteObject` except a break-glass role.
3. **Log file validation** enabled.
4. Delegated **GuardDuty** and **Security Hub** admin in the security OU—not twenty independent detectors.

Failure mode: “CloudTrail is enabled” in the member account console, writing to a bucket in the same account the attacker already has `s3:DeleteObject` on. That is not a trail.

## 6. Encryption that is more than a checkbox

KMS on EBS/RDS/S3 is table stakes. The failure is **who can use the key**.

- Default `aws/s3` CMK: convenient; any principal with `s3:*` in the account can decrypt.
- CMK key policy: only the app role and a security admin role; no `kms:*` for `arn:aws:iam::ACCOUNT:root` unless you know why.
- Secrets in Lambda env vars: still in the console and in traces. Secrets Manager or SSM with IAM on `GetSecretValue`, not `Process.env`.

## What not to do on this page

Do not start with a 400-control CIS spreadsheet. Do not buy a scanner to discover that the management account runs Jenkins. Do not treat GuardDuty “low” findings as the program.

When the org layer is in place, leftover findings belong in [prioritization](/blog/how-to-prioritize-cloud-vulnerabilities/)—exposure and identity first, CVSS last.

## Checklist

- [ ] Workloads out of the management account
- [ ] Identity Center for humans; IAM users = break-glass only; no standing access keys
- [ ] SCPs tested in sandbox OU; Deny for `CreateUser` / public S3 / leave-org
- [ ] Account (and org) S3 Block Public Access
- [ ] Organization CloudTrail to a locked log-archive account
- [ ] GuardDuty / Security Hub delegated admin
- [ ] CMK policies that are not “account root can kms:*”

## Key takeaways

- **Org topology** is the control. Account-level checklists fail if SCPs never apply.
- **Identity Center + Deny SCPs** beat hunting IAM users after the fact.
- **Org CloudTrail to another account** is the difference between IR and folklore.
- **Public access blocks** are cheaper than any graph query on a public bucket.

---
**Related:** [Toxic combinations in AWS and Azure](/blog/toxic-combinations-aws-azure/) · [CIEM explained](/blog/ciem-explained-for-cloud-teams/) · [Amazon RDS security](/blog/aws-rds-security-guide/) · [AWS Lambda security](/blog/aws-lambda-security-guide/)
