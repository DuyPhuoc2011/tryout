# Tryout — Product & Build Specification (v1 / MVP)

> Product name: **Tryout**.
> This document specs the **first version only**. It is written to be handed to Claude Code as a build assignment.

---

## 0. How Claude Code should use this document

Read this whole file before writing code. Then build in the order given in **Section 11**, not all at once.

Three hard rules for this build:

1. **Build the thin end-to-end slice first.** One user, one hardcoded scenario, the full loop working start to finish, before adding anything else. A working ugly loop beats a beautiful half-loop.
2. **Do not expand scope beyond Section 4.** If something feels like it belongs in the product but isn't in the "IN" list, it is out for v1. The "OUT" list is deliberate, not an oversight.
3. **When building the web UI, first read the `frontend-design` skill** (`/mnt/skills/public/frontend-design/SKILL.md`) and follow it. The UI should look intentional, not like a default template.

The single most important design principle, which everything below serves: **the realism must come from the real technical substrate (a real repo, real git, a real pull request, real CI), not from the AI agents sounding human.** If the user is doing real engineering work and the agents wrap it in realistic team friction, this is a real product. If the agents are chatbots handing out coding puzzles, it is a toy. Build accordingly.

---

## 1. What this is (vision)

Juniors and freshers don't fail because they can't code. They fail because they've never worked on a real team — an unfamiliar codebase they didn't write, ambiguous tickets, code review, communicating with a PM, asking for help well, handling feedback without getting defensive. That gap is why companies are reluctant to hire them.

Existing "virtual job simulation" products (Forage and similar) let you *watch* the job through a few hours of pre-recorded videos and example answers. Tryout lets the user *do* the job: they join a software team where every other role is played by an AI agent, get assigned real work on a real codebase, ship a real pull request, and get graded on both the code **and** the professional behavior around it.

**Positioning to preserve in the product's DNA:** we are not training freshers to do rote coding faster (AI is eating that). We are producing the kind of junior who is still worth hiring in an AI world — one with judgment, communication, and the ability to function on a team. Keep this framing visible in the experience and the feedback.

---

## 2. Target user and buyer

- **User in v1:** an aspiring or early-career **backend engineer** (bootcamp grad, CS student, or self-taught fresher). One role only — see Section 4.
- **Buyer (later, not v1):** Vietnamese mid-sized software/services firms that hire freshers in batches, and coding bootcamps that live or die on placement rates. The eventual revenue model is institutional (they pay; individuals use it), but **v1's job is to prove the experience works and generate outcome data**, not to sell to institutions yet.
- **Implication for this build:** design the data model so cohorts/organizations and outcome reporting can be added later (Section 7), but **do not build any admin or cohort dashboard in v1.**

---

## 3. The core experience (the loop)

This is the heart of the product. The whole MVP exists to make this single loop excellent.

1. User signs up and is placed on the backend track (the only track in v1).
2. **Join the team.** The AI Product Manager welcomes them, gives brief context on the (fictional) company, product, and team, and tells them their role.
3. **Onboarding.** The user is given access to a real codebase (a GitHub repo instantiated for them from a template) plus a short README/architecture overview. They are expected to orient themselves in code they didn't write.
4. **Ticket assigned.** The PM assigns a ticket. The ticket is **intentionally slightly ambiguous** — written so that a good engineer would ask a clarifying question before diving in. (Asking, or failing to ask, is graded.)
5. **Work, with a team around them.** The user can:
   - chat with the **PM** to clarify requirements,
   - chat with the **Senior Engineer** to ask for help (the Senior helps without handing over the answer).
   These interactions are part of the graded experience, not a side channel.
