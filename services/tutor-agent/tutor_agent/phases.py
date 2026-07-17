PHASES = ["orient", "detect", "triage", "mitigate", "resolve", "postmortem", "done"]
FIRST_PHASE = "orient"


def is_valid_phase(phase: str) -> bool:
    return phase in PHASES
