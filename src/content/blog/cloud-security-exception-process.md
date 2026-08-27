---
title: "A Cloud Security Exception Process That Expires"
description: "A cloud security exception process with owners, expiry, and compensating controls—time-boxed IAM and security groups, plus Policy exemptions that actually end."
pubDate: 2026-08-27
updatedDate: 2026-08-27
author: OpenSourceOM Team
tags:
  - exception management
  - cloud governance
  - Azure Policy
  - AWS SCP
  - IAM
focusKeyword: cloud security exception process
faq:
  - question: Should every CSPM finding get an exception ticket?
    answer: >-
      No. Exceptions are for controls you have chosen to violate for a stated
      period. Noise, false positives, and "we will patch next quarter" are
      backlog. If the control is still in force, the finding stays open. If
      you cannot name the compensating control, it is not an exception.
  - question: What is the maximum length of a security group or IAM exception?
    answer: >-
      Default 30 days, hard cap 90 unless a director signs a named residual
      risk. Standing 0.0.0.0/0 and standing AdministratorAccess are not
      exceptions; they are architecture. Break-glass IAM should be hours, not
      a quarter.
  - question: Can we encode the exception only in the ticket tracker?
    answer: >-
      Tickets rot. Azure Policy exemptions have expiresOn. AWS IAM Conditions
      have DateLessThan. GCP IAM Conditions have request.time. Prefer those
      plus a ticket id in a tag. A Jira ticket with no cloud object that
      enforces expiry is a wiki.
  - question: Who sits on the review queue?
    answer: >-
      The control owner (platform or security), not the requestor. Requestors
      may attend. Auto-approve after SLA is how 0.0.0.0/0 lives for a year.
      Expired exceptions reopen the original finding automatically.
---

The ticket said "temporary vendor access" and was fourteen months old. The security group still had `0.0.0.0/0:22`. The exception process had a form. It did not have an **end**.

A **cloud security exception process** is the workflow that grants a *dated* deviation from a control you still believe in. It is not a parking lot for findings you will never fix. Azure Policy exemptions and AWS sandbox SCPs are how you encode expiry in the platform; this page is the human and ticket shape around them. Enablement of Defender/MCSB is [Azure CSPM](/blog/azure-cspm-implementation-guide/). Org SCPs belong in [AWS security best practices](/blog/aws-security-best-practices-2026/).

```
request (resource id, control, expiry, compensating control)
  → review (control owner)
       → encode in Policy / IAM condition / SG tag
            → calendar: T-7d nag, T-0 revoke or re-review
                 → if still needed: new ticket, new expiry, same residual risk text
```

If step three is "comment on the Jira," you do not have a process.

## Ticket fields that matter

Refuse the ticket that is only a control name and a hope.

| Field | Example | Why |
| --- | --- | --- |
| Resource id | `/subscriptions/…/securityGroups/sg-vendor` or `sg-0abc` | CSPM must match this, not "the API vpc" |
| Control id | MCSB `Network/NSG` or SCP sid `DenyPublicS3` | So expiry reopens the right finding |
| Requestor + owner | App PM + platform on-call | Owner is paged when it expires, not the intern who filed it |
| Expiry | ISO date, ≤ 90 days | No "until project ends" |
| Compensating control | Vendor IP allow-list + SSM, not 22/world | If empty, deny |
| Residual risk | "RDP from internet, no MFA jump host" | Reviewers sign *this* sentence |
| Ticket id in cloud | Tag `exception:SEC-4412` | Hunt orphans |

Optional but useful: path context—"this SG is on an internet-facing NLB" versus "isolated debug subnet." That is the same instinct as [toxic combinations](/blog/toxic-combinations-aws-azure/), not a novel scoring system.

Failure mode: one ticket covering "all sandbox subscriptions." Encode per resource or per well-named sandbox OU/MG, not a blanket.

## Time-boxed IAM and SG exceptions

**Security groups / NSGs / firewall rules**

- Prefer a prefix list or named set of vendor CIDRs over `0.0.0.0/0`
- Tag `expires:2026-09-15` and a Config / Azure Policy / Cloud Asset rule that flags tags in the past
- AWS: do not "exception" an org-level Deny SCP by removing the SCP. Put the workload in a **sandbox OU** where the deny is weaker, with account expiry (Control Tower / account vending), as in the [AWS org checklist](/blog/aws-security-best-practices-2026/)

