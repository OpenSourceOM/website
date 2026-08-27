---
title: "Azure Landing Zone Deny Assignments That Block Owners"
description: "CAF-style deny assignments vs Policy Deny, platform vs app landing zones, break-glass, and debugging “I am Owner but cannot delete.”"
pubDate: 2026-08-27
updatedDate: 2026-08-27
author: OpenSourceOM Team
tags:
  - Azure
  - landing zone
  - deny assignments
  - Azure RBAC
  - governance
focusKeyword: Azure deny assignments landing zone
faq:
  - question: I am Owner. Why can’t I delete this resource?
    answer: >-
      Owner is an allow assignment. A deny assignment at that scope (or
      a parent) wins for the listed actions. Landing-zone accelerators,
      deployment stacks, and managed applications create deny assignments
      that do not show up in az role assignment list. Open IAM → Deny
      assignments, or query Microsoft.Authorization/denyAssignments.
  - question: Is a deny assignment the same as Azure Policy effect Deny?
    answer: >-
      No. Policy Deny rejects a PUT that fails a policy rule (for example
      creating a public IP). A deny assignment is RBAC: it blocks
      specified actions (delete, write, role assignment) even when the
      caller is Owner. You can be blocked by both at once; they fail
      with different error text.
  - question: Who is allowed to create deny assignments?
    answer: >-
      Direct user-created deny assignments are restricted. They appear
      from managed identities of deployment stacks, Azure managed
      applications, Microsoft-managed landing zone engines, and some
      first-party services. If your platform team cannot explain a deny
      assignment’s principalId, do not delete resources around it—find
      the stack or managed app first.
  - question: Can I exempt the application team from a platform deny assignment?
    answer: >-
      Only if the deny assignment’s notActions / excluded principals
      already allow it, or if the platform team updates the stack. App
      Owners cannot edit a deny assignment they do not control. Asking
      for Owner on the platform subscription is the wrong fix; ask for
      a change to excludedPrincipals or to move the resource out of the
      deny scope.
---

The ticket is always the same: “I have Owner on the subscription. Delete fails with AuthorizationFailed.” The IAM **Role assignments** tab looks correct. The **Deny assignments** tab (easy to miss) lists a system-assigned deny that forbids `Microsoft.Resources/subscriptions/resourceGroups/delete` or `*/delete` on a platform resource group. That is not a broken portal. That is how Azure landing zones keep application teams from deleting the hub firewall, the DNS resolver, or the Activity Log workspace.

