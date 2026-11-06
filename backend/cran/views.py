"""HTTP API for the CRAN demo. Enabled only when CRAN_DEMO=true; otherwise every
route answers 404. Demo routes do not use Supabase Auth: the role switcher sends
X-Demo-Role, and decisions are logged against that synthetic practitioner."""
from __future__ import annotations

import json
from datetime import date
from functools import wraps

from django.conf import settings
from django.http import Http404, HttpResponse, JsonResponse
from django.views.decorators.csrf import csrf_exempt

from mock_mpi import service as mpi

from . import demo, fhir, service
from .store import get_store

FHIR_JSON = 'application/fhir+json'


def _json(data, status=200, content_type='application/json'):
    response = JsonResponse(data, status=status, safe=False, json_dumps_params={'ensure_ascii': False})
    response['Content-Type'] = f'{content_type}; charset=utf-8'
    response['Cache-Control'] = 'no-store'
    return response


def _fhir(data, status=200):
    return _json(data, status, FHIR_JSON)


def demo_view(*methods):
    def wrap(view):
        @csrf_exempt
        @wraps(view)
        def inner(request, *args, **kwargs):
            if not settings.CRAN_DEMO:
                raise Http404()
            if request.method not in methods:
                return _json({'detail': 'Method not allowed.'}, 405)
            try:
                body = json.loads(request.body or b'{}') if request.method == 'POST' else {}
            except ValueError:
                return _json({'detail': 'Send JSON.'}, 400)
            role = request.headers.get('X-Demo-Role', 'nurse')
            user = demo.user_for(role if role in demo.PRACTITIONERS else 'nurse')
            try:
                return view(request, body, user, *args, **kwargs)
            except service.NotFound as exc:
                return _json({'detail': str(exc)}, 404)
            except (service.Invalid, fhir.FhirValidationError) as exc:
                return _json({'detail': str(exc)}, 400)
            except service.Forbidden as exc:
                return _json({'detail': str(exc)}, 403)
        return inner
    return wrap


def _day(request) -> date:
    try:
        return date.fromisoformat(request.GET.get('date') or '')
    except ValueError:
        return service._now().astimezone(service.TZ).date()


# ----------------------------------------------------------------- FHIR R4 API

@demo_view('GET')
def fhir_patient_search(request, body, user):
    wanted = (request.GET.get('identifier') or '').strip()
    if not wanted:
        return _fhir(fhir.operation_outcome('Search by identifier, e.g. ?identifier=NHI-1000001', 'required'), 400)
    system, _, value = wanted.rpartition('|')
    matches = get_store().search('Patient', lambda p: any(
        i['value'].upper() == value.upper() and (not system or i['system'] == system) for i in p.get('identifier', [])))
    return _fhir(fhir.assert_valid(fhir.bundle(matches, 'searchset')))


@demo_view('GET')
def fhir_patient_read(request, body, user, patient_id):
    found = get_store().get('Patient', patient_id)
    return _fhir(found) if found else _fhir(fhir.operation_outcome(f'Patient/{patient_id} not found'), 404)


def _create(body, rtype, refs):
    if body.get('resourceType') != rtype:
        return _fhir(fhir.operation_outcome(f'Expected a {rtype} resource.', 'invalid'), 400)
    body = dict(body)
    body['id'] = fhir.new_id()
    errors = fhir.validate(body)
    if errors:
        return _fhir({'resourceType': 'OperationOutcome', 'issue': [{'severity': 'error', 'code': 'invalid', 'diagnostics': e} for e in errors]}, 422)
    store = get_store()
    for field, target in refs:
        if field in body and not store.get(target, fhir.ref_id(body[field]) or ''):
            return _fhir(fhir.operation_outcome(f'{field} references a {target} that does not exist.', 'invalid'), 422)
    saved = store.put(body)
    response = _fhir(saved, 201)
    response['Location'] = f"/fhir/{rtype}/{saved['id']}"
    return response


@demo_view('POST')
def fhir_encounter_create(request, body, user):
    return _create(body, 'Encounter', [('subject', 'Patient')])


@demo_view('POST')
def fhir_observation_create(request, body, user):
    return _create(body, 'Observation', [('subject', 'Patient'), ('encounter', 'Encounter')])


@demo_view('GET')
def fhir_encounter_everything(request, body, user, encounter_id):
    try:
        return _fhir(service.everything(encounter_id))
    except service.NotFound:
        return _fhir(fhir.operation_outcome(f'Encounter/{encounter_id} not found'), 404)


