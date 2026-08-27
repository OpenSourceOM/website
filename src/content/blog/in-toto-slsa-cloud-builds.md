---
title: "in-toto and SLSA for Cloud CI Builds"
description: "in-toto attestations versus Cosign signatures, GitHub SLSA 2 vs 3, admission verification, and the gaps that still let a signed-but-wrong image run."
pubDate: 2026-08-27
updatedDate: 2026-08-27
author: OpenSourceOM Team
tags:
  - SLSA
  - in-toto
  - supply chain
  - GitHub Actions
  - CI/CD
focusKeyword: in-toto SLSA cloud builds
faq:
  - question: If the image is Cosign-signed, do I still need an in-toto attestation?
    answer: >-
      Yes if you care how it was built. A signature says this identity produced
      this digest. An in-toto/SLSA provenance attestation says which repo,
      workflow, and builder produced it. A signed digest from a developer
      laptop is not the same as a signed digest from the release workflow on
      GitHub-hosted runners.
  - question: Does GitHub's attest-build-provenance action mean we are SLSA 3?
    answer: >-
      It gets you provenance in the in-toto format from GitHub's builder, which
      is the usual path toward SLSA Build L3 for GitHub-hosted jobs. Self-hosted
      runners, reusable workflows you do not pin, and pull_request jobs from
      forks are where the level drops. Read the current SLSA GitHub generator
      docs; the number on a slide is not a level.
  - question: Where should I verify provenance, CI or admission?
    answer: >-
      Both if you can. CI verify is cheap and fails the PR. Admission verify
      stops the digest that skipped CI (Helm chart, debug pod). Admission that
      only checks a signature and ignores the predicate builderId will admit a
      keyless signature from the wrong workflow.
  - question: What does SLSA not stop?
    answer: >-
      Malicious but authorized code in the repo, a compromised GitHub org
      admin, a poisoned npm install inside a workflow that is still "the
      official builder," and runtime compromise after admit. Provenance is not
      a CVE scanner and not IAM.
---

A Cosign signature answers *who attested this digest*. An **in-toto** statement answers *what the builder claims happened*—source repo, entry point, builder identity. **SLSA** (Supply-chain Levels for Software Artifacts) is the bar for how hard that claim is to forge. Cloud CI is where most teams first meet both, usually as a GitHub Actions checkbox they never verify in the cluster.

