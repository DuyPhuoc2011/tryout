# Arena M1-B2 — Terraform Module & Arena Runner Implementation Plan

**Date:** 2026-07-23
**Branch:** `feat/arena-m1b1` (continues; B1 is not yet merged)
**Predecessor:** `docs/superpowers/plans/2026-07-20-arena-m1b1-lifecycle.md`
**M0 dependency:** none. B3 (load/chaos harness) and B4 (scoreboard) still wait on a recorded M0 GO.

## What This Milestone Is

M1-B1 stopped at the database: a buyer submits a design, `parseDesign` validates it,
`renderTfvars` renders it, and the turn lands as `submitted` with its `tfvars` jsonb. Nothing
consumes it. M1-B2 is the thing that consumes it — a first-party Terraform module that builds
a real buyer environment from exactly those variables, and a runner that applies it and drives
the two status machines to their next states.

**In scope:**

1. `infra/terraform/modules/arena-env/` — the fixed, reviewed module whose variables are
   exactly the `ArenaTfvars` fields.
2. Root-infra additions the runner needs: state bucket, runner service account, env runtime
   service account, arena DB admin secret.
3. `arena-runner` — a job binary that claims one `submitted` turn, applies it, and records the
   outcome.
4. TTL reaper — same binary, `--mode=reap`: `terraform destroy` for environments past
   `ttl_expires_at`, then `status = 'destroyed'`.
5. Cloud Run Job + Cloud Scheduler wiring so both modes run on a timer.

**Out of scope:** load generation, chaos injection, scoring, the scoreboard, GKE lever,
GitHub PR webhooks. Turns already arrive through the M1-B1 API endpoint, so no webhook is
needed — the "PR comment" phrasing carried forward from the M1-A plan predates that endpoint
and is dropped here deliberately.

## Environment Substrate — Decided 2026-07-23

Confirmed with the owner. 25 concurrent environments × 72h TTL makes per-environment managed
services the dominant cost of the whole arena, so only the lever that teaches the most is real
managed infrastructure:

| Design lever | Real resource | Why |
|---|---|---|
| `api_*` | `google_cloud_run_v2_service` | The core lever. Real min/max instances, concurrency, CPU, memory. Scales to zero, so an idle environment is ~free. |
| `worker_service_enabled` + `worker_*` | second `google_cloud_run_v2_service` | Same. `in_process` vs `separate_service` is the placement lesson. |
| `cache_enabled` / `cache_tier` | `redis:7-alpine` on Cloud Run, internal ingress | A real cache in the request path, at ~0 idle cost. **Not** Memorystore: 25 × 1GB Memorystore is ~$400/cycle and adds ~6 min to every apply. |
| `db_tier` | database on the existing shared Postgres VM, `CONNECTION LIMIT` per tier | A real, measurable saturation lever. **Not** Cloud SQL per environment, same cost reason. |

**Known ceiling, recorded here so B3 does not rediscover it:** `standard-1gb` differs from
`basic-1gb` only in HA failover, which this substrate cannot express — the Cloud Run Redis has
no replica. Both tiers therefore build the same resource and differ only in price via
`packages/arena/src/rates.ts`. If M0 returns GO and the chaos harness wants a real failover
drill, that is the moment to promote the cache lever to Memorystore, not before. Carry a
`ponytail:` comment at the resource saying exactly this.

Connection-limit mapping (`micro | small | medium` → `20 | 60 | 150`) is a first cut, not a
measurement. B3 tunes it against the traffic profile; until then it is a placeholder in the
same sense `par.ts` is.

## Architecture

```
Cloud Scheduler (*/1)  ──▶ Cloud Run Job: arena-runner --mode=apply
Cloud Scheduler (*/15) ──▶ Cloud Run Job: arena-runner --mode=reap
                                  │
                                  │ claim one row, FOR UPDATE SKIP LOCKED
                                  ▼
                          arena_turns / arena_environments  (Postgres, via VPC connector)
                                  │
                                  │ tfvars jsonb → re-validated → -var-file
                                  ▼
                     terraform init -backend-config=prefix=arena/<env_slug>
                     terraform apply infra/terraform/modules/arena-env
                                  │
                                  ▼
                    Cloud Run api [+ worker] [+ redis], arena DB
```

**Why polling and not Pub/Sub:** the API already owns the queue — it is a table with a status
column and an index. A scheduler tick that runs `FOR UPDATE SKIP LOCKED` is the entire
dispatch mechanism, needs no new infrastructure, no delivery semantics to reason about, and
degrades to "applies start up to 60s late" in its worst case. `MAX_TURNS_PER_HOUR` is 6 per
environment; nothing here is latency-sensitive.

