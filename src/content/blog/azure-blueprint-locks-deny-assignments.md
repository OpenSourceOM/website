---
title: "Azure Blueprint Locks Are Deny Assignments"
description: "Blueprint Read Only and Do Not Delete locks are deny assignments. Microsoft removes those denies on 31 January 2027. Map them onto a deployment stack before then."
pubDate: 2026-10-02
updatedDate: 2026-10-02
author: OpenSourceOM Team
tags:
  - Azure
  - Blueprints
  - deny assignments
  - deployment stacks
  - landing zone
focusKeyword: Azure Blueprint lock deny assignment
faq:
  - question: What happens to blueprint locks on 31 January 2027?
    answer: >-
      Azure Blueprints is retired that day. The API stops, and blueprint
      locks — the deny assignments — are removed. Resources the blueprint
      deployed stay in place and keep ordinary RBAC. Subscription Owners
      can then delete or edit what the lock was blocking. Policy assignments
      are a different object and are not removed by this retirement.
  - question: Which deployment stack deny setting replaces Read Only?
    answer: >-
      denyWriteAndDelete. Do Not Delete maps to denyDelete. A template spec
      stores the template and creates no deny assignment. The lock exists
      only if you deploy that template with a stack and set deny settings.
  - question: Can I delete the blueprint deny assignment from IAM?
    answer: >-
      Not while the blueprint assignment still owns it. Change the lock
      mode or remove the assignment after a deployment stack is already
      enforcing the same deny. Deleting the blueprint first drops the
      protection for the whole window until the stack exists.
---

The hub firewall’s IAM blade shows a deny assignment the platform team did not create with `az role assignment create`. The name and description point at a blueprint assignment, lock mode `AllResourcesDoNotDelete`. That deny is the lock. It is not an Azure Policy `Deny`, and it is not on the role-assignment list.

**Azure Blueprint locks** are deny assignments created by the blueprint assignment. How deny assignments differ from Policy, and how landing zones use them on purpose, is [landing-zone deny assignments](/blog/azure-landing-zone-deny-assignments/). This page is the blueprint lock itself, and the date Microsoft removes it.

Retirement schedule: [Azure Blueprints retirement](https://learn.microsoft.com/en-us/azure/governance/blueprints/blueprint-retirement). Lock behavior: [resource locking](https://learn.microsoft.com/en-us/azure/governance/blueprints/concepts/resource-locking).

## What is already on the clock

| Date | What changes |
| --- | --- |
| 31 July 2026 | New blueprint definitions and versions can no longer be created. This date has passed. |
| 31 October 2026 | Existing definitions can no longer be modified. New blueprint assignments can no longer be created. |
| 31 December 2026 | Existing assignments can no longer be modified. |
| 31 January 2027 | The API stops. Definitions and assignments disappear from the portal. **Blueprint deny assignments are removed.** Deployed resources remain. |

A subscription Owner who cannot delete the hub today can delete it on 1 February 2027 if the only control was the blueprint lock. Policy assignments the blueprint also deployed are separate resources; this retirement does not delete them. Anything you were enforcing only with the lock — not with Policy, not with a management lock, not with a deployment stack — goes away that day even if you never press delete.

Export definitions you still need before 31 January 2027. After retirement they are not recoverable from the service.

## Lock mode to deny setting

| Blueprint lock | What the deny assignment blocks | Deployment stack `--deny-settings-mode` |
| --- | --- | --- |
| None | Nothing from the blueprint | `none` |
| Do Not Delete (`AllResourcesDoNotDelete`) | Delete | `denyDelete` |
| Read Only (`AllResourcesReadOnly`) | Write and delete | `denyWriteAndDelete` |

The blueprint assignment’s identity is excluded so the blueprint can still update its own resources. Everyone else, including Owner, hits `AuthorizationFailed`. `az role assignment list` does not show this object. List deny assignments:

```bash
az rest --method GET \
  --url "https://management.azure.com/subscriptions/${SUB}/providers/Microsoft.Authorization/denyAssignments?api-version=2022-04-01"
```

Match `properties.description` / `denyAssignmentName` to the blueprint assignment. Portal: Subscription → Access control (IAM) → Deny assignments. “Created by” is the tell. A `CanNotDelete` resource lock is a different blade and survives blueprint retirement; do not confuse the two when you inventory what is actually protecting the hub.

A template spec (`Microsoft.Resources/templateSpecs`) stores a versioned template. It does not create a deny assignment. Moving the blueprint JSON into a template spec and stopping there drops the lock on the day you remove the blueprint, not on 31 January 2027.

## Replace the lock before you remove the blueprint

Put the stack at the **parent** of the resources — management group for a subscription-scoped set, subscription for a resource-group set — so the people who have Owner on the workload cannot delete the stack and take the deny with it. Microsoft’s migration path is deployment stacks, not a second blueprint.

```bash
az stack sub create \
  --name platform-hub \
  --location eastus \
  --subscription "${SUB}" \
  --template-file hub.bicep \
  --action-on-unmanage detachAll \
  --deny-settings-mode denyDelete \
  --deny-settings-excluded-principals "${PLATFORM_GROUP_OBJECT_ID}"
```

`denyDelete` is the Do Not Delete equivalent. Use `denyWriteAndDelete` for Read Only. Excluded principals are Entra object ids, at most five; a platform group is the usual one, because removing a person should be a group edit rather than a stack update. `--action-on-unmanage detachAll` means deleting the stack later detaches the resources instead of deleting them. `deleteAll` deletes the managed resources. On a hub, that flag is the outage.

Confirm the stack’s deny assignment is listed and that a non-excluded Owner still cannot delete a protected resource. Then remove the blueprint assignment. The other order — delete the blueprint, then author the stack — is a window where Owner works. Do that in a sandbox subscription, not on the hub.

Deployment stacks and who is allowed to edit `denySettings` are easy to widen: subscription Owner on the stack’s scope can change the mode. Parent scope is the control. Break-glass for the stack is the same problem as any other deny assignment: an excluded principal you can still operate, tested before you need it. The landing-zone page covers that debug loop.

Failure mode: two denies on the same firewall, blueprint and stack, and an operator deletes the blueprint assignment thinking it is unused. The stack deny should remain. Check the deny list after the delete and confirm one assignment is still there. Failure mode: `deny-settings-excluded-principals` is a user who has left, stack updates start failing, and someone sets the mode to `none` to unblock CI. That is the lock being removed on purpose.

## Checklist

- [ ] Every production blueprint assignment’s lock mode written down (None vs Do Not Delete vs Read Only)
- [ ] Deny assignments correlated to those assignments; resource locks and Policy Deny counted separately
- [ ] Replacement stack exists at parent scope with `denyDelete` or `denyWriteAndDelete` **before** the blueprint assignment is removed
- [ ] `--action-on-unmanage detachAll` on stacks that must not delete the hub
- [ ] Excluded principal is a platform group object id, and a non-member Owner still cannot delete
- [ ] Definitions exported before 31 January 2027
- [ ] A calendar reminder that 31 October 2026 stops new assignments and definition edits, and 31 January 2027 removes the denies whether or not you migrated

**Related:** [Landing-zone deny assignments](/blog/azure-landing-zone-deny-assignments/) · [Azure CSPM implementation](/blog/azure-cspm-implementation-guide/) · [CIEM explained](/blog/ciem-explained-for-cloud-teams/)
