---
title: "GCP Principal Access Boundaries Explained"
description: "Principal Access Boundary policies cap which resources a principal can touch: PAB vs IAM deny vs org policy, a contractor example, and how to test before binding."
pubDate: 2026-08-27
updatedDate: 2026-08-27
author: OpenSourceOM Team
tags:
  - GCP
  - Principal Access Boundary
  - IAM
  - CIEM
  - workforce identity
focusKeyword: GCP principal access boundary
faq:
  - question: Does a Principal Access Boundary grant any IAM roles?
    answer: >-
      No. PAB is a ceiling on which resources a principal may access. The
      principal still needs allow bindings for the API calls. If PAB
      says “only this folder” and IAM says roles/viewer on the org, the
      effective set is viewer inside that folder (plus whatever the PAB
      resource list includes), not viewer on the org.
  - question: How is PAB different from an IAM deny policy?
    answer: >-
      Deny subtracts permissions (cannot create keys, cannot setIamPolicy)
      wherever those APIs run. PAB subtracts resource scope (cannot
      touch projects outside this list) even when the permission is
      allowed. You often want both: deny on key creation, PAB on
      contractor identities so a mistaken folder Editor still cannot
      leave the sandbox folder.
  - question: Can I bind PAB to a workforce identity pool?
    answer: >-
      Yes. Principal sets for workforce pools (and workforce groups)
      are valid subjects for PAB bindings. That is the contractor
      pattern: humans who never get Cloud Identity users still cannot
      roam the org if someone grants them a wide role.
  - question: What happens if a PAB binding is too tight for Terraform?
    answer: >-
      Applies fail with permission denied on resources outside the
      boundary (state buckets, org-level IAM, Shared VPC host projects).
      Dry-run / Policy Simulator and a dedicated automation SA that is
      not under the contractor PAB are the fix—not disabling PAB on
      the humans’ group.
---

A principal with `roles/editor` on a folder can still be over-scoped if that folder was the wrong one. **Principal Access Boundary (PAB)** policies answer a different question than roles: *regardless of what IAM grants, which resource names is this principal allowed to see at all?*

