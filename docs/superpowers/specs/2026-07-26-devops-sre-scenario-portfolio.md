# Tryout DevOps/SRE Scenario Portfolio

**Date:** 2026-07-26  
**Status:** Draft for discussion  
**Purpose:** Decide which training scenarios fit Tryout before designing or building them.

## 1. Portfolio Thesis

Tryout should teach decisions and recovery under realistic operational pressure, not
tool syntax. A scenario belongs in the catalog when the learner must inspect evidence,
form a hypothesis, make a bounded operational change, observe the result, and explain
the trade-off.

The strongest scenarios come from Tryout's own architecture and incidents:

- Cloud Run web and API services
- background workers and Redis
- self-managed PostgreSQL on a small VM
- private networking and secrets
- GitHub-driven delivery and infrastructure changes
- Terraform-managed GCP infrastructure

This keeps the promise credible: real failure modes, real telemetry, and real recovery
paths rather than invented quizzes.

## 2. Scenario Formats

Tryout should use two complementary formats.

### Incident lab

The learner inherits a running system with a hidden fault. The loop is detect, triage,
mitigate, recover, and write a short postmortem. Success is based on service recovery,
safe actions, and the evidence used.

### Architecture arena

The learner receives a workload, SLO, budget, and a bounded configuration surface. They
submit a design through GitHub, run it against real traffic and failures, then iterate
from measured results. Success balances reliability, cost, and operational burden.

Incident labs are cheaper to author and should form most of the early catalog.
Architecture arenas are deeper flagship products and should be added selectively.

## 3. Selection Criteria

Score each candidate from 1 (weak) to 5 (strong).

| Criterion | Question |
|---|---|
| Authenticity | Did Tryout experience it, or can its architecture reproduce it honestly? |
| Day-2 value | Does it teach detection, mitigation, recovery, reliability, or operations? |
| Observable evidence | Can the learner reason from logs, metrics, traces, Git history, or state? |
| Safe repeatability | Can injection and cleanup be automated without risking production? |
| Objective evaluation | Can the system verify the outcome without grading prose? |
| Cost control | Can a learner complete it in a small, time-limited environment? |
| Distinct lesson | Does it teach something not already covered by another scenario? |

Reject scenarios that are mainly installation tutorials, certification trivia, free-form
Terraform execution, or failures whose only solution is to guess a hidden value.

## 4. Recommended Portfolio

### Tier 1 — Launch next

These have the best combination of authenticity, clear evidence, modest build cost, and
strong Day-2 learning.

| ID | Scenario | Format | Core lesson | Learner evidence | Completion signal |
|---|---|---|---|---|---|
| S01 | PostgreSQL Disk Full | Incident lab | Host capacity, WAL/write failure, recover before resizing | API errors, DB logs, disk metrics, `df` | Writes restored, disk headroom safe, alert proposed |
| S02 | Silent Queue Stall | Incident lab | A healthy API can hide failed background work | queue age/depth, Redis state, worker logs, HTTP traffic | backlog drains without loss and stale-work alert exists |
| S03 | Bad Release, Safe Rollback | Incident lab | Mitigate first; use revisions and traffic, not hero debugging | deploy history, health checks, 5xx, revision logs | last-known-good serves traffic and faulty revision is isolated |
| S04 | Secret Rotation Broke Production | Incident lab | Secret versions, rollout coupling, authentication blast radius | audit/deploy history, boot logs, 401 pattern | correct version restored and rotation procedure made safe |
| S05 | Dependency Failure Without Total Outage | Incident lab | Timeouts, retries, circuit breaking, graceful degradation | upstream 401/429/5xx, latency, job retries | core journey stays available and retry storm stops |

### Tier 2 — Expand the operational curriculum

