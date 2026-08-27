---
title: "Custom Organization Policy Constraints on GCP"
description: "Write GCP custom organization policy constraints in CEL, dry-run them, and use them when IAM cannot express a resource-shape rule. Not a generic org policy recap."
pubDate: 2026-08-27
updatedDate: 2026-08-27
author: OpenSourceOM Team
tags:
  - GCP
  - organization policy
  - CEL
  - custom constraints
  - governance
focusKeyword: GCP custom organization policy constraints
faq:
  - question: When should I write a custom constraint instead of a managed one?
    answer: >-
      When Google already ships iam.disableServiceAccountKeyCreation,
      compute.restrictProtocolForwardingCreationForTypes, and similar,
      use those. Write a custom constraint when you need CEL on a
      resource field the managed list does not cover—for example a
      specific Cloud Run ingress value, a machine series your finance
      team banned, or a label that must exist on CREATE. Do not
      reimplement managed constraints in CEL.
  - question: Does org policy dry-run block the API call?
    answer: >-
      No. dryRunSpec (or dry-run enforcement) logs violations and
      reports them in Policy Intelligence / Cloud Logging without
      rejecting the request. Enforce only after the dry-run stream is
      explained (real violations vs unsupported fields). IAM deny is
      a different plane and is live as soon as the deny policy exists.
  - question: Can custom constraint CEL inspect IAM bindings?
    answer: >-
      No. Custom constraints evaluate the resource payload on CREATE
      and UPDATE (and sometimes DELETE) for supported resource types.
      They do not walk folder IAM. Who can call the API is still IAM
      ([GCP IAM hardening](/blog/gcp-iam-security-hardening/)). Custom
      constraints answer “even Owner cannot set this field.”
  - question: Why was my custom constraint ignored on an existing VM?
    answer: >-
      Constraints apply to mutating requests, not to a retrospective
      scan of every VM. A machine type created last year stays until
      someone UPDATEs it (or you build a separate ARG/Asset query).
      Dry-run plus Asset Inventory is how you find the backlog;
      the constraint only guards the next change.
---

Managed organization policies are a list Google maintains: disable SA keys, skip default network, restrict resource locations. **Custom organization policy constraints** let you attach **CEL** to a resource type Google has opened up, so the org can deny shapes that never got a managed constraint.

