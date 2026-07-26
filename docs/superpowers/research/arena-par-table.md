# Arena A01 — Par Table and Crossover Measurement (M0)

**Status:** Steps 1 and 2 complete (this document). Steps 3–6 are unrun — every
results table below is empty on purpose.
**Plan:** `docs/superpowers/plans/2026-07-19-arena-m0-m1a.md`
**Spec:** `docs/superpowers/specs/2026-07-19-k8s-vs-serverless-arena-design.md`
**Harness:** `perf/arena-m0.js`
**Workload:** `apps/arena-workload` (the `scenario_image` under test)

## What M0 Decides

Does the serverless → Kubernetes cost crossover exist at traffic we can afford
to generate? If Kubernetes only wins beyond what a practice environment can
produce, the game has no threshold and M1-B3 onward should not be built.

M0 records **observed usage**, never a dollar figure. `packages/arena/src/pricing.ts`
converts usage to cost, so a rate change re-prices every result without
re-measuring anything.

---

## Step 1 — Candidate Configurations

Levers are the ones in `packages/arena/src/schema.ts`. Every configuration runs
the same image with `cpu = 1`, `memory = 1Gi`, `concurrency = 80`,
`cache.enabled = false`, `db.tier = small`, so the only things varying are
platform, instance floor, and worker placement.

| # | Platform | api min/max | workers | worker min/max | What it is |
|---|---|---|---|---|---|
| A | cloudrun | 0 / 10 | `in_process` | — | The naive default. Reproduces F09: scale-to-zero starves the workers. |
| B | cloudrun | 1 / 10 | `in_process` | — | Naive fix. One warm instance, jobs still on the request path. |
| C | cloudrun | 1 / 10 | `separate_service` | 1 / 10 | Workers split off. Two floors billed instead of one. |
| D | cloudrun | 2 / 20 | `separate_service` | 2 / 20 | Scaled serverless. The best Cloud Run is expected to manage at P2. |
| E | gke | 2 replicas | `separate_deployment` | 2 replicas | Smallest credible cluster. Fixed node cost, no autoscaling. |
| F | gke | HPA 2–6 | `separate_deployment` | HPA 2–6 | Autoscaled cluster design. |

**Cloud Run billing mode is not free to choose** (`arena-env/main.tf`):
the API service runs `cpu_idle = true` (request-based; CPU throttled outside
requests, min-instances idle at the reduced rate) and the worker service runs
`cpu_idle = false` (instance-based; CPU allocated for the instance lifetime,
because a queue poller receives no requests and would otherwise be throttled
into never draining). Configurations C and D therefore mix two billing models,
and their worker tier needs an always-allocated rate that `rates.ts` does not
yet carry — see Caveats.

**E and F are hand-built.** M1 is Cloud Run only; there is no `gke` branch in
the module. Build them by hand in the scratch project from the same image.

---

## Step 2 — Traffic Profiles

Both profiles hit `apps/arena-workload`. Request mix is **85% `GET /api/read`**
(one DB round trip) and **15% `GET /api/report`** (aggregate over the jobs
table). Jobs are enqueued via `POST /api/jobs` on their own arrival schedule,
independent of the request rate.

### P1 "Launch"

| | |
|---|---|
| Request rate | Mean **5.0 rps**, bursty |
| Burst shape | Repeating 10-min cycle: 6 min @ 2 rps, 3 min @ 8 rps, 1 min @ 14 rps → (12 + 24 + 14) / 10 = 5.0 |
| Window | 40 min (4 cycles) |
| Jobs | **200/day** = 1 per 432 s → ~5.6 jobs per window |
| Job shape | 10 s, `cpuRatio` 0.2 |
| SLO | API p95 ≤ 400 ms · job-start p95 ≤ 60 s · error rate < 0.5% |

### P2 "Growth"

| | |
|---|---|
| Request rate | **150 rps** sustained |
| Window | 40 min |
| Jobs | **8000/day** = 1 per 10.8 s → ~222 jobs per window |
| Job mix | 90% × 10 s · 8% × 120 s · **2% × 1500 s (25 min)** |
| Job shape | `cpuRatio` 0.2 throughout |
| SLO | API p95 ≤ 400 ms · job-start p95 ≤ 120 s · error rate < 0.5% |

The 25-minute jobs are the point of P2. They are the mechanism that no amount
of Cloud Run lever-tuning can absorb.

`cpuRatio` matters: a job that only slept would cost almost no vCPU-seconds and
the crossover would vanish into rounding. Jobs burn ~20% of their wall clock as
real CPU.

---

## Measurement Protocol

**Cost and SLO are measured separately.** At P1's true rate, 200 jobs/day is
8.3 jobs/hour, so a usable job-start p95 needs a multi-hour run — twelve times
over for six configurations across two profiles. Instead: measure unit costs in
short runs, measure the floor analytically, and compose. Only the SLO gate needs
a full-length run.

### Unit runs — cheap, per configuration

| Run | Command | Window | Yields |
|---|---|---|---|
| U0 | `-e PROFILE=u0` | 15 min | Idle floor usage at this `min_instances` |
| U1 | `-e PROFILE=u1` | 10 min @ 20 rps | vCPU-s and GiB-s **per request** |
| U2 | `-e PROFILE=u2` | 15 min, 4 jobs/min | vCPU-s and GiB-s **per short job** |
| U3 | `-e PROFILE=u3` | 2 × 25-min jobs | Long-job usage, and whether it completes at all |

### SLO runs — full length, per configuration per profile

