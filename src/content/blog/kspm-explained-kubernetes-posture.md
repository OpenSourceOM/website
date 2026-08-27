---
title: "KSPM Explained: Kubernetes Security Posture Beyond CIS YAML"
description: "KSPM beyond CIS YAML: cluster config versus workload identity, connecting findings to cloud IAM, and where admission control differs from scans."
pubDate: 2026-08-27
updatedDate: 2026-08-27
author: OpenSourceOM Team
tags:
  - KSPM
  - Kubernetes
  - CIS benchmark
  - cloud IAM
  - security posture
focusKeyword: KSPM Kubernetes security posture
faq:
  - question: If kube-bench is green, is KSPM done?
    answer: >-
      No. kube-bench (CIS) checks control-plane and node settings: anonymous auth, file
      permissions, Pod Security admission mode. It does not see IRSA annotations, Azure
      federated credentials, or a node instance profile with AdministratorAccess. Those
      are cloud IAM edges. A green CIS report plus a pod that can iam:CreateUser is not
      a secure cluster; it is a well-hardened API server in front of a cloud-admin
      workload.
  - question: Is KSPM the same as running Gatekeeper?
    answer: >-
      No. Admission (Gatekeeper, Kyverno, PSA) is a mutating/validating webhook at
      create/update time. KSPM is a scan of live and/or rendered desired state: CIS,
      overly permissive Roles, privileged pods that already exist, cloud role bindings.
      Admission would have blocked some of those at deploy; it does not inventory what
      is already running or what the cloud role can do. This page is not a Gatekeeper
      tutorial.
  - question: How does OpenSourceOM attach a CIS finding to an attack path?
    answer: >-
      CIS items that are node properties (anonymous-auth true) become REACHABLE or
      identity-adjacent edges. CIS items that are files on disk (kubelet cert perms)
      usually do not. OpenSourceOM should only promote a KSPM finding onto a path when
      the same object is a hop: privileged pod that can reach the node role, SA with
      IRSA admin, API server anonymous from Internet. A failed CIS control with no hop
      stays a hygiene ticket.
  - question: Do I scan the live cluster, the Git manifests, or both?
    answer: >-
      Both, for different failures. Git/admission catches the next deploy. Live scan
      catches emergency kubectl, Helm --force, and charts that render differently than
      the PR. Cloud IAM is only live (or cloud IaC), never in the Kubernetes YAML.
      OpenSourceOM collectors should read the API server and the cloud account; a
      YAML-only KSPM will miss IRSA.
---

**KSPM (Kubernetes Security Posture Management)** is posture for the cluster and the workloads on it: API-server flags, node/kubelet settings, RBAC, privileged pods, and—if you are doing it honestly—the **cloud identity** those pods mint. It is not “we ran the CIS YAML” and not a policy-engine how-to. In-cluster authorization is [Kubernetes RBAC](/blog/kubernetes-rbac-security-best-practices/). The IRSA/WI hop to cloud admin is [pod to cloud admin](/blog/kubernetes-pod-to-cloud-admin-path/). This page is **what KSPM is allowed to claim**, and how OpenSourceOM should connect a CIS-shaped finding to a graph hop—or refuse to.

```
KSPM scan surfaces
  ├─ Cluster config     API flags, etcd, kubelet, PSA mode     (CIS-ish)
  ├─ Workload posture   privileged, hostNetwork, wild RBAC
  └─ Cloud binding      IRSA / WI / node instance profile      (not in CIS)

Only the rows that are hops belong on an attack path
```

## Cluster config vs workload identity

**Cluster config** is the control plane and the nodes: `--anonymous-auth`, `--authorization-mode`, encryption at rest for secrets, kubelet anonymous, Pod Security Admission `enforce` mode, whether the API server is on a public NLB.

**Workload identity** is who the *process* is: Kubernetes SA, projected token, cloud role. CIS barely touches it. kube-bench will not fail a deployment because `eks.amazonaws.com/role-arn` points at `AdministratorAccess`.

| Layer | Example finding | Path-relevant? |
| --- | --- | --- |
| Cluster config | Anonymous auth enabled | Yes if `Internet --REACHABLE--> API` |
| Cluster config | kubelet cert file 644 | Rarely a hop; hygiene |
| Workload | `privileged: true` + `hostPID` | Yes if it yields node credentials |
| Workload | `cluster-admin` on deploy SA | Yes for Kubernetes API; not automatically cloud admin |
| Cloud binding | IRSA to admin role | Yes — often the **highest** hop |
| Cloud binding | Node instance profile `s3:*` | Yes for every pod that can reach IMDS |

OpenSourceOM node split: `Workload` (control plane vs app pod), `Identity` (K8s SA vs cloud role). Mixing them into one “cluster CI” is how KSPM dashboards show 2,000 CIS fails and hide the one IRSA admin.

Failure mode: buying a “KSPM module” that is kube-bench XML plus a logo. You automated CIS. You did not do identity.

## CIS is necessary and insufficient

Run CIS (kube-bench, or the managed equivalent in Defender/GKE security posture). It catches:

- Anonymous requests to the API
- AlwaysAllow authorization
- Insecure kubelet flags
- Missing file permissions on control-plane hosts (self-managed)

