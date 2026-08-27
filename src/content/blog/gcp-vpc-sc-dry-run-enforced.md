---
title: "VPC Service Controls: Dry-Run Then Enforce"
description: "Operator sequence for VPC Service Controls: perimeter vs IAM, dry-run logs, Cloud Build false positives, then a staged enforce. This is not a WAF."
pubDate: 2026-08-27
updatedDate: 2026-08-27
author: OpenSourceOM Team
tags:
  - GCP
  - VPC Service Controls
  - dry-run
  - data perimeter
  - Cloud Build
focusKeyword: VPC Service Controls dry-run
faq:
  - question: Does VPC-SC dry-run block any API calls?
    answer: >-
      No. Dry-run evaluates the intended perimeter and writes violations
      to Cloud Logging. The request still succeeds if IAM allows it.
      Enforce is a separate config; flipping it without a clean dry-run
      week is how you freeze Cloud Build and Terraform on the same
      afternoon.
  - question: Is VPC Service Controls a WAF?
    answer: >-
      No. Cloud Armor inspects HTTP(S) at a load balancer. VPC-SC
      restricts which identities and networks may call Google APIs
      (Storage, BigQuery, GKE, …) for resources inside a perimeter.
      You can have Armor on a public frontend and still leak data
      through the Storage JSON API if the perimeter is missing.
      See [Cloud Armor](/blog/gcp-cloud-armor-security-guide/).
  - question: Why did Cloud Build show dry-run hits when our GCE VMs did not?
    answer: >-
      Cloud Build often uses a service account and worker identity in
      a Google-managed or separate project, plus Artifact Registry,
      Logging, and Source in other projects. Those hops are ingress
      or egress across the perimeter. VMs using a VM SA inside the
      perimeter already match an access level you forgot to grant
      to Cloud Build.
  - question: Should I enforce the org on day one?
    answer: >-
      No. Enforce a canary project (or a small perimeter) whose
      dry-run has been clean, then add projects. Org-wide enforce
      with an incomplete egress policy is a company-wide API outage
      with a data-protection headline.
---

VPC Service Controls (VPC-SC) fail closed on **Google API** paths when enforced: the Storage JSON API, BigQuery, Secret Manager, not the HTTP path in front of Cloud Run. Teams skip dry-run, enforce a perimeter that looks like the architecture diagram, and spend the night adding ingress policies for Cloud Build. This page is only the **dry-run → enforce** sequence. It is not a product explainer and not [Cloud Armor](/blog/gcp-cloud-armor-security-guide/) (Armor is a WAF on a load balancer; VPC-SC is not).