This page is only that: custom vs managed, CEL examples, dry-run, when this beats adding another IAM role. It is not a recap of every managed constraint and not a multi-cloud “why org policy matters” essay. API: [custom constraints](https://cloud.google.com/resource-manager/docs/organization-policy/creating-custom-constraints).

## Managed vs custom constraints

| | Managed constraint | Custom constraint |
| --- | --- | --- |
| Who defines the rule | Google (`iam.disableServiceAccountKeyCreation`) | You (`custom.denyExternalCloudRunIngress`) |
| Language | Constraint-specific parameters (deny / allow lists) | CEL on `resource.*` |
| Resource coverage | Documented list | Documented **supported** types only—unsupported types silently cannot use custom |
| Typical use | Industry-default footguns | Company-specific shapes |

```bash
# What Google already gives you
gcloud org-policies list-constraints --organization="${ORG_ID}" | grep iam.disable

# Custom constraints you created
gcloud org-policies list-custom-constraints --organization="${ORG_ID}"
```

If the managed constraint exists, **set it**. Custom CEL that duplicates `iam.disableServiceAccountKeyCreation` is a second console, a second dry-run, and a worse error message. Put key disable in managed policy; put “Cloud Run must be internal” in custom if that managed constraint is missing or too coarse for your rule.

Failure mode: custom constraint on a resource type not in the support matrix. `gcloud` accepts the constraint YAML; CREATE of that resource never evaluates it. Check [supported resources](https://cloud.google.com/resource-manager/docs/organization-policy/custom-constraint-supported-services) for your service before promising the CISO.

## CEL examples

Constraint object (org-level, once):

```yaml
name: organizations/ORG_ID/customConstraints/custom.requireInternalCloudRun
resourceTypes:
  - run.googleapis.com/Service
methodTypes:
  - CREATE
  - UPDATE
condition: "resource.ingress != 'INGRESS_TRAFFIC_INTERNAL_ONLY'"
actionType: DENY
displayName: Cloud Run ingress must be internal
description: Public and internal-and-cloud-load-balancing ingress denied
```

```bash
gcloud org-policies set-custom-constraint require-internal-cloudrun.yaml
```

Policy that **enforces** it on a folder (separate object):

```yaml
name: folders/FOLDER_ID/policies/custom.requireInternalCloudRun
spec:
  rules:
    - enforce: true
```

Machine series ban (illustrative CEL; field names must match the resource proto Google exposes to org policy):

```
resource.machineType.matches(".*/machineTypes/f1-micro$") ||
resource.machineType.matches(".*/machineTypes/g1-small$")
```

`actionType: DENY` with that condition means those types cannot be created. Invert carefully: a bug in the predicate can deny **all** VMs or **none**.

Labels:

```
!("cost-center" in resource.labels)
```

Deny CREATE/UPDATE when the label is missing. IAM cannot express “Owner may create VMs only if this label is set” without a custom role **and** a process; the constraint does it on the payload.

```bash
gcloud org-policies set-policy policy-run-internal.yaml --folder="${FOLDER_ID}"
```

Failure mode: CEL written against a field that is output-only or not in the constraint resource schema. Dry-run never fires; enforce never fires; you thought you banned public Run. Dump a successful resource JSON from Asset Inventory and write CEL against **those** names.

Failure mode: `condition` true means “this request is a violation” for `DENY` constraints. Flipping the boolean in your head (`!=` vs `==`) is how you deny all ingress types except the one you wanted to kill.

## Dry-run

Attach a dry-run spec **before** `spec.rules.enforce: true` on production folders:

```yaml
name: folders/FOLDER_ID/policies/custom.requireInternalCloudRun
spec:
  rules:
    - enforce: false
dryRunSpec:
  rules:
    - enforce: true
```

```bash
gcloud org-policies set-policy policy-run-internal-dryrun.yaml --folder="${FOLDER_ID}"
```

Violations land in Cloud Logging / Policy Intelligence as dry-run, not as `FAILED_PRECONDITION` on `gcloud run deploy`. Watch for a week of Cloud Build and Terraform applies.

```bash
gcloud logging read \
  'protoPayload.methodName:"SetOrgPolicy" OR jsonPayload.@type:"type.googleapis.com/google.cloud.orgpolicy.v2.Constraint"' \
  --project="${PROJECT_ID}" --limit=20
```

(Use the current dry-run log filter from Google’s dry-run docs; field names have shifted.) Correlate with the service’s own audit log (`run.googleapis.com`) for the same `principalEmail`.

Only copy `dryRunSpec` into `spec` when:

- Every dry-run hit has an owner (fix ingress vs false positive on an unsupported update path)
- Automation SAs that deploy public Run **intentionally** (a marketing site) have a folder **outside** this policy, not an untracked exemption

Failure mode: enforce on day one at org. Every existing pipeline that sets `INGRESS_TRAFFIC_ALL` starts failing in parallel. Dry-run exists so you get a list, not an incident.

## When custom constraints beat IAM

IAM answers **who**. Custom constraints answer **what the resource is allowed to look like**, including for `roles/owner` on the project.

| Goal | IAM | Custom constraint |
| --- | --- | --- |
| Only the platform SA deploys Run | Bind `roles/run.admin` to that SA | Does not replace the binding |
| Even Owner cannot set public ingress | Cannot, unless you remove Owner | CEL on `resource.ingress` |
| No f1-micro in prod folder | Custom role without `compute.instances.create` is too blunt | CEL on machine type |
| No SA keys | `roles/iam.serviceAccountKeyAdmin` removal **plus** managed constraint | Managed, not custom |

If the problem is “too many people have Editor,” fix IAM ([GCP IAM security hardening](/blog/gcp-iam-security-hardening/)). If the problem is “Owner still ships a public Cloud Run in the PCI folder,” that is a custom (or managed) constraint. Path-style ranking of leftover public services is [how to prioritize cloud vulnerabilities](/blog/how-to-prioritize-cloud-vulnerabilities/).

Custom constraints do not graph identity. They are guardrails on mutate. Keep deny policies for permissions IAM should never grant; keep PAB for contractor ceilings; keep custom org policy for resource shape.

## Checklist

- [ ] Managed constraint used whenever Google already ships the control
- [ ] Custom constraint resource type is on the supported list; Asset JSON used for field names
- [ ] CEL reviewed for inverted booleans; throwaway project proves DENY
- [ ] `dryRunSpec` on prod folder until violations are owned
- [ ] Policy attached at folder (PCI / prod), not copied blindly to sandbox
- [ ] IAM still least-privilege; constraint is not an excuse to leave Owner
- [ ] Backlog of **existing** resources inventoried with Asset Search (constraint will not retrofit them)

**Related:** [GCP IAM security hardening](/blog/gcp-iam-security-hardening/) · [How to prioritize cloud vulnerabilities](/blog/how-to-prioritize-cloud-vulnerabilities/)
