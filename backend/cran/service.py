"""CRAN demo application logic. The AI only suggests; every level change here
comes from an explicit clinician decision, which is logged with user and time."""
from __future__ import annotations

import csv
import io
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

from ai import assistant, deterioration, forecast, llm, triage

from . import demo, fhir
from .registry import RegistryUnavailable, get_connector, history
from .store import get_store

TZ = ZoneInfo('Africa/Windhoek')
ACTIVE = {'arrived', 'triaged', 'in-progress'}


class NotFound(Exception):
    pass


class Invalid(Exception):
    pass


class Forbidden(Exception):
    pass


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace('Z', '+00:00'))


def require(user: dict, *roles: str):
    if user['role'] not in roles:
        raise Forbidden(f"The {user['role']} role cannot do this in the demo. Switch role to: {', '.join(roles)}.")


# ----------------------------------------------------------------- helpers

def age_of(patient: dict, on: date | None = None) -> int | None:
    if not patient.get('birthDate'):
        return None
    born = date.fromisoformat(patient['birthDate'][:10])
    on = on or _now().astimezone(TZ).date()
    return on.year - born.year - ((on.month, on.day) < (born.month, born.day))


def name_of(patient: dict) -> str:
    n = (patient.get('name') or [{}])[0]
    return ' '.join([*n.get('given', []), n.get('family', '')]).strip() or 'Unknown'


def identifier(patient: dict, system: str) -> str | None:
    return next((i['value'] for i in patient.get('identifier', []) if i['system'] == system), None)


def patient_card(patient: dict) -> dict:
    return {'id': patient['id'], 'name': name_of(patient), 'health_id': identifier(patient, fhir.SYSTEM_HEALTH_ID),
            'national_id': identifier(patient, fhir.SYSTEM_NATIONAL_ID), 'age': age_of(patient), 'sex': patient.get('gender'),
            'birth_date': patient.get('birthDate'), 'region': ((patient.get('address') or [{}])[0]).get('state'),
            'source': (patient.get('meta') or {}).get('source', 'local')}


def _observations(store, encounter_id):
    found = store.search('Observation', lambda o: fhir.ref_id(o.get('encounter')) == encounter_id)
    return sorted(found, key=lambda o: o['effectiveDateTime'])


def _complaint(store, encounter_id):
    found = store.search('Condition', lambda c: fhir.ref_id(c.get('encounter')) == encounter_id)
    return found[0]['code']['text'] if found else None


def _encounter(store, encounter_id) -> dict:
    enc = store.get('Encounter', encounter_id)
    if not enc:
        raise NotFound('Encounter not found.')
    return enc


def _patient(store, patient_id) -> dict:
    pat = store.get('Patient', patient_id)
    if not pat:
        raise NotFound('Patient not found.')
    return pat


def validate_vitals(v: dict) -> dict:
    ranges = {'heart_rate': (20, 250), 'respiratory_rate': (4, 70), 'systolic_bp': (40, 280), 'diastolic_bp': (20, 180),
              'temperature': (30, 44), 'spo2': (50, 100)}
    clean = {}
    for key, (lo, hi) in ranges.items():
        value = v.get(key)
        if value in (None, ''):
            raise Invalid(f'Enter {key.replace("_", " ")}.')
        try:
            number = float(value)
        except (TypeError, ValueError):
            raise Invalid(f'{key.replace("_", " ").capitalize()} must be a number.') from None
        if not lo <= number <= hi:
            raise Invalid(f'{key.replace("_", " ").capitalize()} must be between {lo} and {hi}.')
        clean[key] = round(number, 1) if key == 'temperature' else int(round(number))
    if v.get('consciousness') not in fhir.CONSCIOUSNESS_LEVELS:
        raise Invalid('Choose a consciousness level (A, C, V, P or U).')
    clean['consciousness'] = v['consciousness']
    clean['on_oxygen'] = bool(v.get('on_oxygen'))
    return clean


# ----------------------------------------------------------------- demo control

def reset_demo():
    resources, records, meta = demo.build()
    get_store().replace_all(resources, records, meta)


