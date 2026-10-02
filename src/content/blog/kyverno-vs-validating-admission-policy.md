---
title: "Kyverno vs ValidatingAdmissionPolicy"
description: "ValidatingAdmissionPolicy denies object shape in-process. Kyverno still generates objects, verifies images, and reports on resources that already exist. Do not run both on the same rule."
pubDate: 2026-10-02
updatedDate: 2026-10-02
author: OpenSourceOM Team
tags:
  - Kubernetes
  - Kyverno
  - ValidatingAdmissionPolicy
  - admission control
  - policy as code
focusKeyword: Kyverno vs ValidatingAdmissionPolicy
faq:
  - question: Does ValidatingAdmissionPolicy replace Kyverno?
    answer: >-
      For deny-only checks on the object in the request, yes. CEL runs in
      the API server, so a down policy controller cannot fail that check
      open. Kyverno remains the engine for generating objects, verifying
      image signatures, background scans of resources that already exist,
      and mutation on clusters older than 1.36.
  - question: Why does kubectl apply of a Deployment succeed when pods are forbidden?
    answer: >-
      A ValidatingAdmissionPolicy that matches only pods runs when the
      ReplicaSet creates the pod, not when the Deployment is admitted.
      The apply succeeds and the new pods never start. Kyverno pod-controller
      autogen rejects the Deployment. Generating a ValidatingAdmissionPolicy
      from a Kyverno policy turns that autogen off.
  - question: Is MutatingAdmissionPolicy a reason to remove Kyverno?
    answer: >-
      On a cluster that is actually 1.36 or newer, in-process mutation is
      GA and on by default. Many clusters are older; there the mutator is
      still a webhook. Generation, image verification, and background
      reports are not mutation, and CEL admission does not do them.
---

`kubectl apply` of the Deployment returns success. The ReplicaSet then sits at 0 ready, and the event says the pod was denied by a `ValidatingAdmissionPolicy`. The policy matches `pods`. The Deployment object was never in that match. A Kyverno rule with pod-controller autogen would have rejected the apply.

**Kyverno vs ValidatingAdmissionPolicy** is which engine owns which check. CEL syntax, `failurePolicy`, and parameter resources are [ValidatingAdmissionPolicy](/blog/kubernetes-validating-admission-policy/). Image signatures are [image provenance and SLSA](/blog/kubernetes-image-provenance-slsa/). This page is the split.

