---
title: "From Compromised Pod to Cloud Admin: The IRSA/WI Path"
description: "Trace the IRSA and Workload Identity path from a compromised pod to cloud admin, then break that path at the annotation before the cloud role."
pubDate: 2026-08-27
updatedDate: 2026-08-27
author: OpenSourceOM Team
tags:
  - IRSA
  - Workload Identity
  - Kubernetes
  - attack path analysis
  - cloud IAM
focusKeyword: pod to cloud admin attack path
faq:
  - question: If the pod SA only has get on configmaps, can it still be cloud admin?
    answer: >-
      Yes. Kubernetes RBAC and cloud IAM are different control planes. A Role that cannot
      get secrets can still have the IRSA annotation
      eks.amazonaws.com/role-arn=arn:aws:iam::...:role/AdministratorAccess. OpenSourceOM
      walks ASSUMES from the pod to that cloud role regardless of RoleBindings. Fixing
      RBAC without reading the annotation does not cut the path.
  - question: Is a projected service-account token safer than the secret-mounted token?
    answer: >-
      For the Kubernetes API, yes: bound tokens expire, are audience-scoped, and are not
      a forever Secret. For IRSA/WI, the projected token is *the* cloud credential mint:
      the pod exchanges it at STS/Entra/STS-equivalent. Short expiry helps theft-from-disk
      windows; it does not shrink the cloud role. A 10-minute token that can iam:CreateUser
      is still cloud admin for ten minutes, renewably.
  - question: Where should I break the path if the app legitimately needs S3?
    answer: >-
      Keep the annotation; change the role. payments-task gets s3:GetObject on
      arn:aws:s3:::prod-pii/app/* only, no iam:*, no sts:AssumeRole on other roles. Do
      not point the annotation at a shared cluster-wide role. Do not fall back to the
      node instance profile by deleting the annotation with no replacement.
  - question: Does this replace Kubernetes RBAC hardening?
    answer: >-
      No. RBAC stops get/list on Secrets and cluster-admin on deploy SAs. This page is
      the second control plane: pod SA → cloud role. Do both. The RBAC post is the API
      server; the cloud-native application security post is the rest of the app patterns.
---

The **pod-to-cloud-admin path** is a two-control-plane walk: compromise a container, mint **cloud** credentials, then use `CAN_ACCESS` as if you had stolen an instance profile. On EKS that mint is **IRSA**. On GKE it is **Workload Identity**. On AKS it is **Entra Workload ID** (federated credentials on a managed identity). Kubernetes RBAC does not see those hops. OpenSourceOM must. In-cluster Roles and automount are [Kubernetes RBAC security](/blog/kubernetes-rbac-security-best-practices/). App-layer patterns around the same pod are [cloud-native application security](/blog/cloud-native-application-security/). This page is **the annotation and the cloud role**.

```
attacker in pod
  → projected SA token  (TokenRequest, audience = sts.amazonaws.com / STS / Entra)
      → STS / metadata / Entra token exchange
          → cloud role / MI   ← often AdministratorAccess / Owner / roles/editor
              → iam:* / roleAssignments/write / iam.serviceAccountTokenCreator
```

If that last node is admin-equivalent, the CVE in the image is an **account** incident. [Blast radius](/blog/blast-radius-analysis-cloud-iam/) measures the role; here you find **how the pod got it**.

## Token on disk vs projected token

Old shape: a Secret of type `kubernetes.io/service-account-token` mounted at `/var/run/secrets/kubernetes.io/serviceaccount/token`. No expiry. Steal the file, keep the Kubernetes API forever (and, on some clusters, nothing to do with cloud IAM).

New shape (default on current EKS/GKE/AKS): **projected bound tokens**. The kubelet requests a token with `audience` and `expirationSeconds`. IRSA uses that audience so **AWS STS** will exchange it for the annotated role. GKE WI uses the GKE metadata server / token source. AKS WI uses the federated credential on the MI.

```
# What is actually in the pod?
kubectl exec -n payments deploy/api -- \
  cat /var/run/secrets/kubernetes.io/serviceaccount/token | cut -c1-20
# Bound tokens are JWTs; look at aud and exp
kubectl exec -n payments deploy/api -- cat /var/run/secrets/kubernetes.io/serviceaccount/token \
  | awk -F. '{print $2}' | base64 -d 2>/dev/null | head
```

Theft of a bound token is still enough **until `exp`**, and the process can refresh. Disk theft is a smaller window than 2019; **SSRF to the metadata/WI endpoint** or a process dump is the usual mint. IMDSv1-style “hit 169.254.169.254 from the app” is the cousin on EC2; in GKE, the metadata server plus Workload Identity is the cousin.

Failure mode: setting `automountServiceAccountToken: false` on a pod that uses IRSA. You broke AWS auth and the app may fall back to the **node role** if the chart still has an instance profile. Automount false is correct for pods that do not talk to Kubernetes **or** cloud STS; IRSA pods need a token, just not `cluster-admin`.

OpenSourceOM nodes: `Workload` (pod/controller), `Identity` (K8s SA), `Identity` (cloud role), edges `ASSUMES` (annotation / WI binding) then `CAN_ACCESS`. The token-on-disk vs projected distinction is a **property** on the SA edge (`bound_token: true`), not a reason to skip the walk.

## IRSA trust vs GKE WI vs AKS WI

**EKS IRSA.** The pod SA annotation `eks.amazonaws.com/role-arn` plus a trust policy on the IAM role that names the OIDC issuer and `sub` = `system:serviceaccount:NAMESPACE:SA`.

```
kubectl get sa payments-api -n payments -o yaml
# look for eks.amazonaws.com/role-arn

aws iam get-role --role-name payments-task --query 'Role.AssumeRolePolicyDocument'
# Federated principal should be the cluster OIDC, sub pinned to one SA
```

Trust that uses `"StringLike": { "oidc.eks....:sub": "system:serviceaccount:*:*" }` is cluster-wide `CAN_ASSUME`. Any SA, including `default` in a forgotten namespace, can mint `payments-task`.

**GKE Workload Identity.** The K8s SA is annotated `iam.gke.io/gcp-service-account=...` and the GCP SA has `roles/iam.workloadIdentityUser` bound to `principal://.../subject/ns/NAMESPACE/sa/SA`. The **node** GCE SA is a second path if WI is not used or if the pod can still reach metadata as the node.

```
kubectl get sa payments-api -n payments -o yaml
gcloud iam service-accounts get-iam-policy payments-task@PROJECT.iam.gserviceaccount.com
```

If the GCE default SA is still `Editor` on the project ([GCP IAM hardening](/blog/gcp-iam-security-hardening/)), a pod that *fails* WI and falls back to the node is **worse** than a scoped WI SA.

**AKS Workload Identity.** Federated credential on the MI: issuer = cluster OIDC, subject = `system:serviceaccount:ns:sa`. Azure RBAC on the MI is the blast radius.

```
az identity federated-credential list --identity-name mi-payments --resource-group rg-payments
az role assignment list --assignee "$MI_PRINCIPAL"
```

A federated credential with subject `system:serviceaccount:payments:*` is every SA in the namespace.

OpenSourceOM normalizer: one `ASSUMES` verb for all three, properties `federation: irsa|gke-wi|aks-wi`, `sub_pin: exact|namespace|cluster`. Path queries should not require the engineer to know the annotation key.

Failure mode: pinning RBAC in-cluster and leaving `StringLike sub *:*` on the IAM trust. The graph will still show pod default → cloud admin.

## Over-scoped cloud roles

The annotation is a pointer. The **role** is the blast radius.

| Pointer | Role | Result |
| --- | --- | --- |
| Exact SA sub | `s3:GetObject` on one prefix | Intended |
| Exact SA sub | `AdministratorAccess` / `Owner` / `roles/editor` | Pod is cloud admin |
| `*:*` sub | Any role | Every pod is that role |
| No annotation | Node instance profile / default GCE SA | Often **broader** than the app role |

Shared “cluster-app” roles (one IRSA role for all charts) are how a debug sidecar in `kube-system` or a compromised preview namespace becomes prod S3. Split roles per controller. CI deploy roles (Terraform, Helm) must not be the runtime SA.

```
# EKS: what can this role do that a stolen pod token would do?
aws iam simulate-principal-policy \
  --policy-source-arn arn:aws:iam::111111111111:role/payments-task \
  --action-names iam:CreateUser iam:PassRole s3:GetObject \
  --resource-arns '*'
```

If `iam:CreateUser` or `PassRole` to a privileged role is allowed, stop calling this an “app role.” [CIEM](/blog/ciem-explained-for-cloud-teams/) is the program; this simulate is the IR ticket.

Failure mode: “least privilege” implemented as `AmazonS3FullAccess` plus `AmazonRDSFullAccess` because the app “might need it.” FullAccess on two families is not least privilege; it is two datastores in the walk.

## Breaking the path at the annotation

Cheapest durable cuts, in order:

1. **Pin `sub` (or Azure subject) to one `namespace:sa`.** Cluster-wide StringLike is the first delete. This is a trust-policy / federated-credential edit, not a rolling restart of every pod—but restart anyway so old tokens die.
2. **Point the annotation at a new scoped role**, then detach `AdministratorAccess` from the old one. Do not delete the annotation first (node-role fallback).
3. **Remove the annotation** only for pods that must not call cloud APIs. Set automount false if they also must not call the Kubernetes API.
4. **Admission (optional):** deny SAs that annotate `role-arn` unless the role ARN is on an allowlist. That is not a Gatekeeper tutorial; it is a guardrail so the edge cannot be redrawn. Kyverno/Gatekeeper YAML lives with platform charts, not here.

```
# After pin: this must fail from a different SA
kubectl run steal --image=amazon/aws-cli -n default --restart=Never -- \
  aws sts get-caller-identity
# Should be node role or denied — not payments-task
```

Prove in OpenSourceOM: `MATCH (p:Workload {ns:'payments', sa:'payments-api'})-[:ASSUMES]->(r:Identity) RETURN r.arn, r.admin_equivalent` shows the scoped role, and the same MATCH for `ns:default` does not return `payments-task`. Collectors must see the cluster **and** the cloud account ([the graph](/docs/the-graph/)).

Do not “break” the path by deleting NetworkPolicy while leaving IRSA admin. NetworkPolicy is packets; STS is HTTPS to a public AWS endpoint from the node. [How to break a cloud attack path](/blog/how-to-break-cloud-attack-paths/) still applies: identity cut, not a CVE-only cut.

Failure mode: rotating the cluster OIDC issuer (cluster recreate) and copying the old trust `sub *:*` onto the new issuer “to make charts work.” You rebuilt the path.

## Checklist

- [ ] Every cloud-calling SA has an exact `sub` / federated subject pin (namespace + name)
- [ ] No IRSA/WI role is `AdministratorAccess`, subscription `Owner`, or `roles/editor`
- [ ] `simulate-principal-policy` / Azure role list on the runtime role has no mint-admin actions
- [ ] Annotation changes land **before** detaching the old role; no silent fallback to node/GCE default SA
- [ ] Pods that do not need cloud or K8s API: no annotation, automount false
- [ ] OpenSourceOM walk pod → cloud role exists for EKS, GKE, and AKS clusters you ingest
- [ ] In-cluster RBAC still locked (RBAC post); this checklist does not replace it

---
**Related:** [Kubernetes RBAC security](/blog/kubernetes-rbac-security-best-practices/) · [Cloud-native application security](/blog/cloud-native-application-security/) · [GCP IAM hardening](/blog/gcp-iam-security-hardening/)
