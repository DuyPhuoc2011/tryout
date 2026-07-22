# Tryout — SRE Fault Catalog

Faults tailored to Tryout's real architecture on GCP. Work through them roughly
top-to-bottom (easy/clean → subtle/systemic). For each: inject it, detect it
*blind* (dashboards/logs only), mitigate, root-cause, then fill the **Learnings**
block. Claude helps write the Learnings after each drill.

## Architecture recap (what can break)

```
Candidate ──HTTP──> Cloud Run: web (Next.js)
                         │ NEXT_PUBLIC_API_URL (baked at build)
                         ▼
Candidate ──HTTP──> Cloud Run: api (NestJS)  ── runs BullMQ workers IN-PROCESS
                         │            │
              VPC connector      queues: poll-pr, poll-ci, pm-intro, review
                    │   │              │ (self-scheduling: re-enqueue w/ delay,
          ┌─────────┘   └─────────┐    │  stop at POLL_MAX_ATTEMPTS)
          ▼                       ▼    ▼
   Postgres on a VM         Memorystore (Redis)      ── external ──>
   (e2-micro, 1GB RAM,      private IP, 1GB           GitHub (Octokit)
   self-managed, no HA)                               Groq (OpenAI-compat LLM)
```

Self-hosted Postgres = you own the box: OS, disk, process, backups, recovery.
Far more to break (and learn) than managed Cloud SQL — see F13–F15.

Single points / pressure points: the **VPC connector** (only path to DB+Redis),
the **single Postgres VM** (no HA, no managed backups, 1GB RAM),
**min_instances=0** (workers die when idle), **GitHub + Groq** (external deps
with rate limits), **secrets** (boot-time).

---

## Severity / effort legend
- **Blast** = who feels it. **MTTD focus** = the detection skill it trains.

---

## F01 — Redis down (queue backend gone)
- **Blast:** all async work. Candidate submits PR → nothing happens. Login still works.
- **Tryout why:** every poller + agent job lives in BullMQ on Memorystore. No Redis = jobs can't enqueue/process. Failure is **silent** — API returns 200 on run creation, work just never happens.
- **Inject:** block the connector→Redis path (firewall deny egress to Redis IP), or `gcloud redis instances failover` / delete+recreate. Cheapest: set a bad `REDIS_URL` and redeploy api.
- **Expect:** enqueue errors in logs, queue processing flatlines, no PM intro appears, PR never detected.
- **Mitigate:** restore Redis / fix URL, redeploy.
- **Detect skill:** silent-failure detection, queue-depth / processing-rate alerting.
- **Learnings:** _(to fill)_

## F02 — Postgres connection exhaustion
- **Blast:** whole API — every DB-backed route 500s.
- **Tryout why:** self-hosted Postgres defaults to `max_connections=100`, but on 1GB RAM each backend eats memory — real ceiling is lower before the box thrashes. API pool + in-process workers + any migration all compete. A burst of concurrent runs starves it.
- **Inject:** SSH in (IAP) and lower `max_connections` in `postgresql.conf` + restart, or open a script holding N idle `psql` connections until the cap. Load-gen with `k6`/`hey` to amplify.
- **Expect:** `remaining connection slots are reserved` / `too many clients`, 500s spike, `SELECT count(*) FROM pg_stat_activity` pinned at max.
- **Detect skill:** saturation vs latency, pool sizing, connection limits × autoscaling math.
- **Learnings:** _(to fill)_

## F03 — Bad deploy (crashloop / 100% 5xx)
- **Blast:** API or web fully down.
- **Tryout why:** a broken image (missing env, throw at boot — e.g. a required secret unreadable) crashloops. Cloud Run keeps old revision serving *only if the new one never goes healthy* — worth verifying which.
- **Inject:** `gcloud run deploy tryout-api --image <broken>` (e.g. an image that exits non-zero), or ship code that throws in `main.ts`.
- **Expect:** revision fails health check, traffic behavior depends on rollout, 5xx if forced.
- **Mitigate:** `gcloud run services update-traffic tryout-api --to-revisions <good>=100` — instant rollback.
- **Detect skill:** rollback speed (MTTR), revision traffic splitting, health checks.
- **Learnings:** _(to fill)_

