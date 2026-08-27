---
title: "Pulumi CrossGuard Policies for Cloud Guardrails"
description: "Write Pulumi CrossGuard packs that deny public IPs at preview, how they differ from Gatekeeper, and how to run them in CI without a second OPA tutorial."
pubDate: 2026-08-27
updatedDate: 2026-08-27
author: OpenSourceOM Team
tags:
  - Pulumi
  - policy as code
  - cloud guardrails
  - IaC security
  - CrossGuard
focusKeyword: Pulumi CrossGuard
faq:
  - question: Does Pulumi CrossGuard replace Kubernetes admission?
    answer: >-
      No. CrossGuard evaluates Pulumi resource inputs at preview and update.
      Gatekeeper and ValidatingAdmissionPolicy see Kubernetes objects after they
      exist as YAML. A pack that denies aws.ec2.Eip does not stop kubectl from
      creating a Service of type LoadBalancer in a cluster Pulumi does not own.
  - question: Should the pack be advisory or mandatory in the first week?
    answer: >-
      Advisory on the stacks that already have public NAT gateways and
      internet-facing load balancers you intend to keep. Mandatory on new
      workload stacks. Flipping the whole org to mandatory overnight turns
      every existing EIP into a blocked update, including the ones with a
      documented exception.
  - question: Can I encode an exception inside the policy instead of a ticket?
    answer: >-
      Yes, but only with an explicit allow-list of stack names or resource URNs
      plus an expiry you grep in CI. A comment in the TypeScript that says
      "temporary" is not an exception process. If the URN is gone from git and
      the resource still has a public IP, the pack should fail again.
  - question: Where does this sit versus CSPM after apply?
    answer: >-
      CrossGuard is the preview brake. CSPM is the drift net for resources
      created outside Pulumi. An EIP from the console, a ClickOps public IP on
      Azure, or a GCE accessConfig added by another tool will not hit the pack.
      Graph those leftovers; do not expect the pack to see them.
---

`pulumi up` succeeded. The stack grew an `aws.ec2.Eip` because a developer copied a tutorial that set `associatePublicIpAddress: true`. Preview showed a green diff. **Pulumi CrossGuard** is the layer that turns that preview red before the IP exists.

