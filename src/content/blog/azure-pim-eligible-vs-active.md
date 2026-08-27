---
title: "Entra PIM: Eligible vs Active Privileged Roles"
description: "Standing Owner is the finding; eligible is still a path. Approval, MFA on activate, Graph/PIM APIs, and how to put eligible edges on a security graph."
pubDate: 2026-08-27
updatedDate: 2026-08-27
author: OpenSourceOM Team
tags:
  - Azure
  - Entra PIM
  - CIEM
  - privileged access
  - identity
focusKeyword: Entra PIM eligible vs active
faq:
  - question: If someone is only Eligible, do they have the role?
    answer: >-
      Not until they activate. They also are not “no risk.” Eligibility is
      a standing right to become the role for up to the maximum activation
      duration, subject to MFA, approval, and Conditional Access on the
      activate action. Treat eligible as a latent admin edge, not as
      absence of privilege.
  - question: Why doesn’t az role assignment list show PIM eligible users?
    answer: >-
      That command lists Azure RBAC assignments that are currently in
      effect (active). Eligible-only directory or resource roles live in
      PIM schedule APIs (Graph for Entra roles, ARM for Azure resource
      roles). A clean role-assignment table is how standing admin hides
      next to a large eligible set.
  - question: Should I make a group Eligible or each user?
    answer: >-
      Prefer a role-assignable group that is Eligible for the role, with
      group membership governed (access reviews, limited owners). Eligible
      on 40 users is 40 activation paths and 40 audit stories. Nested
      groups that are not role-assignable will not receive Entra role
      eligibility the way you expect.
  - question: Is Active-with-end-date the same as Eligible?
    answer: >-
      No. Active means the role is in effect now. A time-bound Active
      assignment is still standing admin until the end time. Eligible
      means the role is not in effect until activate. Incident response
      cares about who is Active this hour; CIEM cares about who can
      become Active without another human granting the role.
---

PIM is “on” in a lot of tenants where every cloud admin is still **Active** `Global Administrator` or subscription **Owner** with no end date. That is not Privileged Identity Management; that is a PIM license next to standing admin. This page is only **eligible vs active**: what each means on Entra directory roles and Azure resource roles, what activate actually enforces, and how to put **eligible** on a graph so CIEM does not stop at `az role assignment list`.

