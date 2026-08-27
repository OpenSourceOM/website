---
title: "OpenTofu vs Terraform for Security Teams"
description: "OpenTofu vs Terraform for security: MPL versus BSL, signed providers and lockfiles, state compatibility, and which policy-as-code options survive the fork."
pubDate: 2026-08-27
updatedDate: 2026-08-27
author: OpenSourceOM Team
tags:
  - OpenTofu
  - Terraform
  - supply chain
  - policy as code
  - IaC
focusKeyword: OpenTofu vs Terraform security
faq:
  - question: Is OpenTofu more secure than Terraform because it is MPL?
    answer: >-
      The license changes who can fork and embed the tool, not whether your
      state bucket is public. MPL reduces vendor-lock and binary-source risk
      for the CLI. Providers, backends, and IAM are the same classes of bug
      on both. Do not switch licenses to skip S3 BPA.
  - question: Can I point OpenTofu at existing Terraform state in S3?
    answer: >-
      Often yes for state file format around the 1.x lineage, but you must
      pin versions, never dual-apply, and test `tofu plan` with no changes
      in a clone of prod state first. Provider protocol drift and encryption
      of state are the usual breakages, not the HCL dialect.
  - question: Does Sentinel work with OpenTofu?
    answer: >-
      HashiCorp Sentinel is tied to Terraform Cloud/Enterprise. OpenTofu
      stacks use OPA/Conftest, tfsec/Checkov, or Terraform-compatible policy
      tools that read the plan JSON. If your control library is Sentinel-only,
      that is a product dependency, not an OpenTofu bug.
---

Legal asked whether the BSL blocked the next vendor. Engineering asked whether `.terraform.lock.hcl` still pinned hashes. **OpenTofu vs Terraform security** is those two questions, plus state, plus which policy engine still runs on `tofu plan -out`.

Neither CLI will save a world-readable state object. S3 Block Public Access, KMS, and who can `GetObject` the state key are [AWS account controls](/blog/aws-security-best-practices-2026/), not a reason to pick a fork.

```
tofu / terraform CLI
    → providers (registry + lockfile hashes)
        → plan JSON
            → OPA / Conftest / TFC Sentinel
                → apply → state
```

## License and supply chain

Terraform’s BSL (and HashiCorp’s later license moves) restrict *competitive* hosted offerings. They do not magically sign your providers. OpenTofu’s MPL 2.0 is the Linux Foundation fork: you can embed, fork, and ship the CLI without asking HashiCorp.

What a security team should actually inventory:

| Artifact | Terraform | OpenTofu |
| --- | --- | --- |
| CLI binary origin | HashiCorp releases | OpenTofu GitHub releases / distro packages |
| Signature | HashiCorp GPG / their current signing | OpenTofu release signatures — **verify both**, do not assume |
| Registry | registry.terraform.io | registry.opentofu.org (can still use many TF providers) |
| License of *providers* | Each provider’s own license | Unchanged — AWS provider is still MPL from HashiCorp |

The CLI license is not the AWS provider license. You can run `tofu` and still download `hashicorp/aws`. That is a supply-chain **choice**: you now trust OpenTofu’s CLI *and* HashiCorp’s provider, or you pin an OpenTofu-forked provider if one exists.

Verify what you run:

```bash
# Example: do not curl | sh
gpg --verify tofu_*.sig tofu_*
sha256sum -c tofu_SHA256SUMS
```

CI should install a **pinned version** (`1.8.x`) from a checksum in *your* repo, not `latest`. The same rule applied to `terraform` last year; the fork does not relax it.

Where binaries come from in GitHub Actions: a marketplace action that wraps `tofu` is another publisher. Prefer `gh release download` from `opentofu/opentofu` with checksums in your workflow, or an internal mirror.

OpenSSF Scorecard on the CLI repo is useful. It does not score the AWS provider. Scan both.

If the reason to switch is “we cannot use BSL in this jurisdiction,” that is a legal control. Implement it as “CI fails if `terraform` binary is present,” not as a wiki sentence.

## Provider pin and lockfiles

`.terraform.lock.hcl` (OpenTofu uses the same idea) records **provider version + hashes per platform**. A plan without a committed lockfile is how you get a different `hashicorp/aws` on Monday’s runner.

```hcl
terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.80"
    }
  }
}
```

```bash
tofu init -lockfile=readonly   # CI: fail if someone changed hashes without a PR
tofu providers lock -platform=linux_amd64 -platform=darwin_arm64
```