```bash
BASE_URL=https://<env>-api-<hash>.run.app k6 run -e PROFILE=p1 perf/arena-m0.js
BASE_URL=https://<env>-api-<hash>.run.app k6 run -e PROFILE=p2 perf/arena-m0.js
```

Prove reachability first — a typo in `BASE_URL` is much cheaper to find now than
at minute 39:

```bash
BASE_URL=... SMOKE=1 k6 run -e PROFILE=p2 perf/arena-m0.js   # 20s
```

The harness asserts the SLO as a k6 threshold, so a miss is a recorded failure
rather than a number to re-litigate afterwards. **API p95 and error rate come
from k6; job-start p95 comes from the workload**, since k6 only ever sees the
202 from the enqueue:

```bash
curl -s $BASE_URL/api/jobs/stats
```

Read that **after** the run has fully drained — a 25-minute job enqueued in a
40-minute window is still running when k6 exits.

### Collecting usage

Cloud Run, per service, over the run window (verify the metric names in your
project with `gcloud.cmd monitoring metrics-descriptors list --filter="metric.type~run.googleapis.com"`):

| Quantity | Metric |
|---|---|
| vCPU-seconds | `run.googleapis.com/container/cpu/allocation_time` |
| GiB-seconds | `run.googleapis.com/container/memory/allocation_time` |
| Billable instance time | `run.googleapis.com/container/billable_instance_time` |
| Requests | `run.googleapis.com/request_count` |

For C and D, collect **both services separately** — the whole argument is that
the second floor is billed independently.

GKE (E, F): billing is node-based, so the quantity that matters is
**node-hours** = node count × wall-clock hours, plus the machine type. Record
`kubectl top` alongside it for saturation context, but do not price from it.

### Composing a profile cost

```
floor_vcpu_s   = min_instances × cpu × window_seconds          (from U0)
request_vcpu_s = requests × per_request_vcpu_s                 (from U1)
job_vcpu_s     = Σ jobs × per_job_vcpu_s(duration)             (from U2, U3)

usage = floor + requests + jobs   →   costFromUsage()  →  monthlyUsd
```

Feed the composed `Usage` vector through `costFromUsage` in
`packages/arena/src/pricing.ts`. Do not hand-multiply rates.

---

## Step 3 — Results under P1

_Unrun._

| # | API p95 (ms) | Job-start p95 (s) | Error % | vCPU-s | GiB-s | Requests | Node-hours | SLO |
|---|---|---|---|---|---|---|---|---|
| A | | | | | | | — | |
| B | | | | | | | — | |
| C | | | | | | | — | |
| D | | | | | | | — | |
| E | | | | | | | | |
| F | | | | | | | | |

## Step 4 — Results under P2

_Unrun._ Configurations A and B are expected to fail SLO here. That failure is
a result worth recording, not a problem to fix.

| # | API p95 (ms) | Job-start p95 (s) | Error % | Long jobs completed | vCPU-s | GiB-s | Requests | Node-hours | SLO |
|---|---|---|---|---|---|---|---|---|---|
| A | | | | | | | | — | |
| B | | | | | | | | — | |
| C | | | | | | | | — | |
| D | | | | | | | | — | |
| E | | | | | | | | | |
| F | | | | | | | | | |

## Step 5 — Cost

_Unrun._ Monthly USD from `costFromUsage`, SLO-failing configurations marked
rather than omitted.

| # | P1 monthly USD | P2 monthly USD | Held SLO at P1 | Held SLO at P2 |
|---|---|---|---|---|
| A | | | | |
| B | | | | |
| C | | | | |
| D | | | | |
| E | | | | |
| F | | | | |

---

## Step 6 — GO / NO-GO Gate

GO requires **all three**:

1. At P1, the cheapest Cloud Run configuration holding SLO costs materially
   less than the cheapest GKE configuration holding SLO.
2. At P2, the cheapest GKE configuration holding SLO costs less than the
   cheapest Cloud Run configuration holding SLO — **or** no legal Cloud Run
   lever setting holds SLO at all.
3. P2 is generatable at a cost you are willing to pay per buyer run.

| Condition | Met? | Evidence |
|---|---|---|
| 1 — serverless wins at P1 | | |
| 2 — cluster wins at P2 | | |
| 3 — P2 affordable to generate | | |

**Verdict:** _pending_

**If NO-GO:** stop; do not build M1-B3. Record which condition failed. The
likely fixes are raising P2, adding jobs the request model cannot serve at all,
or changing the scenario's thesis.

---

## Caveats Carried Into This Experiment

1. **`rates.ts` has one unverified field.** `cloudRunIdleGibSecond` has no
   locatable published figure. It is a direct multiplier on every
   `min_instances` configuration — B, C, D — so the P1 comparison is sensitive
   to it. Verify before trusting a close result.
2. **No always-allocated rate exists.** The worker service runs `cpu_idle = false`,
   which bills instance-based for the instance lifetime — neither the `active`
   nor the `idle` figure in `rates.ts`. **Cost for configurations C and D is
   understated until that rate is added.** If the crossover appears to hinge on
   C or D, close this first.
3. **`redisGibHour` and `dbHour` are modelled, not quoted.** They price a Cloud
   Run sidecar and a shared VM, not the Memorystore and Compute SKUs they are
   named after. Both are held constant across all six configurations here, so
   they cannot shift the comparison — but they do shift absolute totals.
4. **E and F have no IaC.** Hand-built, so record the exact machine type, node
   count, and manifests alongside the results or the run is not reproducible.
