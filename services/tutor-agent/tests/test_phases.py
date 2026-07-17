from tutor_agent.phases import PHASES, FIRST_PHASE, is_valid_phase


def test_first_phase_is_orient():
    assert FIRST_PHASE == "orient"


def test_valid_and_invalid_phases():
    assert is_valid_phase("detect")
    assert not is_valid_phase("nope")
    assert PHASES[0] == "orient"
    assert PHASES[-1] == "done"
