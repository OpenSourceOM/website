---
title: "GCP IAM Deny Policies: How They Override Allows"
description: "GCP IAM deny policies evaluate after the allow union: attachment points, a key-creation deny you can test, lockout paths, and exceptions that do not become standing admin."
pubDate: 2026-08-27
updatedDate: 2026-08-27
author: OpenSourceOM Team
tags:
  - GCP
  - IAM deny
  - CIEM
  - Google Cloud
  - governance
focusKeyword: GCP IAM deny policies
faq:
  - question: If a custom role includes iam.serviceAccountKeys.create, does a deny still block it?
    answer: >-
      Yes. Effective access is the union of applicable allow bindings
      minus matching deny rules. A deny on iam.googleapis.com/serviceAccountKeys.create
      wins even when roles/iam.serviceAccountKeyAdmin is bound. Org policy
      constraints on key creation are a second, independent plane—use
      both if you want API deny plus a constraint on the resource type.
  - question: Where can I attach a deny policy?
    answer: >-
      Organization, folder, or project. Not on a single bucket or SA.
      Inheritance is downward: a folder deny applies to projects under
      that folder. There is no “deny at resource” equivalent to a
      bucket IAM policy. Attachment point mistakes are the usual
      “we deployed it but keys still create” bug.
  - question: Does deny delete existing service account keys?
    answer: >-
      No. It blocks the create (and any other denied) permission going
      forward. Keys already in GitHub remain valid until you disable
      or delete them. Pair deny with an inventory of keys and rotation,
      not with a belief that deny is a wipe.
  - question: How do exception principals interact with tags?
    answer: >-
      A deny rule can list exceptionPrincipals and/or exception
      conditions (including tags on the resource). Exceptions are
      standing holes. Prefer a break-glass group with hardware MFA and
      access reviews, not principalSet://goog/public:all minus nothing.
      Tag exceptions that nobody owns become the new allow.
---

GCP allow policies are additive: every matching binding counts. **IAM deny policies** sit on top of that union and subtract. If you only read the project IAM page, you will not see them. If you only add more allows, you will not beat them.