This page is deny assignments in a CAF / enterprise-scale layout: how they differ from Policy, where they belong, how to break glass, how to debug. It is not MCSB onboarding ([Azure CSPM](/blog/azure-cspm-implementation-guide/)) and not PIM. Docs: [deny assignments](https://learn.microsoft.com/en-us/azure/role-based-access-control/deny-assignments).

## Deny assignments vs Deny policy effect

| | Policy effect `Deny` | RBAC **deny assignment** |
| --- | --- | --- |
| Plane | Azure Policy | Azure RBAC |
| Typical message | `RequestDisallowedByPolicy` | `AuthorizationFailed` / deny assignment in details |
| Who it applies to | Any principal whose PUT matches the rule | Principals not in `excludedPrincipals` (often everyone except a platform MI) |
| Owner bypass? | No (unless exemption) | No |
| Shown on | Policy compliance | IAM → Deny assignments |
| `az role assignment list` | Irrelevant | Does **not** list them |

```bash
# This will not show deny assignments
az role assignment list --subscription "${SUB}" -o table

# This will
az rest --method GET \
  --url "https://management.azure.com/subscriptions/${SUB}/providers/Microsoft.Authorization/denyAssignments?api-version=2022-04-01"
```

Policy Deny is the right tool to stop **new** public IPs in an app landing zone. A deny assignment is the right tool to stop **Owners** from mutating **platform** resources that happen to live in a subscription they can otherwise use. Using Policy Deny to protect a single hub firewall works until someone files an exemption. The deny assignment is harder to shrug off—which is the point, and also why break-glass must be documented.

Failure mode: platform team explains every deletion failure as “Policy.” App team adds a Policy exemption. Delete still fails. Hours lost. Read the error’s `denyAssignmentId`.

## Platform vs app landing zones

Enterprise-scale (simplified):

```
Tenant root
  ├── Platform MG     connectivity, identity, management subscriptions
  │     deny assignments: protect hub, DNS, log workspaces
  └── Landing zones MG
        ├── Corp / online app subscriptions   ← Owners here should not
        │     inherit deny on platform RGs     edit hub resources
        └── Sandbox                           ← weaker denies, shorter TTL
```

Patterns that work:

- **Deployment stack** at the platform subscription with `denySettings.mode = denyDelete` (or `denyWriteAndDelete`) on the stack’s resources. Azure creates a deny assignment owned by the stack.
- **Managed application** for a marketplace/platform offering; the publisher identity is excluded, everyone else is denied on the managed RG.
- **ALZ / CAF accelerator** artifacts that drop deny assignments so subscription Owners cannot remove diagnostic settings or move the subscription out of the MG (depending on version—read **your** deployed JSON, not a 2022 blog post).

Patterns that hurt:

- Deny assignment covering an **entire app subscription** so the app Owner cannot delete their own RG. That is not a landing zone; that is a hostage situation. Scope deny to platform RGs / specific resource ids.
- Copying platform deny onto sandbox. People will bypass with shadow IT subscriptions under a different MG.

[Azure CSPM](/blog/azure-cspm-implementation-guide/) should still Audit/Deny public storage on **app** subscriptions. Deny assignments do not replace MCSB. They protect the platform plane that CSPM also needs (Log Analytics, Defender export).

## Break-glass

Someone must be able to update the stack when the hub CIDR changes. Options:

1. **Excluded principal** on the deny assignment: a platform-managed identity or a PIM-eligible platform group, not every Owner.
2. **Delete / update the deployment stack** as that identity (the deny goes away or is rewritten with the stack).
3. **Tenant root User Access Administrator** break-glass accounts: hardware MFA, stored offline, monitored. They can remove a deny assignment in an emergency. If those accounts are also Eligible-only without a tested activate path, you do not have break-glass.

```bash
az rest --method GET \
  --url "https://management.azure.com/${DENY_ASSIGNMENT_ID}?api-version=2022-04-01" \
  --query "{name:properties.denyAssignmentName,exclude:properties.excludePrincipals,actions:properties.actions,scope:properties.scope}"
```

Test restore **once** a year: activate break-glass, change a dummy tag on a protected resource (if write is denied, you will confirm the path), deactivate. An untested UAA account is a story, not a control.

Failure mode: excluded principal is a user’s object id who left. Stack updates fail; the deny remains; nobody new is excluded. Use a group or MI.

## Debugging “I am Owner but cannot delete”

1. Copy the full ARM error. Look for `DenyAssignment` / `denyAssignmentId`.
2. List deny assignments at subscription **and** RG (they inherit down):

```bash
az rest --method GET \
  --url "https://management.azure.com/subscriptions/${SUB}/resourceGroups/${RG}/providers/Microsoft.Authorization/denyAssignments?api-version=2022-04-01&\$filter=atScope()"
```

3. Confirm you are not in `excludePrincipals`. Owner is irrelevant.
4. Identify `createdBy` / description: deployment stack name, managed app, `DoNotDelete`, ALZ.
5. If it is a stack: `az stack mg show` / `az stack sub show` and talk to platform. Do not `az resource delete` in a loop.
6. If it is Policy (`RequestDisallowedByPolicy`), switch playbooks—exemptions, not deny assignments.

Portal: Subscription → Access control (IAM) → **Deny assignments**. The column “Created by” is the tell.

Failure mode: delete blocked on a **lock** (`CanNotDelete` management lock), not a deny assignment. Locks show under Locks, not IAM. Check both. Failure mode: resource is in a **hidden** RG (`Microsoft.Azure.Monitor` etc.) with a deny from a first-party app. Stop. That is not an app RG.

When the deny is working as designed, the answer to the ticket is: move the workload to an app landing-zone subscription, or request platform change control. Granting the requester Owner at the MG so they can remove the deny is how landing zones die.

## Checklist

- [ ] Platform RGs protected by stack/managed-app deny assignments; app subscriptions not blanket-denied
- [ ] Operators know IAM → Deny assignments exists; runbooks do not start at Policy exemptions
- [ ] `az role assignment list` never used as proof that delete must work
- [ ] Excluded principal is a platform MI or PIM group, not a named leaver
- [ ] Break-glass UAA tested; Activity Log alert on deny assignment write/delete
- [ ] Policy Deny still used for public IPs / locations on app MGs ([Azure CSPM](/blog/azure-cspm-implementation-guide/))
- [ ] Locks vs deny assignments distinguished in the debug tree

**Related:** [Azure CSPM implementation](/blog/azure-cspm-implementation-guide/) · [CIEM explained](/blog/ciem-explained-for-cloud-teams/)