```bash
# Orphans: SGs with an expiry tag in the past (illustrative)
aws ec2 describe-security-groups --query \
  'SecurityGroups[?Tags[?Key==`expires`]].{id:GroupId,expires:Tags[?Key==`expires`].Value|[0]}' \
  --output table
```

**IAM**

| Cloud | Time-box mechanism | Footgun |
| --- | --- | --- |
| AWS | IAM Condition `DateLessThan` / `aws:CurrentTime`; Identity Center permission set duration; STS max session | Condition on the role but not on a second attached policy |
| Azure | PIM eligible activation (hours); Policy exemption `expiresOn` | Eligible standing at Owner on the MG |
| GCP | IAM Condition `request.time < timestamp(...)` | Condition on one binding while `roles/editor` remains elsewhere |

Break-glass: a role that can be assumed only with MFA, logged, and alerted—session hours, not a week-long access key.

Failure mode: exception grants `AdministratorAccess` "because the vendor installer said so." Grant `iam:PassRole` on one role or `s3:PutObject` on one prefix. If the installer cannot work without admin, the installer is the finding.

## Review queue

A weekly 30-minute queue beats a monthly architecture review.

1. **Expiring in 7 days** — owner must close, extend (new ticket), or let the control snap back
2. **Expired, still open in cloud** — page the owner; auto-revert if you have automation (Policy exemption delete, SG rule revoke)
3. **Older than 90 days** — director review or treat as accepted risk in the risk register, *not* as a security exception

Do not auto-extend. Auto-extend is how fourteen months happens.

The queue is owned by security/platform. App teams may comment. Metrics that belong on this queue: count of active exceptions, median age, percent auto-reverted on expiry. Board-level versions of those numbers are a different artifact.

Failure mode: the queue is a Slack channel with no ticket ids. You cannot join CSPM to chat.

## Encoding exemptions in Policy

Tickets without a platform object are wishes.

**Azure Policy:** exemptions are first-class. [Azure CSPM](/blog/azure-cspm-implementation-guide/) already says MCSB assignments at the management group and exemptions with `expiresOn`. Operational rules:

- Exemption category `Waiver` with a ticket id in `metadata`
- Scope as narrow as the resource or resource group, not the subscription "for convenience"
- `expiresOn` required; a Policy initiative that forbids exemptions without it (custom policy) if your tenant supports that discipline
- Sandbox MG: exemptions allowed; landing-zone MG: exemptions rare and dated

**AWS Organizations:** do not poke holes in a Deny SCP that covers prod OUs. Vending a sandbox account/OU with a weaker SCP is the exception. Resource Control Policies and SCPs are org-wide hammers; exceptions belong in IAM conditions and account placement.

**GCP org policy:** constraints with tags or a dedicated folder for experiments; IAM Conditions for time. Do not leave `allUsers` on a bucket because a ticket exists.

**Kubernetes:** Kyverno/Gatekeeper exceptions are namespaces or labels with expiry annotations your controller actually reads. A commented-out Constraint is not an exception.

When the exemption object exists, CSPM should **suppress** the finding until expiry, then **reopen**. If your scanner cannot honor Azure `expiresOn`, your exception process and your CSPM are two different truths.

## Checklist

- [ ] Ticket requires resource id, control id, owner, expiry ≤ 90 days, compensating control
- [ ] Cloud object enforces expiry (Policy exemption, IAM Condition, SG tag + detector)
- [ ] Sandbox OU/MG for SCP/Policy experiments—not holes in prod Deny
- [ ] Weekly queue of T-7d and expired-but-live exceptions
- [ ] No auto-extend; IAM admin and 0.0.0.0/0 never standing
- [ ] CSPM suppression keyed to the same ticket id and expiry

**Related:** [Azure CSPM implementation](/blog/azure-cspm-implementation-guide/) · [AWS security best practices](/blog/aws-security-best-practices-2026/) · [Toxic combinations in AWS and Azure](/blog/toxic-combinations-aws-azure/)
