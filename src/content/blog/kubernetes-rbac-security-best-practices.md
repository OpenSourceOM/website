---
title: "Kubernetes RBAC Security Best Practices for Production Clusters"
description: "Production Kubernetes RBAC: namespace Roles not cluster-admin, automount off, bound tokens, aws-auth vs access entries, and kubectl-who-can in CI."
pubDate: 2026-08-27
updatedDate: 2026-08-27
author: OpenSourceOM Team
tags:
  - Kubernetes
  - RBAC
  - cloud security
  - CNAPP
  - container security
focusKeyword: Kubernetes RBAC security
faq:
  - question: Why is cluster-admin on a deploy SA so common?
    answer: >-
      Helm charts and "just to get CI working" ClusterRoleBindings. The SA token in the
      pod is then a full API credential. Use a namespace Role with get/list/watch on the
      objects the controller actually needs. Platform add-ons that truly need cluster
      scope get a dedicated ClusterRole with verbs listed, not star.
  - question: Should pods use the default service account?
    answer: >-
      No. Set automountServiceAccountToken to false on the default SA in every namespace,
      create a dedicated SA per workload, and mount a token only if the process calls the
      Kubernetes API. Bound service account tokens (TokenRequest) with audience and short
      expiry replace the old never-expiring secret token.
  - question: How do I see who can read secrets cluster-wide?
    answer: >-
      kubectl-who-can or rakkess against a staging API, for example who-can get secrets
      --all-namespaces. Also grep ClusterRoleBindings for cluster-admin and for
      aggregate-to-admin labels. Do this in CI against rendered manifests, not only in a
      live cluster after merge.
  - question: What is different on EKS vs GKE vs AKS?
    answer: >-
      Cloud IAM sits under Kubernetes RBAC. EKS aws-auth ConfigMap and Access Entries can
      grant system:masters. GKE has the default Compute SA and Workload Identity. AKS has
      Entra groups bound to cluster-admin. A clean Role in-cluster does not help if the
      cloud mapping still grants system:masters to a wide IAM role.
---

This is **Kubernetes API authorization**: Roles, RoleBindings, service account tokens, and the cloud IAM mapping that can bypass all of that. It is not NetworkPolicy, not Pod Security, and not a CNAPP overview. Those belong in [cloud-native application security](/blog/cloud-native-application-security/). API behavior: [Using RBAC](https://kubernetes.io/docs/reference/access-authn-authz/rbac/).

```
kubectl / CI
    → API server  (RBAC on this request)
         → pod SA token (if automounted)
              → cloud IAM via IRSA / Workload Identity / Entra  (second control plane)
```

A tight Role is worthless if the same human is `system:masters` through `aws-auth`.

## 1. No ClusterRoleBinding for application service accounts

```yaml
# Wrong: deploy SA is cluster-admin
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: payments-deploy
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: cluster-admin
subjects:
  - kind: ServiceAccount
    name: deploy
    namespace: payments
```

Replace with a **Role** in `payments`:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: payments-app
  namespace: payments
rules:
  - apiGroups: [""]
    resources: ["configmaps"]
    verbs: ["get", "list"]
  - apiGroups: [""]
    resources: ["secrets"]
    verbs: ["get"]
    resourceNames: ["payments-api"]
```

`get` on a named Secret is not `list` on `secrets` in the namespace. `list` dumps every secret to anyone who can compromise the SA.

Aggregated ClusterRoles (`rbac.authorization.k8s.io/aggregate-to-admin: "true"`) hide verbs. Read the aggregated rules, not the ClusterRole name.

## 2. Default SA: automount off

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: default
  namespace: payments
automountServiceAccountToken: false
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: payments-api
  namespace: payments
# automount only if this process talks to the API
```

On the Pod spec, `automountServiceAccountToken: false` unless you need it. Bound tokens (`TokenRequest`) with `expirationSeconds` and `audiences` replace the long-lived Secret-based token.

Failure mode: Istio/Linkerd sidecars and operators *do* need a token. That is a dedicated SA, not “turn automount back on for default.”

## 3. Prove it with who-can, in CI

```bash
kubectl-who-can get secrets -n payments
kubectl-who-can get secrets --all-namespaces
kubectl auth can-i --list --as=system:serviceaccount:payments:payments-api -n payments
```

Pipeline on rendered Helm:

1. Fail if an application chart contains `kind: ClusterRoleBinding` to `cluster-admin`.
2. Fail if `resources: ["secrets"]` with `verbs` containing `list` or `*` at cluster scope.
3. Optional: apply to an ephemeral kind/k3d cluster and run who-can.

Emergency Roles added at 2 a.m. never expire. Diff `ClusterRoleBinding` objects weekly against git.

## 4. Cloud mappings that skip Kubernetes RBAC

| Cluster | Mapping | Footgun |
| --- | --- | --- |
| EKS | Access Entries (preferred) or `aws-auth` ConfigMap | `system:masters` for an IAM role used by CI |
| GKE | Google Groups + GKE RBAC, Workload Identity | Default Compute SA still Editor on GCP |
| AKS | Entra ID / AKS-managed Entra | Entire `AAD-Cluster-Admins` group → cluster-admin |

EKS Access Entries:

```bash
aws eks list-access-entries --cluster-name prod
aws eks describe-access-entry --cluster-name prod --principal-arn "$ARN"
```

If you still use `aws-auth`, a merge conflict during an add-on upgrade can re-add `mapRoles` to `system:masters`. Treat that ConfigMap as production IAM.

Workload identity (IRSA / GKE WI / AKS workload identity) is a **second** RBAC system: the pod SA may be namespace-scoped in Kubernetes and `s3:*` in AWS. Restrict both. Graph correlation of pod SA → cloud role is [attack path analysis](/blog/attack-path-analysis-cloud-security/), after these bindings are not `*`.

## 5. RBAC is not PSS and not NetworkPolicy

| Layer | Stops |
| --- | --- |
| RBAC | API verbs (get secret, create pod) |
| Pod Security Admission | Privileged, hostNetwork, hostPath |
| Admission (Kyverno/Gatekeeper) | Unsigned images, missing labels |
| NetworkPolicy | Pod IP traffic |

RBAC will not stop a privileged pod if the deployer already had `create pods`. Layer them; do not write a “Kubernetes security” mega-post here.

## Checklist

- [ ] Default SA: `automountServiceAccountToken: false` in every namespace
- [ ] App SAs: namespace Role, named Secret `get`, no cluster-admin
- [ ] CI: fail ClusterRoleBinding to cluster-admin in app charts
- [ ] who-can on `secrets` cluster-wide is only platform SAs
- [ ] EKS Access Entries / aws-auth / Entra groups reviewed after every cluster bump
- [ ] IRSA/WI roles are not `AdministratorAccess`

## Key takeaways

- **cluster-admin on a deploy SA** is a cluster credential in every pod that mounts it.
- **automount false on default** is the smallest high-leverage change.
- **who-can in CI** catches chart drift; live clusters drift after hotfixes.
- **Cloud IAM mappings** can grant `system:masters` without a single RoleBinding.

---
**Related:** [Cloud-native application security](/blog/cloud-native-application-security/) · [GCP IAM hardening](/blog/gcp-iam-security-hardening/)
