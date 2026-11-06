"""The AI assistant. Every function returns a suggestion plus `source` ('ai' or
'rules') and a human-readable `notice` when it fell back. Nothing here writes a
record: callers show the output with Confirm / Change and log the decision.

Privacy: only age, sex, vitals, complaint and de-identified clinical history are
sent to the LLM. Never names, IDs, phone numbers or addresses.
"""
from __future__ import annotations

import re
from pathlib import Path

from cran.fhir import TRIAGE_LEVELS

from . import llm, triage

MANUAL = Path(__file__).resolve().parents[2] / 'docs' / 'manual.md'
FALLBACK = 'AI unavailable — showing the rule-based engine.'


def _fallback_notice(exc: Exception | None = None) -> str:
    return 'No AI key configured — rule-based engine only.' if not llm.available() else FALLBACK


# ----------------------------------------------------------------- 1. triage suggestion

TRIAGE_SCHEMA = {
    'type': 'object', 'required': ['level', 'reasons', 'confidence'],
    'properties': {
        'level': {'type': 'integer', 'minimum': 1, 'maximum': 5},
        'reasons': {'type': 'array', 'items': {'type': 'string'}, 'minItems': 2, 'maxItems': 3},
        'confidence': {'type': 'string', 'enum': ['low', 'medium', 'high']},
    },
}


def suggest_triage(*, age: int | None, sex: str | None, vitals: dict, complaint: str) -> dict:
    rules = triage.score(vitals, age)
    result = {'rules': rules, 'ai': None, 'source': 'rules', 'notice': None}
    try:
        reply, meta = llm.structured('triage_suggestion', {
            'age': age, 'sex': sex, 'complaint': complaint,
            'vitals': {k: vitals.get(k) for k in ('heart_rate', 'respiratory_rate', 'systolic_bp', 'diastolic_bp', 'temperature', 'spo2', 'consciousness', 'on_oxygen')},
            'rule_baseline': {'news2': rules['news2'], 'level': rules['level']},
        }, TRIAGE_SCHEMA)
        level = int(reply['level'])
        if level not in TRIAGE_LEVELS:
            raise llm.AIUnavailable('level out of range')
        _, colour, label = TRIAGE_LEVELS[level]
        result['ai'] = {'source': 'ai', 'level': level, 'colour': colour, 'label': label,
                        'reasons': [str(r) for r in reply['reasons']][:3], 'confidence': reply['confidence'], **meta}
        result['source'] = 'ai'
    except llm.AIUnavailable as exc:
        result['notice'] = _fallback_notice(exc)
    suggested = triage.more_urgent(rules['level'], result['ai']['level'] if result['ai'] else None)
    result['suggested_level'] = suggested
    result['disagree'] = bool(result['ai'] and result['ai']['level'] != rules['level'])
    result['more_urgent_source'] = ('ai' if result['ai'] and result['ai']['level'] < rules['level'] else 'rules') if result['disagree'] else None
    return result


# ----------------------------------------------------------------- 3. patient summary

SUMMARY_SCHEMA = {'type': 'object', 'required': ['summary'], 'properties': {'summary': {'type': 'string'}}}


def summarize(*, age: int | None, sex: str | None, conditions: list[str], allergies: list[str], encounters: list[dict]) -> dict:
    payload = {'age': age, 'sex': sex, 'conditions': conditions, 'allergies': allergies,
               'past_visits': [{'date': e['date'], 'facility': e['facility'], 'reason': e['reason']} for e in encounters]}
    try:
        reply, meta = llm.structured('patient_summary', payload, SUMMARY_SCHEMA, max_tokens=400)
        return {'source': 'ai', 'summary': reply['summary'].strip(), 'notice': None, **meta}
    except llm.AIUnavailable as exc:
        return {'source': 'rules', 'summary': template_summary(**payload), 'notice': _fallback_notice(exc)}


def template_summary(*, age, sex, conditions, allergies, past_visits) -> str:
    who = f"{age}-year-old {sex}" if age is not None else f"Patient ({sex or 'sex not recorded'})"
    first = f"{who} with {', '.join(c.lower() for c in conditions)}." if conditions else f"{who} with no chronic conditions recorded."
    second = f"Allergies: {', '.join(allergies)}." if allergies else 'No allergies recorded.'
    if past_visits:
        last = past_visits[0]
        third = f"{len(past_visits)} previous visit{'s' if len(past_visits) != 1 else ''} in the registry; most recent {last['date']} at {last['facility']} ({last['reason'].lower()})."
    else:
        third = 'No previous visits in the registry.'
    return ' '.join([first, second, third])


# ----------------------------------------------------------------- 4. voice-to-notes + handover

NOTE_SCHEMA = {'type': 'object', 'required': ['presenting_complaint', 'findings', 'plan'],
               'properties': {k: {'type': 'string'} for k in ('presenting_complaint', 'findings', 'plan')}}
PLAN_WORDS = ('plan', 'give', 'start', 'refer', 'admit', 'review', 'discharge', 'arrange', 'repeat', 'order', 'request', 'continue', 'monitor', 'will ')
FINDING_WORDS = ('on examination', 'examination', 'exam ', 'examined', 'blood pressure', 'bp ', 'heart rate', 'pulse', 'saturat',
                 'temperature', 'tender', 'sounds', 'glucose', 'found', 'auscultat', 'observations')


