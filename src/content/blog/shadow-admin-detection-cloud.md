---
title: "Detecting Shadow Admins in AWS, Azure, and GCP"
description: "Shadow admins are not in the Admin group. Hunt AWS PassRole, Azure Owner/UAA, and GCP setIamPolicy with effective-permission queries, not role-name filters."
pubDate: 2026-08-27
updatedDate: 2026-08-27
author: OpenSourceOM Team
tags:
  - shadow admin
  - CIEM
  - IAM
  - privilege escalation
  - cloud identity
focusKeyword: shadow admin cloud
faq:
  - question: Is anyone not in Administrators / Owner / roles/owner safe to ignore?
    answer: >-
      No. That is the definition of a shadow admin: admin-equivalent
      permissions without the admin role name. Filter by effective actions
      (PassRole, roleAssignments/write, setIamPolicy), not by group
      membership.
  - question: Does Access Analyzer unused-access find shadow admins?
    answer: >-
      Unused-access finds principals that have not used permissions. A shadow
      admin who has never called CreatePolicy is still one AssumeRole away
      from using them. Analyzer external-access finds other accounts; it is
      not an effective-permission engine by itself.
  - question: Where do Kubernetes cluster-admins fit?
    answer: >-
      In-cluster cluster-admin is a cluster shadow admin. Cloud-side, an
      IRSA role with iam:* or a GKE node SA with Editor is a cloud shadow
      admin attached to a pod. Hunt both; a clean IAM group list will miss
      the pod.
  - question: How often should this hunt run?
    answer: >-
      Continuously if you have a graph; otherwise a scheduled query per cloud
      at least daily, and on every IAM change in prod. Shadow admins appear
      in the same PR that "just needed PassRole for a demo."
---

The Administrators group was empty except break-glass. The environment was still full of people and roles that could **create a policy, attach it, or hand a privileged role to a workload they control**. Those principals are **shadow admins**. Group-name hygiene does not find them. [CIEM](/blog/ciem-explained-for-cloud-teams/) is the discipline; this page is the hunt, with **different** mechanics per cloud—not one paragraph with the product name swapped.

```
Named admin group     ← what audits look at
Effective admin       ← PassRole / UAA / setIamPolicy / Owner at RG
```

If your report is "no users in Admin," you measured the label.

## Not in the Admin group

**AWS:** `Administrators` and `AdministratorAccess` are the labels. Equivalence lives in `iam:CreatePolicy`, `iam:AttachUserPolicy`, `iam:PutRolePolicy`, `iam:CreateAccessKey` on others, `iam:UpdateAssumeRolePolicy`, `iam:PassRole` plus the ability to run a compute resource that uses that role, `sts:AssumeRole` to a role that has those verbs. A developer group with `IAMFullAccess` is not "not admin."

**Azure:** `Global Administrator` and subscription `Owner` are the labels. `User Access Administrator` (UAA) at a management group can mint Owner. `Microsoft.Authorization/roleAssignments/write` on a custom role is enough. Classic administrators (`Co-Administrator`) still exist in old tenants and do not show up in a casual Entra group export.

**GCP:** `roles/owner` and `roles/editor` are the labels. `roles/iam.securityAdmin`, `roles/resourcemanager.projectIamAdmin`, and `iam.serviceAccounts.setIamPolicy` let you grant what you do not yet have. Folder-level Editor is worse than project Owner on one project—see [GCP IAM hardening](/blog/gcp-iam-security-hardening/) for inheritance; here we hunt who can *bind*.

Do not merge these into "check the admin role in each cloud." The privilege-escalation **verb** differs.

## Effective permissions

Policy documents lie by omission (Deny, SCP, Permission Boundary, Azure deny assignments, GCP IAM deny). **Effective** permission is allow minus deny minus boundary, then expanded by resource policies (S3 bucket policy that grants the role extra).

What to compute per principal:

1. Union of identity policies / RBAC assignments / IAM bindings (inherited)
2. Subtract explicit denials and boundaries
3. Expand `*` and managed policy documents
4. Add resource-based grants **to** that principal
5. Flag if the resulting action set includes the escalation verbs below

Libraries and Access Analyzer custom policy checks help; a regex for `"Action": "*"` misses `iam:PassRole` on `*` with a resource of `arn:aws:iam::*:role/admin-*`.

Failure mode: evaluating the role but not the **session policy** or the **permission boundary** on Identity Center permission sets. Failure mode: evaluating Azure RBAC but not **PIM eligible** Owner that is not currently active—eligible is still an edge ([CIEM](/blog/ciem-explained-for-cloud-teams/) again).

## PassRole / setIamPolicy / Owner

These are the three escalation primitives you should name in tickets. They are not synonyms.