| ID | Scenario | Format | Core lesson | Learner evidence | Completion signal |
|---|---|---|---|---|---|
| S06 | PostgreSQL Connection Exhaustion | Incident lab | Pool limits, autoscaling math, saturation | `pg_stat_activity`, pool errors, latency, instance count | service recovers with a defensible connection budget |
| S07 | Slow but Not Down | Incident lab | SLI/SLO design and burn-rate detection | p50/p95/p99, traces, error budget | latency source removed and useful SLO alert configured |
| S08 | Shared Network Dependency Failure | Incident lab | Correlated symptoms reveal a shared VPC dependency | simultaneous DB/Redis timeouts, connector metrics | shared cause identified and connectivity restored safely |
| S09 | Redis Memory and Queue Loss | Incident lab | Capacity, eviction policy, backlog cascades | memory, evictions, missing/delayed jobs | loss stops, capacity restored, queue integrity verified |
| S10 | Small VM OOM | Incident lab | Linux memory forensics and database tuning | kernel journal, process restarts, query/connection load | database stable with an evidence-based capacity change |
| S11 | Monitoring That Missed the Incident | Incident lab | Low-traffic services need symptom and cause signals | incident timeline, current policies, historical metrics | learner creates a testable alert strategy with low noise |
| S12 | Backup Exists; Restore Fails | Incident lab | Recovery is proven by restore, not backup job success | backup metadata, restore logs, integrity checks | clean environment restored inside stated RTO/RPO |

### Tier 3 — Delivery and change-management track

Git is the interaction surface, but the lesson remains operational safety rather than
Git command memorization.

| ID | Scenario | Format | Core lesson | Learner evidence | Completion signal |
|---|---|---|---|---|---|
| S13 | Green CI, Broken Production Config | Incident lab | Build-time versus runtime configuration | workflow logs, image metadata, browser/API requests | correct artifact promoted without an unreviewed rebuild |
| S14 | Terraform Drift Before a Release | Incident lab | Detect and reconcile drift without destroying live state | plan, state, cloud audit history, Git diff | plan is understood, destructive actions avoided, drift resolved |
| S15 | Concurrent Infrastructure Changes | Incident lab | State locking, serialization, and safe recovery from partial apply | CI runs, lock/state metadata, cloud resources | one authoritative change lands and state matches reality |
| S16 | Risky Database Migration Rollout | Incident lab | Backward compatibility, expand/migrate/contract, rollback limits | schema, deploy order, locks, error/latency metrics | mixed-version service remains healthy through rollout |
| S17 | Compromised CI Credential | Incident lab | Containment, rotation, provenance, and blast-radius analysis | audit log, workflow history, secret use, artifacts | credential revoked, unauthorized path contained, trust re-established |
| S18 | Dependency Supply-Chain Incident | Incident lab | Pinning, provenance, vulnerability response, controlled rebuild | lockfile diff, advisory, SBOM/provenance, image digest | patched artifact promoted with verified lineage |

### Tier 4 — Flagship architecture arenas

These are valuable but significantly more expensive to build, operate, secure, and make
reproducible.

| ID | Scenario | Format | Decision being taught | Objective function |
|---|---|---|---|
| A01 | Serverless vs Kubernetes | Architecture arena | Where the workload justifies Kubernetes, and where it does not | SLO gate + cost + ops events |
| A02 | HA Database vs Cheap Single VM | Architecture arena | Availability, recovery, and cost trade-offs | availability + RTO/RPO + spend |
| A03 | In-Process vs Dedicated Workers | Architecture arena | Workload isolation, scaling, and delivery guarantees | API SLO + job-start latency + cost |
| A04 | Caching Under Failure | Architecture arena | When caching improves reliability and when it amplifies inconsistency | latency + correctness + origin load + cost |
| A05 | Multi-Region Readiness | Architecture arena | Whether business requirements justify regional complexity | regional SLO + recovery time + consistency + cost |

## 5. Recommended Product Sequence

### Wave 1 — Prove the repeatable incident-lab format

1. **S01 PostgreSQL Disk Full** — already backed by a real Tryout incident and detailed
   learnings.
2. **S02 Silent Queue Stall** — highly specific to Tryout's worker/serverless history and
   teaches a non-obvious failure.
3. **S03 Bad Release, Safe Rollback** — broadly useful, visually demonstrable, and easy
   to reset.

