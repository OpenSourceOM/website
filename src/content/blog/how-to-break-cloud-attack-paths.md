---
title: "How to Break a Cloud Attack Path (Without Patching Everything)"
description: "Break a cloud attack path by cutting the cheapest edge—network, identity, or exposure—then prove the path is gone without a production outage."
pubDate: 2026-08-27
updatedDate: 2026-08-27
author: OpenSourceOM Team
tags:
  - attack path analysis
  - remediation
  - reachable risk
  - IAM
  - network security
focusKeyword: break cloud attack path
faq:
  - question: If I patch the CVE, is the attack path gone?
    answer: >-
      Only the AFFECTS edge for that CVE is gone. Internet REACHABLE to the workload and
      CAN_ACCESS from its role remain. The next CVE on the same task reconstitutes the
      path. OpenSourceOM will drop that finding and still return the walk if you query
      from Internet to the datastore without filtering on the CVE id.
  - question: How do I pick which hop to cut when the graph shows five?
    answer: >-
      Cost is blast to availability versus blast to security. Closing 0.0.0.0/0 on an
      admin port is usually cheapest. Removing s3:GetObject from a task role is cheap if
      the app already uses a scoped prefix. Replacing an ALB with a private one is
      expensive. Do not start with a mesh rebuild. Rank hops by "minutes to apply" and
      "can we roll back with the previous SG revision."
  - question: What query proves the path is gone?
    answer: >-
      Re-run the same MATCH OpenSourceOM used to open the ticket, after collectors sync,
      and assert zero rows. Also prove the intended cut with the cloud API (describe-sg,
      simulate-principal-policy, az network nsg rule show). If the graph is empty but
      simulate-principal-policy still allows s3:GetObject on the prod bucket, the path
      is not gone—the collector is stale or the resource policy is invisible.
  - question: When is a network cut the wrong cut?
    answer: >-
      When the app must be internet-facing (a public API) and the dangerous hop is the
      identity. Cutting REACHABLE would be an outage. Cut CAN_ASSUME/CAN_ACCESS instead:
      IRSA role without s3:*, no PassRole, no admin-equivalent. Exposure cuts (public
      bucket, public snapshot) are right when the data never needed to be public.
---

An attack path is a **chain of edges**. Remediation is **deleting one edge** so a bounded walk from `Internet` (or from a compromised workload) to the crown jewel returns no rows. You do not need every CVE on the chain closed. OpenSourceOM’s job after the change is to **fail the same MATCH**. The model is [attack path analysis](/blog/attack-path-analysis-cloud-security/); ranking which path to break this week is [reachable risk](/blog/reachable-risk-cloud-security/). This page is **which verb to delete**.

```
Internet --REACHABLE--> Workload --AFFECTS--> CVE
                              --ASSUMES--> Identity --CAN_ACCESS--> Data

Cut any one of:  REACHABLE | ASSUMES | CAN_ACCESS | (exposure on Data)
AFFECTS/CVE is the slowest, least durable cut
```

## Identify the cheapest edge to cut

List the hops OpenSourceOM returned. Score each hop on **time to apply**, **blast to availability**, and **whether the attacker needs it**.

| Hop example | Typical cost | Durability |
| --- | --- | --- |
| SG/NSG `0.0.0.0/0` on 22/3389/5432 | Minutes, high security value | High if SCP/Azure Policy denies reopen |
| Public bucket / public snapshot | Minutes if nothing legitimate reads anonymous | High |
| IRSA/WI annotation pointing at admin role | Minutes to point at a scoped role; app may 403 | High |
| `s3:*` on the task role | Minutes–hours (app testing) | High |
| Patch CVE (AMI, image, library) | Hours–weeks, patch trains | Low (next CVE) |
| Replace public ALB with private + IAP | Days, DNS, clients | High |
| Re-architect mesh / new accounts | Sprints | High |

Cheapest durable cut wins. OpenSourceOM does not pick it for you; it names the verbs. Prefer a cut you can **guardrail** (SCP, org policy, admission) so the edge cannot be redrawn tomorrow.

Failure mode: cutting the CVE because the ticket came from a scanner export, while hop 1 is `0.0.0.0/0:22`. You spent a patch cycle to leave SSH open.

## Network cuts vs identity cuts vs exposure cuts

**Network cuts** delete `REACHABLE`. Tighten the SG/NSG to the ALB SG or to the app SG, not to the VPC CIDR. Remove public IPs that exist only for convenience. For Kubernetes, a default-deny NetworkPolicy can delete east-west `REACHABLE` that the cloud SG never saw—[cloud-native application security](/blog/cloud-native-application-security/) covers the app pattern; here you only need the edge gone.

```
# AWS: replace 0.0.0.0/0:443 with the ALB SG
aws ec2 revoke-security-group-ingress --group-id sg-app \
  --protocol tcp --port 443 --cidr 0.0.0.0/0
aws ec2 authorize-security-group-ingress --group-id sg-app \
  --protocol tcp --port 443 --source-group sg-alb
```

