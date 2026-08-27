---
title: "Azure Federated Identity Credentials Instead of Client Secrets"
description: "Replace app-registration client secrets in GitHub Actions with Azure federated identity credentials: OIDC issuer, subject, audience, leftover secrets, and az commands."
pubDate: 2026-08-27
updatedDate: 2026-08-27
author: OpenSourceOM Team
tags:
  - Azure
  - Entra ID
  - federated identity
  - CIEM
  - GitHub Actions
focusKeyword: Azure federated identity credentials
faq:
  - question: Does a federated credential replace the app registration?
    answer: >-
      No. The app registration (or a user-assigned managed identity) remains
      the Entra principal that receives Azure RBAC. A federated identity
      credential is a trust rule on that principal: which token issuer,
      subject, and audience Azure will exchange for an Entra access token.
      Delete the client secret after the trust rule works; do not delete the app.
  - question: Why does azure/login fail with AADSTS70021 or AADSTS700016?
    answer: >-
      AADSTS70021 usually means the GitHub OIDC subject does not match the
      federated credential (wrong repo, ref, or environment name, including
      case). AADSTS700016 means the client ID is not an app in that tenant.
      Dump the GitHub id-token claims in a debug job and compare issuer,
      sub, and aud to az ad app federated-credential show.
  - question: Can I put federated credentials on a user-assigned managed identity?
    answer: >-
      Yes. User-assigned identities support federated credentials and avoid
      creating a separate app registration. Use the identity’s client ID in
      azure/login. App registrations are still required when a non-Azure
      product expects an application object (some SaaS, some OAuth client
      credentials flows).
  - question: Is a repo-wide subject safe for production subscriptions?
    answer: >-
      No. repo:ORG/REPO:* lets every branch, tag, and pull_request job
      request a token. Pin subject to an environment (with required
      reviewers) or to refs/heads/main. Treat a wildcard subject as a
      standing credential in CIEM reviews.
---

A GitHub secret named `AZURE_CLIENT_SECRET` is a password for an Entra app that often has `Contributor` on a subscription. Anyone who can read Actions secrets, a forked workflow that exfiltrates `secrets.*`, or a leaked `.env` from a self-hosted runner owns that app until you rotate. **Azure federated identity credentials** replace that password with a short-lived GitHub OIDC token Azure will exchange only if issuer, subject, and audience match.

