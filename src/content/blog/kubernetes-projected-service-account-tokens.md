---
title: "Projected Service Account Tokens in Kubernetes"
description: "Replace never-expiring Secret-based service account tokens with TokenRequest projected volumes: audiences, expiry, pod-bound tokens, and how IRSA consumes them."
pubDate: 2026-08-27
updatedDate: 2026-08-27
author: OpenSourceOM Team
tags:
  - Kubernetes
  - service accounts
  - IRSA
  - RBAC
  - container security
focusKeyword: Kubernetes projected service account tokens
faq:
  - question: What is a projected service account token in Kubernetes?
    answer: >-
      A JWT mounted via a projected volume, issued by the TokenRequest API, bound to
      the pod (and usually the node), with an audience and an expiry. It is not the
      old kubernetes.io/service-account-token Secret that lived forever in etcd.
  - question: Do bound tokens replace RBAC?
    answer: >-
      No. The token is only a credential. What that identity can do is still Role and
      ClusterRole. A short-lived token with cluster-admin is still cluster-admin until
      it expires. Shrink the Role first; then shrink the token lifetime.
  - question: Why does EKS IRSA need a projected token instead of the legacy Secret?
    answer: >-
      AWS STS validates the token’s audience (usually sts.amazonaws.com) and the
      subject (system:serviceaccount:ns:name). The legacy Secret token has audience
      kubernetes, never expires, and is not bound to a pod. IRSA will not exchange it.
  - question: Can I still find legacy tokens in 1.29+ clusters?
    answer: >-
      Yes. LegacyServiceAccountTokenNoWarning and related feature gates changed
      defaults, but Secrets of type kubernetes.io/service-account-token still exist
      if something created them, and some operators still request them. Inventory
      Secrets, do not assume the API version number.
---

```bash
kubectl get secret -A -o json \
  | jq -r '.items[] | select(.type=="kubernetes.io/service-account-token") | "\(.metadata.namespace)/\(.metadata.name)"'
```

If that list is not empty, those objects are **long-lived API credentials** sitting in etcd. **Kubernetes projected service account tokens** are the replacement: TokenRequest JWTs on a projected volume, with an audience and a clock.

This page is the token object. Who that identity may call is [Kubernetes RBAC](/blog/kubernetes-rbac-security-best-practices/). Do not conflate “we turned on bound tokens” with “we removed cluster-admin from the deploy SA.”

## Legacy secret tokens

Before bound tokens, every ServiceAccount got a Secret. The controller stuffed a JWT into `data.token`. The kubelet mounted three files:

```
/var/run/secrets/kubernetes.io/serviceaccount/token
/var/run/secrets/kubernetes.io/serviceaccount/ca.crt
/var/run/secrets/kubernetes.io/serviceaccount/namespace
```

Properties that made incident response miserable:

| Property | Legacy Secret token |
| --- | --- |
| Expiry | None (or years) |
| Audience | `kubernetes` / empty in old clusters |
| Binding | Not bound to a pod UID |
| Storage | etcd, readable by anyone who can `get secrets` |
| Rotation | Delete the Secret and hope kubelet remounts |

Anyone with `list`/`get` on Secrets in that namespace could copy the JWT and talk to the API until you rotated it. There was nothing to rotate except “delete the Secret,” which broke every pod using it at once.

`automountServiceAccountToken: false` on the default SA stops *new* mounts. It does not delete Secrets that already exist. Operators that still create `kubernetes.io/service-account-token` Secrets will recreate them.

```yaml
# Still a credential factory if something creates this type
apiVersion: v1
kind: Secret
metadata:
  name: payments-api-token
  annotations:
    kubernetes.io/service-account.name: payments-api
type: kubernetes.io/service-account-token
```

Treat that type as a finding. The API server may still accept the JWT.

## TokenRequest API

Bound tokens come from `TokenRequest`: the kubelet (or a controller) asks the API server to mint a JWT for a ServiceAccount, with `audiences` and `expirationSeconds`, optionally bound to a pod and a node.

The pod spec does not usually call the API itself. You declare a projected volume:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: payments-api
  namespace: payments
spec:
  serviceAccountName: payments-api
  containers:
    - name: app
      image: ghcr.io/example/payments@sha256:…
      volumeMounts:
        - name: kube-api-access
          mountPath: /var/run/secrets/kubernetes.io/serviceaccount
          readOnly: true
  volumes:
    - name: kube-api-access
      projected:
        sources:
          - serviceAccountToken:
              path: token
              expirationSeconds: 3600
              audience: https://kubernetes.default.svc
          - configMap:
              name: kube-root-ca.crt
              items:
                - key: ca.crt
                  path: ca.crt
          - downwardAPI:
              items:
                - fieldRef:
                    fieldPath: metadata.namespace
                  path: namespace
