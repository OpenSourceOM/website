---
title: "Cloud-Native Application Security: Design Patterns for Secure Apps"
description: "Seven design patterns for securing cloud-native apps on Kubernetes and serverless—supply chain, identity, network, secrets, APIs, runtime, and attack-path context."
pubDate: 2026-08-27
updatedDate: 2026-08-29
author: OpenSourceOM Team
tags:
  - application security
  - cloud-native
  - Kubernetes
  - CNAPP
  - DevSecOps
focusKeyword: cloud-native application security
faq:
  - question: What is cloud-native application security?
    answer: Cloud-native application security is the set of controls that protect apps built from containers, Kubernetes, and serverless functions across the whole lifecycle—from signed images and admission policy through identity, network, APIs, and runtime—rather than a single scanner product.
  - question: How is it different from CSPM or CNAPP?
    answer: "CSPM checks cloud account configuration. CNAPP correlates posture, workloads, and identities. Application security owns the app’s own attack surface—code, images, service-to-service auth, and APIs. You need both: a public bucket is a cloud finding; an unsigned image talking to production data is an application finding."
  - question: Which pattern should teams implement first?
    answer: Start with identity and exposure. Remove long-lived keys in favor of IRSA or Workload Identity, and keep internet-facing services behind an authenticated ingress. Those two changes shrink the blast radius of every other class of bug.
  - question: Can open-source tools cover cloud-native application security?
    answer: Yes. Trivy, Cosign, Kyverno or Gatekeeper, NetworkPolicies, Falco, and a graph like OpenSourceOM cover most of the pattern set without a proprietary CNAPP. Buy commercial tools where you need managed scale, not to replace the patterns.
---

Cloud-native application security is not “run a scanner on the cluster.” It is a small set of **design patterns** that stay true while services scale, nodes recycle, and Terraform reapplies twice a day.

This is the application-layer playbook: how one internet-facing API, a worker, and a datastore should be built. It is not a product cookbook—for Google’s edge WAF and DDoS layer, use the [Cloud Armor operator guide](/blog/gcp-cloud-armor-security-guide/). The goal here is a system where a CVE or misconfiguration is only a page-one incident if it sits on a **reachable path**.

## The app we are securing

Treat this as the reference architecture. Every pattern below maps to an edge in this picture.

```
Internet
   │  TLS + WAF / Cloud Armor / AWS WAF
   ▼
Ingress / API gateway   (authn, rate limit)
   │  mTLS + NetworkPolicy
   ▼
API workload  ──ASSUMES──▶  workload identity  ──CAN_ACCESS──▶  secrets
   │                                          ──CAN_ACCESS──▶  datastore
   ▼
Worker / jobs (no public Service)
```

Threats that actually matter here:

| Attacker step | Typical bug | Pattern that breaks it |
| ------------- | ----------- | ---------------------- |
| Reach the API | Open Service / LoadBalancer, no WAF | Edge and API |
| Run untrusted code | `:latest` image, no admission | Supply chain |
| Steal a key | JSON key in a Secret or CI variable | Identity and secrets |
| Move east-west | Flat cluster network | Network |
| Dump the database | Over-privileged IRSA role | Identity + path context |
| Persist after exploit | Reverse shell in the container | Runtime |

CSPM still matters—public buckets, [public EBS snapshots](/blog/aws-ebs-snapshot-public-exposure/), and [toxic combinations](/blog/toxic-combinations-aws-azure/) will ruin this design—but they are inputs to the graph, not a substitute for application controls. For how scanners and CNAPP differ, see [CSPM vs CNAPP](/blog/cspm-vs-cnapp-whats-the-difference/).

## Pattern 1 — Immutable supply chain

**Intent:** Nothing runs in production unless you can name who built it, from which commit, with which dependencies.

**How it fails:** Teams scan images in CI, then deploy a different digest from a shared `:latest` tag, or allow `kubectl` to apply an unsigned chart.

**Implement:**

1. Build once; promote the **digest**, never a floating tag.
2. Generate an SBOM at build (Syft) and fail the pipeline on high CVEs that have a reachable runtime (Trivy or Grype). Scanning without gating is documentation, not security.
3. Sign the image (Cosign) and store the signature next to the digest.
4. Enforce at admission: Kyverno or Gatekeeper rejects pods whose image is unsigned or not from your registry.

```yaml
# Kyverno: require signed images from your registry (illustrative)
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: require-signed-images
spec:
  validationFailureAction: Enforce
  rules:
    - name: verify-cosign
      match:
        any:
          - resources:
              kinds: [Pod]
      verifyImages:
        - imageReferences:
            - "registry.example.com/*"
          attestors:
            - entries:
                - keys:
                    publicKeys: |-
                      -----BEGIN PUBLIC KEY-----
                      ...
                      -----END PUBLIC KEY-----
```

