---
title: "What a Cloud Security Graph Is (and Is Not)"
description: "The cloud security graph data model: nodes and edges in practice, queries that replace spreadsheet sorts, and what OpenSourceOM will not model."
pubDate: 2026-08-27
updatedDate: 2026-08-27
author: OpenSourceOM Team
tags:
  - cloud security graph
  - security graph
  - attack path analysis
  - graph data model
  - OpenSourceOM
focusKeyword: cloud security graph
faq:
  - question: Should every AWS resource type become its own node class?
    answer: >-
      No. OpenSourceOM normalizes to a small set of node kinds (workload, identity, datastore,
      finding, network interface, internet) and keeps provider type as a property. A new node
      class per AWS product explodes the schema and makes path queries unwritable. Add a class
      only when a new edge type cannot be expressed as a property on an existing kind.
  - question: What is the difference between REACHABLE and CAN_ASSUME?
    answer: >-
      REACHABLE is a network fact: packets can flow from A to B given current security groups,
      routes, and public IPs. CAN_ASSUME is an identity fact: principal A can obtain principal B's
      credentials via AssumeRole, impersonation, or a projected workload identity. A path that
      mixes both is the usual internet-to-data chain. Treating them as one edge type hides which
      cut actually breaks the path.
  - question: Why does OpenSourceOM drop CMDB fields like owner and cost center?
    answer: >-
      Those fields are inventory metadata. They do not change whether a packet or a credential
      can move. OpenSourceOM stores them as optional properties when a collector can join them,
      but they are not required to compute a path. Owner is useful for ticket routing after the
      graph ranks the finding; it is not a reason the finding exists.
  - question: Do I have to write Cypher to use the graph?
    answer: >-
      The engine speaks graph queries; the UI and the rules engine wrap the common ones (internet
      to datastore, role blast radius, CVE on a live path). You write Cypher-shaped MATCH when you
      need a question the canned views do not cover. The schema is in the core repo so those
      queries are auditable, not a black-box score.
---

A **cloud security graph** is a typed set of nodes and edges that answers *can this principal or packet reach that asset, given live config*. It is not a prettier CMDB, not a CVE list with extra columns, and not the [CSPM vs CNAPP](/blog/cspm-vs-cnapp-whats-the-difference/) category argument. This page is the **data model** OpenSourceOM persists after collectors and the normalizer run. How you rank a weekly queue lives in [how to prioritize cloud vulnerabilities](/blog/how-to-prioritize-cloud-vulnerabilities/). How you walk a path lives in [attack path analysis](/blog/attack-path-analysis-cloud-security/).

```
Internet
  --REACHABLE-->  Workload (EC2 / pod / Function)
                    --ASSUMES-->  Identity (role / MI / SA)
                                    --CAN_ACCESS-->  Datastore
Finding --AFFECTS--> Workload
```

If a fact cannot be drawn as one of those arrows, OpenSourceOM does not pretend it is a path.

## Nodes and edges in practice

OpenSourceOM’s normalizer maps provider APIs onto a short list of **kinds**. Provider type (`AWS::EC2::Instance`, `Microsoft.Compute/virtualMachines`, `container.googleapis.com/Cluster`) is a property, not a new label per product.

| Kind | What it stands for | Typical properties |
| --- | --- | --- |
| `Internet` | The unauthenticated public network | singleton |
| `Workload` | Compute that can run attacker code | `public_ip`, `imds`, `cluster`, `env` |
| `Identity` | Role, user, managed identity, service account | `admin_equivalent`, `account` |
| `Datastore` | Bucket, disk, SQL, secret store | `sensitivity`, `public` |
| `Finding` | CVE, misconfig, secret | `severity`, `source` |
| `NetworkInterface` | ENI, NIC, pod IP, ILB frontend | `sg_ids`, `subnet` |

Edges are **facts with a verb**, not “related to”:

| Edge | Meaning | Computed from |
| --- | --- | --- |
| `REACHABLE` | Network path exists (possibly via hops) | SG/NSG/firewall, routes, public IP, Private Link |
| `CAN_ASSUME` | A can obtain B’s credentials | Trust policy, WI/IRSA annotation, impersonate |
| `CAN_ACCESS` | Identity is allowed to read/write the resource | Effective IAM, not the JSON file you hoped was attached |
| `AFFECTS` | Finding is present on this workload | Scanner / CSPM collector |
| `MEMBER_OF` | Account in org, sub in MG, ns in cluster | Org/MG/cluster inventory |

Failure mode: storing `RELATED_TO` because the collector saw both objects in the same account. That edge does not change a query. Delete it.

A **path** is an alternating sequence of nodes and typed edges. OpenSourceOM’s attack-path queries are bounded walks (`[*..5]` in the docs) from `Internet` or from a compromised `Workload`, not unbounded “show me everything connected.”

## What a CMDB will not tell you

A CMDB answers *what exists* and *who owns it*. It will not answer:

- Whether subnet `10.2.4.0/24` is actually reachable from the ALB after the last security-group edit
- Whether role `payments-task` can `sts:AssumeRole` into `org-admin` because a trust policy uses `"AWS": "arn:aws:iam::123:root"`
- Whether the CVE on the node is on a path to the production bucket

