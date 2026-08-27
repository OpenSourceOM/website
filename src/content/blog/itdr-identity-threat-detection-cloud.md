---
title: "ITDR in the Cloud: Detecting Identity Attacks on IAM"
description: "ITDR cloud identity is runtime detection of stolen roles and tokens—not CIEM hygiene. CloudTrail signals that beat impossible travel, AssumeRole theft patterns, and wiring alerts to blast radius."
pubDate: 2026-08-27
updatedDate: 2026-08-27
author: OpenSourceOM Team
tags:
  - ITDR
  - IAM
  - cloud identity
  - threat detection
  - CloudTrail
focusKeyword: ITDR cloud identity
faq:
  - question: Is GuardDuty IAM findings the same as ITDR?
    answer: >-
      GuardDuty IAM and S3 protection are useful detectors (CredentialExfiltration,
      AnomalousBehavior, Stealth). ITDR cloud identity is the program around those
      detectors: which AssumeRole and token events you keep, how you suppress VPN
      noise, and whether the alert includes what that principal can still reach.
      GuardDuty alone is a feed, not a response loop.
  - question: Why is impossible travel a weak IAM signal?
    answer: >-
      SSO and IdP geolocation lag, split tunnels, mobile carriers, and CloudFront or
      NAT egress make two cities in ten minutes common for a single human. Stolen
      instance-profile keys used from a residential ASN, or a role session that
      suddenly calls iam:CreateAccessKey, are tighter. Treat geo as enrichment, not
      the page-the-oncall rule.
  - question: What CloudTrail events should ITDR watch first?
    answer: >-
      AssumeRole, AssumeRoleWithSAML, GetSessionToken, GetFederationToken,
      CreateAccessKey, ConsoleLogin without MFA, and UpdateAssumeRolePolicy on
      roles that production workloads can assume. Pair each with sourceIPAddress,
      userAgent, and whether the principal was an instance or a human session.
  - question: How does ITDR use a security graph?
    answer: >-
      The detection names the principal. The graph answers blast radius: datastores
      that principal can read, roles it can assume next, and whether the session
      started on an internet-facing workload. See attack path analysis and the graph
      model. Without that join, ITDR is another SIEM rule with a role ARN in the
      title.
---

A CloudTrail record with `"eventName": "AssumeRole"` and a `sourceIPAddress` that is not the VPC NAT, not the corporate egress, and not AWS is the start of **ITDR cloud identity**—not a CIEM ticket about `AdministratorAccess` sitting unused.

This page is **detection and response on IAM sessions**: stolen instance credentials, rogue access keys, and role chaining that already happened. Entitlement hygiene (who *can* do what) is [CIEM](/blog/ciem-explained-for-cloud-teams/). Ranking leftover posture is [how to prioritize cloud vulnerabilities](/blog/how-to-prioritize-cloud-vulnerabilities/).

```json
{
  "eventName": "AssumeRole",
  "userIdentity": {
    "type": "AWSService",
    "invokedBy": "ec2.amazonaws.com"
  },
  "sourceIPAddress": "203.0.113.40",
  "requestParameters": {
    "roleArn": "arn:aws:iam::111122223333:role/payments-api"
  }
}
```

If `payments-api` is an instance profile, that IP should be the instance, a VPC endpoint, or AWS. A coffee-shop ASN is credential theft until proven otherwise.

## ITDR vs CIEM

| | CIEM | ITDR |
| --- | --- | --- |
| Question | What *could* this principal do? | What *did* a session just do that is wrong? |
| Data | IAM policy, last-used, trust | CloudTrail, IdP, GuardDuty, VPC flow |
| Time | Standing entitlement | Minutes after AssumeRole / token use |
| Typical output | Shrink this policy | Isolate this session, rotate this key |

CIEM without ITDR leaves a perfectly right-sized role whose **stolen session** still reads production. ITDR without CIEM pages you on every `sts:AssumeRole` because you never learned which roles are supposed to be assumed from which networks.

Do not merge the queues. A “unused admin role” finding is a sprint item. A `CreateAccessKey` on a break-glass user at 03:00 is an incident.

## Signals (impossible travel is not enough)

Impossible travel on console or SSO is the default vendor demo. It fires on split-tunnel VPN, roaming LTE, and IdP geo that still thinks the user is in the office POP.

Prefer **session contradiction** over geography:

