---
title: "Seccomp and AppArmor for Kubernetes Workloads"
description: "RuntimeDefault seccomp and AppArmor annotations for Kubernetes: what syscalls they block, why they do not stop API abuse, and when audit mode is lying to you."
pubDate: 2026-08-27
updatedDate: 2026-08-27
author: OpenSourceOM Team
tags:
  - Kubernetes
  - seccomp
  - AppArmor
  - container security
  - Pod Security
focusKeyword: Kubernetes seccomp AppArmor
faq:
  - question: Is RuntimeDefault seccomp enough for production pods?
    answer: >-
      It is the minimum. RuntimeDefault blocks a small set of known-dangerous syscalls
      (unshare, mount, some bpf) with a profile the CRI runtime ships. It is not a
      workload-specific allowlist. Add a localhost profile when the binary’s syscall
      set is stable; do not skip RuntimeDefault while you wait for that profile.
  - question: Does AppArmor work on every Kubernetes node?
    answer: >-
      AppArmor is Linux LSM and distro-specific. GKE COS and Ubuntu nodes typically
      have it; Bottlerocket and some Flatcar/EKS AMIs do not. If the node has no
      AppArmor, the annotation is ignored or the pod fails depending on the runtime.
      Probe nodes before you make the annotation required.
  - question: Can seccomp stop an attacker who has the pod’s service account token?
    answer: >-
      No. Talking to the Kubernetes API or to AWS STS is HTTPS, not a banned syscall.
      Seccomp and AppArmor constrain the process’s kernel interface. RBAC, projected
      tokens, and cloud IAM constrain the identity. You need both layers.
---

A reverse shell that calls `mount` or `unshare` is a seccomp problem. A reverse shell that `curl`s the API server with the projected token is not. **Kubernetes seccomp AppArmor** sit on the kernel side of that split.

This is not a substitute for signed images, NetworkPolicy, or admission. Those patterns are in [cloud-native application security](/blog/cloud-native-application-security/). This page is the two LSMs you actually put on the Pod spec, and the attacks they will not notice.

```
Userspace process
    │  allowed syscalls only
    ▼
seccomp filter  →  AppArmor profile  →  kernel
    │
    └── HTTPS to kube-apiserver / STS  (seccomp does not care)
```

## Seccomp profiles RuntimeDefault

Pod Security Admission `restricted` already wants `seccompProfile.type: RuntimeDefault` (or a localhost profile). Unconfined is the finding.

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: payments-api
  namespace: payments
spec:
  securityContext:
    seccompProfile:
      type: RuntimeDefault
  containers:
    - name: app
      image: ghcr.io/example/payments@sha256:…
      securityContext:
        allowPrivilegeEscalation: false
        capabilities:
          drop: ["ALL"]
```

`RuntimeDefault` is containerd/CRI-O’s stock profile: deny `unshare`, `mount`, `reboot`, a chunk of `bpf`, `kexec_load`, and other “I am becoming the node” calls. It still allows `execve`, `connect`, `open`, `read`, `write`. That is enough for a web app and enough for a worm that talks HTTP.

`Localhost` plus `localhostProfile: profiles/payments.json` is the next step when you have a recorded syscall set (crictl / `seccomp-operator` / a gVisor-style list). Do not copy a profile from a blog that blocks `clone` and then wonder why Go’s runtime dies.

```yaml
seccompProfile:
  type: Localhost
  localhostProfile: operator/default/payments-api.json
```

The profile file must exist on the **node**. Autopilot and managed node images will not include your custom JSON unless you use a mechanism the provider supports (often: you don’t, so stay on RuntimeDefault).

`Unconfined` on a single sidecar undoes the Pod-level profile for that container. Istio/Linkerd old templates did this. Pin a mesh version that runs under RuntimeDefault, or accept that the sidecar is your weakest container.

```bash
# Catch Unconfined in rendered manifests
yq -e '
  .. | select(has("seccompProfile")) | .seccompProfile
  | select(.type == "Unconfined")
' rendered.yaml && exit 1
```

SELinux is a third LSM (OpenShift, some RHEL nodes). Do not mix “we set RuntimeDefault” with “we thought that was SELinux.” Check `sestatus` / node OS.

## AppArmor annotations

AppArmor is not a `securityContext` field in stable Kubernetes. It is still an annotation on the Pod:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: payments-api
  namespace: payments
  annotations:
    container.apparmor.security.beta.kubernetes.io/app: runtime/default
spec:
  containers:
    - name: app
      image: ghcr.io/example/payments@sha256:…
```

