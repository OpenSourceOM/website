---
title: "Azure Resource Graph Queries for Security Review"
description: "Use Azure Resource Graph KQL for public IPs and open NSGs at management-group scope, when ARG beats Policy, and how to export hits into a security graph."
pubDate: 2026-08-27
updatedDate: 2026-08-27
author: OpenSourceOM Team
tags:
  - Azure
  - Azure Resource Graph
  - KQL
  - CSPM
  - cloud security
focusKeyword: Azure Resource Graph security queries
faq:
  - question: Should I replace Azure Policy with Resource Graph?
    answer: >-
      No. Policy is the guardrail (Audit, Deny, DeployIfNotExists) that
      fires on PUT. Resource Graph is a cross-subscription inventory query
      against ARG’s snapshot of ARM. Use ARG to find what already exists
      and to hunt; use Policy to stop the next public IP. They share KQL
      flavor in places but they are not the same control plane.
  - question: Why is a resource missing from an ARG query?
    answer: >-
      ARG is eventually consistent (often minutes). New subscriptions may
      not be indexed until the Resource Graph resource provider has seen
      them. Hidden resource types, wrong table (Resources vs
      ResourceContainers vs SecurityResources), or a management-group
      scope that does not contain the subscription will all look like
      “Azure lost my NSG.”
  - question: Can I query a management group without subscription Reader?
    answer: >-
      You need Graph permissions at the MG (or inherited Reader) for the
      subscriptions you expect to see. ARG will silently omit
      subscriptions you cannot read. Compare az account list /
      management group subscription list to the distinct subscriptionId
      in the ARG result.
  - question: How is ARG different from Log Analytics?
    answer: >-
      ARG is configuration inventory (what ARM believes is deployed).
      Log Analytics is telemetry (what happened). NSG flow logs and
      Defender recommendations live in LA; public IP SKUs and NSG JSON
      live in ARG. Do not hunt ARM properties in a Log Analytics workspace
      that never ingested them.
---

Security review in Azure starts with two questions: what is deployed, and what is allowed. Azure Policy answers “does this PUT violate a rule?” **Azure Resource Graph (ARG)** answers “across these 200 subscriptions, who already has a public IP or an NSG allow from `Internet`?” If you only assign initiatives, you will Deny the next mistake and never list the last two years of them.