def ensure_seeded():
    store = get_store()
    if store.get_meta('seeded_at') is None:
        reset_demo()


def tick():
    """Apply the scripted deterioration when its time has come (lazy, no background thread)."""
    store = get_store()
    scripted = store.get_meta('scripted')
    if scripted and not scripted['done'] and _now() >= _parse(scripted['at']):
        trigger_deterioration()


def trigger_deterioration():
    store = get_store()
    scripted = store.get_meta('scripted')
    if not scripted or scripted['done']:
        return None
    scripted['done'] = True
    store.set_meta('scripted', scripted)
    enc = store.get('Encounter', scripted['encounter_id'])
    if not enc or enc['status'] not in ACTIVE:
        return None
    return add_vitals(enc['id'], demo.WORSENED, demo.MONITOR, system=True)


# ----------------------------------------------------------------- registry + arrival

def lookup(identifier_value: str) -> dict:
    value = (identifier_value or '').strip()
    if not value:
        raise Invalid('Enter a health ID or national ID.')
    store = get_store()
    connector = get_connector()
    try:
        found = connector.lookup(value)
    except RegistryUnavailable:
        return {'found': False, 'registry': connector.label, 'registry_error': 'The registry did not respond. Register the patient locally.',
                'prefill': {'health_id': value}}
    if not found:
        local = store.search('Patient', lambda p: value.upper() in [i['value'].upper() for i in p.get('identifier', [])])
        if local:
            return {'found': True, 'registry': 'Local ED record', 'patient': patient_card(local[0]), 'history': None, 'summary': None}
        return {'found': False, 'registry': connector.label, 'prefill': connector.prefill(value) or {'health_id': value}}
    registry = store.get_meta('registry', {})
    hist = history(found)
    patient = hist['patient']
    if not store.get('Patient', patient['id']):
        store.put(patient)
    registry[patient['id']] = found
    store.set_meta('registry', registry)
    card = patient_card(patient)
    summary = assistant.summarize(age=card['age'], sex=card['sex'], conditions=hist['conditions'],
                                  allergies=hist['allergies'], encounters=hist['encounters'])
    _cache_summary(patient['id'], summary)
    return {'found': True, 'registry': connector.label, 'patient': card, 'history': _history_view(hist), 'summary': summary,
            'bundle_valid': not fhir.validate(found)}


def _history_view(hist: dict | None):
    if not hist:
        return None
    return {k: hist[k] for k in ('encounters', 'conditions', 'allergies')}


def _cache_summary(patient_id, summary):
    store = get_store()
    cache = store.get_meta('summaries', {})
    cache[patient_id] = summary
    store.set_meta('summaries', cache)


def register_patient(data: dict) -> dict:
    given, family = (data.get('given') or '').strip(), (data.get('family') or '').strip()
    if not given or not family:
        raise Invalid('Enter the first and last name.')
    if data.get('gender') not in ('female', 'male', 'other', 'unknown'):
        raise Invalid('Choose sex.')
    birth = (data.get('birth_date') or '').strip()
    try:
        if date.fromisoformat(birth) > _now().date():
            raise ValueError
    except ValueError:
        raise Invalid('Enter a valid date of birth (YYYY-MM-DD), not in the future.') from None
    store = get_store()
    health_id = (data.get('health_id') or '').strip().upper() or f'ED-{fhir.new_id()[:8].upper()}'
    if store.search('Patient', lambda p: identifier(p, fhir.SYSTEM_HEALTH_ID) == health_id):
        raise Invalid('A patient with this health ID already exists. Search for it instead.')
    pat = fhir.patient(health_id=health_id, national_id=(data.get('national_id') or '').strip() or None, given=given, family=family,
                       gender=data['gender'], birth_date=birth, region=data.get('region') or None, rid=f'local-{fhir.new_id()[:12]}')
    pat['meta']['source'] = 'local'
    fhir.assert_valid(pat)
    return patient_card(store.put(pat))


def _log_suggestion(kind, encounter_id, suggestion, user):
    return get_store().add_record('suggestions', {'kind': kind, 'encounter_id': encounter_id, 'suggestion': suggestion, 'requested_by': user})


