---
title: "Amazon CloudFront Security: OAC, TLS, and Origin Lockdown"
description: "Amazon CloudFront security that actually holds: Origin Access Control instead of OAI, HTTPS only, S3 bucket policies that deny non-CloudFront, WAF attachment, and the bypass of hitting the bucket URL directly."
pubDate: 2026-08-29
updatedDate: 2026-08-29
author: OpenSourceOM Team
tags:
  - AWS
  - CloudFront
  - S3
  - WAF
  - TLS
focusKeyword: Amazon CloudFront security
faq:
  - question: If CloudFront is in front of S3, why can I still open the bucket website URL?
    answer: >-
      Because the bucket is still a public (or authenticated) origin. CloudFront
      is a cache, not a lock. Origin Access Control plus a bucket policy that
      allows s3:GetObject only from that distribution’s service principal is
      what stops the bypass. OAI is the legacy version of the same idea.
  - question: Does attaching a WAF to the distribution protect the origin?
    answer: >-
      It protects viewers that go through CloudFront. Anyone who can reach the
      ALB or S3 REST endpoint skips the WAF. Lock the origin to the CloudFront
      prefix list or to OAC. Otherwise WAF is theater.
  - question: Is a custom TLS certificate on the distribution enough?
    answer: >-
      It secures viewer HTTPS. You still need ViewerProtocolPolicy redirect-to-https
      or https-only, a modern TLS policy, and origin protocol https-only if the
      origin speaks TLS. HTTP-only origin plus HTTPS viewers is a decrypt at
      the edge you probably did not intend for APIs.
---

Viewers hit `d111111abcdef8.cloudfront.net` (or your alias). The origin is still an S3 bucket, an ALB, or a custom host. **Amazon CloudFront security** is making the **distribution the only door**: Origin Access Control, HTTPS, and a WAF that actually sits on that door. It is not CloudFront Functions fan-out, not a CDN performance guide, and not [Cloud Armor](/blog/gcp-cloud-armor-security-guide/) (that is GCP). AWS reference: [Restricting access to an origin](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-origin.html).

```
Viewer
  → CloudFront (TLS, WAF, cache)
       → OAC sigv4   → S3 (bucket policy)
       → or HTTPS    → ALB (SG: CloudFront prefix list only)
```

If `bucket.s3.amazonaws.com/secret.pdf` still 200s, the distribution is a convenience URL, not a control.

## 1. Origin Access Control, not a public bucket

**OAI** (legacy canonical user) still works. **OAC** is the current control: CloudFront signs `GetObject` with SigV4, and the bucket policy allows that service principal for **this** distribution.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowCloudFrontOAC",
      "Effect": "Allow",
      "Principal": { "Service": "cloudfront.amazonaws.com" },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::payments-web/*",
      "Condition": {
        "StringEquals": {
          "AWS:SourceArn": "arn:aws:cloudfront::123456789012:distribution/EDFDVBD6EXAMPLE"
        }
      }
    }
  ]
}
```

Block Public Access on the bucket stays **on**. Website hosting on the bucket stays **off** unless you have a written exception—the website endpoint ignores this policy model.

```bash
aws s3api get-bucket-policy --bucket payments-web
aws cloudfront get-distribution-config --id EDFDVBD6EXAMPLE \
  --query 'DistributionConfig.Origins.Items[].OriginAccessControlId'
```

Empty `OriginAccessControlId` and a public ACL is the classic miss. Migrate OAI → OAC with AWS’s documented cutover; do not delete OAI before OAC is serving.

## 2. Viewer TLS and origin protocol

| Setting | Prod default |
| --- | --- |
| `ViewerProtocolPolicy` | `redirect-to-https` or `https-only` |
| `MinimumProtocolVersion` | `TLSv1.2_2021` (or current AWS recommended) |
| Origin `OriginProtocolPolicy` | `https-only` for ALB/custom; S3 REST uses OAC not HTTP origin |

Custom domains need an ACM certificate in **us-east-1** for CloudFront. Alternate domain names without a matching cert fail; do not “fix” that by serving the default `cloudfront.net` name in production emails.

**Failure mode:** `allow-all` viewer policy so a partner’s HTTP health check works. Attackers use HTTP too.

## 3. Lock ALB origins to CloudFront

For an ALB origin, OAC does not apply. Use the **CloudFront managed prefix list** (`com.amazonaws.global.cloudfront.origin-facing`) on the ALB security group, **and** a custom header CloudFront injects that the ALB listener rule requires (or AWS’s origin verify with a secret header). Prefix list alone is necessary but not sufficient if someone copies the prefix list onto another attacker-controlled distribution.

```bash
aws ec2 describe-managed-prefix-lists \
  --filters Name=prefix-list-name,Values=com.amazonaws.global.cloudfront.origin-facing
```

If the ALB SG still allows `0.0.0.0/0` on 443, users and scanners skip CloudFront, skip WAF, and skip your cache behaviors.

## 4. WAF on the distribution

Associate a WAFv2 Web ACL with the distribution, not only with the ALB.

```bash
aws wafv2 list-web-acls --scope CLOUDFRONT --region us-east-1
```

CloudFront WAF is **us-east-1** / global. An ACL on the ALB in `eu-west-1` does not inspect viewers who never reach the ALB because of a cache hit—and does not inspect viewers who hit the ALB directly if you failed step 3.

Start with AWS managed common rule set in **count**, then block. Rate-limit `/login` here; application quotas still belong in the origin ([cloud-native application security](/blog/cloud-native-application-security/)).

## 5. Logging and signed URLs

- **Standard logs** (legacy) or **v2 access logs** to a dedicated bucket with Block Public Access. The log bucket must not be the origin bucket.
- **Signed cookies/URLs** for non-public objects: trusted key groups, short TTL, no `*` in `Resource` for the canned policy if you can avoid it.

Field-level encryption is a niche PCI control; do not enable it because a checklist said “encryption.” It breaks caching and origin parsers if you do not own the private key path.

## Checklist

- [ ] OAC (or documented OAI) on every S3 origin; bucket policy scoped to that distribution ARN
- [ ] S3 Block Public Access on; no static website endpoint for private content
- [ ] Viewer HTTPS-only or redirect; TLS 1.2+ policy
- [ ] ALB SG = CloudFront prefix list + origin secret header (or equivalent)
- [ ] WAFv2 associated on the distribution in us-east-1
- [ ] Access logs in a separate locked bucket
- [ ] Direct origin URL returns 403

A CloudFront distribution with a public S3 origin is still an **internet-reachable object store**. Rank leftover public objects with [attack path analysis](/blog/attack-path-analysis-cloud-security/).

**Related:** [AWS security best practices](/blog/aws-security-best-practices-2026/) · [Cloud-native application security](/blog/cloud-native-application-security/) · [GCP Cloud Armor](/blog/gcp-cloud-armor-security-guide/)
