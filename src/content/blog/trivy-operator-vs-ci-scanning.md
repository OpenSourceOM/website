---
title: "Trivy Operator vs CI Image Scanning"
description: "CI image scans miss cluster drift; Trivy Operator misses the build. When the two overlap, how to dedupe CVEs, and when running both is the right call."
pubDate: 2026-08-27
updatedDate: 2026-08-27
author: OpenSourceOM Team
tags:
  - Trivy
  - Kubernetes
  - container scanning
  - CI/CD
  - CNAPP
focusKeyword: Trivy Operator vs CI scanning
faq:
  - question: Can I turn off CI scanning if Trivy Operator is in every cluster?
    answer: >-
      No. The operator sees what is running, after the image is already on a
      node. CI is the only cheap place to fail a pull request before the digest
      is tagged :prod. Operator-only programs learn about CRITICAL CVEs when
      the ReplicaSet is already at 12.
  - question: Can I skip the operator if every image is scanned in GitHub Actions?
    answer: >-
      Only if you also ban kubectl run, debug containers, third-party Helm
      charts, and cluster add-ons that pull images you never built. You do not
      have that ban. The operator exists for those images and for NVD drops
      that happen after the last green pipeline.
  - question: Why do I get the same CVE twice with different severity?
    answer: >-
      Different Trivy DB dates, different scanners (CI pin vs operator
      auto-update), and different ignore files. Deduplicate on image digest plus
      CVE id, not on ticket title. Pick one DB freshness SLA and one ignore
      source of truth.
  - question: Should operator findings page the on-call?
    answer: >-
      Page only when the workload is internet-facing or sits on a path to data,
      and the CVE is in CISA KEV or has a working exploit. A new CRITICAL on an
      internal job with no egress is a backlog item. Ranking is the same
      problem as any other scanner flood.
---

The image was clean in GitHub Actions on Monday. Thursday, the same digest is still running, and NVD published a CRITICAL on Wednesday. CI will not notice until someone rebuilds. **Trivy Operator vs CI scanning** is that timing gap, not a brand preference.

This is the decision: where Trivy runs, what each miss looks like, how duplicate CVEs happen, and when both are required. It is not a generic "scan all the containers" lecture and not a pipeline-only how-to. Image and admission patterns sit in [cloud-native application security](/blog/cloud-native-application-security/).

```
git push
  → CI: trivy image $DIGEST     fail the PR
       → registry
            → kubelet pull
                 → Trivy Operator   VulnerabilityReport on the owner
```

If either arrow is missing, you have a story, not coverage.

## CI catches build

Pipeline Trivy runs against a **digest you just built** (or a base you just bumped). That is the right place to:

- Fail the PR on `CRITICAL`/`HIGH` you have not ignored
- Scan the Dockerfile filesystem and the image, not only the lockfile
- Keep `.trivyignore` next to the app so ignores are reviewed like code

```yaml
# GitHub Actions — pin the scanner and fail closed
- uses: aquasecurity/trivy-action@0.28.0
  with:
    image-ref: ghcr.io/org/payments@${{ steps.build.outputs.digest }}
    exit-code: "1"
    severity: CRITICAL,HIGH
    ignore-unfixed: true
```

Pin the action and, if you can, the DB. `trivy image` with a floating `latest` action plus a DB that updated mid-sprint is how Monday's green build becomes Tuesday's red rebuild with no code change. That can be desirable (new CVE) or noise (parser false positive). Decide which, in the workflow comment.

What CI **cannot** see:

- Images that never pass this workflow: Bitnami charts, cluster autoscaler, a debug `kubectl run --image=nocolor/ubuntu`
- Config and RBAC inside the cluster (Trivy can scan YAML in CI if you render Helm; most teams only scan the app image)
- A digest that was allowed last month and never rebuilt

Failure mode: CI scans `tag: main` while production runs `tag: v1.4.2` from a different digest. Scan the digest the deploy job will pin. If the deploy job retags, scan after retag.

## Operator catches drift in cluster

