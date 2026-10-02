---
title: "SCP vs RCP Evaluation Order"
description: "AWS checks every explicit Deny before RCP and SCP Allows. RCPFullAWSAccess cannot be detached, so an RCP narrows access only with Deny — an identity Allow never skips that."
pubDate: 2026-10-02
updatedDate: 2026-10-02
author: OpenSourceOM Team
tags:
  - AWS
  - Organizations
  - SCP
  - RCP
  - IAM
focusKeyword: SCP RCP evaluation order
faq:
  - question: Does AWS evaluate SCPs before RCPs?
    answer: >-
      No. The enforcement code first looks for an explicit Deny in every
      applicable policy, including both SCPs and RCPs. Only if none match
      does it require an Allow in RCPs, then an Allow in SCPs, then
      identity and resource policies. An Allow in an SCP does not skip
      an RCP Deny.
  - question: Can an RCP Allow replace RCPFullAWSAccess and narrow the account?
    answer: >-
      No. When you enable RCPs, AWS attaches RCPFullAWSAccess and does not
      let you detach it, so the RCP Allow step always succeeds. A second
      RCP that only Allows s3:GetObject does not remove the pass-through
      Allow. Narrowing is a Deny statement, and that Deny is decided in
      the first step.
  - question: Why does a bucket-account SCP fail to stop another account?
    answer: >-
      SCPs apply to principals in the account where the SCP is attached.
      A caller in a different account is not that principal. The bucket
      account's RCP still applies, because RCPs apply to the resource.
      A bucket policy Principal of that other account does not skip the
      RCP Deny.
---

An identity policy Allows `s3:GetObject`. The bucket policy Allows the same role. SCP `FullAWSAccess` is attached. The call still returns `AccessDenied`, and the CloudTrail `errorMessage` mentions an Organizations policy. The statement that matched is an RCP `Deny`. It was decided **before** any of those Allows were consulted.

**SCP vs RCP evaluation order** is that sequence. Which policy type attaches to principals vs resources is [AWS resource control policies](/blog/aws-resource-control-policies-rcp/). This page is only the order the enforcement code walks. Official sequence: [How AWS evaluates requests to allow or deny](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic_policy-eval-denyallow.html).

## The sequence

For a request evaluated in an account that is an Organizations member:

1. **Explicit Deny.** Every applicable policy is scanned for a `Deny` that matches the request: SCPs, RCPs, identity-based policies, resource-based policies, permissions boundaries, session policies. One match is a final Deny. Evaluation stops.
2. **RCP Allow.** If RCPs are enabled, some RCP statement must Allow the action. `RCPFullAWSAccess` is attached to the root, every OU, and every account, and AWS does not let you detach it, so this step finds an Allow. A custom RCP Allow is redundant with that pass-through.
3. **SCP Allow.** Some SCP statement must Allow the action. `FullAWSAccess` is the usual pass-through. Unlike `RCPFullAWSAccess`, the SCP managed policy **can** be detached. If nothing else Allows, this step is a final Deny.
4. **Resource-based policy, then identity-based policy.** In the same account, an Allow in either is enough for most services. IAM role trust policies and KMS key policies still need their own Allow. An implicit deny in the identity policy does not cancel a resource-policy Allow granted directly to the IAM user or to the role-session ARN.
5. **Permissions boundary.** When the Allow came from an identity policy, the boundary must Allow the action too. A resource-policy Allow granted directly to the IAM user or the role-session ARN is not limited by a missing Allow in the boundary. An explicit Deny in the boundary already finished the request in step 1.
6. **Session policy.** If the caller passed a session policy and it does not Allow the action, final Deny. No session policy means this step Allows. The same direct resource-policy grant to a role-session ARN is not limited by an implicit deny in the session policy.

```
request
  → any explicit Deny?     stop, Deny
  → RCP Allow present?     else Deny   (RCPFullAWSAccess always is)
  → SCP Allow present?     else Deny
  → identity or resource Allow
  → boundary Allow
  → session Allow
  → Allow
```

There is no “closest policy wins,” and a child OU Allow does not outrank a parent Deny. The parent Deny already matched in step 1.

## What an RCP can actually change

