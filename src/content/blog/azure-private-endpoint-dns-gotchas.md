---
title: "Azure Private Endpoints: The DNS Gotchas That Re-Expose Services"
description: "Private endpoints that still resolve to public IPs: zone linking, split-brain resolvers, missing privatelink zones, and Storage/Key Vault examples you can query."
pubDate: 2026-08-27
updatedDate: 2026-08-27
author: OpenSourceOM Team
tags:
  - Azure
  - Private Endpoint
  - DNS
  - zero trust
  - CSPM
focusKeyword: Azure private endpoint DNS
faq:
  - question: The private endpoint is Approved. Why does nslookup still return a public IP?
    answer: >-
      Approval attaches a NIC in your VNet. Name resolution is a separate
      plane. If the privatelink.* zone is missing, not linked to the VNet,
      or overwritten by a public Azure DNS suffix from on-prem, clients
      still hit the public endpoint. Check the PE NIC IP, then nslookup
      from the VM, then the zone virtual-network links.
  - question: Does creating a private endpoint disable the public endpoint?
    answer: >-
      No. Storage, Key Vault, SQL, and most PaaS services keep a public
      FQDN until you set public network access to Disabled (and firewall
      rules). A PE without that flag is a second door, not a replacement.
      CSPM should flag publicNetworkAccess=Enabled on accounts that also
      have a PE.
  - question: Do I need a Private DNS zone per region?
    answer: >-
      No. Zones such as privatelink.blob.core.windows.net are global names
      in your tenant. You create one zone per DNS suffix and link it to
      every VNet (or a hub VNet that spoke VNets query via a DNS forwarder).
      Regional duplication creates split records and random public fallback.
  - question: How do on-premises clients resolve the private IP?
    answer: >-
      They cannot use Azure-provided DNS (168.63.129.16) directly. Conditional
      forward the privatelink suffix (or the public PaaS suffix) to a DNS
      private resolver inbound endpoint in the hub, which is linked to the
      zone. Forwarding blob.core.windows.net to 8.8.8.8 sends them to public
      storage.
---

You created a private endpoint, the portal says **Approved**, and `az network private-endpoint show` lists a NIC. From a VM in the same VNet, `nslookup storprod.blob.core.windows.net` still returns a Microsoft public anycast address. Traffic never uses the PE. Attackers and misconfigured jobs still use the public data plane. That is not a “PE not deployed” ticket; it is **Azure private endpoint DNS**.

