---
title: "Agentless vs Agent-Based Cloud Security"
description: "Agentless API snapshots versus runtime agents: what each sees, the blind spots of both, and a hybrid design that does not double-ticket every CVE."
pubDate: 2026-08-27
updatedDate: 2026-08-27
author: OpenSourceOM Team
tags:
  - agentless security
  - CWPP
  - CSPM
  - eBPF
  - CNAPP
focusKeyword: agentless vs agent cloud security
faq:
  - question: Is CSPM always agentless?
    answer: >-
      CSPM that reads cloud control-plane APIs is agentless. Some vendors
      bolt an agent onto the same SKU for workload CVEs and then still call
      it CSPM. If the control only needs Describe* and IAM Get*, you do not
      need a daemonset. If you need process lineage, you do.
  - question: Can snapshots replace runtime ransomware detection?
    answer: >-
      No. A four-hour inventory interval will not see the crypto process. eBPF
      or an in-guest agent sees it. Snapshots are for misconfiguration and
      identity. Mixing the two sentences is how you buy the wrong plan.
  - question: Why do agentless disk scans still miss some CVEs?
    answer: >-
      They see the filesystem at snapshot time, not tmpfs, not containers that
      never hit the disk the scanner mounted, not in-memory modules. They also
      miss what started after the snapshot. Treat them as coverage for
      installed packages on VMs you cannot instrument yet.
  - question: Do I run both everywhere?
    answer: >-
      Agents on internet-facing and data-tier workloads; agentless on the
      whole estate for IAM and exposure; maybe snapshot/agentless vuln on
      the long tail of VMs. A daemonset on every third-party cluster you
      do not own is a political problem, not a coverage checkbox.
---

CSPM does not need a process on the VM. Ransomware detection does. **Agentless vs agent cloud security** is that split, not a religion. Vendors blur it because one SKU is easier to sell. You still have to instrument two planes.

Category context: [CSPM vs CNAPP](/blog/cspm-vs-cnapp-whats-the-difference/). CNAPP often **combines** agentless posture with agent or agentless-disk workload scanning. This page is what each sensor actually observes, where it is blind, and a hybrid that does not open two tickets for one package.

```
Control plane APIs          Guest / kernel
  (IAM, SG, public IPs)       (processes, sockets, eBPF)
        │                            │
        ▼                            ▼
   agentless CSPM/CIEM         runtime CWPP / CDR
```

If your program only has the left column, you are excellent at yesterday's Terraform. If you only have the right, you will miss the public bucket that never ran your agent.

## API snapshots

Agentless collection is **Describe, Get, List** against AWS, Azure, GCP, and the Kubernetes API.

Strengths:

- Hours to estate-wide coverage (credentials willing)
- No daemonset negotiation with every app team
- The only honest way to see IAM, org policy, and resource policies
- Works on PaaS (RDS, S3, Cloud SQL) where you cannot install an agent

Cadence is a snapshot. Typical: 15 minutes to 24 hours. Between snapshots, a security group can open `0.0.0.0/0` and close again. CloudTrail / activity logs are the event plane for that gap—not the CSPM interval.

**Agentless vulnerability** (snapshot a volume, scan the filesystem in a scanner VPC) extends the same idea to packages on VMs. It still is not runtime: it is a point-in-time disk.

Failure mode: calling API CSPM "real-time." It is periodic. Failure mode: using the CSPM role to also `ssm:SendCommand` because someone wanted auto-fix. That is an agent by another name, with a standing admin path.

## Runtime agents

Agents (including eBPF daemonsets) sit in the guest or on the node.

They see:

- Running processes, loaded libraries, container ids
- Network connections that never appear as a security group (pod to pod, localhost)
- File integrity, crypto, reverse shells
- Sometimes kernel events GuardDuty/Defender will not have in the control plane

Kubernetes: Falco, Tetragon, vendor CWPP. VMs: installer + kernel module or eBPF. Serverless: often **no** guest agent; you fall back to platform logs and IAM.

Cost: CPU, crash risk, version skew, and a privileged DaemonSet that is itself an attack surface. The agent's identity (IRSA, node role) must not be `AdministratorAccess` so it can "remediate." Report to a collector; remediate through git.