6. **Submit.** The user implements the change, pushes a branch, and opens a **real pull request**.
7. **Review + CI.** Real CI runs the test suite on the PR. The **Senior Engineer agent reviews the actual diff**, leaves review comments, and requests changes at least once (realistic — first PRs rarely merge clean).
8. **Iterate.** The user responds to review feedback and pushes updates. How they respond is graded.
9. **Scorecard.** When the task is done (or the soft deadline passes), the **Grader** produces a scorecard across two dimensions — technical and professional — with specific, actionable, kind feedback.
10. User reviews results, and can retry the scenario or move to the next one.

An optional **scope change** (the PM revises the requirement partway through) can be injected once to simulate real-world messiness. Make this configurable per scenario, off by default for the very first run.

---

## 4. MVP scope — what's IN and what's OUT

### IN (build these)

- **One role:** backend engineer.
- **One hand-authored scenario** (do not build scenario generation yet — see OUT).
- **GitHub-backed real work:** a per-user repo instantiated from a template, real branch + PR + CI.
- **Three agents:** Product Manager, Senior Engineer/Reviewer, and a Grader (the Grader is not a chat participant — it runs at the end).
- **Dual grading:** technical correctness/quality **and** professional behavior, each producing a score plus written feedback.
- **Basic auth** (email/password or a single OAuth provider — keep it minimal).
- **A clean, intentional web UI** for the experience: team intro, codebase/ticket view, chat with agents, PR/review status, and the final scorecard.
- **Async job handling** for the slow parts (CI waits, grading) so the UI never blocks.

### OUT (explicitly not in v1 — do not build)

- Any role other than backend (no frontend, data, QA, or PM tracks).
- AI/automatic **scenario generation** — v1 uses one human-authored scenario. (Generation is the long-term moat but premature now; one excellent scenario first.)
- Complex multi-agent orchestration frameworks — keep the agent layer simple (Section 5).
- Admin/instructor/cohort **dashboards** or reporting UI.
- Certification or credentialing.
- Payments/billing.
- Multiplayer (multiple humans on one simulated team).
- Mobile app.
- A built-in/embedded code sandbox or IDE — the user uses their own environment + GitHub (Section 12 has the rationale and a lightweight later option).

If a feature isn't in the IN list, it waits.

---

## 5. Key architectural decisions (and why)

**Decision 1 — Realism comes from real GitHub repos, not a sandbox we build.**
On scenario start, create a real repository for the user from a template (via the GitHub API / a GitHub App). The user works in their own environment, opens a real PR, and real CI (GitHub Actions) runs the real test suite. The Senior agent reviews the **actual diff** through the GitHub API and posts **real review comments** on the PR. This is the decision that makes the product feel like a job instead of a game, and it offloads the hardest infrastructure (hosting code, running CI, PR mechanics) to GitHub. Do not build a code execution sandbox for v1.

**Decision 2 — Keep the agent layer simple.**
For v1 the agents do not need a complex graph or autonomous planning. Each agent is essentially a well-prompted LLM call that always receives the **scenario's ground-truth context** (the intended solution, the rubric, the agent's persona and rules). The PM and Senior are request/response chat handlers; the Grader is a single structured evaluation call over the full transcript. Resist the urge to over-engineer this into a multi-agent system — that complexity buys nothing for one scenario and one user. (A graph framework can come later if scenarios get richer.)

**Decision 3 — The scenario is structured data and is the source of truth for grading.**
Because we author the scenario, we hold the ground truth: the intended approach, the acceptance criteria, the rubric. This is what makes grading reliable rather than hand-wavy LLM-as-judge. The scenario definition (Section 8) is the spine of the system.

---

## 6. Technical stack

Use the stack the author already works in. Recommendations, with the genuinely open choices flagged in Section 12.

