---
title: "EKS Pod Identity vs IRSA"
description: "EKS Pod Identity binds an IAM role to a namespace and service account. Trust policy, leftover IRSA annotations, and an agent that fails closed."
pubDate: 2026-09-25
updatedDate: 2026-09-25
author: OpenSourceOM Team
tags:
  - EKS
  - Pod Identity
  - IRSA
  - IAM
  - Kubernetes
focusKeyword: EKS Pod Identity
faq:
  - question: Does EKS Pod Identity replace the IRSA annotation?
    answer: >-
      For new associations, yes. You create a pod identity association
      (cluster, namespace, service account, role) and you do not set
      eks.amazonaws.com/role-arn. While the association exists, the
      webhook selects Pod Identity over IRSA. The annotation is not
      deleted. If you remove the association and leave the annotation,
      IRSA is the credential path again. An unschedulable agent does not
      flip the pod back to IRSA; credential fetches fail.
  - question: What belongs in the IAM trust policy?
    answer: >-
      Principal pods.eks.amazonaws.com, actions sts:AssumeRole and
      sts:TagSession. Scope the role to a cluster with aws:SourceArn on
      the cluster ARN and aws:SourceAccount. The namespace and service
      account are the association, not a copy of the IRSA sub claim.
      Omitting sts:TagSession makes the assume fail.
  - question: What happens if the Pod Identity agent is down?
    answer: >-
      New credential fetches fail. The pod does not automatically fall
      back to IRSA. Applications that catch that error and then call
      IMDS will use the node role instead. Keep hop limit 1 and do not
      grant the node role the app’s data permissions.
---

```bash
aws eks create-addon --cluster-name payments --addon-name eks-pod-identity-agent
aws eks create-pod-identity-association \
  --cluster-name payments \
  --namespace payments \
  --service-account payments-api \
  --role-arn arn:aws:iam::123456789012:role/payments-api
```

That association is **EKS Pod Identity**. There is no `eks.amazonaws.com/role-arn` annotation and no per-cluster OIDC provider. The agent on the node exchanges the pod’s identity for STS credentials. What that role can do once assumed is the [pod-to-cloud-admin path](/blog/kubernetes-pod-to-cloud-admin-path/). This page is the binding.

Behavior and the trust-policy shape are documented in [EKS Pod Identity](https://docs.aws.amazon.com/eks/latest/userguide/pod-identities.html).

## Trust policy

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "pods.eks.amazonaws.com" },
      "Action": ["sts:AssumeRole", "sts:TagSession"],
      "Condition": {
        "StringEquals": {
          "aws:SourceAccount": "123456789012",
          "aws:RequestTag/kubernetes-namespace": "payments",
          "aws:RequestTag/kubernetes-service-account": "payments-api"
        },
        "ArnEquals": {
          "aws:SourceArn": "arn:aws:eks:us-east-1:123456789012:cluster/payments"
        }
      }
    }
  ]
}
```

`sts:TagSession` is required. EKS sets session tags (`kubernetes-namespace`, `kubernetes-service-account`, `eks-cluster-name`). A trust policy copied from an old EC2 service role that only allows `sts:AssumeRole` will not work.

The association is what EKS will attempt. The request-tag conditions are what stop a second association from reusing this role: EKS sets `kubernetes-namespace` and `kubernetes-service-account` on the assume. `aws:SourceArn` stops a different cluster. Without the tags, any service account in `payments` that someone can associate will get the role. Treat `eks:CreatePodIdentityAssociation` and `eks:DeletePodIdentityAssociation` like `iam:PassRole`: cluster-admin and CI only, not every namespace developer. Session tags can be turned off on an association; if you disable them, these request-tag conditions stop matching and the assume fails. Leave tags on.

IRSA’s trust looks nothing like this. It is `AssumeRoleWithWebIdentity` against `oidc.eks.<region>.amazonaws.com/id/<id>` with `sub` = `system:serviceaccount:payments:payments-api`. Reusing that document for Pod Identity fails closed. Leaving it in place beside the new trust is how one role stays assumable two ways.

## What IRSA still is

| | Pod Identity | IRSA |
| --- | --- | --- |
| Binding | `create-pod-identity-association` | Annotation on the ServiceAccount |
| IAM principal | `pods.eks.amazonaws.com` | Cluster OIDC provider |
| OIDC provider per cluster | No | Yes |
| Credential helper | `eks-pod-identity-agent` DaemonSet | Projected SA token, exchanged at STS |
| Fargate | Only on platform versions that include the agent | Works without a node agent |

Do not install the agent and assume every Fargate profile picked it up. A profile on an older platform version still needs IRSA. Check the platform version before you delete the annotation from a Fargate service account.

Same role, many clusters: create one association per cluster. Without `aws:SourceArn`, any cluster in the account whose admin can create an association can use the role. That is convenient for a read-only telemetry role and a bad default for `payments-api`.

## Leftover annotations

While the association exists, the webhook prefers Pod Identity over IRSA. The annotation does not get cleared. The agent being down does not switch the pod back to IRSA. New pods still get Pod Identity environment variables and then fail to fetch credentials. IRSA returns only if the association is removed and the annotation is still there.

```bash
kubectl get sa -A -o json \
  | jq -r '.items[]
    | select(.metadata.annotations["eks.amazonaws.com/role-arn"] != null)
    | [.metadata.namespace, .metadata.name, .metadata.annotations["eks.amazonaws.com/role-arn"]]
    | @tsv'
```

Diff that list against associations:

```bash
aws eks list-pod-identity-associations --cluster-name payments \
  --query 'associations[].associationId' --output text
```

Then `aws eks describe-pod-identity-association` for each id. A service account with an annotation and no association is still IRSA. A service account with both is Pod Identity until the association is deleted, at which point the annotation is live again. Delete the annotation in the same change that creates the association.

## When the agent is down

The addon is a DaemonSet. Taints, a bad node selector, or a broken CNI mean pods on that node cannot mint credentials. The SDK error is a credential failure, not a Kubernetes error.

The dangerous fallback is application code (or an old AWS SDK default) that then reads instance metadata. The node role is now the app. [IMDSv2 hop limit 1](/blog/aws-imdsv2-hop-limit-enforcement/) makes that fallback fail. Do not “fix” the outage by raising hop limit. Fix the DaemonSet, and keep the node role unable to read the app’s buckets.

Identity scope of `payments-api` is still [CIEM](/blog/ciem-explained-for-cloud-teams/): Pod Identity does not shrink `s3:*`.

## Checklist

- [ ] Addon `eks-pod-identity-agent` healthy on every node that runs associated pods
- [ ] Fargate platform version confirmed before removing IRSA from Fargate service accounts
- [ ] Trust policy allows `sts:AssumeRole` and `sts:TagSession`, with `aws:SourceArn` plus namespace and service-account request tags
- [ ] Association names the namespace and service account; no second association to a broader role
- [ ] `eks.amazonaws.com/role-arn` removed from service accounts that have an association
- [ ] `eks:CreatePodIdentityAssociation` not granted to namespace developers
- [ ] Node role cannot read app data; hop limit stays 1 so IMDS is not the fallback

The association is the edge from the service account to the role. The role policy is still the blast radius.
