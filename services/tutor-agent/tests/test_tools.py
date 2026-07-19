from langchain_core.language_models.fake_chat_models import FakeListChatModel

from tutor_agent.tools import make_tools

BRIEF = (
    "fault: a runaway cron fills the disk\n\n"
    "detection: pager fires on node_filesystem_avail < 10%\n\n"
    "mitigation: stop the cron, rotate and compress logs\n\n"
    "root cause: missing logrotate config on the new host"
)


def _tools(judge=None):
    return {t.name: t for t in make_tools(BRIEF, judge or FakeListChatModel(responses=["x"]))}


def test_lookup_runbook_returns_matching_section():
    out = _tools()["lookup_runbook"].invoke({"query": "how is it detected"})
    assert "node_filesystem_avail" in out
    assert "logrotate" not in out  # returned the detection section, not everything


def test_lookup_runbook_empty_brief_is_safe():
    tools = {t.name: t for t in make_tools("", FakeListChatModel(responses=["x"]))}
    assert tools["lookup_runbook"].invoke({"query": "anything"}) == "No runbook content available."


def test_grade_postmortem_calls_judge_model():
    judge = FakeListChatModel(responses=["Timeline: 2/2. Total 9/10. Add detection time."])
    out = _tools(judge)["grade_postmortem"].invoke({"postmortem": "we had an outage"})
    assert "Total 9/10" in out
