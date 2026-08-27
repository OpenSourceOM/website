---
title: "Architecture of a Self-Hosted CSPM"
description: "How a self-hosted CSPM is built: collectors and credentials, the graph store, the policy engine, and multi-tenant isolation—not a recap of which scanner to buy."
pubDate: 2026-08-27
updatedDate: 2026-08-27
author: OpenSourceOM Team
tags:
  - self-hosted CSPM
  - security architecture
  - security graph
  - multi-tenant
  - OpenSourceOM
focusKeyword: self-hosted CSPM architecture
faq:
  - question: Can I run a self-hosted CSPM with one cloud admin role in the collector?
    answer: >-
      You can, and you should not. Collectors need read-only APIs, scoped to
      the org/tenant they inventory, with no iam:CreateUser or storage write
      except into your own findings bucket. A collector credential that is
      AdministratorAccess is an attack path you built on purpose.
  - question: Do I need a graph database or will Postgres JSON columns do?
    answer: >-
      Postgres can store inventory. Path queries (internet to role to bucket)
      become recursive SQL you will hate. A property graph (or a graph layer
      on top of the store) is the architecture that makes "reachable" a first
      class operation. Start with a graph schema even if the first version is
      small.
  - question: How is this different from the 2026 open-source tools survey?
    answer: >-
      That survey lists scanners and engines you might compose. This page is
      the box diagram: where credentials live, where the graph lives, where
      policy executes, and how two tenants never see each other. Pick engines
      from the survey; do not copy its category table into your design doc.
  - question: What breaks first in production?
    answer: >-
      Credential rotation on collectors, API quota (AWS Config / Azure ARG /
      GCP CAI), and a policy engine that re-scans the whole graph on every
      tiny IAM change. Queue mutations; do not full-rebuild every five
      minutes.
---

A SaaS CSPM is a product. A **self-hosted CSPM** is a system you operate: processes that call cloud APIs, a store that can answer reachability, a policy engine that emits findings, and isolation so customer A cannot read customer B's IAM. This is that architecture. It is not a shopping list of scanners—that survey is [open source CSPM and CNAPP tools in 2026](/blog/open-source-cspm-cnapp-tools-2026/). The schema we care about is [the graph](/docs/the-graph/). Code: [OpenSourceOM core](https://github.com/OpenSourceOM/core).

```
cloud APIs
  → collectors (read-only creds, per tenant)
       → ingest queue
            → graph store (nodes: resource, identity, net)
                 → policy engine (checks + path queries)
                      → findings / tickets
```

If policy runs on flattened JSON dumps and never walks edges, you rebuilt Prowler with extra YAML, not a CSPM that can rank.

## Collectors and credentials

Collectors are workers that list and describe. They are not remediation bots.

**Credential shape**

| Cloud | Collector identity | Bound to |
| --- | --- | --- |
| AWS | IAM role assumed via Org account or StackSet | `SecurityAudit` + extra read (`ec2:Describe*`, `iam:Get*`, `s3:GetBucketPolicy`) — no `*Write*` |
| Azure | Management group-scoped user-assigned MI or app | Reader + `Security Reader` + Resource Graph; never Owner |
| GCP | WIF from your collector project | `roles/viewer` + `roles/iam.securityReviewer` on the org; no `setIamPolicy` |

Store the secret as a K8s SA + IRSA / Workload Identity / federated credential, not an access key in a ConfigMap. Rotate by replacing the role trust, not by emailing a new JSON key.

**What to collect (minimum viable graph)**

- Inventory + public exposure flags (IPs, bucket policies, firewall rules)
- IAM bindings and resource policies (the edges)
- Kubernetes: API resources you can get with a tightly scoped SA (not kube-system dump of secrets)

**What not to collect** until you have a legal and threat model: disk snapshots, object contents, packet captures. CSPM is configuration. DSPM is a different collector.

Failure mode: one AWS role in the management account that can `sts:AssumeRole` into every member with `AdministratorAccess` "to make onboarding easy." That role is a shadow org-admin. Use a dedicated security account, StackSets that create a **read-only** member role, and a trust policy that names the collector role only.