Pair this with [Trivy in CI vs the operator](/blog/trivy-operator-vs-ci-scanning/) and [Validating Admission Policy](/blog/kubernetes-validating-admission-policy/). Supply-chain attestation is useless if anyone can `kubectl apply` around GitOps; lock the digest at admission with [image provenance and SLSA](/blog/kubernetes-image-provenance-slsa/).

## Pattern 2 — Workload identity, not keys in pods

**Intent:** Every process that talks to the cloud assumes a **short-lived, scoped identity**. There is no JSON key in a Secret, no static Azure client secret in CI, no downloaded GCP service-account key on a laptop.

**How it fails:** A CI job mints a key “just for the weekend.” Six months later it is still in the worker’s environment and can `roles/storage.admin` across the project.

**Implement:**

| Platform | Mechanism | Guardrail |
| -------- | --------- | --------- |
| EKS | IRSA (service account → IAM role) | Trust policy limited to one SA in one namespace |
| GKE | Workload Identity | IAM binding on the Kubernetes SA, not the node SA |
| AKS | Workload ID | Federated credential on the app registration |
| Lambda / Cloud Run / Functions | Runtime service identity | No env-var keys; IAM on the function/service |

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::123456789012:oidc-provider/oidc.eks.us-east-1.amazonaws.com/id/EXAMPLE"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "oidc.eks.us-east-1.amazonaws.com/id/EXAMPLE:sub": "system:serviceaccount:payments:api"
        }
      }
    }
  ]
}
```

If a pod is compromised, the attacker gets **that** role, not the node’s. Graph that as `Workload —ASSUMES→ Identity —CAN_ACCESS→ Datastore` and you can ask “what does this identity reach?” instead of reading IAM JSON by hand. See [GitLab Workload Identity Federation on GCP](/blog/gitlab-ci-workload-identity-gcp/), [GitHub Actions OIDC to AWS](/blog/github-actions-oidc-aws-iam/), and [CIEM](/blog/ciem-explained-for-cloud-teams/).

## Pattern 3 — Default-deny east-west

**Intent:** The API can talk to the datastore and the worker. The worker cannot be reached from the internet. Nothing else is allowed.

**How it fails:** A ClusterIP Service plus an over-broad NetworkPolicy (or none) means a compromised front-end pod can scan every namespace.

**Implement:**

- Namespace-level default deny ingress and egress, then allowlists.
- Prefer eBPF policies (Cilium) when you need L7 or identity-aware rules; kube-proxy NetworkPolicy is enough to start.
- Put service mesh mTLS **after** NetworkPolicy, not instead of it. Encryption without segmentation still lets the attacker call every RPC.

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: api-to-db
  namespace: payments
spec:
  podSelector:
    matchLabels:
      app: api
  policyTypes: [Ingress, Egress]
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: ingress-nginx
      ports:
        - port: 8080
  egress:
    - to:
        - podSelector:
            matchLabels:
              app: postgres
      ports:
        - port: 5432
    - to:
        - namespaceSelector: {}
          podSelector:
            matchLabels:
              k8s-app: kube-dns
      ports:
        - port: 53
          protocol: UDP
```

Treat NetworkPolicy as cluster posture ([KSPM](/blog/kspm-explained-kubernetes-posture/)), not a mesh-only problem. East-west encryption without segmentation still fails [zero trust](/blog/zero-trust-cloud-architecture-guide/).

## Pattern 4 — Secrets stay off the image and off disk

**Intent:** The API never ships credentials. It fetches them at runtime from a manager, with rotation, and the identity from Pattern 2 is the only principal allowed to read them.

**How it fails:** Base64 Kubernetes Secrets in Git, `AWS_SECRET_ACCESS_KEY` in a ConfigMap, or a `.env` baked into the image.

**Implement:** External Secrets Operator or CSI secret store → AWS Secrets Manager, Azure Key Vault, or GCP Secret Manager. Mount as a file with mode `0400` or inject via the SDK. Rotate on a schedule; the app must tolerate refresh.

Do not grant the node role `secretsmanager:GetSecretValue` on `*`. Bind it to the workload identity and to named secret ARNs. On the cluster side, prefer [projected service-account tokens](/blog/kubernetes-projected-service-account-tokens/); on the cloud side, check what that identity can reach with [blast-radius analysis](/blog/blast-radius-analysis-cloud-iam/).

## Pattern 5 — Authenticate at the edge, authorize in the app

**Intent:** Anonymous internet traffic never hits application code except for health checks you explicitly allow.

**How it fails:** A public LoadBalancer Service, an Ingress with no auth, or “the mesh will handle it later.”

**Implement:**