## F04 — Groq / LLM dependency failure (429 / 401 / timeout)
- **Blast:** agent features only — PM intro + senior review. Core app (auth, repo, PR detection) fine.
- **Tryout why:** `pm-intro` and `review` jobs call Groq. Bad key → 401, rate limit → 429, slow → timeout. Question to answer during drill: **does BullMQ retry forever, backoff, or dead-letter?** Candidate may get no welcome message.
- **Inject:** rotate `openai-api-key` secret to garbage (401), or hammer to hit Groq rate limit, or point `OPENAI_BASE_URL` at a black-hole for timeouts.
- **Expect:** `pm-intro`/`review` job failures, retries in logs, agentMessages/reviews rows never written.
- **Detect skill:** external-dependency failure, graceful degradation, retry/backoff/DLQ design.
- **Learnings:** _(to fill)_

## F05 — GitHub API failure (token expired / rate-limited)
- **Blast:** repo provisioning + PR/CI polling.
- **Tryout why:** Octokit does `createRepoFromTemplate`, `listOpenPullRequests`, `getCheckRuns`, `createPullRequestReview`. Expired token → run stuck at onboarding (no repo). 403 secondary-rate-limit → poll-pr/poll-ci silently stop detecting.
- **Inject:** rotate `github-token` secret to an invalid PAT; or trigger many polls to hit rate limit.
- **Expect:** repo create fails at run start, or polls log 401/403 and submissions never appear.
- **Detect skill:** upstream-quota incidents, distinguishing "our bug" vs "their limit."
- **Learnings:** _(to fill)_

## F06 — Latency injection / SLO breach
- **Blast:** everyone — slow, not down. The hardest to *notice* without SLOs.
- **Tryout why:** a sleep in a hot API path (or DB N+1 under load) pushes p95 past target. No hard error → only an SLO + burn-rate alert catches it.
- **Inject:** deploy a revision with an artificial delay on a common route; drive traffic with `k6`.
- **Expect:** p95/p99 latency climbs, error budget burns, no 5xx.
- **Detect skill:** SLO definition, error-budget burn-rate alerting (the core Google-SRE skill).
- **Learnings:** _(to fill)_

## F07 — Secret rotation break (boot-time config)
- **Blast:** API won't start, or agents 401 (depends which secret).
- **Tryout why:** `DATABASE_URL`, `JWT_SECRET`, `OPENAI_API_KEY`, `GITHUB_TOKEN` are pulled from Secret Manager at container start / call time. Wrong `DATABASE_URL` version → boot fail. Wrong `JWT_SECRET` → every existing token invalid (mass logout). Cloud Run pins `latest` at deploy — a new secret version needs a redeploy to take effect (itself a gotcha).
- **Inject:** add a bad `latest` version to a secret, redeploy.
- **Expect:** boot failure (db/jwt) or auth failures for all users (jwt).
- **Detect skill:** config-as-incident, secret versioning, "why did a deploy with no code change break?"
- **Learnings:** _(to fill)_

## F08 — VPC connector saturation / failure (SPOF)
- **Blast:** total API outage — can't reach DB *or* Redis.
- **Tryout why:** one Serverless VPC connector is the *only* path from Cloud Run to both private-IP backends. Saturate it (throughput cap, min=2/max=3 instances) or delete it → API can't talk to anything internal.
- **Inject:** delete the connector, or drive enough throughput to saturate it.
- **Expect:** every DB + Redis call times out simultaneously; symptom looks like "everything broke at once."
- **Detect skill:** identifying a shared dependency / SPOF from correlated symptoms.
- **Learnings:** _(to fill)_

