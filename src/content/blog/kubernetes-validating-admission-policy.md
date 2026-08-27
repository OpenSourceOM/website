---
title: "Kubernetes Validating Admission Policy (CEL) vs Webhooks"
description: "Native ValidatingAdmissionPolicy with CEL: built-in policies, when you still need Kyverno or Gatekeeper, parameter resources, and FailurePolicy Fail vs Ignore."
pubDate: 2026-08-27
updatedDate: 2026-08-27
author: OpenSourceOM Team
tags:
  - Kubernetes
  - ValidatingAdmissionPolicy
  - CEL
  - admission control
  - policy as code
focusKeyword: Kubernetes Validating Admission Policy
faq:
  - question: Is ValidatingAdmissionPolicy a replacement for OPA Gatekeeper?
    answer: >-
      For many deny-only checks on Kubernetes objects, yes. CEL runs in-process on
      the API server. You lose mutation, template generation, and the Rego/Kyverno
      ecosystems. Keep a webhook engine when you must mutate, generate NetworkPolicies,
      or express policies Gatekeeper already owns at scale.
  - question: What Kubernetes version do I need for production VAP?
    answer: >-
      ValidatingAdmissionPolicy is GA as of 1.30. Run 1.30+ (preferably the version
      your vendor supports with the VAP feature on by default). On 1.28–1.29 it was
      beta; do not build a compliance program on a beta admission path.
  - question: Should FailurePolicy be Ignore so we never brick the cluster?
    answer: >-
      No for security policies. Ignore means an error evaluating CEL admits the
      object. Fail means a policy bug or timeout denies. Use Fail on policies that
      exist to block privileged pods; use Ignore only on experimental audit-style
      policies, and do not call those a control.
---

```yaml
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingAdmissionPolicy
metadata:
  name: deny-latest-tag
spec:
  failurePolicy: Fail
  matchConstraints:
    resourceRules:
      - apiGroups: [""]
        apiVersions: ["v1"]
        operations: ["CREATE", "UPDATE"]
        resources: ["pods"]
  validations:
    - expression: >-
        object.spec.containers.all(c,
          !c.image.contains(":") || c.image.contains("@sha256:"))
      message: "containers must use a digest, not a floating tag"
```

That object is **Kubernetes Validating Admission Policy**: CEL compiled into the API server. No webhook Deployment, no TLS cert rotation for `policy-controller`, no `connection refused` during a node drain that admits `privileged: true` for thirty seconds.

This page is the native API. It is not a Gatekeeper install guide and not a Kyverno policy catalog. Those engines still exist; they are optional once the deny you need fits in CEL.

## Built-in CEL policies

VAP evaluates `expression` against `object` (and `oldObject` on UPDATE). The language is the same CEL family as ValidatingAdmissionWebhook matchConditions, plus Kubernetes libraries (`has()`, `list.all`, `json`).

Useful built-ins for security:

| Check | CEL sketch |
| --- | --- |
| No privileged | `object.spec.containers.all(c, c.?securityContext.?privileged.orValue(false) == false)` |
| Drop ALL caps | `object.spec.containers.all(c, c.?securityContext.?capabilities.?drop.orValue([]).exists(x, x == 'ALL'))` |
| RuntimeDefault seccomp | `object.spec.?securityContext.?seccompProfile.?type.orValue('Unconfined') in ['RuntimeDefault', 'Localhost']` |
| No `:latest` | image contains `@sha256:` or has no tag |
| Host namespace | `object.spec.?hostNetwork.orValue(false) == false` |

`matchConstraints` is the scope. If you forget `operations: ["CREATE", "UPDATE"]`, a mutating UPDATE can introduce privileged after a clean CREATE. Include both.

`matchConditions` (CEL on the request) exclude kube-system or a break-glass SA:

```yaml
  matchConditions:
    - name: not-kube-system
      expression: "request.namespace != 'kube-system'"
```

Do not exclude `kube-system` if that is where people hide privileged debug pods. Exclude only Google/Amazon/Azure addon namespaces you do not own, by name, documented.

Bindings attach the policy to namespaces via `ValidatingAdmissionPolicyBinding`:

```yaml
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingAdmissionPolicyBinding
metadata:
  name: deny-latest-prod
spec:
  policyName: deny-latest-tag
  validationActions: ["Deny"]
  matchResources:
    namespaceSelector:
      matchLabels:
        env: prod
```

`validationActions: ["Audit"]` only writes to the audit log. That is PSA-audit theater. Prod bindings use `Deny`. `Warn` is for migration.

CEL cannot call HTTP, cannot query other objects except what the API server puts on the request (and parameters — next section). “Deny if the image is unsigned in Cosign” is **not** a VAP one-liner; signature verification needs a webhook or Binary Authorization. Use VAP for **object shape**. Use a verifier for **registry truth**.

