---
title: "GCP Workforce Identity Federation for Human SSO"
description: "Workforce Identity Federation maps IdP groups to GCP IAM for humans—no Cloud Identity user required. Not Workload Identity Federation (that is CI and GKE)."
pubDate: 2026-08-27
updatedDate: 2026-08-27
author: OpenSourceOM Team
tags:
  - GCP
  - workforce identity
  - SSO
  - IAM
  - CIEM
focusKeyword: GCP workforce identity federation
faq:
  - question: How is workforce identity federation different from workload identity federation?
    answer: >-
      Workforce is for people (SSO into console and gcloud as a human
      from Okta, Entra, Ping). Workload is for machines (GitHub Actions,
      GKE, AWS roles) exchanging OIDC for a service account. Different
      pool types, different principal URIs, different threat model.
      Do not paste a workload provider YAML into a workforce pool.
  - question: Do workforce users need Cloud Identity or Workspace licenses?
    answer: >-
      Not for the federation itself. The point is console and API access
      without provisioning a Google user per contractor. You still need
      an organization, an access context manager / IAM setup, and
      licenses only if you also use Workspace services those people
      should not get. Do not buy 4,000 Workspace seats to give
      BigQuery to vendors.
  - question: How do IdP groups become GCP IAM members?
    answer: >-
      Attribute mapping copies a groups claim into google.groups (or
      you map a single group). IAM bindings then use
      principalSet://iam.googleapis.com/locations/global/workforcePools/POOL/group/GROUP_ID.
      If the token has no groups claim, mapping cannot invent them.
      Entra’s 200-group limit and “groups assigned to the app only”
      settings are the usual empty-IAM bug.
  - question: Can workforce users run gcloud and Terraform?
    answer: >-
      Yes, after they obtain a workforce credential (console sign-in
      or ADC configured for the workforce pool). Terraform still needs
      an identity whose IAM is sufficient; many teams keep automation
      on a workload-federated SA and reserve workforce for humans.
      Mixing both in one principal string is how bindings never match.
---

Contractors and partner SOC analysts should not all become Cloud Identity users in your org. **Workforce Identity Federation** lets those humans SSO with the IdP they already have, then appear in GCP IAM as workforce principals. **Workload** Identity Federation is the other product: GitHub, GKE, AWS—pipes, not people. This page is workforce only.

