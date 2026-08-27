---
title: "GCP IAM Security Hardening: Roles, Conditions, and Service Accounts"
description: "Stop using basic roles and JSON keys: folder inheritance, IAM deny policies, organization constraints, Workload Identity Federation, and the default Compute SA."
pubDate: 2026-08-27
updatedDate: 2026-08-27
author: OpenSourceOM Team
tags:
  - GCP
  - IAM
  - CIEM
  - cloud security
  - Google Cloud
focusKeyword: GCP IAM security
faq:
  - question: Why is Editor at the folder so much worse than Editor on one project?
    answer: Folder bindings inherit to every project created under that folder, including projects that do not exist yet. A “platform admin” group with roles/editor on prod-folder is standing admin on next quarter’s acquisitions. Project-level Editor is already too broad; folder-level Editor is a factory for it.
  - question: How do I stop new service account keys?
    answer: Set organization policy iam.disableServiceAccountKeyCreation (and disableServiceAccountKeyUpload if you need it). Move GKE to Workload Identity, GCE to attached service accounts, and CI to Workload Identity Federation. Then inventory remaining keys with Policy Intelligence and delete them.
  - question: Do IAM Conditions replace custom roles?
    answer: No. Conditions restrict when a binding applies (resource name, time, CEL on attributes). They do not remove extra permissions inside roles/editor. Start by replacing basic roles, then add conditions for time-boxed or resource-prefixed access.
  - question: What about deny policies vs allow bindings?
    answer: IAM deny policies (and principal access boundaries, where you use them) sit on top of allow bindings. A deny on iam.serviceAccountKeys.create will block a custom role that still includes that permission. Test denies in a non-prod folder; they are easy to lock yourself out with.
---

This is **Google Cloud IAM mechanics**: inheritance, basic roles, the default Compute service account, JSON keys, org constraints, and deny policies. It is not a multi-cloud CIEM explainer ([CIEM explained](/blog/ciem-explained-for-cloud-teams/)) and not SCC setup. Source of truth: [IAM overview](https://cloud.google.com/iam/docs/overview) and [organization policy constraints](https://cloud.google.com/resource-manager/docs/organization-policy/org-policy-constraints).

```
Organization
  └── Folder: prod          ← never put roles/editor here
        ├── Folder: prod-app-a
        └── Project: payments-prod
  └── Folder: nonprod       ← experiment with denies here
```

Effective permission = union of org + folder + project + resource bindings, **minus** deny policies. Inheritance is the usual outage-and-breach mechanism.

## 1. Find the inherited Editor you forgot

```bash
gcloud asset search-all-iam-policies \
  --scope="organizations/${ORG_ID}" \
  --query='policy:roles/editor OR policy:roles/owner OR policy:roles/viewer'
```

Policy Analyzer (`gcloud policy-intelligence`) answers “who can `resourcemanager.projects.setIamPolicy` on this project?” before you revoke a group and break Terraform.

Failure mode: you remove `roles/editor` from the project, but a folder two levels up still grants it to `group:eng@`. The project IAM page looks clean. Asset search does not.

## 2. Basic roles are not a starter kit

`roles/owner`, `roles/editor`, and `roles/viewer` include thousands of permissions. Replace with predefined roles (`roles/storage.objectViewer`, `roles/compute.instanceAdmin.v1`) or a **custom role** whose permission list you review.

Do not mint a custom role that is Editor minus two permissions. That is Editor.

Groups via Cloud Identity, not 80 individual `user:` bindings. Treat `group:gcp-prod-admins@` membership as a production change.

## 3. The default Compute service account is Editor

New projects still get `PROJECT_NUMBER-compute@developer.gserviceaccount.com` with **Editor** unless you change the org. That SA is what GCE and many GKE nodes use if you do not set a custom SA.

```bash
# Org policy: skip default network and constrain SA key creation
gcloud org-policies set-policy policy-disable-sa-keys.yaml --project="${PROJECT_ID}"
```

Example constraint (YAML) for keys:

```yaml
name: organizations/ORG_ID/policies/iam.disableServiceAccountKeyCreation
spec:
  rules:
    - enforce: true
```

Also set `iam.automaticIamGrantsForDefaultServiceAccounts` so new projects do not auto-grant Editor to the default Compute SA.

Failure mode: GKE Workload Identity is “on,” but node pools still use the default Compute SA for image pulls and logging. Compromise the node, get Editor.

## 4. Keys, federation, then deny

Order of operations:

1. Org policy **deny new keys**.
2. GKE **Workload Identity**; GCE **attached SA** with a custom role; GitHub Actions **Workload Identity Federation** (no JSON in GitHub secrets).
3. List remaining keys; delete; alert on `google.iam.v1.AuditData` for `CreateServiceAccountKey`.

```bash
gcloud iam service-accounts keys list --iam-account="${SA}" --format='table(name,validAfterTime)'
```

A key in a repo is not a “secret scanning finding.” It is standing admin until you disable `iam.disableServiceAccountKeyCreation` and rotate.

## 5. IAM Conditions are CEL, not least privilege

Conditions on a binding, for example object prefix or expiry:

```
resource.name.startsWith("projects/_/buckets/prod-payments/") &&
request.time < timestamp("2026-12-31T00:00:00Z")
```

They do not shrink `roles/editor`. Use them for break-glass (time) and for bucket-prefix grants after the role is already tight.

**IAM deny policies** are the other lever: deny `iam.serviceAccountKeys.create` or `resourcemanager.organizations.setIamPolicy` even if an allow binding says yes. Prototype on `nonprod` folder. A deny on `*` at org level is a support ticket.

## 6. What to review on a cadence (GCP-specific)

| When | What |
| --- | --- |
| Every apply | Folder/org IAM diffs in Terraform (`google_folder_iam_binding` vs additive `member`) |
| Weekly | New `roles/owner` or `roles/editor` at folder/org (Asset Search or SCC) |
| Monthly | IAM Recommender: unused bindings; do not auto-apply on org-level groups |
| On incident | Break-glass users, `setIamPolicy` on org, key creation |

Principal Access Boundary policies (where enabled) cap maximum permissions for a set of principals. They are not a substitute for deleting Editor on the prod folder.

When a public Cloud Run service uses an SA that can `bigquery.tables.getData`, that pairing is a [toxic combination](/blog/toxic-combinations-aws-azure/)—after you have removed folder Editor and JSON keys. Do not skip those for a graph demo.

## Checklist

- [ ] No `roles/owner` or `roles/editor` on org or prod folders
- [ ] Default Compute SA not Editor; custom SAs on GCE/GKE
- [ ] `iam.disableServiceAccountKeyCreation` enforced; WIF for CI
- [ ] Asset Search for leftover basic roles
- [ ] Deny policies tested in nonprod before org
- [ ] Break-glass accounts: hardware MFA, logged, unused day-to-day

## Key takeaways

- **Folder inheritance** is how Editor becomes infinite. Search the org, not the project IAM panel.
- **Default Compute SA + Editor** is the GCE/GKE footgun. Turn off automatic grants.
- **Org policy on keys** then federation; scanners will not outrun a key in CI.
- **Conditions and denies** refine bindings; they do not replace removing basic roles.

---
**Related:** [CIEM explained](/blog/ciem-explained-for-cloud-teams/) · [Cloud Armor operator guide](/blog/gcp-cloud-armor-security-guide/)
