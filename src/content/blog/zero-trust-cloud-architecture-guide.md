---
title: "Zero Trust Cloud Architecture: Identity, Micro-Segmentation, and Verification"
description: "Validate cloud zero trust against live reachability: identity-aware ingress, default-deny east-west, no VPN-as-trust, and graph queries that show where the design leaks."
pubDate: 2026-08-27
updatedDate: 2026-08-27
author: OpenSourceOM Team
tags:
  - zero trust
  - cloud security
  - identity
  - micro-segmentation
  - CNAPP
focusKeyword: zero trust cloud
faq:
  - question: If we have a VPN, do we have zero trust?
    answer: No. A VPN that dumps users onto a flat VPC or a peered hub is a trusted network with extra authentication at the edge. Zero trust means each application (or each API) checks identity and device posture, and east-west traffic is default deny. The VPN can remain as a bootstrap; it cannot be the authorization layer.
  - question: Does zero trust replace CSPM?
    answer: No. Zero trust is the intended design (who may talk to what). CSPM and a security graph check whether the live security groups, Private Link, and IAM still match that design after the last Terraform apply. Architecture slides go stale; reachability queries do not.
  - question: Where do I start if everything is still flat?
    answer: Put human admin paths on SSO plus an identity-aware proxy (not a jump box in a “trusted” subnet). Then default-deny security groups / NSGs between app and data tiers. Then kill standing admin. Do not start with a maturity model workshop.
  - question: How is this different from the application security patterns post?
    answer: >-
      Cloud-native application security is how one service is built (mTLS, SAs,
      admission). This page is how you prove the estate is not a trusted LAN. Identity at
      the edge, segmentation, and queries that find the rule that re-opened 5432 from
      0.0.0.0/0.
---

Zero trust in cloud is **not** a vendor package and **not** “we turned on SSO.” It is a design you can **falsify** with reachability: after the last change, can identity A still reach datastore B without an authorization check?

This page is that falsification loop. NIST and vendor maturity models are background reading. App-layer patterns (signed images, mesh mTLS) are in [cloud-native application security](/blog/cloud-native-application-security/). Identity blast radius is [CIEM](/blog/ciem-explained-for-cloud-teams/).

```
User / CI
  → Identity-aware proxy / ZTNA     (authn, device, app)
       → VPC / cluster              (default deny between tiers)
            → Data store            (IAM on the identity, not on the subnet)
```

If any hop trusts “source IP is inside the VPN CIDR,” that hop is not zero trust.

## 1. Stop treating the VPN CIDR as a principal

| Anti-pattern | What the graph (or a SG dump) shows | Replace with |
| --- | --- | --- |
| `10.0.0.0/8` allowed to RDS 5432 | Every compromised laptop on the VPN is a DBA | Security group: app SG only; IAM DB auth or scoped SG |
| Jump host in “prod-mgmt” with `0.0.0.0/0` SSH from VPN | Shared admin, no per-app auth | SSM / Azure Bastion / IAP, then per-app ZTNA |
| Peered VPCs with wide route tables | Lateral movement is a routing problem | Per-spoke deny; Private Link to PaaS; no transitive 0.0.0.0 |

Query to run (AWS-shaped; same idea on NSGs / GCP firewall):

```
Internet OR VPN CIDR
  REACHABLE  data store listener
WHERE  no identity-aware proxy in path
```

If that path exists, the architecture document is wrong. Fix the SG, not the slide.

## 2. Humans: per-app access, not network location

- SSO (Identity Center / Entra / Cloud Identity) with MFA.
- Admin APIs: Conditional Access / PAM / PIM — standing `Owner` is not zero trust.
- Application access: identity-aware proxy (IAP, Verified Access, App Proxy) or mesh auth, **not** “you can hit the ALB if you are on VPN.”

Failure mode: SSO for the AWS console, but `kubectl` still uses a long-lived token from a jump box. The console is ZT; the cluster is a trusted LAN.

## 3. Workloads: identity on the call, deny on the net

East-west:

- Security groups / NSGs: **data-tier SG allows app-tier SG only**, not the VPC CIDR.
- Kubernetes: default-deny NetworkPolicy; see the app post for YAML.
- PaaS: Private Link / Private Service Connect; public IP on SQL is a ZT exception, not a default.

North-south: the edge terminates TLS and identity ([Cloud Armor](/blog/gcp-cloud-armor-security-guide/) is one GCP edge; it is not ZT by itself). Authorization stays in the app or the mesh.

Failure mode: mesh mTLS is on, but the database SG still allows the whole cluster pod CIDR. One compromised pod is still a DBA.

## 4. Continuous verification is a query, not a quarterly review

CSPM tells you a control drifted. You still need a **path** question:

1. Which listeners are reachable from Internet or from VPN CIDRs?
2. Which of those identities can `CAN_ACCESS` production data?
3. Which of those paths skip the identity-aware proxy you claimed was mandatory?

[Attack path analysis](/blog/attack-path-analysis-cloud-security/) is that query language. This page’s job is to define **what “compliant ZT” means** so the query has a spec:

- No datastore listener reachable from VPN/Internet except through an identity-aware hop.
- No standing admin on human principals.
- No VPC-CIDR allow on data tiers.

[OpenSourceOM](https://opensourceom.org) is built to run those queries on a live graph so a re-opened `0.0.0.0/0` shows up as a broken ZT invariant, not as a medium finding.

## 5. Device and workload signals (only where they change a decision)

Add device compliance to **admin** paths (Conditional Access on the cloud consoles). Add workload identity to **service** paths (no JSON keys; IRSA / WI). Attestation and confidential VMs are optional; they do not fix a public RDS.

Skip “maturity level 4” workshops until the three invariants above hold.

## Checklist

- [ ] Datastore ports not open to VPN CIDR or `0.0.0.0/0`
- [ ] Human admin via SSO + proxy/PAM; no jump-box-as-trust
- [ ] App-to-data SG/NSG is SG-to-SG, not CIDR-to-CIDR
- [ ] Recurring query: Internet/VPN → data without identity hop
- [ ] Standing Owner/Editor/cluster-admin inventoried and time-bound

## Key takeaways

- **VPN membership is not a principal.** If the SG allows the VPN CIDR, you designed a trusted network.
- **Per-app identity** for humans; **SG-to-SG (or mesh)** for workloads.
- **Falsify with reachability queries** after every apply; CSPM checkboxes lag the path.
- **App patterns and CIEM** are adjacent posts; this one is the estate-level invariant.

---
**Related:** [Attack path analysis](/blog/attack-path-analysis-cloud-security/) · [Cloud-native application security](/blog/cloud-native-application-security/)