Kernel modules on managed node groups (EKS Bottlerocket, GKE COS, AKS Azure Linux) fail in different ways: some images refuse unsigned modules; eBPF CO-RE is the usual workaround. If the vendor still requires a kernel module, you do not have coverage on that pool—say so, do not show a green tile.

Failure mode: agent coverage 40% of VMs, dashboard claims "protected." Unprotected VMs are where the miner runs. Measure **install rate** as a first-class KPI, not alert volume from the 40%. Failure mode: the agent needs `hostPID` and `privileged: true` in every namespace, including one that runs untrusted jobs. Isolate the DaemonSet; treat it like kube-proxy, not like a sidecar anyone can schedule next to.

## Blind spots of each

| Sensor | Blind |
| --- | --- |
| API snapshot | In-guest malware, live sockets, anything between intervals, Kubernetes secrets content you chose not to read |
| Agentless disk scan | Memory-only implants, containers not on that volume, post-snapshot changes, some nested virt |
| Runtime agent | Cloud IAM bindings, org SCPs, buckets in accounts with no agent, managed services with no guest |
| Cloud provider detections (GuardDuty, Defender, SCC) | Config you never turned on; identity graphs they do not export the way you query |

Identity is almost entirely agentless (CIEM). A runtime agent will not tell you `iam:PassRole` exists. A CSPM will not tell you the reverse shell is up. [Toxic combinations](/blog/toxic-combinations-aws-azure/) are usually one finding from each column on the same node.

Kubernetes-specific: API snapshot of `Pod` spec ≠ what the container did after start (`curl | bash` in an entrypoint). Agent sees the shell. Admission and image signing sit in [cloud-native application security](/blog/cloud-native-application-security/)—they are neither CSPM snapshots nor eBPF.

## Hybrid

A workable split:

1. **Estate-wide agentless:** inventory, exposure, IAM, Kubernetes API posture. This is the CSPM/CIEM backbone.
2. **Agents where blast radius is high:** internet-facing namespaces, data stores' compute, CI runners, jump hosts.
3. **Agentless vuln scans** for the long tail of VMs you cannot daemon yet; accept staleness.
4. **One ticket key:** `resource ARN + CVE` or `resource ARN + control id`. CSPM "public SG" and agent "sshd listening on 0.0.0.0" should **merge** or explicitly dual-track, not page twice.

Do not buy two CNAPPs that both do agentless IAM and both do agents. Overlap the **sensors**, not the **vendors**, unless you are replacing one.

Ticket example that should be **one** item: CSPM `sg-0abc allows 0.0.0.0/0:22` and the agent `sshd accepted connection from 1.2.3.4`. Same ARN, same week. If they stay two queues, on-call will close the agent alert as "known CIS finding."

Serverless and SaaS databases: agentless only, plus provider logs. Pretending you will install an agent on Aurora is how architecture decks rot. Lambda/Cloud Functions add a third sensor: the platform's runtime logs and the execution role ([CIEM](/blog/ciem-explained-for-cloud-teams/) for the role, not an eBPF probe).

When the agent says CRITICAL CVE and CSPM says the instance is private with no path, rank with [prioritization](/blog/how-to-prioritize-cloud-vulnerabilities/)—the agent is not automatically the page. When CSPM says public and the agent is absent, the page is the exposure, not "wait until we install."

## Checklist

- [ ] CSPM/CIEM credentials are API-only; no silent SSM admin
- [ ] Snapshot interval documented; CloudTrail covers the gaps you care about
- [ ] Agent install rate measured; privileged DaemonSet RBAC reviewed
- [ ] Internet-facing and data-tier workloads have runtime coverage
- [ ] Findings deduped across snapshot and agent on the same ARN
- [ ] PaaS/serverless called out as agentless-only in the design

**Related:** [CSPM vs CNAPP](/blog/cspm-vs-cnapp-whats-the-difference/) · [Cloud-native application security](/blog/cloud-native-application-security/) · [How to prioritize cloud vulnerabilities](/blog/how-to-prioritize-cloud-vulnerabilities/)
