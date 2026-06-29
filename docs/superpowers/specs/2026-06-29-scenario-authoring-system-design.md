# Scenario-Authoring System (P1) — Design

> Written 2026-06-29.
> First sub-project of the "deep phase" (P1 of P1/P2/P3 — see below). Makes adding
> diverse, trustworthy scenarios cheap and repeatable, so the curriculum can grow
> without hand-cranking each scenario.
> Companion to `docs/superpowers/specs/2026-06-29-agent-trainer-pivot-design.md`.

## Context — why P1 first

The agent-trainer pivot's next phase has three reusable pieces plus content:
- **P1 — Scenario-authoring system** (this doc): make adding scenarios cheap + safe.
- **P2 — Smarter grader/teammate agents** (later): better judging for harder topics.
- **P3 — Curriculum content** (later): rungs 2–6 (RAG, evals, multi-agent, latency/cost…),
  authored via P1, judged via P2.

P1 is first because it unblocks "diverse scenarios at volume" and de-risks every future
rung — hand-cranking 5 more scenarios the way rungs 0–1 were built doesn't scale.

## The pain today

A scenario is scattered across three hand-made places:
- a prose doc in `scenarios/*.md` (not machine-read),
- a template repo dir in `templates/`,
- a large inline definition object in a `packages/db/src/seeds/*.ts` file,
- plus the reference/negative gates and the `gh` template-repo publish, all run by hand.

Adding scenario #N = rewrite a big TS object + build a template dir + manually gate +
manually create/flag the GitHub repo + seed. Hours, error-prone, and — worst — easy to ship
a hidden suite that doesn't actually discriminate (the trust landmine the strategy doc warns
about: a wrong suite fails good candidates / passes bad ones).

## What P1 delivers

A self-contained scenario folder convention + a `scenario` CLI that validates, gates,
publishes, and seeds a scenario from one source of truth. The **gate is the trust mechanism**
and is enforced before anything goes live.

## 1. Folder convention — `scenarios/<id>/`

```
scenarios/agent-foundations/
├── scenario.json        # manifest — single source of truth (definition + gate config)
├── template/            # student skeleton — RED; this is what gets published
│   ├── agent/model_call.py        (stub)
│   ├── tests/…                    (acceptance suite; mocks the LLM)
│   ├── .github/workflows/ci.yml, pyproject.toml, README.md, .gitignore
└── solution/            # overlay — only the files that change, makes the suite GREEN
    └── agent/model_call.py        (reference impl)   # gate-only, NEVER published
```

- One folder = one reviewable scenario.
- `solution/` overlays `template/` **by path**: for the green gate, the CLI copies
  `template/` then copies `solution/` over it.
- `solution/` is never published to the student GitHub repo.

## 2. `scenario.json` manifest

One file holding everything the engine and the pipeline need.

**Definition (the A/D/E/F the DB already stores):**
`title`, `catalog`, `projectType`, `team`, `company_context`, `ticket`, `clarifications`,
`agent_prompts` (`pm_mai`, `senior_alex`), `ground_truth`, `rubric` (technical + professional).
Same shape as the current `scenarios.definition` JSONB, so the seed step is a direct upsert.

**Repo:** `repo.template_ref`, `repo.default_branch`, `repo.ci`.

**Gate block:**
```jsonc
"gate": {
  "runtime": "python3.11",
  "test_cmd": "pip install -e \".[dev]\" && pytest -q",
  "mutations": [
    {
      "file": "agent/model_call.py",
      "find": "Summarize in one sentence:\\n\\n",
      "replace": "Summarize.",
      "expect_fail": "request shape test"
    }
  ]
}
```
- `runtime` + `test_cmd` keep the gate **stack-agnostic** — the CLI just runs `test_cmd`
  in a temp copy. Python/TS/anything works with no CLI changes.
- `mutations`: deliberate breaks applied atop the reference; each must make the suite fail.
  `find`/`replace` are literal string edits on `file` (relative to the merged template).
  At least one mutation is required (see Gate).

## 3. The `scenario` CLI

A new workspace package (`tools/scenario-cli`, name `@tryout/scenario-cli`) exposing a
`scenario` command, run via `tsx`. Depends on `@tryout/db` (seed), `@tryout/shared`
(definition types), and `@octokit/rest` (publish). Reads `GITHUB_TOKEN`/`GITHUB_OWNER`/
`DATABASE_URL` from the environment, same as the API.

Commands (each takes a scenario `<id>` = folder name under `scenarios/`):

- **`validate`** — schema-check `scenario.json`: required fields present; rubric weights sum
  to ~1.0 per dimension (tolerance 0.001); `repo.template_ref` set; every `solution/` file
  path also exists in `template/`; at least one `gate.mutations` entry; each mutation's
  `find` string occurs in the merged template file. Pure, no side effects.

