"""Thin HTTP driver for the Tryout intake agent (Sam).

Black-box: talks to the running NestJS API, so the TS stack and these Python
evals stay decoupled. Each IntakeSession signs up a throwaway user and walks a
conversation, exposing the live transcript + extracted profile after each turn.
"""
import itertools
import os

import requests

API = os.environ.get("TRYOUT_API", "http://localhost:3001")
_seq = itertools.count()


def api_up() -> bool:
    try:
        return requests.get(f"{API}/health", timeout=3).status_code == 200
    except requests.RequestException:
        return False


class IntakeSession:
    """One candidate's intake conversation with Sam."""

    def __init__(self) -> None:
        email = f"eval-{os.getpid()}-{next(_seq)}@tryout.dev"
        self.token = requests.post(
            f"{API}/auth/signup",
            json={"email": email, "password": "password123"},
            timeout=30,
        ).json()["token"]
        self._h = {"authorization": f"Bearer {self.token}"}

        s = requests.post(f"{API}/intake", headers=self._h, timeout=30).json()
        self.id = s["id"]
        self.transcript = s["transcript"]          # [{role: recruiter|candidate, content}]
        self.profile = s["profile"]
        self.ready = s["readyToPlace"]

    def say(self, content: str) -> str:
        """Send a candidate message, return Sam's reply. Raises on a failed turn."""
        r = requests.post(
            f"{API}/intake/{self.id}/messages",
            headers=self._h,
            json={"content": content},
            timeout=90,
        ).json()
        if "reply" not in r:
            raise RuntimeError(f"intake turn failed: {r}")
        self.transcript = r["transcript"]
        self.profile = r["profile"]
        self.ready = r["readyToPlace"]
        return r["reply"]

    def run(self, messages: list[str]) -> "IntakeSession":
        for m in messages:
            self.say(m)
        return self

    def deepeval_turns(self):
        """Map the transcript to deepeval Turns (recruiter->assistant, candidate->user)."""
        from deepeval.test_case import Turn

        role = {"recruiter": "assistant", "candidate": "user"}
        return [Turn(role=role[m["role"]], content=m["content"]) for m in self.transcript]
