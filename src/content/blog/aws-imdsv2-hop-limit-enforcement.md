---
title: "Enforce IMDSv2 and Hop Limit 1 on EC2"
description: "IMDSv2 hop limit 1 stops SSRF and container theft of instance-profile keys. CLI, launch templates, account defaults, SCPs, and the failure modes that send hop limit back to 2."
pubDate: 2026-08-27
updatedDate: 2026-08-27
author: OpenSourceOM Team
tags:
  - AWS
  - EC2
  - IMDSv2
  - IAM
  - instance metadata
focusKeyword: IMDSv2 hop limit
faq:
  - question: Does requiring IMDSv2 without changing hop limit stop SSRF?
    answer: >-
      It blocks the classic IMDSv1 GET of credentials. A server-side request that
      can issue PUT /latest/api/token and then GET with the token can still
      retrieve credentials if the hop limit allows the PUT response back through
      an extra hop. Hop limit 1 is what keeps the token from traversing proxies
      and most container bridges.
  - question: Why do ECS and EKS teams set hop limit to 2?
    answer: >-
      Docker bridge and some CNI paths count as an extra hop, so the PUT token
      never reaches the container at hop 1. Use task roles and EKS Pod Identity
      or IRSA instead of reading the instance profile from the container. Do not
      raise hop limit org-wide to make a debug sidecar work.
  - question: Can I set this on running instances without a reboot?
    answer: >-
      Yes. modify-instance-metadata-options applies HttpTokens and
      HttpPutResponseHopLimit without a stop/start. Processes still calling
      IMDSv1 fail as soon as HttpTokens is required. Test that before an SCP
      denies launching IMDSv1 instances.
  - question: Is user-data protected by IMDSv2?
    answer: >-
      No. Anyone who can complete the IMDSv2 handshake still reads user-data.
      Keep secrets out of user-data. Hop limit only limits which hops can obtain
      the session token, not what the metadata documents contain.
---

The Instance Metadata Service still answers at `169.254.169.254`. If an application can be tricked into fetching it, the JSON from `/latest/meta-data/iam/security-credentials/<role>` is a set of temporary keys for whatever the instance profile can do. **IMDSv2 hop limit** is the TTL on the session-token **PUT**—the part SSRF and nested namespaces were designed to fail.

Org-level IAM (Identity Center, SCPs, CloudTrail) is [AWS security best practices](/blog/aws-security-best-practices-2026/). This page is **metadata options on EC2**. After keys leak, ranking what the role reaches is [attack path analysis](/blog/attack-path-analysis-cloud-security/).

## What IMDS leaks

Anything the instance is allowed to know about itself:

- **IAM credentials** for the attached instance profile (the prize)
- **User-data** (cloud-init scripts, often still containing tokens)
- **AMI ID, hostname, MAC, local IPv4**, placement, identity document
- **Tags** if `HttpInstanceTags` / instance metadata tags are enabled

Network reachability to 169.254.169.254 is local to the guest (and to processes that share its network namespace). It is not a security group problem. Blocking IMDS in iptables on the host is a backup; AWS’s hop limit is the control that survives a compromised web process.

```bash
# IMDSv1 (should fail once HttpTokens=required)
curl -s http://169.254.169.254/latest/meta-data/iam/security-credentials/

# IMDSv2
TOKEN=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" \
  -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")
curl -s -H "X-aws-ec2-metadata-token: $TOKEN" \
  http://169.254.169.254/latest/meta-data/iam/security-credentials/
```

If the first command returns a role name, you are on IMDSv1.

## IMDSv1 vs v2

| | IMDSv1 | IMDSv2 |
| --- | --- | --- |
| Credential fetch | HTTP GET | PUT token, then GET with header |
| SSRF | Trivial (open redirect / URL fetch) | Attacker must send PUT; many SSRF gadgets cannot |
| Session | None | Token TTL (seconds to 6 hours) |
| Hop control | None | `HttpPutResponseHopLimit` on the PUT response |

`HttpTokens=optional` is IMDSv1 still on. `required` is v2-only. There is no “v2 preferred” that blocks v1.

AWS documents the hop limit as 1–64. **Default for many launches is 1.** AMIs with `imds-support=v2.0` may try to set hop 2; **account-level defaults override the AMI** for hop limit. Launch-time `--metadata-options` override both.

## Hop limit 1 vs containers

Hop limit is IP TTL for the **token PUT response**. The instance’s own processes see hop 1. A **Docker bridge** or extra netns is usually hop 2: the container never gets the token, retries, then some agents fall back to v1 if you left `HttpTokens=optional`.

That is not an argument for hop 2 on every node.

