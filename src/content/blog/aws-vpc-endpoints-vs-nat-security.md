---
title: "VPC Endpoints vs NAT: Security and Data Paths"
description: "VPC endpoint vs NAT gateway security is not a cost conversation. NAT still egresses to public AWS APIs; gateway vs interface endpoints; endpoint policies as IAM; put S3 and STS on private paths first."
pubDate: 2026-08-27
updatedDate: 2026-08-27
author: OpenSourceOM Team
tags:
  - AWS
  - VPC
  - PrivateLink
  - NAT gateway
  - data perimeter
focusKeyword: VPC endpoint vs NAT gateway security
faq:
  - question: Does NAT to S3 keep traffic off the internet?
    answer: >-
      Packets still leave the VPC through the internet gateway to the public
      S3 endpoint. They may stay on the AWS backbone after that, but you have
      no endpoint policy, no vpce condition, and the instance needs a route to
      0.0.0.0/0. That is not a data perimeter. A gateway endpoint plus a bucket
      policy that requires aws:SourceVpce is.
  - question: Why start with S3 and STS instead of every AWS service?
    answer: >-
      S3 is usually the bulk of NAT bytes and the bulk of exfil. STS is how
      every SDK refreshes credentials; if you lock S3 to a gateway endpoint
      and leave STS on NAT, sessions still depend on 0.0.0.0/0. Gateway S3
      (free) plus interface STS (one ENI per AZ) is the minimum private path
      for most app roles.
  - question: Can a gateway endpoint policy use Principal other than star?
    answer: >-
      Gateway endpoint policies require Principal "*". Restrict with
      conditions (aws:PrincipalOrgID, aws:PrincipalArn, aws:ResourceOrgID).
      Interface endpoints can combine that IAM-style document with security
      groups on the ENI.
  - question: Will endpoints break Windows activation or yum?
    answer: >-
      Those are not AWS APIs. If you remove the default route to NAT, you
      must keep NAT or a proxy for non-AWS destinations, or add the specific
      endpoints those OSes need. Private AWS APIs and “no internet” are
      different designs.
---

A NAT gateway with a 4 TB bill is often **S3 GetObject** and **ECR pull**, not “the internet.” Those calls hit **public AWS service endpoints**. **VPC endpoint vs NAT gateway security** is whether the data path can be constrained with IAM, not whether AWS’s backbone is somehow untrusted.

This is VPC routing and endpoint policies. Org IAM guardrails are [AWS security best practices](/blog/aws-security-best-practices-2026/). Identity remaining after a path exists is [CIEM](/blog/ciem-explained-for-cloud-teams/).

```
Private subnet ──► NAT GW ──► IGW ──► public s3.amazonaws.com
     (0.0.0.0/0)                         no vpce policy

Private subnet ──► gateway vpce (pl-xxxx → vpce-s3)
     (prefix list route)                 endpoint policy + bucket aws:SourceVpce
```

## What NAT still exposes

NAT hides instance private IPs behind the NAT EIP. It does **not**:

- Stop a compromised task from `PutObject` to an attacker-owned bucket (if the role allows `s3:PutObject` on `*`)
- Give you a place to attach an **endpoint policy**
- Remove the need for a **default route** to the IGW (attackers and exfil use the same route as `yum`)
- Bind calls to **your** org’s buckets

Interface “firewall in front of NAT” still fronts the **public** API. Useful for DNS filtering; it is not `aws:SourceVpce`.

If the subnet has `0.0.0.0/0 → nat-…`, assume every package with network access can reach the public AWS API **and** the rest of the internet, subject only to NACL/SG and IAM. [Zero trust](/blog/zero-trust-cloud-architecture-guide/) that trusts “private subnet” is this diagram.

Failure mode: “we disabled public IPs” while NAT remains. That is expected. It is not private AWS access.

## Gateway vs interface endpoints

| | Gateway | Interface (PrivateLink) |
| --- | --- | --- |
| Services | **S3 and DynamoDB** (same Region) | STS, ECR, KMS, Secrets Manager, logs, … and S3 if you need on-prem |
| How it works | Prefix-list **route** in route tables | ENI in a subnet, private IP, optional private DNS |
| Cost | No hourly / GB charge for the endpoint | Hourly per AZ + data processing |
| Security groups | No | Yes, on the ENI |
| From on-prem / peered VPC | No (must originate in this VPC) | Yes, if routed to the ENI |
| Endpoint policy | Yes (Principal must be `"*"`) | Yes |

