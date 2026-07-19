"""P2 tutor tools: lookup_runbook (brief excerpt) + grade_postmortem (LLM judge).

Built per-request as closures so the brief and judge model are captured without
any global state. `make_tools` returns plain LangChain tools ready to bind.
"""

import re

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.tools import BaseTool, tool

_WORD = re.compile(r"[a-z0-9]+")

_JUDGE_SYSTEM = """You grade an incident postmortem draft. Score each criterion \
0-2 (0 missing, 1 partial, 2 solid) and give one line of concrete feedback each:
- timeline of events
- root cause (mechanism, not just symptom)
- customer/impact scope
- detection & response (how it was found, time to mitigate)
- remediation & follow-up action items

End with a total out of 10 and the single most important thing to add. Be brief \
and specific. Do not rewrite the postmortem for them."""


def _keywords(text: str) -> set[str]:
    return {w for w in _WORD.findall(text.lower()) if len(w) > 3}


def make_tools(brief: str, judge_model) -> list[BaseTool]:
    @tool
    def lookup_runbook(query: str) -> str:
        """Look up the relevant part of the incident runbook/brief for a topic
        (e.g. "detection signals", "root cause", "mitigation"). Returns the
        matching section text."""
        # ponytail: naive keyword overlap over blank-line-separated sections;
        # swap for pgvector RAG in P3 if brief-in-prompt proves thin.
        sections = [s.strip() for s in re.split(r"\n\s*\n", brief) if s.strip()]
        if not sections:
            return "No runbook content available."
        q = _keywords(query)
        if not q:
            return "\n\n".join(sections)
        ranked = sorted(
            sections,
            key=lambda s: len(q & _keywords(s)),
            reverse=True,
        )
        best = ranked[0]
        return best if q & _keywords(best) else "\n\n".join(sections[:2])

    @tool
    def grade_postmortem(postmortem: str) -> str:
        """Grade the learner's written postmortem draft against an SRE rubric and
        return per-criterion feedback plus a score. Use when the learner submits
        or asks you to review a postmortem."""
        result = judge_model.invoke(
            [
                SystemMessage(_JUDGE_SYSTEM),
                HumanMessage(f"Postmortem draft:\n\n{postmortem}"),
            ]
        )
        return result.content if hasattr(result, "content") else str(result)

    return [lookup_runbook, grade_postmortem]
