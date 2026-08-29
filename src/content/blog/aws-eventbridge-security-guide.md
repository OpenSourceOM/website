---
title: "Amazon EventBridge Security: Bus Policies and API Destinations"
description: "Amazon EventBridge security: default-bus vs custom bus resource policies, cross-account PutEvents, API destinations and connection secrets, and encryption that does not cover the event you already leaked to a partner."
pubDate: 2026-08-29
updatedDate: 2026-08-29
author: OpenSourceOM Team
tags:
  - AWS
  - EventBridge
  - IAM
  - event-driven
  - API destinations
focusKeyword: Amazon EventBridge security
faq:
  - question: Is the default event bus private to my account?
    answer: >-
      The default bus accepts AWS service events for the account. A resource
      policy that allows events.amazonaws.com or a partner to PutEvents on *
      makes it a shared inbox. Custom buses exist so you can attach a tight
      policy without fighting default-bus service events.
  - question: Does KMS encryption on the bus hide events from rules in another account?
    answer: >-
      Encryption at rest protects storage of the event. A rule in another
      account that you authorized still receives the payload. Cross-account
      targets are a data-sharing decision. KMS does not undo a resource policy
      that allowed PutEvents or a rule you created.
  - question: What is the blast radius of an API destination?
    answer: >-
      EventBridge will call an HTTPS endpoint with the connection’s auth
      (API key, OAuth, Basic). The connection secret is in Secrets Manager.
      Anyone who can events:InvokeApiDestination or update the connection can
      fire that credential at the URL. Scope the connection and the destination
      ARN the same way you scope a Lambda resource policy.
---

Something `PutEvents` into a bus; rules fan out to Lambda, SQS, Step Functions, or an **API destination**. **Amazon EventBridge security** is the **bus resource policy**, who may create rules, and whether a connection secret can leave the account. It is not EventBridge Pipes mapping trivia, not a Kafka comparison, and not [AWS Lambda security](/blog/aws-lambda-security-guide/) (that is the target). AWS reference: [Using resource-based policies for EventBridge](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-use-resource-based.html).

```
Producer (IAM / AWS service / partner)
  → PutEvents  (bus resource policy)
       → rules (who can events:PutRule)
            → Lambda / SQS / API destination + connection secret
```

If `events:PutEvents` is `*` on the default bus, every account that guesses the bus ARN can inject events your rules trust.

## 1. Default bus vs custom bus

Use the **default bus** for AWS service events (`aws.ec2`, GuardDuty, etc.). Use a **custom bus** for application and partner events so the resource policy is obvious and small.

```bash
aws events list-event-buses
aws events describe-event-bus --name payments
```

Attach a policy that allows `events:PutEvents` only from named accounts or org IDs:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowProdAccountPut",
      "Effect": "Allow",
      "Principal": { "AWS": "arn:aws:iam::111111111111:root" },
      "Action": "events:PutEvents",
      "Resource": "arn:aws:events:us-east-1:222222222222:event-bus/payments",
      "Condition": {
        "StringEquals": { "events:source": "payments.api" }
      }
    }
  ]
}
```

`events:source` is attacker-controlled if they can PutEvents—use it as a **convention**, not as authentication. Authentication is the `Principal`.

**Failure mode:** copying a blog policy with `"AWS": "*"` to “make the partner integration work.” That is a public bus.

## 2. Rules and confused deputies

`events:PutRule` / `PutTargets` on `*` lets an IAM user point your bus at **their** Lambda in another account (with a matching resource policy on that Lambda). Scope:

```json
{
  "Effect": "Allow",
  "Action": ["events:PutRule", "events:PutTargets"],
  "Resource": "arn:aws:events:us-east-1:222222222222:rule/payments/*"
}
```

Every Lambda target still needs its **own** resource policy with `AWS:SourceArn` equal to **this** rule ([AWS Lambda security](/blog/aws-lambda-security-guide/)). EventBridge will not save you from `Principal: "*"` on the function.

## 3. API destinations and connections

API destinations are EventBridge as an HTTP client.

```bash
aws events list-connections
aws events describe-connection --name payments-pagerduty
```

The **connection** holds OAuth/API-key material in Secrets Manager. Lock:

- `events:InvokeApiDestination` to the named destination ARN
- `secretsmanager:GetSecretValue` on that secret only for the EventBridge service role EventBridge uses—not for every developer
- HTTPS-only destinations; pin to a hostname you own

Rotate the partner key when a destination is deleted. Dead destinations with live secrets show up in incident IR as “we thought we decommissioned PagerDuty.”

## 4. Encryption and archives

Customer managed keys on the bus encrypt events at rest. Archives and replays copy the same payload to storage you must lock (`events:StartReplay` is a prod-write). If you archive to investigate incidents, the archive is a **second database** of PII.

Schema registry and input transformers can **drop** fields; they are not a security boundary. Assume the target sees whatever the rule matched.

## 5. EventBridge vs the rest of the path

Producers on EC2 still need [IMDSv2](/blog/aws-imdsv2-hop-limit-enforcement/) so a web vuln cannot `PutEvents` as the instance profile. Targets that hit RDS still need [Amazon RDS security](/blog/aws-rds-security-guide/). EventBridge only moves the JSON.

## Checklist

- [ ] Application events on a custom bus, not a wide default-bus policy
- [ ] `PutEvents` principals are account/org IDs, never `*`
- [ ] `PutRule`/`PutTargets` scoped to a prefix; Lambda targets have SourceArn conditions
- [ ] API destination connections: named secrets, HTTPS, invoke scoped
- [ ] CMK on buses that carry regulated data; archives treated as data stores
- [ ] CloudTrail `PutEvents` / `PutRule` logged to the org trail ([AWS security best practices](/blog/aws-security-best-practices-2026/))

An open bus policy is **identity plus invocation**, the same class as a public Lambda URL. Graph it as a path, not as a “serverless finding.”

**Related:** [AWS Lambda security](/blog/aws-lambda-security-guide/) · [AWS security best practices](/blog/aws-security-best-practices-2026/) · [Attack path analysis](/blog/attack-path-analysis-cloud-security/)
