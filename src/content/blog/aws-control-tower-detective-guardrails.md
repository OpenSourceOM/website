---
title: "AWS Control Tower Detective Guardrails That Matter"
description: "Control Tower detective guardrails are Config rules, not SCPs. Skip duplicates of preventive policies, fix recorder ownership, and map remaining noncompliant resources onto attack paths."
pubDate: 2026-08-27
updatedDate: 2026-08-27
author: OpenSourceOM Team
tags:
  - AWS
  - Control Tower
  - AWS Config
  - guardrails
  - Organizations
focusKeyword: Control Tower detective guardrails
faq:
  - question: If a detective guardrail is noncompliant, did Control Tower fail to protect us?
    answer: >-
      Detective controls never block the API. They evaluate after the fact and
      set a Config compliance flag. Preventive SCPs (and some RCPs / declarative
      policies) are what deny. A red detective finding means the resource exists
      in a bad state, not that Control Tower “missed a deny.”
  - question: Why does enrolling an account fail with a Config recorder error?
    answer: >-
      Only one configuration recorder and one delivery channel can exist per
      Region. Control Tower expects to own them (or a documented allow-list
      layout). A leftover recorder from a 2019 “enable Config” click blocks
      enrollment until you stop it, delete channel then recorder, or reshape
      them to Control Tower’s role and bucket.
  - question: Should I enable every strongly recommended detective control?
    answer: >-
      No. Many duplicate a preventive SCP you already attached, or flag
      encryption settings on resources with no path to data. Enable detectives
      that name internet exposure, public snapshots, IAM users with keys, and
      disabled CloudTrail—then wire those resources into attack-path review.
  - question: Do proactive CloudFormation hooks replace detective Config rules?
    answer: >-
      No. Proactive hooks only see CloudFormation create/update. Console, CDK
      (sometimes), Terraform, and CLI bypass them. Detective Config still
      evaluates the live resource. Keep detectives for exposure even if hooks
      are on for CFN-only pipelines.
---

Control Tower’s dashboard can be green on **preventive** controls and red on **detective** ones at the same time. That is consistent: one is an SCP, the other is an AWS Config rule. **Control Tower detective guardrails** that matter are the Config evaluations that still describe a live resource after SCPs have done their job—not the full catalog of “strongly recommended” checkboxes.

Landing-zone IAM, org CloudTrail, and S3 Block Public Access still belong in [AWS security best practices](/blog/aws-security-best-practices-2026/). This page is **which detective controls to keep, what breaks Config, and how to stop treating compliance % as risk**.

## Preventive vs detective

| Kind | Implements | When it fires | Status model |
| --- | --- | --- | --- |
| Preventive | SCP (sometimes RCP / declarative policy) | On the API, before the resource exists | Enforced or not enabled |
| Detective | AWS Config rule (managed or CT-custom) | After the resource exists / on schedule | Compliant / noncompliant |
| Proactive | CloudFormation hooks | CFN pre-create / pre-update only | Pass / fail the stack |

Mandatory preventives (do not disable CloudTrail, do not delete the Config recorder role, do not leave the organization) are the floor. They are **not** detective. If you “enable detective encryption for EBS” while an SCP already denies unencrypted `ec2:RunInstances`, you are paying Config evaluations for a state the API cannot create—except in the **management account**, where SCPs never apply.

Detective is the right tool when:

- The API **must** stay allowed (teams create buckets) but **public** ACLs must be found
- You inherited brownfield resources created before the SCP
- The control cannot be expressed as a coarse Deny without breaking AWS (some IAM and service-linked paths)

## Guardrails that duplicate SCPs

Before enabling a detective control, read the **implementation** column in the Controls library. If it is a Config rule whose resource type is already impossible under an SCP on that OU, skip it on that OU.

Common duplicates:

- Detective “S3 bucket server-side encryption enabled” while a preventive or bucket-default + Deny already forces SSE
- Detective “EC2 instance IMDSv2” while an SCP denies `RunInstances` without `ec2:MetadataHttpTokens=required`—**unless** you still have pre-SCP instances (then keep the detective until they die)
- Detective “no IAM users” while an SCP denies `iam:CreateUser`—keep detective **until** leftover users are gone, then it is hygiene

