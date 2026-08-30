---
title: "CSA STAR Cloud Security: CCM Evidence Without a Spreadsheet Theater"
description: "Map CSA STAR (CAIQ, Level 1–2, CCM) to AWS, Azure, and GCP controls you already run—and use attack-path evidence so auditors see reachable risk, not screenshot binders."
pubDate: 2026-08-24
updatedDate: 2026-08-30
author: OpenSourceOM Team
tags:
  - compliance
  - CSA STAR
  - CCM
  - cloud security
  - audit
focusKeyword: CSA STAR cloud security
faq:
  - question: What is CSA STAR in cloud security?
    answer: STAR is the Cloud Security Alliance’s assurance program. Level 1 is a published CAIQ self-assessment. Level 2 is a third-party certification against the Cloud Controls Matrix (CCM). Continuous practices (often called Level 3 in older decks) mean you keep CCM control evidence current, not a yearly PDF.
  - question: Is CSA STAR the same as ISO 27001 or SOC 2?
    answer: >-
      No. STAR is cloud-control-specific (CCM domains such as IAM, IVS, EKM, LOG, SEF).
      ISO and SOC 2 are broader management-system audits. Many providers hold both.
      STAR answers how this cloud service is controlled more directly than a generic
      ISMS clause.
  - question: How do I evidence CCM without drowning in screenshots?
    answer: >-
      Bind each CCM control to a machine check (Config, Azure Policy, org policy)
      plus a path query. Auditors accept a dated query that no internet-reachable
      workload can assume a role with GetObject on the PII prefix better than a
      folder of console JPEGs.
  - question: Does OpenSourceOM replace a STAR auditor?
    answer: No. It produces repeatable graph and inventory evidence you attach to CAIQ answers and Level 2 workpapers. The auditor still samples, interviews, and issues the opinion.
---

**CSA STAR cloud security** is how you *prove* a cloud service—or a cloud-consuming program—implements the Cloud Security Alliance **Cloud Controls Matrix (CCM)**, not how you invent a parallel control set. Most teams already run IAM, logging, encryption, and vulnerability scanning. STAR fails when evidence is a spreadsheet of “implemented” with no timestamp, no owner, and no proof the control still holds after last week’s Terraform apply.

For ranking which gaps matter, use [attack path analysis](/blog/attack-path-analysis-cloud-security/). For how to pick work this week, see [how to prioritize cloud vulnerabilities](/blog/how-to-prioritize-cloud-vulnerabilities/).

## What STAR actually is

| Artifact | Who produces it | What it is |
| -------- | --------------- | ---------- |
| **CAIQ** | You (or the CSP) | Questionnaire mapped to CCM; published in the STAR registry for Level 1 |
| **CCM** | CSA | Control catalog (IAM, networking/IVS, EKM, LOG, SEF, STA, …) |
| **STAR Level 1** | Self | CAIQ on the registry; no third-party opinion |
| **STAR Level 2** | Accredited auditor | Certification that sampled CCM controls operate |
| **Continuous / “Level 3”** | You + tooling | Same CCM, current evidence, not an annual binder |

If you are a **customer** of AWS/Azure/GCP, you inherit the provider’s STAR/CAIQ for *their* IaaS/PaaS. Your program still owns **everything in your accounts**: IAM, buckets, clusters, SaaS connectors. Do not paste the AWS CAIQ into your SOC binder and call the app in-scope.

## CCM domains that break in real estates

You will not implement 100+ CCM rows as unique projects. Collapse to the failures auditors and attackers both find:

| CCM-ish intent | Cloud miss | Evidence that survives an interview |
| -------------- | ---------- | ----------------------------------- |
| Identity & access | Standing admin, long-lived keys, `*:*` on roles | Federation only; Access Analyzer / PIM; unused-role report dated this week |
| Infrastructure & virtualization | Public NSG/SG, public snapshots | Inventory of `0.0.0.0/0` and public AMIs/snapshots; last change ticket |
| Encryption & key management | SSE-S3 everywhere “because default” | CMK policy, rotation, who can `kms:Decrypt` production |
| Logging & monitoring | CloudTrail off in a region; no data events | Org trail, immutable log bucket, alert on trail stop |
| Security incident mgmt | Findings with no owner | Path-critical queue under 7 days ([prioritization](/blog/how-to-prioritize-cloud-vulnerabilities/)) |
| Supply chain / STAR for your SaaS | Unreviewed GitHub OIDC | OIDC trust limited to one repo; no `sts:AssumeRole` from `*` |

Write CAIQ answers as **control + system of record + last proof date**. “We use AWS IAM” is not an answer. “Human access is Entra SAML; break-glass is two roles reviewed monthly; last review 2026-08-15 in ticket SEC-4412” is.

## Map CCM to native checks (then to a graph)

Native posture tools cover a slice of CCM. They do not cover **combinations**.

| CCM theme | AWS | Azure | GCP |
| --------- | --- | ----- | --- |
| Inventory | Config aggregators, Resource Explorer | Azure Resource Graph | Asset Inventory / CAI |
| Restrict public data | S3 BPA, Access Analyzer | Storage public access, Defender | Org policy `publicAccessPrevention` |
| Least privilege | IAM Access Analyzer, SCPs | PIM, Azure Policy | IAM Recommender, org policies |
| Encryption | KMS CMKs, EBS/RDS flags | Key Vault, disk encryption | CMEK, VPC-SC |
| Logging | Org CloudTrail, GuardDuty | Activity log, Defender, Sentinel | Cloud Audit Logs, SCC |

Auditors ask “show me this control operated last quarter.” Config **compliance** and Azure Policy **attestations** help. They still miss: a private bucket readable by an internet-facing task role. That is a CCM *intent* failure (protect data, least privilege) with a green CSPM badge.

Attach a **path query** to the high-value CCM rows:

> No production datastore is reachable from `Internet` in ≤ N hops unless the path is an approved ingress (WAF + auth) and the identity cannot `GetObject` off-prefix.

OpenSourceOM is that query surface ([the graph](/docs/the-graph/)). After you connect an account ([getting started](/docs/getting-started/)), export the empty-result MATCH with a timestamp into the STAR workpaper.

## Level 1 vs Level 2 without theater

**Level 1:** Publish an honest CAIQ. Mark “not applicable” for controls you do not operate (you are not a CSP hypervisor shop). Do not mark “implemented” for encryption if a single prod bucket is unencrypted.

**Level 2:** Scope the system: accounts, regions, products. Give the auditor:

1. CCM control → owner → native policy ID  
2. Sample of exceptions with expiry  
3. Path evidence for data-protection and IAM controls  
4. Incident samples that used those controls  

Do not generate 200 pages of generated “cloud security guides” as evidence. Auditors sample depth, not URL count.

## Cadence that keeps STAR true

| When | What |
| ---- | ---- |
| Continuous | CSPM + graph paths on in-scope accounts |
| Monthly | CAIQ delta: new products, new regions, new IdPs |
| Quarterly | Exception recertification; unused admin |
| Certification year | Level 2 fieldwork on a frozen scope list |

## Key takeaways

- STAR is **CCM evidence**, not a second CSPM product.
- Provider STAR does not cover **your** accounts; CAIQ answers need dated, named proof.
- Bind data-protection and IAM CCM rows to **attack-path queries**, not only CIS pass/fail.

**Related:** [CIS-style baselines vs paths](/blog/how-to-prioritize-cloud-vulnerabilities/) · [Attack path analysis](/blog/attack-path-analysis-cloud-security/) · [Getting started](/docs/getting-started/)