`runtime/default` is the runtime’s stock profile (similar idea to seccomp RuntimeDefault). A custom profile is a name you loaded on the node (`apparmor_parser`). Same node-file problem as localhost seccomp.

What AppArmor adds over seccomp: **path and socket rules** — “this process may not write `/etc`,” “may not use raw sockets.” Seccomp is syscall number. AppArmor is LSM labels on files. A Python interpreter that should only read `/app` can be told so; seccomp cannot express that.

GKE: COS supports AppArmor. EKS: Amazon Linux 2023 / Bottlerocket often **do not** load AppArmor. AKS: Ubuntu nodes do. If you enforce the annotation cluster-wide, Bottlerocket node groups will fail scheduling or ignore the profile. Split policy by node OS, or only require AppArmor where `cat /sys/module/apparmor/parameters/enabled` is `Y`.

```bash
# Node check (DaemonSet or SSH on Standard)
cat /sys/module/apparmor/parameters/enabled
sudo aa-status | head
```

A custom profile that `deny /proc/1/**` sounds clever until the liveness probe’s `exec` needs `/proc`. Test in a namespace with `enforce` only after `complain` is quiet.

## What they do not stop (API abuse)

Compromise model: attacker gets RCE in `payments-api` as UID 65532, RuntimeDefault + AppArmor `runtime/default`, no extra caps.

Still available:

| Action | Blocked by seccomp/AppArmor? | Actually blocked by |
| --- | --- | --- |
| Read `/var/run/secrets/.../token` and call kube-apiserver | No | `automountServiceAccountToken: false`, tight Role |
| HTTPS to `sts.amazonaws.com` with IRSA token | No | IAM role scope |
| Exfiltrate via the app’s own outbound 443 | No | NetworkPolicy / egress proxy |
| `kubectl exec` *into* this pod from a stolen human kubeconfig | N/A (not this process) | RBAC on `pods/exec` |
| Exploit a kernel 0-day via an *allowed* syscall (`read` on a buggy driver) | Maybe not | Node patching, gVisor/Kata |

Seccomp will stop a noisy container-escape *script* that tries `mount -t overlay` or `unshare -U`. It will not stop “I am the app, I already have the cloud role.” If the security review stops at RuntimeDefault, you hardened the syscall table and left the identity plane open. Bound tokens and Role scope are the [RBAC production checklist](/blog/kubernetes-rbac-security-best-practices/).

Do not file “enable seccomp” as the fix for a public Service with `cluster-admin` on the SA. That is category error.

## Enforcement vs audit

PSA `audit` / `warn` on seccomp does not load a filter. It only annotates events when a pod would have failed `restricted`. The process is still Unconfined.

AppArmor `complain` (profile in complain mode, or a policy tool that only logs) writes to audit logs and **allows** the access. Teams leave complain on for a year because “the profiler isn’t done.” That is Unconfined with extra syslog.

| Mode | What the kernel does | Honest use |
| --- | --- | --- |
| seccomp RuntimeDefault / localhost | SIGSYS or EPERM on deny | Production |
| seccomp Unconfined + PSA audit | Nothing | Migration telemetry only |
| AppArmor enforce | Deny + audit | Production on AppArmor nodes |
| AppArmor complain | Allow + audit | Time-boxed profile build, expiry date on the ticket |

Admission should fail Unconfined on app namespaces. ValidatingAdmissionPolicy or your policy engine: `seccompProfile.type != Unconfined`. Audit-only PSA is a dashboard, not a control.

RuntimeDefault will break a surprise `mknod` or nested container builder. That is the point. Run those jobs in a dedicated namespace with a documented localhost profile, not by flipping the whole cluster to Unconfined.

## Checklist

- [ ] App namespaces: Pod `securityContext.seccompProfile.type` is `RuntimeDefault` or `Localhost`, never `Unconfined`
- [ ] Sidecars inherit the same rule; mesh version confirmed under RuntimeDefault
- [ ] Custom localhost profiles live on the node image you actually run (or you stay on RuntimeDefault)
- [ ] AppArmor annotation required only on node pools where AppArmor is loaded
- [ ] Complaining/audit modes have an expiry; production is enforce
- [ ] SA tokens and IAM roles reviewed — LSM is not the control for API/STS
- [ ] CI greps rendered YAML for `type: Unconfined` and extra capabilities

RuntimeDefault is cheap. Identity and network are the rest of [cloud-native application security](/blog/cloud-native-application-security/). Do not let a green CIS “seccomp” row close a finding that was always on the API.
