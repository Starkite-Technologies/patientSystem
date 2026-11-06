"""Mock national registry (MPI). Behaves like a FHIR registry endpoint: lookup by
national ID or health ID returns a searchset Bundle with the Patient plus a short
history (past Encounters, Conditions, AllergyIntolerances). Not connected to MoHSS.
"""
from __future__ import annotations

import uuid

from cran import fhir

from .data import PEOPLE

NAMESPACE = uuid.UUID('6f1c0d1e-5a1b-4c7e-9a43-0c2a5d7e1f00')


def _rid(*parts: str) -> str:
    return str(uuid.uuid5(NAMESPACE, '/'.join(parts)))


def _find(identifier: str):
    value = identifier.split('|')[-1].strip().upper()
    for person in PEOPLE:
        if person['in_registry'] and value in (person['health_id'].upper(), person['national_id']):
            return person
    return None


def patient_resource(person: dict) -> dict:
    resource = fhir.patient(health_id=person['health_id'], national_id=person['national_id'], given=person['given'],
                            family=person['family'], gender=person['gender'], birth_date=person['birth_date'],
                            region=person['region'], phone=person['phone'], rid=_rid('patient', person['health_id']))
    resource['meta']['source'] = 'mock-mpi'
    return resource


def lookup(identifier: str) -> dict | None:
    """Return a FHIR searchset Bundle, or None when the person is not registered."""
    person = _find(identifier)
    if person is None:
        return None
    pat = patient_resource(person)
    resources = [pat]
    for i, enc in enumerate(person['encounters']):
        encounter = fhir.encounter(patient_id=pat['id'], start=f"{enc['date']}T09:00:00+02:00", status='finished',
                                   rid=_rid('encounter', person['health_id'], str(i)))
        encounter['period']['end'] = f"{enc['date']}T15:00:00+02:00"
        encounter['statusHistory'] = [{'status': 'finished', 'period': dict(encounter['period'])}]
        encounter['serviceProvider'] = {'display': enc['facility']}
        encounter['reasonCode'] = [{'text': enc['reason']}]
        resources.append(encounter)
    for i, text in enumerate(person['conditions']):
        resources.append(fhir.condition(patient_id=pat['id'], text=text, category='problem-list-item',
                                        recorded='2023-01-01', rid=_rid('condition', person['health_id'], str(i))))
    for i, text in enumerate(person['allergies']):
        resources.append(fhir.allergy(patient_id=pat['id'], text=text, rid=_rid('allergy', person['health_id'], str(i))))
    result = fhir.bundle(resources, 'searchset')
    for entry in result['entry'][1:]:
        entry['search'] = {'mode': 'include'}
    return result


def directory():
    """Presenter cheat sheet: every synthetic ID and whether it is in the registry."""
    return [{'health_id': p['health_id'], 'national_id': p['national_id'], 'name': f"{p['given']} {p['family']}",
             'in_registry': p['in_registry']} for p in PEOPLE]


def new_person(health_id: str) -> dict | None:
    """Demographics the demo pre-fills for a 'new' synthetic ID (as if read from the ID card)."""
    for person in PEOPLE:
        if person['health_id'].upper() == health_id.strip().upper() or person['national_id'] == health_id.strip():
            return {k: person[k] for k in ('health_id', 'national_id', 'given', 'family', 'gender', 'birth_date', 'region')}
    return None
