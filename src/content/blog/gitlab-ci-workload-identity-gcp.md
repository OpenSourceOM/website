---
title: "GitLab CI to GCP with Workload Identity Federation"
description: "GitLab CI Workload Identity Federation: attribute mapping, protected branches, leftover JSON keys, and when Cloud Build is the better runner than GitLab."
pubDate: 2026-08-27
updatedDate: 2026-08-27
author: OpenSourceOM Team
tags:
  - GitLab CI
  - Workload Identity Federation
  - GCP
  - IAM
  - DevSecOps
focusKeyword: GitLab CI Workload Identity Federation
faq:
  - question: Can GitLab CI use GCP Workload Identity Federation without a JSON key?
    answer: >-
      Yes. GitLab’s OIDC JWT is the external identity. You map attributes
      (project_path, ref, ref_type) into a Google principal, then bind a
      service account. No downloaded JSON key belongs in CI variables.
  - question: Why do we still find service account keys after enabling WIF?
    answer: >-
      Because nobody disabled key creation or deleted the old key. WIF is
      additive until you revoke keys and set
      iam.disableServiceAccountKeyCreation. Inventory keys every week until
      the count is zero for CI accounts.
  - question: Should production deploys use GitLab runners or Cloud Build?
    answer: >-
      If the runner is shared, auto-scaled, or has a Docker socket, prefer
      Cloud Build or a locked runner tag that only protected branches can
      use. WIF authenticates GCP; it does not make a dirty runner trustworthy.
---

The CI variable named `GCP_SA_KEY` is a user-managed service account key. It does not expire when the pipeline ends. **GitLab CI Workload Identity Federation** replaces that file with a JWT GitLab already issues, mapped into Google IAM.

How folders, basic roles, and org constraints fit together is [GCP IAM hardening](/blog/gcp-iam-security-hardening/). This page is the GitLab → Google trust.

```
GitLab job
  → OIDC JWT (iss = GitLab, sub = project_path + …)
      → Workload Identity Pool / Provider (attribute mapping)
          → impersonate SA  deploy-payments@proj.iam.gserviceaccount.com
```

## Attribute mapping

Create a pool and an OIDC provider whose issuer is your GitLab URL (`https://gitlab.com` or `https://gitlab.example.com`).

```bash
gcloud iam workload-identity-pools create gitlab-pool \
  --location=global \
  --project=prod-project

gcloud iam workload-identity-pools providers create-oidc gitlab-provider \
  --location=global \
  --workload-identity-pool=gitlab-pool \
  --issuer-uri="https://gitlab.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.project_path=assertion.project_path,attribute.ref=assertion.ref,attribute.ref_type=assertion.ref_type,attribute.namespace_path=assertion.namespace_path" \
  --attribute-condition="assertion.project_path=='your-group/payments' && assertion.ref_type=='branch' && assertion.ref=='refs/heads/main'" \
  --project=prod-project
```

`attribute-condition` is the CEL Google evaluates **before** a token is accepted. Putting the repo name only in the IAM binding and leaving the provider wide (`true`) means every GitLab project on that issuer can attempt the exchange. Fail closed at the provider.

GitLab JWT claims you actually use (names differ slightly on self-managed; dump one token):

| Claim | Map to | Bind on |
| --- | --- | --- |
| `project_path` | `attribute.project_path` | `your-group/payments` |
| `ref` | `attribute.ref` | `refs/heads/main` |
| `ref_type` | `attribute.ref_type` | `branch` (not `tag` unless you intend tags) |
| `environment` | custom | GitLab environment `production` if you use it |
| `sub` | `google.subject` | unique job identity; do not IAM-bind `*` |

Bind the Google SA:

```bash
gcloud iam service-accounts add-iam-policy-binding \
  deploy-payments@prod-project.iam.gserviceaccount.com \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/gitlab-pool/attribute.project_path/your-group/payments"
```

If the member is `principalSet://.../gitlab-pool/*`, you did not map attributes; you federated the whole of GitLab.com. That is worse than a JSON key sitting in one project.

`.gitlab-ci.yml` (GitLab 16+ id_tokens):

```yaml
deploy:
  id_tokens:
    GITLAB_OIDC_TOKEN:
      aud: https://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/gitlab-pool/providers/gitlab-provider
  script:
    - echo "$GITLAB_OIDC_TOKEN" > /tmp/gitlab.jwt
    - gcloud iam workload-identity-pools create-cred-config \
        projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/gitlab-pool/providers/gitlab-provider \
        --output-file=/tmp/cred.json \
        --service-account=deploy-payments@prod-project.iam.gserviceaccount.com \
        --credential-source-file=/tmp/gitlab.jwt
    - export CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE=/tmp/cred.json
    - gcloud storage cp app.tar gs://payments-artifacts/
```

