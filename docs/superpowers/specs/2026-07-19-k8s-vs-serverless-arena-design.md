# Scenario 01 — Serverless vs Kubernetes Arena

**Date:** 2026-07-19
**Status:** Approved pending user review
**Relates to:** `2026-07-15-scenario-marketplace-design.md` (marketplace), `2026-07-17-ai-tutor-design.md` (tutor agent)
**Amends:** the marketplace scope guard "no hosted-launch of scenarios on own infra" — see §9.

## 1. What This Is

The first scenario sold on the Tryout marketplace, and the first that runs on hosted
infrastructure. It teaches one thing: **when and why an application should move from
serverless to Kubernetes — and, more often, why it should not.**

It is not a written exercise. The buyer receives a working application and a set of
requirements, chooses an architecture by editing a declarative config in their private
repo, and their choice is applied to real infrastructure. Live traffic and injected
failures grade it. The system's response is the evaluation.

The lesson is not carried by prose. It is carried by the objective function.

## 2. Why the Objective Function Is the Design

If a design is graded only on surviving traffic, serverless and Kubernetes both pass at
every scale a practice app reaches, and the buyer who throws a cluster and twenty
replicas at a toy workload "wins". That rewards exactly the cargo-cult reasoning the
scenario exists to destroy.

Scoring therefore has three axes:

- **SLO** under the traffic profile — a hard pass/fail gate.
- **Cost** — measured spend at that traffic, against a budget ceiling.
- **Ops burden** — injected on-call events the design must absorb.

With cost in the function, serverless wins outright at low traffic. With ops events in
it, "add more replicas" stops being free. The crossover becomes real, and finding it is
the product.

## 3. The Core Loop

The buyer receives the application (Next.js web, NestJS API with queue workers,
Postgres, Redis) plus requirements: SLO targets, a traffic forecast, a budget ceiling.

One turn:

1. Buyer edits `design.yaml` in their private repo and opens a PR.
2. The arena runner validates the file against schema, renders first-party templates,
   and applies them to the buyer's isolated environment using a scoped service account.
   Results are reported on the PR.
3. The load harness runs the traffic profile against the live environment, injecting ops
   events mid-run.
4. The scorer emits one metrics query as two renderings: a live scoreboard and a
   threshold verdict.
5. The tutor reads the same numbers and interrogates the buyer's reasoning — "your p95
   tripled at minute four, what happened there?" — rather than announcing a grade.
6. The buyer iterates.

**Progression.** Profile 1 is low traffic: a lean Cloud Run design passes SLO and wins
on cost, while a Kubernetes design passes SLO but breaches the budget ceiling. Profile 2
raises sustained load and introduces long-running jobs. The lean serverless design now
fails. The buyer finds the crossover by hitting it.

The scenario is complete when the buyer can state where the line falls and show the
numbers that put it there.

## 4. The Design Surface

`design.yaml` is the entire legal surface. A bounded lever set keeps this a game with a
scoreboard rather than an unbounded hosting product.

```yaml
schema_version: 1
api:
  platform: cloudrun | gke
  # cloudrun
  min_instances: 0-5
  max_instances: 1-20
  concurrency: 1-250
  # gke
  replicas: { min: 1-10, max: 1-20, target_cpu: 40-90 }
  # both
  cpu: 0.5 | 1 | 2
  memory: 512Mi | 1Gi | 2Gi
workers:
  placement: in_process | separate_service | separate_deployment
  min_instances: 0-3
cache:
  enabled: true | false
  tier: basic-1gb | standard-1gb
db:
  tier: micro | small | medium
```

**Deliberate coupling that must be documented for the buyer:** workers have no
independent scaling ceiling — `worker_max_instances` mirrors `api.max_instances`.
A separate worker ceiling would be one more lever to tune without teaching anything
the others do not. But the consequence is real and non-obvious: raising the API
ceiling to 20 for burst headroom also raises the worker fleet ceiling to 20, roughly
doubling worst-case instance count and therefore worst-case cost. Because cost is a
scored axis, a buyer must not discover this from their score. State it in the
scenario's requirements document alongside the lever table.

## 5. Traffic Profiles and the Crossover

| | P1 "Launch" | P2 "Growth" |
|---|---|---|
| Traffic | ~5 rps, bursty, business hours | ~150 rps sustained, 24/7 |
| Background jobs | 200/day, ~10s each | 8k/day, some exceeding 20 minutes |
| Budget ceiling | Tight | Raised, still bounded |

