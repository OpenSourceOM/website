---
title: "GitHub Actions OIDC to AWS IAM (No Long-Lived Keys)"
description: "GitHub Actions OIDC to AWS: trust policy sub and aud conditions, environment protection, wildcard subject claims, and how to debug InvalidIdentityToken."
pubDate: 2026-08-27
updatedDate: 2026-08-27
author: OpenSourceOM Team
tags:
  - GitHub Actions
  - OIDC
  - AWS IAM
  - CIEM
  - DevSecOps
focusKeyword: GitHub Actions OIDC AWS
faq:
  - question: Why is GitHub Actions OIDC better than AWS access keys in secrets?
    answer: >-
      The workflow receives a short-lived token from GitHub, AWS STS exchanges it
      for credentials, and nothing long-lived sits in GitHub Secrets. A leaked
      Actions log cannot replay yesterday’s session. A leaked AKIA key can, until
      you find it.
  - question: What must the IAM trust policy condition on?
    answer: >-
      aud must be sts.amazonaws.com (or your audience). sub must be the exact
      repo, and preferably the exact branch or environment, not repo:org/*.
      Without those StringEquals conditions, any GitHub repo that can request
      the same OIDC issuer can assume the role.
  - question: What does InvalidIdentityToken usually mean?
    answer: >-
      GitHub’s JWT was rejected by STS: wrong issuer URL, thumbprint mismatch
      on the OIDC provider, aud not matching the token, clock skew, or
      permissions: id-token: write missing so the action never got a JWT.
      Decode the token’s iss, aud, and sub before you rewrite the trust policy
      at random.
---

Delete the `AWS_ACCESS_KEY_ID` GitHub secret. The replacement is an OIDC provider in IAM plus a role the workflow assumes. **GitHub Actions OIDC AWS** is that trust policy, not “we turned on `aws-actions/configure-aws-credentials`.”

Org-level IAM hygiene (Identity Center for humans, no IAM users) is [AWS security best practices](/blog/aws-security-best-practices-2026/). This page is the CI principal.

```yaml
# .github/workflows/deploy.yml
permissions:
  id-token: write
  contents: read
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/gha-payments-prod
          aws-region: us-east-1
```

`permissions: id-token: write` is mandatory. Without it, GitHub never mints the JWT and you chase STS errors that look like IAM.

## Trust policy conditions (sub, aud)

Create the OIDC provider once per account (or once in a shared identity account):

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list ffffffffffffffffffffffffffffffffffffffff
```

GitHub documents that a dummy thumbprint is accepted because AWS now uses the trusted root store for this issuer; still verify [GitHub’s current OIDC thumbprint guidance](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services) before you copy a blog from 2021.

Trust policy on `gha-payments-prod`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": "repo:your-org/payments:environment:production"
        }
      }
    }
  ]
}
```

`aud` must match what the action requests (`sts.amazonaws.com` unless you set a custom audience). `sub` formats GitHub supports:

| `sub` | When to use |
| --- | --- |
| `repo:ORG/REPO:ref:refs/heads/main` | Deploy from `main` only |
| `repo:ORG/REPO:environment:production` | Deploy only from a GitHub Environment named `production` |
| `repo:ORG/REPO:pull_request` | Read-only PR jobs (never this role if it can `s3:PutObject` to prod) |

`StringLike` with `repo:your-org/payments:*` admits every ref, every PR, every environment. That is an access key with extra steps.

Confirm the provider:

```bash
aws iam get-open-id-connect-provider \
  --open-id-connect-provider-arn \
  arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com
```

Put the deploy role’s identity policy on least privilege (`cloudformation:Deploy` on one stack, not `AdministratorAccess`). OIDC does not shrink `*`. It only removes the long-lived key. Entitlement blast radius is still [CIEM](/blog/ciem-explained-for-cloud-teams/).

## Environment protection

GitHub Environments add a second gate **before** the job that requests the token:

- Required reviewers (humans) on `production`
- Wait timer
- Deployment branches: only `main`
- Secrets scoped to the environment (you should have none for AWS keys)

The IAM `sub` condition `environment:production` only matches if the **job** sets `environment: production`. A workflow that omits `environment:` cannot assume that role — unless you also allowed `ref:refs/heads/main` in a second statement. Prefer **one** statement: environment, not ref. PRs cannot set a protected environment without passing reviewers.

Self-hosted runners: environment protection does not make the runner trustworthy. A runner with extra disks can steal the OIDC token from the job’s filesystem for its lifetime (minutes). Use GitHub-hosted runners for prod assume-role, or lock self-hosted to a label that only protected environments use, with no Docker socket.

Disable “Allow GitHub Actions to create and approve pull requests” org-wide if you use `pull_request_target` with any AWS role. That combination is how OIDC becomes a confused deputy.

## Too-wide sub claims

Findings to grep for in Terraform/CloudFormation:

```hcl
Condition = {
  StringLike = {
    "token.actions.githubusercontent.com:sub" = "repo:your-org/*"
  }
}
```

That is every repo in the org, including a public fork-PR workflow if you mis-set `pull_request_target`. Narrow to `repo:your-org/payments:environment:production`.

Other wide patterns:

- `repo:your-org/payments:*` — every branch and every `environment:*`
- `token.actions.githubusercontent.com:sub` omitted — **any** GitHub token for that issuer
- `aud` omitted — tokens minted for another audience
- Same role used by `ci.yml` (unit tests) and `deploy.yml`

Split roles: `gha-payments-plan` (read-only) for PRs, `gha-payments-prod` (write) for the environment. Do not reuse prod on `workflow_dispatch` from arbitrary refs without a `sub` that names the ref.

```bash
# Inventory assume-role policies that mention GitHub OIDC
aws iam list-roles --query 'Roles[?AssumeRolePolicyDocument!=null].RoleName' --output text
# Then for each role:
aws iam get-role --role-name "$ROLE" --query 'Role.AssumeRolePolicyDocument'
```

Look for `token.actions.githubusercontent.com` and read the Condition block. No Condition is a P0.

## Debugging InvalidIdentityToken

`An error occurred (InvalidIdentityToken) when calling the AssumeRoleWithWebIdentity operation`

Work the JWT, not the role policy, first.

```bash
# Debug job only: mint the OIDC JWT and print claims (not the raw token)
TOKEN=$(curl -sS -H "Authorization: bearer ${ACTIONS_ID_TOKEN_REQUEST_TOKEN}" \
  "${ACTIONS_ID_TOKEN_REQUEST_URL}&audience=sts.amazonaws.com" | jq -r .value)
echo "$TOKEN" | cut -d. -f2 | tr '_-' '/+' | base64 -d 2>/dev/null | jq '{iss,aud,sub,exp}'
```

Do not echo `$TOKEN` into a public Actions log. Claims are enough.
Practical checks, in order:

1. **`permissions: id-token: write`** on the job or workflow. Missing → empty token → InvalidIdentityToken or a generic STS error.
2. **`iss`** is `https://token.actions.githubusercontent.com`. Enterprise Cloud with a unique issuer is a different URL; the IAM OIDC provider URL must match **exactly**.
3. **`aud`** in the JWT equals the trust policy `aud` (`sts.amazonaws.com`). `configure-aws-credentials` audience field must match.
4. **`sub`** exact string match. Extra slash, wrong repo case, `refs/heads/Main` vs `main`. GitHub’s `sub` is documented in [About security hardening with OpenID Connect](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect).
5. **Thumbprint / provider URL** if you still pin thumbs: expired intermediate → STS rejects the signature.
6. **Clock**. `exp` in the past because the runner clock is wrong (rare on GitHub-hosted, common on broken self-hosted).
7. **`sts:AssumeRoleWithWebIdentity`** vs `sts:AssumeRole`. The latter will not accept a web identity token.

```bash
aws sts assume-role-with-web-identity \
  --role-arn arn:aws:iam::123456789012:role/gha-payments-prod \
  --role-session-name debug \
  --web-identity-token file://oidc.jwt \
  --duration-seconds 900
```

If this works with a JWT you minted locally from a test workflow but fails in Actions, the `sub` in CI is not the `sub` you put in IAM (environment name mismatch is the usual cause).

`AccessDenied` after a successful assume is the **identity policy**, not OIDC. Different ticket.

## Checklist

- [ ] No `AKIA` keys in GitHub Secrets for AWS (org and repo secret scan)
- [ ] OIDC provider URL is `https://token.actions.githubusercontent.com` (or your GHE issuer)
- [ ] Trust policy `StringEquals` on `aud` and a **narrow** `sub` (repo + environment or repo + ref)
- [ ] Prod job uses a GitHub Environment with required reviewers and deployment branches
- [ ] Separate IAM roles for plan vs apply; PR jobs cannot assume apply
- [ ] `permissions: id-token: write` on the job; least-privilege identity policy on the role
- [ ] `InvalidIdentityToken` runbook: decode `iss`/`aud`/`sub` before editing IAM

OIDC removes the standing key. The role is still a cloud admin if you attach `AdministratorAccess`. Treat the GitHub `sub` like an IAM principal name — because STS does.
