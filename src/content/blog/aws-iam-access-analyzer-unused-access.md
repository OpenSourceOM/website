---
title: "IAM Access Analyzer Unused Access in Organizations"
description: "IAM Access Analyzer unused access is a paid org analyzer, not the free external-access findings. Delegated admin, service-linked noise, tracking-period traps, and turning findings into permission boundaries."
pubDate: 2026-08-27
updatedDate: 2026-08-27
author: OpenSourceOM Team
tags:
  - AWS
  - IAM
  - Access Analyzer
  - CIEM
  - Organizations
focusKeyword: IAM Access Analyzer unused access
faq:
  - question: Why did we get billed twice for unused access?
    answer: >-
      Unused access is charged per IAM user and role analyzed, per analyzer, per
      month. An analyzer in the management account plus another in the delegated
      administrator account both scan the organization. Create one organization
      unused-access analyzer in the delegated admin account only.
  - question: Are unused-access findings Regional?
    answer: >-
      No. External and internal access analyzers are Regional. Unused access
      findings do not change by Region; you do not need one unused analyzer per
      Region. You still need external-access analyzers in every Region where you
      have resources with resource policies.
  - question: Why is a role we created last month missing from unused findings?
    answer: >-
      The analyzer only evaluates entities that have existed for the full
      tracking period. A 90-day window ignores roles younger than 90 days.
      That is intentional. Catch over-granting on new roles with policy checks
      at create time, not with this analyzer.
  - question: Should I detach AWS managed policies the analyzer flags as unused?
    answer: >-
      Not on service-linked roles, and not by deleting AWSServiceRole* paths.
      For customer roles, unused permissions are a prompt to replace
      AdministratorAccess or PowerUserAccess with a scoped policy or a
      permission boundary—not a license to yank AWS managed policies from
      Lambda or ECS service-linked roles.
---

External Access Analyzer is free and tells you a bucket policy lets another account in. **IAM Access Analyzer unused access** is a different analyzer type: it watches IAM **users and roles** for unused roles, unused passwords, unused access keys, and unused permissions over a tracking period you choose (1–365 days). It is closer to [CIEM](/blog/ciem-explained-for-cloud-teams/) last-used than to CSPM.

This page is **org enablement and the findings that waste a quarter**. It is not a general IAM primer ([AWS security best practices](/blog/aws-security-best-practices-2026/)) and not how to rank a public resource ([how to prioritize cloud vulnerabilities](/blog/how-to-prioritize-cloud-vulnerabilities/)).

## External access vs unused access

| | External (and internal) access | Unused access |
| --- | --- | --- |
| Zone | Resource policies, public/`*` | IAM users and roles |
| Question | Who outside (or inside) the zone can use this resource? | What standing identity unused? |
| Regional? | Yes — enable per Region | No — one org analyzer is enough |
| Price | External: included | Per user/role per analyzer per month |
| Finding types | `ExternalAccess` / `InternalAccess` | `UnusedIAMRole`, `UnusedIAMUserAccessKey`, `UnusedIAMUserPassword`, `UnusedPermission` |

Create unused access with the organization as the selected scope, tracking period typically 90 days:

In the IAM console (delegated admin account): Access Analyzer → create analyzer → unused access → organization → tracking period. Or the Access Analyzer API `CreateAnalyzer` with type `ORGANIZATION_UNUSED_ACCESS` and unused-access age. Do not invent a second unused analyzer “for prod only” unless you like paying twice for the same roles.

External access still matters: a role can be **used daily** and still be assumable by a foreign account. Unused access will stay silent. Run both.

## Delegated analyzer admin

The management account can register a member as delegated administrator for Access Analyzer (`access-analyzer.amazonaws.com` in Organizations delegated services). That member creates **organization** analyzers so findings are not trapped in the management account.

Rules that burn people:

- **Changing the delegated admin disables** organization analyzers created in the old account. Findings in that account go dark until you point delegation back or the new admin **creates new analyzers**.
- The **management account** still sees org findings; do not also create unused analyzers there.
- Access Analyzer uses the service-linked role `AWSServiceRoleForAccessAnalyzer` in accounts it analyzes. Do not try to “least-privilege” that SLR.