Three real mechanisms produce the crossover:

1. **Job duration.** Cloud Run's request-scoped execution caps long work. P2's
   twenty-minute jobs do not fit it; a Deployment is indifferent to them.
2. **Always-on economics.** P2 requires permanently warm workers. Paying a
   `min_instances` floor per service costs more per vCPU-hour than the equivalent
   capacity packed onto a node already running.
3. **Bin packing.** Splitting workers into their own service gives each its own floor.
   Kubernetes co-locates them on one node; serverless bills every floor separately.

At P1 none of these apply and cluster baseline overhead dominates, so serverless wins
outright. At P2 all three bite simultaneously. The threshold is a property of the
workload, not a rigged score.

## 6. Scoring

Par is established by measuring the optimal configuration per profile in advance. Buyers
are scored against par.

- **SLO gate (hard):** API p95, job-start p95, error rate below 0.5%. Failure means no
  score and another turn.
- **Cost:** measured spend versus par. Exceeding the budget ceiling fails.
- **Ops:** three injected events per run — instance eviction, cold-start storm,
  dependency 500s. SLO must hold through each.

**Cost measurement.** Real billing data arrives hours to days late and is not resolvable
per namespace, so it cannot close this loop. Cost is computed by applying a pricing model
to observed resource usage (instance-seconds, vCPU-seconds, GB-seconds, node-hours). This
is instant, deterministic, reproducible, and auditable by the buyer. It approximates the
bill rather than reading it — which is correct here, because real billing noise would
make scores irreproducible.

## 7. Architecture and Trust Boundary

**The buyer's repository is untrusted input.** Terraform written by a buyer must never be
applied: `local-exec`, custom providers, and `external` data sources are arbitrary code
execution against whatever identity the runner holds. Raw Kubernetes manifests carry the
same problem via `hostPath`, privileged containers, and service-account mounts.

Buyers therefore author `design.yaml`, never executable infrastructure. The runner parses
it, rejects anything off-schema, and renders first-party templates. This is the control
that makes hosting buyer workloads survivable.

```
buyer repo: design.yaml  ──PR webhook──>  arena-runner (first-party infra)
                                             │ 1. parse + schema-validate
                                             │ 2. render first-party templates
                                             │ 3. apply, scoped SA, one env only
                                             ▼
                                       buyer environment
                                    (Cloud Run service / namespace,
                                     small DB, Redis, quota-bound)
                                             ▲
                                             │ drives + observes
                                      load + chaos harness
                                             │
                                             ▼
                                   scorer ──> scoreboard (web)
                                          └─> tutor agent
```

| Component | Responsibility | Location |
|---|---|---|
| `design.yaml` schema | The lever set; single source of truth for what is legal | `packages/arena-schema` |
| arena-runner | Validate, render, apply, report to PR. Sole holder of infra credentials | Cloud Run Job |
| load + chaos harness | Run traffic profile, inject ops events, emit raw metrics | Cloud Run Job |
| scorer | One metrics query, two renderings: scoreboard and verdict | `apps/api/src/arena/` |
| arena API + pages | Turn state, environment lifecycle, scoreboard UI | `apps/api`, `apps/web` |

**Reused unchanged:** per-buyer private repo delivery and GitHub invites, auth, Drizzle,
and the existing tutor agent — which receives scoreboard numbers as tool input rather
than gaining new reasoning.

Because the schema and templates define the scenario, authoring a second scenario later
means a new schema and template set, not new platform code.

## 8. Isolation, Lifecycle, and Spend

**The arena runs in a separate GCP project.** Buyer workloads never share a project with
the production marketplace, its Postgres VM, or its secrets.

Environment guardrails:

- **Namespace** with `ResourceQuota`, `LimitRange`, and a `NetworkPolicy` denying egress
  except the environment's own datastores and the metrics endpoint.
- **Images are first-party.** `design.yaml` selects levers, never an image reference.
- **Hard `max_instances` cap** on the Cloud Run path regardless of requested value, so a
  runaway configuration has a known maximum cost.
- **Throwaway credentials** per environment, reaching nothing outside it.