This is the deny evaluation page: math, attachment, a concrete key-creation policy, lockout. Broader IAM hygiene (basic roles, default Compute SA, federation) stays in [GCP IAM security hardening](/blog/gcp-iam-security-hardening/). Do not treat deny as a way to keep Editor “but without keys”; remove the Editor binding too. Official overview: [IAM deny](https://cloud.google.com/iam/docs/deny-overview).

## Allow union minus deny

Evaluation order that operators actually need:

1. Collect every allow binding that applies (org + folder + project + resource) including conditions that pass.
2. Collect every deny rule that applies at org, folder, and project on the path.
3. If **any** deny rule matches the principal and permission (and its condition is true), the request is denied—unless the principal is excepted on **that** rule.
4. Otherwise, if any allow remains, the request is allowed.

There is no “most specific allow wins.” A project Owner does not override a folder deny. Conditions on the **allow** never punch through a deny.

```bash
# Deny policies are not listed by get-iam-policy
gcloud projects get-iam-policy "${PROJECT_ID}" --format=json | jq '.bindings | length'

gcloud iam policies list \
  --attachment-point="cloudresourcemanager.googleapis.com/folders/${FOLDER_ID}" \
  --kind=denypolicies
```

Failure mode: Policy Intelligence “who can create keys?” still shows a custom role that includes the permission. Analyzer’s allow graph can lag deny, or you queried before the deny etag propagated. Prove with a real API call from a test user, not only the analyzer screenshot.

Permissions in deny rules use the **IAM deny permission format** `service.googleapis.com/resource.verb` (for example `iam.googleapis.com/serviceAccountKeys.create`), not always the same string you put in a custom role. Wrong spelling = deny never matches = false sense of safety.

## Attachment points

| Attachment | Applies to | Use |
| --- | --- | --- |
| Organization | Entire org | Permissions no human should have anywhere (`resourcemanager.googleapis.com/organizations.setIamPolicy` except break-glass) |
| Folder | That folder and descendants | Nonprod experiments; prod folder key-creation deny |
| Project | That project only | Team-specific denials you are not ready to lift to the folder |

```bash
gcloud iam policies create deny-sa-keys-prod \
  --attachment-point="cloudresourcemanager.googleapis.com/folders/${PROD_FOLDER}" \
  --kind=denypolicies \
  --policy-file=deny-sa-keys.yaml
```

You cannot attach a deny policy to `//cloudresourcemanager.googleapis.com/projects/P/buckets/B`. If the goal is “this bucket is not publicly writable,” that is IAM on the bucket plus org policy `storage.publicAccessPrevention`, not a deny policy.

Failure mode: policy created on a **project** that is not the one CI uses (separate project for Cloud Build). Keys still get created in the Build project. List deny policies at org, each folder on the path, and the project.

Limit: a limited number of deny policies per attachment point. Do not mint one policy per permission; group related denies.

## Example deny on key creation

`deny-sa-keys.yaml`:

```yaml
displayName: Deny service account key creation
rules:
  - denyRule:
      deniedPrincipals:
        - principalSet://goog/public:all
      deniedPermissions:
        - iam.googleapis.com/serviceAccountKeys.create
        - iam.googleapis.com/serviceAccountKeys.upload
      exceptionPrincipals:
        - principalSet://goog/group/gcp-breakglass@example.com
```

Test on a **nonprod** folder first:

```bash
# As a normal user in the test project (should fail after deny)
gcloud iam service-accounts keys create /tmp/k.json \
  --iam-account="test-sa@${PROJECT}.iam.gserviceaccount.com"

# Expect PERMISSION_DENIED citing deny
```

Then delete `/tmp/k.json` if it succeeded (you are not done). Inventory leftovers:

```bash
gcloud iam service-accounts keys list --iam-account="${SA}" --format="table(name,validAfterTime)"
```

Org policy `iam.disableServiceAccountKeyCreation` still matters: it blocks the same class of mistake at the constraint layer and shows up in a different console. Deny is the IAM-plane backstop when someone has a role that includes key APIs. The hardening guide walks the constraint + federation sequence; this file is the deny JSON and the lockout story.

Failure mode: `deniedPrincipals` set to a single user while CI uses a **service account**. The SA is not that user. Use `principalSet://goog/public:all` plus a tight exception group, or list `principal://iam.googleapis.com/projects/.../serviceAccounts/...` explicitly if you must.

## Lockout risks

Deny `*.setIamPolicy` / `iam.googleapis.com/policies.*` without an exception and you cannot patch the deny policy. Deny `orgpolicy.googleapis.com/policy.set` and you cannot relax a constraint either. The support ticket is real.

Safer rollout:

1. Attach on a nonprod folder with exception = your admin group **and** a second break-glass group.
2. Confirm a throwaway user is denied; confirm break-glass can still `gcloud iam policies update`.
3. Only then clone to prod folder.
4. Never start with org-level `deniedPermissions: ["*"]`.

```bash
gcloud iam policies get deny-sa-keys-prod \
  --attachment-point="cloudresourcemanager.googleapis.com/folders/${PROD_FOLDER}" \
  --kind=denypolicies
```

If you are already locked out, org-level break-glass (stored hardware keys, not in the denied group) must still hold `roles/iam.denyAdmin` or equivalent **outside** the denied principal set. Document that identity in the runbook; do not store it in the same IdP group you just denied.

Failure mode: exception group synced from everyone in Engineering. Deny becomes theater. Membership of the exception group is a [CIEM](/blog/ciem-explained-for-cloud-teams/) control, same as a standing Owner.

When a public Cloud Run SA can still `bigquery.tables.getData`, deny did not cause that—the allow bindings did. Path ranking is [attack path analysis](/blog/attack-path-analysis-cloud-security/). Deny is for permissions that should not exist even when someone pastes a wide role.

## Checklist

- [ ] Deny policies listed at org + prod folder + project; not inferred from get-iam-policy
- [ ] Permission strings verified against deny-permission format; test call from a non-excepted user
- [ ] Key-create/upload denied on prod folder; existing keys inventoried and deleted
- [ ] Exception group is break-glass, reviewed, not `allUsers` of Engineering
- [ ] Update permission on the deny policy itself still held by a tested identity
- [ ] Nonprod folder used as the canary; org-wide deny last
- [ ] Editor/Owner removal still done per [GCP IAM hardening](/blog/gcp-iam-security-hardening/)—deny is not a substitute

**Related:** [GCP IAM security hardening](/blog/gcp-iam-security-hardening/) · [CIEM explained](/blog/ciem-explained-for-cloud-teams/)