This is an ARG hunting page: tables, management-group scope, example KQL, then shipping rows into a graph. Enablement of Defender and MCSB is [Azure CSPM](/blog/azure-cspm-implementation-guide/). Reference: [Azure Resource Graph](https://learn.microsoft.com/en-us/azure/governance/resource-graph/overview).

## ARG vs Azure Policy

| | Azure Policy | Azure Resource Graph |
| --- | --- | --- |
| When it runs | Resource provider PUT/PATCH, compliance scan | Query time against ARG index |
| Effect | Audit / Deny / DINE / Modify | None (read) |
| Shape | Policy rule + parameters | KQL on `Resources`, `ResourceContainers`, `SecurityResources`, … |
| Good at | Stopping new public storage | Listing every public IP that already exists |
| Bad at | Ad-hoc joins across types for a one-off review | Enforcing anything |

Policy compliance is a **state** per resource. ARG is a **search**. A “secure” Policy dashboard with 12 exemptions and 40 noncompliant resources still needs an ARG dump of those 40 before a review meeting.

```bash
# Confirm ARG can see the MG
az graph query -q "ResourceContainers | where type == 'microsoft.resources/subscriptions' | project name, subscriptionId" \
  --management-groups "${MG_ID}" --first 1000
```

Failure mode: querying the default subscription context (`az graph query` without `--management-groups` / `--subscriptions`) and concluding the estate is small. ARG defaults to the subscriptions in the current account cache, not the tenant.

## Example KQL for public IPs and open NSGs

Public IP addresses that are attached (orphaned PIPs are noise; attached ones are listeners):

```kusto
Resources
| where type =~ "microsoft.network/publicipaddresses"
| where isnotempty(properties.ipConfiguration) or isnotempty(properties.natGateway)
| project name, resourceGroup, subscriptionId, location,
    sku = sku.name,
    ip = properties.ipAddress,
    fqdn = properties.dnsSettings.fqdn,
    method = properties.publicIPAllocationMethod
```

CLI:

```bash
az graph query -q "$(cat public-ips.kql)" --management-groups "${MG_ID}" --first 1000 -o table
```

NSG inbound allows from the whole internet (property shapes vary; cover prefix and prefix lists):

```kusto
Resources
| where type =~ "microsoft.network/networksecuritygroups"
| mv-expand rule = properties.securityRules
| where rule.properties.direction == "Inbound" and rule.properties.access == "Allow"
| extend prefixes = iff(isnull(rule.properties.sourceAddressPrefixes),
    pack_array(tostring(rule.properties.sourceAddressPrefix)),
    rule.properties.sourceAddressPrefixes)
| mv-expand prefix = prefixes
| where prefix in ("*", "0.0.0.0/0", "Internet", "::/0", "Any")
| project nsg = name, subscriptionId, resourceGroup,
    rule = rule.name,
    ports = rule.properties.destinationPortRange,
    protocol = rule.properties.protocol,
    prefix
```

Failure mode: only checking `sourceAddressPrefix` and missing `sourceAddressPrefixes` (plural) on rules built in the portal with multiple CIDRs. Failure mode: `*` as destination port with protocol `Tcp` from a named service tag `VirtualNetwork`—that is not internet; do not page people for it. Failure mode: Application Security Groups in `sourceApplicationSecurityGroups` while prefix is empty—your `in (...)` filter never matches, so you miss nothing and also catch nothing useful; join ASG members separately if you rely on ASGs.

Storage public blob access (still ARG, not Policy):

```kusto
Resources
| where type =~ "microsoft.storage/storageaccounts"
| where properties.allowBlobPublicAccess == true
    or properties.publicNetworkAccess != "Disabled"
| project name, subscriptionId, resourceGroup,
    publicNetworkAccess = properties.publicNetworkAccess,
    allowBlobPublicAccess = properties.allowBlobPublicAccess
```

That list is the input to [toxic combinations](/blog/toxic-combinations-aws-azure/) (public account + keys or overly broad RBAC), not a complete attack path by itself.

## Management group scope

Enterprise-scale: platform MG, landing-zone MG, sandbox MG. Reviews should run **per MG**, not “tenant root every time” (sandbox will drown you) and not “prod subscription only” (the extra subscription created last Tuesday will be missing).

```bash
az account management-group show -n "${MG_ID}" --expand --query "children[].{name:name,type:type}" -o table

az graph query -q "Resources | summarize count() by type | order by count_ desc" \
  --management-groups "${MG_ID}"
```

Paging: `--first` max is 1000; use `--skip-token` from the response for the rest. A security review that stops at 1000 NSG rules in a 400-subscription MG is a random sample.

ARG also has `ResourceContainers` for MGs and subscriptions, and `SecurityResources` for some Defender assessments. Joining `SecurityResources` to `Resources` on `id` is how you overlay “unhealthy public storage” with the actual `publicNetworkAccess` property when the recommendation name is opaque.

Failure mode: `--management-groups` on a **display name** instead of the MG id (`alz-landingzones` vs a GUID-like name). The CLI errors or returns empty; people then query tenant root and paste the wrong screenshot into the review.

Permissions: ARG honors ARM RBAC. A Security Reader at the landing-zone MG sees those subscriptions. They do not see a disconnected subscription sitting under tenant root. Your review scope is the intersection of MG tree and RBAC, not the org chart.

## Exporting into a graph

CSV in a ticket is not a path. Each ARG row should become a node with stable identity `id` (ARM resource id) and edges you already know how to query:

- Public IP → NIC → VM / load balancer → NSG
- NSG rule `Internet` → subnet → NIC → VM
- Storage account with public blob → same account’s keys / role assignments (identity ingest, not ARG)

```bash
az graph query -q "$(cat open-nsgs.kql)" --management-groups "${MG_ID}" \
  --first 1000 -o json > open-nsgs.json
```

Ingest `open-nsgs.json` as `EXPOSES` edges in [the graph](/docs/the-graph/). Then ask whether any of those VMs’ managed identities can read a Key Vault used by production—[attack path analysis](/blog/attack-path-analysis-cloud-security/), not another ARG query. ARG has no IAM join that matches what [CIEM](/blog/ciem-explained-for-cloud-teams/) already modeled.

Schedule the same KQL in an Azure Logic App or `cron` + service principal (federated, not a client secret) and diff ARM ids day over day. New public IPs in the landing-zone MG are the review queue; Secure Score movement is not.

[OpenSourceOM](https://github.com/OpenSourceOM/core) can take these as inventory facts. Do not wait for a CNAPP SKU to run KQL you can run this afternoon.

## Checklist

- [ ] Reviews scoped with `--management-groups` (landing-zone vs sandbox separately)
- [ ] Paging past 1000 rows; result subscription count matches MG membership you can read
- [ ] Public PIP query requires attachment (NIC or NAT), not every allocated PIP
- [ ] NSG query covers `sourceAddressPrefix` and `sourceAddressPrefixes`; service tags distinguished from `Internet`
- [ ] Storage `allowBlobPublicAccess` / `publicNetworkAccess` dumped, not assumed from Policy compliance %
- [ ] JSON export keyed by ARM `id` into a graph, not a slide
- [ ] Policy Deny still assigned for the classes you hunted—ARG does not replace it

**Related:** [Azure CSPM implementation](/blog/azure-cspm-implementation-guide/) · [Attack path analysis](/blog/attack-path-analysis-cloud-security/)
