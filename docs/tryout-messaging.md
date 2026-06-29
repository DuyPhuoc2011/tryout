# Tryout — Messaging & Positioning

> Aligned to `docs/superpowers/specs/2026-06-29-agent-trainer-pivot-design.md`
> (agent-building trainer for fresh/junior devs).
> Supersedes the prior two-sided-hiring messaging. Updated 2026-06-29.

## The one line

**Tryout is where junior devs learn to build real AI agents — on a real team, with a real
codebase, reviewed like the job.**

## Positioning

Tryout is not a course, a video series, or a certificate mill. It's a *simulated job that
teaches you to build AI agents*: you get a real repo and a real ticket, you build the agent,
and AI teammates — a PM with a vague request and a senior engineer who reviews your PR —
push you the way a real team would. You don't watch someone build an agent. You build it,
get it reviewed, fix it, and do it again until it's right.

The thing that makes it work: you learn by shipping, not by reading. Every scenario is a
rung on a ladder — call the model, give it a tool, make it reliable, give it knowledge,
prove it with evals, orchestrate it, ship it.

## Who it's for

Fresh grads and junior devs who can code but have never built a production AI agent — and
know that's where the work is going. They've done tutorials; they've never had a senior
review their agent code and tell them why it'll break in prod.

## The gift framing

Free. The value is real practice, honest review, and proof you can build agents — not a job
promised, not a credential sold.

### Taglines

- Learn to build AI agents by building them — and getting reviewed like the job.
- Stop watching agent tutorials. Start shipping agents.
- Your first AI-agent job, before your first AI-agent job.
- A free senior code review on the agent you built.
- Tutorials show you the happy path. Tryout shows you the prod path.

### The problem — in their words

You can code. You've watched the agent tutorials, copied the LangChain quickstart, maybe
shipped a toy chatbot. But "build an AI agent" in a real job means tool schemas that
validate, retries and cost guards that actually fire, retrieval that returns the right
chunk, evals that catch a regression before it ships — and no tutorial reviews your code or
tells you what you got wrong. You don't know what you don't know.

### What Tryout gives you (the three things)

**1. Real practice building agents, not toy demos.**
A real repo, a real ticket from a PM whose requirements aren't fully spelled out, an agent
you build piece by piece — model call, tools, reliability, knowledge, evals, orchestration.
You open real PRs, pass real CI, handle real review.

**2. Honest feedback from a senior who reviews your agent code.**
No tutorial tells you your tool schema is fragile, your error handling swallows failures, or
your retry has no budget guard. Tryout's senior engineer reviews the real diff and tells you
exactly what's holding you back — technical *and* professional (did you ask the clarifying
question before diving in?). Then you fix it and resubmit. Learning by iteration, not a grade.

**3. Proof you can build the thing companies are hiring for.**
A certificate says you finished a course. A Tryout scorecard shows you built reliable agents
on a real team and improved across attempts — with the evidence to back it.

### CTA

**Build your first agent — free.**

## Handling the skeptic

**"Is it real if the teammates are AI?"**
Real repo, real git, real PRs, real CI. The AI teammates create the exact friction a real
team does: a vague ticket, a code review that asks for changes, a senior who won't accept
swallowed errors. That friction *is* the learning.

**"How do you grade an AI agent? They're non-deterministic."**
We don't grade the model's vibes. We grade the *engineering around* the model — with the LLM
mocked. Did the tool schema validate? Did the retry fire? Did retrieval return the right
chunk? That's deterministic, and it's the part that actually breaks in production.

**"I'll just use AI to write the agent."**
Fine — using AI to build is the job. But the review-and-fix loop and the clarifying-question
signal are hard to fake, and the hidden suite tests whether the engineering actually holds.

**"Why not just do tutorials?"**
Tutorials show the happy path and never review your code. Tryout gives you the prod path —
unfamiliar repo, vague ticket, real review, retry until it's right.

## Voice

Confident and direct, a little empowering, never hypey. Speak honestly to the gap between
"I finished the tutorial" and "I can build this in a real job" without talking down.
Specific beats vague every time — "wire function-calling and watch CI catch your fragile
tool schema" lands harder than "learn to build agents."
