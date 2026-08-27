---
title: "Cloud Detection and Response (CDR) vs CSPM"
description: "CDR versus CSPM: state versus events, the telemetry you actually need, detections that require graph context, and where GuardDuty, SCC, and Defender fit."
pubDate: 2026-08-27
updatedDate: 2026-08-27
author: OpenSourceOM Team
tags:
  - CDR
  - CSPM
  - detection
  - GuardDuty
  - cloud SIEM
focusKeyword: cloud detection and response CDR
faq:
  - question: Can CSPM replace GuardDuty or Defender for Cloud alerts?
    answer: >-
      No. CSPM compares desired configuration to live state on a schedule. GuardDuty,
      Security Command Center findings of the EVENT class, and Defender alerts fire on
      behavior: credential theft, crypto mining, anomalous AssumeRole, SQL injection
      against a PaaS. A public SG will sit in CSPM until you close it; the brute-force
      that used it is a CDR event. You need both stores.
  - question: What telemetry is enough to start CDR if we cannot afford a full SIEM?
    answer: >-
      Org-wide CloudTrail (or Azure Activity + Entra sign-in, or GCP Cloud Audit Logs)
      in an immutable account, VPC/flow or equivalent, DNS query logs if you can, and
      the cloud-native detection product (GuardDuty, SCC Event Threat Detection,
      Defender). Add kube-audit if you run Kubernetes. Do not start with packet capture
      in every VPC. OpenSourceOM is not the log lake; it is the graph you enrich events
      against.
  - question: When does a detection need the security graph?
    answer: >-
      When the same API call is benign in one place and catastrophic in another.
      sts:AssumeRole is noise unless the destination role is admin-equivalent or the
      source is a sandbox jumphost on an Internet REACHABLE path. Graph context is
      "this principal's blast radius" and "this IP is a known hop," not a replacement
      for the event itself.
  - question: Should OpenSourceOM ingest every GuardDuty finding as an AFFECTS edge?
    answer: >-
      No. GuardDuty finding types that are state-shaped (e.g. a persistent IAM user
      with admin) can join as findings. High-volume behavioral events (port probes)
      should stay in the SIEM with a graph *lookup* (is this instance on a path to
      prod-pii?) rather than writing millions of AFFECTS edges. CDR is the event
      stream; the graph is the map.
---

**CSPM is state. CDR is events.** Confusing them produces a dashboard of open SGs and no page when someone `sts:AssumeRole`s into `prod-admin` at 03:00. OpenSourceOM’s collectors and rules engine are a **state graph** with path context. They do not replace CloudTrail. This page is the split, the **minimum telemetry**, which detections **must look up the graph**, and how GuardDuty / Security Command Center / Defender fit without becoming a second CSPM. Posture-as-category remains [CSPM vs CNAPP](/blog/cspm-vs-cnapp-whats-the-difference/). Paths remain [attack path analysis](/blog/attack-path-analysis-cloud-security/).

```
CSPM / OpenSourceOM graph          CDR
-------------------------          ---
SG allows 0.0.0.0/0:22             11,000 failed SSH + 1 success
role trust = sandbox:root          AssumeRole from sandbox-jump at 03:11 UTC
bucket not public                  GetObject 40 GB to an unknown ASN
last_sync: 12 min                  event_time: now
```

State tells you the door can open. Events tell you it did.

## CSPM is state; CDR is events

| | CSPM (and graph posture) | CDR |
| --- | --- | --- |
| Data | Inventory + policy documents + scanner | Timestamped API calls, network flows, process, identity |
| Question | Could an attacker use this? | Is someone using it *now*? |
| Cadence | Minutes to hours | Seconds to minutes |
| Output | Finding on a node, optional path | Alert, case, containment |
| Failure if used alone | You patch open doors after the thief left | You alert on every `AssumeRole` in the org |

A public bucket is a CSPM finding until the first `GetObject` from an unexpected principal; then it is **both**. Closing the CSPM finding (Block Public Access) is still required. The CDR case answers who took what.

OpenSourceOM should not poll CloudTrail as if it were a collector of nodes. Nodes come from APIs. Events come from the trail. Join them in the SIEM or in the case UI: `principal_arn` → graph blast radius.

Failure mode: tuning CSPM to “critical only” and calling that detection. You reduced a state catalog. You did not detect AssumeRole.

## Telemetry you actually need

Minimum viable CDR for AWS-shaped estates (map the analogues):

```
Management / log-archive account
  ├── Org CloudTrail (all regions, file validation, no delete from workload accounts)
  ├── VPC Flow Logs (or equivalent) on prod VPCs → the same bucket or a SIEM
  ├── GuardDuty (org delegated admin)
  └── Optional: Route53 resolver query logs, EKS audit logs
```

**Azure:** Activity Log + Entra ID sign-in/audit in a locked Log Analytics workspace; Defender for Cloud alerts; NSG flow logs where you can afford them.

**GCP:** Org-level Cloud Audit Logs (Admin Activity always; Data Access on high-value projects); SCC Event Threat Detection; VPC Flow Logs on prod.

**Kubernetes:** API audit log (not only kube-bench). Without it you will not see `get secrets` from a stolen SA.

You do **not** need, on day one: full packet capture, every cluster’s Falco at max verbosity, or DSPM file-open events from every bucket. Those are enrichment after the trail is immutable.