It does **not** catch:

- `StringLike` IRSA `sub` `*:*`
- Azure federated credential subject `system:serviceaccount:*:*`
- GKE node SA `roles/editor`
- A NetworkPolicy-less cluster with a public LoadBalancer to a debug pod
- Secrets `list` in a Role that CIS never reads

Treat CIS as **necessary hygiene** on self-managed and as **baseline** on EKS/GKE/AKS (many controls are already the vendor’s problem). Do not use CIS score as reachable risk. [Reachable risk](/blog/reachable-risk-cloud-security/) needs `REACHABLE` and `CAN_ASSUME`, which CIS does not compute.

```
# CIS (control plane) — keep doing this
kube-bench run --targets master,node,policies

# Not CIS — still KSPM if you are honest
kubectl get sa -A -o json | jq '.items[] | select(.metadata.annotations["eks.amazonaws.com/role-arn"]!=null) | [.metadata.namespace,.metadata.name,.metadata.annotations["eks.amazonaws.com/role-arn"]]'
kubectl-who-can get secrets --all-namespaces
```

Failure mode: exempting managed node groups from CIS because “AWS owns the master,” then never listing IRSA annotations. You exempted the right CIS controls and skipped the real KSPM.

## Connecting KSPM findings to cloud IAM

The join OpenSourceOM must make:

```
Pod / SA  --ASSUMES-->  cloud Identity  --CAN_ACCESS-->  Datastore | iam:*
                ↑
         KSPM finding (privileged, hostNetwork, SA automount)
         only raises rank if this join exists or if Kubernetes API is the jewel
```

**Privileged + hostNetwork** matters when the pod can hit IMDS/WI and the **node** role is wide, or when it can take over the node and read projected tokens of other pods. If the node role is `AmazonEKSWorkerNodePolicy` plus ECR pull and IRSA is scoped, privileged is still bad (kernel) but not “cloud admin” until you prove the extra hop.

**Public LoadBalancer + empty RBAC** matters when the Service fronts a debug image with a cloud annotation.

**CIS anonymous-auth** matters when the API is `REACHABLE` from `Internet` (or from the VPN you treat as hostile). If the API is private-only and wrapped in IAP, the CIS fail is still real and still not the same ticket as IRSA admin.

Collector requirement: Kubernetes API **and** the cloud account that owns IRSA/WI/node roles. YAML-in-Git KSPM cannot see the node instance profile. Cloud-only CSPM cannot see the annotation until a K8s collector exists.

Failure mode: creating a Jira “fix CIS 5.2.1” for a privileged pod in a namespace whose SA has no cloud role and no hostPath, while ignoring the unprivileged API pod with `AdministratorAccess`. Severity came from the CIS id, not from the join.

## Admission vs posture scans

| | Admission (PSA, Kyverno, Gatekeeper, ValidatingAdmissionPolicy) | Posture scan (KSPM) |
| --- | --- | --- |
| When | Create/update/delete of a Kubernetes object | Periodically, on live objects and/or rendered manifests |
| Sees | The request (and sometimes dry-run) | What actually runs, plus drift |
| Sees cloud IAM | No | Only if the scanner has a cloud collector |
| Good at | Stopping the next privileged pod | Finding the privileged pod someone `kubectl apply`’d at 2 a.m. |
| Bad at | History; objects that bypassed (break-glass, excluded ns) | Stopping the next apply unless you also have admission |

You want **both**. Admission without scans: yesterday’s break-glass Namespace stays privileged forever. Scans without admission: you discover the same privileged Helm chart every Monday. Neither replaces cloud IAM review.

OpenSourceOM is a **posture + path** system, not an admission controller. Do not expect the graph to block a deploy. Expect it to rank the privileged pod that already exists **if** it sits on a walk. Wire admission in the platform cluster; wire collectors to OpenSourceOM.

This is also why a Gatekeeper constraint library is not KSPM. Constraints are policies at the gate. KSPM is the audit of state, including state the gate never saw.

Failure mode: enabling PSA `enforce: baseline` and turning off live KSPM “because admission covers it.” PSA does not know IRSA. PSA does not scan cloud roles. PSA does not see a public NLB Terraform that never touches a Pod spec.

## Checklist

- [ ] CIS/kube-bench (or managed equivalent) still runs; score is not the rank
- [ ] IRSA/WI/node roles listed and joined to SAs; cloud admin on a pod is a path ticket
- [ ] Privileged/hostPath findings ranked using IMDS/node-role/IRSA hops, not CIS id alone
- [ ] Collectors: Kubernetes API + cloud account (YAML-only is insufficient)
- [ ] Admission enabled for privileged/hostPath **and** live scan for break-glass drift
- [ ] Anonymous API + internet `REACHABLE` is a path; kubelet file perms are hygiene
- [ ] RBAC who-can on secrets is in CI (RBAC post); not confused with KSPM CIS XML

---
**Related:** [Kubernetes RBAC security](/blog/kubernetes-rbac-security-best-practices/) · [Cloud-native application security](/blog/cloud-native-application-security/) · [Pod to cloud admin](/blog/kubernetes-pod-to-cloud-admin-path/)