## F09 — Scale-to-zero starves the workers ⭐ (most Tryout-specific)
- **Blast:** all async work, but *intermittently* — the confusing kind.
- **Tryout why:** BullMQ workers run **in-process in the API**, and Cloud Run `min_instances=0`. With no HTTP traffic the instance is torn down → **queued jobs sit unprocessed until the next request wakes an instance**. A candidate's PR gets detected only when *someone hits the API*. Looks like random, ghostly delays.
- **Inject:** nothing — it's the default. Create a run, send zero traffic, watch jobs stall; hit the API and watch them drain.
- **Expect:** jobs process in bursts correlated with traffic, long idle gaps.
- **Mitigate/discuss:** `min_instances=1` for the worker, or split workers into an always-on service / Cloud Run Job / Cloud Tasks. Architecture decision, not a config toggle.
- **Detect skill:** reasoning about *where* background work runs vs the serving model; the classic serverless-worker trap.
- **Learnings:** _(to fill)_

## F10 — Poll max-attempts exhaustion (config/timing incident)
- **Blast:** individual stuck submissions — no review ever posted.
- **Tryout why:** `poll-ci` self-reschedules up to `POLL_MAX_ATTEMPTS` (120) × interval. If CI is slow/flaky beyond that window, the poller **gives up**, `Submission.ciStatus` sticks, review never fires. No error — by design it just stops.
- **Inject:** set `POLL_MAX_ATTEMPTS=2` and a long CI, or a PR whose CI never completes.
- **Expect:** submission stalls at pending, poller stops logging after N attempts, no review row.
- **Detect skill:** "give-up" logic as a silent failure, timeout budget tuning.
- **Learnings:** _(to fill)_

## F11 — Web build-time env baked wrong (NEXT_PUBLIC_API_URL)
- **Blast:** frontend can't reach API — every client call fails, but web *loads*.
- **Tryout why:** `NEXT_PUBLIC_API_URL` is inlined at **build**. If CI builds without the right `--build-arg`, the client bundle calls the wrong/old URL → CORS/404 on login, signup, everything client-side. Runtime env won't fix it.
- **Inject:** deploy a web image built with a wrong API URL.
- **Expect:** page renders, network tab shows failed calls to wrong host.
- **Detect skill:** build-time vs runtime config, "it works locally" class of bug.
- **Learnings:** _(to fill)_

## F12 — Memorystore OOM / eviction
- **Blast:** lost jobs, corrupted queue state.
- **Tryout why:** 1GB basic Redis. If jobs pile up (e.g. combined with F09) or payloads grow, Redis hits maxmemory → evicts keys → BullMQ loses jobs / dedupe state silently.
- **Inject:** fill Redis (loop large `SET`s) or let a backlog grow under load.
- **Expect:** eviction metrics rise, jobs vanish, inconsistent queue counts.
- **Detect skill:** memory-bound dependency, capacity planning, cascading failure (pairs with F09).
- **Learnings:** _(to fill)_

## F13 — Postgres disk full ⭐ (VM-only)
- **Blast:** all writes fail; DB may refuse to start.
- **Tryout why:** the VM has a fixed 30GB disk, no autoresize (Cloud SQL had it). WAL + logs + data growth, or a runaway log, fills `/`. Postgres can't write WAL → transactions fail, then it won't accept writes at all.
- **Inject:** SSH in, `fallocate -l 29G /filler` (or `dd`) to fill the disk.
- **Expect:** `could not extend file` / `No space left on device`, writes fail, `df -h` at 100%.
- **Mitigate:** free space (delete filler/rotate logs), then grow the disk (`gcloud compute disks resize` + `resize2fs`).
- **Detect skill:** disk/host-resource monitoring, WAL growth, the "recover-then-resize" drill. Cloud SQL hides all of this.
- **Learnings:** _(drill 2026-07-06)_
  - **Detected by a user, not monitoring.** First signal was signup/onboarding failing to load — a customer-facing symptom. Worst possible MTTD: the page never came, we found out by trying the product.
  - **No alert fired.** Two gaps: (1) no disk-utilization alert exists at all — the Ops Agent now *ships* the disk metric but nothing watches it; (2) the `API error-log spike` alert also stayed silent — a single manual signup doesn't generate >5 ERROR/min, so the threshold never tripped. Alerts tuned for volume miss low-traffic failures.
  - **Diagnosis:** traced front-end → API → DB, landed on Postgres write failures against a full disk. Correct path, but slow because nothing pointed at "disk."
  - **Root cause:** disk at 100%, Postgres can't extend WAL/data files → writes fail.
  - **Action items:** (1) add a disk-usage alert (>85%) on the VM off the Ops Agent metric — *this would have paged before users noticed*; (2) reconsider the error-log alert: rate-threshold misses low-volume incidents — add a "any 5xx on a critical route" or synthetic probe; (3) manual recovery worked but there's no runbook — write one (free space → `resize2fs` → verify WAL).

