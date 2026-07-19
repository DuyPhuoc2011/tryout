from fastapi import Depends, FastAPI, Header, HTTPException
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from tutor_agent.graph import build_graph, system_prompt
from tutor_agent.llm import get_chat_model
from tutor_agent.models import TurnRequest, TurnResponse
from tutor_agent.phases import FIRST_PHASE
from tutor_agent.settings import settings
from tutor_agent.tools import make_tools

app = FastAPI(title="Tutor Agent")


# Overridable in tests via app.dependency_overrides.
def model_provider():
    return get_chat_model()


def require_token(x_internal_token: str = Header(default="")):
    if x_internal_token != settings.internal_token:
        raise HTTPException(status_code=401, detail="bad internal token")


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/agent/turn", response_model=TurnResponse)
def turn(
    req: TurnRequest,
    _: None = Depends(require_token),
    model=Depends(model_provider),
) -> TurnResponse:
    phase = req.phase or FIRST_PHASE
    tools = make_tools(req.scenario.tutor_brief, judge_model=model)
    graph = build_graph(model, tools)

    messages = [SystemMessage(system_prompt(phase, req.scenario))]
    for t in req.history:
        messages.append(
            AIMessage(t.content) if t.role == "assistant" else HumanMessage(t.content)
        )
    messages.append(HumanMessage(req.message))

    out = graph.invoke(
        {"messages": messages, "phase": phase, "reply": "", "next_phase": phase}
    )
    return TurnResponse(reply=out["reply"], phase=out["next_phase"])