```

The kubelet refreshes the file before expiry. The process must re-read the file (client-go does). A long-lived in-memory copy of the first JWT is a self-inflicted legacy token.

You can also mint a token for debugging:

```bash
kubectl create token payments-api -n payments \
  --audience=https://kubernetes.default.svc \
  --duration=10m
```

That command is `create token` (TokenRequest). It is not `kubectl get secret`. If your runbook still says “copy the token from the Secret,” the runbook is the vulnerability.

API: [Bound service account tokens](https://kubernetes.io/docs/reference/access-authn-authz/service-accounts-admin/#bound-service-account-token-volume).

## Audiences and expiry

A JWT with `aud: kubernetes` must not be accepted by AWS STS, and a JWT with `aud: sts.amazonaws.com` must not be accepted by the Kubernetes API as a user token. That is the point of audience.

Set `expirationSeconds` as short as the client can refresh. One hour is a common kubelet default. Ten minutes is fine for a Job that only talks to the API at start. Seven days is “we were afraid of refresh bugs” and recreates most of the legacy incident window.

```yaml
# Wrong: one projected token used for both the API and a cloud provider
- serviceAccountToken:
    path: token
    expirationSeconds: 86400
    audience: ""   # empty aud is “please accept this everywhere”
```

Empty or missing audience is how tokens get reused across trust domains. If the pod needs Kubernetes *and* AWS, mount **two** projected tokens with two audiences (or use the cloud’s official webhook that already does this).

Validate what is on disk:

```bash
# Inside the pod; jwt is the file contents
cut -d. -f2 /var/run/secrets/kubernetes.io/serviceaccount/token \
  | tr '_-' '/+' | base64 -d 2>/dev/null | jq '{aud,exp,sub,kubernetes.io}'
```

You want `kubernetes.io.namespace` and `pod.name` in the claims for bound tokens. If those keys are missing, you are looking at a legacy token.

## Bound tokens and cloud IRSA

EKS IRSA (and the same pattern on GKE Workload Identity / AKS federated credentials) does not send the Kubernetes API a token. The pod presents a **projected** JWT to the cloud STS with `aud` equal to the cloud’s audience.

EKS projected volume (simplified from the Amazon webhook mutation):

```yaml
- serviceAccountToken:
    path: token
    expirationSeconds: 86400
    audience: sts.amazonaws.com
```

The IAM role trust policy then matches `sub` to `system:serviceaccount:payments:payments-api`. The Kubernetes Role for that SA can be empty if the process never calls the API. That is common and correct: automount a *cloud* token, not a kube API token.

Failure modes:

1. **IRSA annotation on the SA, but automount of the default kube token still on.** The process has both: an AWS role *and* a Kubernetes credential. Set `automountServiceAccountToken: false` and let the IRSA webhook add only the STS audience volume — or add an explicit projected volume with only `sts.amazonaws.com`.
2. **Same SA used by twelve Deployments.** Token binding is per pod, but the cloud role is per SA name. Compromise of any pod is the full IAM role. Split SAs.
3. **Trust policy `sub` too wide** (`system:serviceaccount:payments:*`). That is an IAM problem; the projected token is working as designed.

GKE Workload Identity uses a similar projected token toward Google’s STS. The Kubernetes side is the same object: TokenRequest, audience, expiry, pod binding.

If you graph pod → SA → cloud role, the edge is only honest if the token on disk is the projected one with the cloud audience. A leftover Secret token is a second, ungraphable credential. Correlate those paths in [attack path analysis](/blog/attack-path-analysis-cloud-security/) after the Secret inventory is empty.

## Checklist

- [ ] `kubectl get secret -A` has zero `kubernetes.io/service-account-token` for app SAs
- [ ] Default SA: `automountServiceAccountToken: false` in every namespace
- [ ] App pods that call the Kubernetes API use a projected volume with an explicit audience and `expirationSeconds` ≤ 3600
- [ ] App pods that only need AWS/GCP/Azure do not mount a kube API token
- [ ] IRSA/WI trust `sub` is `system:serviceaccount:ns:name`, not a wildcard
- [ ] Clients re-read the token file (client-go / official SDKs); no JWT copied into a ConfigMap
- [ ] CI and humans use `kubectl create token` with `--duration`, never `get secret` for a bearer

Projected tokens are a **credential format**. RBAC is still the authorization file. Fix both, or the short JWT is just a shorter cluster-admin session.