This page is the CI cutover: app (or user-assigned identity) + federated credential + `azure/login` + delete the secret. It is not a [CIEM](/blog/ciem-explained-for-cloud-teams/) explainer and not a landing-zone RBAC design. Product docs: [federated identity credentials](https://learn.microsoft.com/en-us/entra/workload-id/workload-identity-federation).

## Client secrets in CI

Inventory before you invent a new app:

```bash
# Apps with password credentials still present
az ad app list --all --query "[?passwordCredentials[0]!=null].{app:displayName,id:appId,secrets:passwordCredentials[].endDateTime}" -o json

# Who can use this app in Azure (object id, not app id)
az role assignment list --assignee "${APP_OBJECT_ID}" --all -o table
```

Failure mode: you rotate `AZURE_CLIENT_SECRET` in GitHub and leave the old password on the app. Entra keeps both until expiry. `az ad app credential list --id "${APP_ID}"` is the source of truth, not the GitHub UI.

Typical blast radius of a stolen CI secret:

| Binding on the app | What a leaked secret can do |
| --- | --- |
| `Contributor` on the subscription | Deploy, delete, read most data-plane APIs the RG allows |
| `User Access Administrator` | Grant itself Owner; standing admin |
| `Key Vault Secrets Officer` on prod vault | Dump secrets the pipeline was meant to inject one at a time |

Pipelines that print `az account get-access-token` into logs are the same class of bug as committing the secret. Federation does not help if the job then writes a refresh token to an artifact.

## Federated credentials on app registrations

Create (or reuse) an app registration used **only** for this repo’s production environment. Assign RBAC to the service principal, then add the federated credential.

```bash
APP_ID="$(az ad app create --display-name "gha-payments-prod" --query appId -o tsv)"
az ad sp create --id "${APP_ID}"

az ad app federated-credential create --id "${APP_ID}" --parameters '{
  "name": "github-prod-env",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:myorg/payments:environment:prod",
  "description": "GitHub Actions environment prod",
  "audiences": ["api://AzureADTokenExchange"]
}'
```

User-assigned managed identity variant (no app registration):

```bash
az identity federated-credential create \
  --name github-prod-env \
  --identity-name mi-gha-payments \
  --resource-group rg-identity \
  --issuer "https://token.actions.githubusercontent.com" \
  --subject "repo:myorg/payments:environment:prod" \
  --audience "api://AzureADTokenExchange"
```

Failure mode: federated credential on app A, RBAC on app B (or on a leftover SP from a tutorial). `azure/login` succeeds (token exchange) then every ARM call returns 403. Match **client ID** in the workflow to the principal that has the role assignment.

GitHub job:

```yaml
permissions:
  id-token: write
  contents: read
jobs:
  deploy:
    environment: prod
    steps:
      - uses: azure/login@v2
        with:
          client-id: ${{ vars.AZURE_CLIENT_ID }}
          tenant-id: ${{ vars.AZURE_TENANT_ID }}
          subscription-id: ${{ vars.AZURE_SUBSCRIPTION_ID }}
```

After three green deploys, delete passwords:

```bash
az ad app credential reset --id "${APP_ID}" --append false --years 1  # do not; this creates a new secret
# Instead delete each secret by key id:
az ad app credential delete --id "${APP_ID}" --key-id "${KEY_ID}"
```

`credential reset` is a trap: it mints a new client secret. You are trying to have **zero** secrets.

## GitHub OIDC issuer settings

Issuer for GitHub-hosted and most GitHub Enterprise Cloud jobs is `https://token.actions.githubusercontent.com`. GitHub Enterprise Server uses your GHE hostname; a cloud issuer string will never match.

Subject must be exact. Common shapes:

| Intent | `subject` |
| --- | --- |
| One environment with required reviewers | `repo:ORG/REPO:environment:prod` |
| Only the default branch | `repo:ORG/REPO:ref:refs/heads/main` |
| Pull requests (usually nonprod only) | `repo:ORG/REPO:pull_request` |

Audience for Azure is `api://AzureADTokenExchange` unless you set a custom audience on both the credential and the login action. A mismatch is a silent AADSTS error, not a GitHub “secret missing” error.

Reusable workflows: the `sub` claim is the **caller** repo, not the reusable-workflow repo, unless you opted into the reusable-workflow subject. Copy-pasting a credential from the template repo into production is the usual Monday outage.

Failure mode: `environment:Production` in GitHub and `environment:prod` in Entra. Names are case-sensitive. Another: branch protection off, subject pinned to `main`, and developers merging unsigned commits—federation authenticates GitHub, not your code review policy.

Decode the token GitHub minted (`ACTIONS_ID_TOKEN_REQUEST_URL`) in a throwaway job and compare claims to:

```bash
az ad app federated-credential list --id "${APP_ID}" -o json
```

## What still uses secrets

Federation does not empty Key Vault. These still need a secret **or** a different trust:

- Confidential OAuth clients (web apps exchanging a client secret for user tokens)—that is not GitHub OIDC.
- SaaS that only stores `tenant_id / client_id / client_secret` and cannot send an OIDC assertion.
- Azure DevOps service connections not converted to workload identity federation (different issuer: `https://vstoken.dev.azure.com/{org}`).
- Jenkins / old self-hosted agents with no OIDC issuer you can list on the app.
- Storage account keys, SQL admin passwords, ACR admin user—those are resource keys, not Entra client secrets. Kill admin users; use RBAC and federation for the pipeline identity.

If a vendor cannot federate, mint a secret with a 90-day expiry, store it in GitHub **environment** secrets (not repo secrets), alert on `Add service principal credentials` in Entra audit logs, and track it as a CIEM exception with an owner. Standing `Contributor` + never-expiring password is the [toxic combination](/blog/toxic-combinations-aws-azure/) pattern; federation removes one half.

Graph the leftover: every app with `passwordCredentials` **and** a role assignment on a production subscription. That query belongs in [attack path analysis](/blog/attack-path-analysis-cloud-security/) once the identity is a node; this page is the cutover so those nodes stop being long-lived secrets.

## Checklist

- [ ] One app or user-assigned identity per production GitHub environment; RBAC on that object id
- [ ] Federated credential issuer/subject/audience match a **decoded** GitHub id-token
- [ ] Subject is environment- or ref-scoped, not `repo:ORG/REPO:*`
- [ ] `azure/login` uses client id + tenant + subscription; no `creds` JSON
- [ ] `az ad app credential list` empty (or only documented vendor exceptions with expiry)
- [ ] Entra audit alert on new password credentials for pipeline apps
- [ ] Azure DevOps / Jenkins called out separately; do not assume GitHub settings apply

**Related:** [CIEM explained](/blog/ciem-explained-for-cloud-teams/) · [Zero trust cloud architecture](/blog/zero-trust-cloud-architecture-guide/)
