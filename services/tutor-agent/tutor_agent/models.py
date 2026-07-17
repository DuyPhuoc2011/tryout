from pydantic import BaseModel


class Scenario(BaseModel):
    title: str
    tutor_brief: str


class Turn(BaseModel):
    role: str  # 'user' | 'assistant'
    content: str


class TurnRequest(BaseModel):
    scenario: Scenario
    phase: str | None = None
    history: list[Turn] = []
    message: str


class TurnResponse(BaseModel):
    reply: str
    phase: str
