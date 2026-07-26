# Tryout — Product Strategy

> Source of truth for *why* Tryout is built the way it is and *what order* to build it.
> Companion to `docs/superpowers/specs/2026-07-15-scenario-marketplace-design.md` (the product spec) and `docs/STATUS.md` (milestone state).
> Written 2026-06-26. Revised 2026-07-15 for the scenario-marketplace pivot.

## The pain Tryout kills

Developers who want to move into DevOps/SRE work have no safe way to practice the job
that actually matters:

- Tutorials teach "how to deploy an app." They don't teach **Day-2 operations** — keeping
  a system alive under real failure: disk-full outages, auth breakage, on-call incidents,
  monitoring that actually catches the problem before a user does.
- Real incidents are the best teacher, but nobody publishes their outages as structured,
  reproducible learning material.
- Existing practice content (courses, sandboxes) is generic — not built from a real
  production failure with real IaC and real root cause.

Tryout sells **real incidents, turned into scenarios**: the story, the infra-as-code,
the configs, and the runbook, mined from actual production failures.

> **Pitch:** "Practice the outage before it's your 3am page. Real incidents, real IaC,
> not a tutorial."

## Who buys

**Developers pursuing a DevOps/SRE path** — individual buyers, not institutions. They
find the free story (posted publicly), get value from the narrative alone, and pay for
the full teardown (IaC + source + configs + runbook) to actually rebuild and study the
failure themselves.

## The funnel

```
FREE (acquisition)                      PAID (one-time, per scenario)
  │ scenario story published               │
  │ on social media: what broke,           │
  │ why it mattered, what it looked like   │
  ▼                                        ▼
 reader is hooked                    Stripe Checkout → buyer added as
  │                                  read-only collaborator on a
  │                                  private GitHub content repo:
  └──── clicks through ────────────►  IaC, source, configs, runbook
```

No matching, no institutions, no grading pipeline in the loop. This is a content
product: story free, teardown paid, delivered via GitHub repo access.

### AI's role is bounded: assistant, not simulated teammates

Earlier design (interview-platform era) simulated a PM and senior engineer as scripted
personas grading submissions. That direction is **dormant, not deleted** — the code
remains but isn't part of the active product.

The current AI role is much smaller: a **plain assistant** that answers questions about
a purchased scenario. No persona-simulation, no automated grading, no PM/senior-engineer
roleplay. An **AI mentor** (graduated hints without spoiling the solution) is scoped as
a deferred, post-MVP feature — not built yet.

## What "a scenario" is now

Each listing = 4 parts, authored from a real incident in this project's own GCP
deployment:

- **Story** (free) — what happened, why it mattered, narrative framing for social media.
- **Contents summary** (free) — a "what's inside" teaser shown on the listing page.
- **IaC + source + configs** (paid) — the real Terraform/config/code that reproduces the
  environment.
- **Runbook** (paid) — the actual diagnosis-and-fix path taken.

Launch catalog: 2-3 scenarios mined from this project's real incidents (Postgres
disk-full, LLM auth failures, monitoring buildout). GCP-only at launch.

## Sequencing

Per the 2026-07-15 design spec, MVP is **content-only**:

1. Ship schema + API (`catalog`, `purchases`) + web pages — an empty catalog is
   harmless.
2. Author scenario #1 (`pg-disk-full`, the real incident) in a private repo; publish via
   CLI seed script (single-author, no admin UI yet).
3. Verify checkout → GitHub-invite flow end-to-end in Stripe test mode on Cloud Run,
   then switch to live keys.
4. Post the free story publicly — funnel starts.

Deferred post-MVP: one-click hosted launch of a scenario on our own infra (priced at
hosting cost), the AI mentor, subscriptions/coupons, refund automation, admin UI, AWS
scenarios.

## Open decisions

- Social channel(s) for posting the free story.
- Pricing per scenario (currently a placeholder in the schema).
- Whether/when to revisit the dormant interview-platform code, or retire it outright.
