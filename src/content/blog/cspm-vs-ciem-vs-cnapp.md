---
title: "CSPM vs CIEM vs CNAPP: Three Questions, Three Tools"
description: "CSPM, CIEM, and CNAPP answer three different questions. Use this one-page decision table to stop double-ticketing and choose buy versus compose."
pubDate: 2026-08-27
updatedDate: 2026-08-27
author: OpenSourceOM Team
tags:
  - CSPM
  - CIEM
  - CNAPP
  - tool selection
  - cloud security
focusKeyword: CSPM vs CIEM vs CNAPP
faq:
  - question: If I already bought a CNAPP, do I still need a CIEM project?
    answer: >-
      Only if the CNAPP's identity module actually walks effective permissions and
      cross-account trust, not just flags AdministratorAccess by name. Many CNAPP SKUs
      include a CIEM checkbox that is unused or too coarse. If OpenSourceOM (or IAM
      Access Analyzer plus graph queries) already answers "what can this role reach,"
      do not stand up a second identity product that opens duplicate tickets on the
      same ARN.
  - question: Is OpenSourceOM a CNAPP, a CSPM, or a CIEM?
    answer: >-
      OpenSourceOM is a graph that answers all three questions on a shared schema:
      posture findings (CSPM-shaped rules), identity walks (CIEM-shaped blast radius),
      and correlation (the CNAPP-shaped path). It is not a full commercial CNAPP SKU
      (no CWPP agent suite, no DSPM classifier farm in OSS core). Compose scanners you
      already have; do not expect the Apache-2.0 core to replace every agent.
  - question: Why do we get two Jiras for one public bucket?
    answer: >-
      CSPM emits "bucket is public." CIEM emits "role X can s3:PutBucketAcl" or "unused
      admin can reach the bucket." CNAPP path analysis emits "Internet to bucket."
      Three tools, one object. Dedup on the node id (bucket ARN) and keep the path
      ticket; close the isolated CSPM row as a duplicate when the path ticket includes
      the same misconfig as a hop.
  - question: When is buy better than composing CSPM plus CIEM plus a graph?
    answer: >-
      When you have no engineers to run collectors, you need a vendor to hold the
      compliance questionnaire, or you need CWPP/DSPM depth the compose stack lacks.
      Compose when you already pay for Defender/Prowler/Trivy and need correlation
      more than another agent. The long category essay is CSPM vs CNAPP; this page is
      only the three-way split and the ticket problem.
---

**CSPM, CIEM, and CNAPP are three questions**, not three logos. Teams buy all three and then file two tickets per bucket because each product answers only its question. The long essay on posture-versus-platform is [CSPM vs CNAPP](/blog/cspm-vs-cnapp-whats-the-difference/). Identity-as-discipline is [CIEM explained](/blog/ciem-explained-for-cloud-teams/). This page is the **split**, the **double-ticket**, and a **one-page buy-versus-compose** table. OpenSourceOM sits on the compose side: one graph, three questions, scanners optional.

```
CSPM  "Is this object configured dangerously?"     → finding on a node
CIEM  "What can this principal do if stolen?"      → walk from an Identity
CNAPP "How do those connect into a usable chain?"  → path (the join)
```

If you cannot say which question a purchase answers, you are buying a SKU name.

## The three questions

**CSPM — configuration of a resource.** Public storage, open management ports, encryption off, logging off. The unit is a **node property** (or a missing one). Azure enablement of that question is [Azure CSPM](/blog/azure-cspm-implementation-guide/); do not redo it here. A CSPM that never talks to IAM still has a job: catch the bucket ACL before anyone graphs it.

**CIEM — entitlements of a principal.** Unused keys, `*` actions, inbound trusts, privilege-minting actions. The unit is an **identity walk**. [Blast radius](/blog/blast-radius-analysis-cloud-iam/) is how you do one walk; CIEM is the backlog of walks.

**CNAPP — correlation across both, plus workloads.** The unit is a **path**. Vendors stuffed CWPP, DSPM, and a UI around that join and called it a platform. The join is the valuable part. Attack-path queries are [attack path analysis](/blog/attack-path-analysis-cloud-security/).

| Question | Fires when | Blind without the others |
| --- | --- | --- |
| CSPM | Resource config ≠ policy | Won’t know the public bucket is empty vs holds PII vs is reachable from an admin role |
| CIEM | Principal is over-privileged or unused | Won’t know the role is only assumable from an isolated research account |
| Path / CNAPP-shaped | Edges connect entry → finding → data | Won’t tell you encryption-at-rest is off on an island you will never patch first |

OpenSourceOM’s rules engine emits CSPM-shaped findings **with path context** so you do not operate three queues. That is a product choice, not a claim that CSPM as a question disappeared.

Failure mode: renaming the CSPM project “CNAPP” in the budget and skipping identity collectors. You bought a word.

## Overlap that causes double tickets

Same bucket, three alerts:

1. CSPM: `s3-bucket-public-read`
2. CIEM: `role/payments-task` has `s3:PutBucketAcl` (or unused `AdministratorAccess`)
3. Path: `Internet → REACHABLE → (anonymous GetObject) → prod-pii`