PAB does not replace removing wide roles. It is a **ceiling** you put on people and pools you do not fully trust—contractors, acquired-company IdPs, break-glass that should only open one folder. General IAM mechanics remain in [GCP IAM security hardening](/blog/gcp-iam-security-hardening/). Docs: [principal access boundary](https://cloud.google.com/iam/docs/principal-access-boundary-policies).

## Ceiling on principals

Think of three layers:

```
Allow bindings     →  what APIs you may call, on which resources they name
Deny policies      →  APIs you may not call even if allowed
PAB                →  resource names you may never be authorized on
```

If PAB’s resource list is `folders/SANDBOX` (and descendants), then `resourcemanager.projects.get` on `folders/PROD` fails for that principal even when an allow binding says Editor at org. The org IAM page will still look frightening; the live token cannot use it.

```bash
gcloud iam principal-access-boundary-policies list --organization="${ORG_ID}"

gcloud iam principal-access-boundary-policies describe "${PAB_ID}" \
  --organization="${ORG_ID}"
```

Bindings attach the policy to **principals** (users, groups, workforce principal sets, some service accounts—confirm current supported types in the doc for your org). A PAB that exists but is not bound does nothing.

Failure mode: PAB lists the sandbox **project** but contractors need the Shared VPC **host** project to attach a NIC. Every GCE insert fails. The ceiling must include every resource the job honestly needs, or the job will demand org-wide Editor again.

Failure mode: you bound PAB to `user:ada@vendor.com` and the vendor signs in as a workforce subject `principal://iam.googleapis.com/.../subject/ada`. Different principal strings; PAB never applied.

## PAB vs IAM deny vs org policy

| Control | Stops | Does not stop |
| --- | --- | --- |
| IAM allow (roles) | Nothing by itself; it grants | Over-grant if you bind at the wrong folder |
| IAM deny | Listed permissions (key create, setIamPolicy) | Access to resources using **other** permissions |
| **PAB** | Access outside the resource boundary | A permission that is in-boundary (Editor inside sandbox is still Editor) |
| Org policy (managed or custom) | Resource **configuration** (no public IPs, no keys) | Who the principal is |

Use org policy so sandbox cannot create public IPs. Use deny so nobody creates SA keys. Use PAB so the contractor principal set cannot leave `folders/contractors`. Use allow so they can actually deploy in that folder.

PAB is a poor substitute for [CIEM](/blog/ciem-explained-for-cloud-teams/) reviews: a contractor with Editor **inside** a folder that contains a production replica is still a production admin. Boundary first, then least privilege inside it.

## Example for contractors

Goal: workforce-federated vendor engineers can administer `folders/vendors-acme` only.

```yaml
# pab-acme.yaml (illustrative fields — match current API schema)
displayName: acme-vendor-ceiling
details:
  rules:
    - description: Acme may only touch the vendor folder
      resources:
        - "//cloudresourcemanager.googleapis.com/folders/${ACME_FOLDER_ID}"
```

```bash
gcloud iam principal-access-boundary-policies create acme-vendor-ceiling \
  --organization="${ORG_ID}" \
  --policy-file=pab-acme.yaml

gcloud iam principal-access-boundary-policy-bindings create acme-binding \
  --organization="${ORG_ID}" \
  --policy="${PAB_RESOURCE_NAME}" \
  --target-principal="principalSet://iam.googleapis.com/locations/global/workforcePools/${POOL}/group/${ACME_GROUP}"
```

IAM inside the folder can stay `roles/compute.instanceAdmin.v1` + `roles/storage.objectAdmin` on a named bucket. If someone later adds `roles/editor` on the **org** to that same group, PAB should still keep them out of prod folders.

Include in the resource list (or a parent that contains them):

- The vendor folder
- Any Artifact Registry / Cloud Build project they must push to, if it lives outside the folder (better: move it in)
- Not: `folders/prod`, org, billing accounts they should not see

Failure mode: group claim from the IdP is `Acme-Admins` and you bound `acme-admins`. Workforce attribute mapping has to produce the same group string PAB uses. Test with one user before the whole vendor cohort.

## Testing

1. Create a throwaway project under the vendor folder; as the test workforce user, `gcloud projects describe` it—should work with the intended role.
2. `gcloud projects describe` a prod project—should fail with a PAB / authorization error, **even if** you temporarily bind Editor at org on that user (do this only in a drill, then remove the Editor).
3. Run Policy Simulator / IAM troubleshooter on a prod resource for that principal; confirm the PAB explanation appears (product UI names vary; if simulator ignores PAB in your release, the live API call is authoritative).
4. Terraform as the **automation** SA (not under the contractor PAB) against prod—must keep working. If platform automation was accidentally included in the principal set, you will see it here.

```bash
# Who is bound?
gcloud iam principal-access-boundary-policy-bindings list --organization="${ORG_ID}"
```

Roll out: bind PAB to a pilot group → 48 hours of tickets → expand. Do not bind `principalSet://goog/public:all` to a PAB that only lists one folder; you will freeze the org.

When PAB and deny disagree with a public workload still reaching BigQuery, that pairing is a [toxic combination](/blog/toxic-combinations-aws-azure/) **inside** the boundary. PAB did its job; the allow bindings inside the folder did not.

## Checklist

- [ ] PAB policy resource list is the intended folder (plus honestly required shared projects), not the org
- [ ] Binding principal string matches how users actually show up (workforce vs Cloud Identity vs SA)
- [ ] Deny policies still cover key creation / setIamPolicy; PAB is not a permission deny
- [ ] Org policies still constrain public IPs and keys inside the sandbox
- [ ] Live deny test: contractor can describe sandbox project, cannot describe prod
- [ ] Automation SAs used by platform Terraform are not under the contractor PAB
- [ ] Exception process documented (who can widen the resource list)

**Related:** [GCP IAM security hardening](/blog/gcp-iam-security-hardening/) · [CIEM explained](/blog/ciem-explained-for-cloud-teams/)
