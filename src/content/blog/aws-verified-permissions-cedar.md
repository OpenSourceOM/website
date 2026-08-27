---
title: "Amazon Verified Permissions and Cedar for App AuthZ"
description: "Amazon Verified Permissions Cedar is application authorization, not IAM and not CSPM. Policy shape, when AVP is the wrong tool, and mapping API actions to the same identities a security graph already has."
pubDate: 2026-08-27
updatedDate: 2026-08-27
author: OpenSourceOM Team
tags:
  - Amazon Verified Permissions
  - Cedar
  - authorization
  - application security
  - IAM
focusKeyword: Amazon Verified Permissions Cedar
faq:
  - question: Can Cedar policies replace IAM for S3 and EC2?
    answer: >-
      No. IAM authorizes AWS APIs. Verified Permissions authorizes *your*
      application’s actions (viewOrder, shareDoc) on *your* resource types.
      Putting bucket ARNs into Cedar does not enforce GetObject. Keep IAM for
      the execution role; keep Cedar for the user sitting on the API.
  - question: Do I need Verified Permissions if I only have admin and user roles?
    answer: >-
      Probably not. Cognito groups or a single RBAC check in the API is enough
      for two roles and no tenancy. AVP pays off when policies must change
      without deploys, tenants share the app, or forbid rules must override
      owner permits (published document is immutable).
  - question: Is the Cedar schema required?
    answer: >-
      Optional in the language; treat it as required in AVP production. With
      policy validation on, the service rejects policies that reference unknown
      actions or attributes. That is the difference between a typo shipping as
      Allow and a failed PutPolicy.
  - question: How does this relate to zero trust?
    answer: >-
      Zero trust at the estate layer is identity-aware ingress and default-deny
      networks. Cedar is the authorization decision *inside* one app after the
      request is already on the service. You still need both; Cedar does not
      close a security group.
---