Private Link without correct resolution is a [zero trust](/blog/zero-trust-cloud-architecture-guide/) leak: the architecture slide says “no public PaaS,” the packet is still on the internet path. [Azure CSPM](/blog/azure-cspm-implementation-guide/) will often score the PE as healthy while `publicNetworkAccess` stays `Enabled`. Official behavior: [private endpoint DNS](https://learn.microsoft.com/en-us/azure/private-link/private-endpoint-dns).

## Private DNS zone linking

Azure does not magically hijack `*.blob.core.windows.net` for your VNet. You need a **Private DNS zone** whose name is the documented `privatelink.*` suffix, an **A record** for the resource name (usually created by the PE’s DNS integration), and a **virtual network link** from that zone to the VNet (or to the hub your resolver uses).

```bash
# PE NIC private IP vs what the VM will resolve
az network private-endpoint show -g rg-net -n pe-storprod \
  --query "networkInterfaces[0].id" -o tsv

az network nic show --ids "${NIC_ID}" --query "ipConfigurations[0].privateIPAddress" -o tsv

# Zone must be linked to this VNet (or to the hub the VM’s DNS points at)
az network private-dns zone list -g rg-dns --query "[].name" -o tsv
az network private-dns link vnet list -g rg-dns -z privatelink.blob.core.windows.net -o table
```

Failure mode: zone in `rg-dns`, PE in `rg-data`, Terraform `private_dns_zone_group` skipped because “DNS is platform-owned.” The PE is healthy; the A record never appears. Another: link created with `registrationEnabled` true on a `privatelink` zone—unnecessary, and some orgs then treat the zone like a VM registration zone and delete records.

Hub-spoke: link the zone to the **hub** VNet where Azure DNS Private Resolver inbound lives, not only to the spoke that contains the PE. Spokes should use the hub resolver as their DNS server. Linking only the spoke and leaving VMs on `168.63.129.16` without a link on **that** VNet is the classic “works in the sandbox VNet, fails in prod.”

## Split-brain resolvers

Split-brain here means two resolvers answering the **same** PaaS FQDN with different RRsets: Azure private IP vs public IP.

| Client DNS | Typical result |
| --- | --- |
| VM uses Azure-provided DNS, zone linked | Private IP (good) |
| VM uses 168.63.129.16, zone **not** linked | Public IP |
| VM uses on-prem AD DNS, no conditional forward | Public IP (AD recurses to internet) |
| On-prem forwards `blob.core.windows.net` to 1.1.1.1 | Public IP |
| Two privatelink zones in different subscriptions, both linked | Whichever zone the link order / resolver hits; often NXDOMAIN + public fallback |

Windows clients cache aggressively. After you fix the link, `ipconfig /flushdns` on the jump box. WSL and Docker Desktop have their own resolvers; a “fixed” Azure VM is not evidence for a developer laptop.

Failure mode: conditional forwarder for `privatelink.blob.core.windows.net` to the resolver, but applications connect to `storprod.blob.core.windows.net` (the public suffix). The CNAME chain is `storprod.blob.core.windows.net` → `storprod.privatelink.blob.core.windows.net` **only when** Azure DNS is in the path. If on-prem never sees Azure’s CNAME, it never queries the privatelink zone. Forward the **public** PaaS suffix to the Azure resolver (recommended by Microsoft for this pattern), or teach clients to use the privatelink FQDN (most SDKs will not).

## Fallback to public if zone missing

Name resolution failure does not fail closed for most Azure SDKs. If the privatelink CNAME is absent, recursive DNS returns the **public** A/AAAA set. The client happily uploads to public blob. You will not see a PE metric; you will see public endpoint firewall hits—or none, if the account still allows Azure trusted services and `0.0.0.0/0`.

```bash
# Public data plane still enabled? PE does not flip this.
az storage account show -g rg-data -n storprod \
  --query "{public:publicNetworkAccess,bypass:networkRuleSet.bypass,defaultAction:networkRuleSet.defaultAction}" -o json
```

Set `publicNetworkAccess` to `Disabled` after DNS is proven from every client class (spoke VM, AKS, on-prem, GitHub-hosted runner if it should **not** use public). Runners on the internet cannot use a PE unless you have a self-hosted runner in the VNet or a relay you actually designed.

Failure mode: “We disabled public access” and CI on GitHub-hosted runners starts failing with `AuthorizationFailure` / public endpoint denied. That is success for exposure; the fix is federation plus a runner in the network—not re-enabling public for convenience. Another: `networkRuleSet` default Allow with a PE, thinking the PE is exclusive. It is not.

[Azure CSPM](/blog/azure-cspm-implementation-guide/) should treat `private endpoint exists AND publicNetworkAccess=Enabled` as an open finding, not a pass.

## Storage and Key Vault examples

**Storage** uses a different `privatelink` zone per **subresource**:

| Subresource | Private DNS zone |
| --- | --- |
| blob | `privatelink.blob.core.windows.net` |
| dfs (Data Lake) | `privatelink.dfs.core.windows.net` |
| file | `privatelink.file.core.windows.net` |
| queue | `privatelink.queue.core.windows.net` |
| table | `privatelink.table.core.windows.net` |
| web (static website) | `privatelink.web.core.windows.net` |

A blob PE does not create dfs records. Spark and `abfss://` clients resolve `dfs.core.windows.net`. You will debug “blob works, Synapse does not” for a day if only blob was integrated.

Secondary endpoints (`storprod-secondary.blob.core.windows.net`) need records too if RA-GRS clients fail over.

**Key Vault** zone is `privatelink.vaultcore.azure.net`. The vault FQDN is `name.vault.azure.net`. Same CNAME story.

```bash
az network private-dns record-set a list \
  -g rg-dns -z privatelink.vaultcore.azure.net -o table

az keyvault show -n kv-prod --query "{public:properties.publicNetworkAccess,pe:properties.privateEndpointConnections[].privateLinkServiceConnectionState.status}" -o json
```

Failure mode: vault firewall set to “Allow public access from specific virtual networks” **without** a PE, then someone adds a PE and assumes the firewall list is obsolete. Public VNet rules still admit those VNets’ public egress IPs if public access is on. Disable public; do not stack PE + “selected networks” as if they were the same control.

SQL, Cosmos, Event Hubs, ACR each have their own suffix list. Copy-pasting the blob zone name for Key Vault produces a zone that never receives the PE’s auto records.

Prove it with the same query from each resolver:

```
nslookup kv-prod.vault.azure.net
nslookup storprod.blob.core.windows.net
```

Private IP in both, from spoke, hub, and on-prem test box. Then disable public. Then re-run [zero trust](/blog/zero-trust-cloud-architecture-guide/) reachability: internet → PaaS listener should be empty.

## Checklist

- [ ] `privatelink.*` zone exists for **each** subresource you actually use (blob and dfs are different)
- [ ] Zone linked to every VNet that uses Azure-provided DNS, or to the hub resolver VNet
- [ ] On-prem conditional forwarder sends the **public** PaaS suffix to Azure DNS Private Resolver
- [ ] `nslookup` from VM, AKS pod, and on-prem returns the PE NIC IP
- [ ] `publicNetworkAccess=Disabled` after DNS is proven; PE alone is not a public-access off switch
- [ ] CSPM alert on PE present + public access enabled
- [ ] No duplicate zones for the same suffix in two subscriptions both linked to the same VNet

**Related:** [Azure CSPM implementation](/blog/azure-cspm-implementation-guide/) · [Zero trust cloud architecture](/blog/zero-trust-cloud-architecture-guide/)
