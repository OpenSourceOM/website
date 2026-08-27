---
title: "Cloud Security KPIs Boards Actually Understand"
description: "Board-ready cloud security KPIs: stop reporting raw criticals, track internet-facing count, path-open time, exception age, and a sample monthly pack."
pubDate: 2026-08-27
updatedDate: 2026-08-27
author: OpenSourceOM Team
tags:
  - cloud security metrics
  - board reporting
  - KPIs
  - attack path
  - vulnerability management
focusKeyword: cloud security KPIs board
faq:
  - question: Why not show the board our CRITICAL count from the scanner?
    answer: >-
      The count moves when the vendor adds a check, when you onboard an
      account, and when NVD publishes a Friday dump. Directors hear "we got
      worse" or "we got better" when you only changed inventory. Report
      exposure and time-to-close on paths instead.
  - question: What is a reasonable path-open time target?
    answer: >-
      Internet to data-store paths: days, not sprints. Internal-only paths:
      whatever your change window is, measured. If you cannot compute path-open
      time yet, report internet-facing resource count and exception age until
      the graph exists.
  - question: Should we include Secure Score or Security Hub percent?
    answer: >-
      As a footnote, not a headline. Those scores mix logging hygiene with
      public storage. Boards will optimize the score. Put public exposure and
      open management ports above the fold; put the vendor score in the
      appendix next to "accounts in scope."
  - question: How many numbers belong on the one-pager?
    answer: >-
      Four to six. Internet-facing count, path-open time (or MTTC on those
      paths), exception age, coverage (accounts/clusters in the graph), and
      one incident or near-miss sentence. More numbers become a SOC dashboard
      printout.
---

The slide said **12,400 criticals**, down 3% month over month. The board asked whether the company was safer. Nobody in the room could answer, because the number is a function of scanners, not of attackers.

**Cloud security KPIs board** reporting is a one-pager of quantities a director can falsify: things facing the internet, how long a reachable path stayed open, how old the exceptions are. It is not the weekly engineering ritual in [how to prioritize cloud vulnerabilities](/blog/how-to-prioritize-cloud-vulnerabilities/) and not a Secure Score tour. If you need the data model behind "path," that is [attack path analysis](/blog/attack-path-analysis-cloud-security/).

```
Do not lead with
  CRITICAL tickets from every tool
Lead with
  internet-facing resources
  time a path to data stayed open
  age of exceptions
```

## Do not report raw criticals

Raw CRITICAL/HIGH counts fail as board metrics because they are not comparable across months:

- You enabled a new Defender plan or Trivy check
- You merged an acquisition's 80 accounts
- The scanner vendor recast 2,000 findings as CRITICAL
- You closed 400 "criticals" on isolated dev clusters

The board hears a trend. You moved the denominator.

If leadership insists on a volume number, pair it with **in-scope inventory** (accounts, subscriptions, clusters) and report **density** only as a footnote: criticals per internet-facing workload, not per universe of YAML.

Never use "we closed 2,000 tickets" as the hero metric. Ticket closure is a process metric. Attackers do not care.

## Internet-facing count

This is the first number that survives a vendor change.

Define it in writing, once:

- AWS: resource with a public IP, public NLB/ALB, public API Gateway, public S3/website, security group 22/3389/445/5432 from `0.0.0.0/0` or `::/0`
- Azure: public IP on NIC/LB, storage public blob, NSG allow from `Internet` on management ports
- GCP: `accessConfig` on GCE, `allUsers` on buckets, firewall `0.0.0.0/0` on ssh/rdp

Count **resources**, not findings. One public ALB is one, even if three checks fire.

Trend: month-end snapshot, same query. Annotate onboarding ("+12 accounts") so a spike is not mistaken for a breach of discipline.

Target: down or flat while product traffic grows. If product must be public, the number can rise; then the **path** metric (next) has to fall—public front door, no standing admin behind it.

Failure mode: counting only "public S3" because that is the CIS control you have. Public RDS and `0.0.0.0/0:22` are the same class of story for a board.

## Path-open time

Once you can query internet → identity → data (even a crude version), measure **how long that path existed**.

Definition that works in a graph:

- A **path** is a named query result (e.g. public SG + instance profile + `s3:GetObject` on a prod bucket)
- **Opened** at first seen
- **Closed** when the query returns empty for that asset tuple (SG tightened **or** role shrunk **or** bucket policy denied)
- **Path-open time** = closed − opened, reported as median and P90 for paths classed "to sensitive data"

You do not need a perfect CNAPP. You need a stable query and timestamps. [The graph](/docs/the-graph/) is the schema; the KPI is the clock.

If you cannot do paths yet, substitute **time-to-close on internet-facing items** from the definition above. That is still better than CVSS volume.

Failure mode: "MTTC" on all tickets including CIS logging. The board will celebrate log-enablement while 22 stays open. Filter the clock to exposure and identity paths.

## Exception age

Exceptions are a leading indicator of control collapse. From the exception process: every live waiver has an owner and an expiry.

Board numbers:

| Metric | Healthy | Sick |
| --- | --- | --- |
| Active exceptions | Few, named | Hundreds, "vendor" |
| Median age | ≪ 30 days | 200+ days |
| Expired but still live in cloud | 0 | Any |

Do not report "exceptions granted this month" without age. High grant rate with 7-day expiries can be fine (migrations). Low grant rate with immortal tickets is not.

## Sample monthly pack

One page, PDF or slide, same order every month:

**Header:** period, inventory in scope (N accounts / M clusters), one-line incidents ("none" is allowed).

**Four numbers (large):**

1. Internet-facing resources (count, Δ vs last month, annotation)
2. Median path-open time for "to data" paths (or TTC on internet-facing if no graph)
3. Active exceptions / median age / expired-live count
4. Coverage: % of accounts in the collector / graph (so you cannot hide an OU)

**One table (five rows max):** worst open paths or public resources, owner, age. No 400-row appendix in the board pack—link it.

**Appendix (not spoken):** vendor Secure Score / Security Hub %, raw criticals, KEV count on internet-facing only.

Script for the CISO (90 seconds): "Public exposure is X, down Y. The longest data path we measured was Z days; we cut it by shrinking the instance role. Exceptions older than 90 days are N; those are on the risk register, not in the 'temporary' pile."

Failure mode: different metrics every month because a new tool arrived. Freeze the four numbers for a year unless the definition was wrong.

## Checklist

- [ ] Board pack leads with internet-facing count, not CRITICAL volume
- [ ] Path-open time (or TTC on that set) uses a written query
- [ ] Exception age and expired-live are on the same page
- [ ] Inventory/coverage is visible so onboarding does not look like a breach
- [ ] Vendor scores in the appendix
- [ ] Same four numbers for twelve months

**Related:** [How to prioritize cloud vulnerabilities](/blog/how-to-prioritize-cloud-vulnerabilities/) · [Attack path analysis](/blog/attack-path-analysis-cloud-security/) · [The graph](/docs/the-graph/)
