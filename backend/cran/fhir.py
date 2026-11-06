"""FHIR R4 mappers and a lightweight structural validator for the CRAN demo.

Resources are stored as FHIR JSON (see store.py). The mappers below build
spec-shaped resources from simple app inputs; `validate()` checks the parts of
the R4 specification the demo relies on (required elements, cardinality, the
value sets we use, reference shape). It is not a full profile validator.
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone

SYSTEM_HEALTH_ID = 'https://demo.starkite.example/fhir/sid/na-health-id'
SYSTEM_NATIONAL_ID = 'https://demo.starkite.example/fhir/sid/na-national-id'
SYSTEM_TRIAGE = 'https://demo.starkite.example/fhir/CodeSystem/manchester-triage'
SYSTEM_LOINC = 'http://loinc.org'
SYSTEM_UCUM = 'http://unitsofmeasure.org'
SYSTEM_OBS_CATEGORY = 'http://terminology.hl7.org/CodeSystem/observation-category'
SYSTEM_ACT_CODE = 'http://terminology.hl7.org/CodeSystem/v3-ActCode'
SYSTEM_CONDITION_CATEGORY = 'http://terminology.hl7.org/CodeSystem/condition-category'
SYSTEM_CLINICAL_STATUS = 'http://terminology.hl7.org/CodeSystem/condition-clinical'
SYSTEM_DISCHARGE = 'http://terminology.hl7.org/CodeSystem/discharge-disposition'

# Triage levels mirror src/model.ts (Manchester Triage System, database values 1–5).
TRIAGE_LEVELS = {
    1: ('red', 'Red', 'Immediate'),
    2: ('orange', 'Orange', 'Very urgent'),
    3: ('yellow', 'Yellow', 'Urgent'),
    4: ('green', 'Green', 'Standard'),
    5: ('blue', 'Blue', 'Non-urgent'),
}

# (key, LOINC code, display, UCUM unit)
VITALS = [
    ('heart_rate', '8867-4', 'Heart rate', '/min'),
    ('respiratory_rate', '9279-1', 'Respiratory rate', '/min'),
    ('systolic_bp', '8480-6', 'Systolic blood pressure', 'mm[Hg]'),
    ('diastolic_bp', '8462-4', 'Diastolic blood pressure', 'mm[Hg]'),
    ('temperature', '8310-5', 'Body temperature', 'Cel'),
    ('spo2', '59408-5', 'Oxygen saturation in Arterial blood by Pulse oximetry', '%'),
]
CONSCIOUSNESS_CODE = ('80288-4', 'Level of consciousness')
CONSCIOUSNESS_LEVELS = {'A': 'Alert', 'C': 'New confusion', 'V': 'Responds to voice', 'P': 'Responds to pain', 'U': 'Unresponsive'}
OXYGEN_CODE = ('3150-0', 'Inhaled oxygen concentration')


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')


def new_id() -> str:
    return str(uuid.uuid4())


def ref(resource_type: str, rid: str) -> dict:
    return {'reference': f'{resource_type}/{rid}'}


def ref_id(reference: dict | None) -> str | None:
    if not reference or '/' not in reference.get('reference', ''):
        return None
    return reference['reference'].split('/', 1)[1]


# --------------------------------------------------------------------------- mappers

def patient(*, health_id: str, given: str, family: str, gender: str, birth_date: str,
            national_id: str | None = None, region: str | None = None, phone: str | None = None,
            rid: str | None = None) -> dict:
    identifiers = [{'use': 'official', 'system': SYSTEM_HEALTH_ID, 'value': health_id}]
    if national_id:
        identifiers.append({'use': 'secondary', 'system': SYSTEM_NATIONAL_ID, 'value': national_id})
    resource = {
        'resourceType': 'Patient', 'id': rid or new_id(),
        'meta': {'tag': [{'system': 'https://demo.starkite.example/tags', 'code': 'synthetic', 'display': 'Synthetic demo data'}]},
        'identifier': identifiers, 'active': True,
        'name': [{'use': 'official', 'family': family, 'given': [given]}],
        'gender': gender, 'birthDate': birth_date,
    }
    if region:
        resource['address'] = [{'use': 'home', 'state': region, 'country': 'NA'}]
    if phone:
        resource['telecom'] = [{'system': 'phone', 'value': phone, 'use': 'mobile'}]
    return resource


def practitioner(*, rid: str, given: str, family: str, role: str) -> dict:
    return {
        'resourceType': 'Practitioner', 'id': rid, 'active': True,
        'name': [{'family': family, 'given': [given], 'text': f'{given} {family}'}],
        'qualification': [{'code': {'text': role}}],
    }


def encounter(*, patient_id: str, practitioner_id: str | None = None, start: str | None = None,
              status: str = 'arrived', rid: str | None = None) -> dict:
    resource = {
        'resourceType': 'Encounter', 'id': rid or new_id(), 'status': status,
        'class': {'system': SYSTEM_ACT_CODE, 'code': 'EMER', 'display': 'emergency'},
        'subject': ref('Patient', patient_id),
        'period': {'start': start or now_iso()},
        'statusHistory': [{'status': status, 'period': {'start': start or now_iso()}}],
    }
    if practitioner_id:
        resource['participant'] = [{'individual': ref('Practitioner', practitioner_id)}]
    return resource


def set_triage(enc: dict, level: int) -> dict:
    code, colour, label = TRIAGE_LEVELS[level]
    enc['priority'] = {'coding': [{'system': SYSTEM_TRIAGE, 'code': code, 'display': f'{colour} – {label}'}], 'text': f'P{level} {colour}'}
    return enc


def triage_level(enc: dict) -> int | None:
    for coding in (enc.get('priority') or {}).get('coding', []):
        for level, (code, _, _) in TRIAGE_LEVELS.items():
            if coding.get('code') == code:
                return level
    return None


def set_status(enc: dict, status: str, at: str | None = None) -> dict:
    at = at or now_iso()
    history = enc.setdefault('statusHistory', [])
    if history and 'end' not in history[-1]['period']:
        history[-1]['period']['end'] = at
    history.append({'status': status, 'period': {'start': at}})
    enc['status'] = status
    if status == 'finished':
        enc['period']['end'] = at
    return enc


def vitals_observation(*, patient_id: str, encounter_id: str, vitals: dict, effective: str | None = None,
                       performer_id: str | None = None, rid: str | None = None) -> dict:
    components = []
    for key, code, display, unit in VITALS:
        if vitals.get(key) is not None:
            components.append({'code': {'coding': [{'system': SYSTEM_LOINC, 'code': code, 'display': display}]},
                               'valueQuantity': {'value': vitals[key], 'unit': unit, 'system': SYSTEM_UCUM, 'code': unit}})
    if vitals.get('consciousness'):
        level = vitals['consciousness']
        components.append({'code': {'coding': [{'system': SYSTEM_LOINC, 'code': CONSCIOUSNESS_CODE[0], 'display': CONSCIOUSNESS_CODE[1]}]},
                           'valueCodeableConcept': {'coding': [{'system': 'https://demo.starkite.example/fhir/CodeSystem/acvpu', 'code': level, 'display': CONSCIOUSNESS_LEVELS[level]}], 'text': CONSCIOUSNESS_LEVELS[level]}})
    components.append({'code': {'coding': [{'system': SYSTEM_LOINC, 'code': OXYGEN_CODE[0], 'display': OXYGEN_CODE[1]}], 'text': 'On supplemental oxygen'},
                       'valueBoolean': bool(vitals.get('on_oxygen'))})
    resource = {
        'resourceType': 'Observation', 'id': rid or new_id(), 'status': 'final',
        'category': [{'coding': [{'system': SYSTEM_OBS_CATEGORY, 'code': 'vital-signs', 'display': 'Vital Signs'}]}],
        'code': {'coding': [{'system': SYSTEM_LOINC, 'code': '85353-1', 'display': 'Vital signs panel'}], 'text': 'Vital signs'},
        'subject': ref('Patient', patient_id), 'encounter': ref('Encounter', encounter_id),
        'effectiveDateTime': effective or now_iso(), 'component': components,
    }
    if performer_id:
        resource['performer'] = [ref('Practitioner', performer_id)]
    return resource


def vitals_from_observation(obs: dict) -> dict:
    by_code = {code: key for key, code, _, _ in VITALS}
    values: dict = {}
    for component in obs.get('component', []):
        code = component['code']['coding'][0]['code'] if component['code'].get('coding') else None
        if code in by_code:
            values[by_code[code]] = component['valueQuantity']['value']
        elif code == CONSCIOUSNESS_CODE[0]:
            values['consciousness'] = component['valueCodeableConcept']['coding'][0]['code']
        elif code == OXYGEN_CODE[0]:
            values['on_oxygen'] = component.get('valueBoolean', False)
    values['at'] = obs.get('effectiveDateTime')
    return values


def condition(*, patient_id: str, text: str, encounter_id: str | None = None, recorded: str | None = None,
              category: str = 'encounter-diagnosis', clinical_status: str = 'active', rid: str | None = None) -> dict:
    resource = {
        'resourceType': 'Condition', 'id': rid or new_id(),
        'clinicalStatus': {'coding': [{'system': SYSTEM_CLINICAL_STATUS, 'code': clinical_status}]},
        'category': [{'coding': [{'system': SYSTEM_CONDITION_CATEGORY, 'code': category}]}],
        'code': {'text': text}, 'subject': ref('Patient', patient_id), 'recordedDate': recorded or now_iso(),
    }
    if encounter_id:
        resource['encounter'] = ref('Encounter', encounter_id)
    return resource


def allergy(*, patient_id: str, text: str, rid: str | None = None) -> dict:
    return {
        'resourceType': 'AllergyIntolerance', 'id': rid or new_id(),
        'clinicalStatus': {'coding': [{'system': 'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical', 'code': 'active'}]},
        'code': {'text': text}, 'patient': ref('Patient', patient_id),
    }


def bundle(resources: list[dict], bundle_type: str = 'searchset', base: str = 'urn:uuid:') -> dict:
    entries = []
    for resource in resources:
        full = f"{base}{resource['id']}" if base == 'urn:uuid:' else f"{base}/{resource['resourceType']}/{resource['id']}"
        entry = {'fullUrl': full, 'resource': resource}
        if bundle_type == 'searchset':
            entry['search'] = {'mode': 'match'}
        entries.append(entry)
    result = {'resourceType': 'Bundle', 'id': new_id(), 'type': bundle_type, 'timestamp': now_iso(), 'entry': entries}
    if bundle_type == 'searchset':
        result['total'] = len(entries)
    return result


def operation_outcome(message: str, code: str = 'not-found', severity: str = 'error') -> dict:
    return {'resourceType': 'OperationOutcome', 'issue': [{'severity': severity, 'code': code, 'diagnostics': message}]}


# --------------------------------------------------------------------------- validator

ID_RE = re.compile(r'^[A-Za-z0-9\-.]{1,64}$')
DATE_RE = re.compile(r'^\d{4}(-\d{2}(-\d{2})?)?$')
DATETIME_RE = re.compile(r'^\d{4}(-\d{2}(-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2}))?)?)?$')
REF_RE = re.compile(r'^[A-Z][A-Za-z]+/[A-Za-z0-9\-.]{1,64}$')

VALUE_SETS = {
    ('Patient', 'gender'): {'male', 'female', 'other', 'unknown'},
    ('Encounter', 'status'): {'planned', 'arrived', 'triaged', 'in-progress', 'onleave', 'finished', 'cancelled', 'entered-in-error', 'unknown'},
    ('Observation', 'status'): {'registered', 'preliminary', 'final', 'amended', 'corrected', 'cancelled', 'entered-in-error', 'unknown'},
    ('Bundle', 'type'): {'document', 'message', 'transaction', 'transaction-response', 'batch', 'batch-response', 'history', 'searchset', 'collection'},
}
REQUIRED = {
    'Patient': [], 'Practitioner': [],
    'Encounter': ['status', 'class'],
    'Observation': ['status', 'code'],
    'Condition': ['subject'],
    'AllergyIntolerance': ['patient'],
    'Bundle': ['type'],
    'OperationOutcome': ['issue'],
}


class FhirValidationError(ValueError):
    pass


def _check_ref(errors, path, value):
    if not isinstance(value, dict) or not REF_RE.match(value.get('reference', '')):
        errors.append(f'{path}: must be a Reference with reference "Type/id"')


def _check_codeable(errors, path, value):
    if not isinstance(value, dict) or not (value.get('text') or value.get('coding')):
        errors.append(f'{path}: CodeableConcept needs coding or text')
        return
    for i, coding in enumerate(value.get('coding', [])):
        if not isinstance(coding, dict) or not coding.get('code'):
            errors.append(f'{path}.coding[{i}]: Coding needs a code')


def validate(resource: dict, path: str = '') -> list[str]:
    """Return a list of problems. An empty list means the resource passed."""
    errors: list[str] = []
    rtype = resource.get('resourceType') if isinstance(resource, dict) else None
    path = path or (rtype or 'resource')
    if rtype not in REQUIRED:
        return [f'{path}: unsupported or missing resourceType {rtype!r}']
    if 'id' in resource and not ID_RE.match(str(resource['id'])):
        errors.append(f'{path}.id: invalid id')
    for field in REQUIRED[rtype]:
        if resource.get(field) in (None, '', []):
            errors.append(f'{path}.{field}: required (1..1)')
    for (vtype, field), allowed in VALUE_SETS.items():
        if vtype == rtype and field in resource and resource[field] not in allowed:
            errors.append(f'{path}.{field}: {resource[field]!r} not in required value set')
    for i, ident in enumerate(resource.get('identifier', [])):
        if not ident.get('system') or not ident.get('value'):
            errors.append(f'{path}.identifier[{i}]: needs system and value')
    if rtype == 'Patient':
        if 'birthDate' in resource and not DATE_RE.match(resource['birthDate']):
            errors.append(f'{path}.birthDate: must be a FHIR date')
        for i, name in enumerate(resource.get('name', [])):
            if not isinstance(name.get('given', []), list):
                errors.append(f'{path}.name[{i}].given: must be an array')
    if rtype == 'Encounter':
        cls = resource.get('class')
        if cls is not None and (not isinstance(cls, dict) or not cls.get('code')):
            errors.append(f'{path}.class: must be a Coding with code')
        if 'subject' in resource:
            _check_ref(errors, f'{path}.subject', resource['subject'])
        if 'priority' in resource:
            _check_codeable(errors, f'{path}.priority', resource['priority'])
        start = (resource.get('period') or {}).get('start')
        if start and not DATETIME_RE.match(start):
            errors.append(f'{path}.period.start: must be a FHIR dateTime')
        for i, item in enumerate(resource.get('statusHistory', [])):
            if item.get('status') not in VALUE_SETS[('Encounter', 'status')] or not item.get('period'):
                errors.append(f'{path}.statusHistory[{i}]: needs a valid status and period')
    if rtype == 'Observation':
        if 'code' in resource:
            _check_codeable(errors, f'{path}.code', resource['code'])
        for field in ('subject', 'encounter'):
            if field in resource:
                _check_ref(errors, f'{path}.{field}', resource[field])
        if 'effectiveDateTime' in resource and not DATETIME_RE.match(resource['effectiveDateTime']):
            errors.append(f'{path}.effectiveDateTime: must be a FHIR dateTime')
        for i, comp in enumerate(resource.get('component', [])):
            _check_codeable(errors, f'{path}.component[{i}].code', comp.get('code'))
            values = [k for k in comp if k.startswith('value')]
            if len(values) > 1:
                errors.append(f'{path}.component[{i}]: value[x] is 0..1')
            quantity = comp.get('valueQuantity')
            if quantity is not None and not isinstance(quantity.get('value'), (int, float)):
                errors.append(f'{path}.component[{i}].valueQuantity.value: must be a number')
    if rtype == 'Condition':
        if 'subject' in resource:
            _check_ref(errors, f'{path}.subject', resource['subject'])
        if 'code' in resource:
            _check_codeable(errors, f'{path}.code', resource['code'])
    if rtype == 'AllergyIntolerance' and 'patient' in resource:
        _check_ref(errors, f'{path}.patient', resource['patient'])
    if rtype == 'Bundle':
        if resource.get('type') == 'searchset' and 'total' in resource and not isinstance(resource['total'], int):
            errors.append(f'{path}.total: must be an unsignedInt')
        for i, entry in enumerate(resource.get('entry', [])):
            if 'resource' in entry:
                if not entry.get('fullUrl'):
                    errors.append(f'{path}.entry[{i}].fullUrl: required when resource is present')
                errors.extend(validate(entry['resource'], f'{path}.entry[{i}].resource'))
    return errors


def assert_valid(resource: dict) -> dict:
    errors = validate(resource)
    if errors:
        raise FhirValidationError('; '.join(errors))
    return resource