Tag exclusions on unused analyzers (skip `access-analyzer:exclude=true` or your own key) are how you keep break-glass roles out of the ticket mill. Document the tag; otherwise every unused-role finding gets an exception in Jira instead.

## Findings that lie (service-linked)

**Unused permissions** are computed from identity-based policies versus last-accessed. Action-level coverage is only the services in IAM’s last-accessed list; everything else is service-level. A role that “never used `iam:PassRole`” might have used a subset the report cannot see.

**Service-linked roles** (`AWSServiceRoleFor*`, `/aws-service-role/`) ship with managed policies sized for the worst-case AWS service. They will show unused actions forever. Do not “right-size” an SLR. Archive those findings with a rule on path prefix.

Other liars:

- **Automation roles** used every 91 days (quarterly job) with a 90-day window
- **SSO permission sets** provisioned as roles that look unused in accounts nobody logs into—but `AdministratorAccess` is still standing
- **Roles younger than the tracking period** — absent, not healthy
- **Unused IAM user password** on a user that only uses access keys (still delete the password)

Filter in the analyzer or in your ticketing join: `findingType = UnusedPermission` AND `resource` not like `aws-service-role`. What remains is [CIEM](/blog/ciem-explained-for-cloud-teams/) work.

```bash
aws accessanalyzer list-findings \
  --analyzer-arn arn:aws:access-analyzer:us-east-1:111122223333:analyzer/unused-org \
  --filter '{"findingType":[{"eq":["UnusedIAMRole"]}]}'
```

Region in the ARN is the analyzer’s home Region; unused findings are still org-global.

## From finding to permission boundary

Do not start by deleting the role. Order:

1. **UnusedIAMUserAccessKey / Password** — disable, wait, delete. Humans should be on Identity Center anyway.
2. **UnusedIAMRole** — confirm no trust from a service you forgot (EventBridge, IdP). Then delete or deny `sts:AssumeRole` in a sandbox first.
3. **UnusedPermission** on a customer role that attaches `AdministratorAccess` or a 4k-line inline policy — attach a **permissions boundary** that is the *intended* ceiling (e.g. no `iam:*`, no `organizations:*`, no `s3:PutBucketPolicy`), then shrink the identity policy in a second PR.

A boundary is the intersection with identity policy. It survives the next engineer attaching `PowerUserAccess` “temporarily.” SCPs remain the org ceiling; boundaries are per-role ([AWS security best practices](/blog/aws-security-best-practices-2026/) for SCP vs management account).

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "BoundaryNoIamEscalation",
      "Effect": "Allow",
      "Action": [
        "s3:*",
        "logs:*",
        "cloudwatch:*",
        "ec2:Describe*"
      ],
      "Resource": "*"
    }
  ]
}
```

Attach as the role’s permissions boundary, not as the identity policy. The unused-permission finding should then track the **effective** set. Re-run after the boundary exists; many `UnusedPermission` rows die because last-accessed never included `iam:CreateUser` you just made impossible.

Graph context ([the graph](/docs/the-graph/), [OpenSourceOM](https://github.com/OpenSourceOM/core)): an unused admin role with a trust policy from the internet is not an unused-access cleanup—it is an [attack path](/blog/attack-path-analysis-cloud-security/) even at zero last-used. Last-used is not reachability.

## Checklist

- [ ] One org unused-access analyzer in the delegated admin account; none in management
- [ ] External-access analyzers still exist in every active Region
- [ ] Tracking period matches how often break-glass and quarterly jobs run
- [ ] Tag exclusions for true break-glass; SLRs archived, not “fixed”
- [ ] Unused keys/passwords disabled then deleted; users moved to Identity Center
- [ ] Customer admin roles: permission boundary first, identity policy shrink second
- [ ] Unused + assumable from outside the org treated as a path, not a hygiene ticket
---
