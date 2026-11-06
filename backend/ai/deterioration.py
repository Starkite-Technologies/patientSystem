"""Deterioration detection: compare a new set of vitals with the previous set."""
from __future__ import annotations

from cran.fhir import TRIAGE_LEVELS

from . import triage

# A rise of this many NEWS2 points between two sets counts as deterioration.
NEWS2_RISE = 2  # TODO(antonio): confirm the escalation threshold with the clinical lead.


def check(previous: dict | None, current: dict, current_level: int | None, age: int | None = None) -> dict | None:
    """Return an alert dict when the patient has worsened, else None.

    The alert only suggests a level; a clinician must Confirm or Dismiss it.
    """
    now = triage.score(current, age)
    reasons = []
    if previous:
        before = triage.score(previous, age)
        rise = now['news2'] - before['news2']
        if rise >= NEWS2_RISE:
            reasons.append(f"NEWS2 rose from {before['news2']} to {now['news2']}")
        new_reds = [k for k, p in now['parts'].items() if p == 3 and before['parts'].get(k, 0) < 3]
        for key in new_reds:
            reasons.append(f"{triage._describe(key, current)} is now in the red zone")
    if current_level is not None and now['level'] < current_level:
        reasons.append(f"Vitals now match {TRIAGE_LEVELS[now['level']][1]} (currently {TRIAGE_LEVELS[current_level][1]})")
    if not reasons:
        return None
    suggested = now['level'] if current_level is None or now['level'] < current_level else None
    if suggested is None:
        return None if not previous else {
            'suggested_level': None, 'reasons': reasons[:3], 'news2': now['news2'],
            'message': 'Vitals worsened. Current level already covers this; review the patient.'}
    _, colour, label = TRIAGE_LEVELS[suggested]
    return {'suggested_level': suggested, 'reasons': reasons[:3], 'news2': now['news2'],
            'message': f'Suggest moving up to P{suggested} {colour} – {label}'}
