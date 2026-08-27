---
title: "Image Provenance and SLSA on Kubernetes"
description: "SLSA levels that actually ship in production Kubernetes: Cosign attestations at admission, why a CVE scan is not provenance, and how to kill :latest."
pubDate: 2026-08-27
updatedDate: 2026-08-27
author: OpenSourceOM Team
tags:
  - Kubernetes
  - SLSA
  - Cosign
  - supply chain
  - container security
focusKeyword: Kubernetes image provenance SLSA
faq:
  - question: What SLSA level do I need before admitting images to prod?
    answer: >-
      You need a signed provenance attestation that names the builder, the source
      repo/commit, and the digest, verified at admission. That is roughly SLSA 2
      behavior in practice. SLSA 3 (hardcoded hermetic builder) is the next
      engineering project. Do not wait for SLSA 4 to stop unsigned :latest.
  - question: Does signing the image replace vulnerability scanning?
    answer: >-
      No. Cosign says who built this digest and that the bits were not swapped.
      A scanner says which CVEs are in the bits. You can have a perfectly
      provenance-valid image full of Criticals. Admit on signature plus policy;
      patch on scan plus reachability.
  - question: Where should Cosign verification run — CI or the cluster?
    answer: >-
      Both, with the cluster as the control that cannot be skipped. CI verification
      is a developer signal. Admission (ValidatingAdmissionPolicy, Kyverno, Gatekeeper,
      or Binary Authorization) is what stops a kubectl run from a laptop. If only CI
      checks signatures, anyone with cluster credentials bypasses your supply chain.
---

Last quarter’s incident was not “we forgot to scan.” It was a tag that moved. `payments:1.4` on Monday was your build. On Thursday it was someone else’s digest on the same tag, pulled by a Deployment that never pinned. **Kubernetes image provenance SLSA** is how you prove *which builder produced this digest*, then refuse everything else at the API server.

This is not a CI scanner tutorial (which image CVE to patch first is a different queue). It is attestations, admission, and tag hygiene. App-layer context for why unsigned images matter sits in [cloud-native application security](/blog/cloud-native-application-security/).

```
git commit  →  isolated builder  →  digest + provenance (in-toto)
                    ↓
              Cosign sign / attest
                    ↓
              registry
                    ↓
              admission: verify signature + provenance claims
                    ↓
              kubelet pull by digest
```

## SLSA levels that matter in prod