Docs: [ValidatingAdmissionPolicy](https://kubernetes.io/docs/reference/access-authn-authz/validating-admission-policy/).

## vs Gatekeeper/Kyverno

| Need | VAP (CEL) | Kyverno / Gatekeeper |
| --- | --- | --- |
| Deny privileged / hostPath / latest | Yes, in-process | Yes, extra hop |
| Mutate (add RuntimeDefault, drop caps) | **No** (use MutatingAdmissionPolicy in 1.32+ or a webhook) | Yes |
| Generate NetworkPolicy from a label | No | Kyverno generate |
| Query other resources (“does the SA exist?”) | Limited (params, not cluster walk) | Gatekeeper referential |
| Cosign verifyImages | No | Kyverno / custom |
| Policy language your team already writes | CEL | YAML/Rego |
| Availability | API server (always) | Your Deployment |

Keep Gatekeeper/Kyverno when you already have fifty Rego constraints and no budget to rewrite, or when you **mutate**. Do not add a webhook for `privileged == false`. That check belongs in VAP so a webhook outage cannot fail open unless you configured it that way.

MutatingAdmissionPolicy (CEL mutations) is the native follow-on. Until it is everywhere you run, a small Kyverno install for *mutations only* plus VAP for *denies* is a coherent split. One engine that does both is also fine; two engines that both deny the same pod is how you debug for a week.

Latency: webhooks add network RTT on every Pod create. VAP runs in the apiserver process. That is the operational argument, not a religion.

## Parameter resources

`paramKind` lets you pass a config object into CEL so the policy is reusable:

```yaml
# Policy
spec:
  paramKind:
    apiVersion: constraints.example.com/v1
    kind: ImagePrefixParam
  validations:
    - expression: >-
        object.spec.containers.all(c,
          c.image.startsWith(params.allowedPrefix))
      messageExpression: "'image must start with ' + params.allowedPrefix"

---
# CRD instance
apiVersion: constraints.example.com/v1
kind: ImagePrefixParam
metadata:
  name: prod-ghcr
allowedPrefix: "ghcr.io/your-org/"
---
# Binding points at the param
spec:
  policyName: require-prefix
  paramRef:
    name: prod-ghcr
    parameterNotFoundAction: Deny
```

`parameterNotFoundAction: Deny` means a missing ConfigMap/CRD fails closed. `Allow` is fail open. Security policies use Deny.

Params are how you avoid copy-pasting CEL per namespace. They are also an IAM surface: anyone who can edit `ImagePrefixParam` can widen `allowedPrefix` to `""`. RBAC that CRD like it is production policy — because it is. Who may bind cluster-scoped policies is [Kubernetes RBAC](/blog/kubernetes-rbac-security-best-practices/), not “the platform team has cluster-admin anyway.”

Do not stuff a thousand allowed registries into CEL string lists in the Policy object. Use params or a webhook.

## FailurePolicy

`failurePolicy` on the **policy** (and historically on webhooks) is the outage switch:

| Value | CEL compile error / runtime error | Honest use |
| --- | --- | --- |
| `Fail` | Request **denied** | Privileged, hostPath, digest, hostNetwork |
| `Ignore` | Request **admitted** | Experimental CEL you are still syntax-checking |

Webhook equivalent: a down Kyverno with `failurePolicy: Ignore` is how privileged pods ship during an upgrade. VAP with `Fail` does not have a down Deployment — but it **does** have CEL that panics on missing fields if you forgot `.orValue()`. That deny is correct (`Fail`). Fix the expression; do not flip to `Ignore`.

```yaml
# Missing field without orValue → runtime error → Fail denies the pod
# Good:
object.spec.?securityContext.?runAsNonRoot.orValue(false) == true
```

`validationActions: ["Deny"]` plus `failurePolicy: Fail` is the pair. Audit-only plus Ignore is zero controls.

Test in a kind cluster: apply a privileged Pod in a bound namespace, expect 403. Break the CEL on purpose, expect 403 (not a scheduled pod). Then fix CEL.

Order of admission still includes other webhooks. VAP does not replace Pod Security Admission; run both. PSA restricted + VAP digest check is complementary.

## Checklist

- [ ] Cluster is 1.30+ with VAP GA; feature gates not left off by a vendor overlay
- [ ] Security policies: `failurePolicy: Fail` and `validationActions: ["Deny"]`
- [ ] CREATE **and** UPDATE in `resourceRules`
- [ ] `orValue` / optional syntax so missing fields do not surprise you — and Fail still closed
- [ ] Params CRDs are RBAC-locked; `parameterNotFoundAction: Deny`
- [ ] Webhooks retained only for mutation, generation, or Cosign — not for `privileged == false`
- [ ] Break-glass namespaces listed, labeled, and reviewed; not `matchConditions: true` for everyone

CEL in the apiserver is the deny path you can still evaluate when the policy-controller Deployment is unschedulable. Use it for shape. Leave provenance verification and mutation to tools that can actually do those jobs. Application design around admission is [cloud-native application security](/blog/cloud-native-application-security/).
