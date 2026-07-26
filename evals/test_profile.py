"""Deterministic extraction checks for Sam. No LLM judge -> fast, free, stable.

Catches the real regressions: empty gaps/goals, missing languages, confidence
never moving. Runs the full scripted conversation per persona against the API.
"""
import pytest

from client import IntakeSession
from personas import PERSONAS


def _covered(expected: list[str], actual: list[str]) -> bool:
    lowered = [a.lower() for a in actual]
    return all(any(term.lower() in a for a in lowered) for term in expected)


@pytest.fixture(scope="module", params=PERSONAS, ids=lambda p: p.name)
def session(request):
    return IntakeSession().run(request.param.turns), request.param


def test_languages_extracted(session):
    sess, persona = session
    assert _covered(persona.expect_languages, sess.profile["languages"]), (
        f"{persona.name}: expected {persona.expect_languages} in "
        f"languages={sess.profile['languages']}"
    )


def test_strengths_and_gaps_not_empty(session):
    sess, persona = session
    # Every persona states clear strengths AND a weakness; both must be captured.
    assert sess.profile["strengths"], f"{persona.name}: strengths empty"
    assert sess.profile["gaps"], f"{persona.name}: gaps empty"


def test_goal_captured(session):
    sess, persona = session
    goals = (sess.profile.get("goals") or "").lower()
    assert goals, f"{persona.name}: goals empty"
    assert persona.expect_goal_keyword in goals, (
        f"{persona.name}: '{persona.expect_goal_keyword}' not in goals={goals!r}"
    )


def test_confidence_climbs(session):
    sess, persona = session
    # After a full informative conversation Sam should be reasonably confident.
    assert sess.profile["confidence"] >= 40, (
        f"{persona.name}: confidence only {sess.profile['confidence']}"
    )