Those are **edges**. CMDBs store attributes. When teams export EC2 and IAM into a spreadsheet and sort by CVSS, they are sorting nodes with the edges discarded. The comparison post is [security graph vs CMDB](/blog/cloud-security-graph-vs-cmdb/); the one-line split here is: inventory is not reachability.

Failure mode: joining CMDB `environment=prod` onto a finding and calling that “context.” Prod is a tag. `CAN_ACCESS` to a tagged datastore is context.

## Queries that replace spreadsheet sorts

OpenSourceOM evaluates questions like the ones in [the graph](/docs/the-graph/) docs. Two that replace a CSV:

**Critical CVE on a live internet path to prod data**

```
MATCH (i:Internet)-[:REACHABLE*1..4]->(w:Workload)
      <-[:AFFECTS]-(v:Finding {severity:'critical'})
      -[:AFFECTS]->(w)-[:ASSUMES|CAN_ASSUME*0..2]->(id:Identity)
      -[:CAN_ACCESS]->(d:Datastore {env:'prod'})
RETURN v.id, w.id, id.arn, d.id, length(path)
```

**Identities that are admin-equivalent and reachable from a named VM**

```
MATCH (vm:Workload {id:'i-0abc'})-[:ASSUMES|CAN_ASSUME*1..3]->(r:Identity)
WHERE r.admin_equivalent = true
RETURN r.arn, r.account
```

Spreadsheet equivalent of the first query: export CVEs, export public IPs, export instance profiles, export S3 policies, VLOOKUP four times, then argue about hop count in Slack. The graph is that join, kept fresh by collectors.

Failure mode: running the CVE query without the `Internet` hop and paging on every critical in the account. That is a scanner again. Bound the walk.

## How OpenSourceOM uses the graph

OpenSourceOM is not a generic graph database with cloud objects dumped in. The pipeline is:

```
Cloud APIs → Collectors → Normalizer → Graph store
                              ↘ Rules engine → Findings (with path context)
```

Collectors pull inventory, IAM, network, and scanner output. The **normalizer** is the product: it emits the kinds and verbs above so a rule written once applies to AWS instance profiles, Azure managed identities, and GKE Workload Identity. The **rules engine** attaches path context to a CSPM or CVE finding instead of emitting a second uncorrelated alert. The OSS core is scoped to **external attack defense**—internet-origin paths, blast radius from a compromised workload, exposure-aware ranking. That scope is why some node types never land in core; see [the graph](/docs/the-graph/) and [OpenSourceOM/core](https://github.com/OpenSourceOM/core).

What the UI shows is a **materialized walk**, not a screenshot of a vendor cartoon. If a collector is stale, the walk is stale. There is no second “AI layer” inventing edges the normalizer did not write.

Failure mode: pointing OpenSourceOM at one account and treating missing cross-account `CAN_ASSUME` edges as proof that org-wide trust is clean. Collectors that do not see the destination account cannot draw the edge. Ingest the org, then query.

## What not to model

Do not add nodes for:

- **Humans as first-class path starts in OSS core.** SSO users matter for insider and PAM workflows; they are not the internet-origin model the Apache-2.0 core ships. Start from `Internet` or from a workload you already consider compromised.
- **Every Kubernetes object.** Pod, Service, SA, and the cloud role behind IRSA/WI are enough for pod-to-cloud paths. Modeling every EndpointSlice as a node will not change `CAN_ASSUME`.
- **Ticket systems, cost, and HR orgs.** Join them after ranking for assignment. They are not attack-path predicates.
- **Hypothetical future permissions.** “This role could be attached later” is change-management. The graph stores **effective** permissions at last sync.
- **Unverified scanner plugins.** An `AFFECTS` edge from a tool that cannot identify the instance is a dangling finding. Drop it or keep it off path queries.

Do not add edges for:

- Shared tags (`env=prod` on two resources)
- Same VPC without a matching SG/NSG/route fact
- “Talked to in the last 30 days” unless you are building CDR on events—that is a different store ([CDR vs CSPM](/blog/cdr-cloud-detection-response/))

The test for a new type: *does a MATCH that uses it change a remediation decision?* If not, it is a property or it is out.

## Checklist

- [ ] Node kinds are the short list (workload, identity, datastore, finding, NI, internet)—not one label per cloud product
- [ ] Edges are `REACHABLE`, `CAN_ASSUME`, `CAN_ACCESS`, `AFFECTS` (and org membership)—not `RELATED_TO`
- [ ] Path queries start from `Internet` or a named compromised workload and are hop-bounded
- [ ] Collectors cover the accounts that appear in trust policies, not only the account with the CVE
- [ ] CMDB owner/cost fields are properties for routing, not substitutes for edges
- [ ] No human-as-attacker, ticket, or cost nodes in the OSS path schema
- [ ] Stale collector = treat walks as stale; do not “enrich” with invented edges

---
**Related:** [Attack path analysis](/blog/attack-path-analysis-cloud-security/) · [Security graph vs CMDB](/blog/cloud-security-graph-vs-cmdb/) · [The graph](/docs/the-graph/)
