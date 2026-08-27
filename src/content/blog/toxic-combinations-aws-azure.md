---
title: "Toxic Combinations in AWS and Azure: When Low-Risk Findings Become Critical"
description: "Learn what toxic combination cloud security means in AWS and Azure — misconfiguration pairs that create real attack paths, and how security graphs detect them."
author: OpenSourceOM Team
tags:
  - toxic combination
  - AWS security
  - Azure security
  - cloud misconfiguration
  - attack path analysis
focusKeyword: toxic combination cloud security
faq:
  - question: What is a toxic combination in cloud security?
    answer: A toxic combination is two or more low-or-medium severity findings that together create an exploitable attack path — for example, internet exposure plus an over-privileged IAM role reachable from that workload.
  - question: What are common AWS security misconfiguration toxic combinations?
    answer: Common pairs include public S3 buckets with sensitive data, internet-facing EC2 with instance profiles that can assume admin roles, and security groups allowing 0.0.0.0/0 to management ports.
  - question: How do you detect toxic combinations automatically?
    answer: Security graph and CNAPP platforms correlate posture, identity, and vulnerability findings to surface multi-step paths instead of isolated alerts.
---

In cloud security, the dangerous issues are often **pairs and chains** — not single misconfigurations. A medium-severity setting plus a high-privilege identity plus internet exposure becomes a **toxic combination**: individually defensible in a ticket comment, collectively exploitable in an afternoon.

**Toxic combination cloud security** is the **named pairs** in AWS and Azure (public + admin, and so on). How you rank a full finding queue is [how to prioritize cloud vulnerabilities](/blog/how-to-prioritize-cloud-vulnerabilities/). How the graph represents hops is [attack path analysis](/blog/attack-path-analysis-cloud-security/).

## What makes a combination "toxic"?

A combination is **toxic** when:

1. **Two or more findings** are low or medium in isolation
2. **Together** they form a complete or partial **attack path**
3. **Impact** reaches sensitive data, admin control, or lateral movement

Example:

| Finding alone | Severity alone | Combined |
|---------------|----------------|----------|
| EC2 with outdated package | Medium | — |
| EC2 internet-facing | Medium | **Critical path** |
| Instance profile with S3 read on prod bucket | High if seen with EC2 | **Data exfiltration path** |

## Toxic combinations in AWS

### 1. Internet exposure + IAM instance profile

**Pattern:**

- Security group allows `0.0.0.0/0` on 443 or 22
- EC2 has IMDSv1 enabled or SSRF-vulnerable app
- Instance profile can `s3:GetObject` on `*` or assume powerful role

**Why toxic:** Remote code execution or credential theft → immediate cloud API access.

**Fix:** Restrict SG, enforce IMDSv2, scope instance profile to least privilege.

### 2. Public S3 + sensitive data classification

**Pattern:**

- Bucket ACL/policy allows public read or list
- Objects tagged or scanned as PII/financial data

**Why toxic:** Direct data breach without lateral movement.

**Fix:** Block public access at account level; encrypt and classify data.

### 3. Lambda URL / API Gateway + over-privileged execution role

**Pattern:**

- Public function URL or unauthenticated API stage
- Execution role includes `dynamodb:*`, `secretsmanager:GetSecretValue`, or cross-account assume

**Why toxic:** Serverless entry points are easy to miss in CSPM sweeps.

**Fix:** Authenticate ingress; shrink execution role.

### 4. Cross-account role trust + external compromise

**Pattern:**

- Role trusts entire external account or `*` principal
- Role has admin or data access in your account

**Why toxic:** Supply-chain or partner account breach becomes your breach.

**Fix:** External ID, strict principal ARNs, least privilege.

### 5. EKS public endpoint + weak RBAC

**Pattern:**

- Cluster API publicly reachable
- `system:masters` or cluster-admin bound to broad groups

**Why toxic:** Kubernetes control plane becomes internet attack surface.

**Fix:** Private endpoint, IP allowlists, tighten RBAC.

## Toxic combinations in Azure

### 1. Storage account public blob + confidential containers

**Pattern:**

- Anonymous blob access enabled
- Containers hold backups or exports with credentials

**Fix:** Disable anonymous access; use private endpoints.

### 2. NSG allowing RDP/SSH from Internet + managed identity

**Pattern:**

- NSG rule `Internet → 3389/22`
- VM managed identity has Key Vault secrets read or SQL admin

**Fix:** Just-in-time access, bastion hosts, scope identities.

### 3. Over-permissive service principal + exposed app registration

**Pattern:**

- App registration secret in repo or logs
- SP has `Contributor` or `User Access Administrator` on subscription

**Fix:** Certificate auth, conditional access, role reduction.

### 4. Azure AD role + weak conditional access

**Pattern:**

- Global Reader or Helpdesk admin with password reset rights
- No MFA for privileged roles from untrusted locations

**Fix:** Privileged Identity Management (PIM), MFA, CA policies.

### 5. App Service public + connection string in app settings

**Pattern:**

- `*.azurewebsites.net` reachable
- SQL connection string with db admin in configuration

**Fix:** Private Link, Key Vault references, managed identity to SQL.

## AWS security misconfiguration vs. toxic combination

| Single misconfiguration | Often rated | Toxic when paired with |
|-------------------------|-------------|-------------------------|
| Open port 443 to world | Medium | Known RCE CVE on service |
| Unused IAM user with keys | Low | Keys in public GitHub repo |
| VPC flow logs disabled | Low | Active data exfil you cannot see |
| Encryption off on disk | Medium | Snapshot shared to external account |

CSPM flags the left column. **Attack path analysis** flags the row.

## How security graphs detect toxic combinations

Graph platforms model:

```
[Internet] --REACHABLE--> [VM + CVE] --ASSUMES--> [Role] --CAN_ACCESS--> [Datastore]
```

**Toxic combination cloud security** rules are graph patterns:

- `internet_exposed AND critical_cve AND path_to_datastore`
- `public_storage AND sensitive_tag`
- `admin_role AND assumable_from_external_account`

[OpenSourceOM](/docs/the-graph/) targets queryable patterns like these in an open, self-hosted graph.

## Prioritization playbook

1. **List all internet-exposed assets** (CSPM)
2. **Attach identities** each asset can use (CIEM)
3. **Overlay vulnerabilities** (CWPP/scanner)
4. **Run path queries** to sensitive data
5. **Remediate combinations** — break any edge in the path

One broken edge (remove exposure, patch, or shrink role) collapses the chain.

## Prevention: shift-left and guardrails

- **IaC policies** — block `0.0.0.0/0` on admin ports in CI
- **Account guardrails** — S3 Block Public Access, Azure Policy
- **Identity boundaries** — permission sets per environment
- **Graph continuous monitoring** — drift breaks old assumptions daily

## Key takeaways

- **Toxic combinations** turn medium findings into critical breach paths
- **AWS security misconfiguration** and Azure posture issues matter most in **pairs**
- CNAPP and **security graph** tools exist to find combinations, not just singles
- Fix paths, not just tickets — break reachability, identity, or vulnerability links

---

**Related:** [How to prioritize cloud vulnerabilities](/blog/how-to-prioritize-cloud-vulnerabilities/) · [CIEM explained](/blog/ciem-explained-for-cloud-teams/)