- **`gate`** — in an OS temp dir:
  1. copy `template/` → run `test_cmd` → **must exit non-zero** (skeleton RED).
  2. copy `template/`, overlay `solution/` → run `test_cmd` → **must exit zero** (reference GREEN).
  3. for each mutation: start from template+solution, apply the literal `find`→`replace` on
     `file`, run `test_cmd` → **must exit non-zero** (suite catches the break).
  Any deviation fails the gate with a clear per-stage report. Runs `validate` first.

- **`publish`** — build a clean student copy (`template/` only, `solution/` excluded) into a
  staging temp dir; create the GitHub repo `GITHUB_OWNER/<template_ref>` if absent (or update
  its default branch if present), push the contents, and set `is_template=true` via the API.
  Idempotent: re-running updates the repo content.

- **`seed`** — upsert the scenario row into the DB from the manifest: ensure the `track`
  exists, then insert/update `scenarios` (title, version, `definition` = the manifest's
  definition fields, `projectType`, `available`, `repo.template_ref`) keyed on title.
  Reuses the existing idempotent-upsert pattern from the current seed scripts.

- **`release`** — `validate → gate → publish → seed`, short-circuiting on the first failure.
  **The gate must pass before publish or seed runs** — this is the enforced trust gate; a
  scenario cannot go live without skeleton-RED + reference-GREEN + every-mutation-RED.

## 4. Migration scope (this build)

Migrate the two agent scenarios into the new convention and prove the pipeline end to end:
- `scenarios/agent-foundations/` (from `templates/agent-foundations-py` + the rung-0 seed object)
- `scenarios/agent-tools/` (from `templates/agent-tools-py` + the rung-1 seed object)

For each: move template files into `template/`, lift the reference solution (currently in
`REFERENCE_SOLUTION.md`) into `solution/`, and lift the inline seed definition into
`scenario.json` with a `gate` block (reusing the mutations already verified by hand this
session). Then `scenario release <id>` reproduces today's hand-run result.

**Out of scope (documented follow-up):** migrating `scenario-01` (the TS NestJS scenario).
It keeps its existing `seed-scenario-01.ts` path and remains live. The CLI is already
stack-agnostic via `runtime`/`test_cmd`, so the TS path is low-risk to add later; until then
it is unproven in the pipeline.

**Also out of scope (later):** LLM-assisted authoring / auto-generated hidden suites
(strategy doc defers this behind the reference-gate), and P2/P3.

## Architecture — reused vs new

**Reused:**
- `@tryout/db` `createDb` + `scenarios`/`tracks` schema for the seed step.
- `@tryout/shared` `ScenarioDefinition` (incl. the `repo` field added in the slice) for typing
  the manifest's definition portion.
- `@octokit/rest` `createUsingTemplate`-adjacent calls for publish (create repo, push, set
  `is_template`) — same Octokit the API already uses.

**New:**
- `tools/scenario-cli/` package: command router + the five commands + a manifest Zod schema +
  a small temp-dir test-runner helper (copy dir, overlay, run `test_cmd`, capture exit code).
- `scenarios/agent-foundations/` and `scenarios/agent-tools/` folders.
- After migration: delete `seed-agent-scenarios.ts` (superseded by `scenario seed`); leave
  `seed-scenario-01.ts` and the `templates/agent-*` dirs until scenario-01 is migrated, then
  remove the duplicated `templates/agent-*` dirs.

## Error handling

- `validate` failures list every problem at once (don't stop at the first), so an author fixes
  in one pass.
- `gate` runs in a temp dir and never mutates the source folder; it captures `test_cmd`
  stdout/stderr and prints the failing stage's output on failure.
- `publish` checks for an existing repo before creating; surfaces GitHub errors clearly
  (bad token, no org access) rather than leaving a half-created repo.
- `release` is fail-closed: any failed stage aborts before publish/seed; nothing ships on a
  red gate.

## Testing

- **CLI unit tests:** `validate` (rubric-sum, missing fields, missing solution file, no
  mutation, find-string-absent) against fixture manifests; the temp-dir overlay helper
  (template+solution merge, mutation apply) on a tiny fixture scenario.
- **Gate integration:** a fixture scenario with a known-good `solution/` and one mutation —
  assert `gate` passes; then a fixture whose suite passes everything (a mutation that does
  NOT fail) — assert `gate` reports failure (proves the negative gate is enforced).
- **Migration proof:** `scenario validate agent-foundations` and `scenario gate
  agent-foundations` pass; same for `agent-tools`. (Publish/seed verified manually against the
  live DB + GitHub, since they perform real writes.)
- **Engine regression:** existing API unit + e2e suites stay green (P1 doesn't touch the API).

## Open decisions

- CLI package location: `tools/scenario-cli` vs `packages/scenario-kit`. Lean `tools/` —
  it's dev-time tooling, not a shipped runtime package. (`ponytail`: one small package, not a
  framework.)
- Mutation expressiveness: literal `find`/`replace` only for now. Add regex or patch-based
  mutations later only if a real scenario needs a break that a literal edit can't express.