def redact(text: str, identifiers: list[str]) -> str:
    """Strip names and IDs the transcript might contain before it leaves the server."""
    for value in sorted({i for i in identifiers if i and len(i) > 1}, key=len, reverse=True):
        text = re.sub(re.escape(value), '[redacted]', text, flags=re.IGNORECASE)
    text = re.sub(r'\bNHI-\d+\b', '[redacted]', text, flags=re.IGNORECASE)
    return re.sub(r'\b\d{11}\b', '[redacted]', text)


def draft_note(transcript: str, identifiers: list[str] | None = None) -> dict:
    clean = redact(transcript.strip(), identifiers or [])
    try:
        reply, meta = llm.structured('note_draft', {'transcript': clean}, NOTE_SCHEMA, max_tokens=600)
        return {'source': 'ai', 'note': {k: reply[k].strip() for k in NOTE_SCHEMA['required']}, 'notice': None, **meta}
    except llm.AIUnavailable as exc:
        return {'source': 'rules', 'note': rule_note(clean), 'notice': _fallback_notice(exc)}


def rule_note(transcript: str) -> dict:
    """Dictation flows complaint -> findings -> plan; switch section on marker words."""
    sections = {'presenting_complaint': [], 'findings': [], 'plan': []}
    mode = 'presenting_complaint'
    for sentence in [s.strip() for s in re.split(r'(?<=[.!?])\s+|\n+', transcript) if s.strip()]:
        low = sentence.lower()
        if any(low.startswith(w.strip()) or f' {w.strip()} ' in f' {low} ' for w in PLAN_WORDS):
            mode = 'plan'
        elif mode == 'presenting_complaint' and any(w in low for w in FINDING_WORDS):
            mode = 'findings'
        sections[mode].append(re.sub(r'^(plan|findings|presenting complaint|complaint)\s*[:\-–]\s*', '', sentence, flags=re.IGNORECASE))
    return {k: ' '.join(v) if v else 'Not dictated.' for k, v in sections.items()}


HANDOVER_SCHEMA = {'type': 'object', 'required': ['lines', 'overall'],
                   'properties': {'lines': {'type': 'array', 'items': {'type': 'string'}}, 'overall': {'type': 'string'}}}


def handover(patients: list[dict]) -> dict:
    """`patients`: de-identified dicts with position, level, wait_minutes, age, sex, complaint, news2, alert, plan."""
    try:
        reply, meta = llm.structured('handover', {'patients': patients}, HANDOVER_SCHEMA, max_tokens=900)
        return {'source': 'ai', 'lines': reply['lines'], 'overall': reply['overall'], 'notice': None, **meta}
    except llm.AIUnavailable as exc:
        lines = []
        for p in patients:
            _, colour, label = TRIAGE_LEVELS[p['level']] if p.get('level') else (None, 'Untriaged', '')
            todo = 'act on deterioration alert' if p.get('alert') else (p.get('plan') or 'assessment pending')
            lines.append(f"Position {p['position']} — {colour}{' ' + label if label else ''}, {p.get('age', '?')}{(p.get('sex') or '?')[0].upper()}, "
                         f"{p.get('complaint') or 'complaint not recorded'}; waiting {p.get('wait_minutes', 0)} min; NEWS2 {p.get('news2', '—')}. Next: {todo}.")
        counts = {}
        for p in patients:
            if p.get('level'):
                counts[TRIAGE_LEVELS[p['level']][1]] = counts.get(TRIAGE_LEVELS[p['level']][1], 0) + 1
        overall = f"{len(patients)} active patients" + (': ' + ', '.join(f'{n} {c}' for c, n in counts.items()) if counts else '') + '.'
        return {'source': 'rules', 'lines': lines, 'overall': overall, 'notice': _fallback_notice(exc)}


# ----------------------------------------------------------------- 6. in-app help

HELP_SCHEMA = {'type': 'object', 'required': ['answer', 'section'],
               'properties': {'answer': {'type': 'string'}, 'section': {'type': 'string'}}}
STOP = set('a an the to do i how can is in on of and or for my what where when with it this that be'.split())


def manual_sections() -> list[tuple[str, str]]:
    text = MANUAL.read_text(encoding='utf-8')
    parts = re.split(r'^## ', text, flags=re.MULTILINE)[1:]
    return [(p.split('\n', 1)[0].strip(), p.split('\n', 1)[1].strip() if '\n' in p else '') for p in parts]


def _words(text: str) -> set[str]:
    words = {w for w in re.findall(r'[a-z0-9]+', text.lower()) if w not in STOP and len(w) > 1}
    return {w[:-1] if w.endswith('s') and len(w) > 3 else w for w in words}  # crude plural stemming


def search_manual(question: str) -> tuple[str, str]:
    wanted = _words(question)
    best = max(manual_sections(), key=lambda s: (len(wanted & _words(s[0])) * 3 + len(wanted & _words(s[1]))))
    return best


def answer_help(question: str) -> dict:
    try:
        reply, meta = llm.structured('help', {'manual': MANUAL.read_text(encoding='utf-8'), 'question': question}, HELP_SCHEMA, max_tokens=500)
        return {'source': 'ai', 'answer': reply['answer'].strip(), 'section': reply['section'], 'notice': None, **meta}
    except llm.AIUnavailable as exc:
        title, body = search_manual(question)
        return {'source': 'rules', 'answer': body, 'section': title, 'notice': 'Showing the closest manual section (keyword search).' if not llm.available() else FALLBACK}