This page is policy-as-code **inside Pulumi**: packs, a public-IP deny, how that differs from OPA Gatekeeper, and CI wiring. It is not an OPA language tutorial and not a post-deploy scanner bake-off. Official pack APIs live in the [Pulumi CrossGuard docs](https://www.pulumi.com/docs/using-pulumi/crossguard/). After apply, leftover exposure still belongs in [AWS security best practices](/blog/aws-security-best-practices-2026/) and a graph, not in a second copy of the same deny written in Rego.

```
Developer
  → pulumi preview  (+ policy pack)
       → deny | warn | allow
            → pulumi up     (same pack, mandatory)
                 → cloud API
```

If the pack is not on the preview that humans actually look at, it is documentation.

## Policy as code in Pulumi

A **policy pack** is a small program (TypeScript, Python, or Go) that Pulumi runs against the resource graph of a stack. Two hooks matter:

| Hook | When it runs | What it sees |
| --- | --- | --- |
| `validateResource` | Each resource in the preview | Type, inputs, sometimes prior state |
| `validateStack` | Once per preview | The whole planned graph |

`enforcementLevel` is `advisory` (warn, do not fail) or `mandatory` (fail preview/up). Packs can ship with the repo (`--policy-pack ./policy`) or attach to an organization in Pulumi Cloud so every stack inherits them.

Failure mode: the pack lives in a `security/policy` repo that application teams never pass on the CLI. Org-level enforcement in Pulumi Cloud is the only way a forgotten `--policy-pack` flag cannot skip the deny. If you are CLI-only, the CI job must be the only path to `up` on protected stacks.

Resource validation is typed. `validateResourceOfType(aws.ec2.Instance, ...)` will not fire on `aws.lb.LoadBalancer`. Teams that write one "no public anything" function and attach it only to `Instance` miss EIPs, internet-facing ALBs, Azure `PublicIp`, and GCE `accessConfig`. List the types you care about, or use a stack validation that walks `args.resources` by type string.

Tags and Pulumi config are available; do not use them as a silent bypass. `pulumi:skip-guardrail=true` on a resource is an exception with no owner unless CI also requires a matching ticket id in the stack config.

## Example deny public IP

Start with the types that actually allocate a public address, not with a CIS control id.

TypeScript sketch for AWS EC2 (inputs, not tags):

```typescript
import { PolicyPack, validateResourceOfType } from "@pulumi/policy";
import * as aws from "@pulumi/aws";

new PolicyPack("public-ip-guardrails", {
  policies: [
    {
      name: "ec2-no-associate-public-ip",
      description: "Instances must not request a public IPv4 address.",
      enforcementLevel: "mandatory",
      validateResource: validateResourceOfType(
        aws.ec2.Instance,
        (inst, _args, reportViolation) => {
          if (inst.associatePublicIpAddress === true) {
            reportViolation(
              "associatePublicIpAddress is true; use a private subnet and a load balancer or SSM."
            );
          }
        }
      ),
    },
    {
      name: "no-standalone-eip",
      description: "Do not allocate Elastic IPs in workload stacks.",
      enforcementLevel: "mandatory",
      validateResource: validateResourceOfType(
        aws.ec2.Eip,
        (_eip, args, reportViolation) => {
          const allowed = new Set(["urn:pulumi:prod::edge::aws:ec2/eip:Eip::nat-a"]);
          if (!allowed.has(args.urn)) {
            reportViolation(`EIP ${args.urn} is not on the NAT allow-list.`);
          }
        }
      ),
    },
  ],
});
```

Same idea, different APIs:

- Azure: `azure.network.PublicIp` with `sku` / allocation that is not the documented ingress exception.
- GCP: `gcp.compute.Instance` `networkInterfaces[].accessConfigs` non-empty; `gcp.compute.Address` with `addressType: EXTERNAL`.

Failure mode: you deny `associatePublicIpAddress` and someone ships an internet-facing NLB in a public subnet. Add `aws.lb.LoadBalancer` `scheme === "internet-facing"` as a **separate** policy with an allow-list of stack names (`edge`, `ingress`). Do not fold NAT, ALB, and "this API must be public" into one boolean.

Preview locally:

```bash
pulumi preview --policy-pack ./policy --stack prod.payments
```

If preview is clean and `up` in CI uses a different pack path, you tested theater.

## vs OPA Gatekeeper

CrossGuard and Gatekeeper share a slogan (policy as code) and almost no runtime.

| | Pulumi CrossGuard | OPA Gatekeeper |
| --- | --- | --- |
| Object | Pulumi resource inputs | Kubernetes AdmissionReview |
| Time | Preview / update | API server admit |
| Authoring | Pulumi Policy SDK | ConstraintTemplate + Constraint |
| Misses | ClickOps, other IaC, `kubectl` | Cloud resources that never become K8s objects |

Do not translate a CrossGuard pack into Rego "for consistency" unless a Kubernetes object is the thing you want to stop. Denying `Service` `type: LoadBalancer` in Gatekeeper does not deny `aws.ec2.Eip`. Denying the EIP in CrossGuard does not deny a Helm chart that creates a public Service in a cluster this stack does not manage.

If you already run Gatekeeper or Kyverno for unsigned images and hostPath, keep them. Point CrossGuard at **cloud resource types**. The conceptual overlap is "fail the change before it is live," not a shared policy language. A generic OPA-for-everything tutorial belongs elsewhere; this split is the operator decision.

After both gates, a public IP that still exists is drift or a second control plane. Rank that as exposure, not as a policy-engine bake-off ([how to prioritize cloud vulnerabilities](/blog/how-to-prioritize-cloud-vulnerabilities/)).

## CI wiring

The pack must run on the same revision as the stack code.

1. **PR:** `pulumi preview --policy-pack ./policy --diff` against a short-lived stack or against prod with `--expect-no-changes` where that is honest. Fail the job on mandatory violations.
2. **Merge:** only the CD identity may `pulumi up`. That identity's cloud role should not be able to create EIPs if the pack is skipped—defense in depth, not a substitute for the pack.
3. **Pack version:** pin the pack as a git submodule or a versioned artifact. "Clone main of the security repo" on every build means a pack change can break every stack on Tuesday with no PR on the app repo. Version the pack; bump it like a provider.
4. **Pulumi Cloud:** attach the pack to the organization or to a stack tag (`env:prod`). CLI `--policy-pack` on laptops is optional then.

```yaml
# GitHub Actions sketch — pack lives in the same repo
- run: pulumi preview --stack ${{ vars.STACK }} --policy-pack ./policy --non-interactive
  env:
    PULUMI_ACCESS_TOKEN: ${{ secrets.PULUMI_ACCESS_TOKEN }}
```

Failure modes:

- Preview uses the pack; `up` uses `--refresh` without it.
- Developers `pulumi up` from laptops with admin cloud credentials.
- Advisory forever because mandatory blocked the NAT EIP that is supposed to exist—allow-list that URN instead of disabling the policy.

## Checklist

- [ ] Pack lists every public-IP type you use (EC2, EIP, ALB scheme, Azure PublicIp, GCE accessConfig), not only `Instance`
- [ ] NAT / ingress exceptions are URNs or stack names with owners, not a global skip tag
- [ ] `enforcementLevel: mandatory` on new stacks; advisory only while inventorying existing EIPs
- [ ] CI preview and CD up use the same pack version
- [ ] Org attachment in Pulumi Cloud **or** laptop `up` is blocked for prod
- [ ] ClickOps public IPs still go to CSPM; the pack does not claim to see them

**Related:** [AWS security best practices](/blog/aws-security-best-practices-2026/) · [Cloud-native application security](/blog/cloud-native-application-security/) · [How to prioritize cloud vulnerabilities](/blog/how-to-prioritize-cloud-vulnerabilities/)
