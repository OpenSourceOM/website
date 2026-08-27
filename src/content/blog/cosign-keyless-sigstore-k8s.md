---
title: "Cosign Keyless Signing and Admission on Kubernetes"
description: "Cosign keyless signing with Fulcio and Rekor, admission via Kyverno or VAP, and the air-gap limits that force you back to keys on Kubernetes."
pubDate: 2026-08-27
updatedDate: 2026-08-27
author: OpenSourceOM Team
tags:
  - Cosign
  - Sigstore
  - Kubernetes
  - supply chain
  - admission control
focusKeyword: Cosign keyless Sigstore Kubernetes
faq:
  - question: Is keyless more secure than a hardware-backed signing key?
    answer: >-
      Keyless removes the long-lived private key you would otherwise store in
      CI. Identity is the GitHub/GitLab OIDC token at sign time, recorded in
      Rekor. A stolen repo OIDC trust or a stolen Fulcio identity is still
      fatal. Keys in an HSM can be stronger if you actually protect them; most
      teams do not.
  - question: Can ValidatingAdmissionPolicy verify Cosign signatures by itself?
    answer: >-
      Not in any useful way today. VAP is CEL over the admission object. It
      cannot call Rekor or unpack a Sigstore bundle. Use Kyverno verifyImages,
      the Sigstore policy-controller, or a custom webhook. VAP can still deny
      missing annotations that those controllers add.
  - question: What identity string should I pin in verify?
    answer: >-
      The exact certificate identity and OIDC issuer, for example
      https://github.com/org/payments/.github/workflows/release.yml@refs/tags/
      and https://token.actions.githubusercontent.com. Pinning only the org
      lets a sibling workflow in a less-protected repo sign production images.
  - question: Why did verify work in CI and fail in the cluster?
    answer: >-
      Different Rekor/Fulcio endpoints, clock skew on nodes, a cluster that
      cannot reach rekor.sigstore.dev, or a policy that pins an identity the
      CI job no longer uses after a workflow rename. Dump the bundle with
      cosign verify --output text on a break-glass laptop first.
---

Keyless Cosign does not mean "unsigned." It means the signer is an **OIDC identity** (the GitHub Actions job, the GitLab pipeline) that Fulcio turns into a short-lived certificate, and Rekor records the signature so nobody can deny it later.

