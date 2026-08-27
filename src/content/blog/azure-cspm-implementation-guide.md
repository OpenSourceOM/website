---
title: "Azure CSPM Implementation Guide: From Defender to Custom Policies"
description: "Turn on Defender for Cloud CSPM at the management group, assign MCSB with Deny, export to Log Analytics, and avoid Secure Score theater and exemption rot."
pubDate: 2026-08-27
updatedDate: 2026-08-27
author: OpenSourceOM Team
tags:
  - Azure
  - CSPM
  - cloud security
  - Azure Policy
  - Defender for Cloud
focusKeyword: Azure CSPM
faq:
  - question: Is Microsoft Defender for Cloud the same as CSPM?
    answer: Defender for Cloud includes a CSPM plane (recommendations, Secure Score, regulatory standards) and optional Defender plans for servers, containers, and databases. Foundational CSPM can run without those plans. Defender CSPM (the paid plan) adds attack-path and some governance features. Do not conflate the product family with the free recommendation list.
  - question: Where do I assign policy so it actually applies?
    answer: Assign the Microsoft cloud security benchmark initiative at a management group that contains the subscriptions you care about—not only on a single sandbox subscription. Root-MG assignments hit every subscription under that MG, including future ones. Exclude the management-group for labs with an exemption that has an owner and an end date.
  - question: Why is Secure Score going up while we are still exposed?
    answer: Secure Score weights controls, not reachability. Fixing a logging recommendation on an internal VM can outscore leaving a storage account with public blob access. Track internet-facing resources and open management ports separately from the score.
  - question: How is this different from CSPM vs CNAPP?
    answer: This page is the Azure enablement sequence. The category choice is [CSPM vs CNAPP](/blog/cspm-vs-cnapp-whats-the-difference/). Ranking leftover recommendations is [how to prioritize cloud vulnerabilities](/blog/how-to-prioritize-cloud-vulnerabilities/).
---

This is the **Azure enablement path**: Defender for Cloud on a management group, Microsoft cloud security benchmark (MCSB) as Policy, continuous export, then Deny where you can survive it. It is not a generic CNAPP buyer's guide and not Entra PIM ([CIEM](/blog/ciem-explained-for-cloud-teams/) covers identity). Product names and SKU gates change; confirm in [Defender for Cloud overview](https://learn.microsoft.com/en-us/azure/defender-for-cloud/defender-for-cloud-introduction).

```
Tenant root management group
  ├── Platform MG     identity, connectivity, management subscriptions
  ├── Landing-zone MG prod / nonprod subscriptions  ← assign MCSB here
  └── Sandbox MG      policy exemptions allowed, short TTL
```

If recommendations live only on one subscription, the next landing zone will ship with public storage and no diagnostic settings.

## 1. Onboard the MG, not a hero subscription

1. Enable Defender for Cloud on every subscription under the landing-zone MG (Azure Policy `deployIfNotExists` for the Defender plans you actually pay for).
2. Set a **continuous export** to a Log Analytics workspace in the security subscription—recommendations, secure score, and regulatory compliance. Portal-only is not an audit trail.
3. Register the `Microsoft.Security` resource provider. Missing RP is the usual reason a new subscription shows zero recommendations for a day.

```bash
# Confirm Security RP and Defender pricing tier on a subscription
az provider show -n Microsoft.Security --query registrationState -o tsv
az security pricing list --query "[].{name:name,tier:pricingTier}" -o table
```

Failure mode: “CSPM is on” because someone clicked Defender on a sandbox. Production subscriptions were never connected. Check `az account list` against the MG.

## 2. MCSB is the initiative; CIS is an add-on

Assign **Microsoft cloud security benchmark** at the landing-zone MG. Add CIS or PCI initiatives only if those audits are real this year. Each extra initiative duplicates recommendations and trains people to ignore the queue.

Policy **effects** that matter:

| Effect | When to use |
| --- | --- |
| Audit / AuditIfNotExists | First 30–90 days; you need a baseline |
| Deny | After you know the exception path (public IP, allowed SKUs, allowed locations) |
| DeployIfNotExists | Diagnostic settings, Defender plans, required tags |
| Disabled | Never as a silent default; use an exemption record instead |

Failure mode: Deny on `append` tags at tenant root before app teams have a tagging standard. Everything fails CI. Start Audit, then Deny per control.

## 3. Exemptions without expiry are public storage

Every exemption needs: resource ID, control ID, owner, ticket, **end date**. Azure Policy exemptions can be assigned at MG, subscription, or resource. Prefer the smallest scope.

```bash
az policy exemption list --query "[].{name:name,expires:expiresOn,scope:systemData}" -o table
```

Alert when `expiresOn` is null on a production MG. That list is your real exception register—not a wiki.

## 4. Secure Score is a trend, not a risk ranking

Secure Score will reward you for turning on disk encryption on an isolated VM while a storage account still allows `AllowBlobPublicAccess`. Export recommendations and **sort by attack surface**, not by score delta:

- Storage accounts with public blob/container access or `0.0.0.0/0` firewall
- NSGs/ASGs allowing 22/3389/445 from `Internet`
- SQL / PostgreSQL / Cosmos with public network access
- Key Vaults without firewall or with `Allow` all networks

Those are Azure-specific entry nodes. Graph ranking of the leftovers is [attack path analysis](/blog/attack-path-analysis-cloud-security/), not a substitute for turning Deny on public storage.

## 5. Continuous export and Sentinel, not screenshot audits

Export to Log Analytics. In Sentinel (or any SIEM) alert on:

- `SecurityRecommendation` where assessment key is public storage / management ports and status is unhealthy
- A new subscription under the landing-zone MG with no MCSB assignment within 24 hours (Resource Graph)

SOAR tickets should include the **resource ID and the control ID**, not “Secure Score dropped.” If you need path context (VM + managed identity + Key Vault), that is a graph query—link it; do not paste the whole CNAPP pitch into the playbook.

## 6. Defender plans are optional; CSPM recommendations are not

| Plan | What it adds | Skip if |
| --- | --- | --- |
| Foundational CSPM | Recommendations, score, standards | You never should |
| Defender CSPM (paid) | Extra governance / path features in Microsoft’s graph | You already have another graph and only need Policy |
| Servers / Containers / Databases | Workload protection, agent or agentless scanning | You have no VMs / AKS / SQL |

Buying Defender for Servers does not assign MCSB. Assigning MCSB does not require Defender for Servers.

## Checklist

- [ ] `Microsoft.Security` registered on every landing-zone subscription
- [ ] MCSB assigned at MG; sandbox MG excluded with dated exemptions
- [ ] Continuous export to a security-subscription workspace
- [ ] Deny (or DINE) for public storage and disallowed locations after a bake-in period
- [ ] Exemption list has owners and `expiresOn`
- [ ] Alerts on public blob access and open management ports, independent of Secure Score

## Key takeaways

- **Management group assignment** is the product. Subscription-level Defender is a demo.
- **MCSB + effects** (Audit then Deny) beats collecting five regulatory initiatives.
- **Exemptions expire** or they are production config.
- **Secure Score** does not rank internet-facing storage; your export queries must.

---
**Related:** [CSPM vs CNAPP](/blog/cspm-vs-cnapp-whats-the-difference/) · [Toxic combinations in AWS and Azure](/blog/toxic-combinations-aws-azure/)
