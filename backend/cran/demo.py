"""Reproducible demo seed and scripted scenario (synthetic data only).

Scenario after reset:
- 12 patients already on the board at different levels and waiting times.
- 1 scripted patient (Yellow) whose vitals worsen DETERIORATION_DELAY seconds after
  reset, so the deterioration alert fires live on stage.
Content is deterministic; only timestamps are relative to the moment of reset.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from ai import forecast
from mock_mpi import service as mpi
from mock_mpi.data import PEOPLE

from . import fhir

DETERIORATION_DELAY = 60
FACILITY = 'PatientFlow Demo Emergency Department'

PRACTITIONERS = {
    'nurse': {'id': 'prac-nurse-01', 'given': 'Selma', 'family': 'Nakale', 'role': 'Registered nurse (triage)'},
    'doctor': {'id': 'prac-doctor-01', 'given': 'Tuhafeni', 'family': 'Amutenya', 'role': 'Emergency medical officer'},
    'supervisor': {'id': 'prac-super-01', 'given': 'Kaarina', 'family': 'Beukes', 'role': 'Nurse manager (supervisor)'},
}
MONITOR = {'id': 'prac-monitor', 'name': 'Bedside monitor (scripted demo)', 'role': 'system'}

V = lambda hr, rr, sbp, dbp, t, s, c='A', o2=False: {  # noqa: E731
    'heart_rate': hr, 'respiratory_rate': rr, 'systolic_bp': sbp, 'diastolic_bp': dbp,
    'temperature': t, 'spo2': s, 'consciousness': c, 'on_oxygen': o2}

# (person index, minutes ago, confirmed level, encounter status, complaint, vitals)
WAITING = [
    (1, 34, 1, 'in-progress', 'Motor vehicle collision, chest injury, short of breath', V(132, 30, 88, 54, 36.4, 89, 'V', True)),
    (2, 22, 2, 'triaged', 'Central chest pain radiating to left arm, 40 minutes', V(104, 20, 158, 96, 36.8, 96)),
    (3, 48, 2, 'triaged', 'Wheeze and shortness of breath not settling with inhaler', V(112, 26, 132, 84, 36.9, 93)),
    (4, 15, 3, 'triaged', 'Abdominal pain right lower quadrant since yesterday', V(98, 18, 126, 80, 38.1, 97)),
    (5, 63, 3, 'triaged', 'Fever and vomiting for 2 days, unable to keep fluids down', V(126, 28, 98, 60, 38.7, 97)),
    (6, 9, 3, 'triaged', 'Deep laceration to forearm, bleeding controlled', V(92, 16, 136, 88, 36.6, 99)),
    (7, 95, 4, 'triaged', 'Painful swollen ankle after fall at soccer', V(78, 14, 128, 82, 36.7, 99)),
    (8, 71, 4, 'triaged', 'Burning urination for 3 days', V(84, 16, 122, 78, 37.6, 98)),
    (9, 120, 4, 'triaged', 'Dog bite to hand, small puncture wounds', V(80, 14, 130, 84, 36.5, 99)),
    (10, 42, 4, 'triaged', 'Headache and dizziness since this morning', V(76, 16, 168, 102, 36.6, 98)),
    (11, 140, 5, 'triaged', 'Prescription renewal for chronic medication', V(72, 14, 134, 86, 36.6, 99)),
    (12, 155, 5, 'triaged', 'Rash on arms for one week, itchy', V(70, 14, 118, 76, 36.7, 99)),
]
SCRIPTED = (13, 'Fever and productive cough for 3 days', V(96, 18, 124, 80, 38.2, 96), 3)
WORSENED = V(108, 22, 108, 70, 38.4, 94)  # NEWS2 2 -> 6: suggests P2 Orange


def practitioner_resources():
    return [fhir.practitioner(rid=p['id'], given=p['given'], family=p['family'], role=p['role']) for p in PRACTITIONERS.values()]


def user_for(role: str) -> dict:
    p = PRACTITIONERS.get(role, PRACTITIONERS['nurse'])
    return {'id': p['id'], 'name': f"{p['given']} {p['family']}", 'role': role}


def iso(t: datetime) -> str:
    return t.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')


def local_patient(person: dict) -> dict:
    """A registry patient as imported into the ED, or a 'new' one registered on arrival."""
    if person['in_registry']:
        resource = mpi.patient_resource(person)
        resource['meta']['source'] = 'mock-mpi'
    else:
        resource = fhir.patient(health_id=person['health_id'], national_id=person['national_id'], given=person['given'],
                                family=person['family'], gender=person['gender'], birth_date=person['birth_date'],
                                region=person['region'], rid=f"local-{person['health_id'].lower()}")
        resource['meta']['source'] = 'local'
    return resource


def build(now: datetime | None = None):
    """Return (resources, records, meta) for a fresh demo state."""
    now = now or datetime.now(timezone.utc)
    nurse = user_for('nurse')
    resources = practitioner_resources()
    records = {'suggestions': [], 'decisions': [], 'alerts': [], 'notes': []}
    meta = {'registry': {}}

    def admit(index, minutes_ago, level, status, complaint, vitals):
        person = PEOPLE[index]
        pat = local_patient(person)
        if person['in_registry']:
            meta['registry'][pat['id']] = mpi.lookup(person['health_id'])
        start = now - timedelta(minutes=minutes_ago)
        enc = fhir.encounter(patient_id=pat['id'], practitioner_id=nurse['id'], start=iso(start), status='arrived')
        enc['serviceProvider'] = {'display': FACILITY}
        fhir.set_triage(enc, level)
        fhir.set_status(enc, 'triaged', iso(start + timedelta(minutes=4)))
        if status == 'in-progress':
            fhir.set_status(enc, 'in-progress', iso(start + timedelta(minutes=6)))
        obs = fhir.vitals_observation(patient_id=pat['id'], encounter_id=enc['id'], vitals=vitals,
                                      effective=iso(start + timedelta(minutes=3)), performer_id=nurse['id'])
        cond = fhir.condition(patient_id=pat['id'], encounter_id=enc['id'], text=complaint, recorded=iso(start),
                              category='encounter-diagnosis')
        resources.extend([pat, enc, obs, cond])
        records['decisions'].append({'id': f'seed-{enc["id"]}', 'created_at': iso(start + timedelta(minutes=4)), 'kind': 'triage',
                                     'encounter_id': enc['id'], 'suggestion_id': None, 'action': 'confirm', 'level': level,
                                     'user': nurse, 'note': 'Seeded demo decision'})
        return enc

    for row in WAITING:
        admit(*row)
    index, complaint, vitals, level = SCRIPTED
    scripted = admit(index, 2, level, 'triaged', complaint, vitals)
    meta['scripted'] = {'encounter_id': scripted['id'], 'at': iso(now + timedelta(seconds=DETERIORATION_DELAY)), 'done': False}
    meta['arrivals'] = forecast.seed_arrivals(now)
    meta['seeded_at'] = iso(now)
    return resources, records, meta
