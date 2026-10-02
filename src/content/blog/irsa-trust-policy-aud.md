---
title: "IRSA Trust Policy aud Mistakes"
description: "The IRSA aud claim is sts.amazonaws.com and does not name the cluster. Wrong condition keys, a second audience on the OIDC provider, and a trust policy that only checks sub."
pubDate: 2026-10-02
updatedDate: 2026-10-02
author: OpenSourceOM Team
tags:
  - EKS
  - IRSA
  - IAM
  - OIDC
  - Kubernetes
focusKeyword: IRSA trust policy aud
faq:
  - question: What should the IRSA trust policy aud condition equal?
    answer: >-
      The condition key is the cluster OIDC issuer host plus :aud, and the
      value is sts.amazonaws.com unless the service account sets
      eks.amazonaws.com/audience to something else. The same value on every
      cluster is normal. The cluster id lives in the issuer host, not in aud.
  - question: Why does AssumeRoleWithWebIdentity return Incorrect token audience?
    answer: >-
      STS compared the token aud to the IAM OIDC provider ClientIDList and
      it was not listed. That check happens before the role trust policy.
      Adding :aud to the trust policy does not fix a provider whose client
      id list is missing sts.amazonaws.com.
  - question: Is a trust policy that only checks sub safe if ClientIDList is sts.amazonaws.com?
    answer: >-
      Only while that list stays a single audience. STS rejects tokens whose
      aud is not in ClientIDList. The day a second audience is added to the
      provider, every role that forgot :aud will accept it. Pin :aud with
      StringEquals on the role anyway.
---

`AssumeRoleWithWebIdentity` failed. The token in the pod has `"aud": "sts.amazonaws.com"` and `"sub": "system:serviceaccount:payments:payments-api"`. The trust policy also says `aud`. The condition key is the bare string `aud`, so IAM never compares it to the token. That role is not assumable, and the line that looks like a security control is not one.

**IRSA trust policy aud** is the `:aud` condition on `sts:AssumeRoleWithWebIdentity`. How the projected token is mounted is [projected service account tokens](/blog/kubernetes-projected-service-account-tokens/). Pod Identity uses a different principal and does not use this claim — [EKS Pod Identity vs IRSA](/blog/eks-pod-identity-vs-irsa/). This page is the `aud` mistakes on the IRSA document.