Failure mode: collectors in the same cluster namespace as the UI, with the same SA. A SSRF in the dashboard then has cloud-read on the estate. Separate namespaces, NetworkPolicies, no cloud creds on the API pods.

Quota: paginate, backoff, cache etags. A naive `Describe*` loop across 200 accounts will get you throttled and a partial graph that looks like "those accounts are clean."

## Graph store

Inventory without edges is a CMDB. The store must hold:

- **Nodes:** account/subscription/project, resource, principal, policy document, finding
- **Edges:** `CAN_ASSUME`, `CAN_REACH` (SG/NSG), `HAS_POLICY`, `EXPOSES`, `RUNS_IN`

Writes are idempotent upserts keyed by cloud ARN/RID. Deletes are tombstones until the next full reconcile, or you will "lose" a public bucket that the API skipped.

Query examples you should be able to run without exporting CSV:

- Internet-facing compute that `CAN_ASSUME` a role with `s3:GetObject` on a labeled prod bucket
- Principals with `iam:PassRole` to an admin-equivalent role

That is [attack path analysis](/blog/attack-path-analysis-cloud-security/) as a workload on this store, not a separate product pitch.

Indexes: `(tenant_id, resource_arn)`, `(tenant_id, edge_type, from, to)`. Missing `tenant_id` on every key is how multi-tenant isolation fails in the next section.

Backup the graph like a production database. A CSPM that cannot restore last night's inventory is not an audit trail.

## Policy engine

Policy is a function: `(graph slice) → findings`.

Keep two families:

1. **Asset checks** — "this bucket policy allows `Principal: *`" (CSPM classic)
2. **Path checks** — "this check is true AND an ingress edge exists" (what SaaS CNAPP sells)

Engines you might plug in (names only; see the [2026 survey](/blog/open-source-cspm-cnapp-tools-2026/) for the landscape): Rego against a JSON export, CEL, or native queries in the graph database. The architecture requirement is **the engine reads the graph**, not a second copy of the API that drifted.

Run policy **incrementally**: IAM change on one role invalidates path queries that touch that node, not the entire org. Full-estate recompute nightly is fine as a consistency check; five-minute full recompute is a bill and a lag.

Findings need: control id, resource id, tenant, first_seen, evidence (the edge list). Evidence is how you avoid black-box scores.

Failure mode: policy in the collector ("if public, emit"). Then you cannot ask a new path question without shipping a new collector. Collect raw; decide later.

## Multi-tenant isolation

Whether tenants are "customers" or "business units," treat them as hostile to each other.

| Layer | Rule |
| --- | --- |
| Credentials | Collector role per tenant (or per cloud org), not one super-role with a string filter |
| Ingest | Queue partition / topic per tenant; no shared "latest resources" table without `tenant_id` |
| Store | Every query includes tenant predicate; row-level security or separate keyspaces |
| Policy | Packs may be global; **results** are tenant-scoped |
| UI/API | Authz on tenant id from the session, not from a query parameter the client chose |
| Ops | Break-glass to read another tenant is logged and time-boxed |

Shared-kernel, separate-data is normal. Shared-data with a `WHERE tenant=` you remember to add is a leak waiting for one JOIN.

If you run [OpenSourceOM core](https://github.com/OpenSourceOM/core), assume the graph schema is tenant-aware from day one; bolting it on after the first external user is a migration you will not finish.

Kubernetes: collectors for tenant A must not mount tenant B's cloud secret. That is namespace + ExternalSecrets + admission, not a comment in Helm.

## Checklist

- [ ] Collector identities are read-only, federated, per tenant/org
- [ ] Graph upserts include `tenant_id` on every node and edge
- [ ] Policy reads the graph; collectors do not decide severity
- [ ] Path queries exist as first-class jobs, not only CIS asset checks
- [ ] Incremental invalidation plus a nightly reconcile
- [ ] UI cannot select another tenant's id; collector SAs are not on API pods

**Related:** [Open source CSPM and CNAPP tools](/blog/open-source-cspm-cnapp-tools-2026/) · [The graph](/docs/the-graph/) · [CSPM vs CNAPP](/blog/cspm-vs-cnapp-whats-the-difference/) · [OpenSourceOM core](https://github.com/OpenSourceOM/core)
