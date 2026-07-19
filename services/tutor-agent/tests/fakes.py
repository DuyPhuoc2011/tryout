"""Minimal tool-capable fake chat model for tests.

langchain_core's FakeListChatModel/FakeMessagesListChatModel don't implement
`bind_tools`, which the tool-calling graph requires. This fake returns preset
AIMessages in order and treats bind_tools as a no-op (the preset tool_calls
drive the loop; ToolNode runs the real tools).
"""

from typing import Any

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage
from langchain_core.outputs import ChatGeneration, ChatResult


class FakeToolModel(BaseChatModel):
    responses: list[AIMessage]
    i: int = 0

    def bind_tools(self, tools, **kwargs):  # noqa: ARG002 - tools ignored on purpose
        return self

    def _generate(
        self, messages: list[BaseMessage], stop=None, run_manager=None, **kwargs: Any
    ) -> ChatResult:
        msg = self.responses[self.i]
        self.i += 1
        return ChatResult(generations=[ChatGeneration(message=msg)])

    @property
    def _llm_type(self) -> str:
        return "fake-tool"


def tool_call(name: str, args: dict, call_id: str = "1") -> AIMessage:
    return AIMessage(
        content="",
        tool_calls=[{"name": name, "args": args, "id": call_id, "type": "tool_call"}],
    )