def arrival(patient_id: str, vitals: dict, complaint: str, user: dict) -> dict:
    require(user, 'nurse', 'doctor')
    complaint = (complaint or '').strip()
    if not complaint:
        raise Invalid('Enter the chief complaint.')
    clean = validate_vitals(vitals)
    store = get_store()
    pat = _patient(store, patient_id)
    if store.search('Encounter', lambda e: fhir.ref_id(e['subject']) == patient_id and e['status'] in ACTIVE):
        raise Invalid('This patient already has an open ED visit on the board.')
    enc = fhir.encounter(patient_id=patient_id, practitioner_id=user['id'], status='arrived')
    enc['serviceProvider'] = {'display': demo.FACILITY}
    obs = fhir.vitals_observation(patient_id=patient_id, encounter_id=enc['id'], vitals=clean, performer_id=user['id'])
    cond = fhir.condition(patient_id=patient_id, encounter_id=enc['id'], text=complaint)
    for resource in (enc, obs, cond):
        store.put(fhir.assert_valid(resource))
    suggestion = assistant.suggest_triage(age=age_of(pat), sex=pat.get('gender'), vitals=clean, complaint=complaint)
    logged = _log_suggestion('triage', enc['id'], suggestion, user)
    return {'encounter_id': enc['id'], 'suggestion_id': logged['id'], 'suggestion': suggestion}


def retriage(encounter_id: str, user: dict) -> dict:
    """Re-run the suggestion for an encounter (e.g. one created through the FHIR API)."""
    require(user, 'nurse', 'doctor')
    store = get_store()
    enc = _encounter(store, encounter_id)
    pat = _patient(store, fhir.ref_id(enc['subject']))
    obs = _observations(store, encounter_id)
    if not obs:
        raise Invalid('Record vitals first.')
    suggestion = assistant.suggest_triage(age=age_of(pat), sex=pat.get('gender'), vitals=fhir.vitals_from_observation(obs[-1]),
                                          complaint=_complaint(store, encounter_id) or '')
    logged = _log_suggestion('triage', encounter_id, suggestion, user)
    return {'encounter_id': encounter_id, 'suggestion_id': logged['id'], 'suggestion': suggestion}


def triage_decision(encounter_id: str, level: int, suggestion_id: str | None, user: dict, reason: str = '') -> dict:
    require(user, 'nurse', 'doctor')
    if level not in fhir.TRIAGE_LEVELS:
        raise Invalid('Choose a triage level from P1 to P5.')
    store = get_store()
    enc = _encounter(store, encounter_id)
    if enc['status'] not in ACTIVE:
        raise Invalid('This visit is closed.')
    suggestion = next((s for s in store.records('suggestions') if s['id'] == suggestion_id), None)
    suggested = suggestion['suggestion']['suggested_level'] if suggestion else None
    action = 'confirm' if suggested == level else 'change'
    if action == 'change' and suggestion and not reason.strip():
        raise Invalid('Give a short reason when you change the suggested level.')
    previous = fhir.triage_level(enc)
    fhir.set_triage(enc, level)
    if enc['status'] == 'arrived':
        fhir.set_status(enc, 'triaged')
    store.put(fhir.assert_valid(enc))
    return store.add_record('decisions', {'kind': 'triage', 'encounter_id': encounter_id, 'suggestion_id': suggestion_id,
                                          'suggested_level': suggested, 'previous_level': previous, 'level': level,
                                          'action': action, 'reason': reason.strip(), 'user': user})


def add_vitals(encounter_id: str, vitals: dict, user: dict, system: bool = False) -> dict:
    if not system:
        require(user, 'nurse', 'doctor')
    clean = validate_vitals(vitals)
    store = get_store()
    enc = _encounter(store, encounter_id)
    if enc['status'] not in ACTIVE:
        raise Invalid('This visit is closed.')
    pat = _patient(store, fhir.ref_id(enc['subject']))
    previous = _observations(store, encounter_id)
    obs = fhir.vitals_observation(patient_id=pat['id'], encounter_id=encounter_id, vitals=clean,
                                  performer_id=None if system else user['id'])
    store.put(fhir.assert_valid(obs))
    found = deterioration.check(fhir.vitals_from_observation(previous[-1]) if previous else None, clean,
                                fhir.triage_level(enc), age_of(pat))
    alert = None
    if found:
        for old in store.records('alerts'):
            if old['encounter_id'] == encounter_id and old['status'] == 'open':
                store.update_record('alerts', old['id'], {'status': 'superseded'})
        alert = store.add_record('alerts', {'encounter_id': encounter_id, 'observation_id': obs['id'], 'status': 'open',
                                            'source': 'rules', **found, 'raised_by': user})
    return {'observation_id': obs['id'], 'alert': alert, 'news2': triage.score(clean, age_of(pat))['news2']}