Keep detectives that SCPs **cannot** cover cheaply:

- **Public access** that used a resource policy SCP never saw (legacy ACL, snapshot `group=all`, AMI launch permission)
- **Security group** `0.0.0.0/0` on 22/3389/5432 (Deny-all SG changes is usually too blunt)
- **Root / IAM user access keys** still present after Identity Center
- **Config / CloudTrail** stopped in a Region CT does not govern
- **EBS snapshot** and **AMI** public sharing (account attributes, not SCPs)

Elective detectives for tags, required-tags, and “this RDS engine version” belong to platform standards, not the security on-call. Put them in a separate Config aggregator or they drown the CT dashboard.

## Config recorder gotchas

Control Tower wants a recorder in each **governed** Region, delivery to the log-archive bucket, and the `aws-controltower-ConfigRecorderRole*` (name may vary by version). Facts that break landing-zone updates:

- **One recorder per Region.** Pre-existing `default` recorder → enrollment error. Stop the recorder, delete the **delivery channel first**, then the recorder—or rewrite them to CT’s role, `recordingGroup`, and global-resource flag.
- **Global IAM resources** should record in the **home Region** only (`GLOBAL_RESOURCE_RECORDING` true there, false elsewhere). Duplicate global recording doubles IAM findings and surprises CT.
- **You cannot have two delivery channels.** A security team’s “Config to our bucket” channel must become CT’s channel or an extra destination via **aggregator / EventBridge**, not a second channel.
- **SCPs that Deny `config:*`** without an exception for the Control Tower execution role cause `AccessDenied` on rules. Allow `aws-controltower-ConfigRecorderRole*` and `AWSControlTowerExecution`.
- **Brownfield drift:** if someone edits the recorder after enroll, CT may not self-heal; re-register the OU after aligning the recorder.

```bash
aws configservice describe-configuration-recorders --region us-east-1
aws configservice describe-delivery-channels --region us-east-1
aws configservice stop-configuration-recorder --configuration-recorder-name default
# delete delivery channel before recorder if you are truly replacing it
```

Do not run a “delete all recorders in all Regions” loop on an account that already has production Config history you need for IR.

## Mapping to attack paths

A detective finding is a **node**, not a path. `AWS-GR_RESTRICTED_SSH` noncompliant on `sg-0abc` matters if an ENI using that SG is internet-reachable and the instance profile can read data. The same finding on an isolated lab VPC is a backlog item.

Join:

1. Config `resourceId` → graph node (SG, bucket, snapshot, user)
2. Edges: `EXPOSED`, `ATTACHED_TO` instance, `INSTANCE_PROFILE` → role, `CAN_ACCESS` data
3. Drop findings with no internet and no data and no admin identity—or park them on a 90-day SLA

That join is [attack path analysis](/blog/attack-path-analysis-cloud-security/) on [the graph](/docs/the-graph/), not Control Tower’s compliance percentage. [Toxic combinations](/blog/toxic-combinations-aws-azure/) are two detective findings that share a workload.

Detective “S3 public” plus CIEM “role can GetObject” is the ticket. Detective “EBS encryption” on an unattached volume in sandbox is not.

[OpenSourceOM](https://github.com/OpenSourceOM/core) can ingest inventory Config already has; do not wait for a CT control named “attack path.”

## Checklist

- [ ] Preventive vs detective vs hook understood; dashboard red ≠ failed Deny
- [ ] Detective catalog trimmed: no Config rules that only restates an SCP on an empty OU
- [ ] Kept: public S3/snapshots/AMIs, open admin ports, IAM user keys, Trail/Config stopped
- [ ] Recorders: one per governed Region, global resources in home Region, CT role can call Config
- [ ] No second delivery channel; extra consumers use aggregator or events
- [ ] Noncompliant resources joined to exposure + identity before they page
- [ ] Management account excluded from “SCP already blocks this” reasoning
---
