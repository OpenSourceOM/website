---
title: "AWS Security Best Practices: A Practitioner Checklist for 2026"
description: "Practical AWS security best practices for 2026 covering IAM, network segmentation, logging, encryption, and exposure reduction with CSPM-aligned controls teams can implement today."
author: OpenSourceOM Team
tags:
  - AWS
  - cloud security
  - CSPM
  - IAM
  - security best practices
focusKeyword: AWS security best practices
faq:
  - question: What are the top AWS security priorities for new teams?
    answer: Start with root account lockdown, MFA on privileged users, CloudTrail organization-wide, SCP guardrails, and eliminating public S3 and security group exposure before advanced tooling.
  - question: How often should AWS security posture be reviewed?
    answer: Continuous CSPM scanning is ideal; at minimum review IAM, exposure, and logging weekly and after every major infrastructure change or incident.
  - question: Does AWS Shared Responsibility mean AWS handles security?
    answer: No. AWS secures the cloud; customers secure what they put in it—identity, configuration, data classification, and application code remain your responsibility.
---

AWS environments grow faster than security teams can manually audit them. **AWS security best practices** in 2026 still start with fundamentals—identity, exposure, logging, and encryption—but mature programs layer **CSPM**, **attack path analysis**, and automated remediation on top.

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

---
**Related:** [cloud-vulnerability-management-program](/blog/cloud-vulnerability-management-program/) · [azure-key-vault-security-hardening](/blog/azure-key-vault-security-hardening/)