def alert_decision(alert_id: str, action: str, user: dict, reason: str = '') -> dict:
    require(user, 'nurse', 'doctor')
    if action not in ('confirm', 'dismiss'):
        raise Invalid('Choose Confirm or Dismiss.')
    store = get_store()
    alert = next((a for a in store.records('alerts') if a['id'] == alert_id), None)
    if not alert:
        raise NotFound('Alert not found.')
    if alert['status'] != 'open':
        raise Invalid('This alert has already been handled.')
    if action == 'confirm' and alert.get('suggested_level'):
        enc = _encounter(store, alert['encounter_id'])
        previous = fhir.triage_level(enc)
        fhir.set_triage(enc, alert['suggested_level'])
        store.put(fhir.assert_valid(enc))
        store.add_record('decisions', {'kind': 'alert', 'encounter_id': alert['encounter_id'], 'suggestion_id': alert_id,
                                       'suggested_level': alert['suggested_level'], 'previous_level': previous,
                                       'level': alert['suggested_level'], 'action': 'confirm', 'reason': reason, 'user': user})
    else:
        store.add_record('decisions', {'kind': 'alert', 'encounter_id': alert['encounter_id'], 'suggestion_id': alert_id,
                                       'suggested_level': alert.get('suggested_level'), 'level': None,
                                       'action': 'dismiss' if action == 'dismiss' else 'acknowledge', 'reason': reason, 'user': user})
    return store.update_record('alerts', alert_id, {'status': 'confirmed' if action == 'confirm' else 'dismissed',
                                                    'decided_by': user, 'decided_at': fhir.now_iso()})


def start_treatment(encounter_id: str, user: dict):
    require(user, 'nurse', 'doctor')
    store = get_store()
    enc = _encounter(store, encounter_id)
    if enc['status'] != 'triaged':
        raise Invalid('Only a triaged, waiting patient can be moved into treatment.')
    fhir.set_status(enc, 'in-progress')
    enc.setdefault('participant', []).append({'individual': fhir.ref('Practitioner', user['id'])})
    return store.put(fhir.assert_valid(enc))


def close(encounter_id: str, disposition: str, user: dict):
    require(user, 'nurse', 'doctor')
    if disposition not in ('discharge', 'admit'):
        raise Invalid('Choose Discharge or Admit.')
    store = get_store()
    enc = _encounter(store, encounter_id)
    if enc['status'] not in ACTIVE:
        raise Invalid('This visit is already closed.')
    code, text = ('home', 'Discharged home') if disposition == 'discharge' else ('oth', 'Admitted to inpatient ward')
    enc['hospitalization'] = {'dischargeDisposition': {'coding': [{'system': fhir.SYSTEM_DISCHARGE, 'code': code}], 'text': text}}
    fhir.set_status(enc, 'finished')
    for alert in store.records('alerts'):
        if alert['encounter_id'] == encounter_id and alert['status'] == 'open':
            store.update_record('alerts', alert['id'], {'status': 'closed-with-visit'})
    store.add_record('decisions', {'kind': 'disposition', 'encounter_id': encounter_id, 'action': disposition, 'user': user})
    return store.put(fhir.assert_valid(enc))


# ----------------------------------------------------------------- board + patient view