- **Frontend:** Next.js (TypeScript).
- **Backend:** NestJS (TypeScript).
- **Database:** PostgreSQL. ORM: Drizzle suggested (author's choice — Prisma is fine too).
- **Auth:** minimal — email/password or a single OAuth provider.
- **LLM provider:** behind a thin provider abstraction so the model can be swapped. Author chooses the provider (e.g. Vertex AI / Gemini, Anthropic, or OpenAI). Do not hardcode one vendor's SDK throughout — wrap it.
- **GitHub integration:** a GitHub App (preferred) or PAT for repo creation, PR access, posting review comments, and reading CI status. CI itself is GitHub Actions defined in the template repo.
- **Async jobs / queue:** BullMQ (Redis) for grading runs and any polling of CI status — keep the request path non-blocking.
- **Hosting:** GCP (Cloud Run) fits the author's stack.

---

## 7. Data model (core entities)

Keep it minimal but shaped for the future. Suggested entities and the key fields:

- **User** — id, email, auth fields, created_at. (Optional nullable `organization_id` now, even though orgs aren't built, so cohorts can attach later without a migration headache.)
- **Track** — id, name (only "backend" exists in v1). Lets roles be added later without schema changes.
- **Scenario** — id, track_id, title, version, definition (the structured scenario, Section 8), status.
- **ScenarioRun** — id, user_id, scenario_id, status (onboarding | in_progress | in_review | grading | complete), started_at, deadline_at (nullable), repo metadata, created_at. This is one user's attempt.
- **Repo** — link between a ScenarioRun and the real GitHub repo (repo url, default branch, PR number once opened). Can be folded into ScenarioRun if simpler.
- **AgentMessage** — id, scenario_run_id, agent_role (pm | senior), direction (user | agent), content, created_at. The full conversation, also the input to grading.
- **Submission** — id, scenario_run_id, pr_url, ci_status, ci_results, created_at. (May be multiple as the user iterates.)
- **Review** — id, submission_id, agent_role (senior), comments, verdict (approve | request_changes), created_at.
- **Scorecard** — id, scenario_run_id, technical_score, technical_feedback, professional_score, professional_feedback, overall_feedback, created_at.

Reserve but do not build: **Organization** and **Cohort** entities (for the institutional buyer later).

---

## 8. The scenario format

A scenario is a structured definition (store as JSON/JSONB; a YAML authoring format that compiles to it is fine). It must contain:

- **Metadata:** title, track, difficulty, estimated duration.
- **Company/team context:** the fictional product, team, and the user's role, used by the PM's intro and as shared context for all agents.
- **Repo template reference:** which template repository to instantiate for the user, including the README/architecture doc and the GitHub Actions test workflow.
- **Ticket(s):** the assigned task, written with **deliberate, bounded ambiguity** so a strong engineer asks a clarifying question. Include the "correct" clarification(s) so the PM and Grader know what a good question looks like.
- **Ground-truth solution notes:** the intended approach and the acceptance criteria (what the tests check, what good code here looks like). Used by the Senior (to help without revealing) and the Grader (to score).
- **Injected events (optional):** e.g. a single scope change the PM can introduce partway through. Off by default for the first run.
- **Agent persona configs:** personality and behavioral rules for the PM and Senior in this scenario (see Section 9).
- **Grading rubric:** the technical and professional criteria and their weights (Section 10).

**For v1, author exactly one scenario** end to end and make it genuinely good. Everything else (a second scenario, then generation) comes after the loop works.

---

## 9. The agents

Three agents. All three always receive the scenario's ground-truth context. Prompts live in version control, not the database, for v1.

**Product Manager (chat).**
- Welcomes the user, gives team/product context, assigns the ticket.
- Answers clarifying questions about requirements. **Rewards good questions** with useful detail; if the user asks nothing and starts coding on the ambiguous ticket, that's a (negative) signal the Grader will see.
- Can introduce the optional scope change once, if the scenario enables it.
- Stays in character: a busy but reasonable PM, not an oracle.

**Senior Engineer / Reviewer (chat + PR review).**
- Answers help requests **without handing over the solution** — nudges, points at the right file, asks what they've tried. Never pastes the answer.
- After the PR is opened, reviews the **real diff** via the GitHub API: leaves specific review comments and a verdict, and **requests changes at least once** on the first submission.
- Communicates in clear, professional, slightly terse async English — this deliberately seeds the "communicating with a senior/foreign teammate" muscle that matters in this market. (Full international-client scenarios are a fast-follow, but start the user practicing here.)

**Grader (runs once, at the end — not a chat participant).**
- Input: the full agent conversation, the PR and its diff, the CI/test results, the review thread, and the scenario ground truth + rubric.
- Output: a structured scorecard (Section 10). Because it has the ground truth, its judgments are anchored, not vibes.
- Tone of written feedback: specific, actionable, and kind — this is a learning product, never demoralizing.

---

## 10. Grading and feedback

Two dimensions, scored and explained separately, then an overall note.

**Technical:**
- Did CI pass / do the tests pass?
- Correctness against the acceptance criteria.
- Code quality (readability, structure, fit with the existing codebase) — LLM review of the diff against the rubric.

**Professional (this is the part that makes the product special — treat it as core, not a bonus):**
- Did they ask a good clarifying question on the ambiguous ticket, or charge ahead blindly?
- Quality of the PR description (does it explain what and why?).
- How they responded to review feedback (incorporated it? defensive? asked good follow-ups?).
- Communication clarity throughout the chats.

**Output:** `technical_score`, `professional_score`, written feedback for each, and an overall summary. Present it in the UI as a clear scorecard the user can act on, with the option to retry.

Keep the rubric authored per-scenario (in the scenario definition) so scoring is consistent and explainable.

---

## 11. Suggested build order (milestones)

Build and verify each milestone before the next. Each should be demoable.

- **M0 — Skeleton.** NestJS backend, Next.js frontend, Postgres, auth, deploy to Cloud Run. A user can sign up and log in.
- **M1 — GitHub spine.** Given a template repo, instantiate a per-user repo, detect when the user opens a PR, and read its CI status and diff via the GitHub API. No agents, no UI polish — prove the plumbing.
- **M2 — The visible loop (no grading yet).** Hardcode the one scenario. PM intro + ticket assignment in the UI; user opens a PR; Senior agent reviews the real diff and posts comments. The user can go from "joined" to "reviewed" end to end. This is the make-or-break demo.
- **M3 — Conversations.** Chat with the PM (clarify) and the Senior (help), persisted as AgentMessages.
- **M4 — Grading.** Implement the Grader and the scorecard (technical + professional), run as an async job, render the result.
- **M5 — Polish.** Tighten the UX (read `frontend-design` first), add retry/next, handle the soft deadline, enable the optional scope change.

**Post-MVP, in order:** a second hand-authored scenario → scenario authoring tooling → scenario generation (the moat) → a second role. Do not pull these forward.

---

## 12. Open decisions for the author (resolve before/while building)

- **LLM provider and model.** Pick one and put it behind the provider abstraction.
- **ORM.** Drizzle vs Prisma.
- **Where the user writes code in v1.** Simplest: their own local environment + GitHub (recommended — zero infra, maximum realism). A lightweight in-browser option (e.g. linking GitHub Codespaces / github.dev) can come later; do **not** build a custom embedded IDE.
- **Deadline mechanic.** Recommended for v1: **soft** — track time and surface it, but don't hard-fail the user. Real-world pressure is better simulated through the PM and review friction than a stopwatch that feels like a coding test.

---

## 13. Principles to preserve (don't let these erode)

- Realism lives in the **real technical substrate**, not in agents sounding human.
- Grading the **soft skills is the product**, not a feature to bolt on.
- Lean into **messiness** — ambiguity, a scope change, review friction — over a countdown timer.
- **One scenario excellent before many; one role before several.**
- Keep the positioning sharp: we produce the **AI-resistant junior**, and the "working with a senior/foreign teammate" communication skill is a deliberate differentiator to deepen over time.
