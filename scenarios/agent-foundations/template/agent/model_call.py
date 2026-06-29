"""TICKET AGENT-0: implement summarize().

summarize(client, text) must:
  - call client.create_message with model "claude-haiku-4-5", max_tokens 256,
    and a single user message asking for a one-sentence summary of `text`;
  - return the text of the first content block, stripped;
  - raise SummarizationError (not a raw exception) if the client call fails;
  - raise SummarizationError if the response has no content blocks.

Do NOT change the test files. Make the tests pass.
"""
from __future__ import annotations

from .llm_client import LlmClient

MODEL = "claude-haiku-4-5"
MAX_TOKENS = 256


class SummarizationError(Exception):
    pass


def summarize(client: LlmClient, text: str) -> str:
    raise NotImplementedError("Implement summarize() — see the ticket in this file's docstring.")