Identity Center / SSO logs are CDR for **humans**. IRSA minting is in CloudTrail as `AssumeRoleWithWebIdentity`. If you only watch console login, you will miss the pod path ([pod to cloud admin](/blog/kubernetes-pod-to-cloud-admin-path/)).

Failure mode: per-account CloudTrail that the same credentials can `delete-trail`. That is not CDR telemetry; it is a suggestion. Org trail in a log-archive account is [AWS best practices](/blog/aws-security-best-practices-2026/).

OpenSourceOM: keep using it for **which identity is admin-equivalent** and **which instance is on an internet path**. Point the SIEM at [the graph](/docs/the-graph/) API (or export) rather than duplicating log storage in the graph database.

## Detections that need graph context

Raw detections that drown without a walk:

| Event | Without graph | With OpenSourceOM lookup |
| --- | --- | --- |
| `sts:AssumeRole` | Thousands/day | Page if destination `admin_equivalent` or if source workload is `Internet REACHABLE` |
| `s3:GetObject` | The entire app | Page if principal is not in the app’s expected identity set **and** bucket `sensitivity: pii` |
| GuardDuty `UnauthorizedAccess:IAMUser/InstanceCredentialExfiltration.InsideAWS` | Scary name | Rank by blast radius of the **exfiltrated** role, not by finding severity alone |
| Flow: 22 from Internet | Duplicate of CSPM | Page if success (if you have auth logs) or if the instance is a hop to prod-pii |
| `k8s: get secrets` | Noisy operators | Page if SA is not the platform operator set **or** if that SA `ASSUMES` a cloud admin role |

Implementation pattern:

```
on event.AssumeRole:
  dest = graph.Identity(event.roleArn)
  src  = graph.Workload(event.sourceIdentity)  # if any
  if dest.admin_equivalent or src.on_internet_path:
    open_case(severity=high, hops=graph.blast(dest))
  else:
    log_only
```

That is **not** CSPM. CSPM would have told you the trust allowed sandbox:root last Tuesday. CDR tells you sandbox-jump used it tonight. You still cut the trust ([multi-account AWS attack paths](/blog/multi-account-aws-attack-paths/)).

Failure mode: piping every GuardDuty finding into the same Jira project as CSPM with no graph lookup. Engineers will auto-close “port probe” next to “credential exfil” because both say Medium.

## Where GuardDuty/SCC/Defender fit

These products are **event engines with some state mixed in**. Treat the SKUs as two buckets:

**Keep as CDR (behavior)**

- GuardDuty: credential exfil, unusual API sequences, malware on an ECS/EC2 finding that is *runtime*, S3 anomalous download (where you enabled it)
- SCC Event Threat Detection / Event Threat Detection plus: IAM anomalous grant, crypto, brute force
- Defender for Cloud **alerts** (not Secure Score recommendations): suspicious process, SQL threat detection, Kubernetes threat detection

**Treat as CSPM (state) — do not double-count with OpenSourceOM rules**

- GuardDuty IAM finding types that are “this user has admin and is unused” if you already have CIEM
- SCC **Security Health Analytics** / misconfig findings
- Defender **recommendations** / MCSB (that is [Azure CSPM](/blog/azure-cspm-implementation-guide/))

Wiring:

```
GuardDuty / SCC ETD / Defender alerts  →  SIEM  →  case
                                              ↘ lookup OpenSourceOM graph (blast, path)
CSPM recs / OpenSourceOM rules         →  posture queue (paths first)
```

Do not ingest SHA/MCSB recommendations into the CDR queue. Do not expect GuardDuty to list every public SG; that is CSPM. Overlap exists (GuardDuty has some IAM findings that look like CIEM). Dedup on principal ARN like [CSPM vs CIEM vs CNAPP](/blog/cspm-vs-ciem-vs-cnapp/).

OpenSourceOM OSS core is **external-attack state**: paths, blast radius, graph-context posture. It is not a SIEM and not a replacement for GuardDuty’s ML on CloudTrail. Compose: native detection products for events, OpenSourceOM for “does this principal matter,” [core](https://github.com/OpenSourceOM/core) if you want that lookup self-hosted.

Failure mode: disabling GuardDuty “because we have a CNAPP.” Most CNAPP posture modules are CSPM+graph. They will not page on the AssumeRole at 03:11 unless you bought their CDR add-on and still forwarded the trail.

## Checklist

- [ ] Org-wide immutable audit trail exists (CloudTrail / Activity+Entra / Cloud Audit Logs)
- [ ] Native detection product on: GuardDuty org admin, SCC ETD, or Defender **alerts**
- [ ] CSPM/graph findings and CDR alerts in different queues (or one queue with a type field)
- [ ] AssumeRole / GetObject / secret-get detections look up admin-equivalent and internet path
- [ ] GuardDuty/SCC/Defender **recommendations** not mixed with **alerts**
- [ ] OpenSourceOM not used as a log lake; SIEM looks up the graph
- [ ] K8s audit logs on if you run clusters; IRSA AssumeRoleWithWebIdentity watched

---
**Related:** [CSPM vs CNAPP](/blog/cspm-vs-cnapp-whats-the-difference/) · [AWS security best practices](/blog/aws-security-best-practices-2026/) · [Azure CSPM implementation](/blog/azure-cspm-implementation-guide/)
