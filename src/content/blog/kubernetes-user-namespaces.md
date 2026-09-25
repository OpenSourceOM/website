---
title: "Kubernetes User Namespaces (hostUsers: false)"
description: "Kubernetes user namespaces set hostUsers false so container root is not host root. On by default since 1.33, and why hostPath and seccomp still matter."
pubDate: 2026-09-25
updatedDate: 2026-09-25
author: OpenSourceOM Team
tags:
  - Kubernetes
  - user namespaces
  - pod security
  - container escape
focusKeyword: Kubernetes user namespaces
faq:
  - question: Does runAsNonRoot turn on a user namespace?
    answer: >-
      No. runAsUser and runAsNonRoot pick the uid inside the container.
      Without hostUsers false, that uid is the same number on the host.
      uid 0 in the container is host uid 0, minus capabilities and seccomp.
      hostUsers false is the switch that maps container uids onto an
      unprivileged range on the host.
  - question: Which clusters can require hostUsers false?
    answer: >-
      The feature is on by default in Kubernetes 1.33 and stable since
      1.36, on Linux nodes with cgroup v2 and a runtime that supports
      idmapped mounts. Before 1.33 it was still gated. A policy that
      denies hostUsers true on a node pool whose runtime cannot idmap
      mounts is an outage, not a control.
  - question: Can I keep a hostPath volume?
    answer: >-
      Often no. hostPath and several other volume types are not idmapped,
      and the pod fails at kubelet rather than silently running as host
      root. That failure is the point. A workload that must mount the host
      filesystem is the workload you should not put in a user namespace
      and should not describe as isolated.
---

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: payments-api
spec:
  hostUsers: false
  containers:
    - name: app
      image: example.com/payments:1.4.2
      securityContext:
        runAsNonRoot: true
        allowPrivilegeEscalation: false
        capabilities:
          drop: ["ALL"]
        seccompProfile:
          type: RuntimeDefault
```

`hostUsers: false` is the **Kubernetes user namespaces** switch. Container uid 0 is no longer host uid 0. A process that breaks out of the container runtime still lands in the mapped range, not as host root. The stable behavior is documented in [user namespaces](https://kubernetes.io/docs/concepts/workloads/pods/user-namespaces/).

`runAsNonRoot: true` stays. It answers a different question (which uid the process starts as). [Seccomp and AppArmor](/blog/kubernetes-seccomp-and-apparmor/) stay. A user namespace does not filter syscalls.

## What the cluster has to be

On by default in Kubernetes 1.33, stable since 1.36. Before 1.33 it was beta and often off, including on managed clusters that had not caught up. Read the node runtime, not only the control-plane version, before you ship a ValidatingAdmissionPolicy that requires `hostUsers: false`.

Nodes need:

- Linux and cgroup v2
- A runtime that can idmap mounts (current containerd 2.x; containerd 1.6-era nodes will reject the pod)
- Kernel support for idmapped mounts

`hostUsers: false` cannot be combined with `hostNetwork`, `hostPID`, or `hostIPC`. Those fields exist to share the host’s namespaces. The API rejects the combination. A privileged container is a separate problem: user namespaces are not a reason to set `privileged: true`, and several privileged features are simply incompatible with the mapping. If the chart needs the host network, it does not get this control. Say so in the exception, and do not flip `hostUsers` back to true on the whole namespace to unblock one DaemonSet.

## hostPath and volume ownership

The practical outage is volumes. Files on a volume have to be readable under the mapped ids. Idmapped mounts do that for volume types the runtime supports. `hostPath` usually is not one of them. The pod stays Pending or fails at start with a mount error. The tempting fix is `hostUsers: true`. That fix deletes the control.

Use a PVC or an emptyDir for the app, and keep hostPath on the DaemonSet that is explicitly a host agent. Do not “just for logs” mount `/var/log` into an app pod you claimed was namespaced.

Image `USER 0` still works inside the pod. Package managers that refuse to run as non-root are not a reason to drop `hostUsers: false`. They are a reason to fix the image. The mapping means that in-pod root is not host root; it does not mean you should leave the process as root if `runAsNonRoot` is available.

## Enforcing it

The restricted Pod Security profile does not require `hostUsers: false`. A namespace labeled `pod-security.kubernetes.io/enforce=restricted` can still run pods as host users. Add a [ValidatingAdmissionPolicy](/blog/kubernetes-validating-admission-policy/) if this is a control you mean to have:

```yaml
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingAdmissionPolicy
metadata:
  name: require-user-namespace
spec:
  failurePolicy: Fail
  matchConstraints:
    resourceRules:
      - apiGroups: [""]
        apiVersions: ["v1"]
        operations: ["CREATE", "UPDATE"]
        resources: ["pods"]
  validations:
    - expression: "has(object.spec.hostUsers) && object.spec.hostUsers == false"
      message: "pods must set hostUsers: false"
```

Exempt the DaemonSet namespace in a binding, not by setting `failurePolicy: Ignore`. Ignore turns a broken CEL expression into an allow. Bind it to application namespaces after one of them runs a real pod with `hostUsers: false` on the node pool you actually use. A policy that only ever ran in CI kind is how you learn the runtime is too old on a Friday.

## What this does not stop

- Stolen service-account tokens. The token is not a uid problem. [Projected tokens](/blog/kubernetes-projected-service-account-tokens/) limit the window; they do not remove the API call.
- The cloud role on that service account. User namespaces do not touch IRSA or Pod Identity. The [pod-to-cloud-admin path](/blog/kubernetes-pod-to-cloud-admin-path/) still starts at the annotation or the association.
- A syscall the runtime default seccomp profile allows, if the kernel bug is in that syscall. Keep the seccomp profile.
- `kubectl debug` on the node, which is a privileged host pod scheduled beside this one. User namespaces on the app do not constrain the debug pod.

## Checklist

- [ ] Control plane is 1.33+ (stable since 1.36) and nodes are cgroup v2 with a runtime that idmaps
- [ ] App pods set `hostUsers: false` and still set `runAsNonRoot`, drop all capabilities, and `RuntimeDefault` seccomp
- [ ] No `hostNetwork` / `hostPID` / `hostIPC` on those pods
- [ ] hostPath is not required; a failed mount was not “fixed” by setting `hostUsers: true`
- [ ] Admission requires `hostUsers: false` on app namespaces, with DaemonSets exempted in the binding
- [ ] Cloud role and service-account token reviewed separately

`hostUsers: false` removes host root as the default prize for a container breakout. It does not make the pod a sandbox, and it will refuse workloads that were quietly mounting the host.