**Why one turn per invocation:** an apply is minutes long and costs money. A job that claims
exactly one turn is trivially safe to run concurrently (SKIP LOCKED), trivially bounded in
cost, and needs no in-process concurrency control at all. Backlog drains at one turn per tick
per running job instance, and Cloud Run Jobs' `parallelism` is the knob if that is ever too
slow.

## Security Boundary

The runner is the first component in this project that holds credentials able to create
billable infrastructure, so the trust argument has to be explicit.

1. **Buyer input never reaches Terraform as text.** The runner reads `arena_turns.tfvars`
   jsonb and re-validates it against a zod schema (`arenaTfvarsSchema`, added to
   `@tryout/arena`) before writing it to a `-var-file`. `renderTfvars` already guarantees the
   shape at write time; re-validating at read time means a future bug, a manual `UPDATE`, or a
   restored backup cannot smuggle an unexpected key into a Terraform invocation. Unknown keys
   are a hard failure, not a warning.
2. **No shell.** Terraform is spawned with `execFile`/`spawn` and an argument array. No
   template string ever becomes a command line.
3. **The module is fixed code.** Buyer input selects values inside a module written and
   reviewed here. No HCL is generated, no provisioner, no `local-exec`, no container image
   from input.
4. **Scoped identity.** The runner SA gets `run.admin` + `iam.serviceAccountUser` (to deploy
   services as the runtime SA), `storage.objectAdmin` **on the state bucket only**, and
   `secretmanager.secretAccessor` on the arena DB admin secret only. It gets no project-level
   editor, no compute admin, no ability to touch the production `tryout-api` service beyond
   what `run.admin` implies — accepted, and narrowed by a resource-name prefix condition on
   the binding.
5. **Environments run as a powerless identity.** Every buyer Cloud Run service runs as one
   shared `arena-env-runtime` SA with no role bindings at all. A buyer environment can
   therefore call no Google API, which is the point.
6. **State isolation.** One GCS prefix per `env_slug`. A runner working on one environment
   cannot read or corrupt another's state file by any path that does not first involve
   choosing a different prefix, which comes from the database row it claimed.

## Tasks

### Task 1 — `arenaTfvarsSchema` in `@tryout/arena`

`packages/arena/src/render.ts` currently defines `ArenaTfvars` as a TypeScript interface only,
which is erased at runtime and cannot validate a jsonb column. Add a zod schema that mirrors
it exactly, derive the interface from it (`z.infer`), and export a `parseTfvars(value:
unknown)` that returns a discriminated result in the `parseDesign` style. Strict object, so
unknown keys fail.

Tests: valid round-trip from `renderTfvars`; unknown key rejected; wrong type rejected;
malformed `environment_id` rejected.

### Task 2 — The `arena-env` Terraform module

`infra/terraform/modules/arena-env/{variables.tf,main.tf,outputs.tf,versions.tf}`.

`variables.tf` declares exactly the twelve `ArenaTfvars` fields, each typed and with a
`validation` block mirroring the zod constraints (the module must be safe standalone, not only
when called by our runner). `environment_id` validates against `^env-[a-z0-9]{6,32}$`.

`main.tf`:
- `google_cloud_run_v2_service.api` — name `${var.environment_id}-api`, scaling from
  min/max, `max_instance_request_concurrency` from concurrency, resource limits from
  cpu/memory, runs as the `arena-env-runtime` SA, VPC connector for private DB egress,
  `DATABASE_URL` and `REDIS_URL` env vars, `WORKERS_IN_PROCESS` env var derived from
  `worker_service_enabled`.
- `google_cloud_run_v2_service.worker` — `count = var.worker_service_enabled ? 1 : 0`.
- `google_cloud_run_v2_service.cache` — `count = var.cache_enabled ? 1 : 0`, `redis:7-alpine`,
  internal ingress only, one instance, with the `ponytail:` comment recording the HA ceiling.