| Control | Value | Purpose |
|---|---|---|
| Environment TTL | 72h from provision, reaper sweeps | Nothing outlives its purpose by accident |
| Re-provisions per purchase | Capped, generous | Iteration is the product; unlimited iteration is a bill |
| Applies per buyer | Rate-limited hourly | Every apply is real spend |
| Concurrent environments | Global cap, queue beyond | The ceiling stays a chosen number |
| Project budget | Alert plus automated kill switch | Last line of defence, not the first |

**Accepted risk.** Buyers share one cluster. Namespace, quota, and NetworkPolicy provide
good isolation, not hard isolation — a container-escape CVE would cross it where a
per-project design would not. Accepted because per-buyer Autopilot clusters cost roughly
$74/month each and do not survive the price point. Revisit if the product grows; do not
forget it.

The cluster is only required once a buyer selects `platform: gke`, so it can hold at a
floor when unused. Cost tracks usage rather than catalog size.

## 9. Relationship to the Marketplace Scope Guard

The marketplace design deferred hosted launches post-MVP. This scenario amends that
deliberately: the buyer acting on real infrastructure is the product, and a written
exercise would not deliver it. The deferral's underlying concerns — cost, blast radius,
abuse — are addressed by the bounded lever set, the untrusted-input boundary, the
separate project, and the lifecycle caps above rather than by avoidance.

## 10. Failure Modes

| Failure | Handling |
|---|---|
| Apply fails or half-applies | Runner is idempotent; environment marked `degraded`, plan error surfaced on the PR, re-apply or reprovision. Never silently scored. |
| Harness measures a cold environment | Warmup window is profile-defined, never blanket — for some levers cold start is the signal being measured. |
| Reaper kills an environment mid-run | TTL extends while a run is in flight; reaper skips `running`. |
| Buyer stuck across repeated turns | Tutor intervenes with graduated hints; never hands over `design.yaml`. |
| Concurrency cap reached | Queue with stated position. Never a silent stall — that is the failure mode of this project's own F09. |
| Schema evolves, old repos break | Schema version in-file; runner supports N-1 and instructs the buyer to bump. |

## 11. Testing

1. **Schema validator — security-critical.** Fuzz it. Anything off-whitelist must be
   rejected. This is the control preventing buyer input from reaching infrastructure
   credentials, so it gets adversarial tests, not happy-path tests.
2. **Renderer — golden-file tests.** `design.yaml` in, expected templates out. Catches
   levers that silently stop taking effect.
3. **Scorer and pricing model — unit tests.** Known usage vector, known cost.
   Deterministic by construction and cheap to pin.
4. **Reproducibility gate.** Run the par configuration five times; require score variance
   below threshold. If one design scores differently run to run, the game is unfair and
   the product is broken. This is an enforced gate.
5. **E2E turn loop.** One full PR → apply → load → score cycle against a real ephemeral
   environment in a test project. Runs on merge, not per commit.

## 12. Build Order

**M0 — Prove the crossover exists.** Before any platform code, hand-run the candidate
configurations, measure them, and build the par table. This answers the only question
that can kill the product: does the crossover appear at a scale affordable to generate?
If Kubernetes only wins at enormous traffic, the game has no threshold and everything
downstream is wasted. Everything below assumes M0 returned positive.

**M1 — The machine, Cloud Run only.** Schema and validator, arena-runner, load harness,
scorer, scoreboard page. One profile, one platform, no cluster, no chaos events. Every
hard part of the platform is proven while touching zero Kubernetes. Not yet sellable —
there is no crossover.

**M2 — The crossover. The sellable release.** Add the `gke` lever branch, namespace
provisioning, quota and NetworkPolicy, profile P2, and the three ops events. The buyer
can now hit the wall and climb it. Ship and sell.

**M3 — Tutor.** Wire the existing agent to scoreboard numbers as tool input. Plumbing,
and the upsell rather than the product.

**M4 — Scale and polish.** Queueing at the concurrency cap, reaper hardening, a second
scenario as a new schema and template set.

M1 defers every Kubernetes-shaped cost and risk while proving the machine. M2 is the
smallest release that delivers the lesson. A negative M0 costs a weekend rather than a
quarter.

## 13. Out of Scope

- Buyer-authored Terraform, manifests, or container images.
- Architectures outside the `design.yaml` lever set.
- Per-buyer GCP projects or clusters.
- Reading real billing data in the scoring loop.
- Multiplayer, leaderboards, or timed competition.
- Additional scenarios — M4 at the earliest.