`required_version` for OpenTofu is the **OpenTofu** version. Mixing `terraform 1.9` locally and `tofu 1.8` in CI is how you get state serial surprises. Pick one CLI in the repo (`mise.toml` / `.tool-versions` / Docker image digest).

Registry substitution: if you set `provider_installation` to a network mirror, you own that mirror’s integrity. An internal Artifactory that proxies `registry.terraform.io` without checksum verification is a MITM you built.

`FOO_PLUGIN_CACHE` on a shared GitHub runner can mix providers across jobs. Disable the cache or namespace it.

Malicious provider: a typo `hashicrop/aws` in `required_providers`. The lockfile hash will still pin *that* evil package. CODEOWNERS on `*.tf` and the lockfile; `tflint` for unknown sources.

## State compatibility

State is JSON with a serial and a `terraform_version` field. OpenTofu 1.6+ aimed at Terraform 1.6-era compatibility. That is not a promise that `tofu apply` on a 1.9 Terraform Cloud workspace is safe.

Rules:

1. **One writer.** Never `terraform apply` and `tofu apply` on the same S3 key.
2. **Clone first.** `aws s3 cp` the state to a sandbox bucket, point a backend override, `tofu plan`. Empty diff or you stop.
3. **Read the version field.** If state says `1.9.0` and your tofu is `1.6.2`, upgrade tofu or do not migrate.
4. **Encrypted state / S3 native lockfile.** Test both; fork timing differs.
5. **Terraform Cloud remote backend.** OpenTofu does not replace TFC’s API. Leaving TFC is a migration, not a binary swap.

`terraform state replace-provider` and moved blocks: run them with the same CLI that wrote the state.

Downgrade is how you corrupt state. The security impact is an outage plus a panicked `state pull` emailed to Slack — which is a secret incident. Migration runbooks belong in the same change window as a database upgrade.

Workspaces, `cloud` blocks, and `backend "remote"` are HashiCorp product surfaces. OpenTofu’s equivalent is your S3/GCS/Azurerm backend. If the reason you stayed on Terraform was TFC policy + VCS, switching CLI without replacing those controls drops Sentinel on the floor (next section).

## Policy as code options

| Control | Terraform Cloud/Enterprise | OpenTofu / OSS Terraform |
| --- | --- | --- |
| Sentinel | Native | Not available |
| OPA on plan JSON | Possible via extra pipeline | **Primary** path |
| Conftest | Same | Same |
| Checkov / tfsec / Trivy config | Same | Same |
| Provider-level IAM | Unrelated to CLI | Unrelated |

`tofu plan -out=tfplan && tofu show -json tfplan > plan.json` is the artifact OPA wants. Write policies against `resource_changes` (no public S3, no `0.0.0.0/0` on 22). That library ports.

Sentinel `mandatory` policies that exist only in TFC are the lock-in. Export them to OPA **before** you drop TFC, or you will apply a public bucket on day two.

Hook-style preventive controls in AWS (SCPs, CloudFormation Hooks) still apply to what either CLI submits. The CLI brand does not bypass an SCP. If you use Hooks, they fire on CloudFormation, not on the Terraform AWS provider’s API calls — different plane. For Terraform/OpenTofu, preventive means **plan policy + IAM on the apply role + SCPs**.

Open Policy Agent in CI is fail-closed: no plan JSON, no apply. Do not run Checkov `soft fail` on the same repo that you claimed was Sentinel-mandatory last month.

## Checklist

- [ ] One CLI pinned (version + checksum) in CI; lockfile committed; `-lockfile=readonly` on init
- [ ] Provider sources reviewed; no typo-squats; hashes for linux_amd64 (and whatever CI uses)
- [ ] State: single writer; migration tested on a copy; no dual Terraform/OpenTofu apply
- [ ] Sentinel policies inventoried; OPA/Conftest equivalents merged before leaving TFC
- [ ] Release signatures verified; no `curl | bash` for tofu or terraform
- [ ] Apply IAM role still least privilege; license change did not expand `s3:*`

Pick OpenTofu when the **license and CLI supply chain** are the requirement. Keep Terraform when TFC Sentinel and remote state are the control plane you already audit. Either way, the state file and the apply role are the crown jewels — the binary name on the runner is the smaller part of [AWS account hardening](/blog/aws-security-best-practices-2026/).