@demo_view('GET')
def fhir_metadata(request, body, user):
    resources = [{'type': 'Patient', 'interaction': [{'code': 'read'}, {'code': 'search-type'}], 'searchParam': [{'name': 'identifier', 'type': 'token'}]},
                 {'type': 'Encounter', 'interaction': [{'code': 'create'}], 'operation': [{'name': 'everything', 'definition': 'http://hl7.org/fhir/OperationDefinition/Encounter-everything'}]},
                 {'type': 'Observation', 'interaction': [{'code': 'create'}]}]
    return _fhir({'resourceType': 'CapabilityStatement', 'status': 'active', 'date': fhir.now_iso(), 'kind': 'instance',
                  'fhirVersion': '4.0.1', 'format': ['json'], 'software': {'name': 'PatientFlow CRAN demo'},
                  'rest': [{'mode': 'server', 'resource': resources}]})


@demo_view('GET')
def mock_mpi_search(request, body, user):
    """The mock registry exposed as its own HTTP endpoint (what a real MoHSS MPI would be)."""
    found = mpi.lookup(request.GET.get('identifier') or '')
    return _fhir(found or fhir.bundle([], 'searchset'))


# ----------------------------------------------------------------- app API

@demo_view('GET')
def state(request, body, user):
    return _json(service.board())


@demo_view('POST')
def lookup(request, body, user):
    return _json(service.lookup(body.get('identifier', '')))


@demo_view('POST')
def register(request, body, user):
    return _json(service.register_patient(body), 201)


@demo_view('POST')
def arrival(request, body, user):
    return _json(service.arrival(body.get('patient_id', ''), body.get('vitals') or {}, body.get('complaint', ''), user), 201)


@demo_view('GET')
def encounter(request, body, user, encounter_id):
    return _json(service.encounter_detail(encounter_id))


@demo_view('POST')
def triage(request, body, user, encounter_id):
    try:
        level = int(body.get('level'))
    except (TypeError, ValueError):
        raise service.Invalid('Choose a triage level.') from None
    return _json(service.triage_decision(encounter_id, level, body.get('suggestion_id'), user, body.get('reason', '')))


@demo_view('POST')
def retriage(request, body, user, encounter_id):
    return _json(service.retriage(encounter_id, user))


@demo_view('POST')
def vitals(request, body, user, encounter_id):
    return _json(service.add_vitals(encounter_id, body.get('vitals') or {}, user), 201)


@demo_view('POST')
def alert(request, body, user, alert_id):
    return _json(service.alert_decision(alert_id, body.get('action', ''), user, body.get('reason', '')))


@demo_view('POST')
def treat(request, body, user, encounter_id):
    service.start_treatment(encounter_id, user)
    return _json({'ok': True})


@demo_view('POST')
def close(request, body, user, encounter_id):
    service.close(encounter_id, body.get('disposition', ''), user)
    return _json({'ok': True})


@demo_view('POST')
def note_draft(request, body, user, encounter_id):
    return _json(service.draft_note(encounter_id, body.get('transcript', ''), user))


@demo_view('POST')
def note_sign(request, body, user, encounter_id):
    return _json(service.sign_note(encounter_id, body.get('note') or {}, body.get('suggestion_id'), user), 201)


@demo_view('GET')
def handover(request, body, user):
    return _json(service.handover(user))


@demo_view('GET')
def dashboard(request, body, user):
    return _json(service.dashboard(user))


@demo_view('POST')
def help_answer(request, body, user):
    from ai import assistant
    question = (body.get('question') or '').strip()
    if not question:
        raise service.Invalid('Type a question.')
    return _json(assistant.answer_help(question[:500]))


@demo_view('GET')
def audit(request, body, user):
    store = get_store()
    return _json({'suggestions': store.records('suggestions')[-50:], 'decisions': store.records('decisions')[-100:]})


@demo_view('GET')
def directory(request, body, user):
    return _json(mpi.directory())


@demo_view('GET')
def export(request, body, user, kind):
    service.require(user, 'supervisor', 'doctor')
    day = _day(request)
    if kind == 'bundle':
        encounter_id = request.GET.get('encounter')
        data = service.everything(encounter_id) if encounter_id else service.day_bundle(day)
        name = f'patientflow-fhir-{encounter_id[:8] if encounter_id else day.isoformat()}.json'
        response = HttpResponse(json.dumps(data, indent=2, ensure_ascii=False), content_type=f'{FHIR_JSON}; charset=utf-8')
    elif kind == 'dhis2':
        name = f'patientflow-dhis2-demo-{day.isoformat()}.json'
        response = HttpResponse(json.dumps(service.dhis2(day), indent=2), content_type='application/json; charset=utf-8')
    elif kind == 'csv':
        name = f'patientflow-ed-visits-{day.isoformat()}.csv'
        response = HttpResponse('﻿' + service.csv_export(day), content_type='text/csv; charset=utf-8')
    else:
        raise service.NotFound('Unknown export.')
    response['Content-Disposition'] = f'attachment; filename="{name}"'
    response['Cache-Control'] = 'no-store'
    return response


@demo_view('POST')
def reset(request, body, user):
    service.reset_demo()
    return _json({'ok': True, 'scripted': get_store().get_meta('scripted')})


@demo_view('POST')
def trigger(request, body, user):
    return _json({'ok': True, 'result': service.trigger_deterioration()})