[Trivy Operator](https://github.com/aquasecurity/trivy-operator) watches workloads and writes `VulnerabilityReport`, `ConfigAuditReport`, and friends as Kubernetes objects. It answers: **what is running right now**, including images you did not build.

Install it in a dedicated namespace, give it only the RBAC it needs, and point reports at a collector (or scrape them). Scan interval and `scanJobTTL` matter: too aggressive and you melt the API server with Jobs; too slow and Thursday's CVE waits until next Tuesday.

```bash
kubectl get vulnerabilityreports -A \
  -o jsonpath='{range .items[*]}{.metadata.namespace}{" "}{.metadata.labels.trivy-operator\.resource\.name}{" "}{.report.summary.criticalCount}{"\n"}{end}'
```

Drift the operator is for:

- A Helm upgrade that changed the image without a CI rebuild of *your* app
- Sidecars and init containers added by a mutating webhook
- NVD/GHSA updates against an old digest that is still `Running`

Failure mode: Operator in `dev` only. Prod is "too sensitive for extra Jobs." Then prod is the cluster where you need the report. Run the operator where the blast radius is, with resource quotas on the scan Jobs.

The operator is not a substitute for admission. A `VulnerabilityReport` with `criticalCount: 4` on a running Deployment means the image was **admitted**. Pair with Kyverno/VAP if you want to block unsigned or unscanned digests at create time—that is still [application security](/blog/cloud-native-application-security/), not this decision.

## Duplicate CVEs

Same digest, two tickets, two severities, two ignore lists.

| Cause | What you see | Fix |
| --- | --- | --- |
| Different DB age | CI HIGH, operator CRITICAL a day later | One freshness SLA; reopen on digest+CVE when severity jumps |
| `.trivyignore` only in the app repo | CI silent, operator loud | Mount the same ignore ConfigMap **or** do not ignore in-cluster |
| OS vs library classifiers | `debian` vs `python` package names | Dedupe on CVE id + digest, not package string |
| Tag vs digest | CI scanned `:latest`, operator scanned yesterday's `:latest` | Dedupe on digest only |

Ticket key: `sha256:abc… + CVE-2026-…`. Anything else double-counts.

Do not auto-close the operator finding when CI is green on a **different** digest. That is how a sidecar stays vulnerable forever.

For ranking, a duplicate CRITICAL on an isolated CronJob is still one finding. An internet-facing Service plus that CVE is a path—use [prioritization](/blog/how-to-prioritize-cloud-vulnerabilities/), not whichever scanner shouted last.

## When to run both

Run **both** when any of these are true (they usually are):

1. Developers merge app images through CI **and** the cluster runs third-party images.
2. Production digests live longer than your patch SLA (almost always).
3. You need ConfigAudit / RBAC reports from the operator that CI never rendered.

Run **CI only** if the cluster is a sealed appliance: every image is built in this pipeline, admission denies everything else, and you rebuild on a timer when the DB moves. That is a lab or a tightly GitOps'd fleet, not a typical shared platform.

Run **operator only** if you do not control the build (ISV images, inherited platform). You still want a registry scan on ingest if you can; operator is the backstop.

Hybrid wiring that does not melt Slack:

- CI: fail PR on CRITICAL for **app** images; do not Slack the same CVE from the operator for that digest for 24 hours
- Operator: alert on **new** CRITICAL on a digest with no CI ticket, or on any CRITICAL on a namespace labeled `internet-facing=true`
- Weekly: join reports on digest; file one owner per image, not per scanner

## Checklist

- [ ] CI scans the digest the deploy job pins, not a moving tag
- [ ] Trivy action/DB pin is documented; ignore file lives with the app
- [ ] Operator runs in prod, with quotas on scan Jobs
- [ ] Tickets dedupe on `digest + CVE`, one ignore source of truth
- [ ] Operator alerts filtered by exposure, not raw criticalCount
- [ ] Third-party and sidecar images have an owner or an admission deny

**Related:** [Cloud-native application security](/blog/cloud-native-application-security/) · [How to prioritize cloud vulnerabilities](/blog/how-to-prioritize-cloud-vulnerabilities/)