Issuer setup and the trust shape: [IAM roles for service accounts](https://docs.aws.amazon.com/eks/latest/userguide/iam-roles-for-service-accounts.html).

## The condition that matches

```json
{
  "Effect": "Allow",
  "Principal": {
    "Federated": "arn:aws:iam::123456789012:oidc-provider/oidc.eks.us-east-1.amazonaws.com/id/EXAMPLED539D4633E53DE1B71EXAMPLE"
  },
  "Action": "sts:AssumeRoleWithWebIdentity",
  "Condition": {
    "StringEquals": {
      "oidc.eks.us-east-1.amazonaws.com/id/EXAMPLED539D4633E53DE1B71EXAMPLE:aud": "sts.amazonaws.com",
      "oidc.eks.us-east-1.amazonaws.com/id/EXAMPLED539D4633E53DE1B71EXAMPLE:sub": "system:serviceaccount:payments:payments-api"
    }
  }
}
```

The key prefix is the issuer host with no `https://`. It is the same string as `cluster.identity.oidc.issuer` after that prefix is stripped. `:aud` and `:sub` are claims on that provider. A key named `aud` is a different key, and it is not in this request, so `StringEquals` on it does not match. The API error is `AccessDenied` / not authorized to perform `sts:AssumeRoleWithWebIdentity`, which is a trust-policy miss.

`InvalidIdentityToken` / `Incorrect token audience` is earlier. STS compares the token’s `aud` to the OIDC provider’s `ClientIDList` before the role document runs.

```bash
aws iam get-open-id-connect-provider \
  --open-id-connect-provider-arn "$PROVIDER_ARN" \
  --query 'ClientIDList'
```

That list has to include `sts.amazonaws.com` for a default IRSA token. Putting `:aud` in the trust policy does not add it here.

## aud does not name the cluster

Every default IRSA token carries `aud` of `sts.amazonaws.com`. Cluster A and cluster B both do. The cluster is the id in the issuer:

```text
https://oidc.eks.us-east-1.amazonaws.com/id/EXAMPLED539D4633E53DE1B71EXAMPLE
```

A copied trust policy that still points `Principal.Federated` and the condition prefix at cluster A’s issuer will not match a token whose `iss` is cluster B. Fixing only the `:aud` value changes nothing, because the value was already `sts.amazonaws.com`.

The loose copy is the dangerous one: two `Federated` principals, `:aud` set, and `:sub` of `system:serviceaccount:*:*` under `StringLike`. Any service account in either cluster can assume the role. The `aud` line is identical to a locked-down role, so a review that only checks “aud is sts.amazonaws.com” passes it. `:sub` is the service account. `:aud` is the intended consumer of the token. The issuer host is the cluster.

## ClientIDList is the first aud check

STS rejects a JWT whose `aud` is not in the provider `ClientIDList`, with `Incorrect token audience`. The in-cluster token mounted for the API server has `aud` of `https://kubernetes.default.svc` and the same `iss` and `sub`. With a provider that lists only `sts.amazonaws.com`, that API token cannot assume the role even if the trust policy forgot `:aud`.

That protection disappears when someone adds a second audience to the provider:

- `eks.amazonaws.com/audience` set on a service account to a private string, and that string added to `ClientIDList` so the pod can assume one role
- a vendor’s audience added to the same provider
- `https://kubernetes.default.svc` added while debugging “Incorrect token audience”

Every role on that provider whose trust policy checks only `:sub` now accepts tokens minted for the new audience. `StringEquals` on `:aud` is what keeps those roles on `sts.amazonaws.com`. `StringEqualsIfExists` is the wrong operator: a token that omits `aud` makes the condition pass. Use `StringEquals`.

Do not add `https://kubernetes.default.svc` to `ClientIDList`. That is the API-server audience. Combined with a trust policy that has no `:aud` key, the default projected token becomes a cloud credential.

## Custom audience annotation

The webhook reads `eks.amazonaws.com/audience` on the service account. Omitted, the projected token’s `aud` is `sts.amazonaws.com`.

```yaml
metadata:
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::123456789012:role/payments-api
    eks.amazonaws.com/audience: sts.amazonaws.com
```

If you set a different audience, three places have to carry the same string:

1. The annotation (what the webhook asks the API server to mint)
2. The provider `ClientIDList` (what STS will accept at all)
3. The trust policy `:aud` value (what this role will accept)

Annotation changed, trust policy still `sts.amazonaws.com`: `AccessDenied` on the role. Annotation changed, `ClientIDList` not updated: `Incorrect token audience`. Annotation left at the default and the trust policy updated to a custom string: `AccessDenied` again. Decode the file the SDK is actually sending before editing the third place.

```bash
cut -d. -f2 < "$AWS_WEB_IDENTITY_TOKEN_FILE" \
  | tr '_-' '/+' | base64 -d 2>/dev/null \
  | jq '{iss,aud,sub}'
```

`iss` must be your cluster’s issuer. `aud` must be the trust policy value and a member of `ClientIDList`. `sub` must be `system:serviceaccount:<namespace>:<name>` with that namespace and name, not a wildcard you meant to tighten later.

A second statement on the same role that checks only `:sub`, left in place “for Terraform,” accepts every audience the provider lists. Delete that statement. Pod Identity’s trust (`pods.eks.amazonaws.com`, `sts:AssumeRole`, `sts:TagSession`) is not an `aud` statement; leaving the IRSA statement beside it keeps the OIDC door open after you add an association.

## Checklist

- [ ] `:aud` key is `<issuer-host>:aud`, not `aud`
- [ ] `:aud` value is `StringEquals` `sts.amazonaws.com`, or the custom audience on all three of annotation, `ClientIDList`, and trust policy
- [ ] `:sub` is one `system:serviceaccount:namespace:name`, not `StringLike` `*:*`
- [ ] `Federated` principal and the condition prefix are this cluster’s issuer id
- [ ] `ClientIDList` includes `sts.amazonaws.com` and does not include `https://kubernetes.default.svc`
- [ ] No second statement on the role allows `AssumeRoleWithWebIdentity` without `:aud`
- [ ] Decoded `AWS_WEB_IDENTITY_TOKEN_FILE` matches `iss`, `aud`, and `sub` before the trust policy is rewritten again

**Related:** [EKS Pod Identity vs IRSA](/blog/eks-pod-identity-vs-irsa/) · [Projected service account tokens](/blog/kubernetes-projected-service-account-tokens/) · [GitHub Actions OIDC to AWS](/blog/github-actions-oidc-aws-iam/)