Reference: [VPC-SC dry-run](https://cloud.google.com/vpc-service-controls/docs/dry-run-mode).

## Perimeter vs IAM

IAM says whether `serviceAccount:X` may `storage.objects.get` on a bucket. A perimeter says whether that call is allowed **from this network / identity context** when the bucket is in a restricted service perimeter.

```
Caller (VM SA, user, Cloud Build SA)
  → IAM allow/deny          (can they call this method?)
  → VPC-SC perimeter        (are they inside / granted ingress / egress?)
  → API
```

Both must pass once you enforce. IAM-only “success” in dry-run still logs a VPC-SC dry-run violation. That log is the work queue.

```bash
gcloud access-context-manager perimeters describe "${PERIMETER}" \
  --policy="${AC_POLICY}"
```

Look at `status` (enforced) vs `spec` (dry-run intended). Mixing them up is how you think you are in dry-run while `status` already restricts Storage.

Failure mode: perimeter includes `storage.googleapis.com` but the data actually moves through `bigquery.googleapis.com` export jobs. Dry-run on Storage stays quiet; BigQuery dry-run screams after you add it. Restricted services list must match **how** you copy data, not only the bucket.

## Dry-run logs

Enable dry-run on the perimeter (`spec` populated, `status` empty or strictly smaller). Then:

```bash
gcloud logging read \
  'protoPayload.metadata.dryRun="true" AND protoPayload.status.details.violations.typ:"vpcServiceControls"' \
  --project="${PROJECT_ID}" --limit=50 --format=json
```

Use Google’s current log filter if the field path has moved; the idea is **`dryRun` true** plus VPC-SC violation metadata. Export to a log sink in the security project so you are not paging through one app project.

Each hit should answer:

| Field | Why you care |
| --- | --- |
| `principalEmail` | Cloud Build SA vs user vs GCE SA |
| `methodName` | `storage.objects.get` vs `bigquery.jobs.create` |
| `vpcServiceControlsUniqueId` / perimeter name | Which perimeter |
| Network / device / access level | Missing access level vs missing ingress from a project |

Failure mode: looking only at the application project. Cloud Build’s SA lives in the Cloud Build service project or `PROJECT_NUMBER@cloudbuild.gserviceaccount.com` with workers elsewhere. Query org-level aggregated sinks or every project in the perimeter.

Failure mode: dry-run logs empty because Audit Logs for Policy Denied are not enabled. Turn on the VPC-SC / Policy Denied audit type; otherwise you will enforce blind.

## Common false positives (Cloud Build)

These look like attackers in the log and are usually pipeline design:

1. **Cloud Build SA not in the perimeter** and not granted **ingress** from the Build project into Storage/Artifact Registry in the perimeter.
2. **Default Compute SA** on an old Build config (`gcloud builds submit` without a custom SA).
3. **Private worker pool** in a project outside the perimeter; workers call APIs as an identity that has no access level.
4. **GitHub / Cloud Source** fetch: egress to `*.source.developers.google.com` or GitHub if you did not allow it.
5. **Container Analysis / Artifact Registry** in a shared project: extra restricted services and egress.
6. **Terraform** using a SA from the CI project to touch org-level IAM (often should stay **out** of the data perimeter, not be jammed in).

```bash
# Who is this Build SA?
gcloud builds describe "${BUILD_ID}" --project="${BUILD_PROJECT}" \
  --format="yaml(serviceAccount,options.logStreamingOption)"
```

Fixes that belong in **dry-run config**, not in “disable VPC-SC”:

- Ingress policy: source = Cloud Build project / SA, target = Artifact Registry + Logging + Storage in the perimeter.
- Access level: identity include the Build SA (still IAM-scoped).
- Move the Build SA into a project **inside** the perimeter if that matches the trust model.
- Dedicated Build SA with WIF from GitHub—not the default Compute SA.

Do not “fix” dry-run by removing `storage.googleapis.com` from restricted services. That is turning the perimeter into a drawing.

IAM still matters: an ingress policy does not grant `roles/storage.objectAdmin`. You will get IAM 403 after VPC-SC is happy. That is expected sequencing, not a VPC-SC bug.

## Enforce sequence

1. Draw restricted services from **actual** APIs in dry-run, not from a slide (Storage, BigQuery, GKE, Secret Manager, …).
2. Put the same intended rules in `spec` (dry-run). Leave `status` unset.
3. Aggregate dry-run logs **org-wide** for 7–14 days, including Cloud Build and Terraform.
4. Add access levels, ingress, and egress until remaining hits are real (user from home Wi-Fi to BigQuery) or accepted exceptions with owners.
5. **Canary enforce:** copy `spec` → `status` for **one** low-traffic project (or a dedicated canary perimeter). Watch error budgets for 48 hours.
6. Expand project list. Do not jump to all prod projects on a Friday.
7. Keep a change freeze playbook: revert `status` to empty if Build is down; that is faster than inventing ingress under pages.

```bash
gcloud access-context-manager perimeters update "${PERIMETER}" \
  --policy="${AC_POLICY}" \
  --set-enforced-service=storage.googleapis.com \
  # ... only after dry-run is clean; prefer full YAML apply from git
```

Prefer applying a reviewed YAML perimeter (same file that was dry-run) over clicking services in the console.

After enforce, IAM allow plus a hole in egress is still exfil. Graph that as a path ([attack path analysis](/blog/attack-path-analysis-cloud-security/)). VPC-SC is the API perimeter; it does not replace Armor on the HTTP frontend and it does not replace IAM.

## Checklist

- [ ] `spec` (dry-run) and `status` (enforce) understood; not accidentally enforcing early
- [ ] Policy Denied / VPC-SC audit logs on; org sink collecting dry-run hits
- [ ] Cloud Build SA, worker pool project, Artifact Registry, Logging listed in the dry-run review
- [ ] Ingress/egress policies written for Build—not restricted services deleted
- [ ] Canary project enforced first; 48h watch
- [ ] Revert plan: drop enforced config without a 20-step change request
- [ ] Armor still in front of public HTTP if you have a public app—this perimeter is not that WAF ([Cloud Armor](/blog/gcp-cloud-armor-security-guide/))

**Related:** [GCP Cloud Armor](/blog/gcp-cloud-armor-security-guide/) · [GCP IAM security hardening](/blog/gcp-iam-security-hardening/)