**AWS `iam:PassRole`**

Passing `OrganizationAccountAccessRole` or a role with `AdministratorAccess` to `ec2:RunInstances`, `lambda:CreateFunction`, or `ecs:RunTask` is "I am that role." Hunt:

```bash
aws iam get-account-authorization-details --output json > iam.json
# Then search attached policies for PassRole with Resource "*" or admin role ARNs
# Combine with who can ec2:RunInstances / lambda:CreateFunction in the same account
```

A CI role with `PassRole` on `*` is a factory. Narrow `iam:PassedToService` and the role ARN prefix.

**Azure `Owner` and UAA**

Owner includes `roleAssignments/write`. UAA is that permission without the rest of Owner—enough to create Owner. Hunt at **management group** and **subscription**, not only resource group:

```kusto
// Azure Resource Graph — classic starting point, not complete IAM
ResourceContainers
| where type =~ "microsoft.resources/subscriptions"
| join kind=leftouter (
  policyresources
  // pair with az rest on role assignments at MG scope in practice
) on $left.id == $right.subscriptionId
```

Better: `az role assignment list --all` at MG scope, filter `roleDefinitionName` in `Owner`, `User Access Administrator`, and custom roles whose `permissions.actions` contain `Microsoft.Authorization/roleAssignments/write`. Do not stop at Entra "Global Reader."

**GCP `setIamPolicy`**

```bash
gcloud asset search-all-iam-policies --scope=organizations/ORG \
  --query='policy:iam.serviceAccounts.setIamPolicy OR policy:resourcemanager.projects.setIamPolicy'
```

Also flag `roles/iam.serviceAccountUser` plus `roles/iam.serviceAccountTokenCreator` on a SA that already has Owner—impersonation is the PassRole analogue. Default Compute Engine SA with Editor on the project is a **workload** shadow admin; it will never appear in a human "Admin group."

## Hunting queries

Run these as scheduled jobs; dump to the graph as `EFFECTIVE_ADMIN` edges ([the graph](/docs/the-graph/)).

**AWS (Access Analyzer + IAM)**

```bash
# Principals with AdministratorAccess — the labeled admins
aws iam list-entities-for-policy --policy-arn arn:aws:iam::aws:policy/AdministratorAccess

# Custom policies that include iam:* or PassRole on *
aws iam list-policies --scope Local --only-attached \
  --query 'Policies[].Arn' --output text | tr '\t' '\n' | while read -r p; do
  aws iam get-policy-version --policy-arn "$p" --version-id "$(aws iam get-policy --policy-arn "$p" --query 'Policy.DefaultVersionId' --output text)" \
    --query 'PolicyVersion.Document' --output json
done
```

Cross-check with CloudTrail: `CreatePolicy`, `AttachRolePolicy`, `UpdateAssumeRolePolicy` from principals **not** in the break-glass list.

**Azure**

```bash
az rest --method GET \
  --url "https://management.azure.com/providers/Microsoft.Management/managementGroups/${MG}/providers/Microsoft.Authorization/roleAssignments?api-version=2022-04-01"
```

Diff against a known-good set of principal object ids. Alert on new UAA at MG. Include **managed identities** assigned Owner on a subscription—those are as real as users.

**GCP**

```bash
gcloud projects get-iam-policy PROJECT --format=json
gcloud resource-manager folders get-iam-policy FOLDER
# org-level:
gcloud organizations get-iam-policy ORG
```

Look for `allUsers`/`allAuthenticatedUsers` (rare on IAM, fatal), `roles/editor` on folders, and SA impersonation bindings (`roles/iam.serviceAccountTokenCreator`) granted to humans or to other SAs.

**Kubernetes (cloud-adjacent):** `kubectl get clusterrolebinding -o wide` for `cluster-admin`, then map the SA to IRSA/WI roles with the AWS/GCP/Azure hunts above. In-cluster admin plus `s3:*` is two shadow admins on one pod.

## Checklist

- [ ] Hunt uses escalation verbs, not "member of Administrators"
- [ ] AWS: PassRole + compute create, IAM write, UpdateAssumeRolePolicy
- [ ] Azure: Owner, UAA, custom roleAssignments/write, classic admins, MIs
- [ ] GCP: setIamPolicy, securityAdmin, SA impersonation, default Compute SA
- [ ] Eligible PIM / unused-but-powerful roles still graphed as edges
- [ ] Scheduled query + CloudTrail/activity alert on new bindings

**Related:** [CIEM explained](/blog/ciem-explained-for-cloud-teams/) · [GCP IAM hardening](/blog/gcp-iam-security-hardening/) · [AWS security best practices](/blog/aws-security-best-practices-2026/) · [The graph](/docs/the-graph/)