| Workload | Credential source | Hop limit |
| --- | --- | --- |
| Bare EC2 / systemd app | Instance profile | **1** |
| ECS awsvpc / task ENI | Task role (not IMDS of the host, if configured) | Keep host at **1** |
| ECS bridge | Often needs 2 *if* the task still uses the instance profile | Prefer task role; do not use the node role |
| EKS | IRSA or Pod Identity | Node hop **1**; pods should not need host IMDS |

Pods that need AWS APIs should not curl 169.254.169.254 on the node. If a DaemonSet still does, that is a DaemonSet bug, not a reason to set hop 64.

```bash
aws ec2 modify-instance-metadata-options \
  --instance-id i-0123456789abcdef0 \
  --http-tokens required \
  --http-put-response-hop-limit 1 \
  --http-endpoint enabled
```

`--http-endpoint enabled` is required by the API when you set hop limit. No reboot.

## Org-wide enforcement (SCP + launch templates)

Three layers; miss one and ASG refresh relaunches v1.

**1. Account / Region defaults** (new instances that omit metadata options):

```bash
aws ec2 modify-instance-metadata-defaults \
  --http-tokens required \
  --http-put-response-hop-limit 1 \
  --http-endpoint enabled
```

This is per Region. Repeat in every Region you launch. It does not mutate existing instances.

**2. Launch templates** used by ASGs, Batch, Elastic Beanstalk, EKS node groups:

```bash
aws ec2 create-launch-template-version \
  --launch-template-id lt-0123456789abcdef0 \
  --source-version '$Latest' \
  --launch-template-data '{
    "MetadataOptions": {
      "HttpTokens": "required",
      "HttpPutResponseHopLimit": 1,
      "HttpEndpoint": "enabled"
    }
  }'
```

Pin the ASG to that version. `$Default` that still points at an old version is how hop 2 comes back.

**3. SCP** on workload OUs (not the management account). Deny `ec2:RunInstances` unless `ec2:MetadataHttpTokens` is `required`, and deny hop greater than 1:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "RequireImdsV2",
      "Effect": "Deny",
      "Action": "ec2:RunInstances",
      "Resource": "arn:aws:ec2:*:*:instance/*",
      "Condition": {
        "StringNotEquals": {
          "ec2:MetadataHttpTokens": "required"
        }
      }
    },
    {
      "Sid": "MaxHopLimit1",
      "Effect": "Deny",
      "Action": "ec2:RunInstances",
      "Resource": "arn:aws:ec2:*:*:instance/*",
      "Condition": {
        "NumericGreaterThan": {
          "ec2:MetadataHttpPutResponseHopLimit": "1"
        }
      }
    }
  ]
}
```

Attach to a **sandbox OU** first. Spot Fleet, SageMaker notebooks, and some marketplace AMIs omit metadata options and will fail closed—that is the point. Exception roles go in the condition, not a hole at the org root.

Existing instances: Config rule `ec2-imdsv2-check` plus a periodic `describe-instances` query on `MetadataOptions`. SCP does not retrofit.

## Failure modes that leave IMDS open

- **Hop 2 “for Kubernetes”** on the node group template. Every pod on the host network or with hostPID can often still reach IMDS; hop 2 also helps SSRF that goes through a local proxy.
- **`HttpTokens=required` but hop 64.** v2 handshake succeeds from extra hops. You blocked 2019 SSRF, not 2022 SSRF.
- **SCP Deny on RunInstances only.** `modify-instance-metadata-options` can still raise hop limit unless you Deny that API except a break-glass role.
- **Beanstalk / ECS Docker platform** user-data that calls `modify-instance-metadata-options --http-put-response-hop-limit 2` after launch. Hunt that in launch user-data and `.ebextensions`.
- **Instance profile still `AdministratorAccess`.** IMDS hardening without [CIEM](/blog/ciem-explained-for-cloud-teams/) means a successful steal is still game over. Pair with [toxic combinations](/blog/toxic-combinations-aws-azure/) (internet app + fat profile).

## Checklist

- [ ] `HttpTokens=required` and hop limit **1** on running instances (`modify-instance-metadata-options`)
- [ ] Account defaults in every launch Region
- [ ] Launch templates / node groups / ASGs pinned to a version with those options
- [ ] SCP Deny for v1 launches and hop > 1, tested in sandbox OU
- [ ] Deny `ec2:ModifyInstanceMetadataOptions` except break-glass
- [ ] Containers use task role / IRSA / Pod Identity, not host IMDS
- [ ] User-data contains no long-lived secrets
- [ ] Instance profiles are not admin; remaining exposure goes on the attack-path queue
---
