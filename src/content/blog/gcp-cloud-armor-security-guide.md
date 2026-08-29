---
title: "Google Cloud Armor WAF Rules and DDoS Protection"
description: "Set up Cloud Armor on a Google Cloud load balancer: L3/L4 DDoS, preconfigured OWASP WAF rules, rate limiting, Adaptive Protection, Terraform, and preview mode."
pubDate: 2026-08-27
updatedDate: 2026-08-29
author: OpenSourceOM Team
tags:
  - GCP
  - Cloud Armor
  - WAF
  - DDoS
  - GKE
focusKeyword: GCP Cloud Armor security
faq:
  - question: What does Cloud Armor protect, and what does it not?
    answer: Cloud Armor applies to HTTP(S) and some TCP/SSL load balancers via a security policy on the backend service. Always-on L3/L4 DDoS protection is built into Google’s front end. It does not protect a GKE Service of type LoadBalancer that skips the HTTP(S) load balancer, nor private VPC traffic east of the proxy.
  - question: Standard vs Cloud Armor Enterprise?
    answer: Standard includes security policies, preconfigured WAF rules, rate limiting, and bot management features in the policy language. Adaptive Protection’s suggested rules and automatic deploy, plus advanced DDoS telemetry, require Cloud Armor Enterprise (formerly Managed Protection Plus) on the project.
  - question: Which WAF rule set should I enable first?
    answer: Start with sqli-v422-stable and xss-v422-stable at sensitivity 1 in preview mode. Watch denied-would-have logs for a week, opt out noisy signatures, then set preview to false. Jumping to sensitivity 4 in enforce mode will block legitimate API clients.
  - question: How do I attach Cloud Armor to GKE Ingress?
    answer: Create a BackendConfig with spec.securityPolicy.name pointing at the policy, then annotate the Service that backs the Ingress. The Ingress must use a Google Cloud HTTP(S) load balancer (GCE Ingress or Gateway). A Network Load Balancer Service will not evaluate the policy.
---

**GCP Cloud Armor** is Google’s edge WAF and DDoS layer for applications behind Google Cloud load balancers. It is not a CSPM product, not an IAM review, and not a substitute for [VPC Service Controls](/blog/gcp-vpc-sc-dry-run-enforced/). How the app behind the proxy should be built is covered in [cloud-native application security](/blog/cloud-native-application-security/). If you came here for “how do I put OWASP rules and rate limits in front of GKE or Cloud Run,” this is the working path.

