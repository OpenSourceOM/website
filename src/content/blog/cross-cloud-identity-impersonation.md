---
title: "Cross-Cloud Identity Impersonation (AWS↔GCP↔Azure)"
description: "Cross-cloud identity impersonation: federation trust as a graph edge, confused-deputy conditions, workload identity across AWS, GCP, and Azure."
pubDate: 2026-08-27
updatedDate: 2026-08-27
author: OpenSourceOM Team
tags:
  - workload identity
  - federation
  - confused deputy
  - multi-cloud
  - CIEM
focusKeyword: cross-cloud identity impersonation
faq:
  - question: Is a federation trust the same as a VPN between clouds?
    answer: >-
      No. A VPN moves packets. Federation moves identity: an OIDC or SAML
      token from one cloud's issuer is accepted by another's STS/token
      service. You can impersonate a role in AWS from a GKE pod without
      any VPC peering. Treat the trust policy as an IAM edge, not a network
      one.
  - question: What is the usual confused-deputy bug in these trusts?
    answer: >-
      An AssumeRoleWithWebIdentity or federated credential that checks
      aud but not sub (or checks sub with a wildcard). Any workload that
      can mint a token for that audience then becomes the role. Pin
      service account, namespace, repo, or environment.
  - question: Should humans use the same federation as workloads?
    answer: >-
      Prefer one IdP for humans (Identity Center, Entra, Workforce
      Identity) and separate workload issuers (IRSA, GKE WI, Azure WI,
      GitHub OIDC). Reusing the human IdP as a workload issuer without
      hard sub constraints recreates standing admin with extra steps.
  - question: Can CSPM see this without a graph?
    answer: >-
      It can list OIDC providers and trust policies as config. It will
      not tell you that this GKE SA can reach that S3 bucket unless you
      walk issuer → role → resource. That walk is CIEM plus
      reachability.
---

A GKE pod with no AWS access key still called `sts:AssumeRoleWithWebIdentity` and listed every bucket in `prod-logs`. The trust lived in an IAM role document that named `accounts.google.com`. Nobody drew that edge because the security group between the clouds was empty. **Cross-cloud identity impersonation** is federation as a privilege path, not as a connectivity project.

This page: trust as a graph edge, confused deputy, workload identity across AWS/GCP/Azure, and how to query it. Human SSO design is [zero trust](/blog/zero-trust-cloud-architecture-guide/). Entitlement analytics are [CIEM](/blog/ciem-explained-for-cloud-teams/). GCP binding mechanics: [GCP IAM](/blog/gcp-iam-security-hardening/). AWS org hygiene: [AWS security best practices](/blog/aws-security-best-practices-2026/).

```
GKE SA / Azure WI / GitHub OIDC
  → token from issuer A
       → STS / token exchange in cloud B
            → cloud B role / MI / SA
                 → data in B (and maybe back to A)
```

No packet path required.

## Federation trust as an edge

Model each trust as:

`Issuer principal (cloud A) --FEDERATES_TO--> Role/app (cloud B)`

Concrete objects:

| Direction | Trust object | What to inventory |
| --- | --- | --- |
| GCP → AWS | IAM OIDC provider `accounts.google.com` or WIF pool; role trust `Federated` | `sub` / `attribute.google` conditions; role permissions |
| AWS → GCP | Workload Identity Federation pool + provider (AWS); SA impersonation | Attribute mapping `google.subject`; who can impersonate the SA |
| Azure → AWS | IAM OIDC provider for Entra / Azure WI issuer; role trust | `aud`, `sub` of the federated credential |
| AWS → Azure | Entra app federated identity credential (`issuer` + `subject`) | Subject is the AWS role session or GitHub `sub` |
| GitHub → any | OIDC `token.actions.githubusercontent.com` | `sub` repo/environment, not only `aud: sts.amazonaws.com` |

```json
{
  "Effect": "Allow",
  "Principal": { "Federated": "arn:aws:iam::111111111111:oidc-provider/accounts.google.com" },
  "Action": "sts:AssumeRoleWithWebIdentity",
  "Condition": {
    "StringEquals": {
      "accounts.google.com:aud": "111111111111.apps.googleusercontent.com"
    }
  }
}
```

That snippet is a **confused deputy waiting to happen**: `aud` only. Any Google token with that audience (more workloads than you think, depending on how the provider was built) can become the role.

Inventory command sketches:

```bash
aws iam list-open-id-connect-providers
aws iam get-role --role-name gke-to-aws --query 'Role.AssumeRolePolicyDocument'
```

```bash
gcloud iam workload-identity-pools providers list --location=global --workload-identity-pool=POOL
```