Docs: [workforce identity federation](https://cloud.google.com/iam/docs/workforce-identity-federation). Workload (CI) cutover is a different post; do not follow it here.

## Workforce vs workload identity

| | Workforce | Workload |
| --- | --- | --- |
| Who | Humans | Services, CI jobs, VMs, pods |
| Pool | `workforcePools` (org-scoped) | `workloadIdentityPools` (project-scoped typical) |
| Provider | OIDC or SAML from an IdP | OIDC from GitHub, AWS, etc. |
| Principal example | `principal://iam.googleapis.com/locations/global/workforcePools/POOL/subject/USER` | `principal://iam.googleapis.com/projects/N/locations/global/workloadIdentityPools/POOL/subject/...` |
| Console | Workforce sign-in URL | Not how humans log into console |

```bash
gcloud iam workforce-pools list --location=global --organization="${ORG_ID}"

gcloud iam workload-identity-pools list --location=global --project="${PROJECT_ID}"
```

If `workforce-pools list` is empty and you have been granting `roles/browser` to `user:alice@gmail.com`, you are not on workforce yet.

Failure mode: creating a **workload** pool named `okta-humans` and wondering why the console SSO URL does not exist. Failure mode: binding IAM to `user:alice@vendor.com` while Alice only exists as a workforce subject—two identities, one human, IAM on the wrong one.

## IdP attributes to groups

Provider mapping is the product. Typical OIDC:

```
google.subject = assertion.sub
google.groups = assertion.groups
google.display_name = assertion.preferred_username
```

SAML uses assertion attributes instead of JSON claims. Either way, **IAM cannot see IdP groups you did not map**.

```bash
gcloud iam workforce-pools providers describe okta-oidc \
  --workforce-pool="${POOL}" \
  --location=global
```

Bind roles to groups, not to 200 individual subjects:

```bash
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="principalSet://iam.googleapis.com/locations/global/workforcePools/${POOL}/group/bigquery-readers" \
  --role="roles/bigquery.dataViewer"
```

The group id in the URI must be **exactly** the string in `google.groups` after mapping (sometimes a UUID from Entra, sometimes a name from Okta). Copy-paste from the IdP admin UI without dumping a real token and you will bind a group nobody has.

Attribute **condition** (who is even allowed to become a workforce principal):

```
assertion.groups.exists(g, g == "gcp-allowed")
```

Without a condition, every user in the IdP app assignment can mint a workforce identity. The IdP app assignment **is** your joiners/leavers if you skip the condition; keep both.

Failure mode: Entra emits groups as overage claim (`_claim_names`) when the user has too many groups. Mapping `assertion.groups` is empty; IAM group bindings never match; you “fix” it by binding `principalSet://.../workforcePools/POOL/*` to Editor. Do not. Enable Entra “groups assigned to the application,” keep the app’s group list small, or use a dedicated Entra group for GCP.

## Console access without Cloud Identity users

Organization setting: allow workforce identities to use the Cloud Console. Users open the **workforce pool sign-in URL** (not `console.cloud.google.com` as a consumer Google user). After IdP auth they get a Google session tied to the workforce subject.

```bash
gcloud iam workforce-pools describe "${POOL}" --location=global \
  --format="yaml(state,accessRestrictions,sessionDuration)"
```

Grant `roles/browser` (and the data roles they need) on the folder they should see. They should **not** need `roles/owner` to “see the console.” Empty project picker usually means no IAM on any project, not a broken SAML cert.

Session duration and reauth: shorter sessions for vendors. Keep IAM inside a vendor folder per [GCP IAM security hardening](/blog/gcp-iam-security-hardening/); a mistaken org-level role on a workforce group is still standing admin.

Failure mode: users bookmark `console.cloud.google.com` and sign in with a personal Gmail that you then add as `user:` IAM. You now have a shadow identity beside workforce. Ban consumer Google accounts via org policy / essential contacts process; tell vendors the workforce URL only.

## Pitfalls

**gcloud / ADC.** After console works, CLI still fails until the user runs the workforce login flow (`gcloud auth login` with the workforce config, or a documented ADC file). Terraform on a laptop as a workforce user will otherwise pick up a leftover user ADC from a personal Gmail.

**SCIM vs federation.** Provisioning Workspace users via SCIM is not workforce. If you SCIM *and* federate, you can duplicate principals. Pick one path per population.

**IAP and workforce.** Identity-Aware Proxy can use workforce identities for HTTPS apps. That is still not Cloud Armor. Armor remains the edge WAF if the app is on a Google load balancer ([Cloud Armor](/blog/gcp-cloud-armor-security-guide/)).

**Audit logs.** `principalEmail` may look like a subject URL, not `user@`. SIEM rules that regex `@yourcompany.com` will miss vendor access. Update detections; this is a [CIEM](/blog/ciem-explained-for-cloud-teams/) inventory problem.

**Pool admin blast radius.** `roles/iam.workforcePoolAdmin` at org can change mappings to `google.groups = "admins"` for everyone. Treat pool admin as privileged; PIM-equivalent reviews on who can `workforce-pools providers update`.

**Clock and JWKS.** OIDC provider JWKS URI wrong → all sign-ins fail. SAML cert expiry is the annual outage. Alert on provider update and cert `notAfter`.

```bash
gcloud iam workforce-pools providers list --workforce-pool="${POOL}" --location=global
```

Do not grant workforce groups `roles/iam.securityAdmin` “so they can debug SSO.” Platform owns the pool; vendors own data roles inside their folder.

## Checklist

- [ ] Workforce pool + provider at org; not a workload pool reused for humans
- [ ] Attribute mapping dumps a real token; `google.groups` matches IAM `principalSet` group ids
- [ ] Attribute condition limits who can federate; IdP app assignment kept tight
- [ ] Console workforce URL documented; consumer Gmail not used as a back door
- [ ] IAM on groups, not individual subjects; leavers = IdP group removal
- [ ] Log pipelines understand workforce principal URLs
- [ ] Pool admin role tightly held; provider cert/JWKS monitored
- [ ] CLI/ADC instructions for humans; automation stays on workload identity

**Related:** [GCP IAM security hardening](/blog/gcp-iam-security-hardening/) · [CIEM explained](/blog/ciem-explained-for-cloud-teams/)