Use **gateway S3** for in-VPC workloads. Add **interface S3** only if Direct Connect clients must hit S3 without NAT. DynamoDB: gateway unless you have the same on-prem constraint.

Interface endpoints need **private DNS** (or SDK endpoint overrides) or applications keep resolving the public hostname and go back to NAT.

```bash
# Gateway S3 — attach every private route table that used to NAT to S3
aws ec2 create-vpc-endpoint \
  --vpc-id vpc-0abc \
  --vpc-endpoint-type Gateway \
  --service-name com.amazonaws.us-east-1.s3 \
  --route-table-ids rtb-aaa rtb-bbb

# Interface STS — one subnet per AZ you run tasks in
aws ec2 create-vpc-endpoint \
  --vpc-id vpc-0abc \
  --vpc-endpoint-type Interface \
  --service-name com.amazonaws.us-east-1.sts \
  --subnet-ids subnet-a subnet-b \
  --security-group-ids sg-vpce-sts \
  --private-dns-enabled
```

SG on the STS endpoint: ingress 443 from the app SGs only, not `0.0.0.0/0` on the ENI “because it is private.”

## Endpoint policies as IAM

An endpoint policy is a **resource-based ceiling** on what that path will forward. It never grants. Identity policy + resource policy (bucket, KMS, …) still must Allow.

Example gateway S3 policy: only buckets in this org, only principals in this org:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "OrgBucketsOrgPrincipals",
      "Effect": "Allow",
      "Principal": "*",
      "Action": ["s3:*"],
      "Resource": "*",
      "Condition": {
        "StringEquals": {
          "aws:PrincipalOrgID": "o-xxxxxxxxxx",
          "aws:ResourceOrgID": "o-xxxxxxxxxx"
        }
      }
    }
  ]
}
```

Tighten further with `s3:GetObject` only, or named bucket ARNs. Then **bucket policies** require `aws:SourceVpce` = this endpoint ID (or `aws:SourceVpc`) so NAT/public path cannot read even if someone attaches an IGW route again.

STS interface policy: allow `sts:AssumeRole` / `AssumeRoleWithWebIdentity` for roles in the org; deny `sts:GetSessionToken` for IAM users if you have no IAM users.

Failure mode: default endpoint policy `Allow *` on `*`. You paid for PrivateLink and got a private shortcut to **any** S3 bucket the role can already access—including the attacker’s. The NAT path had the same IAM; the endpoint path is where you were supposed to **narrow**.

## S3 and STS first

Order of operations that does not page the fleet:

1. **Gateway S3** on app route tables. Watch NAT bytes drop. Fix SDK retries (new connections after the prefix-list route appears).
2. **Interface STS** before you delete NAT. Credential refresh must not depend on the IGW.
3. **ECR** (API + DKR) interface endpoints if nodes pull images; otherwise image pulls keep NAT alive.
4. **Logs / monitoring** (logs, monitoring, ec2messages/ssmmessages if you use SSM).
5. Only then consider removing `0.0.0.0/0` for subnets that must not reach non-AWS.

KMS and Secrets Manager belong next if those APIs are on the hot path; they are not bigger exfil than S3.

If you skip STS, the first instance profile rotation after you “lock S3 to vpce” fails in confusing `ExpiredToken` / timeout ways. If you skip S3, you did not change the security story, only the invoice.

Map remaining `s3:*` on roles with [CIEM](/blog/ciem-explained-for-cloud-teams/). Endpoint policies do not replace identity. Graph the path ([the graph](/docs/the-graph/)): workload → vpce → bucket, versus workload → NAT → any bucket.

## Checklist

- [ ] Gateway endpoints for S3 (and DynamoDB) on every private route table that used NAT for those APIs
- [ ] Interface STS with private DNS; SG allows 443 only from app tiers
- [ ] Endpoint policies are not `Allow *`/`*`; org or bucket ARN conditions
- [ ] Bucket (and KMS) policies require `aws:SourceVpce` or `aws:SourceVpc` where the design is private-only
- [ ] ECR / logs endpoints before claiming “no NAT”
- [ ] NAT remains only for non-AWS destinations, or is gone with an explicit allow-list
- [ ] Roles that can `s3:PutObject` on `*` still get CIEM tickets; the endpoint did not fix that
---