## F14 — Postgres process killed / crash (VM-only)
- **Blast:** total DB outage until restart.
- **Tryout why:** no managed auto-restart failover. If the postgres process dies (OOM-killer, `kill -9`, bad config on restart), it stays down until *you* bring it back. `systemd` may restart it — or not, depending on how it died.
- **Inject:** SSH in, `sudo systemctl stop postgresql`, or `sudo kill -9 <postmaster pid>`.
- **Expect:** API DB calls refused/`connection refused`, service down until recovery.
- **Mitigate:** `systemctl start postgresql`; check `systemctl status` + `journalctl -u postgresql`. Practice reading the crash cause.
- **Detect skill:** process/liveness monitoring on a self-managed host, recovery runbook, systemd basics.
- **Learnings:** _(to fill)_

## F15 — VM OOM under 1GB RAM (VM-only)
- **Blast:** postgres killed by the kernel OOM-killer, or severe slowdown.
- **Tryout why:** e2-micro = 1GB shared. A heavy query (big sort/join with no index), too many connections, or `work_mem` set too high blows memory → Linux OOM-killer reaps the postgres backend (or postmaster).
- **Inject:** run a deliberately memory-heavy query, or crank `work_mem` + many parallel connections.
- **Expect:** OOM entries in `dmesg`/`journalctl`, a postgres backend vanishes mid-query, possible full restart.
- **Mitigate:** kill the offending query, tune `work_mem`/`max_connections`, add swap, or resize the VM.
- **Detect skill:** memory pressure vs the serving symptom, OOM forensics (`dmesg`), capacity vs config trade-off.
- **Learnings:** _(to fill)_

---

## Drill loop (run each fault like real on-call)
1. Inject (ideally have someone/script pick so you go in blind).
2. **Detect** — did an alert fire? If not, that gap is the lesson. Note MTTD.
3. **Triage** — timer on. Dashboards/logs/traces only, no peeking at the injection.
4. **Mitigate** — stop the bleeding (rollback/scale/restart) before root cause.
5. **Resolve** — fix root cause.
6. **Postmortem** — copy `incident-log-template.md`, fill timeline + MTTD/MTTR + missing alert + action items. Blameless.

## Progress
| Fault | Done | MTTD | MTTR | Missing alert? |
|-------|------|------|------|----------------|
| F01 Redis down | ☐ | | | |
| F02 Postgres conn exhaustion | ☐ | | | |
| F03 Bad deploy | ☐ | | | |
| F04 LLM dep failure | ☐ | | | |
| F05 GitHub API failure | ☐ | | | |
| F06 Latency / SLO | ☐ | | | |
| F07 Secret rotation | ☐ | | | |
| F08 VPC connector SPOF | ☐ | | | |
| F09 Scale-to-zero workers | ☐ | | | |
| F10 Poll max-attempts | ☐ | | | |
| F11 Web build env | ☐ | | | |
| F12 Redis OOM | ☐ | | | |
| F13 Postgres disk full | ☑ | user-reported (no page) | manual | disk-util >85% alert |
| F14 Postgres crash | ☐ | | | |
| F15 VM OOM | ☐ | | | |