This wave should establish one reusable scenario contract, injection mechanism,
telemetry bundle, reset procedure, and evaluation result format.

### Wave 2 — Build a coherent on-call path

Add S04, S05, S06, S07, and S11. Together they progress from obvious outage to partial
failure, saturation, performance degradation, and observability design.

### Wave 3 — Add delivery-system depth

Add S13 through S18 only after incident reset and isolation are reliable. These scenarios
require trustworthy GitHub audit data, ephemeral credentials, and controlled CI runners.

### Wave 4 — Invest in arenas

Finish A01 before starting another arena. Use its shared runner, scoring, isolation,
lifecycle, and cost controls for A02–A05 rather than building separate platforms.

## 6. Standard Incident-Lab Contract

Every incident lab should ship the same learner experience:

1. **Brief:** business symptom, service ownership, SLO, and allowed actions.
2. **Environment:** isolated, disposable, time-limited, and free of production secrets.
3. **Hidden injection:** recorded by the platform but not disclosed to the learner.
4. **Evidence:** dashboards, logs, deploy history, Git repository, and relevant state.
5. **Checkpoints:** acknowledge, diagnose, mitigate, recover, and verify.
6. **Evaluation:** objective service state plus operational safety signals.
7. **Debrief:** incident timeline, evidence path, root cause, trade-offs, and action items.
8. **Reset:** idempotent cleanup that returns the environment to a known baseline.

The learner may use normal operational tools. Evaluation must not depend on reproducing
one exact command sequence: several safe recovery paths can be correct.

## 7. Evaluation Model

Use a hard recovery gate followed by a small number of transparent dimensions.

| Dimension | What is measured |
|---|---|
| Recovery | Service and data meet the scenario's final health conditions |
| Safety | No forbidden scope expansion, destructive shortcut, or secret exposure |
| MTTD/MTTR | Time to recognize and restore, shown for learning rather than pure ranking |
| Evidence quality | Diagnosis references signals that actually support the conclusion |
| Reliability improvement | Alert, runbook, capacity, or rollout control addresses recurrence |
| Cost | Recovery does not escape the scenario's bounded spend envelope |

Do not award points for guessing the injected fault early. Reward a defensible operational
process that would also work when the learner does not know the answer.

## 8. Safety and Platform Boundaries

- Never run learner-authored Terraform, Kubernetes manifests, containers, or scripts
  with Tryout infrastructure credentials.
- Accept bounded declarative inputs and render first-party infrastructure.
- Use a separate training project or equivalent hard boundary from the marketplace.
- Give each environment scoped, short-lived identity and a fixed TTL.
- Cap instances, applies, concurrent environments, and total spend.
- Make injections reversible and resets idempotent.
- Preserve an immutable platform event log for evaluation and incident replay.
- Never require access to a learner's personal cloud account for the core experience.

## 9. Ideas to Defer or Reject

| Idea | Decision | Reason |
|---|---|---|
| “Install Kubernetes from scratch” | Reject | Setup tutorial, not Day-2 operational judgment |
| Generic Git branching challenge | Reject | Commodity skill exercise without an SRE outcome |
| Free-form Terraform sandbox | Reject | Unsafe trust boundary and unbounded support surface |
| Memorize cloud CLI commands | Reject | Tests recall rather than diagnosis or reliability |
| Chaos with no SLO or business symptom | Reject | Failure spectacle without a decision framework |
| Multi-cloud versions of every lab | Defer | Weakens authenticity and multiplies authoring cost |
| Multiplayer incident response | Defer | Coordination is useful only after the single-learner loop works |

## 10. Decisions Needed Before Implementation

1. Confirm whether the first product line is incident labs, with A01 remaining the
   flagship arena, or whether Tryout wants arenas only.
2. Choose the target session length: approximately 30, 60, or 90 minutes.
3. Decide whether evaluation is private coaching, pass/fail certification, or both.
4. Set the environment cost ceiling per attempt and the reset/retry allowance.
5. Select the first three scenarios; the recommendation is S01, S02, and S03.