| Signal | Why it is tighter than geo |
| --- | --- |
| Same access key from `i-` / instance metadata path, then from a non-VPC public IP | Keys never leave the instance unless copied |
| `GetSessionToken` then IAM mutating APIs (`CreateUser`, `AttachUserPolicy`) | Humans with MFA should not mint long-lived keys from automation roles |
| `AssumeRole` chain longer than your documented hop (A→B→C) | Attackers lengthen chains to land in a role with data access |
| `userAgent` switches from `aws-cli` / SDK to `Boto3` from a laptop UA mid-session | Stolen env vars pasted into a workstation |
| MFA device removed, then `ConsoleLogin` success | Account takeover, not travel |

Enrich every alert with `recipientAccountId`, `sessionIssuer`, `accessKeyId`, and VPC-or-not. Drop alerts that match a known NAT or [VPC endpoint](/blog/aws-security-best-practices-2026/) for that role’s allowed network—if you have that allow-list. If you do not, ITDR will drown in `AssumeRole` from autoscaling.

Failure mode: a detection that keys only on `errorCode = AccessDenied`. Attackers who already have the role succeed. Watch **successful** unusual use.

## AssumeRole / token theft patterns

**Instance metadata → API from elsewhere.** SSRF or a debug container dumps `iam/security-credentials/role-name`. The attacker calls S3 or STS from a VPS. IMDSv2 plus hop limit 1 cuts the steal; ITDR still needs the “credentials used off-box” rule for the instances you have not hardened.

**SSO / OIDC session reuse.** A stolen refresh token or a hijacked browser cookie issues `AssumeRoleWithSAML` or Identity Center role sessions from a new ASN while the laptop is asleep. Pair IdP risk (impossible *device*, not just city) with AWS `userIdentity.sessionContext`.

**Long-lived IAM user keys.** `CreateAccessKey` on a user that is supposed to be Identity Center only is both a CIEM smell and an ITDR event. Alert on the **create**, then on first use from an IP the user has never used.

**Lambda / ECS task role exfil.** The role never logs in. If `sourceIPAddress` is not AWS Lambda / the task ENI / the VPC endpoint for the API being called, treat it as stolen environment credentials.

```bash
# Last 24h AssumeRole for one role — inspect sourceIPAddress and userAgent
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=ResourceName,AttributeValue=payments-api \
  --max-results 50 \
  --query 'Events[?contains(CloudTrailEvent, `AssumeRole`)].CloudTrailEvent' \
  --output text
```

`lookup-events` is a start, not a SIEM. Production ITDR needs an org trail in a log-archive account ([AWS security best practices](/blog/aws-security-best-practices-2026/)) and queries that join `accessKeyId` across events.

## Wiring detections to blast radius

An alert that stops at “anomalous AssumeRole on `payments-api`” forces the SOC to open the IAM console. Wire the detection to **what that principal can still reach**.

1. **Identity node:** role ARN, session name, account.
2. **Edges:** `CAN_ASSUME` next roles, `CAN_ACCESS` on S3/RDS/Secrets, pass-role into compute.
3. **Entry:** was the first hop an internet-facing workload? That is the [attack path](/blog/attack-path-analysis-cloud-security/) question, modeled in [the graph](/docs/the-graph/).

Response then has an order: revoke the **session** (deny on `aws:userid` or `sts:RoleSessionName` where you can, rotate keys, quarantine the instance profile) **before** you debate whether the role’s policy was too wide. CIEM cleanup is the follow-up ticket, not the containment step.

Open-source inventory that already has IAM and resource edges—[OpenSourceOM core](https://github.com/OpenSourceOM/core)—is the join key. Do not wait for a CNAPP SKU named ITDR to start that join.

Failure mode: auto-disabling the role that autoscaling still needs. Contain with a permission boundary or a session deny, not a 3 a.m. `DeleteRole`.

## Checklist

- [ ] Org CloudTrail (all regions) in a log-archive account the workload roles cannot delete
- [ ] Detections on successful AssumeRole / GetSessionToken / CreateAccessKey with source-IP contradiction—not geo-only
- [ ] Instance-profile roles: alert if credentials used outside the VPC / expected endpoint
- [ ] Documented max role-chain depth; alert on longer chains
- [ ] Each ITDR alert includes graph blast radius (data + next assume), not only the event name
- [ ] Containment runbook: session revoke / key disable first, policy shrink second
- [ ] CIEM unused-admin work stays on a different SLA than stolen-session pages
---
