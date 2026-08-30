---
title: "Azure Application Gateway WAF: OWASP Rules, Tuning, and What WAF Cannot Do"
description: "Run Application Gateway WAF_v2 in Prevention with OWASP CRS, custom rules, and Log Analytics—without treating WAF as authentication or network segmentation."
pubDate: 2026-08-24
updatedDate: 2026-08-30
author: OpenSourceOM Team
tags:
  - Azure
  - WAF
  - Application Gateway
  - OWASP
  - application security
focusKeyword: Azure Application Gateway WAF
faq:
  - question: Should Azure Application Gateway WAF start in Detection or Prevention?
    answer: Detection (preview) for a measured window while you collect false positives, then Prevention. Leaving Detection on for months is a dashboard, not a control. Pair Prevention with a change window and exclusions you can name.
  - question: Is OWASP CRS enough for Application Gateway WAF?
    answer: CRS is the baseline for injection and protocol abuse. You still need custom rules for your app (block admin paths from the internet, geo or rate limits) and Bot Manager if you buy that SKU. CRS will not authenticate users or stop a stolen cookie.
  - question: Can WAF replace Network Security Groups or Private Link?
    answer: No. WAF inspects HTTP(S) at the gateway. A backend with a public IP, an open NSG, or a management plane reachable off the WAF path is a bypass. Put backends on Private Link or a private IP; NSGs still deny non-gateway subnets.
  - question: How does WAF show up in attack path analysis?
    answer: >-
      WAF is a control on the Internet-to-app REACHABLE edge. If the rule set is
      Detection-only, or a listener is HTTP, or a second public IP hits the app,
      the graph still shows REACHABLE. Tune WAF, then re-query the path.
---

**Azure Application Gateway WAF** is an HTTP inspection layer on Application Gateway **WAF_v2**. It is the right place for OWASP Core Rule Set (CRS), bot filters, and a few custom denies. It is the wrong place to hide a missing Entra login, an open backend NSG, or a public storage account the app can read.

This is the operator setup. Application patterns around the edge are in [cloud-native application security](/blog/cloud-native-application-security/). Path cuts are in [how to break a cloud attack path](/blog/how-to-break-cloud-attack-paths/).

## Where WAF sits on the path

```
Internet ──TLS──▶ Application Gateway (WAF policy)
                      └──private IP / Private Link──▶ App (App Service, AKS ingress, VM)

Bypass if: public IP on the app, management port 22/3389, second listener without WAF
```

| Control | WAF does | WAF does not |
| ------- | -------- | ------------ |
| SQLi / XSS / protocol | CRS managed rules | Object-level auth in the API |
| Rate / bot | Custom rules, Bot Manager | Stop a valid session stealing data |
| TLS | Gateway HTTPS listeners | mTLS to every pod (that is mesh / ingress) |
| Logging | WAF log to Log Analytics | Tell you the pod’s Managed Identity can read Key Vault |

If the app is reachable **around** the gateway, you do not have a WAF; you have a decoration.

## 1. SKU, policy, and Prevention

Use **WAF_v2**. Associate a **WAF policy** (global or per-listener / per-path). Policy at path level lets `/health` stay loose and `/api` stay strict.

Mode:

1. **Detection** for days, not quarters. Watch `Action == Detected` in Log Analytics.
2. Flip **Prevention** once you have exclusions for known false positives (CMS query strings, JSON bodies CRS hates).
3. Never run **Prevention** on one listener and a **raw public IP** on the same app.

OWASP **CRS 3.2** (or the current managed set Microsoft ships) is the default managed rule set. Turn **paranoia** up only after you can staff the false-positive queue. Paranoia 3 with nobody watching exclusions = engineers bypass the gateway.

## 2. Custom rules that actually pay

Managed CRS will not know your admin panel. Add custom rules **before** you tune CRS exclusions into Swiss cheese.

Examples worth implementing:

- Block `/admin`, `/debug`, `/actuator` from the internet (allow from a named source IP group for break-glass).
- Rate-limit unauthenticated `POST /login` and `POST /graphql`.
- Geo or IP allowlists only for apps that are not a global product.
- Deny HTTP/1.0 oddities and empty `User-Agent` if that matches your threat model—and verify you do not break health probes (use a separate probe path excluded from that rule).

Order: **custom rules evaluate first**, then managed. A custom *allow* can skip CRS for a path; use that sparingly (file upload endpoints) and log it.

## 3. Tuning without turning WAF off

False positives are normal. The wrong fix is Detection forever or `Microsoft_DefaultRuleSet` disabled.

Process:

1. Query WAF logs: `ruleId`, `requestUri`, `action`, `policy`.
2. Prefer **exclusion** on a specific rule ID + match variable (e.g. `RequestArgNames` contains `timestamp`) over disabling the rule globally.
3. File a ticket with the app team if the body format is hostile to CRS; change the API if cheaper than a permanent exclusion.
4. Re-test with a known payload (SQLi in a query param) in a non-prod slot after every policy change.

Send logs to **Log Analytics** with WAF log = on. Diagnostic setting to a locked workspace. Alert on `action == Blocked` spikes *and* on `policyMode == Detection` if you expected Prevention.

## 4. Backend and identity (the bypass list)

- Backends: **private IP** or App Service with **private endpoint**. NSG: only the gateway subnet (and Azure load balancer probe) inbound.
- Listeners: HTTPS only in production. HTTP listener should redirect.
- **End-to-end TLS** if you need it; do not disable backend TLS “because the VNet is safe.”
- Front Door vs Application Gateway: Front Door WAF is a different policy object. Do not assume a Front Door WAF covers a regional gateway path that users still hit.
- Auth: Entra Easy Auth, APIM, or the app. WAF is not your IdP. See pattern 5 in [cloud-native application security](/blog/cloud-native-application-security/).

## 5. Prove REACHABLE is the approved edge

CSPM will flag “WAF not enabled.” Also check:

- No public IP on the web app / AKS `LoadBalancer` that skips the gateway.
- No management ports on the same VMSS.
- Graph: `Internet --REACHABLE--> App` only via the gateway subnet / Front Door.

OpenSourceOM joins Azure NICs, public IPs, and the app identity’s `CAN_ACCESS` to Key Vault and Storage ([getting started](/docs/getting-started/), [the graph](/docs/the-graph/)). A green WAF policy with a public backend is still a live path.

## Cadence

| When | What |
| ---- | ---- |
| Deploy | WAF_v2 policy, HTTPS, private backend, diagnostics |
| First 2 weeks | Detection → exclusions → Prevention |
| Weekly | Top blocked rule IDs; unused public IPs on the app |
| Quarterly | CRS version, Bot Manager review, tabletop WAF bypass IP |

## Key takeaways

- **Prevention + CRS + a few custom rules** is the baseline; Detection-only is not a control.
- Tune with **per-rule exclusions**, not by disabling the managed set.
- WAF does not replace **private backends, NSGs, or authentication**. Rank remaining risk by whether the internet can still reach the app or its identity can still read data.

**Related:** [Cloud-native application security](/blog/cloud-native-application-security/) · [Break a cloud attack path](/blog/how-to-break-cloud-attack-paths/) · [Getting started](/docs/getting-started/)