If Jira keys on **rule id**, you get three issues, three owners, three due dates. If Jira keys on **node id** (`arn:aws:s3:::prod-pii`) plus **verb** (exposure vs identity vs path), you keep **one** issue with hop list and close the others as duplicates.

Overlap matrix:

| Pair | Duplicate looks like | Keep |
| --- | --- | --- |
| CSPM ∩ path | Public + “internet to bucket” | Path ticket; CSPM hop is line 1 |
| CIEM ∩ path | Admin role + “role on the walk” | Path ticket; identity hop is the cut |
| CSPM ∩ CIEM (no path) | Public sandbox bucket + unused admin in another account | Two tickets: they are not the same object |
| CWPP ∩ path | CVE on the task + path through that task | Path ticket; CVE is `AFFECTS`, not the only cut |

OpenSourceOM finding ids should be **path-shaped** (`entry + hops + objective`) so a CSPM collector and an IAM collector upsert the same row when they describe the same walk. If you ingest Prowler and a commercial CIEM without a graph, you must dedup in the SIEM on ARN or you will staff a duplication team.

Failure mode: auto-closing the path ticket when the CSPM row hits “pass” because someone enabled Block Public Access, while the org-id bucket policy and the admin role remain. Different questions; different remaining hops.

## Buy vs compose

**Compose** (OpenSourceOM-shaped):

```
Cloud APIs + existing scanners (Prowler, Trivy, Defender recs, GuardDuty)
        → collectors / normalizer
        → graph (CSPM rules + identity walks + MATCH)
        → one ticket stream
```

You already paid for scanners. You are missing the join. [Open-source CSPM and CNAPP tools](/blog/open-source-cspm-cnapp-tools-2026/) surveys the scanner layer; [the graph](/docs/the-graph/) and [core](https://github.com/OpenSourceOM/core) are the join.

**Buy a CNAPP suite** when compose fails the constraints: no one to run Docker/K8s collectors, questionnaire requires a named vendor, you need CWPP runtime agents or DSPM data classification OpenSourceOM OSS core does not ship, or legal wants a BA.

**Buy CSPM only** when the estate is small, identity is already handled (Identity Center + no instance profiles with admin), and you accept flat findings. Add a graph when the queue exceeds what a human can VLOOKUP.

**Buy CIEM only** when posture is already green in Defender/Security Hub and the remaining incidents are all `sts:AssumeRole` / Entra role assignments. Still join to network or you will flag sandbox admin roles as Sev-1.

Do not buy CSPM **and** CNAPP **and** CIEM from three vendors “for coverage.” You bought three questions and three billable event streams.

## A one-page decision table

| Situation | Primary question | What to run | What not to add |
| --- | --- | --- | --- |
| New org, public buckets and open 22 | CSPM | Defender CSPM / Security Hub / Prowler + org guardrails | A full CNAPP RFP |
| Incidents are stolen keys and `PassRole` | CIEM | Access Analyzer + graph blast radius; PIM | Another misconfig scanner |
| 4k “criticals,” 40 closed per sprint | Path | OpenSourceOM (or CNAPP path module) on top of existing scanners | A fourth scanner |
| Need runtime exploit detection | CDR / CWPP | See [CDR vs CSPM](/blog/cdr-cloud-detection-response/); agents or cloud native detections | Pretending CSPM is detection |
| Kubernetes CIS YAML only | KSPM subset | [KSPM explained](/blog/kspm-explained-kubernetes-posture/) — not this table | Gatekeeper as a CNAPP |
| Data residency, auditable scoring | Compose | OpenSourceOM self-hosted graph | A SaaS that cannot leave region |
| Board wants one logo | CNAPP buy | One suite, **disable** duplicate CSPM/CIEM tickets | Three logos anyway |

Pick the row you are in this quarter. Re-pick when the queue shape changes. The category blog will still be there for vocabulary; this table is for the PO.

Failure mode: scoring vendors on “has CIEM, has CSPM, has DSPM, has CWPP” checkboxes. Score them on **whether two modules open two Jiras for one ARN**.

## Checklist

- [ ] Each tool (or module) mapped to one of: node config, identity walk, path join
- [ ] Tickets keyed on node id + remaining hops, not on product rule id
- [ ] Public-bucket CSPM row merged into the internet-to-bucket path ticket when both exist
- [ ] No second CIEM product if the graph already walks `CAN_ASSUME`/`CAN_ACCESS`
- [ ] Compose (scanners + OpenSourceOM) vs buy (suite) chosen from the table, not from a logo list
- [ ] CWPP/DSPM/CDR not treated as CSPM; different questions, different telemetry
- [ ] Budget does not fund three products answering the same question

---
**Related:** [CSPM vs CNAPP](/blog/cspm-vs-cnapp-whats-the-difference/) · [CIEM explained](/blog/ciem-explained-for-cloud-teams/) · [Open source CSPM and CNAPP tools](/blog/open-source-cspm-cnapp-tools-2026/)
