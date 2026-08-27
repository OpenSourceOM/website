---
title: "Reachable Risk: Ranking Cloud Findings by Attack Path"
description: "Rank cloud findings by reachable risk: network plus identity paths, why private subnets lie, and ticket text that includes the actual attack path."
pubDate: 2026-08-27
updatedDate: 2026-08-27
author: OpenSourceOM Team
tags:
  - reachable risk
  - attack path analysis
  - vulnerability prioritization
  - cloud security
  - exposure
focusKeyword: reachable risk cloud security
faq:
  - question: Is reachable risk the same as internet-facing?
    answer: >-
      No. Internet-facing is one REACHABLE hop from the Internet node. Reachable risk is the
      finding that sits on a bounded walk from an entry you care about (Internet, a partner
      CIDR, or a named compromised workload) through network and identity edges to an asset
      you care about. An internal Jenkins with a role that can assume prod-admin is reachable
      risk even if the instance has no public IP.
  - question: Do I still use CVSS after I have reachable risk?
    answer: >-
      Yes, as a tie-breaker among findings already on a live path, and as input to EPSS or
      KEV when two paths have similar blast radius. Do not use CVSS as the primary sort. A
      9.8 on a graph island ranks below a 7.5 on an Internet to datastore walk. The weekly
      ritual that combines those layers is the prioritize-vulnerabilities post, not this page.
  - question: Why is a private subnet not a deny for reachability?
    answer: >-
      Private means no public IP on that ENI. It does not mean no REACHABLE edge from a
      load balancer, a peered VPC, a Shared VPC, Private Link, or a jump host whose instance
      profile you already consider compromised. OpenSourceOM draws REACHABLE from security
      groups, routes, and frontends, not from the subnet name containing "private".
  - question: What belongs in the Jira description besides the CVE id?
    answer: >-
      The walk: Internet or entry workload, each hop (SG rule, trust policy, IRSA annotation),
      the identity obtained, and the datastore or admin action at the end. Include the graph
      query or finding id from OpenSourceOM so the closer can re-run MATCH after the fix.
      "Upgrade openssl" without the path is how the same path reopens on the next instance.
---

**Reachable risk** is a ranking input: *does this finding sit on a walk an attacker can take, using network edges and identity edges that exist right now?* It is not a severity label, not “private subnet so ignore,” and not the weekly triage ceremony. That ceremony—RICE, KEV, thirty minutes—is [how to prioritize cloud vulnerabilities](/blog/how-to-prioritize-cloud-vulnerabilities/). This page defines the **reachability bit** OpenSourceOM attaches to a finding before that ceremony starts.

The graph schema is [what a cloud security graph is](/blog/security-graph-explained-cloud/). The walk itself is [attack path analysis](/blog/attack-path-analysis-cloud-security/). Here the only question is: **on-path or not**, then **how short and how privileged**.

```
Finding.severity = 9.8     Finding.severity = 7.5
      │                          │
      ▼                          ▼
  isolated lab VM          Internet --REACHABLE--> API
  (no REACHABLE from       API --ASSUMES--> task-role
   Internet, no            task-role --CAN_ACCESS--> prod-bucket
   CAN_ASSUME to prod)
      │                          │
      ▼                          ▼
  theoretically severe     reachable risk  ← rank this first
```

## Reachable vs theoretically severe

Theoretically severe is what the scanner knows: CVSS, “critical” CIS, `s3:*` on a policy document. **Reachable risk** is that finding **plus** at least one bounded path from an entry node OpenSourceOM actually ingested.

| Scanner says | Graph says | Rank |
| --- | --- | --- |
| CVE 9.8 on AMI in an isolated research account, no peering | No `Internet` walk, no `CAN_ASSUME` into prod | Backlog |
| CIS “public snapshot” on a sandbox disk | `REACHABLE` from Internet, no identity hop to prod data | Medium unless the snapshot has secrets |
| CVE 7.5 on the API task | `Internet → ALB → task → IRSA role → prod bucket` | First |

OpenSourceOM does not replace the scanner. It **filters and orders** scanner rows by whether an `AFFECTS` edge lands on a node that is on a walk. A finding with no `AFFECTS` target is not reachable risk; it is an inventory bug.

Failure mode: marking every finding in `prod` as reachable because the account tag is prod. Account membership is not a walk.

## Computing reachability (network + identity)

OpenSourceOM computes two families of edges, then concatenates them.

**Network (`REACHABLE`).** From public IPs, load-balancer frontends, peering, Shared VPC, Private Link / Private Endpoint, and security-group / NSG / VPC-firewall rules. A hop exists when the graph can name the listener and the allowed source. Example AWS-shaped check you should be able to reproduce without the UI:

```
# Who can hit the instance's SG on 443?
aws ec2 describe-security-groups --group-ids sg-0abc
aws ec2 describe-route-tables --filters Name=association.subnet-id,Values=subnet-0abc
# Is this ENI associated with a public IP or an ALB target group?
aws elbv2 describe-target-health --target-group-arn "$TG"
```