1. Terminate TLS at the load balancer or ingress. Put a WAF in front ([Cloud Armor](/blog/gcp-cloud-armor-security-guide/), [AWS WAF](https://docs.aws.amazon.com/waf/latest/developerguide/waf-chapter.html), [Azure Application Gateway WAF](https://learn.microsoft.com/en-us/azure/web-application-firewall/ag/ag-overview)). Attachment, rule sets, and preview mode belong in the WAF product docs—not here.
2. Authenticate with OIDC / IAP / Cognito / Entra at the gateway for human traffic; mTLS or signed tokens for service traffic.
3. Rate-limit unauthenticated endpoints at the gateway (Cloud Armor’s throttle rules are the GCP example) so anonymous floods never reach application code.
4. The app still enforces authorization (RBAC, tenancy). A gateway is not your object-level ACL.

## Pattern 6 — Runtime is the last control, not the first

**Intent:** Detect process, file, and network behavior that admission and IAM cannot see: a shell in a distroless image, a new binary, a connection to an unexpected CIDR.

**How it fails:** Falco is installed in `audit` mode, alerts go to a Slack channel nobody owns, and there is no link from “shell spawned” to “this pod’s IRSA role can read production secrets.”

**Implement:** Falco or Tetragon with a small, high-signal ruleset. Page on:

- Shell or package manager in production images
- Unexpected outbound to non-mesh CIDRs
- Reads of `/var/run/secrets/kubernetes.io` from a process that is not the app

Wire the alert to the **workload node** in your security graph so identity blast radius is one click away. See [cloud detection and response](/blog/cdr-cloud-detection-response/) and [pod-to-cloud-admin paths](/blog/kubernetes-pod-to-cloud-admin-path/).

## Pattern 7 — Prioritize by attack path, not by CVSS

**Intent:** A critical CVE on an isolated job with no network and a read-only identity waits. A medium finding on the internet-reachable API that `ASSUMES` a role with `CAN_ACCESS` to the datastore does not.

**How it fails:** The ticket queue is sorted by scanner severity. Engineers burn a sprint on CVEs that cannot be reached.

OpenSourceOM models this as a graph ([schema](/docs/the-graph/)):

| Node | In this app |
| ---- | ----------- |
| `Internet` | Public clients |
| `Workload` | API, worker, ingress |
| `Identity` | IRSA / Workload Identity |
| `Datastore` | Postgres, buckets |
| `Finding` | CVE or CSPM miss |

Edges: `REACHABLE`, `ASSUMES`, `CAN_ACCESS`, `AFFECTS`. Named queries such as `internet-to-datastore` answer “does this finding sit on a path?” instead of “how red is the CVSS badge?”

That is the same idea as commercial CNAPP path analysis, in code you can run in your VPC ([core repo](https://github.com/OpenSourceOM/core)). Use it to feed [vulnerability prioritization](/blog/how-to-prioritize-cloud-vulnerabilities/) rather than as another dashboard.

## Putting the patterns on a cadence

| When | What |
| ---- | ---- |
| Every build | SBOM, image scan, Cosign sign, digest pin |
| Every deploy | Admission (PSS restricted, signed images), NetworkPolicy review on new ports |
| Continuous | CSPM drift, Falco, WAF logs, graph path queries |
| Weekly | Identity: unused roles, new `CAN_ACCESS` to production data |
| Quarterly | Tabletop: stolen IRSA token + public ingress without WAF |

[Validating Admission Policy](/blog/kubernetes-validating-admission-policy/) and [seccomp/AppArmor](/blog/kubernetes-seccomp-and-apparmor/) belong in admission from day one (`restricted` PSS for this app). Do not wait for a “hardening sprint.”

## What not to copy from vendor slides

- **One tool for all seven patterns.** Admission does not replace IAM. WAF does not replace NetworkPolicy.
- **Checkbox CIS without paths.** CIS still catches stupid defaults; it will not tell you the API’s role can `s3:GetObject` on the backup bucket.
- **Blocking every CVE.** Block what is reachable and exploitable; track the rest. Otherwise the pipeline becomes noise and people add `continue-on-error`.

## Key takeaways

- Cloud-native application security is a **pattern set**: supply chain, workload identity, default-deny network, secret isolation, authenticated edge, runtime detection, and path-based priority.
- Implement identity and exposure first; they shrink every other incident.
- Open-source pieces (Cosign, Kyverno, IRSA/WIF, NetworkPolicy, Falco, OpenSourceOM) compose into this design without a black-box CNAPP—buy products to operate the patterns at scale, not to invent them.

**Related:** [GCP Cloud Armor](/blog/gcp-cloud-armor-security-guide/) · [Attack path analysis](/blog/attack-path-analysis-cloud-security/) · [Kubernetes RBAC](/blog/kubernetes-rbac-security-best-practices/)