This page is **in-toto SLSA cloud builds**: attestations vs signatures, what GitHub actually gives you at Build L2 vs L3, admission verify, and the gaps. It is not an image CVE program and not a Cosign keyless primer. App-layer placement is [cloud-native application security](/blog/cloud-native-application-security/). Specs: [in-toto](https://in-toto.io/) and [SLSA](https://slsa.dev/).

```
source commit
  → cloud CI (GitHub-hosted job)
       → image digest
            → provenance attestation (in-toto predicate)
                 → signature over the attestation
                      → registry / Rekor
                           → admission checks predicate, not only cert
```

If you stop at "signed," a laptop with OIDC to the same org can still be "who."

## Attestations vs signatures

**Signature (Cosign image signature):** binds an identity to a digest. Useful. Insufficient if the identity is "any workflow in the org" or "this developer."

**Attestation:** a signed in-toto Statement. Typical predicate for builds is SLSA provenance (`https://slsa.dev/provenance/v1` or the v0.2 URI still in the wild). Fields you actually use:

| Field | Why you care |
| --- | --- |
| `builder.id` | Must be GitHub's official generator (or your hermetic builder), not `https://github.com/org/ad-hoc` |
| `source` / `resolvedDependencies` | Repo and commit you think you shipped |
| `runDetails` / `invocation` | Workflow file, event, possibly `workflow_ref` |
| `buildType` | Distinguishes "GitHub Actions build" from "mystery script" |

```bash
# Inspect, do not just grep the log for "attestation uploaded"
gh attestation verify oci://ghcr.io/org/payments@sha256:… \
  --owner org --predicate-type https://slsa.dev/provenance/v1
```

Cosign equivalent: `cosign verify-attestation --type slsaprovenance ...` with the same identity pins you use for signatures.

Failure mode: you require a signature and optionally store an attestation that nothing reads. The attestation is then a compliance artifact, not a control. Failure mode: you verify the attestation signature but never inspect `builder.id`, so a self-hosted runner named `prod-builder` with extra debug software still counts as SLSA theater.

## SLSA 2 vs 3 in GitHub

SLSA **Build** levels (the ones CI teams mean):

| Level | Builder property (simplified) | Typical GitHub shape |
| --- | --- | --- |
| L2 | Hosted, signed provenance | GitHub-hosted runner + provenance attestation |
| L3 | Hardened, isolated, non-falsifiable provenance | GitHub's provenance generator / attested builds on GitHub-hosted, with the workflow pinned |

[GitHub artifact attestations](https://docs.github.com/en/actions/security-for-github-actions/using-artifact-attestations) and the SLSA GitHub generator exist so you do not hand-roll predicate JSON. The Actions job still needs:

```yaml
permissions:
  id-token: write
  attestations: write
  contents: read
  packages: write
```

and a build that runs on `github-hosted` labels, not `runs-on: [self-hosted, linux, prod]`, if you are claiming L3 isolation. Self-hosted runners share disks, caches, and sometimes Docker sockets; that is a different builder id and a lower assurance, even if `gh attestation` succeeds.

Reusable workflows: pin `@sha` of the called workflow. `@v1` of `org/security-workflows` that anyone with write to that repo can change is a builder you do not control.

`pull_request` from forks: no secrets, no `id-token` to your org the way people expect. Do not "attest" PR builds into the prod registry. Attest `workflow_dispatch` / tag / `push` to protected branches only.

Failure mode: slide says SLSA 3 because the marketplace action is named `attest-build-provenance`. The job uses a self-hosted runner with `docker.sock` mounted. Call it L2-ish and fix the runner, or stop claiming L3.

## Verifying in admission

CI `gh attestation verify` is necessary and skippable (someone `docker push` from a laptop). Admission must require:

1. A provenance attestation on the digest
2. `builder.id` in an allow-list
3. Source repo in an allow-list (`github.com/org/payments`, not `github.com/org/experiments`)
4. Optional: workflow path equals `/.github/workflows/release.yml`

Kyverno can `verifyImages` with attestors that check attestations; the Sigstore policy-controller can require predicate type and subject. Whatever you pick, fail closed in prod for app namespaces.

Unsigned kube-system images still need an allow-list—same operational rule as signature-only Cosign. Do not require SLSA provenance on `pause` and `coredns` from the cloud vendor.

Failure mode: admission verifies Cosign **signature** identity but not the provenance predicate. A keyless signature from `ci.yml` on a feature branch then deploys to prod because the identity regexp was too wide. Tighten identity **and** require the attestation.

Commands for a break-glass check:

```bash
cosign verify-attestation --type slsaprovenance \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --certificate-identity-regexp 'https://github.com/org/payments/.github/workflows/release\.yml@refs/tags/' \
  ghcr.io/org/payments@sha256:…
```

If this fails in-cluster, dump network policy: the controller needs Rekor (keyless) or a pre-attached bundle.

## Gaps

Provenance does not mean the **contents** are safe:

- A malicious dependency installed during `npm ci` is still in the digest; the attestation honestly describes that build
- Org-admin who can change `release.yml` on `main` is the builder
- Cache poisoning on self-hosted runners
- Registry tags that point at a different digest than the one attested (always admit by digest)
- Cloud IAM after schedule: the pod's IRSA role is outside SLSA ([CIEM](/blog/ciem-explained-for-cloud-teams/) / [Kubernetes RBAC](/blog/kubernetes-rbac-security-best-practices/))

GitLab, Cloud Build, and CodeBuild have their own provenance stories. Do not copy GitHub's `builder.id` allow-list onto those. Each builder is a different trust root.

## Checklist

- [ ] Release jobs emit in-toto/SLSA provenance, not only an image signature
- [ ] Verify `builder.id` and source repo, not "has any attestation"
- [ ] GitHub-hosted runners for the jobs you call L3; self-hosted called out as weaker
- [ ] Reusable workflows pinned by SHA; no fork PR attestations into prod registry
- [ ] Admission requires provenance in app namespaces; vendor images allow-listed
- [ ] Digests only; tags never admitted

**Related:** [Cloud-native application security](/blog/cloud-native-application-security/) · [Kubernetes RBAC security](/blog/kubernetes-rbac-security-best-practices/) · [CIEM explained](/blog/ciem-explained-for-cloud-teams/)
