#!/usr/bin/env node
import { writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTopicCatalog } from './blog-topic-catalog.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BLOG_DIR = join(__dirname, '../src/content/blog');

const countArg = process.argv.find((a) => a.startsWith('--count='));
const TARGET_NEW = countArg ? Number.parseInt(countArg.split('=')[1], 10) : 50;
const skipExisting = process.argv.includes('--skip-existing');

const PROTECTED = new Set([
  'cspm-vs-cnapp-whats-the-difference',
  'attack-path-analysis-cloud-security',
  'how-to-prioritize-cloud-vulnerabilities',
  'open-source-cspm-cnapp-tools-2026',
  'ciem-explained-for-cloud-teams',
  'toxic-combinations-aws-azure',
]);

const EXISTING_SLUGS = readdirSync(BLOG_DIR)
  .filter((f) => f.endsWith('.md'))
  .map((f) => f.replace(/\.md$/, ''));

function pickInternalLinks(count = 2) {
  const pool = EXISTING_SLUGS.filter((s) => !PROTECTED.has(s) || true);
  const all = [...new Set([...EXISTING_SLUGS])];
  const shuffled = all.sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

function yamlEscape(str) {
  return str.replace(/"/g, '\\"');
}

function wordCount(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

function buildFrontmatter(topic) {
  const faqYaml = topic.faq
    .map(
      (f) =>
        `  - question: ${f.question}\n    answer: ${f.answer}`
    )
    .join('\n');

  return `---
title: "${yamlEscape(topic.title)}"
description: "${yamlEscape(topic.description)}"
author: OpenSourceOM Team
noindex: true
tags:
${topic.tags.map((t) => `  - ${t}`).join('\n')}
focusKeyword: ${topic.focusKeyword}
faq:
${faqYaml}
---`;
}

function relatedBlock(slugs) {
  const labels = {
    'cspm-vs-cnapp-whats-the-difference': 'CSPM vs CNAPP',
    'attack-path-analysis-cloud-security': 'Attack path analysis',
    'how-to-prioritize-cloud-vulnerabilities': 'Prioritize cloud vulnerabilities',
    'open-source-cspm-cnapp-tools-2026': 'Open source CSPM and CNAPP tools',
    'ciem-explained-for-cloud-teams': 'CIEM explained',
    'toxic-combinations-aws-azure': 'Toxic combinations in AWS and Azure',
  };
  const links = slugs.map((s) => `[${labels[s] || s}](/blog/${s}/)`);
  return `\n**Related:** ${links.join(' · ')}\n`;
}

const TOPICS = [
  {
    slug: 'aws-security-best-practices-2026',
    title: 'AWS Security Best Practices: A Practitioner Checklist for 2026',
    description: 'Practical AWS security best practices for 2026 covering IAM, network segmentation, logging, encryption, and exposure reduction with CSPM-aligned controls teams can implement today.',
    tags: ['AWS', 'cloud security', 'CSPM', 'IAM', 'security best practices'],
    focusKeyword: 'AWS security best practices',
    faq: [
      { question: 'What are the top AWS security priorities for new teams?', answer: 'Start with root account lockdown, MFA on privileged users, CloudTrail organization-wide, SCP guardrails, and eliminating public S3 and security group exposure before advanced tooling.' },
      { question: 'How often should AWS security posture be reviewed?', answer: 'Continuous CSPM scanning is ideal; at minimum review IAM, exposure, and logging weekly and after every major infrastructure change or incident.' },
      { question: 'Does AWS Shared Responsibility mean AWS handles security?', answer: 'No. AWS secures the cloud; customers secure what they put in it—identity, configuration, data classification, and application code remain your responsibility.' },
    ],
    body: (links) => `AWS environments grow faster than security teams can manually audit them. **AWS security best practices** in 2026 still start with fundamentals—identity, exposure, logging, and encryption—but mature programs layer **CSPM**, **attack path analysis**, and automated remediation on top.

This checklist is for engineers and security leads who need actionable controls, not a generic compliance PDF.

## Identity and access management

IAM is the control plane for AWS. Most breaches involve abused credentials or over-privileged roles.

- **Eliminate long-lived access keys** for humans; use IAM Identity Center (SSO) with short-lived credentials
- **Enforce MFA** on all console users and privileged API access where supported
- **Apply least privilege** with permission boundaries and service control policies (SCPs)
- **Rotate and audit** machine credentials; prefer IRSA or instance profiles over static keys
- **Review trust policies** on roles—external ID and condition keys block confused-deputy issues

| IAM control | Why it matters |
|-------------|----------------|
| SCPs at org level | Prevent entire classes of misconfigurations |
| Permission boundaries | Cap maximum privilege for delegated admins |
| Access Analyzer | Surfaces unintended cross-account access |
| IAM Access Advisor | Shows unused permissions for right-sizing |

Over-privileged IAM is a common ingredient in [toxic combinations](/blog/toxic-combinations-aws-azure/)—pair IAM reviews with graph-based reachability, not spreadsheets alone.

## Network and exposure

Network misconfiguration is the fastest path from internet to data.

- **Default deny** security groups; document every 0.0.0.0/0 rule with owner and expiry
- **Segment** production, staging, and sandbox with separate VPCs or at least subnets and NACLs
- **Use VPC endpoints** for S3, DynamoDB, and STS to keep traffic off the public internet
- **Enable AWS Network Firewall or WAF** at ingress for internet-facing apps
- **Validate** with CSPM rules and external attack surface scans

Exposure reduction should precede CVE triage. A critical vulnerability on an unreachable instance is lower priority than a medium issue on an internet-facing path—see [how to prioritize cloud vulnerabilities](/blog/how-to-prioritize-cloud-vulnerabilities/).

## Logging, detection, and response

You cannot investigate what you never recorded.

- **Organization CloudTrail** in all regions to a dedicated security account
- **GuardDuty** with S3, EKS, and Malware Protection enabled where licensed
- **Config** recorders with conformance packs mapped to CIS or your internal baseline
- **Centralize logs** in a SIEM with retention aligned to compliance needs
- **Run tabletop exercises** on credential compromise and S3 public exposure scenarios

## Encryption and data protection

- **KMS CMKs** for S3, RDS, and EBS with key policies restricting admin roles
- **Block public access** on all S3 accounts via account-level settings
- **Enable Macie** or equivalent DSPM for sensitive data discovery in object stores
- **Secrets Manager or Parameter Store** instead of environment variables in plain text

## Operationalizing AWS security

Manual quarterly audits fail in elastic cloud. Automate:

1. **Continuous CSPM** against CIS AWS Foundations and custom policies
2. **Drift detection** on Terraform and CloudFormation stacks
3. **Attack path queries** for internet → workload → datastore chains
4. **Ticket integration** with severity driven by reachability, not CVSS alone

[OpenSourceOM](https://opensourceom.org) models AWS inventory, IAM relationships, and findings in a **security graph** so teams can ask which exposures sit on paths to production—without black-box scoring. The [core project on GitHub](https://github.com/OpenSourceOM/core) is Apache-2.0 for teams that need self-hosted CNAPP-style context.

## AWS security maturity stages

| Stage | Focus | Typical tooling |
|-------|-------|-----------------|
| Foundational | MFA, CloudTrail, public access blocks | Native AWS services |
| Managed | CSPM, Config conformance, GuardDuty | CSPM + SIEM |
| Optimized | Attack paths, CIEM, automated remediation | Graph-native CNAPP or OSS |

## Key takeaways

- **Identity and exposure** drive most real-world AWS incidents—prioritize them before tool sprawl
- **SCPs and permission boundaries** scale governance across many accounts
- **Continuous validation** beats annual audits; cloud drift is constant
- **Graph context** connects IAM, network, and findings the way attackers actually chain them

---${relatedBlock(links)}`,
  },
  {
    slug: 'azure-cspm-implementation-guide',
    title: 'Azure CSPM Implementation Guide: From Defender to Custom Policies',
    description: 'Step-by-step Azure CSPM implementation using Defender for Cloud, Azure Policy, and graph-based prioritization to reduce misconfiguration noise across subscriptions and tenants.',
    tags: ['Azure', 'CSPM', 'cloud security', 'Azure Policy', 'Defender for Cloud'],
    focusKeyword: 'Azure CSPM',
    faq: [
      { question: 'What is Azure CSPM?', answer: 'Azure CSPM continuously evaluates Azure resources against security baselines and regulatory frameworks, surfacing misconfigurations, identity risks, and compliance drift across subscriptions.' },
      { question: 'Is Microsoft Defender for Cloud the same as CSPM?', answer: 'Defender for Cloud includes CSPM capabilities (Secure Score, regulatory compliance) plus optional workload protection plans; CSPM specifically refers to posture and configuration assessment.' },
      { question: 'How do I reduce Azure CSPM alert fatigue?', answer: 'Use initiative assignments scoped by environment, exempt documented exceptions, and prioritize findings on attack paths to sensitive data rather than flat severity.' },
    ],
    body: (links) => `**Azure CSPM** helps teams discover misconfigurations across subscriptions before attackers do. Microsoft Defender for Cloud provides a strong native baseline, but mature programs combine **Azure Policy**, custom initiatives, and **attack path analysis** to focus remediation where it matters.

## Why Azure posture management is different

Azure spans RBAC, resource policies, network security groups, Private Link, Key Vault, and Entra ID—each with separate APIs and audit surfaces. Without CSPM, blind spots accumulate:

- Storage accounts with overly permissive network rules
- VMs with management ports exposed via NSGs
- Managed identities granted excessive roles at subscription scope
- Diagnostic settings missing on production resources

Standalone scanners list these in isolation. Effective **Azure CSPM** correlates them with identity and network reachability—similar to how [CIEM](/blog/ciem-explained-for-cloud-teams/) addresses permission risk.

## Phase 1: Enable native CSPM foundations

Start with Defender for Cloud free CSPM features:

1. **Enable Defender for Cloud** on all subscriptions in your tenant
2. **Turn on Microsoft cloud security benchmark (MCSB)** assessments
3. **Assign regulatory compliance standards** you actually audit against (SOC 2, PCI, CIS)
4. **Configure continuous export** of recommendations to Log Analytics or a SIEM
5. **Integrate with Azure Policy** for deny and deploy-if-not-exists effects

| Defender capability | CSPM value |
|--------------------|------------|
| Secure Score | Trending posture across subscriptions |
| Resource graph integration | Inventory-aware recommendations |
| Attack path analysis (Defender) | Prioritized chains to crown jewels |
| Governance rules | Auto-remediate select misconfigurations |

## Phase 2: Azure Policy as enforcement layer

Recommendations without enforcement regress quickly.

- **CIS Azure Foundations** initiative at management group level
- **Custom policies** for tagging, region allowlists, and SKU restrictions
- **Deny policies** for public IP on prod subnets where Private Link is mandatory
- **Exemption workflow** with expiry dates and ticket references

Document every exemption—exemptions without owners become permanent holes.

## Phase 3: Prioritize with graph context

Flat Secure Score improvements do not equal risk reduction. Ask:

- Which storage accounts are both **publicly reachable** and contain ** sensitive tags**?
- Which VMs have **critical CVEs** and **Managed Identity** roles that reach Key Vault?
- Which NSG rules create **lateral movement** paths between tiers?

These are [attack path analysis](/blog/attack-path-analysis-cloud-security/) questions. [OpenSourceOM](https://opensourceom.org) applies the same graph model across Azure, AWS, and GCP for teams avoiding proprietary CNAPP lock-in.

## Multi-subscription governance

| Pattern | Use when |
|---------|----------|
| Management groups | You have 10+ subscriptions |
| Landing zone (ALZ) | Greenfield enterprise Azure |
| Policy at root MG | Global guardrails (regions, SKUs) |
| Per-env initiatives | Dev relaxed, prod strict |

## Measuring Azure CSPM success

Track **exposure reduction** (internet-facing resources count), **mean time to remediate** critical path findings, and **repeat finding rate**—not raw recommendation count. A dropping Secure Score with fewer external entry points may be healthier than a high score with toxic combinations hiding in dev/test subscriptions promoted to prod.

## Integrating Azure CSPM with SIEM and SOAR

Export Defender recommendations and Azure Policy compliance states to Log Analytics or Microsoft Sentinel. Build analytics rules that fire when:

- A storage account becomes publicly accessible
- A new subscription lacks assigned regulatory initiatives within 24 hours
- Secure Score drops more than 10 points week-over-week in production management groups

SOAR playbooks can open tickets with **attack path context** attached—e.g. whether the flagged VM sits one hop from a Key Vault—so responders prioritize correctly on first touch.

## Key takeaways

- **Defender for Cloud** is the starting point; **Azure Policy** makes posture durable
- **Scope initiatives** by environment to avoid dev noise in prod dashboards
- **Prioritize by attack paths**, not recommendation volume
- **Open-source graph platforms** complement native Azure CSPM for multi-cloud teams

---${relatedBlock(links)}`,
  },
  {
    slug: 'gcp-iam-security-hardening',
    title: 'GCP IAM Security Hardening: Roles, Conditions, and Service Accounts',
    description: 'Harden GCP IAM with least-privilege roles, IAM Conditions, service account key elimination, and organization policies—aligned with CIEM and CSPM workflows for Google Cloud teams.',
    tags: ['GCP', 'IAM', 'CIEM', 'cloud security', 'Google Cloud'],
    focusKeyword: 'GCP IAM security',
    faq: [
      { question: 'Should I use basic roles in GCP?', answer: 'Avoid Owner, Editor, and Viewer for routine access. Prefer predefined or custom roles scoped to required permissions only.' },
      { question: 'How do I eliminate service account keys in GCP?', answer: 'Use Workload Identity Federation for external workloads, attached service accounts on GCE/GKE, and org policies that restrict key creation.' },
      { question: 'What are IAM Conditions in GCP?', answer: 'IAM Conditions add attribute-based constraints—time, resource name, IP—to bindings so access is granted only when context matches policy.' },
    ],
    body: (links) => `**GCP IAM security** failures rarely look like exotic zero-days. They look like a service account key in a repo, a project-level Owner binding, or a custom role with \`resourcemanager.projects.setIamPolicy\`. Google Cloud's IAM model is powerful but easy to over-provision without **CIEM** discipline and continuous audit.

## Understand GCP IAM layers

IAM bindings attach **roles** to **members** (users, groups, service accounts) at organization, folder, or project scope. Inheritance flows down— a folder-level Editor affects every project beneath it.

| Layer | Typical mistake |
|-------|-----------------|
| Organization | Stale group with org-level roles |
| Folder | Shared "platform admin" on all prod folders |
| Project | Default compute SA with Editor |
| Resource | Bucket-level allUsers legacy ACL |

Map effective permissions with Policy Analyzer and IAM Recommender before revoking—surprise outages hurt adoption.

## Least privilege patterns

- **Replace basic roles** with predefined roles (e.g. \`roles/storage.objectViewer\` not Viewer)
- **Custom roles** when predefined bundles are too broad—document each permission
- **Groups via Google Groups or Cloud Identity** instead of individual user bindings
- **Separate prod and non-prod** folders with different role baselines
- **Audit service accounts** quarterly; delete unused SAs and keys

## IAM Conditions and constraints

**IAM Conditions** restrict when a binding applies:

\`\`\`
resource.name.startsWith("projects/_/buckets/prod-")
request.time < timestamp("2026-12-31T00:00:00Z")
\`\`\`

Pair with **organization policy constraints**:

- \`iam.disableServiceAccountKeyCreation\`
- \`constraints/iam.allowedPolicyMemberDomains\`
- Domain-restricted sharing for Cloud Storage

## Service account hygiene

Long-lived JSON keys are GCP's equivalent of static AWS access keys.

1. Inventory keys with **Policy Intelligence** and security center findings
2. Migrate workloads to **Workload Identity** on GKE and attached SAs on GCE
3. Use **Workload Identity Federation** for CI/CD from GitHub or Azure DevOps
4. Alert on new key creation via log-based metrics

Compromised service accounts on paths to BigQuery or GCS buckets are classic [toxic combinations](/blog/toxic-combinations-aws-azure/) when combined with public ingress elsewhere.

## CIEM and CSPM integration

Native tools surface over-privileged bindings; graph platforms connect IAM to **network reachability** and **data stores**. A SA with storage.admin on an internal-only bucket differs from the same role where a misconfigured load balancer exposes an API that uses that SA.

Teams evaluating [CSPM vs CNAPP](/blog/cspm-vs-cnapp-whats-the-difference/) should treat GCP IAM as CIEM input feeding a unified **security graph**. [OpenSourceOM](https://github.com/OpenSourceOM/core) ingests GCP asset and IAM relationships for cross-cloud attack path queries.

## GCP IAM review cadence

| Frequency | Activity |
|-----------|----------|
| Weekly | Review new org/project IAM binding changes |
| Monthly | IAM Recommender export and ticket backlog |
| Quarterly | Service account and key census |
| On incident | Break-glass role usage audit |

## Privileged access and break-glass

Emergency admin access is inevitable—ungoverned break-glass is not.

- Maintain **two break-glass accounts** with hardware MFA, no day-to-day use, and Cloud Logging alerts on every action
- Use **Just-in-Time (JIT)** access via PAM integration or temporary IAM Conditions with approval tickets
- **Review break-glass usage** within 24 hours and rotate any exposed credentials immediately
- Never attach **Owner** at org level to individual users—use groups with membership reviews

Break-glass roles that can disable org policies or export every bucket belong in your **attack path** model as high-blast-radius nodes regardless of CVSS elsewhere.

## Integrating GCP IAM with broader CNAPP workflows

Export IAM Policy Analyzer results weekly into your vulnerability and CSPM workflows. When SCC flags a public Cloud Run service, the graph should immediately show which service accounts that revision uses and whether those identities reach BigQuery, Secret Manager, or cross-project resources.

Teams migrating from on-prem AD often over-provision **Cloud Identity groups** with legacy broad roles. Treat group membership changes as production changes requiring approval—stale contractors in a \`gcp-prod-admins\` group bypass every technical control downstream.

## Key takeaways

- **Folder hierarchy** amplifies both good governance and bad bindings—design it deliberately
- **Eliminate SA keys**; federation and attached identities scale better
- **IAM Conditions** and org policies enforce guardrails automation misses
- **Graph-aware CIEM** prioritizes identities attackers can actually abuse

---${relatedBlock(links)}`,
  },
  {
    slug: 'kubernetes-rbac-security-best-practices',
    title: 'Kubernetes RBAC Security Best Practices for Production Clusters',
    description: 'Production Kubernetes RBAC best practices covering RoleBindings, service accounts, namespace isolation, and audit logging—integrated with CSPM and CNAPP-style cluster security.',
    tags: ['Kubernetes', 'RBAC', 'cloud security', 'CNAPP', 'container security'],
    focusKeyword: 'Kubernetes RBAC security',
    faq: [
      { question: 'What is the most common Kubernetes RBAC mistake?', answer: 'Cluster-admin bindings for application service accounts or developers—production apps should use namespace-scoped Roles with minimal verbs on required resources.' },
      { question: 'Should I use default service accounts in pods?', answer: 'No. Create dedicated service accounts per workload, disable automount where unnecessary, and avoid default SA tokens in untrusted namespaces.' },
      { question: 'How do I audit Kubernetes RBAC?', answer: 'Enable audit logging, use rbac-manager or policy engines, and periodically query who can secrets/get cluster-wide with tools like kubectl-who-can or CNAPP KSPM modules.' },
    ],
    body: (links) => `**Kubernetes RBAC security** is the gatekeeper for everything inside your cluster—secrets, workloads, and the API server itself. RBAC misconfiguration is a top enabler of **lateral movement** after a single compromised pod.

## RBAC fundamentals in production

Kubernetes RBAC binds **Roles** or **ClusterRoles** to **Subjects** via RoleBindings or ClusterRoleBindings.

| Object | Scope | Risk if misused |
|--------|-------|-----------------|
| Role + RoleBinding | Namespace | Elevated privileges in one NS |
| ClusterRole + ClusterRoleBinding | Cluster-wide | Full cluster compromise potential |
| Aggregated ClusterRoles | Cluster | Hidden permissions via label selectors |

**Rule of thumb:** no ClusterRoleBinding for app service accounts unless platform team explicitly requires it.

## Namespace isolation strategy

- **One namespace per team or app** with ResourceQuotas and LimitRanges
- **NetworkPolicies** default deny between namespaces (see dedicated network policy guides)
- **Separate prod and non-prod clusters** when regulatory boundaries require it
- **OPA Gatekeeper or Kyverno** to deny ClusterRoleBindings granting \`*\` verbs

Platform teams own cluster-scoped roles; application teams receive namespace Roles only.

## Service account hardening

Pods run as service accounts (SAs). Weak SA = weak identity.

- Disable **automountServiceAccountToken** unless the pod needs K8s API access
- Never mount **default** SA in production deployments
- Use **bound service account tokens** (TokenRequest API) with audience and expiry
- On EKS/GKE/AKS, link K8s SAs to cloud IAM via IRSA / Workload Identity

A pod SA that can read Secrets cluster-wide plus a container escape becomes a cloud credential theft story—connect K8s findings to cloud **attack paths** per [attack path analysis guidance](/blog/attack-path-analysis-cloud-security/).

## Auditing and continuous validation

1. Export RBAC with \`kubectl auth can-i --list\` baselines per role template
2. Enable **audit logs** at Metadata or RequestResponse for auth decisions
3. Run **KSPM** (Kubernetes Security Posture Management) in CI and continuously
4. Alert on new ClusterRoleBindings to \`cluster-admin\`

[OpenSourceOM](https://opensourceom.org) treats clusters as graph nodes linked to cloud identities and ingress—helpful when prioritizing which RBAC gaps sit on reachable paths.

## RBAC vs admission control

| Layer | Stops |
|-------|-------|
| RBAC | Unauthorized API actions |
| Pod Security Standards | Privileged pods, host namespaces |
| Admission webhooks | Non-compliant manifests at create time |
| NetworkPolicy | Pod-to-pod traffic |

RBAC alone does not block privileged containers—layer controls.

## Sample production role (app workload)

| Verb | Resource | Reason |
|------|----------|--------|
| get, list | configmaps | App config |
| get | secrets | App secrets in NS only |
| get, list, watch | pods | Health sidecars |

No \`create\` on secrets, no cross-namespace access, no nodes/proxy.

## EKS, GKE, and AKS-specific RBAC notes

Managed Kubernetes adds another IAM layer beneath Kubernetes RBAC.

| Platform | Cloud IAM link | Common pitfall |
|----------|----------------|----------------|
| EKS | IRSA maps K8s SA to IAM role | Over-scoped trust policy on OIDC provider |
| GKE | Workload Identity | Default compute SA still has broad GCP access |
| AKS | Azure AD + managed identity | AAD admin group with cluster-admin for all devs |

Map **aws-auth** or equivalent on every cluster upgrade—automation drift here silently grants cluster-admin to unexpected ARNs.

## RBAC testing in CI

Before merging Helm changes, run policy tests:

1. Render manifests and assert no ClusterRoleBinding to \`cluster-admin\` for app charts
2. Use **rakkess** or **kubectl-who-can** in pipeline smoke tests against a staging cluster
3. Fail builds that introduce \`secrets\` \`list\` cluster-wide unless platform team approves

Continuous validation matters because emergency hotfixes often add temporary Roles that never get removed.

## Key takeaways

- **Namespace-scoped Roles** for apps; **ClusterRoles** sparingly for platform ops
- **Dedicated service accounts** with token automount disabled by default
- **Audit + KSPM** catch drift RBAC reviews miss
- **Correlate K8s identity** with cloud IAM in your CNAPP or graph stack

---${relatedBlock(links)}`,
  },
  {
    slug: 'zero-trust-cloud-architecture-guide',
    title: 'Zero Trust Cloud Architecture: Identity, Micro-Segmentation, and Verification',
    description: 'Implement zero trust in AWS, Azure, and GCP with identity-centric access, micro-segmentation, continuous verification, and CSPM-backed policy enforcement for cloud-native workloads.',
    tags: ['zero trust', 'cloud security', 'identity', 'micro-segmentation', 'CNAPP'],
    focusKeyword: 'zero trust cloud',
    faq: [
      { question: 'Is zero trust different in the cloud?', answer: 'Principles are the same—never trust, always verify—but cloud zero trust emphasizes identity federation, service mesh, Private Link, and API-level policy instead of perimeter firewalls alone.' },
      { question: 'Where do I start with zero trust in AWS or Azure?', answer: 'Start with strong identity (SSO, conditional access), eliminate flat network trust zones, enable centralized logging, and enforce least privilege on all service-to-service calls.' },
      { question: 'Does zero trust replace CSPM?', answer: 'No. Zero trust is an architecture; CSPM validates configuration drift. Together they ensure policies match zero trust intent continuously.' },
    ],
    body: (links) => `**Zero trust cloud** architecture rejects the idea that anything inside a VPC is safe. Every request—human or machine—must be authenticated, authorized, and encrypted based on identity and context.

## Zero trust principles for cloud

1. **Verify explicitly** — authenticate and authorize every access decision
2. **Least privilege access** — JIT elevation, scoped roles, no standing admin
3. **Assume breach** — segment, log, and limit blast radius

Legacy "trusted internal network" models collapse when a single compromised workload can reach every database in the VPC.

## Identity as the primary perimeter

| Cloud | Zero trust identity stack |
|-------|---------------------------|
| AWS | IAM Identity Center, STS, Verified Permissions |
| Azure | Entra ID, Conditional Access, PIM |
| GCP | Cloud Identity, BeyondCorp, IAM Conditions |

Replace VPN-wide trust with **per-application access** via identity-aware proxy or Zero Trust Network Access (ZTNA) products—and enforce **CIEM** on cloud control planes per [CIEM explained](/blog/ciem-explained-for-cloud-teams/).

## Micro-segmentation in cloud networks

- **Security groups / NSGs / firewall rules** with default deny
- **Service mesh** (Istio, Linkerd) for mTLS east-west traffic
- **Private endpoints** so PaaS traffic never traverses public internet
- **Kubernetes NetworkPolicies** for pod-level segmentation

Segmentation limits **lateral movement**—a finding that matters deeply in [attack path analysis](/blog/attack-path-analysis-cloud-security/).

## Continuous verification and posture

Zero trust is not a one-time project. **CSPM** and **CNAPP** validate:

- Are Private Link endpoints used where policy requires?
- Do load balancers still allow legacy TLS?
- Are break-glass accounts monitored and time-bound?

Automate remediation for drift; manual quarterly reviews fail at cloud speed.

## Zero trust maturity model

| Level | Characteristics |
|-------|-----------------|
| 1 - Initial | Perimeter VPN, flat VPCs |
| 2 - Developing | SSO everywhere, some segmentation |
| 3 - Defined | JIT access, CSPM, centralized SIEM |
| 4 - Optimized | Graph-based path analysis, automated policy |

## OpenSourceOM and zero trust validation

Graph platforms like [OpenSourceOM](https://opensourceom.org) answer whether residual **network paths** bypass zero trust intent—e.g. a security group rule that re-opens east-west DB access. Visibility closes the gap between policy documents and live infrastructure.

## Device and workload trust signals

Zero trust extends beyond human login to **machine identity**:

- **Workload certificates** issued by internal PKI or mesh CAs for service-to-service auth
- **Device compliance** checks via MDM before Conditional Access allows admin portals
- **Attestation** on confidential computing workloads where hardware root of trust is available
- **Runtime integrity** signals from CWPP agents feeding policy decisions (block lateral movement when tampering detected)

Pair device trust with **short session lifetimes** and step-up authentication for destructive cloud API actions (delete bucket, attach admin policy).

## Common zero trust anti-patterns in cloud

| Anti-pattern | Why it fails | Fix |
|--------------|--------------|-----|
| VPN = trusted | Flat access once connected | Per-app ZTNA with identity checks |
| Shared admin creds | No attribution, no rotation | SSO + PIM/JIT |
| Flat VPC peering | Lateral movement highway | Hub-spoke or mesh with policy |
| Security groups 0.0.0.0/0 "temporarily" | Becomes permanent | CSPM alerts + auto-revert |
| Ignoring serverless URLs | Public function endpoints | Auth at gateway + IAM on invoke |

Review [open source CSPM and CNAPP tools](/blog/open-source-cspm-cnapp-tools-2026/) when selecting platforms that validate zero trust posture continuously rather than at audit time.

## Key takeaways

- **Identity replaces network location** as the primary trust signal
- **Micro-segmentation** contains breach blast radius
- **CSPM validates** that zero trust controls persist under drift
- **Attack path queries** find holes architecture diagrams miss

---${relatedBlock(links)}`,
  },
];

// Generate remaining 45 topics programmatically with rich templates
const TOPIC_DEFS = [
  ['terraform-security-scanning-iac-drift', 'Terraform Security Scanning: Catch IaC Drift Before Deploy', 'Scan Terraform and OpenTofu for misconfigurations, secrets, and policy violations in CI/CD—with CSPM feedback loops for cloud drift after apply.', ['Terraform', 'IaC', 'CSPM', 'cloud security', 'devsecops'], 'Terraform security scanning'],
  ['cloud-drift-detection-remediation', 'Cloud Drift Detection and Remediation: Closing the IaC Gap', 'Detect when live AWS, Azure, and GCP resources diverge from IaC templates and prioritize drift that creates exposure or attack paths.', ['cloud drift', 'IaC', 'CSPM', 'remediation', 'cloud security'], 'cloud drift detection'],
  ['exposure-management-cloud-security', 'Exposure Management in Cloud Security: Beyond Vulnerability Lists', 'Reduce external and internal cloud exposure with attack surface management, CSPM, and graph queries that show reachable entry points.', ['exposure management', 'attack surface', 'CSPM', 'cloud security', 'CNAPP'], 'exposure management cloud'],
  ['lateral-movement-aws-mitigation', 'Lateral Movement in AWS: Detection Patterns and Mitigation', 'Stop AWS lateral movement via IAM role chaining, VPC segmentation, GuardDuty findings, and attack path analysis from compromised workloads.', ['AWS', 'lateral movement', 'cloud security', 'IAM', 'threat detection'], 'lateral movement AWS'],
  ['serverless-security-lambda-azure-functions', 'Serverless Security: AWS Lambda and Azure Functions Hardening', 'Secure serverless with least-privilege execution roles, event source validation, dependency scanning, and CSPM for function URLs and networking.', ['serverless', 'Lambda', 'Azure Functions', 'cloud security', 'CWPP'], 'serverless security'],
  ['sbom-supply-chain-cloud-security', 'SBOM and Supply Chain Security for Cloud-Native Teams', 'Generate and consume SBOMs in CI/CD, link package risk to cloud deployments, and integrate software supply chain checks with CNAPP workflows.', ['SBOM', 'supply chain', 'cloud security', 'devsecops', 'container security'], 'SBOM cloud security'],
  ['aws-security-groups-best-practices', 'AWS Security Groups Best Practices: Least-Privilege Network Access', 'Design AWS security groups with default deny, document ingress exceptions, and correlate overly permissive rules with attack path risk.', ['AWS', 'security groups', 'network security', 'CSPM', 'cloud security'], 'AWS security groups'],
  ['azure-network-security-groups-guide', 'Azure NSG Rules: A Practical Security Guide for Cloud Teams', 'Configure Azure network security groups with tiered rules, service tags, and CSPM validation to prevent exposure and lateral movement.', ['Azure', 'NSG', 'network security', 'CSPM', 'cloud security'], 'Azure NSG security'],
  ['gcp-vpc-service-controls-explained', 'GCP VPC Service Controls Explained: Data Exfiltration Guardrails', 'Use VPC Service Controls and perimeters to restrict GCP API access, prevent data exfiltration, and integrate with organization policy.', ['GCP', 'VPC Service Controls', 'data security', 'cloud security', 'DSPM'], 'GCP VPC Service Controls'],
  ['kubernetes-network-policies-practical-guide', 'Kubernetes Network Policies: A Practical Implementation Guide', 'Implement Kubernetes NetworkPolicies for default-deny east-west traffic, namespace isolation, and integration with CNAPP KSPM checks.', ['Kubernetes', 'NetworkPolicy', 'container security', 'cloud security', 'micro-segmentation'], 'Kubernetes network policies'],
  ['cloud-secrets-management-best-practices', 'Cloud Secrets Management: AWS, Azure, and GCP Best Practices', 'Centralize secrets in vaults, eliminate repo leaks, rotate credentials automatically, and map secret access in CIEM and attack graphs.', ['secrets management', 'cloud security', 'CIEM', 'devsecops', 'CSPM'], 'cloud secrets management'],
  ['aws-kms-encryption-key-management', 'AWS KMS Key Management: Encryption Policies Teams Actually Use', 'Design AWS KMS key policies, rotation, grants, and cross-account access with least privilege and audit trails for regulated workloads.', ['AWS', 'KMS', 'encryption', 'cloud security', 'data protection'], 'AWS KMS security'],
  ['azure-key-vault-security-hardening', 'Azure Key Vault Security Hardening for Production Workloads', 'Harden Azure Key Vault with RBAC, private endpoints, soft-delete, purge protection, and monitoring for anomalous secret access.', ['Azure', 'Key Vault', 'encryption', 'cloud security', 'secrets management'], 'Azure Key Vault security'],
  ['container-image-scanning-cicd', 'Container Image Scanning in CI/CD: From CVE Noise to Priority', 'Scan container images in pipelines, prioritize CVEs on production attack paths, and block deploys on critical exploitable combinations.', ['container security', 'CI/CD', 'vulnerability management', 'CNAPP', 'devsecops'], 'container image scanning'],
  ['cloud-workload-protection-cwpp-guide', 'Cloud Workload Protection (CWPP): VMs, Containers, and Serverless', 'Deploy CWPP for runtime threat detection on cloud workloads and correlate runtime signals with CSPM posture and identity risk.', ['CWPP', 'cloud security', 'CNAPP', 'runtime protection', 'container security'], 'cloud workload protection'],
  ['dspm-data-security-posture-management', 'DSPM Explained: Data Security Posture Management in the Cloud', 'Discover sensitive data in cloud stores, classify exposure, and prioritize misconfigurations that leak PII or regulated data.', ['DSPM', 'data security', 'cloud security', 'CNAPP', 'compliance'], 'DSPM cloud security'],
  ['aws-cloudtrail-monitoring-security', 'AWS CloudTrail for Security Monitoring: Organization-Wide Logging', 'Configure organization CloudTrail, integrity validation, and SIEM detection for IAM changes, exposure events, and incident response.', ['AWS', 'CloudTrail', 'SIEM', 'cloud security', 'logging'], 'AWS CloudTrail security'],
  ['azure-defender-cloud-security', 'Microsoft Defender for Cloud: Plans, Alerts, and Integration', 'Choose Defender for Cloud plans, tune alerts, integrate with Sentinel, and map recommendations to attack path priority.', ['Azure', 'Defender for Cloud', 'CSPM', 'cloud security', 'threat detection'], 'Azure Defender for Cloud'],
  ['gcp-security-command-center-guide', 'GCP Security Command Center: Findings, Sources, and Workflows', 'Operationalize Security Command Center for GCP misconfigurations, vulnerabilities, and threat findings with SOAR-ready exports.', ['GCP', 'Security Command Center', 'CSPM', 'cloud security', 'Google Cloud'], 'GCP Security Command Center'],
  ['multi-cloud-security-governance', 'Multi-Cloud Security Governance: Frameworks That Scale', 'Unify policies, identity, and CSPM across AWS, Azure, and GCP without lowest-common-denominator security or tool sprawl.', ['multi-cloud', 'governance', 'CSPM', 'cloud security', 'CNAPP'], 'multi-cloud security governance'],
  ['cloud-identity-federation-sso-security', 'Cloud Identity Federation and SSO Security Best Practices', 'Secure federated identity across clouds with SAML/OIDC hardening, token lifetime, and CIEM reviews of federated role mappings.', ['identity', 'SSO', 'CIEM', 'cloud security', 'zero trust'], 'cloud identity federation'],
  ['aws-sso-iam-identity-center-hardening', 'AWS IAM Identity Center Hardening: SSO Permission Sets Done Right', 'Configure IAM Identity Center permission sets, session duration, and account assignments with least privilege and audit logging.', ['AWS', 'IAM Identity Center', 'CIEM', 'cloud security', 'SSO'], 'AWS IAM Identity Center'],
  ['azure-ad-privileged-identity-management', 'Azure Privileged Identity Management for Cloud Administrators', 'Use Entra ID PIM for just-in-time admin access, approval workflows, and logging on Azure and Microsoft 365 privileged roles.', ['Azure', 'PIM', 'CIEM', 'cloud security', 'identity'], 'Azure Privileged Identity Management'],
  ['gcp-workload-identity-federation', 'GCP Workload Identity Federation: Keyless Access from CI/CD', 'Replace service account keys with Workload Identity Federation from GitHub, GitLab, and other OIDC providers on Google Cloud.', ['GCP', 'Workload Identity', 'CIEM', 'devsecops', 'cloud security'], 'GCP Workload Identity Federation'],
  ['kubernetes-pod-security-standards', 'Kubernetes Pod Security Standards: Enforcing Baseline and Restricted', 'Apply Pod Security Admission with baseline and restricted profiles, migrate legacy workloads, and validate in CI pipelines.', ['Kubernetes', 'pod security', 'container security', 'CNAPP', 'cloud security'], 'Kubernetes Pod Security Standards'],
  ['cloud-compliance-cis-benchmarks', 'Cloud Compliance: CIS Benchmarks Across AWS, Azure, and GCP', 'Map CIS benchmarks to CSPM policies, measure conformance continuously, and prioritize failed checks on exploitable paths.', ['compliance', 'CIS', 'CSPM', 'cloud security', 'audit'], 'CIS cloud benchmarks'],
  ['aws-guardduty-threat-detection', 'AWS GuardDuty Threat Detection: Tuning Alerts for Real Incidents', 'Enable GuardDuty data sources, reduce false positives, integrate with EventBridge and SOAR, and link findings to IAM blast radius.', ['AWS', 'GuardDuty', 'threat detection', 'cloud security', 'SIEM'], 'AWS GuardDuty'],
  ['azure-sentinel-cloud-siem', 'Microsoft Sentinel for Cloud Security Operations', 'Ingest Azure and multi-cloud logs into Sentinel, build analytics rules for posture and threat detection, and automate response.', ['Azure', 'Sentinel', 'SIEM', 'cloud security', 'SOC'], 'Azure Sentinel cloud security'],
  ['gcp-chronicle-security-operations', 'Google Chronicle SecOps for GCP and Hybrid Cloud Monitoring', 'Centralize GCP telemetry in Chronicle, detect cloud threats, and correlate with Security Command Center posture findings.', ['GCP', 'Chronicle', 'SIEM', 'cloud security', 'threat detection'], 'GCP Chronicle security'],
  ['cloud-incident-response-playbook', 'Cloud Incident Response Playbook: Contain, Eradicate, Recover', 'Run cloud IR for credential compromise, crypto mining, and data exposure with forensics on CloudTrail, snapshots, and graph analysis.', ['incident response', 'cloud security', 'forensics', 'SOC', 'CNAPP'], 'cloud incident response'],
  ['aws-s3-bucket-security-hardening', 'AWS S3 Bucket Security Hardening: Block Public Access and Beyond', 'Harden S3 with block public access, bucket policies, encryption, access logging, and DSPM-style sensitive data discovery.', ['AWS', 'S3', 'data security', 'CSPM', 'cloud security'], 'AWS S3 security'],
  ['azure-blob-storage-security-guide', 'Azure Blob Storage Security: Access Tiers, SAS, and Private Link', 'Secure Azure Storage with RBAC, SAS restrictions, private endpoints, and CSPM monitoring for anonymous access drift.', ['Azure', 'blob storage', 'data security', 'CSPM', 'cloud security'], 'Azure blob storage security'],
  ['gcp-cloud-storage-access-control', 'GCP Cloud Storage Access Control: IAM, ACLs, and Uniform Access', 'Migrate to uniform bucket-level access, enforce IAM conditions, and monitor public object exposure in GCS buckets.', ['GCP', 'Cloud Storage', 'data security', 'CSPM', 'cloud security'], 'GCP Cloud Storage security'],
  ['cloud-api-security-rate-limiting', 'Cloud API Security: Rate Limiting, Auth, and Abuse Prevention', 'Protect cloud-hosted APIs with WAF, rate limits, OAuth scopes, and CSPM checks on API Gateway and load balancer configs.', ['API security', 'cloud security', 'WAF', 'devsecops', 'zero trust'], 'cloud API security'],
  ['aws-waf-web-application-firewall-guide', 'AWS WAF Guide: Rules, Managed Groups, and Logging', 'Configure AWS WAF with managed rule groups, custom rate limits, logging to S3 and SIEM, and integration with CloudFront and ALB.', ['AWS', 'WAF', 'application security', 'cloud security', 'DDoS'], 'AWS WAF'],
  ['azure-application-gateway-waf', 'Azure Application Gateway WAF: OWASP Rules and Tuning', 'Deploy and tune Application Gateway WAF, reduce false positives, and correlate app exposure with CSPM ingress findings.', ['Azure', 'WAF', 'application security', 'cloud security', 'OWASP'], 'Azure Application Gateway WAF'],
  ['cloud-tagging-strategy-security-governance', 'Cloud Tagging Strategy for Security Governance and Cost', 'Define mandatory security tags, enforce via policy, and use tags in CSPM scope, CMDB, and incident ownership workflows.', ['governance', 'tagging', 'CSPM', 'multi-cloud', 'cloud security'], 'cloud tagging strategy security'],
  ['aws-organizations-scp-security', 'AWS Organizations SCPs: Guardrails for Multi-Account Security', 'Write service control policies that deny risky actions, allow break-glass exceptions, and complement CSPM with preventive controls.', ['AWS', 'SCP', 'governance', 'cloud security', 'IAM'], 'AWS Organizations SCP'],
  ['azure-management-groups-policy', 'Azure Management Groups and Policy: Enterprise Guardrails', 'Structure management groups, assign initiatives, and delegate policy exemptions with security review workflows.', ['Azure', 'Azure Policy', 'governance', 'CSPM', 'cloud security'], 'Azure management groups policy'],
  ['gcp-organization-policy-constraints', 'GCP Organization Policy Constraints for Security Baselines', 'Apply org policy constraints on domains, regions, and service account keys to enforce GCP security baselines at scale.', ['GCP', 'organization policy', 'governance', 'cloud security', 'CSPM'], 'GCP organization policy'],
  ['kubernetes-admission-controllers-security', 'Kubernetes Admission Controllers for Security Policy Enforcement', 'Use validating and mutating admission webhooks, Gatekeeper, and Kyverno to block risky manifests before they reach clusters.', ['Kubernetes', 'admission control', 'policy', 'container security', 'devsecops'], 'Kubernetes admission controllers'],
  ['cloud-vulnerability-management-program', 'Building a Cloud Vulnerability Management Program That Works', 'Unify VM, container, and serverless scanning with prioritization by attack path—not CVSS alone—for cloud-native estates.', ['vulnerability management', 'CNAPP', 'cloud security', 'CWPP', 'prioritization'], 'cloud vulnerability management'],
  ['aws-ec2-hardening-checklist', 'AWS EC2 Hardening Checklist: AMIs, IMDS, and Patch Management', 'Harden EC2 with IMDSv2, SSM patching, minimal AMIs, security group hygiene, and vulnerability correlation on exposed instances.', ['AWS', 'EC2', 'CWPP', 'cloud security', 'hardening'], 'AWS EC2 hardening'],
  ['azure-vm-security-baseline', 'Azure VM Security Baseline: Disk Encryption, NSGs, and Monitoring', 'Apply Azure VM security baselines, Defender for Servers, JIT access, and CSPM validation on production virtual machines.', ['Azure', 'virtual machines', 'CWPP', 'cloud security', 'hardening'], 'Azure VM security baseline'],
  ['gcp-compute-engine-security-hardening', 'GCP Compute Engine Security Hardening for Production VMs', 'Secure GCE instances with OS Login, shielded VMs, patch management, service account scopes, and SCC vulnerability findings.', ['GCP', 'Compute Engine', 'CWPP', 'cloud security', 'hardening'], 'GCP Compute Engine security'],
  ['cloud-native-application-security', 'Cloud-Native Application Security: Design Patterns for Secure Apps', 'Build secure cloud-native apps with mTLS, secret rotation, signed artifacts, and CSPM validation of deployment manifests.', ['application security', 'cloud-native', 'CNAPP', 'devsecops', 'Kubernetes'], 'cloud-native application security'],
  ['aws-rds-database-security-guide', 'AWS RDS Security Guide: Encryption, Network Isolation, and Auditing', 'Secure RDS with private subnets, encryption at rest and in transit, IAM auth where supported, and audit logging to SIEM.', ['AWS', 'RDS', 'database security', 'cloud security', 'encryption'], 'AWS RDS security'],
  ['azure-sql-database-security-hardening', 'Azure SQL Database Security Hardening for Regulated Workloads', 'Configure Azure SQL firewall, Entra auth, TDE, Advanced Threat Protection, and private endpoints for production databases.', ['Azure', 'SQL Database', 'database security', 'cloud security', 'encryption'], 'Azure SQL security'],
  ['gcp-cloud-sql-security-best-practices', 'GCP Cloud SQL Security Best Practices: Auth and Network Controls', 'Harden Cloud SQL with private IP, IAM database auth, SSL enforcement, and automated backup encryption validation.', ['GCP', 'Cloud SQL', 'database security', 'cloud security', 'CSPM'], 'GCP Cloud SQL security'],
  ['cloud-security-automation-remediation', 'Cloud Security Automation: Remediation Playbooks That Scale', 'Automate CSPM remediation with Lambda, Azure Functions, and Policy—validate fixes and re-scan attack paths after changes.', ['automation', 'CSPM', 'remediation', 'cloud security', 'devsecops'], 'cloud security automation'],
];

function generateDescription(title, focusKeyword) {
  const base = `${title.split(':')[0]}—practical guidance on ${focusKeyword} for AWS, Azure, GCP, and Kubernetes teams using CSPM, CNAPP, and attack path prioritization.`;
  if (base.length >= 150 && base.length <= 160) return base;
  const padded = base.length < 150
    ? base + ' Built for security engineers.'
    : base.slice(0, 157) + '...';
  return padded.length >= 150 && padded.length <= 160 ? padded : base.slice(0, 160);
}

function generateFaq(focusKeyword) {
  return [
    {
      question: `Why does ${focusKeyword} matter for cloud teams?`,
      answer: `${focusKeyword} reduces exploitable misconfigurations and identity risk before attackers chain them into paths to sensitive data—core outcomes for CSPM and CNAPP programs.`,
    },
    {
      question: `How does ${focusKeyword} relate to attack path analysis?`,
      answer: `Standalone scanners list issues in isolation; attack path analysis shows whether ${focusKeyword} gaps sit on reachable routes from ingress to crown jewels.`,
    },
    {
      question: `Can open-source tools support ${focusKeyword}?`,
      answer: `Yes. Graph-native platforms like OpenSourceOM combine inventory, policy checks, and path queries so teams can operationalize ${focusKeyword} without proprietary black boxes.`,
    },
  ];
}

function generateBody(slug, title, focusKeyword, links) {
  const link1 = links[0] ? `/blog/${links[0]}/` : '/blog/attack-path-analysis-cloud-security/';
  const link2 = links[1] ? `/blog/${links[1]}/` : '/blog/cspm-vs-cnapp-whats-the-difference/';
  const link1Label = links[0]?.replace(/-/g, ' ') || 'attack path analysis';
  const link2Label = links[1]?.replace(/-/g, ' ') || 'CSPM vs CNAPP';

  return `**${focusKeyword}** is on every cloud security roadmap—but slides and benchmarks rarely translate into daily engineering decisions. This guide covers what practitioners implement, measure, and automate in production AWS, Azure, GCP, and Kubernetes environments.

If you are drowning in flat findings from CSPM and vulnerability scanners, you are not alone. The fix is not another dashboard; it is **context**: identity, exposure, and whether a weakness sits on an exploitable **attack path**.

## Why ${focusKeyword} matters now

Cloud estates change hourly. Terraform applies, autoscaling adds instances, engineers open temporary security group rules—and compliance snapshots go stale before the quarter ends.

| Challenge | Without ${focusKeyword} | With disciplined approach |
|-----------|-------------------------|---------------------------|
| Alert volume | Thousands of equal-priority tickets | Ranked by reachability and blast radius |
| Identity risk | Hidden admin bindings | CIEM-style permission analytics |
| Data exposure | Unknown public buckets | DSPM plus exposure management |
| Tool sprawl | CSPM + scanner + IAM silos | Graph-correlated CNAPP model |

Teams comparing [${link1Label}](${link1}) and [${link2Label}](${link2}) often discover that **prioritization** matters more than acquiring yet another point product.

## Core controls and implementation steps

Start with visibility, then enforcement, then continuous validation:

1. **Inventory** — accounts, subscriptions, projects, clusters; tag owners and data classification
2. **Baseline** — CIS or internal policy set mapped to CSPM checks
3. **Exposure reduction** — internet-facing resources and anonymous access first
4. **Identity review** — eliminate standing privilege; federation over long-lived keys
5. **Graph or path analysis** — ask which findings connect ingress to sensitive assets
6. **Automate remediation** — safe auto-fix for well-understood misconfigurations with rollback

### AWS considerations

On AWS, align ${focusKeyword} with Organizations SCPs, Config rules, GuardDuty, and IAM Access Analyzer. Security groups and S3 public access blocks deliver fast wins before advanced analytics.

### Azure considerations

Use Defender for Cloud recommendations, Azure Policy initiatives, and Entra ID Conditional Access. Private Link and NSG tiering reduce lateral movement between application tiers.

### GCP considerations

Organization policies, VPC Service Controls, and Security Command Center findings form the native stack. Prefer Workload Identity Federation over downloaded service account keys.

### Kubernetes considerations

RBAC, Pod Security Standards, NetworkPolicies, and admission control enforce ${focusKeyword} at the cluster layer—correlate compromised pods with cloud IAM via IRSA or Workload Identity.

## Avoiding toxic combinations

Individual misconfigurations often carry medium severity. **Toxic combinations**—public exposure plus privileged identity plus unpatched workload on a path to production data—are what attackers exploit.

Review [toxic combinations in AWS and Azure](/blog/toxic-combinations-aws-azure/) and [how to prioritize cloud vulnerabilities](/blog/how-to-prioritize-cloud-vulnerabilities/) alongside this playbook. Graph queries like *show internet-reachable workloads with secrets access* outperform spreadsheet sorts.

## Metrics that prove progress

| Metric | Target direction |
|--------|------------------|
| Internet-facing resource count | Down |
| Critical path findings open > 7 days | Down |
| Standing admin bindings | Down |
| Mean time to remediate path-critical issues | Down |
| Repeat misconfiguration rate | Down |

Executives care about trend lines, not raw finding counts—a mature ${focusKeyword} program ** reduces reachable risk**, not merely closes tickets.

## Open-source and self-hosted options

Proprietary CNAPP suites popularized unified cloud security, but regulated and cost-conscious teams often need **auditable scoring** and **data residency**. [OpenSourceOM](https://opensourceom.org) builds a **security graph** across clouds with CSPM-style policies tied to attack path context—the [core repository](https://github.com/OpenSourceOM/core) is open source for teams extending collectors and queries.

See also [open source CSPM and CNAPP tools](/blog/open-source-cspm-cnapp-tools-2026/) for a landscape view.

## Operational cadence

| Cadence | Activity |
|---------|----------|
| Continuous | CSPM scan, drift detection, GuardDuty/SCC alerts |
| Weekly | Triage path-critical findings; IAM change review |
| Monthly | Policy exemption audit; tabletop on credential theft |
| Quarterly | Benchmark reassessment; red team focused on paths |

## Key takeaways

- **${focusKeyword}** succeeds when tied to exposure, identity, and path context—not checkbox compliance alone
- **Automate baselines** but keep humans on exceptions, exemptions, and attack path triage
- **Multi-cloud** programs need portable policy intent with cloud-native enforcement mechanics
- **Graph-native tooling** (commercial or [OpenSourceOM](https://opensourceom.org)) scales prioritization when alert volume outgrows spreadsheets

---${relatedBlock(links)}`;
}

// Expand TOPIC_DEFS into full topics
for (const [slug, title, descHint, tags, focusKeyword] of TOPIC_DEFS) {
  if (TOPICS.some((t) => t.slug === slug)) continue;
  let description = descHint;
  if (description.length < 150) {
    description = generateDescription(title, focusKeyword);
  } else if (description.length > 160) {
    description = description.slice(0, 157) + '...';
  }
  TOPICS.push({
    slug,
    title,
    description,
    tags,
    focusKeyword,
    faq: generateFaq(focusKeyword),
    body: (links) => generateBody(slug, title, focusKeyword, links),
  });
}

// Append catalog topics (200+ additional SEO topics)
for (const [slug, title, description, tags, focusKeyword] of buildTopicCatalog()) {
  if (TOPICS.some((t) => t.slug === slug)) continue;
  TOPICS.push({
    slug,
    title,
    description,
    tags,
    focusKeyword,
    faq: generateFaq(focusKeyword),
    body: (links) => generateBody(slug, title, focusKeyword, links),
  });
}

const existingSlugs = new Set(
  readdirSync(BLOG_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.replace(/\.md$/, ''))
);

const selectedTopics = TOPICS.filter((topic) => {
  if (PROTECTED.has(topic.slug)) return false;
  if (skipExisting && existingSlugs.has(topic.slug)) return false;
  return true;
}).slice(0, TARGET_NEW);

if (selectedTopics.length < TARGET_NEW) {
  console.error(`Expected ${TARGET_NEW} topics, only ${selectedTopics.length} available after filters`);
  process.exit(1);
}

const created = [];
const skipped = [];

for (const topic of selectedTopics) {
  const filePath = join(BLOG_DIR, `${topic.slug}.md`);
  if (PROTECTED.has(topic.slug)) {
    skipped.push(topic.slug);
    continue;
  }
  if (skipExisting && existsSync(filePath)) {
    skipped.push(topic.slug);
    continue;
  }

  const internalLinks = pickInternalLinks(2);
  const content = `${buildFrontmatter(topic)}\n\n${topic.body(internalLinks)}`;
  const words = wordCount(content);

  if (words < 650) {
    console.warn(`Warning: ${topic.slug} has ${words} words (target 700-1000)`);
  }

  writeFileSync(filePath, content, 'utf8');
  created.push(topic.slug);
}

console.log(`\nGenerated ${created.length} blog posts in ${BLOG_DIR}`);
if (skipped.length) console.log(`Skipped (protected/existing): ${skipped.join(', ')}`);
console.log('\nSlugs created:');
created.forEach((s, i) => console.log(`${i + 1}. ${s}`));

if (created.length !== TARGET_NEW) {
  console.error(`\nError: expected ${TARGET_NEW} new files, created ${created.length}`);
  process.exit(1);
}

console.log(`\nSuccess: ${created.length} blog posts generated.`);
