---
title: "IAM Permission Boundaries Are a Ceiling, Not a Grant"
description: "An IAM permission boundary is the maximum a role can have. It grants nothing. Condition CreateRole on it, and deny deleting the boundary."
pubDate: 2026-09-25
updatedDate: 2026-09-25
author: OpenSourceOM Team
tags:
  - AWS
  - IAM
  - permission boundary
  - CIEM
focusKeyword: IAM permission boundary
faq:
  - question: If the boundary allows s3:GetObject and the identity policy does not, can the role read the bucket?
    answer: >-
      No. A permission boundary does not grant anything. The identity
      policy (or, in some same-account cases, the resource policy) has to
      allow the action, and the boundary has to allow it too. Effective
      permission is the intersection. An empty identity policy plus a wide
      boundary is still no access.
  - question: What is the usual way around a boundary?
    answer: >-
      iam:DeleteRolePermissionsBoundary, or iam:PutRolePermissionsBoundary
      to a wider policy, on a role the developer can already update.
      CreateRole conditioned on iam:PermissionsBoundary is incomplete
      unless attach, put-role-policy, and boundary replacement are
      conditioned the same way, and delete-boundary is denied.
  - question: How is this different from an SCP or an RCP?
    answer: >-
      An SCP caps principals in the account, for every role. An RCP caps
      access to resources in the account, including callers from outside.
      A permission boundary caps one principal, which is how you let a
      team create roles without letting them create admin. You usually
      want all three. The boundary is the one developers can remove if
      you leave the IAM calls open.
---

```json
{
  "Effect": "Allow",
  "Action": [
    "iam:CreateRole",
    "iam:AttachRolePolicy",
    "iam:PutRolePolicy",
    "iam:PutRolePermissionsBoundary"
  ],
  "Resource": "arn:aws:iam::123456789012:role/app/*",
  "Condition": {
    "StringEquals": {
      "iam:PermissionsBoundary": "arn:aws:iam::123456789012:policy/AppBoundary"
    }
  }
}
```

That condition is the **IAM permission boundary** pattern. `AppBoundary` is a managed policy attached as the role’s ceiling. It grants nothing by itself. A role whose identity policy says `s3:GetObject` and whose boundary says the same can read. A role whose identity policy says `iam:*` and whose boundary does not can not. Evaluation is the intersection, and any explicit deny still wins. AWS describes the mechanics in [Permissions boundaries](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_boundaries.html).

GCP’s version of a ceiling on *which resources* a principal may touch is [principal access boundaries](/blog/gcp-principal-access-boundary/). The org-level ceiling on *your resources* is [RCPs](/blog/aws-resource-control-policies-rcp/). This page is the per-role ceiling inside one AWS account.

## What the boundary policy should contain

Write `AppBoundary` as the maximum an application role may ever hold: the data APIs the team uses, on `arn:aws:s3:::app-*` and the matching KMS keys, plus whatever logs they must write. Do not attach `PowerUserAccess` and call it a boundary. PowerUser is “everything except IAM,” and everything except IAM still includes the data plane.

Leave out:

- `iam:CreateUser`, `iam:AttachUserPolicy`, `iam:PutRolePolicy` on `*`
- `iam:PassRole` on `*`
- `sts:AssumeRole` on `arn:aws:iam::*:role/*`
- `organizations:*` and account-leaving APIs

If the boundary allows `iam:PutRolePolicy` on `*`, the ceiling contains a ladder. The identity policy is not allowed to climb past the boundary, but a boundary that includes IAM write is a tall ceiling. [Shadow admin](/blog/shadow-admin-detection-cloud/) detection looks for those actions on the effective set, not for a policy named `ReadOnly`.

Same-account resource policies do not punch through the boundary. A bucket policy that allows the role still loses if the boundary denies `s3:GetObject`. That is the property you are paying for. Cross-account, the other account’s resource policy and this role’s identity policy both have to allow, and the boundary still caps the role.

## The detach hole

Conditioning `iam:CreateRole` is the screenshot in most write-ups. The role is created with the boundary, and the next statement in the same developer policy is unconditioned `iam:DeleteRolePermissionsBoundary`.

Deny it:

```json
{
  "Effect": "Deny",
  "Action": [
    "iam:DeleteRolePermissionsBoundary"
  ],
  "Resource": "arn:aws:iam::123456789012:role/app/*"
}
```

`iam:PutRolePermissionsBoundary` stays allowed only with the condition that the new boundary is still `AppBoundary`. Without that, “update” is “replace with `AdministratorAccess`.”

Also condition `iam:CreatePolicyVersion` if developers can version customer-managed policies attached inside the boundary. A new version of a policy the boundary allows them to attach is a grant, and the boundary will not stop a policy that is already inside the ceiling. Keep developers off policy versions entirely if you can: they attach a fixed list of team policies, they do not author them.

Identity Center permission sets can set a boundary on the role they provision in the member account. A permission set named `Developer` with `PowerUserAccess` and no boundary is the same hole, deployed to every account the set is assigned to. Set the boundary on the permission set, then confirm the provisioned role actually has it (`aws iam get-role --query Role.PermissionsBoundary`).

## Seeing it

```bash
aws iam get-role --role-name app/payments-api \
  --query 'Role.PermissionsBoundary.PermissionsBoundaryArn'
```

No `PermissionsBoundary` key means there is no ceiling. The identity policy is the whole story, which is what [unused-access findings](/blog/aws-iam-access-analyzer-unused-access/) are measured against. A boundary does not change last-accessed data. It changes what you are willing to let the identity policy grow into. [Blast radius](/blog/blast-radius-analysis-cloud-iam/) has to be computed on the intersection, or you will report a path the boundary already denies.

## Checklist

- [ ] `AppBoundary` does not include IAM write, `PassRole` on `*`, or `AssumeRole` on `*`
- [ ] `CreateRole`, `AttachRolePolicy`, `PutRolePolicy`, and `PutRolePermissionsBoundary` all condition on `iam:PermissionsBoundary`
- [ ] `DeleteRolePermissionsBoundary` is denied on `app/*`
- [ ] Identity Center permission sets that create roles set the same boundary
- [ ] `get-role` shows the boundary on existing app roles, not only on roles created after the policy change
- [ ] Effective-permission reviews use the intersection, not the identity policy alone

A boundary nobody is forced to attach is a document in the account. The condition on `CreateRole` is the control.
