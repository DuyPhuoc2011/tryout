from __future__ import annotations

import pytest

from agent.model_call import MODEL, SummarizationError, summarize


def test_calls_model_with_expected_request_shape(make_client, ok_response):
    client = make_client(ok_response)
    summarize(client, "some long text")
    assert client.last_call is not None
    assert client.last_call["model"] == MODEL
    assert client.last_call["max_tokens"] == 256
    messages = client.last_call["messages"]
    assert len(messages) == 1
    assert messages[0]["role"] == "user"
    assert "some long text" in messages[0]["content"]


def test_returns_stripped_summary_text(make_client, ok_response):
    client = make_client(ok_response)
    assert summarize(client, "x") == "A concise summary."


def test_wraps_client_errors(make_client):
    def boom(**_):
        raise RuntimeError("network down")

    client = make_client(boom)
    with pytest.raises(SummarizationError):
        summarize(client, "x")


def test_errors_on_empty_content(make_client):
    class Empty:
        content: list = []

    client = make_client(lambda **_: Empty())
    with pytest.raises(SummarizationError):
        summarize(client, "x")