`aud` on the GitLab `id_tokens` block must match what the provider expects. Mismatch is a cryptic STS-style error from Google.

## Protected branches

WIF `attribute-condition` on `refs/heads/main` is necessary and **not sufficient** if `main` is not a protected branch. Anyone who can push `main` is a GCP deployer.

GitLab settings:

- Protect `main`: no force push, allowed to merge = maintainers, allowed to push = none (merge trains only)
- Protected environments: `production` may run only on protected branches
- Disable `CI_JOB_TOKEN` access from other projects unless you know why
- `id_tokens` job must not run on `merge_request_event` with the prod SA

A pipeline on a tag `v1.2.3` that anyone can push is another `ref`. If your condition allows `ref_type == 'tag'`, treat tag creation as a release-signing event, not a developer convenience.

Self-managed GitLab: the issuer URI is your instance. A second GitLab (shadow IT) with a cloned issuer URL will not match. A mis-set issuer of `https://gitlab.com` on a self-managed JWT will fail — good — unless you accidentally created two providers.

Forks: `project_path` on a fork is `attacker/payments`. Your condition on `your-group/payments` should reject it. `pull_request` equivalent in GitLab is merge request pipelines from forks — do not grant them `workloadIdentityUser` on the prod SA.

## JSON keys leftover

WIF does not delete keys. The old key in GitLab CI/CD variables still works from a laptop.

```bash
# Keys that should not exist for CI SAs
gcloud iam service-accounts keys list \
  --iam-account=deploy-payments@prod-project.iam.gserviceaccount.com

# Org constraint so nobody creates new ones
gcloud org-policies set-policy policy-disable-sa-keys.yaml
# constraint: iam.disableServiceAccountKeyCreation
```

Then delete GitLab CI variables `GCP_SA_KEY`, `GOOGLE_APPLICATION_CREDENTIALS` file contents, and any Base64 blob in Vault that is the same key. Rotate: disable the user-managed key, watch Cloud Audit Logs for `google.iam.admin.v1.CreateServiceAccountKey` and for auth events still using the key ID, then delete.

Policy Intelligence / IAM Recommender will not tell you a GitLab variable exists. Export CI variable names from GitLab’s API and grep for `BEGIN PRIVATE KEY`.

Default Compute Engine SA JSON keys are a different finding; still kill them. WIF for GitLab does not fix GCE.

If a key must remain for a vendor that cannot do OIDC, it is not a GitLab CI key. Put it in a break-glass project with an expiry ticket, not in `.gitlab-ci.yml`.

## Cloud Build vs GitLab runners

| Executor | Authenticates to GCP via | Residual risk |
| --- | --- | --- |
| GitLab.com shared runners + WIF | OIDC JWT | Job is on GitLab’s fleet; token lifetime is the job. Supply chain of the image you run is GitLab’s. |
| Self-hosted GitLab runner + WIF | Same JWT | Runner can steal the JWT, Docker socket, or cache credentials. Tag + protected runners only. |
| Cloud Build trigger on GitLab repo | Cloud Build SA / WI | No GitLab runner; Google executes the build. IAM on the Cloud Build SA is the blast radius. |
| Cloud Build + GitLab bridge | Mixed | Two principals; easy to leave the JSON key “for the bridge.” |

Use Cloud Build when: you do not want a GitLab runner in the prod GCP project, or you already deny SA keys and want Google-hosted isolation. Use GitLab runners when: the pipeline must talk to GitLab container registry, on-prem, and GCP in one job — then **protected runners**, no privileged mode, no `/var/run/docker.sock`.

WIF on a privileged Kubernetes executor in GitLab is still “that pod’s token plus cluster RBAC.” Do not confuse federation with pod isolation.

Cloud Build service accounts with `roles/editor` are the same class of mistake as a GitLab JSON key. Custom role, one trigger, one region.

## Checklist

- [ ] Provider `attribute-condition` pins `project_path` and `ref` (or GitLab environment), not `true`
- [ ] IAM member is `principalSet` on a specific attribute, not the whole pool
- [ ] `id_tokens` `aud` matches the provider; job not on fork MRs
- [ ] `main` (or release branch) is protected; prod environment is protected
- [ ] `gcloud iam service-accounts keys list` is empty for the deploy SA
- [ ] Org policy `iam.disableServiceAccountKeyCreation` on the folder
- [ ] Runner model written down: shared vs protected vs Cloud Build; no Docker socket on prod deployers

Federation is an IAM mapping. GitLab still decides who can run a job on `main`. Google still decides what that SA can call. Fix all three or the JSON key will come back as a “temporary” exception.