[SLSA](https://slsa.dev) is a ladder. Security reviews that say “we are SLSA 4” and still schedule `:latest` are lying. Map the levels to Kubernetes controls you can audit:

| SLSA-ish outcome | What you can show in prod | Typical gap |
| --- | --- | --- |
| **1 — documented build** | CI YAML in git | Anyone can `docker push` the same name |
| **2 — signed provenance** | Cosign/in-toto attestation on the digest; admission verifies | Tag still mutable; admission not enforced |
| **3 — hardened builder** | Ephemeral, isolated builder (GitHub-hosted hardened / Tekton / Cloud Build private pool); no self-hosted runner with extra mounts | Self-hosted runner with Docker socket |
| **4 — two-party / hermetic** | Reproducible, no network in compile, two-person review | Rare; do not block level 2 on this |

What to require this quarter: **every prod digest has a provenance attestation** whose `subject` is that digest, whose `predicate` names `github.com/your-org/payments@sha` (or the GitLab equivalent), and whose signature is from the builder identity you federated (keyless OIDC, not a stored Cosign key in CI variables).

```bash
# After a build: provenance must attach to the digest, not the tag
cosign tree ghcr.io/your-org/payments@sha256:abc…
cosign verify-attestation --type slsaprovenance \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --certificate-identity-regexp 'https://github.com/your-org/payments/.github/workflows/release.yml@.*' \
  ghcr.io/your-org/payments@sha256:abc…
```

If `verify-attestation` only works with `--insecure-ignore-tlog` or a static key that twenty pipelines share, you have a signature, not a builder identity.

SLSA 3 work that actually reduces risk: builders that cannot `docker login` to prod from a developer laptop, and cannot mount the host Docker socket. A GitHub-hosted runner with OIDC to the registry beats a beefy self-hosted VM that still has yesterday’s credentials.

## Cosign + admission

CI can sign and still lose. The control is: the API server will not persist a Pod whose image digest fails verification.

Binary Authorization on GKE, Kyverno `verifyImages`, Gatekeeper + Cosign, or a custom webhook — pick one and make it `failurePolicy: Fail`. Cluster-admin `kubectl run` is the test: if that path schedules an unsigned image, admission is theater.

Cosign keyless (Fulcio + Rekor) ties the signature to the CI OIDC identity. Store the **identity regexp** in the admission policy (repo + workflow file), not a password. A static key in GitHub Actions secrets is a long-lived credential that signs anything the workflow can be tricked into building.

```yaml
# Kyverno-shaped intent (engine may differ); pin digest in the workload
spec:
  containers:
    - name: app
      image: ghcr.io/your-org/payments@sha256:abc123…
```

Admission policy claims to check (all of them):

1. Cosign signature present for that digest.
2. OIDC identity matches the allowed workflow.
3. Optional: SLSA predicate `builder.id` is your builder, `source` repo is yours.
4. Image reference in the Pod is a digest, not a tag.

Do not verify only in the pipeline and “trust the registry.” Registries get write access mis-scoped. Admission is the last gate.

GKE Binary Authorization attestors are the same idea with Google’s policy API. EKS/AKS need an in-cluster verifier. If the verifier Deployment runs as `cluster-admin` and pulls unsigned images itself, you have a hole in the gate.

## Provenance vs vulnerability scan

| Signal | Question it answers | Failure if used alone |
| --- | --- | --- |
| Provenance / SLSA attestation | Did *our* builder produce this digest from *this* commit? | Malicious-but-signed commit; vulnerable deps |
| Cosign image signature | Did an allowed identity sign this digest? | Signing key/OIDC too wide |
| CVE scan (Trivy/Grype in CI) | What known vulns are in the FS/packages? | Unsigned image that scanned clean on Friday |
| Runtime SBOM | What is actually running? | Drift from the attested digest |

A scanner finding is prioritized with exposure and identity — that ranking is [how to prioritize cloud vulnerabilities](/blog/how-to-prioritize-cloud-vulnerabilities/). Provenance does not appear on that list. Do not close a Critical CVE because “SLSA is green.” Do not skip signing because “Trivy is in CI.”

Poisoned pipeline: attacker lands a PR that adds a build step. Scan of the *resulting* image may still be clean. Provenance will show a builder and commit; **code review and required checks** on that workflow file are the control. Protect `.github/workflows/release.yml` the same way you protect production IAM.

SBOMs (SPDX/CycloneDX) attached as attestations help later investigations. They are not SLSA. Generate them in the same isolated builder and attest them; do not bolt a SBOM onto an image you built on a laptop.

## Breaking :latest

`:latest` and any floating tag (`v1`, `stable`) mean the kubelet may pull a different digest after a node rotate. Your admission Cosign check on Monday’s digest does not apply to Wednesday’s silent retag unless you verify **at every pull** and the Pod spec still says `:latest`.

Rules:

```yaml
# Forbidden in prod
image: ghcr.io/your-org/payments:latest
image: ghcr.io/your-org/payments:1.4

# Required
image: ghcr.io/your-org/payments@sha256:abc123def…
```

Admission: deny image strings that lack `@sha256:`. GitOps: the PR that bumps the digest is the change record; the tag can exist in the registry for humans, but the cluster never sees it.

```bash
# CI: fail if rendered manifests use tags
grep -E 'image:.*:[A-Za-z0-9._-]+$' rendered.yaml | grep -v '@sha256:' && exit 1
```

`imagePullPolicy: Always` plus a tag is how you *maximize* surprise. `IfNotPresent` plus a tag is how you *freeze a random digest* per node. Digest + `IfNotPresent` is deterministic.

CronJobs and Jobs copy the same anti-pattern. Init containers too. Scan the whole Pod spec.

## Checklist

- [ ] Prod images referenced only by digest (`@sha256:`)
- [ ] Cosign (or equivalent) signature from CI OIDC identity, not a shared static key
- [ ] Provenance attestation on that digest; `cosign verify-attestation` in CI *and* admission
- [ ] Admission `failurePolicy: Fail`; unsigned `kubectl run` is denied
- [ ] Builder is isolated (no Docker socket on a standing VM) if you claim SLSA 3
- [ ] CVE scan still runs; provenance does not close vuln tickets
- [ ] Workflow files that produce prod images are protected branches / CODEOWNERS

Provenance answers **who built this digest**. Scanning answers **what is in it**. Kubernetes only cares what the Pod spec points at — make that a digest admission will verify. The rest of the app control plane is [cloud-native application security](/blog/cloud-native-application-security/), not another scanner screenshot.
