---
title: "Blast Radius Analysis for Cloud IAM Roles"
description: "Walk blast radius for one AWS IAM role and one Azure managed identity: define admin-equivalent, then shrink that radius before you patch CVEs."
pubDate: 2026-08-27
updatedDate: 2026-08-27
author: OpenSourceOM Team
tags:
  - blast radius
  - CIEM
  - IAM
  - cloud identity
  - attack path analysis
focusKeyword: blast radius analysis cloud
faq:
  - question: Is blast radius the same as the number of policies attached?
    answer: >-
      No. Attached policy count is a document statistic. Blast radius is the set of nodes
      OpenSourceOM can reach by walking CAN_ASSUME and CAN_ACCESS from this identity,
      including roles it can pass or assume and data those roles can read. A role with one
      AdministratorAccess policy has a huge radius. A role with twelve tightly scoped
      customer-managed policies may not.
  - question: What does OpenSourceOM treat as admin-equivalent?
    answer: >-
      Actions that mint new admins or equivalent control of the account or subscription:
      iam:*, iam:CreateUser plus AttachUserPolicy, iam:PassRole to a privileged service,
      sts:AssumeRole on a privileged trust, Microsoft.Authorization/roleAssignments/write,
      or roles/iam.securityAdmin and roles/owner at project or above. Resource-admin on a
      single bucket is high impact, not account admin-equivalent, unless that bucket is
      the org's Terraform state.
  - question: Should I patch the CVE on the VM or shrink the instance profile first?
    answer: >-
      Shrink the profile (or break IRSA/WI) when the walk shows the identity is
      admin-equivalent or can CAN_ACCESS prod data. Patching a CVE leaves the same radius
      for the next finding. Patch in parallel if the CVE is on KEV; do not wait on a
      four-week IAM redesign to apply the patch, but do not close the path ticket on patch
      alone.
  - question: How is this different from the CIEM explainer?
    answer: >-
      CIEM is the discipline and the finding types (unused keys, star-star, unused roles).
      This page is one walk: start at a role or managed identity, list what compromise of
      that principal actually reaches, then cut. Use the CIEM post for program design;
      use this walk in the IR ticket.
---

**Blast radius** for a cloud identity is the set of assets and further identities you can reach if that principal is already compromised. It is not CVSS, not “this role looks important in the org chart,” and not a count of JSON files. OpenSourceOM computes it as a bounded walk: `Identity -[:CAN_ASSUME*0..n]-> Identity -[:CAN_ACCESS]-> (Datastore|Workload)`. Entitlement hygiene in general is [CIEM explained](/blog/ciem-explained-for-cloud-teams/). This page is **two worked identities**.

```
compromised principal
    --CAN_ASSUME-->  other roles (PassRole, trust, impersonate)
    --CAN_ACCESS-->  buckets, vaults, disks, k8s API
    --CAN_ACCESS-->  iam:Create* / roleAssignments/write   ← admin-equivalent
```

If the walk is empty except “read its own logs,” the CVE on the box that assumes this role is still a box problem. If the walk includes `AdministratorAccess` or `Owner`, the CVE is an account problem.

## Blast radius is not CVSS

CVSS scores a **vulnerability on a workload**. Blast radius scores an **identity**, whether or not a CVE exists.

| Signal | Answers | Lies when |
| --- | --- | --- |
| CVSS 9.8 | How bad is this bug in the abstract | The instance profile can do nothing |
| Policy name `ReadOnlyAccess` | What someone intended | Resource policies and `iam:PassRole` still widen the walk |
| OpenSourceOM blast radius | Nodes on `CAN_ASSUME`/`CAN_ACCESS` from this principal | Collectors missed the destination account |

A medium CVE plus an admin-equivalent instance profile is how [toxic combinations](/blog/toxic-combinations-aws-azure/) get built. Ranking that combo for the week is [reachable risk](/blog/reachable-risk-cloud-security/). Here you only measure the identity side: **from this ARN, what is the set?**

Failure mode: exporting “high privilege” from a CIEM tool that flags `s3:*` on one sandbox bucket the same as `s3:*` on `*`. OpenSourceOM keeps `CAN_ACCESS` edges to **named** datastores so the set is inspectable.

## Walk one AWS role and one Azure MI

### AWS: `payments-task` (ECS / IRSA)

Start with effective permissions, not the task definition comment.

```
aws iam simulate-principal-policy \
  --policy-source-arn arn:aws:iam::111111111111:role/payments-task \
  --action-names \
    s3:GetObject iam:PassRole iam:CreateUser sts:AssumeRole \
    rds:DeleteDBInstance \
  --resource-arns '*'

aws iam get-role --role-name payments-task \
  --query 'Role.AssumeRolePolicyDocument'
```

Suppose simulate says `iam:PassRole` on `*` and `lambda:CreateFunction`. That is a classic mint-admin path: create a Lambda, pass `payments-task` or a more privileged role, execute. OpenSourceOM should already have `CAN_ASSUME` from `payments-task` to any role whose trust accepts this principal, plus `CAN_ACCESS` to every resource the union of attached policies allows.

Add the **trust** direction: who can assume `payments-task`? If the trust is the ECS service plus `arn:aws:iam::111111111111:root`, every principal in the account that can `sts:AssumeRole` on this role is an inbound blast *into* the radius. Inbound and outbound are different walks. Outbound is “I am this role.” Inbound is “I can become this role.”

