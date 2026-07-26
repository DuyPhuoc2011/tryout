"""Golden candidate personas: scripted answers + what Sam should extract.

`expect_*` terms are matched loosely (case-insensitive substring against any
extracted item), so they tolerate model wording variance ("Python" vs "python",
"REST APIs" vs "REST") while still catching real extraction misses.
"""
from dataclasses import dataclass, field


@dataclass(frozen=True)
class Persona:
    name: str
    turns: list[str]
    expect_languages: list[str] = field(default_factory=list)
    expect_goal_keyword: str = ""          # substring expected somewhere in goals


PERSONAS = [
    Persona(
        name="junior_backend",
        turns=[
            "I'm a junior backend developer with about a year of experience.",
            "Mostly Python and Django. I've built REST APIs and worked with Postgres and ORMs.",
            "I'm comfortable with API design and database schemas, but weaker on automated testing and CI.",
            "My goal is to grow into a backend lead role.",
        ],
        expect_languages=["python"],
        expect_goal_keyword="lead",
    ),
    Persona(
        name="senior_frontend",
        turns=[
            "Senior frontend engineer, about six years in.",
            "TypeScript and React mostly. Strong on performance and design systems.",
            "I'm weaker on backend services and infrastructure.",
            "I'm aiming for a staff engineer role.",
        ],
        expect_languages=["typescript"],
        expect_goal_keyword="staff",
    ),
    Persona(
        name="platform_devops",
        turns=[
            "Platform engineer, four years of experience.",
            "Go and Kubernetes, plus Terraform. Strong on CI/CD and observability.",
            "I have less experience with frontend work.",
            "I want to move toward an SRE leadership position.",
        ],
        expect_languages=["go"],
        expect_goal_keyword="sre",
    ),
]
