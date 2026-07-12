from .models import RunStatus, TrialStatus

VALID_TRANSITIONS: dict[TrialStatus, set[TrialStatus]] = {
    TrialStatus.QUEUED: {TrialStatus.RUNNING, TrialStatus.CANCELLED},
    TrialStatus.RUNNING: {TrialStatus.RETRYING, TrialStatus.COMPLETED, TrialStatus.FAILED, TrialStatus.CANCELLED},
    TrialStatus.RETRYING: {TrialStatus.RUNNING, TrialStatus.FAILED, TrialStatus.CANCELLED},
    TrialStatus.COMPLETED: set(),
    TrialStatus.FAILED: set(),
    TrialStatus.CANCELLED: set(),
}

VALID_RUN_TRANSITIONS: dict[RunStatus, set[RunStatus]] = {
    RunStatus.CREATED: {RunStatus.RUNNING, RunStatus.CANCELLED},
    RunStatus.RUNNING: {RunStatus.COMPLETED, RunStatus.FAILED, RunStatus.CANCELLED},
    RunStatus.COMPLETED: set(),
    RunStatus.FAILED: set(),
    RunStatus.CANCELLED: set(),
}


def transition(current: TrialStatus, target: TrialStatus) -> TrialStatus:
    if target not in VALID_TRANSITIONS[current]:
        raise ValueError(f"invalid trial state transition: {current} -> {target}")
    return target


def transition_run(current: RunStatus, target: RunStatus) -> RunStatus:
    if target not in VALID_RUN_TRANSITIONS[current]:
        raise ValueError(f"invalid run state transition: {current} -> {target}")
    return target
