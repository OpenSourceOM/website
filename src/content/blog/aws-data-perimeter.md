---
title: "AWS Data Perimeter: Which Policy Does Which Deny"
description: "AWS data perimeter means three different denies: other orgs on your resources, your callers off your network, and your callers on other orgs' resources."
pubDate: 2026-09-25
updatedDate: 2026-09-25
author: OpenSourceOM Team
tags:
  - AWS
  - data perimeter
  - SCP
  - RCP
  - VPC endpoints
focusKeyword: AWS data perimeter
faq:
  - question: Can an SCP keep another AWS account out of my bucket?
    answer: >-
      No. An SCP is evaluated for principals in your organization. An
      anonymous caller or another account’s root never walks your SCPs.
      That deny belongs on the resource: an RCP or a bucket policy using
      aws:PrincipalOrgID. The SCP is for what your own principals may do.
  - question: Which perimeter stops my credentials reading a bucket in another org?
    answer: >-
      The resource perimeter. It is an SCP on your accounts that denies
      the call when aws:ResourceOrgID is present and is not your org.
      An RCP on the foreign account cannot help you; you do not control it.
  - question: Do VPC endpoints replace the identity and resource perimeters?
    answer: >-
      No. An endpoint policy can require your org and your VPCE, which is
      the network half. A caller with valid keys can still use the public
      AWS API from a laptop unless an SCP says the credentials only work
      from that endpoint. You want both.
---

An **AWS data perimeter** is three denies, and they are not the same policy type. Mixing them up is how a team attaches an SCP and calls the bucket private.

| Perimeter | Question | Policy that can say no | Condition |
| --- | --- | --- | --- |
| Identity | May *their* principal touch *my* resource? | RCP or resource policy | `aws:PrincipalOrgID` |
| Resource | May *my* principal touch *their* resource? | SCP | `aws:ResourceOrgID` |
| Network | May this call happen from outside *my* network? | SCP on the caller, endpoint policy on the path | `aws:SourceVpce`, `aws:SourceIp` |

The identity-perimeter JSON for S3 (org-only callers, service-principal exception) is already on the [RCP](/blog/aws-resource-control-policies-rcp/) page. Gateway versus interface endpoints, and why NAT is not a perimeter, is [VPC endpoints vs NAT](/blog/aws-vpc-endpoints-vs-nat-security/). This page is which statement goes where. The whitepaper is [Building a data perimeter on AWS](https://docs.aws.amazon.com/whitepapers/latest/building-a-data-perimeter-on-aws/building-a-data-perimeter-on-aws.html).

## Identity perimeter is not an SCP

Your SCP never runs for `arn:aws:iam::999999999999:root` or for an unsigned request. If the goal is “only my org reads my buckets,” the deny has to sit on the bucket’s side. That is an RCP (org-enforced, so a member admin cannot delete it) or a bucket policy (the member admin can). Use the RCP. Keep [S3 Block Public Access](/blog/aws-s3-bucket-security-hardening/) as well; BPA and `PrincipalOrgID` fail in different cases.

Exception you must write down: CloudTrail, Config, and replication call as AWS services. A deny on `PrincipalOrgID` without `aws:PrincipalIsAWSService` stops log delivery. The RCP page has that exception. Do not invent a second copy with a typo in the org id.

## Resource perimeter is an SCP

This is the control the RCP does not implement. It stops *your* access keys from reading someone else’s bucket or assuming a role in a personal account.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyForeignOrgResources",
      "Effect": "Deny",
      "NotAction": [
        "iam:*",
        "organizations:*",
        "account:*",
        "sts:GetCallerIdentity"
      ],
      "Resource": "*",
      "Condition": {
        "StringNotEqualsIfExists": {
          "aws:ResourceOrgID": "o-xxxxxxxxxx"
        },
        "Null": { "aws:ResourceOrgID": "false" },
        "BoolIfExists": { "aws:PrincipalIsAWSService": "false" }
      }
    }
  ]
}
```

`Null` / `false` means the deny applies only when `aws:ResourceOrgID` is present. Calls that do not carry a resource org id (some IAM and STS actions, which is why those actions are also in `NotAction`) are not accidentally denied. `StringNotEqualsIfExists` alone is not the same statement.

Attach it to a sandbox OU first, the same way you test an RCP. Then try, from that account:

1. `s3:GetObject` on a bucket in the org. Expect success.
2. `s3:GetObject` on a bucket you own in a different org (a lab account). Expect deny.
3. `sts:GetCallerIdentity`. Expect success.

A partner bucket that *should* be readable needs an explicit exception (`aws:ResourceAccount` in an allow-list on a second statement), not a hole in the org-wide deny. Vendors that say “just hand us an access key” are asking you to disable this.

## Network perimeter is both

Two directions:

- **My credentials, only from my network.** SCP on member accounts: deny if `aws:SourceVpce` is not in your endpoint list and the caller is not an AWS service (`aws:ViaAWSService`). A stolen key on a laptop then fails even though the identity policy still allows `s3:GetObject`.
- **My network, only to my resources.** Endpoint policy on the S3 gateway and the STS interface. That document is the VPC-endpoint post, not this one.

Skipping the SCP and only adding endpoints leaves the public API open. Stolen keys do not have to use your VPC. Skipping the endpoints and only adding the SCP breaks the app unless every call already originates inside the VPC. Order it: endpoints first so the app still works, then the SCP in the sandbox OU, then prod.

`aws:SourceIp` is the fallback for humans on a corporate NAT, not for workloads. Workloads should match an endpoint id. A `0.0.0.0/0` source-ip exception is the perimeter deleted.

## What a perimeter does not rank

These denies are org guardrails. They do not tell you which *inside* role can still read the payment bucket. That is [CIEM](/blog/ciem-explained-for-cloud-teams/) and [multi-account attack paths](/blog/multi-account-aws-attack-paths/). A principal in your org, from your VPC, touching your bucket, with `s3:*`, is inside every perimeter and still a problem.

## Checklist

- [ ] Identity perimeter: RCP (or resource policy) with `aws:PrincipalOrgID`, service-principal exception tested with CloudTrail
- [ ] Resource perimeter: SCP with `aws:ResourceOrgID` tested against a foreign-org bucket
- [ ] Network perimeter: endpoint path exists before the SCP denies non-VPCE calls
- [ ] Sandbox OU first; management account is not covered by RCP or SCP
- [ ] Partner accounts are named exceptions, not a removed statement
- [ ] Inside-org `s3:*` still reviewed; the perimeter will not flag it

Three denies, three attachments. An SCP titled “data perimeter” that only denies `s3:PutBucketPublicAccessBlock` is a different control.
