---
title: "Security Graph vs CMDB: Why Inventory Is Not Risk"
description: "Why a CMDB is inventory rather than risk: edges it omits, sync lag as a security bug, and when you still need a CMDB beside a security graph."
pubDate: 2026-08-27
updatedDate: 2026-08-27
author: OpenSourceOM Team
tags:
  - security graph
  - CMDB
  - cloud inventory
  - attack path analysis
  - ITSM
focusKeyword: security graph vs CMDB
faq:
  - question: Can I point OpenSourceOM at ServiceNow instead of cloud APIs?
    answer: >-
      No as the primary source. ServiceNow CI records lag Create/Delete on cloud APIs and
      almost never contain effective IAM or live security-group rules. OpenSourceOM
      collectors read AWS/Azure/GCP/K8s APIs, then optionally join CMDB properties (owner,
      app id) onto nodes for ticket routing. Invert that and you get a stale graph with
      excellent ownership fields.
  - question: Which CMDB relationships map to graph edges?
    answer: >-
      Almost none of the useful ones. "Runs on", "owned by", and "depends on" are
      operational relationships. REACHABLE and CAN_ASSUME are computed from live policy.
      You can copy owned-by as a property. You cannot copy depends-on and treat it as a
      packet path. Application service maps are useful after ranking, not as a substitute
      for security groups.
  - question: How stale is too stale for a security graph?
    answer: >-
      For internet-facing REACHABLE edges, hours. A public SG opened at 14:00 and a graph
      that last synced at 06:00 is a lie during the incident. Identity CAN_ASSUME can
      tolerate a bit more unless you are in IR. If your CMDB SLA is 24 hours, it cannot
      be the reachability source. OpenSourceOM collectors should run on a cadence you
      would accept as the source of truth in a Sev-1.
  - question: Do we shut down the CMDB if we deploy a security graph?
    answer: >-
      No. Keep CMDB for asset ownership, change windows, business service maps, and
      license/finance. Stop using it to prioritize CVEs or to assert that two CIs cannot
      talk. Those questions go to OpenSourceOM path queries, then the ticket gets the
      CMDB owner field joined on.
---

A **CMDB** stores configuration items and the relationships ITSM needs: owner, change freeze, business service. A **security graph** stores **computed reachability and effective identity**. OpenSourceOM is the second store. Treating ServiceNow (or CloudQuery-into-Postgres-as-CMDB) as the first store for attack paths is how you page on last quarter’s inventory. The graph data model is [what a cloud security graph is](/blog/security-graph-explained-cloud/). This page is the **boundary** between the two systems.

```
CMDB                         OpenSourceOM graph
-----                        ------------------
CI: i-0abc  owner=payments   Workload i-0abc
rel: owned_by App:PAY        REACHABLE from alb-pay
rel: runs_on Cluster:eks-1   ASSUMES role/payments-task
status: in_service           CAN_ACCESS s3/prod-pii
last_seen: 26 hours ago      last_sync: 12 minutes ago
```

Same instance. Different questions. Only the right-hand side can rank [reachable risk](/blog/reachable-risk-cloud-security/).

## What CMDBs store well

Use the CMDB (or your equivalent: Backstage, ServiceNow, a home-grown app registry) for:

| Field | Why it belongs there |
| --- | --- |
| Owner, team, Slack channel | Humans, not AWS |
| Business service / application id | Page the right rotation |
| Change window, freeze | You will not close an SG in the middle of a Gameday without this |
| Lifecycle (approved, pending decommission) | Finance and audit |
| Expected environment | What the team *thinks* prod is |

OpenSourceOM will join `owner` and `app_id` onto a node when a collector or a CSV mapping exists. That join happens **after** the walk. It does not create `REACHABLE`.

Failure mode: requiring a CMDB CI before ingesting an EC2 instance. Shadow accounts and Terraform-spawned stacks never get CIs; those are exactly the nodes that show up on internet paths.

## Edges CMDBs omit

CMDB relationship types were designed for incident routing and impact of a **planned change** (“if I reboot this cluster, which business service blinks”). They omit the edges attackers use:

| Attacker edge | Typical CMDB | OpenSourceOM |
| --- | --- | --- |
| SG `0.0.0.0/0:443` to the task | Missing or a text field on the CI | `REACHABLE` |
| IRSA annotation on the pod SA | Missing | `ASSUMES` |
| S3 bucket policy `Principal: *` | Missing or a checkbox “has policy” | `CAN_ACCESS` from `Internet` or from a role |
| Cross-account trust `root` | Sometimes a “related account” CI with no verb | `CAN_ASSUME` |
| Peering + overlapping wide NSG | “Connected to VPC X” | Hop-by-hop `REACHABLE` |

“Depends on RDS” in a service map means the app *should* talk to the database. It does not mean the current NSG still allows it, or that a second SG now allows the VPN CIDR. Inverse: two CIs with no CMDB relationship can still have `REACHABLE` because someone opened 5432 from the VPC CIDR.

Failure mode: importing `depends_on` from the CMDB as graph edges. You will both miss live paths and invent paths that were closed last year.

If you need the schema-level argument for why `RELATED_TO` is banned, that is the graph explainer. Here the operational point is: **CMDB edges are not policy.**

## Sync lag as a security bug

CMDB freshness SLAs are often 24 hours, populated by a discovery job, a Terraform hook that engineers skip, or a cloud-account crawl that does not see new regions.

Attackers do not wait for discovery:

```
14:02  terraform apply  — SG allows 22 from 0.0.0.0/0
14:03  instance in CMDB still "sg-old, 22 from 10.0.0.0/8"
14:07  scanner / OpenSourceOM collector (if running) sees the new SG
14:40  first brute-force in VPC flow logs
next day  CMDB discovery run
```

If IR uses the CMDB as “what is exposed,” they will deny a path that OpenSourceOM (or the AWS API) still shows. **Lag is a false negative.** Treat collector delay the same way: an OpenSourceOM graph with a six-hour AWS collector interval is a CMDB with better verbs. For internet `REACHABLE`, aim for minutes-to-an-hour in production; identity can be slower unless you are in an incident.

OpenSourceOM records `last_sync` per collector. A path query should be discarded or annotated when `now - last_sync` exceeds your Sev-1 budget. A CMDB `last_discovered` of yesterday should never be in that query.

Failure mode: “we reconciled CMDB with the graph weekly.” Weekly reconciliation is an ownership cleanup. It is not a security control.

## When you still need a CMDB

Do not throw out the CMDB. You still need it when:

1. **Tickets need a human.** OpenSourceOM can name `role/payments-task`; it cannot know that payments is on-call in EU hours unless you join owner.
2. **Change management.** Breaking a `REACHABLE` edge in prod may require a CAB ticket. The graph proves the edge; CMDB proves who may touch it.
3. **Business-service reporting.** Leadership asks “which of our 40 apps has a live internet-to-PII path?” The graph returns workloads and datastores; the CMDB (or Backstage) maps those to application names.
4. **Non-cloud CIs.** A colo firewall, an on-prem AD, a SaaS that is not in the collectors. Hybrid edges are incomplete in OpenSourceOM until a connector exists; CMDB remains the inventory of record for those objects.
5. **Audit of intended state.** Some auditors want a CI list with owners. Give them CMDB. Give security the graph.

Architecture that works:

```
Cloud APIs  →  OpenSourceOM collectors  →  graph (paths, rank)
                     ↘
CMDB / Backstage  →  join owner, app, freeze  →  ticket
```

Never:

```
CMDB  →  “security graph”  →  rank CVEs
```

[Attack path analysis](/blog/attack-path-analysis-cloud-security/) runs on the first pipeline. ITSM runs on the join.

## Checklist

- [ ] OpenSourceOM collectors ingest cloud APIs; CMDB is not the inventory source for paths
- [ ] Owner/app_id joined onto nodes for routing only
- [ ] No `depends_on` / `runs_on` imported as `REACHABLE` or `CAN_ASSUME`
- [ ] Shadow accounts without CIs still get collected
- [ ] `last_sync` SLO for internet-facing collectors is hours or better, not CMDB’s 24h
- [ ] IR playbooks query the graph (or the cloud API), not yesterday’s CI record, for exposure
- [ ] CAB/freeze and business-service maps stay in CMDB; path proof stays in OpenSourceOM

---
**Related:** [What a cloud security graph is](/blog/security-graph-explained-cloud/) · [Attack path analysis](/blog/attack-path-analysis-cloud-security/) · [The graph](/docs/the-graph/)
