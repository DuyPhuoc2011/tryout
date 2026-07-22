"""Qualitative conversation evals (LLM-judge). Skipped unless OPENAI_* is set.

Scores Sam's multi-turn behavior: does she stay in role, ask focused
follow-ups, and avoid re-asking what the candidate already told her?
"""
import pytest

from client import IntakeSession
from conftest import judge_model, judge_ready
from personas import PERSONAS

pytestmark = pytest.mark.judge

if not judge_ready():
    pytest.skip("No LLM judge configured (set OPENAI_API_KEY/OPENAI_BASE_URL).",
                allow_module_level=True)

from deepeval import assert_test
from deepeval.test_case import ConversationalTestCase, MultiTurnParams
from deepeval.metrics import ConversationalGEval, KnowledgeRetentionMetric


@pytest.mark.parametrize("persona", PERSONAS, ids=lambda p: p.name)
def test_sam_conversation_quality(persona):
    sess = IntakeSession().run(persona.turns)
    case = ConversationalTestCase(turns=sess.deepeval_turns())

    model = judge_model()
    metrics = [
        KnowledgeRetentionMetric(threshold=0.6, model=model),
        ConversationalGEval(
            name="RecruiterBehavior",
            criteria=(
                "The assistant acts as a warm, focused talent lead. It asks ONE relevant "
                "follow-up at a time based on what the candidate just said, does NOT re-ask "
                "information already provided, and does NOT assign the candidate a project "
                "or team itself."
            ),
            evaluation_params=[MultiTurnParams.ROLE, MultiTurnParams.CONTENT],
            threshold=0.6,
            model=model,
        ),
    ]
    assert_test(case, metrics)