Because step 2 always sees `RCPFullAWSAccess`, an RCP changes the decision only by matching a **Deny in step 1**.

| What you attach | What the order does with it |
| --- | --- |
| RCP `Deny` on `s3:*` unless `aws:PrincipalOrgID` matches | Step 1. Final Deny for callers the condition catches. Later Allows are not read. |
| RCP `Allow` of only `s3:GetObject` | Step 2 still passes via `RCPFullAWSAccess`. Other S3 actions stay allowed if IAM allows them. |
| SCP `Deny` of `iam:CreateUser` | Step 1. Final Deny. An AdministratorAccess identity policy is not consulted. |
| SCP `Allow` of only `ec2:*` and `s3:*`, with `FullAWSAccess` detached | Step 3. Actions outside that Allow are a final Deny. |
| Identity `Allow` of `s3:*` | Reached only if steps 1–3 did not already Deny. |

A sandbox test that “proves” the RCP Allow list works is usually proving that `RCPFullAWSAccess` is still attached. Detach is not available. The test that matters is an explicit Deny from a principal the condition should catch, and a success from a principal it should not.

The condition operators on that Deny are evaluated inside step 1, not after IAM. `StringNotEqualsIfExists` does not match when the key is absent, so that Deny statement does not apply and evaluation continues. That is a different bug from order; the statement shape is in the [RCP vs SCP](/blog/aws-resource-control-policies-rcp/) page. A Deny that **does** match is never undone by an Allow later in the list.

## External callers

SCPs apply to **principals in the account where the SCP is attached**. RCPs apply to **resources in the account where the RCP is attached**.

A caller in account B, reading a bucket in account A:

- Account A’s SCPs do not apply to B’s principal. An SCP Deny in A is invisible to this request.
- Account A’s RCPs do apply. A matching RCP Deny is step 1 in A and is final.
- Account A’s bucket policy is the resource-based policy. Its Allow does not skip the RCP Deny.
- Account B still evaluates B’s own SCPs and B’s identity policy on the way out. B’s SCP Allow does not skip A’s RCP Deny.

Same-account evaluation and cross-account evaluation are different flows. The cross-account diagram is [Cross-account policy evaluation](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic-cross-account.html). The practical rule on this page: a resource policy `Principal` of another account is not evidence that the resource account’s SCP ran, and it is not evidence that the RCP did not.

Service-linked roles skip SCPs and RCPs. A Deny that “should” have caught CloudTrail and did not is often that skip, not a reordering. The service-principal condition belongs on the Deny statement itself.

## Two tests

Run both in a sandbox OU before the Deny moves anywhere else. There is no RCP audit mode.

1. **In-org role that IAM allows.** `s3:GetObject` succeeds. If it fails, the Deny condition is matching principals you meant to keep (org id typo, missing service-principal exception).
2. **Principal outside the org** whose bucket policy Allows them. `s3:GetObject` is `AccessDenied`. If it succeeds, the RCP Deny did not match. The bucket account’s SCP was never going to be the control that failed.

CloudTrail in the bucket account shows the denied call. The identity policy in the caller account will still look correct. That is what step 1 looks like from the outside.

Failure mode: debugging for a day inside the role’s permission boundary because the boundary is step 5 and the RCP already finished at step 1. Read `errorMessage` for the Organizations policy id before editing IAM.

## Checklist

- [ ] RCP statements that are meant to constrain are `Deny`. An RCP `Allow` list is not a ceiling while `RCPFullAWSAccess` is attached
- [ ] SCP `FullAWSAccess` detached only when another SCP Allow covers every action you intend to keep
- [ ] External-account `GetObject` test fails; in-org app role `GetObject` succeeds
- [ ] Parent OU Deny tested from a child account. A child Allow did not change the result
- [ ] Service-linked roles and `aws:PrincipalIsAWSService` checked against CloudTrail delivery, not assumed from the order
- [ ] Access Analyzer or the IAM policy simulator used with the Organizations policies included. A simulator run that omits RCPs will show Allow

**Related:** [AWS resource control policies](/blog/aws-resource-control-policies-rcp/) · [AWS security best practices](/blog/aws-security-best-practices-2026/) · [Attack path analysis](/blog/attack-path-analysis-cloud-security/)