```bash
az ad app federated-credential list --id "$APP_ID"
```

CSPM check: "OIDC provider exists" is informational. The finding is **missing `sub` / `assertion.sub` / federated subject**.

## Confused deputy

Classic: service B trusts issuer A too broadly; attacker uses a legitimate token from a **different** workload on A.

Pin:

- **AWS IAM:** `accounts.google.com:sub` to the numeric SA unique id, or GitHub `token.actions.githubusercontent.com:sub` to `repo:org/payments:environment:prod` (not `repo:org/*`)
- **GCP WIF:** CEL on `assertion.arn` (AWS) or `assertion.sub` (Azure/GitHub) to one role/SA
- **Azure federated credentials:** `subject` exact match; issuer exact; do not create a credential per org with a wildcard subject if the portal offers one

Also pin **audience**. Wrong `aud` is how a token minted for Grafana is accepted by AWS STS.

External ID (S3 / AssumeRole account-to-account) is the cousin of this problem inside AWS. Cross-cloud OIDC is the same class: **unauthenticated callers with a token you did not intend**.

Failure mode: copying a blog trust policy that uses `StringLike` `repo:org/*:ref:refs/heads/*`. Every branch on every repo in the org is prod.

## Workload identity across clouds

Patterns that are supposed to exist (they are not bugs if constrained):

**GKE → AWS (IRSA-shaped):** GKE Workload Identity issues a Google token; AWS role trust names the Google OIDC provider and the GKE SA. The pod never has an AWS key. The **AWS role** must be least privilege ([CIEM](/blog/ciem-explained-for-cloud-teams/)). The **GKE SA** must not be shared across namespaces ([Kubernetes RBAC](/blog/kubernetes-rbac-security-best-practices/) plus WI annotation).

**EKS → GCP:** AWS IAM role credentials via WIF provider type AWS; GCP SA has `roles/iam.workloadIdentityUser` for that AWS principal. Map `attribute.aws_role` to one role ARN. Node instance roles must **not** be in that map.

**AKS → AWS:** Azure Workload Identity (Entra federated credential on a user-assigned MI) → AWS OIDC. Subject is the MI's application id / federated subject string. Do not reuse the cluster's kubelet identity.

**GitHub Actions → all three:** one OIDC token, three cloud trusts. Separate **environments** (`prod` vs `dev`) so a PR workflow cannot hit the prod role. This is the same pin as cloud-to-cloud, with `job_workflow_ref` if you need it.

Humans: Workforce Identity (GCP) and Identity Center (AWS) should not be the same issuer string you used for GKE unless conditions make that impossible to confuse. [Zero trust](/blog/zero-trust-cloud-architecture-guide/) wants per-app authz; a god federation from Entra to `AdministratorAccess` in every cloud is a VPN with extra YAML.

## Graphing the trust

Put `FEDERATES_TO` and `CAN_ASSUME` in the same graph as `CAN_REACH` ([the graph](/docs/the-graph/)). Queries that matter:

1. **Issuer → role → data:** which GKE SAs (or Azure MIs) can read which S3 buckets / GCS / blobs
2. **Unconstrained trusts:** OIDC providers whose conditions lack `sub` / subject
3. **Bidirectional:** AWS role that can impersonate a GCP SA that can `roles/iam.serviceAccountTokenCreator` on a third SA (chain)
4. **Human vs workload:** edges from Entra groups vs from cluster SAs—do not mix in one "federation" finding

Without the graph you get three CSPM tickets: "OIDC provider," "overprivileged role," "public bucket." With the graph you get one path. That is the same reason [attack paths](/blog/attack-path-analysis-cloud-security/) exist inside one cloud; cross-cloud is just an extra issuer node.

Failure mode: modeling only network peering (TGW, VPN, interconnect) and declaring "no path" while STS still works over the internet. Federation does not need your WAN.

## Checklist

- [ ] Every OIDC/WIF/federated credential inventoried as an edge, not a checkbox
- [ ] Conditions pin `sub`/subject **and** `aud`; no org-wide `StringLike`
- [ ] Workload issuers separate from human IdPs
- [ ] Roles at the far end are least privilege, not `AdministratorAccess` "for the demo"
- [ ] Graph query: foreign issuer → data; unconstrained trusts alert
- [ ] GitHub environments and GKE SA namespacing match the pins

**Related:** [Zero trust cloud architecture](/blog/zero-trust-cloud-architecture-guide/) · [CIEM explained](/blog/ciem-explained-for-cloud-teams/) · [GCP IAM hardening](/blog/gcp-iam-security-hardening/) · [AWS security best practices](/blog/aws-security-best-practices-2026/) · [The graph](/docs/the-graph/)
