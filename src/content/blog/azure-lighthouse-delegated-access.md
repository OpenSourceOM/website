---
title: "Azure Lighthouse: Cross-Tenant Access Without Guest Users"
description: "Azure Lighthouse is cross-tenant RBAC, not a guest user. Eligible authorizations, roles to refuse, and deny assignments that still bind the partner."
pubDate: 2026-09-25
updatedDate: 2026-09-25
author: OpenSourceOM Team
tags:
  - Azure
  - Lighthouse
  - RBAC
  - Entra ID
  - third-party access
focusKeyword: Azure Lighthouse security
faq:
  - question: Is a Lighthouse principal a guest in my tenant?
    answer: >-
      No. The partner signs in to their own tenant. Lighthouse projects
      their group onto a role at a subscription or resource group in yours.
      You will not find them under Entra guests. Deleting guest users does
      not offboard the partner. Delete the registration assignment.
  - question: Which roles should a delegation never include?
    answer: >-
      Owner (8e3af657-a8ff-443c-a75c-2fe8c4bcb635) and User Access
      Administrator (18d7d88d-d35e-4fb5-a5c3-7773c20a72d9) as permanent
      authorizations. Both can grant further access. If a partner needs
      a privileged role for an incident, put it in eligibleAuthorizations
      with a short activation, not in authorizations.
  - question: Do deny assignments apply to the partner?
    answer: >-
      Yes. A Lighthouse Contributor is still subject to deny assignments
      on the subscription. Landing-zone denies do not stop at the tenant
      boundary. Check them before you conclude the partner bypassed policy
      because they are “outside” the directory.
---

```bash
az managedservices assignment list --subscription "$SUBSCRIPTION_ID" \
  -o table
```

Each row is an **Azure Lighthouse** delegation: a partner tenant (`managedByTenantId`) and a role on this subscription or resource group. There is no guest user to disable. Offboarding is deleting the assignment. The service model is documented in [Azure Lighthouse architecture](https://learn.microsoft.com/en-us/azure/lighthouse/concepts/architecture).

In-tenant just-in-time admin is [PIM eligible vs active](/blog/azure-pim-eligible-vs-active/). Lighthouse’s `eligibleAuthorizations` are the cross-tenant version of that idea. They are not a substitute for reviewing who is in the partner’s group.

## Authorizations versus eligible

Permanent `authorizations` are always on. `eligibleAuthorizations` require activation and can require MFA and a maximum duration. Put day-to-day operations in a narrow built-in role (Reader, a custom support role, Contributor only if they must change resources). Put anything privileged in eligible, for two hours, with MFA.

Role definition ids that do not belong in permanent authorizations:

| Role | Definition id | Why |
| --- | --- | --- |
| Owner | `8e3af657-a8ff-443c-a75c-2fe8c4bcb635` | Can create assignments of its own |
| User Access Administrator | `18d7d88d-d35e-4fb5-a5c3-7773c20a72d9` | Can grant roles without owning resources |
| Contributor | `b24988ac-6180-42a0-ab88-20f7382dd24c` | Acceptable only on a resource group you named, not on every subscription |

Contributor at subscription scope is “the partner can change production.” Scope the registration to the resource group they operate. A delegation at the subscription is not limited to the resource group they mentioned in the contract.

The principal id should be a group in the partner tenant, not a person. You still do not control membership of that group. Write the contract so they tell you when the group changes, and review Activity Log callers monthly. The user name in the Activity Log is the partner’s UPN, on your subscription’s logs. Alert on `Microsoft.Authorization/roleAssignments/write` by a principal whose home tenant is not yours.

## Deny assignments still apply

[Landing-zone deny assignments](/blog/azure-landing-zone-deny-assignments/) apply to the delegated principal. A partner with Contributor via Lighthouse cannot perform an action the deny lists, including actions Owner would have had. That is useful, and it is surprising the first time a partner opens a ticket that your own operators also cannot do.

It is not a reason to grant Owner “so the deny is the only restriction.” Owner plus a missing deny is the partner’s tenant as a standing admin of yours. Keep the deny, and keep the delegation off Owner.

## Offboarding

```bash
az managedservices assignment delete \
  --assignment "$ASSIGNMENT_ID" \
  --subscription "$SUBSCRIPTION_ID"
```

Then check the paths Lighthouse does not cover:

- Entra B2B guests with direct role assignments (a different feature, often set up “temporarily” during onboarding)
- App registrations and federated credentials the partner added
- Role assignments at resource groups created after the delegation, which they may have made themselves if they had User Access Administrator

`az role assignment list --all` and look for principal types you do not recognize. A deleted Lighthouse assignment does not cascade to RBAC the partner created while they had UAA.

Registering a delegation is `Microsoft.ManagedServices/registrationAssignments/write`. In a tenant that should not have partners, deny that action with Azure Policy except on a subscription used for the one managed service you actually bought. A policy that audits Owner and User Access Administrator definition ids inside registration definitions is the check for the tenants that should.

## Checklist

- [ ] `az managedservices assignment list` matches the partners you believe you have
- [ ] No permanent Owner or User Access Administrator in `authorizations`
- [ ] Privileged access is `eligibleAuthorizations` with a short duration and MFA
- [ ] Scope is a resource group, not every subscription, unless the contract really is the subscription
- [ ] Principal is a group; Activity Log alerts on role assignment writes by foreign UPNs
- [ ] Deny assignments still cover the actions you cannot afford, including for this principal
- [ ] Offboarding deletes the assignment and then reviews guests and role assignments they created

The partner never showed up in your guest list. The assignment list is the guest list.