This page is **Cosign keyless Sigstore Kubernetes**: keys vs keyless, Rekor, admission with Kyverno or a policy controller (not CEL-only VAP), and air-gap limits. Scanning the bits inside the image is a different control ([cloud-native application security](/blog/cloud-native-application-security/)). Official flow: [Sigstore Cosign](https://docs.sigstore.dev/cosign/signing/overview/).

```
GitHub OIDC token
  → Fulcio (short-lived cert)
       → cosign sign digest
            → Rekor entry
                 → registry (optional attach)
                      → Kyverno / policy-controller  (admit or deny)
```

If admission does not check the identity **and** the issuer, you verified that *someone* in the public good Sigstore signed it.

## Keyless vs keys

**Keys:** `cosign generate-key-pair`, public key in the cluster, private key in a vault. Operationally simple in air-gap. The private key is a standing secret. CI needs `cosign sign --key`. Rotation is a ceremony. Compromise of the key signs anything until you rotate and re-sign the world.

**Keyless:** `cosign sign --yes` in a workflow with `id-token: write`. No long-lived signing secret. Verification pins:

- `--certificate-identity` (or `--certificate-identity-regexp`)
- `--certificate-oidc-issuer`

```yaml
# GitHub Actions — keyless sign the digest you just pushed
permissions:
  id-token: write
  contents: read
  packages: write
# after docker push of $DIGEST
- run: cosign sign --yes ghcr.io/org/payments@$DIGEST
```

Verify the same pins in the cluster:

```bash
cosign verify \
  --certificate-identity-regexp '^https://github.com/org/payments/.github/workflows/release\.yml@refs/tags/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  ghcr.io/org/payments@sha256:…
```

Failure mode: identity regexp `https://github.com/org/.*` so a compromised Actions workflow in `org/docs` can sign `payments`. Pin the workflow file and, if you use environments, the environment protection rules that gate `release.yml`.

Another failure: signing `:latest` by tag. Always sign the digest. Tags move; Rekor entries are per digest.

Keys still win when you cannot reach Fulcio/Rekor or cannot trust the public transparency log with your image names. That is the air-gap section, not a reason to skip identity pinning in SaaS CI.

## Rekor transparency

Rekor is an append-only log. A keyless signature that is not logged is not a Sigstore signature you should admit. Verification talks to Rekor (or uses a bundled proof) to check inclusion.

What that buys you: after a compromise, you can search the log for signatures from that identity in a window. What it does not buy you: confidentiality of image names if you leak them into public Rekor. Public-good Sigstore is public. If image names or repo names are sensitive, use a [private Sigstore](https://docs.sigstore.dev/system_config/private_instance/) or fall back to keys.

`cosign sign` can attach the signature to the registry (`application/vnd.dev.cosign.simplesigning.v1+json`) or you can keep signatures in Rekor-only workflows. Admission controllers typically want the registry attachment **or** a bundle they can fetch. Pick one and document it; mixed mode is how staging verifies and prod does not.

Failure mode: cluster nodes have no egress to `rekor.sigstore.dev` / `fulcio.sigstore.dev`. Verify then fails closed (good) or someone sets `COSIGN_EXPERIMENTAL` folklore flags to skip TLog (bad). If you skip the log, you are back to "trust this cert" without the property you adopted keyless for.

Clock skew: Fulcio certs are short-lived. Nodes more than a few minutes off will fail verify. NTP is a supply-chain control here.

## Kyverno/VAP verify

**Kyverno** `verifyImages` (or the Sigstore **policy-controller**) is the usual admit path. They fetch the signature, check Rekor, and match identity/issuer.

Sketch (Kyverno cluster policy idea—keep the actual CRD in git):

- Match `Pod` / `Deployment` in `prod`
- `verifyImages` with `attestors` that pin the GitHub issuer and identity regexp
- `mutateDigest: true` so the cluster stores the digest you verified
- Fail closed: `validationFailureAction: Enforce` in prod, Audit in a bake-in namespace

**ValidatingAdmissionPolicy** cannot implement Sigstore verify. CEL does not call Rekor. Use VAP for cheap checks (required labels, deny `:latest`) and Kyverno/policy-controller for signatures. Stacking both is fine; duplicating signature logic in a homemade webhook is how you drift from Cosign's verifier.

RBAC: the admission controller's SA needs get on the resources it mutates, not cluster-admin. A policy-controller with `cluster-admin` is a [Kubernetes RBAC](/blog/kubernetes-rbac-security-best-practices/) incident, not a Sigstore feature.

Failure mode: Enforce on `Pod` but Helm creates `CronJob` / `Job` that bypasses the match. Match all pod-controller kinds you actually use. Failure mode: `imagePullPolicy: Always` with a tag; you verified a digest on create, then the tag moved. Mutate to digest at admit.

Unsigned cluster add-ons (CNI, CSI) need an allow-list of namespaces or image prefixes. A global "all images signed by payments-release.yml" will brick kube-system. Document the allow-list like an exception with an owner.

## Air-gap limits

Keyless **public-good** Sigstore needs:

- Egress from CI to Fulcio and Rekor at **sign** time
- Egress from the admission controller to Rekor (and often Fulcio) at **verify** time, unless you use offline bundles consistently

Disconnected clusters: run a private Fulcio + Rekor, or use **key-based** Cosign with the public key in a sealed Secret / external secret. Do not "keyless" by disabling TLog verification.

Other limits:

- GitHub OIDC is useless on a Jenkins that only has a static cloud key unless you federate that identity into something Fulcio accepts
- Rekor availability is an admission dependency; budget for Sigstore incident response (fail closed vs emergency unsigned allow-list with a ticket)
- Mirror registries must copy **signatures and attestations**, not only the image layers. `cosign copy` exists because `docker pull | docker push` drops them

## Checklist

- [ ] Sign digests in the release workflow with `id-token: write`, not a stored `COSIGN_KEY`
- [ ] Verify pins workflow identity **and** OIDC issuer, not the whole GitHub org
- [ ] Kyverno or policy-controller Enforce in prod; VAP only for non-Sigstore rules
- [ ] kube-system / CNI images on an owned allow-list
- [ ] Registry copy includes signatures; nodes have NTP
- [ ] Air-gap plan is private Sigstore or keys—not skip-TLog

**Related:** [Cloud-native application security](/blog/cloud-native-application-security/) · [Kubernetes RBAC security](/blog/kubernetes-rbac-security-best-practices/)
