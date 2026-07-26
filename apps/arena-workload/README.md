# @tryout/arena-workload

The scenario application the arena measures — the image `arena-env`'s
`var.scenario_image` points at.

It is deliberately **not** the marketplace API. `apps/api` has no background-job
tier (the queues left with the interview platform) and holds Stripe and GitHub
credentials that a buyer environment must never see. The arena's whole thesis is
job-shaped, so the workload under test needs a real job tier and nothing else.

## What it does

| Route | Purpose |
|---|---|
| `GET /healthz` | Cloud Run health probe. The only route the split worker serves. |
| `GET /api/read` | Cheap read, one DB round trip. API p95 tracks instance availability. |
| `GET /api/report` | Aggregate over the jobs table. Surfaces `db_tier` under load. |
| `POST /api/jobs` | Enqueue `{ durationMs, cpuRatio }`. |
| `GET /api/jobs/stats` | Queue depth plus job-start and job-duration p95 — the M0 measurement surface. |

Jobs burn roughly `cpuRatio` of their wall clock as real CPU. A job that only
slept would cost almost no vCPU-seconds, and vCPU-seconds are what the pricing
model turns into money.

## The lever it implements

`WORKERS_IN_PROCESS` decides whether the API process also drains the queue.
That single flag is the `workers.placement` lever the crossover is built on:

- `WORKERS_IN_PROCESS=true` — one service does both. No second `min_instances`
  floor to pay for, but request-scoped CPU throttles long jobs.
- `WORKERS_IN_PROCESS=false` — the API only enqueues. The split-out worker
  service runs with `WORKER_ONLY=true`, serves only `/healthz`, and bills its
  own floor.

The queue is **Postgres**, not Redis. The arena module wires Redis as a
per-instance Cloud Run sidecar at `127.0.0.1`, which the split-out worker
service cannot reach — a Redis queue would break in exactly the configuration
M0 has to measure. Claim uses `FOR UPDATE SKIP LOCKED`, the same pattern as the
arena runner.

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | required | Postgres connection string |
| `PORT` | `8080` | HTTP port |
| `WORKERS_IN_PROCESS` | `true` | Drain the queue in this process |
| `WORKER_ONLY` | `false` | Serve only `/healthz`; always drains |
| `WORKER_CONCURRENCY` | `1` | Parallel job loops per instance |
| `JOB_POLL_MS` | `250` | Idle poll interval |
| `REDIS_URL` | — | Accepted and ignored; see `src/config.ts` |

## Run it

```bash
docker compose up -d

DATABASE_URL=postgres://tryout:tryout@localhost:5432/tryout \
  pnpm --filter @tryout/arena-workload dev

# self-check: enqueue, claim, SKIP LOCKED under two concurrent claimers
DATABASE_URL=postgres://tryout:tryout@localhost:5432/tryout \
  pnpm --filter @tryout/arena-workload check
```

Build the image from the **monorepo root**:

```bash
docker build -f apps/arena-workload/Dockerfile -t arena-workload .
```
