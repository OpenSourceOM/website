---
title: "GitLab CI OIDC to AWS IAM"
description: "GitLab CI OIDC to AWS uses project_path and ref in sub, not a GitHub-style repo claim. Protect prod with ref_protected and a narrow StringEquals."
pubDate: 2026-09-25
updatedDate: 2026-09-25
author: OpenSourceOM Team
tags:
  - GitLab CI
  - OIDC
  - AWS IAM
  - DevSecOps
focusKeyword: GitLab CI OIDC AWS
faq:
  - question: What is the GitLab sub claim for AWS?
    answer: >-
      For gitlab.com it looks like
      project_path:group/project:ref_type:branch:ref:main.
      It is not repo:org/name:ref:refs/heads/main. A trust policy copied
      from GitHub will never match, or worse, a StringLike on project_path:group/*
      will match every project in the group.
  - question: How do I stop feature branches assuming the prod role?
    answer: >-
      On gitlab.com, StringEquals the full sub for main and set
      gitlab.com:ref_protected to true, and pin gitlab.com:project_id so a
      rename or a second project cannot reuse the role. ref_protected
      reports GitLab’s branch protection; it does not create it. On
      self-managed, AWS only honors sub and aud, so the sub itself has to
      name the protected ref.
  - question: Do I still need a thumbprint for gitlab.com?
    answer: >-
      GitLab.com’s certificate chains to a public CA, and IAM accepts that
      issuer without a pinned thumbprint as the control. The provider URL
      must be exactly https://gitlab.com. A self-managed instance with a
      private CA still needs its certificate registered. The sub and aud
      conditions are the actual restriction either way.
---

```yaml
deploy-prod:
  stage: deploy
  environment: production
  id_tokens:
    GITLAB_AWS_TOKEN:
      aud: sts.amazonaws.com
  script:
    - >
      aws sts assume-role-with-web-identity
      --role-arn "$AWS_ROLE_ARN"
      --role-session-name "gitlab-${CI_PROJECT_ID}-${CI_PIPELINE_ID}"
      --web-identity-token "$GITLAB_AWS_TOKEN"
      --duration-seconds 3600
      --query 'Credentials.[AccessKeyId,SecretAccessKey,SessionToken]'
      --output text
```

**GitLab CI OIDC AWS** is that `id_tokens` block plus a trust policy on `gitlab.com:sub`. `CI_JOB_JWT` is the old token. Do not build a new role on it.

The GitHub version of this pattern is [GitHub Actions OIDC to AWS](/blog/github-actions-oidc-aws-iam/). The GCP version is [GitLab workload identity federation](/blog/gitlab-ci-workload-identity-gcp/). Claim names are not portable between them. GitLab’s own walkthrough is [Configure OpenID Connect in AWS](https://docs.gitlab.com/ci/cloud_services/aws/).

## Provider and trust policy

```bash
aws iam create-open-id-connect-provider \
  --url https://gitlab.com \
  --client-id-list sts.amazonaws.com
```

Self-managed GitLab uses the instance URL (`https://gitlab.example.com`). On gitlab.com, AWS accepts extra condition keys (`project_id`, `namespace_id`, `ref_protected`). On self-managed and Dedicated, only `sub` and `aud` are condition keys, so the host prefix changes and the extra keys in the policy below must be dropped. One provider per issuer, not one provider per project.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::123456789012:oidc-provider/gitlab.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "gitlab.com:aud": "sts.amazonaws.com",
          "gitlab.com:sub": "project_path:your-org/payments:ref_type:branch:ref:main",
          "gitlab.com:namespace_id": "12345",
          "gitlab.com:project_id": "67890",
          "gitlab.com:ref_protected": "true"
        }
      }
    }
  ]
}
```

`aud` in the trust policy must be the `aud` in `id_tokens`. GitLab will mint whatever audience the job asks for. If the job says `aud: https://gitlab.com` and IAM says `sts.amazonaws.com`, assume-role is denied. `project_id` stays valid across renames; `project_path` inside `sub` does not. Pin both. `ref_protected` is a gitlab.com condition key only. Decode the token before you edit the role:

```bash
# In a debug job, print claims only — not the raw token — into a masked log
echo "$GITLAB_AWS_TOKEN" | cut -d. -f2 | tr '_-' '/+' | base64 -d 2>/dev/null | jq '{iss,aud,sub,ref,ref_protected,environment}'
```

## sub, project_id, ref_protected

Default `sub` embeds project path, ref type, and ref. Useful `StringEquals` values:

| Claim | Prod deploy |
| --- | --- |
| `gitlab.com:sub` | `project_path:your-org/payments:ref_type:branch:ref:main` |
| `gitlab.com:project_id` | The numeric project id (stable across rename and transfer) |
| `gitlab.com:namespace_id` | The group id (changes if the project moves to another group) |
| `gitlab.com:ref_protected` | `true` (gitlab.com only) |

`environment` is in the token and is not an AWS condition key, even on gitlab.com. Gate the apply role with `ref_protected` and a `sub` that names `main`, and use a second role for merge-request plan jobs. A single role with `StringLike` `project_path:your-org/*` is every project under the group, including a new one nobody reviewed. `project_id` closes that hole on gitlab.com. Self-managed has to encode the same limit in `sub`.

`ref_protected: true` does not protect the branch. It reports GitLab’s setting. An unprotected `main` sends `false`, the condition fails, and the job cannot deploy. That is what you want. Fix the branch protection; do not delete the condition.

Tag pipelines (`ref_type:tag`) do not match a `ref_type:branch` sub. Give release tags their own role or their own statement. Do not widen to `StringLike` `*`.

## Runners

OIDC proves which project and ref GitLab put on the token. It does not prove the runner disk is clean. A shared runner can read `GITLAB_AWS_TOKEN` for the job’s lifetime. The constraint is the same as GitHub-hosted versus self-hosted runners on the [GitHub OIDC](/blog/github-actions-oidc-aws-iam/) page: prod assume-role on a runner only protected environments can schedule.

The identity policy on the role is still your problem. OIDC with `AdministratorAccess` is an access key that expires in an hour and comes back every pipeline. Scope the role the way you would scope [CIEM](/blog/ciem-explained-for-cloud-teams/) for any other CI principal.

## Checklist

- [ ] `id_tokens` with `aud: sts.amazonaws.com`; `CI_JOB_JWT_V2` is gone as of GitLab 17
- [ ] Provider URL `https://gitlab.com` or your exact instance URL
- [ ] `StringEquals` on `aud` and a full `sub` (`project_path` + `ref_type` + `ref`)
- [ ] gitlab.com roles also pin `project_id` (and `ref_protected` only if the branch is actually protected)
- [ ] Self-managed roles use only `sub` and `aud`
- [ ] Separate roles for merge-request plan and protected-environment apply
- [ ] No `project_path:group/*` StringLike on a write role
- [ ] Deploy role is not `AdministratorAccess`

Copy the GitHub trust policy into GitLab and STS will reject it. Loosen `sub` until STS accepts it and every project in the group can deploy.