Failure mode: revoking `0.0.0.0/0` and authorizing `10.0.0.0/8`. You traded Internet for “every compromised host in the RFC1918 estate.” OpenSourceOM will still walk `REACHABLE` from the jump host.

**Identity cuts** delete `ASSUMES` / `CAN_ASSUME` / `CAN_ACCESS`. Remove the IRSA annotation, split the role, drop `iam:PassRole` on `*`, replace Azure `Contributor` on the subscription with a RG-scoped built-in. This is the right family when the workload **must** stay internet-facing. [Blast radius analysis](/blog/blast-radius-analysis-cloud-iam/) is the walk; the cut is detaching the admin-equivalent actions.

```
# Prove the identity cut on AWS after attach-policy change
aws iam simulate-principal-policy \
  --policy-source-arn arn:aws:iam::111111111111:role/payments-task \
  --action-names s3:GetObject \
  --resource-arns arn:aws:s3:::prod-pii/*
# Expect implicitDeny
```

Failure mode: deleting the instance profile and leaving a long-lived access key in the AMI. You removed `ASSUMES` and added a key-based `CAN_ACCESS` the graph may not see until the IAM collector finds the key.

**Exposure cuts** delete a property that *is* the objective: public ACL on the bucket, `anonymous` on the blob container, public RDS. The walk may still exist to a private endpoint; the *internet-to-object* walk dies. Use when the data was never meant to be public. [Toxic combinations](/blog/toxic-combinations-aws-azure/) are often exposure plus identity; cutting exposure is enough for that pair.

Do not mix the three in one change window without a rollback plan. One family per deploy, then re-query.

## Prove the path is gone

Proof is **two independent empties**, not a green Secure Score.

1. **Cloud API** for the cut you chose (SG describe, IAM simulate, `az storage account show --query allowBlobPublicAccess`, GCP `effective-firewalls`).
2. **OpenSourceOM MATCH** after `last_sync` newer than the change.

```
MATCH path = (i:Internet)-[:REACHABLE*1..4]->(w:Workload {id:'i-0def'})
  -[:ASSUMES|CAN_ASSUME*0..2]->(id:Identity)
  -[:CAN_ACCESS]->(d:Datastore {id:'prod-pii'})
RETURN path
```

Zero rows on (2) with a stale collector is not proof. If (1) is deny and (2) still returns rows, the graph has an extra hop you did not cut (resource policy, another role, a second SG on a second ENI). Cut that hop; do not argue with the screenshot.

Also prove **you did not create a new path**: same MATCH with `w` unbound, filtered to the datastore. Closing SSH and opening RDP is not a break.

Failure mode: closing the ticket on “Terraform applied.” Apply is not simulate-principal-policy and is not a graph sync.

## What not to break in production

Cuts that look cheap in the graph and are expensive in life:

- **The only `REACHABLE` hop that is the product.** A public API’s 443 from Internet is not optional. Cut identity behind it.
- **Shared SG / NSG used by twenty apps.** Tightening it for one path 403s the other nineteen. Clone the SG for the exposed app, then tighten.
- **The instance profile the AMI bake still assumes for yum/apt to S3.** Replace with a pull-through or a scoped `s3:GetObject` on the repo bucket; do not leave the host with no updates.
- **Org-wide `ReadOnly` for IR.** Cutting IR’s read path to prove a score is not a path break; it is an outage of your own detection.
- **Killing IRSA/WI without a replacement identity.** The pod will fall back to the node/instance profile—often *wider*. Delete the annotation only after the scoped role exists and the app has been rolled.

[Zero trust cloud architecture](/blog/zero-trust-cloud-architecture-guide/) is the design invariant (no datastore listener from VPN CIDR). This page is the **surgical** delete. If the cheapest cut violates a freeze, pick the next cheapest hop, document why, and time-box the freeze exception.

Failure mode: “break the path” implemented as deleting the production database security group. That is an incident, not remediation.

## Checklist

- [ ] Hops listed with verbs; cheapest durable cut chosen (prefer SG/exposure/IAM over CVE)
- [ ] Network cuts are SG-to-SG (or equivalent), not RFC1918-wide
- [ ] Identity cuts confirmed with simulate-principal-policy / Azure what-if, not only Terraform
- [ ] Public API paths cut on identity, not by taking 443 down
- [ ] Shared SG cloned before tightening
- [ ] MATCH returns zero after collector `last_sync` > change time; API deny agrees
- [ ] No new walk to the same datastore; no fallback to node instance profile

---
**Related:** [Attack path analysis](/blog/attack-path-analysis-cloud-security/) · [Reachable risk](/blog/reachable-risk-cloud-security/) · [Blast radius analysis](/blog/blast-radius-analysis-cloud-iam/)