Official product docs remain the source of truth for quotas and rule-set names: [Cloud Armor overview](https://docs.cloud.google.com/armor/docs/cloud-armor-overview). This guide is the operator sequence—what to create, what to attach, how to tune false positives, and how a missing policy shows up as **internet-reachable risk**.

## What you are actually deploying

Traffic hits Google’s front end first. **Volumetric L3/L4 DDoS** is scrubbed there whether or not you created a policy. **L7** (HTTP floods, SQLi, XSS, scrapers) is enforced only when a **security policy** is attached to the backend service (or URL map, for some policy types).

```
Client
  → Google Front End     (always-on L3/L4 DDoS)
  → Cloud Armor policy   (WAF, rate limit, geo, Adaptive Protection)
  → HTTP(S) load balancer backend service
  → GKE / Cloud Run / GCE / NEG
```

If the API is a `type: LoadBalancer` Service using a **network** passthrough load balancer, Armor never sees L7. Move that Service behind GCE Ingress, Gateway, or an external HTTP(S) load balancer first.

| Feature | Where it lives | Typical first use |
| ------- | -------------- | ----------------- |
| L3/L4 DDoS | Google Front End | Automatic |
| Preconfigured WAF (OWASP CRS) | Security policy rules | SQLi + XSS at sensitivity 1, preview |
| Rate limiting / throttle | Policy rule `rate_based_ban` or throttle | `/login`, `/graphql`, anonymous `GET` |
| Adaptive Protection | Policy + Enterprise | HTTP flood suggestions / auto-deploy |
| Named IP lists | Policy | Office / partner allowlists |

## 1. Create a backend security policy

Use a `CLOUD_ARMOR` policy (backend). Edge policies (`CLOUD_ARMOR_EDGE`) attach to Cloud CDN / Cloud Storage and are a different attachment model—do not mix them up.

```bash
gcloud compute security-policies create payments-edge \
  --description "WAF and rate limits for payments API" \
  --type CLOUD_ARMOR
```

Every policy has a **default rule** at priority `2147483647` (allow or deny all). Lower numbers evaluate first. Leave the default as `allow` until WAF rules are in preview; flipping default to deny with an empty allowlist will take production down.

Attach to the backend service that the URL map already points at:

```bash
gcloud compute backend-services update payments-backend \
  --global \
  --security-policy payments-edge
```

For **GKE Ingress**, use BackendConfig instead of updating the backend by hand:

```yaml
apiVersion: cloud.google.com/v1
kind: BackendConfig
metadata:
  name: payments-armor
  namespace: payments
spec:
  securityPolicy:
    name: payments-edge
---
apiVersion: v1
kind: Service
metadata:
  name: api
  namespace: payments
  annotations:
    cloud.google.com/backend-config: '{"default": "payments-armor"}'
spec:
  type: NodePort
  ports:
    - port: 8080
      targetPort: 8080
  selector:
    app: api
```

The Ingress or Gateway must provision a **HTTP(S) load balancer**. Confirm in the console that the backend service shows `payments-edge`.

## 2. Preconfigured WAF rules (OWASP CRS)

Google ships named rule sets compiled from OWASP Core Rule Set. Current stable sets use the **v422** suffix (CRS 4.22)—for example `sqli-v422-stable` and `xss-v422-stable`. Older `v33` sets still exist; prefer v422 for new policies. Names change; list them with:

```bash
gcloud compute security-policies list-preconfigured-expression-sets
```

Add SQLi at sensitivity **1** in **preview** (logs a would-deny, does not block):

```bash
gcloud compute security-policies rules create 1000 \
  --security-policy payments-edge \
  --expression "evaluatePreconfiguredWaf('sqli-v422-stable', {'sensitivity': 1})" \
  --action deny-403 \
  --preview
```

Repeat at 1010 for `xss-v422-stable`. Sensitivity 1 is the conservative signatures. Sensitivity 4 is noisy. Do not start at 4 in enforce mode.

**False positives:** opt out a signature by ID rather than disabling the whole set:

```bash
gcloud compute security-policies rules update 1010 \
  --security-policy payments-edge \
  --expression "evaluatePreconfiguredWaf('xss-v422-stable', {'sensitivity': 2, 'opt_out_rule_ids': ['owasp-crs-v042200-id941370-xss']})"
```

WAF inspection only sees the first **8–64 kB** of the body (policy-level `--request-body-inspection-size`). Large JSON uploads can bypass signatures. A common companion rule denies bodies over your inspection limit so uninspected bytes never reach the API:

```bash
gcloud compute security-policies rules create 900 \
  --security-policy payments-edge \
  --expression "int(request.headers['content-length']) > 8192" \
  --action deny-403 \
  --description "Block bodies larger than 8 kB inspection window"
```

Tune that threshold to your real upload API; a file-upload route may need a separate backend **without** this rule, or a higher inspection size.

Google’s setup reference: [preconfigured WAF rules](https://docs.cloud.google.com/armor/docs/configure-waf).

## 3. Rate limiting

WAF does not stop credential stuffing. Add a throttle on expensive or anonymous paths.

```bash
gcloud compute security-policies rules create 800 \
  --security-policy payments-edge \
  --expression "request.path.matches('/login')" \
  --action throttle \
  --rate-limit-threshold-count 20 \
  --rate-limit-threshold-interval-sec 60 \
  --conform-action allow \
  --exceed-action deny-429 \
  --enforce-on-key IP
```

For GraphQL, match on path `/graphql` and a stricter count. Combine with application-level quotas so a distributed attacker that rotates IPs still hits a limit inside the app, not only at Armor.

## 4. Adaptive Protection (L7 DDoS)

Adaptive Protection watches baseline QPS and can **alert**, **suggest a WAF rule**, or **auto-deploy** that rule. Suggested signatures and auto-deploy require **Cloud Armor Enterprise** on the project. Without it you still get a basic “this backend looks flooded” alert—not a drop-in mitigate rule.

Enable on the policy, then add a placeholder rule that evaluates `evaluateAdaptiveProtectionAutoDeploy()` if you want automatic mitigation (Enterprise):

```bash
gcloud compute security-policies update payments-edge \
  --enable-layer7-ddos-defense

# Placeholder (Enterprise): action applies when Adaptive Protection flags attack traffic
gcloud compute security-policies rules create 700 \
  --security-policy payments-edge \
  --expression "evaluateAdaptiveProtectionAutoDeploy()" \
  --action deny-403
```

Always understand **impacted baseline rate** on a suggested rule before you paste it into enforce. A signature that would block 30% of normal traffic is not a mitigation; it is an outage. Docs: [Adaptive Protection](https://docs.cloud.google.com/armor/docs/adaptive-protection-overview).

## 5. Terraform (and a gotcha)

A minimal policy plus backend attachment:

```hcl
resource "google_compute_security_policy" "payments" {
  name = "payments-edge"
  type = "CLOUD_ARMOR"

  rule {
    action   = "deny(403)"
    priority = 1000
    preview  = true
    match {
      expr {
        expression = "evaluatePreconfiguredWaf('sqli-v422-stable', {'sensitivity': 1})"
      }
    }
  }

  rule {
    action   = "allow"
    priority = 2147483647
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
  }
}

resource "google_compute_backend_service" "payments" {
  name            = "payments-backend"
  protocol        = "HTTP"
  security_policy = google_compute_security_policy.payments.id
  # health_checks, backends, ...
}
```

**IaC pitfall:** some `google_compute_security_policy` provider versions hash nested rules by priority and action only. Changing `evaluatePreconfiguredWaf('sqli-v33-stable')` to `sqli-v422-stable` can produce an empty plan while production still runs v33. If `terraform plan` is quiet after a rule-set migration, update in place with `gcloud compute security-policies rules update`, then `terraform apply -refresh-only`. Prefer `google_compute_security_policy_rule` resources if your provider version treats expressions as first-class.

Keep policies in Git next to the load balancer, not in a console-only click-ops folder. Same discipline as locking down [Terraform state](/blog/terraform-state-security-s3-backend/).

## 6. Preview, logs, then enforce

Order that does not page the on-call:

1. Attach policy, default allow, WAF rules `preview: true`.
2. Export Armor logs to Cloud Logging (`jsonPayload.enforcedSecurityPolicy` / preview fields). Alert on a spike in preview matches for a signature you have not reviewed.
3. Opt out or exclude fields (`preconfigured_waf_config` exclusions) for known-good JSON bodies.
4. Set `preview` to false one rule at a time, SQLi then XSS then rate limit.
5. Only then tighten sensitivity or add Adaptive Protection auto-deploy.

If you enforce on Friday night with sensitivity 3, you will spend Saturday excluding signatures. That is not a WAF failure; it is an operations failure.

## 7. Coverage gaps that look like “we have Armor”

Armor only evaluates traffic that hits a **supported proxy**. Teams often report “Cloud Armor is enabled” because a policy exists in the project. That is not coverage. Check these three misses before you argue about WAF signatures:

| Miss | What you see | Fix |
| ---- | ------------ | --- |
| Policy not attached | `gcloud compute backend-services describe` has empty `securityPolicy` | Attach, or set BackendConfig on the GKE Service |
| Wrong load balancer | GKE `type: LoadBalancer` with a passthrough Network LB | Front the app with GCE Ingress / Gateway HTTP(S) |
| Edge vs backend mix-up | `CLOUD_ARMOR_EDGE` on a GKE API | Use `CLOUD_ARMOR` on the backend service |

App design (identity, NetworkPolicy, signed images) belongs in [cloud-native application security](/blog/cloud-native-application-security/), not in this policy. Pair Armor with [GKE Autopilot security tradeoffs](/blog/gke-autopilot-security-tradeoffs/) and Google’s [HTTP(S) load balancing docs](https://cloud.google.com/load-balancing/docs/https).

If you model internet-facing backends in a graph, “HTTP(S) backend with no security policy” is an **exposure** finding—the same class as an open firewall rule—not a CVE. OpenSourceOM does not ingest Armor policies as first-class nodes yet; track attachment in inventory until a collector lands.

## Checklist

| Control | Done when |
| ------- | --------- |
| Right load balancer | HTTP(S) or supported proxy; not a naked Network LB for L7 apps |
| Policy attached | Backend service or BackendConfig shows the policy name |
| WAF | `sqli-v422-stable` + `xss-v422-stable` at sensitivity 1, then tuned |
| Rate limit | Login and other anonymous expensive paths |
| Preview → enforce | Logs reviewed; no surprise 403 rate on healthy clients |
| Enterprise extras | Adaptive Protection only if you subscribe and understand auto-deploy |
| Coverage | Every internet HTTP(S) backend has an attached policy; Network LBs are not counted as L7 coverage |

## Key takeaways

- Cloud Armor is a **load-balancer security policy**: always-on L3/L4, operator-owned L7 WAF and rate limits.
- Attach it to the backend (or GKE BackendConfig). A policy that exists in the project but is not attached does nothing.
- Start WAF in **preview** at low sensitivity; opt out signatures instead of turning the set off.
- Adaptive Protection auto-mitigation is an **Enterprise** feature—do not assume Standard includes it.
- Edge WAF does not replace identity, NetworkPolicy, or datastore IAM. It only inspects the first hop; a policy that is not attached still leaves the backend open.

**Related:** [Cloud-native application security](/blog/cloud-native-application-security/) · [VPC-SC dry-run to enforce](/blog/gcp-vpc-sc-dry-run-enforced/) · [GKE Autopilot security tradeoffs](/blog/gke-autopilot-security-tradeoffs/)