**Identity (`CAN_ASSUME` / `ASSUMES` then `CAN_ACCESS`).** Trust policies, instance profiles, IRSA/WI annotations, Azure federated credentials, `iam:PassRole`, impersonate. Network isolation does not cut these. A Lambda with no VPC can still `CAN_ACCESS` a bucket; a pod on a private node can still mint cloud credentials.

OpenSourceOM concatenates: `Internet -[:REACHABLE*]-> Workload -[:ASSUMES|CAN_ASSUME*]-> Identity -[:CAN_ACCESS]-> Datastore`. Either family alone is incomplete. Network-only “reachable” misses the IRSA admin role. Identity-only “reachable” pages on every unused admin role in the org.

Failure mode: using AWS Reachability Analyzer for the network hops and stopping. That tool does not know IRSA. Using IAM Access Analyzer and stopping. That tool does not know the ALB.

## False confidence from private subnets

`subnet.MapPublicIpOnLaunch = false` and a name like `prod-private-a` are not a `REACHABLE` deny.

Paths that still exist:

1. **Frontend in a public subnet, target in a private one.** The ALB is the Internet node’s first hop. The task is hop two. OpenSourceOM will draw `Internet → ALB → target`. Your “private” API is on-path.
2. **VPC Lattice, PrivateLink, PSC, Private Endpoint.** No public IP on the datastore; the consumer VPC still has a `REACHABLE` edge if the endpoint policy and SG allow it.
3. **Peering / TGW / VWAN with a wide SG.** Private-to-private is still `REACHABLE` when the SG allows the peer CIDR.
4. **SSM / Bastion / Cloud IAP as an assumed-compromised jump.** If you treat the jump host as an entry (you should, if it is internet-reachable or VPN-reachable), private instances behind it are on-path.
5. **Workload identity with no ENI in the data VPC.** The pod never needs a route to RDS if the role can `rds:Describe*` and the app uses a public RDS endpoint or a proxy the role can reach.

```
Internet
  → ALB (public subnet)
      → ECS task (private subnet)     ← "we are private"
          → IRSA role
              → s3:GetObject on prod   ← reachable risk anyway
```

OpenSourceOM labels the task `public_ip: false` and still returns the walk. If your ticket system keys off `public_ip`, you will drop the row.

Failure mode: excluding `MapPublicIpOnLaunch=false` from CSPM export before ingest. The collector must see private workloads or the graph cannot attach `AFFECTS`.

## Ticket text that includes the path

A reachable-risk ticket that OpenSourceOM can close automatically after re-query looks like this—not “upgrade package”:

```
Title: Reachable risk — CVE-2024-XXXX on payments-api (path to prod-pii)

Entry: Internet
Hops:
  1. REACHABLE  alb-payments/prod  sg-0abc allows 0.0.0.0/0:443
  2. REACHABLE  target i-0def (private subnet, no public IP)
  3. AFFECTS    CVE-2024-XXXX (scanner)
  4. ASSUMES    role/payments-task  (IRSA on serviceaccount/payments)
  5. CAN_ACCESS s3/prod-pii  s3:GetObject

Ask: break hop 1 (SG) or hop 4 (role) — do not only patch hop 3
Verify: re-run OpenSourceOM MATCH for finding id f-123 after deploy
```

The closer must know **which edge is the intended cut**. Patching the CVE and leaving `0.0.0.0/0` plus `s3:GetObject` means the next CVE on that task is the same ticket. How to choose the cut is [how to break a cloud attack path](/blog/how-to-break-cloud-attack-paths/). This page only requires that the ticket **name the walk**.

Failure mode: pasting the OpenSourceOM screenshot without hop verbs. A picture without `REACHABLE` vs `CAN_ASSUME` sends the patch team to yum and the IAM team nowhere.

## Checklist

- [ ] Findings inherit on-path / off-path from a bounded `Internet` (or named entry) walk, not from account tags
- [ ] Network `REACHABLE` and identity `CAN_ASSUME`/`CAN_ACCESS` are both required for internet-to-data ranking
- [ ] Private subnet, no public IP, and “internal ALB” are not automatic off-path
- [ ] Jump hosts, peering, and Private Link are ingested as hops
- [ ] Tickets include entry, hop verbs, identity, datastore, and the OpenSourceOM finding id
- [ ] Patch-only tickets are rejected when hop 1 or hop 4 is cheaper
- [ ] Weekly ranking ritual uses this bit as Reach in RICE — see the prioritize post, do not reinvent it here

---
**Related:** [How to prioritize cloud vulnerabilities](/blog/how-to-prioritize-cloud-vulnerabilities/) · [Attack path analysis](/blog/attack-path-analysis-cloud-security/) · [How to break a cloud attack path](/blog/how-to-break-cloud-attack-paths/)