`GET /v1/orders/123` is not an AWS API. IAM can say the **task role** may call DynamoDB. It cannot say **user Alice in tenant T** may view **order 123**. **Amazon Verified Permissions** stores [Cedar](https://docs.cedarpolicy.com/) policies and answers `IsAuthorized` for that question. This is **application authorization**, not CSPM, not GuardDuty, not a substitute for [CIEM](/blog/ciem-explained-for-cloud-teams/).

How the service is built (mTLS, service accounts) is [cloud-native application security](/blog/cloud-native-application-security/). This page is **Cedar vs IAM**, policy shape, and when to walk away.

## IAM vs application authorization

| | IAM | Verified Permissions (Cedar) |
| --- | --- | --- |
| Principal | IAM user/role, OIDC to AWS | App user, group, tenant entity you define |
| Action | `s3:GetObject`, `dynamodb:GetItem` | `Action::"viewOrder"` in *your* schema |
| Resource | AWS ARN | `Order::"123"` with attributes you send |
| Policy language | IAM JSON | Cedar |
| Evaluated by | AWS API front door | Your app calling `isAuthorized` (or similar) **before** the business logic |
| Changes | IAM policy / SCP | Policy store, no app deploy if you design it that way |

Cognito (or Entra, or OIDC) answers **authentication**. Group claims are coarse authorization. Cedar is for **resource-level** permit/forbid with attributes (tenant, status, parent folder).

If the Lambda execution role is `AdministratorAccess`, Cedar cannot save you from a bug that uses that role. App authZ and [cloud IAM](/blog/aws-security-best-practices-2026/) are stacked, not interchangeable.

## Cedar policy shape

A policy is `permit` or `forbid` with `principal`, `action`, `resource`, optional `when` / `unless`. **Any matching forbid wins.**

```text
permit (
  principal,
  action == Action::"viewOrder",
  resource
) when {
  principal has tenant &&
  resource has tenant &&
  principal.tenant == resource.tenant &&
  principal in Group::"order-readers"
};

forbid (
  principal,
  action == Action::"editOrder",
  resource
) when {
  resource.status == "posted"
};
```

You send **entities** in the authorization request (user attributes, group membership, resource attributes). AVP does not crawl DynamoDB for you. If `resource.status` is stale in the request, the decision is stale. That is the usual integrity bug: authorize on attributes the client supplied without loading the order.

A typical `IsAuthorized` call is: policy store id, principal `User::"<idp-sub>"`, action, resource, and a list of entities (groups the user is in, parent folder, tenant). Miss a `parent` entity and `principal in Group::"order-readers"` evaluates false—or worse, you omit a forbid-relevant attribute. Log the decision token (allow/deny + determining policies) in the app’s request id, not only CloudTrail on the AVP API.

Schema (highly recommended) declares entity types, attributes, and which actions apply to which types. With validation enabled, `Action::"veiwOrder"` never stores.

Policy templates cover “Alice can access this one document” without copying a unique policy per share. Still not IAM session policies. One policy store per app (or per tenant isolation boundary) beats a single org-wide store that mixes HR and payments schemas.

## When not to use it

- **Authorizing AWS APIs.** Use IAM, SCPs, resource policies, RCPs. Cedar in a sidecar in front of `PutObject` is theater unless you also wrap every SDK call—and you will miss one.
- **Two global roles, one tenant, five endpoints.** The operational cost of a policy store, schema, and entity hydration exceeds an `if (role === 'admin')`.
- **Replacing input validation.** Forbid does not canonicalize IDs or stop SQL injection.
- **Synchronous authZ on a 100k QPS hot path without a cache plan.** AVP is a network call. Batch and cache decisions you can invalidate, or run Cedar locally only if you accept the ops of embedding the engine—AVP’s product is the managed store.
- **As a CSPM.** There is no Cedar finding for a public bucket. [CSPM vs CNAPP](/blog/cspm-vs-cnapp-whats-the-difference/) is a different shopping list.

Use it when product wants **share / unshare without deploys**, **multi-tenant isolation** expressed as policy, or **forbid guardrails** security can write without owning the service’s if-statements.

## Mapping API actions to graph identities

The graph your cloud team already has ([the graph](/docs/the-graph/), [attack path analysis](/blog/attack-path-analysis-cloud-security/)) uses IAM role ARNs and cloud resources. Cedar uses `User::"sub-from-idp"`. If those never meet, AppSec and cloud security cannot answer “if this IdP user is compromised, which **AWS** data can the **app role** still read?”

Join keys that work:

1. **API action** `POST /orders/{id}/export` → Cedar `Action::"exportOrder"` → **implementation** uses IAM role `payments-api` → DynamoDB table / S3 export bucket (CNAPP nodes).
2. **Principal** Cedar `User` id = IdP `sub` = Identity Center / Entra object id you already put on [CIEM](/blog/ciem-explained-for-cloud-teams/) human nodes when you have that mapping.
3. **Tenant** attribute = AWS account or KMS CMK alias only if that is actually true; do not invent a 1:1 if tenants share a table.

Then a stolen session is an app-authZ incident **and** a cloud-role incident. [Zero trust](/blog/zero-trust-cloud-architecture-guide/) stops at “was the caller allowed to hit the API.” Cedar decides the object. IAM decides the datastore.

[OpenSourceOM](https://github.com/OpenSourceOM/core) will not evaluate Cedar for you. Put the **action and principal IDs** on workload nodes so a path query can name the API, not only `sts:AssumeRole`.

Failure mode: duplicating IAM in Cedar (“permit if principal.roleArn == payments-api”). The task role is not the user. Failure mode: skipping `isAuthorized` on a “internal” admin UI because it sits on a VPN ([zero trust](/blog/zero-trust-cloud-architecture-guide/) again).

## Checklist

- [ ] IAM scoped to the app role’s AWS APIs; Cedar scoped to user/tenant/resource actions
- [ ] Schema + policy validation on in the policy store
- [ ] Forbid used for guardrails that must beat owner permits
- [ ] Resource attributes loaded server-side, not trusted from the JWT alone
- [ ] AVP skipped for two-role apps and for all AWS control-plane authZ
- [ ] API route → Cedar action → execution role → datastore documented for graph join
- [ ] IdP `sub` / employee id used as Cedar principal id where humans already exist in CIEM
---