```
who can become payments-task          what payments-task can become
(workloads, users, other roles)  →  payments-task  →  PassRole / AssumeRole targets
                                                       →  S3 / Secrets / KMS
```

### Azure: managed identity `mi-payments-api`

```
az identity show -g rg-payments -n mi-payments-api --query principalId -o tsv
az role assignment list --assignee "$PRINCIPAL_ID" -o table
az rest --method POST \
  --uri "https://graph.microsoft.com/v1.0/servicePrincipals/$PRINCIPAL_ID/getMemberObjects" \
  --body '{"securityEnabledOnly": false}'
```

Look for `Contributor` or `User Access Administrator` on the subscription or on `rg-prod-data`. `User Access Administrator` is admin-equivalent: the MI can grant itself `Owner`. OpenSourceOM models that as `CAN_ACCESS` to `Microsoft.Authorization/roleAssignments/write` on the scope, which the walk treats as reaching every identity at that scope—not as a single RG badge.

Federated credentials (AKS workload identity, GitHub OIDC) are inbound `CAN_ASSUME` edges onto the MI. A pod annotation that points at this MI puts every pod using that SA into the inbound set.

Failure mode: listing role assignments on the MI and ignoring **Azure RBAC deny** and **PIM eligible** assignments. Eligible Owner that can be activated is still in the radius for a stolen refresh token with the right role. If your collector cannot see eligible assignments, say so on the ticket; do not report radius as “Contributor only.”

## What “admin-equivalent” actually means

OpenSourceOM sets `admin_equivalent` when the walk can **create a lasting control-plane principal** or **bind admin at account/subscription/project scope**. Concrete bars:

**AWS — treat as admin-equivalent**

- `AdministratorAccess` or `iam:*`
- `iam:CreateUser` + `iam:AttachUserPolicy` (or `PutUserPolicy`)
- `iam:PassRole` on a privileged role **and** a service that will run it (`lambda:CreateFunction`, `ec2:RunInstances`, `ecs:RegisterTaskDefinition`)
- `sts:AssumeRole` to a role that itself matches the above
- Ability to disable CloudTrail, GuardDuty, or org SCPs (often via the management account)

**Azure — treat as admin-equivalent**

- `Owner` or `User Access Administrator` at subscription or MG
- `Role Based Access Control Administrator`
- `Contributor` on the subscription **plus** the ability to assign identities to vaults/VMs that already have Owner (a two-hop mint)

**Not admin-equivalent (still high if data-sensitive)**

- `s3:GetObject` on one named bucket
- `Key Vault Secrets User` on one vault
- `rds:Describe*` without `Delete`/`Modify` and without `iam:`

Terraform state buckets and GitHub OIDC deploy roles are **data-admin or pipeline-admin**: not `iam:*`, but compromising them is org-equivalent in practice. Tag those datastores `sensitivity: control-plane` so the walk ranks them with admin, not with “one bucket.”

Failure mode: calling every `*Access` managed policy admin. `ReadOnlyAccess` plus a resource policy that allows `s3:GetObject` from that role is data radius, not IAM admin. Conversely, a custom policy with four actions can be admin-equivalent. Read the actions, not the name.

## Shrink radius before you patch

Patching the workload removes one `AFFECTS` edge. The identity walk remains. Order of operations when the graph shows admin-equivalent:

1. **Remove inbound assume** you do not need (trust `root`, federated credential for a deleted cluster, GitHub repo `*`).
2. **Detach admin-equivalent actions** (`iam:PassRole` on `*`, `User Access Administrator`). Replace with a named role ARN and a named RG.
3. **Split the role.** Runtime task gets `s3:GetObject` on `prod-pii/*`. Deploy role (CI) keeps `ecs:UpdateService`. Do not share them.
4. **Then patch.** KEV/critical CVEs still get a patch window; they just are not the only ticket.

OpenSourceOM re-query after (1)–(3) should drop `admin_equivalent` and shorten `CAN_ACCESS`. If it does not, you missed a resource policy or an SCP exception—[multi-account AWS attack paths](/blog/multi-account-aws-attack-paths/) cover org-shaped surprises.

Failure mode: creating a “break-glass” clone of the same policy and attaching it to a second role “for rollback.” You doubled the inbound set.

## Checklist

- [ ] Walk outbound `CAN_ASSUME`/`CAN_ACCESS` from the role or MI; list named datastores, not policy filenames
- [ ] Walk inbound trust / federated credentials / `PassRole` into that principal
- [ ] `admin_equivalent` matches mint-admin actions, not marketing policy names
- [ ] Terraform state and deploy OIDC roles tagged as control-plane sensitivity
- [ ] Shrink trust and detach PassRole/UAA before closing the path ticket
- [ ] Patch KEV in parallel; do not close reachable-risk on patch alone if radius is still admin
- [ ] Collector sees destination accounts and PIM eligible assignments, or the ticket says radius is incomplete

---
**Related:** [CIEM explained](/blog/ciem-explained-for-cloud-teams/) · [Toxic combinations](/blog/toxic-combinations-aws-azure/) · [Reachable risk](/blog/reachable-risk-cloud-security/)
