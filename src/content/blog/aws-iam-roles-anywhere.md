---
title: "IAM Roles Anywhere: Certificates Instead of Access Keys"
description: "IAM Roles Anywhere exchanges an X.509 certificate for short-lived STS credentials. Trust anchors, CN conditions, and revoked certs that still work."
pubDate: 2026-09-25
updatedDate: 2026-09-25
author: OpenSourceOM Team
tags:
  - AWS
  - IAM Roles Anywhere
  - X.509
  - workload identity
  - CIEM
focusKeyword: IAM Roles Anywhere
faq:
  - question: When should I use IAM Roles Anywhere instead of OIDC?
    answer: >-
      When the workload is a host or process that already has a certificate
      from a CA you run, and it is not GitHub, GitLab, or a cloud identity
      provider. CI systems should keep OIDC. Roles Anywhere is for the
      machine that cannot mint an IdP JWT.
  - question: Does the trust anchor grant the IAM role?
    answer: >-
      No. The trust anchor says which CA AWS will accept. The profile lists
      which roles those certs may assume. The role trust policy can still
      require a CN, SAN, or OU tag. A CA that also issues laptop certificates
      with no condition on the role is every laptop in that PKI.
  - question: Does Roles Anywhere notice a revoked certificate?
    answer: >-
      Only if you publish a CRL that the trust anchor is configured to use,
      or you remove the certificate another way. A trust anchor with no CRL
      honors the cert until it expires. Revocation in your internal CA does
      nothing AWS has not been told about.
---

```ini
# ~/.aws/config on the host — no AKIA in the file
[profile payments]
credential_process = aws_signing_helper credential-process
  --certificate /etc/payments/tls.crt
  --private-key /etc/payments/tls.key
  --trust-anchor-arn arn:aws:rolesanywhere:us-east-1:123456789012:trust-anchor/ta-id
  --profile-arn arn:aws:rolesanywhere:us-east-1:123456789012:profile/profile-id
  --role-arn arn:aws:iam::123456789012:role/onprem-payments
```

**IAM Roles Anywhere** is that credential process: the host signs with its private key, Roles Anywhere checks the cert against a trust anchor, and STS returns a session. The private key never becomes an AWS access key. CI that can already present a JWT should use [GitHub Actions OIDC](/blog/github-actions-oidc-aws-iam/) or [GitLab on GCP](/blog/gitlab-ci-workload-identity-gcp/) instead of standing up a CA to avoid a key.

Setup is a trust anchor, a profile, and a role. The API shape is in [IAM Roles Anywhere](https://docs.aws.amazon.com/rolesanywhere/latest/userguide/introduction.html).

## Trust anchor and profile

A trust anchor is either an AWS Private CA or an external CA bundle you upload. It answers one question: which issuer is allowed to vouch for callers. It does not list permissions.

```bash
aws rolesanywhere create-trust-anchor \
  --name onprem-ca \
  --source '{"sourceType":"CERTIFICATE_BUNDLE","sourceData":{"x509CertificateData":"'"$(cat ca.pem)"'"}}'

aws rolesanywhere create-profile \
  --name payments-hosts \
  --role-arns arn:aws:iam::123456789012:role/onprem-payments \
  --duration-seconds 3600
```

The profile is the allowlist of roles and the session length. Session duration is the minimum of the profile, the role’s max session, and the certificate’s remaining lifetime. A cert that expires in ten minutes does not get a one-hour session.

Attribute mapping on the profile copies certificate fields into session tags (`x509Subject/CN`, issuer, SAN). The role trust condition below only works if that mapping actually emits the tag. An empty mapping plus a CN condition fails every assume. A wide mapping and no condition lets every cert from the anchor assume the role.

## Role trust

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "rolesanywhere.amazonaws.com" },
      "Action": ["sts:AssumeRole", "sts:TagSession", "sts:SetSourceIdentity"],
      "Condition": {
        "ArnEquals": {
          "aws:SourceArn": "arn:aws:rolesanywhere:us-east-1:123456789012:trust-anchor/ta-id"
        },
        "StringEquals": {
          "aws:PrincipalTag/x509Subject/CN": "payments-host-01"
        }
      }
    }
  ]
}
```

`aws:SourceArn` pins the trust anchor. A second anchor in the same account must not satisfy this role. The CN condition pins the certificate. Prefer a SAN or OU your CA reserves for servers (`OU=payments-prod`) over a CN a human enrollment flow can also request.

Do not point the profile at a role that can `iam:CreateUser` or `sts:AssumeRole` to admin. The certificate is the principal. The role policy is still the blast radius, which is [CIEM](/blog/ciem-explained-for-cloud-teams/) once the session exists.

## Revocation

Roles Anywhere does not query your CA’s OCSP imagination. You attach a CRL distribution, or you do not have revocation.

Failure modes:

- Internal CA marks the cert revoked, CRL not configured on the anchor, cert not yet expired. AWS still issues sessions.
- CRL published, but the anchor was created before you set it, and nobody updated the anchor.
- Shared private key on a golden image. Revoking one serial does not pull the key off the other twenty clones. Do not bake the key into an AMI.

Disable the profile or remove the role from it when you decommission the fleet. Deleting the host is not an IAM event.

## What not to mix

| Caller | Use |
| --- | --- |
| GitHub Actions, GitLab CI | OIDC (`AssumeRoleWithWebIdentity`) |
| Azure or GCP workload | That cloud’s federation, not a cert you also use for TLS |
| Human laptop | Identity Center. Not Roles Anywhere with the user CA |
| On-prem host with a machine cert | Roles Anywhere |

A trust anchor that is your corporate issuing CA, with a profile that allows `AdministratorAccess`, is a domain-joined laptop away from the org. Split issuing CAs: one for humans, one for the hosts that may assume AWS roles. Condition the role on the host CA’s OU.

## Checklist

- [ ] Trust anchor is a dedicated machine CA, not the CA that issues laptop certs
- [ ] Profile role list is the one app role; duration is hours, not the maximum
- [ ] Role trust conditions `aws:SourceArn` (the anchor) and a cert tag you verified is mapped
- [ ] CRL configured and tested by revoking a lab cert and confirming AssumeRole fails
- [ ] Private keys are per host, not in an AMI or a config-management secret everyone can read
- [ ] No long-lived access keys left on the host “as backup”

The helper removed the AKIA key. It did not choose a small role, and it will not hear about revocation you did not publish.