def _row(store, enc, alerts_by_enc, now):
    pat = store.get('Patient', fhir.ref_id(enc['subject'])) or {}
    obs = _observations(store, enc['id'])
    latest = fhir.vitals_from_observation(obs[-1]) if obs else None
    card = patient_card(pat) if pat else {'name': 'Unknown'}
    level = fhir.triage_level(enc)
    target = {1: 0, 2: 10, 3: 60, 4: 120, 5: 240}.get(level)
    wait = int((now - _parse(enc['period']['start'])).total_seconds() // 60)
    return {'encounter_id': enc['id'], 'status': enc['status'], 'level': level, 'arrived_at': enc['period']['start'],
            'wait_minutes': wait, 'overdue': bool(target is not None and enc['status'] == 'triaged' and wait > target),
            'patient': card, 'complaint': _complaint(store, enc['id']),
            'vitals': latest, 'news2': triage.score(latest, card.get('age'))['news2'] if latest else None,
            'alert': alerts_by_enc.get(enc['id'])}


def board() -> dict:
    ensure_seeded()
    tick()
    store = get_store()
    now = _now()
    alerts = {a['encounter_id']: a for a in store.records('alerts') if a['status'] == 'open'}
    rows = [_row(store, e, alerts, now) for e in store.all('Encounter') if e['status'] in ACTIVE]
    rows.sort(key=lambda r: (r['level'] is not None, r['level'] or 0, r['arrived_at']))
    scripted = store.get_meta('scripted') or {}
    return {'rows': rows, 'server_time': fhir.now_iso(), 'ai': llm.status(), 'version': store.version(),
            'registry': get_connector().label, 'scripted': scripted}


def encounter_detail(encounter_id: str) -> dict:
    store = get_store()
    enc = _encounter(store, encounter_id)
    pat = _patient(store, fhir.ref_id(enc['subject']))
    found = (store.get_meta('registry', {}) or {}).get(pat['id'])
    hist = history(found) if found else None
    summary = (store.get_meta('summaries', {}) or {}).get(pat['id'])
    if hist and not summary:
        card = patient_card(pat)
        summary = assistant.summarize(age=card['age'], sex=card['sex'], conditions=hist['conditions'],
                                      allergies=hist['allergies'], encounters=hist['encounters'])
        _cache_summary(pat['id'], summary)
    decisions = [d for d in store.records('decisions') if d['encounter_id'] == encounter_id]
    suggestions = {s['id']: s for s in store.records('suggestions') if s['encounter_id'] == encounter_id}
    alerts = [a for a in store.records('alerts') if a['encounter_id'] == encounter_id]
    vitals = []
    card = patient_card(pat)
    for o in _observations(store, encounter_id):
        values = fhir.vitals_from_observation(o)
        values['news2'] = triage.score(values, card['age'])['news2']
        vitals.append(values)
    latest_suggestion = max(suggestions.values(), key=lambda s: s['created_at'], default=None)
    return {'encounter': enc, 'level': fhir.triage_level(enc), 'status': enc['status'], 'patient': card,
            'complaint': _complaint(store, encounter_id), 'history': _history_view(hist), 'summary': summary,
            'registry': get_connector().label if found else 'Local ED record (not in national registry)',
            'vitals': vitals, 'decisions': decisions, 'alerts': alerts,
            'pending_suggestion': latest_suggestion if latest_suggestion and enc['status'] == 'arrived' else None,
            'notes': [n for n in store.records('notes') if n['encounter_id'] == encounter_id],
            'status_history': enc.get('statusHistory', [])}


# ----------------------------------------------------------------- notes + handover

def draft_note(encounter_id: str, transcript: str, user: dict) -> dict:
    require(user, 'doctor')
    if not (transcript or '').strip():
        raise Invalid('Dictate or type the note first.')
    store = get_store()
    enc = _encounter(store, encounter_id)
    pat = _patient(store, fhir.ref_id(enc['subject']))
    card = patient_card(pat)
    words = card['name'].split() + [card['name'], card['health_id'] or '', card['national_id'] or '']
    draft = assistant.draft_note(transcript, words)
    logged = _log_suggestion('note', encounter_id, draft, user)
    return {'suggestion_id': logged['id'], **draft}


def sign_note(encounter_id: str, note: dict, suggestion_id: str | None, user: dict) -> dict:
    require(user, 'doctor')
    sections = {k: (note.get(k) or '').strip() for k in ('presenting_complaint', 'findings', 'plan')}
    if not any(v and v != 'Not dictated.' for v in sections.values()):
        raise Invalid('The note is empty.')
    store = get_store()
    _encounter(store, encounter_id)
    suggestion = next((s for s in store.records('suggestions') if s['id'] == suggestion_id), None)
    edited = bool(suggestion and suggestion['suggestion']['note'] != sections)
    record = store.add_record('notes', {'encounter_id': encounter_id, **sections, 'status': 'signed', 'signed_by': user,
                                        'signed_at': fhir.now_iso(), 'draft_source': suggestion['suggestion']['source'] if suggestion else 'manual',
                                        'suggestion_id': suggestion_id, 'edited_by_clinician': edited})
    store.add_record('decisions', {'kind': 'note', 'encounter_id': encounter_id, 'suggestion_id': suggestion_id,
                                   'action': 'change' if edited else 'confirm', 'user': user})
    return record


def handover(user: dict) -> dict:
    require(user, 'doctor', 'nurse', 'supervisor')
    data = board()
    store = get_store()
    notes = store.records('notes')
    patients = []
    for i, row in enumerate(data['rows'], 1):
        plan = next((n['plan'] for n in reversed(notes) if n['encounter_id'] == row['encounter_id']), None)
        patients.append({'position': i, 'level': row['level'], 'wait_minutes': row['wait_minutes'], 'age': row['patient'].get('age'),
                         'sex': row['patient'].get('sex'), 'complaint': row['complaint'], 'news2': row['news2'],
                         'status': row['status'], 'alert': row['alert']['message'] if row['alert'] else None, 'plan': plan})
    result = assistant.handover(patients)
    result['positions'] = [{'position': i, 'name': r['patient']['name'], 'encounter_id': r['encounter_id']} for i, r in enumerate(data['rows'], 1)]
    _log_suggestion('handover', None, {k: result[k] for k in ('source', 'lines', 'overall')}, user)
    return result


# ----------------------------------------------------------------- reporting + exports

def _local_date(ts: str) -> date:
    return _parse(ts).astimezone(TZ).date()


def dashboard(user: dict) -> dict:
    require(user, 'supervisor', 'doctor')
    data = board()
    now = _now()
    today = now.astimezone(TZ).date()
    by_level = {str(level): {'count': 0, 'waits': []} for level in fhir.TRIAGE_LEVELS}
    untriaged = 0
    for row in data['rows']:
        if row['level'] is None:
            untriaged += 1
            continue
        by_level[str(row['level'])]['count'] += 1
        if row['status'] == 'triaged':
            by_level[str(row['level'])]['waits'].append(row['wait_minutes'])
    levels = []
    for key, item in by_level.items():
        _, colour, label = fhir.TRIAGE_LEVELS[int(key)]
        waits = item['waits']
        levels.append({'level': int(key), 'colour': colour, 'label': label, 'count': item['count'],
                       'avg_wait': round(sum(waits) / len(waits)) if waits else None})
    store = get_store()
    history_rows = store.get_meta('arrivals', [])
    seeded_today = sum(r['arrivals'] for r in forecast.today_history(history_rows, now))
    live_today = sum(1 for e in store.all('Encounter') if _local_date(e['period']['start']) == today
                     and _parse(e['period']['start']) >= _parse(store.get_meta('seeded_at')))
    by_hour = {}
    for r in forecast.today_history(history_rows, now):
        by_hour[datetime.fromisoformat(r['hour']).astimezone(TZ).strftime('%H:00')] = r['arrivals']
    return {'levels': levels, 'untriaged': untriaged, 'active': len(data['rows']), 'arrivals_today': seeded_today + live_today,
            'arrivals_today_by_hour': by_hour, 'forecast': forecast.forecast(history_rows, now),
            'open_alerts': sum(1 for r in data['rows'] if r['alert']), 'ai': data['ai'], 'date': today.isoformat()}


def everything(encounter_id: str) -> dict:
    store = get_store()
    enc = _encounter(store, encounter_id)
    pid = fhir.ref_id(enc['subject'])
    resources = [_patient(store, pid), enc]
    resources += _observations(store, encounter_id)
    resources += store.search('Condition', lambda c: fhir.ref_id(c.get('encounter')) == encounter_id)
    seen = {r['id'] for r in resources}
    for part in enc.get('participant', []):
        pr = store.get('Practitioner', fhir.ref_id(part['individual']))
        if pr and pr['id'] not in seen:
            resources.append(pr)
            seen.add(pr['id'])
    return fhir.assert_valid(fhir.bundle(resources, 'searchset'))


def day_bundle(day: date) -> dict:
    store = get_store()
    resources, seen = [], set()
    for enc in store.all('Encounter'):
        if _local_date(enc['period']['start']) != day or (enc.get('meta') or {}).get('source') == 'mock-mpi':
            continue
        if enc.get('serviceProvider', {}).get('display') != demo.FACILITY:
            continue
        for entry in everything(enc['id'])['entry']:
            if entry['resource']['id'] not in seen:
                resources.append(entry['resource'])
                seen.add(entry['resource']['id'])
    return fhir.assert_valid(fhir.bundle(resources, 'collection'))


def _ed_encounters(day: date):
    store = get_store()
    return [e for e in store.all('Encounter') if _local_date(e['period']['start']) == day
            and e.get('serviceProvider', {}).get('display') == demo.FACILITY]


def dhis2(day: date) -> dict:
    counts = {level: 0 for level in fhir.TRIAGE_LEVELS}
    untriaged = 0
    for enc in _ed_encounters(day):
        level = fhir.triage_level(enc)
        if level:
            counts[level] += 1
        else:
            untriaged += 1
    values = [{'dataElement': 'ED_VISITS', 'categoryOptionCombo': f'P{level}_{fhir.TRIAGE_LEVELS[level][1].upper()}',
               'period': day.strftime('%Y%m%d'), 'orgUnit': 'DEMO_ED_001', 'value': str(n)} for level, n in counts.items()]
    values.append({'dataElement': 'ED_VISITS', 'categoryOptionCombo': 'UNTRIAGED', 'period': day.strftime('%Y%m%d'),
                   'orgUnit': 'DEMO_ED_001', 'value': str(untriaged)})
    return {'_label': 'DHIS2-compatible format (demo). Data element and org unit codes are placeholders, not MoHSS metadata.',
            'dataSet': 'DEMO_ED_DAILY', 'period': day.strftime('%Y%m%d'), 'orgUnit': 'DEMO_ED_001',
            'completeDate': day.isoformat(), 'dataValues': values}


def safe_cell(value) -> str:
    text = '' if value is None else str(value)
    return "'" + text if text[:1] in ('=', '+', '-', '@', '\t', '\r') else text


def csv_export(day: date) -> str:
    store = get_store()
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(['date', 'encounter_id', 'health_id', 'patient_name', 'age', 'sex', 'arrived_at', 'triage_level', 'triage_colour',
                     'status', 'disposition', 'complaint', 'latest_news2', 'wait_or_stay_minutes', 'synthetic'])
    now = _now()
    for enc in sorted(_ed_encounters(day), key=lambda e: e['period']['start']):
        pat = store.get('Patient', fhir.ref_id(enc['subject'])) or {}
        card = patient_card(pat) if pat else {}
        level = fhir.triage_level(enc)
        obs = _observations(store, enc['id'])
        news2 = triage.score(fhir.vitals_from_observation(obs[-1]), card.get('age'))['news2'] if obs else ''
        end = _parse(enc['period']['end']) if enc['period'].get('end') else now
        writer.writerow([safe_cell(x) for x in [
            day.isoformat(), enc['id'], card.get('health_id'), card.get('name'), card.get('age'), card.get('sex'), enc['period']['start'],
            f'P{level}' if level else '', fhir.TRIAGE_LEVELS[level][1] if level else 'Not yet triaged', enc['status'],
            ((enc.get('hospitalization') or {}).get('dischargeDisposition') or {}).get('text', ''), _complaint(store, enc['id']),
            news2, int((end - _parse(enc['period']['start'])).total_seconds() // 60), 'yes']])
    return out.getvalue()