It is not a generic PIM product tour and not Conditional Access design. APIs: [PIM for Entra roles](https://learn.microsoft.com/en-us/graph/api/resources/privilegedidentitymanagementv3-overview) and [PIM for Azure resources](https://learn.microsoft.com/en-us/azure/role-based-access-control/pim-azure-resource-roles).

## Standing admin is the finding

**Active** (permanent or with an end date in 2029) means the token the user gets from Entra already includes the role. Phish the user, steal the PRT, or abuse a consented app as that user, and the role is live. No activate step, no PIM approval ticket, no extra MFA on a distinct activate API.

```bash
# Azure resource roles currently in effect (Active), including inherited
az role assignment list --all --include-inherited \
  --query "[?roleDefinitionName=='Owner' || roleDefinitionName=='User Access Administrator'].{p:principalName,role:roleDefinitionName,scope:scope}" -o table
```

For Entra directory roles, Graph (not `az role assignment`):

```bash
az rest --method GET \
  --url "https://graph.microsoft.com/v1.0/roleManagement/directory/roleAssignmentScheduleInstances?\$expand=principal,roleDefinition"
```

Filter `assignmentType eq 'Assigned'` (standing) vs instances that exist only because someone activated.

Failure mode: you remove Owner from the subscription IAM blade, but the user is Active `User Access Administrator` at the management group and re-grants Owner in ten minutes. Another: Guest users with Active `Directory Readers` plus a second Active privileged role you forgot because the PIM blade was filtered to “privileged” and someone unmarked the role.

Standing admin is the [CIEM](/blog/ciem-explained-for-cloud-teams/) finding. Eligible is a different edge type. Do not close the ticket because “we turned on PIM.”

## Eligible is not zero risk

**Eligible** means the principal can call activate and, if policy allows, receive the role for a bounded duration. The role is not in the token until then. Risk remaining:

- The identity is still a **chosen** admin. Compromise plus activate (or coerce an approver) yields the role.
- Maximum duration is often 8 hours. That is a full shift of Owner.
- If activation requires **no** approval and MFA is only the same CA grant they already satisfied to open the portal, eligible is “click to admin.”
- Eligible on a **group** extends to every future member. Membership is the new standing grant.

```bash
# Entra eligible (not currently activated)
az rest --method GET \
  --url "https://graph.microsoft.com/v1.0/roleManagement/directory/roleEligibilityScheduleInstances?\$expand=principal,roleDefinition"

# Azure resource eligible at a subscription
az rest --method GET \
  --url "https://management.azure.com/subscriptions/${SUB}/providers/Microsoft.Authorization/roleEligibilityScheduleInstances?api-version=2020-10-01"
```

Failure mode: `roleEligibilityScheduleInstances` empty in a subscription because eligibility was assigned at the **management group**. Query the MG scope. The subscription IAM blade will look clean while Eligible Owner still lives one level up.

Count eligible Owners the way you count Active Owners. A tenant with 3 Active and 80 Eligible Global Administrators did not shrink blast radius; it hid it from the IAM blade.

## Approval and MFA on activate

PIM role settings are per role, per scope (Entra role vs each Azure resource catalog). The knobs that change eligible from “click” to “two-person”:

| Setting | If off | If on |
| --- | --- | --- |
| MFA on activation | Portal login MFA may already be satisfied; activate is free | Step-up on the activate call |
| Require justification / ticket | No audit narrative | Weak unless ticket is validated |
| Require approval | Eligible ≈ delayed Active | Approver is part of the path |
| Maximum duration | 8h default is still a lot of Owner | Shorter for break-glass vs daily ops |
| Conditional Access on activate | Any user who can open Entra can activate | Device / risk / location gates |

```bash
# Entra role policy (example: Global Administrator role definition id)
az rest --method GET \
  --url "https://graph.microsoft.com/v1.0/policies/roleManagementPolicyAssignments?\$filter=scopeId eq '/' and scopeType eq 'DirectoryRole'"
```

Failure mode: approval required, but the approver pool is the same team, and Teams approvals auto-approve from a mailbox rule. Failure mode: MFA on activate **and** “allow permanent eligible” for service principals. **Applications cannot activate PIM the way humans do.** If a pipeline needs Owner, that is a federated workload identity with a tight role, not Eligible Owner on a human.

Do not use Eligible as a substitute for removing unused people. Access reviews on Eligible groups are the drain; PIM settings are the friction on activate.

## Graphing eligible edges

A security graph that only ingests `roleAssignments` under-counts. Model at least:

```
principal --ACTIVE_ROLE--> role @ scope     (in effect now)
principal --ELIGIBLE_ROLE--> role @ scope   (can activate)
principal --MEMBER_OF--> group --ELIGIBLE_ROLE--> role
approver --CAN_APPROVE--> activation of (principal, role)
```

Queries that matter for [attack path analysis](/blog/attack-path-analysis-cloud-security/):

- Internet-facing workload identity **plus** that identity’s human owner is Eligible Owner on the subscription (social / device path into activate).
- Guest principal Eligible for `Privileged Role Administrator` (they can make themselves Active Global Admin if policy is weak).
- Group Eligible for Owner, group owners are not PIM-governed.

[OpenSourceOM](https://github.com/OpenSourceOM/core) is built to store those as first-class edges; the ingest is Graph + ARM PIM schedule instances, not only ARM `roleAssignments`. See [the graph](/docs/the-graph/) for how path queries treat optional vs live privilege. Ranking which eligible edges to burn first is [how to prioritize cloud vulnerabilities](/blog/how-to-prioritize-cloud-vulnerabilities/) applied to identity—not CVSS.

Export weekly:

```bash
# Who is Active right now (Entra)
az rest --method GET --url "https://graph.microsoft.com/v1.0/roleManagement/directory/roleAssignmentScheduleInstances?\$expand=principal,roleDefinition" > active-entra.json
```

Alert if `endDateTime` is null on a privileged Active assignment outside the break-glass set.

## Checklist

- [ ] Privileged Entra and Azure roles: zero permanent Active except named break-glass
- [ ] Eligible counted and reviewed; not treated as “no assignment”
- [ ] MFA + approval on activate for Owner, UAA, Global Admin, Privileged Role Admin
- [ ] Role-assignable groups, not 40 individual eligibilities
- [ ] `az role assignment list` is not the only inventory; PIM schedule APIs included
- [ ] Graph (or equivalent) has ELIGIBLE edges, not only ACTIVE
- [ ] Access reviews on eligible groups with expiry

**Related:** [CIEM explained](/blog/ciem-explained-for-cloud-teams/) · [Attack path analysis](/blog/attack-path-analysis-cloud-security/)
