---
title: "Kubernetes Ephemeral Containers and kubectl debug"
description: "kubectl debug patches pods/ephemeralcontainers, which many Pod CREATE policies never see. RBAC, node debug pods, and the shared process namespace."
pubDate: 2026-09-25
updatedDate: 2026-09-25
author: OpenSourceOM Team
tags:
  - Kubernetes
  - ephemeral containers
  - RBAC
  - kubectl debug
focusKeyword: Kubernetes ephemeral containers
faq:
  - question: Which RBAC verb adds an ephemeral container?
    answer: >-
      patch on pods/ephemeralcontainers. It is not create on pods, and it
      is not pods/exec. A Role that cannot exec can still debug if it can
      patch that subresource. Grant it the way you grant exec: named
      namespaces, not cluster-admin by habit.
  - question: Does Pod Security or a CREATE-only policy see the debug container?
    answer: >-
      Pod Security Admission evaluates ephemeral containers. A
      ValidatingAdmissionPolicy or webhook that only matches pod CREATE
      does not. The debug container arrives as a patch on
      pods/ephemeralcontainers. If the policy does not list that
      subresource, it will admit a privileged debug image into a
      restricted namespace.
  - question: How is kubectl debug node different?
    answer: >-
      debug node creates a new pod on the node, typically with host
      namespaces, rather than patching your application pod. The
      permission is create on pods (often in kube-system or a debug
      namespace), not pods/ephemeralcontainers. Blocking ephemeral
      containers does not block node debug. They are two admin paths.
---

```bash
kubectl auth can-i patch pods/ephemeralcontainers -n payments
kubectl debug -it payments-api-0 --image=busybox --target=app --profile=restricted
```

The first command is the permission that matters. **Kubernetes ephemeral containers** are added by patching a running pod. They are not in the Deployment template, so a GitOps review of the manifest never saw them. The behavior is documented in [ephemeral containers](https://kubernetes.io/docs/concepts/workloads/pods/ephemeral-containers/).

`pods/exec` is the sibling control, covered as part of [Kubernetes RBAC](/blog/kubernetes-rbac-security-best-practices/). This page is the subresource exec policies forget.

## RBAC

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: debug-pods
  namespace: payments
rules:
  - apiGroups: [""]
    resources: ["pods/ephemeralcontainers"]
    verbs: ["patch"]
```

Do not add `pods/exec`, `pods/portforward`, and `nodes/proxy` to the same binding because the chart said “debug.” Namespace developers get this Role in non-prod. Production gets a break-glass group whose binding you can delete without editing the chart.

Cluster-admin includes the verb. So does any ClusterRole copied from `edit` and then widened “so oncall can debug.” Search for it:

```bash
kubectl get clusterrole -o json | jq -r '
  .items[]
  | select(.rules[]? | .resources[]? == "pods/ephemeralcontainers")
  | .metadata.name'
```

A hit on a Role bound to a CI service account is a pipeline that can attach a container to prod. That is not a linter finding. It is a shell.

## Admission that only watches CREATE

This policy does nothing for `kubectl debug`:

```yaml
matchConstraints:
  resourceRules:
    - apiGroups: [""]
      apiVersions: ["v1"]
      operations: ["CREATE"]
      resources: ["pods"]
```

The API call is a patch of `pods/ephemeralcontainers`. Add that resource and `UPDATE`/`PATCH` (the verb you match in the policy must be the one the API uses; include the ephemeralcontainers resource explicitly) to the [ValidatingAdmissionPolicy](/blog/kubernetes-validating-admission-policy/) that already forbids privileged pods. Require the ephemeral container’s `securityContext` to drop capabilities and deny `privileged: true`.

Pod Security Admission does evaluate the ephemeral container against the namespace’s enforce profile. Restricted namespaces block a privileged debug container *if* PSA is enforcing. A namespace at `enforce=baseline` or `warn` will not. Do not cite PSA as the control in namespaces where enforce is off.

Kyverno and Gatekeeper policies generated only for `Pod` CREATE have the same hole. If the policy engine cannot see the subresource, it is not a control on debug, regardless of how many privileged-pod rules you own.

## Shared process namespace

`kubectl debug --target` and profiles that share the process namespace let the new container see the target’s processes. Through `/proc/<pid>/root` that includes the target’s filesystem: config files, and the [projected service account token](/blog/kubernetes-projected-service-account-tokens/) mounted on the app container.

A “read-only debug image” with a shared process namespace is a token exfil path. Prefer a profile that does not share the process namespace when the question is networking or a local file you already mounted. Treat a shared namespace like exec as the app’s user.

The debug container does not automatically receive the app’s token in its own mount namespace. It receives whatever you image-pull, plus what the shared process namespace lets it open. Image pull policy and the registry matter: `busybox:latest` from a public registry is a supply-chain dependency introduced at incident time. Pin a debug image in your registry.

## Node debug is a different pod

```bash
kubectl debug node/ip-10-0-1-20 -it --image=ubuntu
```

This creates a pod that mounts the host. It is not an ephemeral container on `payments-api`. RBAC is the ability to create that pod, usually with a privileged profile the node debugger requests. Denying `pods/ephemeralcontainers` and leaving `create` on privileged pods in `kube-system` does not close node access.

Oncall rarely needs node debug. Cluster operators do, from a break-glass identity, with the pod audited. Log it:

```yaml
- level: RequestResponse
  verbs: ["patch", "create"]
  resources:
    - group: ""
      resources: ["pods/ephemeralcontainers", "pods"]
```

RequestResponse on every pod create is noisy. At least RequestResponse on `pods/ephemeralcontainers` is not. Alert on that subresource in production namespaces outside the break-glass group.

## Checklist

- [ ] `patch` on `pods/ephemeralcontainers` is not on CI roles or the default developer ClusterRole
- [ ] Production binding is break-glass and removable
- [ ] Admission policies match the `pods/ephemeralcontainers` resource, not only pod CREATE
- [ ] PSA `enforce=restricted` on namespaces where debug must stay unprivileged
- [ ] Debug image is pinned in your registry; shared process namespace is rare and reviewed
- [ ] `kubectl debug node` is treated as a host shell, with separate RBAC
- [ ] Audit policy records ephemeralcontainers patches in prod

The container is gone when the pod restarts. The token copy is not.