Kyverno’s own matrix: [ValidatingPolicy](https://kyverno.io/docs/policy-types/validating-policy/). Native mutation: [MutatingAdmissionPolicy](https://kubernetes.io/docs/reference/access-authn-authz/mutating-admission-policy/), stable in Kubernetes 1.36.

## What each one can decide

| Need | ValidatingAdmissionPolicy | Kyverno |
| --- | --- | --- |
| Deny privileged, hostPath, hostNetwork, floating tags | Yes, in the API server | Yes, if you still webhook it |
| Reject a Deployment whose pod template is bad, at apply time | Only if you also match that controller and write CEL against `spec.template` | Pod-controller autogen |
| Scan pods that already exist | No. Admission does not replay | Background scan, PolicyReport |
| Create a NetworkPolicy when a Namespace appears | No | Generate rules |
| Verify Cosign / Sigstore at admission | No. CEL does not call a registry | `verifyImages` |
| Mutate (default seccomp, drop caps, labels) | `MutatingAdmissionPolicy`, GA in 1.36 | Webhook on older clusters |
| Namespaced exception object | No. Bypass is editing the cluster-scoped policy or its binding | `PolicyException` |

A deny you can express as “this object’s fields are wrong” belongs in `ValidatingAdmissionPolicy` with `failurePolicy: Fail` and a binding `validationActions: ["Deny"]`. The API server evaluates it when the policy-controller Deployment is unschedulable. A webhook with `failurePolicy: Ignore` does the opposite during that outage: the privileged pod is admitted.

## Autogen and generated VAPs are alternatives

Kyverno can mint a `ValidatingAdmissionPolicy` from a `ValidatingPolicy` (`spec.autogen.validatingAdmissionPolicy.enabled`). It can also expand a pod rule to Deployments, Jobs, CronJobs, and StatefulSets (`spec.autogen.podControllers`).

Those two switches are mutually exclusive. Pod-controller autogen means Kyverno does **not** generate the `ValidatingAdmissionPolicy`, and the policy status says why: a `ValidatingAdmissionPolicy` is evaluated by the API server and cannot carry the controller-shaped copies Kyverno would have written. Turn on VAP generation and you lose apply-time rejection of the Deployment unless the CEL you wrote already matches those kinds.

Matching only `pods` is still a correct deny. It is a bad developer experience and a bad audit signal: Git shows a green Deployment, the cluster has no new pods, and the old pods keep running because nothing re-admits them. If the control has to fail the pipeline, match the controllers too or keep autogen and do not generate a VAP for that rule.

```yaml
# VAP: this denies the pod the ReplicaSet tries to create.
# The Deployment apply already succeeded.
spec:
  matchConstraints:
    resourceRules:
      - apiGroups: [""]
        apiVersions: ["v1"]
        operations: ["CREATE", "UPDATE"]
        resources: ["pods"]
```

Write a second `resourceRules` entry for `apps/v1` `deployments` only if the expression reads `object.spec.template.spec`, not `object.spec`. One expression copied from the pod rule onto a Deployment does not see containers and can error. With `failurePolicy: Fail` that error denies the Deployment, including ones that were fine. That is a different outage from the one you meant to build.

## What stays on Kyverno

**Resources that already exist.** Installing a VAP does not list privileged pods. They remain until something updates them. Kyverno’s background scan writes a PolicyReport for the current objects. A program that only checks “admission would deny” will call the cluster clean while those pods run. Keep the scan, or accept that the VAP’s enforce date is the date each workload is rolled.

**Generate.** A namespace label that should produce a default-deny NetworkPolicy is a second API call. CEL admission can reject the Namespace. It cannot create the NetworkPolicy. That rule stays a Kyverno generate rule.

**Signatures.** “Digest is pinned” is a VAP. “This digest was signed by our key” needs a witness outside the object. That is Kyverno or another verifier, at admission, on the digest. The provenance page is that control. Do not encode it as a CEL prefix check and call it verification.

**Mutation below 1.36.** `MutatingAdmissionPolicy` and `MutatingAdmissionPolicyBinding` are `admissionregistration.k8s.io/v1` and on by default in Kubernetes 1.36 (April 2026). `kubectl version` on the cluster you are changing is the fact that matters. EKS and other managed offerings lag upstream. On 1.35 and older the mutator is still a webhook. Deleting Kyverno the week upstream went GA, without checking the cluster, removes the mutation and leaves the pods without the seccomp profile you thought was in-process.

## One owner per rule

Two denies for privileged pods — a VAP and a Kyverno webhook — fail in different orders and with different text. The webhook’s `failurePolicy: Ignore` then becomes a hole next to a VAP that was supposed to be the control, or a second 403 you debug for a week when both are `Fail`. Pick one.

Kyverno `PolicyException` is namespaced. Whoever can create that object in the namespace can exempt a pod from the Kyverno rule. RBAC on `policyexceptions` is the bypass. A VAP has no exception CRD. The bypass is `update` on the cluster-scoped `ValidatingAdmissionPolicy` or its binding, which is a cluster-admin verb, not a namespace developer verb. Moving a rule from Kyverno to a VAP changes who can waive it. Do that on purpose. Namespace developer RBAC is [Kubernetes RBAC](/blog/kubernetes-rbac-security-best-practices/).

Leave Kyverno installed for generate, verify, background reports, and mutation you have not moved. Stop sending it the denies CEL already enforces. A webhook outage should not be on the path of `privileged == false`.

## Checklist

- [ ] `kubectl version` recorded. Mutation is in-process only on 1.36+
- [ ] Shape denies (privileged, hostPath, hostNetwork, digest) are VAP with `failurePolicy: Fail` and binding `Deny`
- [ ] Those same rules are not also enforced by a Kyverno webhook
- [ ] Deployments are rejected at apply, or you have accepted ReplicaSet failures and written that down
- [ ] `autogen.podControllers` and `autogen.validatingAdmissionPolicy` are not both set on one policy
- [ ] Background PolicyReports still cover objects that predate the VAP
- [ ] Generate rules and `verifyImages` still have a running Kyverno (or another engine that can do those jobs)
- [ ] `PolicyException` RBAC reviewed before calling a Kyverno validate rule a control

**Related:** [ValidatingAdmissionPolicy](/blog/kubernetes-validating-admission-policy/) · [Image provenance and SLSA](/blog/kubernetes-image-provenance-slsa/) · [Kubernetes RBAC](/blog/kubernetes-rbac-security-best-practices/)
