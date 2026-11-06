"""Deterministic rule-based triage baseline.

Scoring uses the published NEWS2 chart (Royal College of Physicians, 2017,
SpO2 scale 1). NEWS2 is a physiological early-warning score, not a triage
system; the mapping from NEWS2 risk band to a Manchester colour below is a
demo assumption.

TODO(antonio): confirm the NEWS2 -> triage-colour mapping (LEVEL_FOR_BAND) and
whether a complaint-based discriminator list should override it, with the ED
clinical lead before any clinical use. Do not treat this as a clinical rule.
"""
from __future__ import annotations

from cran.fhir import TRIAGE_LEVELS

# TODO(antonio): demo mapping only, see module docstring.
LEVEL_FOR_BAND = {'high': 1, 'medium': 2, 'low-medium': 3, 'low': 4, 'none': 5}
BAND_TEXT = {'high': 'high clinical risk (NEWS2 7 or more)', 'medium': 'medium clinical risk (NEWS2 5–6)',
             'low-medium': 'a single vital sign in the red zone (score 3)', 'low': 'low clinical risk (NEWS2 1–4)',
             'none': 'no abnormal vital signs (NEWS2 0)'}
LABELS = {'heart_rate': 'Heart rate', 'respiratory_rate': 'Respiratory rate', 'systolic_bp': 'Systolic blood pressure',
          'temperature': 'Temperature', 'spo2': 'Oxygen saturation', 'consciousness': 'Consciousness', 'on_oxygen': 'Supplemental oxygen'}
UNITS = {'heart_rate': '/min', 'respiratory_rate': '/min', 'systolic_bp': ' mmHg', 'temperature': ' °C', 'spo2': '%'}


def _band(value, bands):
    for upper, points in bands:
        if value <= upper:
            return points
    return bands[-1][1]


def news2_parts(v: dict) -> dict[str, int]:
    parts: dict[str, int] = {}
    if v.get('respiratory_rate') is not None:
        parts['respiratory_rate'] = _band(v['respiratory_rate'], [(8, 3), (11, 1), (20, 0), (24, 2), (float('inf'), 3)])
    if v.get('spo2') is not None:
        parts['spo2'] = _band(v['spo2'], [(91, 3), (93, 2), (95, 1), (float('inf'), 0)])
    parts['on_oxygen'] = 2 if v.get('on_oxygen') else 0
    if v.get('systolic_bp') is not None:
        parts['systolic_bp'] = _band(v['systolic_bp'], [(90, 3), (100, 2), (110, 1), (219, 0), (float('inf'), 3)])
    if v.get('heart_rate') is not None:
        parts['heart_rate'] = _band(v['heart_rate'], [(40, 3), (50, 1), (90, 0), (110, 1), (130, 2), (float('inf'), 3)])
    if v.get('consciousness'):
        parts['consciousness'] = 0 if v['consciousness'] == 'A' else 3
    if v.get('temperature') is not None:
        parts['temperature'] = _band(round(v['temperature'], 1), [(35.0, 3), (36.0, 1), (38.0, 0), (39.0, 1), (float('inf'), 2)])
    return parts


def band_for(total: int, parts: dict[str, int]) -> str:
    if total >= 7:
        return 'high'
    if total >= 5:
        return 'medium'
    if any(p == 3 for p in parts.values()):
        return 'low-medium'
    return 'low' if total >= 1 else 'none'


def _describe(key, v):
    if key == 'consciousness':
        return f"Consciousness not 'Alert' ({v['consciousness']})"
    if key == 'on_oxygen':
        return 'Receiving supplemental oxygen'
    return f'{LABELS[key]} {v[key]}{UNITS.get(key, "")}'


def score(vitals: dict, age: int | None = None) -> dict:
    """Return the safety baseline: NEWS2 total, band, suggested level and reasons."""
    parts = news2_parts(vitals)
    total = sum(parts.values())
    band = band_for(total, parts)
    level = LEVEL_FOR_BAND[band]
    contributors = sorted(((p, k) for k, p in parts.items() if p > 0), reverse=True)
    reasons = [f'{_describe(k, vitals)} (+{p})' for p, k in contributors[:3]]
    reasons.insert(0, f'NEWS2 {total}: {BAND_TEXT[band]}')
    caution = None
    if age is not None and age < 16:
        caution = 'NEWS2 is not validated for children under 16. Use clinical judgement and a paediatric tool.'
    _, colour, label = TRIAGE_LEVELS[level]
    return {'source': 'rules', 'method': 'NEWS2 (RCP 2017) mapped to triage colour (demo mapping)',
            'news2': total, 'parts': parts, 'band': band, 'level': level, 'colour': colour, 'label': label,
            'reasons': reasons[:3], 'caution': caution}


def more_urgent(a: int | None, b: int | None) -> int | None:
    values = [x for x in (a, b) if x is not None]
    return min(values) if values else None