- `postgresql_database.env` + `postgresql_role.env` (cyrilgdn/postgresql provider) — database
  named after the slug, role with a password from the module's random generator, `CONNECTION
  LIMIT` from the tier map. Using the provider rather than an out-of-band SQL script means
  `terraform destroy` reclaims the database with no extra code path.

Module resources carry `labels = { arena_env = var.environment_id }` so a cost report and an
orphan sweep are both one filter away.

Check: `terraform init -backend=false && terraform validate && terraform fmt -check` in the
module directory. No apply in this task.

### Task 3 — Root-infra additions

In `infra/terraform/`:
- `google_storage_bucket.arena_state` — uniform access, versioning on, lifecycle rule deleting
  noncurrent versions after 30 days.
- `google_service_account.arena_runner` + the four bindings from the security section.
- `google_service_account.arena_env_runtime` — no bindings, deliberately.
- `google_secret_manager_secret.arena_db_admin` — the Postgres admin credential the runner's
  postgresql provider uses. Value set out of band, as the existing secrets are.
- `google_cloud_run_v2_job.arena_runner` + two `google_cloud_scheduler_job` triggers
  (`*/1 * * * *` apply, `*/15 * * * *` reap), each passing `--mode` via args override.

### Task 4 — Runner: claim and transition

`apps/api/src/arena-runner/` — a standalone entrypoint (`main.ts`) using
`NestFactory.createApplicationContext`, so it reuses `DbModule` and `config/env.ts` rather than
re-implementing them, and exits with a nonzero code on failure so Cloud Run Jobs records it.

`runner.service.ts`:
- `claimTurn()` — one transaction: `SELECT ... WHERE status = 'submitted' ORDER BY created_at
  LIMIT 1 FOR UPDATE SKIP LOCKED`, then `UPDATE ... SET status = 'applying', updated_at =
  now()`, plus the environment to `provisioning` if it is still `pending`. Returns the turn +
  environment or null.
- `recordSuccess(turnId, envId)` — turn → `applied`, environment → `ready`.
- `recordFailure(turnId, envId, message)` — turn → `apply_failed`, environment → `degraded`.
  The stored message is truncated and sanitized with `sanitizeText` from `@tryout/arena`:
  Terraform stderr is attacker-adjacent text (it can echo values from the design) and it will
  be rendered to a buyer in B4.

**Every one of these `UPDATE`s sets `updated_at: new Date()` explicitly.** This is the
carried-forward review item from the M1-B1 plan: Drizzle's `defaultNow()` fires only on
`INSERT` and there is no trigger, so a forgotten column freezes `updated_at` at insert time on
exactly the rows that are actively transitioning. Reviewer must check each write site.

Transitions are guarded in the `WHERE` clause, not just the code path (`... AND status =
'applying'`), so a double-delivered tick can never move a turn backwards or re-apply a
finished one.

### Task 5 — Runner: the Terraform executor

`terraform-executor.ts` — one narrow seam, injected, so every test above runs without
Terraform installed:

```ts
export interface TerraformExecutor {
  apply(tfvars: ArenaTfvars): Promise<{ ok: true } | { ok: false; message: string }>;
  destroy(envSlug: string): Promise<{ ok: true } | { ok: false; message: string }>;
}
```

The real implementation writes the validated tfvars to a temp file as JSON, runs `terraform
init -input=false -backend-config=prefix=arena/<env_slug>`, then `apply -input=false
-auto-approve -lock-timeout=120s -var-file=<tmp>`, with a hard timeout and captured stderr.
Temp file is removed in a `finally`. Spawned with an argument array, never a shell.

### Task 6 — TTL reaper

`--mode=reap`: select environments where `status <> 'destroyed' AND ttl_expires_at < now()`
(the `arena_env_live_ttl_idx` partial index from M1-B1 exists for exactly this query),
`destroy()` each, then `status = 'destroyed', updated_at = now()`. A failed destroy leaves the
row live so the next tick retries — an environment must never be marked destroyed while its
resources still bill. Reaps in a bounded batch (5 per tick) so one stuck destroy cannot
monopolize the run.

### Task 7 — Tests

Unit (`runner.service.spec.ts`), with a stub executor: claim returns null on an empty queue;
claim transitions both rows and stamps `updated_at`; success and failure paths write the right
terminal states; a guarded update on an already-terminal turn is a no-op; reaper skips rows
whose destroy failed.

E2E (`test/arena-runner.e2e-spec.ts`) against real Postgres, following the seven existing
arena suites: a submitted turn is claimed exactly once by two concurrent runners (the SKIP
LOCKED claim under real contention — the assertion that cannot be made against a mock);
rejected turns are never claimed; an expired environment is reaped.

## Done When

- `pnpm --filter @tryout/arena test`, `pnpm --filter @tryout/api test`, and
  `pnpm --filter @tryout/api test:e2e` all pass.
- `pnpm -r --workspace-concurrency=1 build` passes.
- `terraform validate` + `terraform fmt -check` pass in `infra/terraform/modules/arena-env/`
  and at the root.
- No test requires a Terraform binary, a GCP credential, or a network call.
- Every `UPDATE` in the runner sets `updated_at`; verified in review, not assumed.

## Deliberately Not Built

- Memorystore / Cloud SQL per environment — cost. Revisit only if M0 GO and B3 wants failover.
- Pub/Sub dispatch — the table is the queue.
- Retry/backoff on `apply_failed` — a failed apply is a buyer-visible turn outcome, and the
  buyer submits the next turn. Automatic retries would silently spend the rate limit.
- Per-environment service accounts — one powerless shared runtime SA is stricter and simpler.
- Cost reporting per environment — labels are in place; the report is B4's problem.

## Next (M1-B3, gated on M0 GO)

Load + chaos harness emitting the `Usage` and `RunMetrics` vectors `@tryout/arena` already
consumes, driving `applied` → `measuring` → `scored`, using the traffic profile numbers M0
produces.
