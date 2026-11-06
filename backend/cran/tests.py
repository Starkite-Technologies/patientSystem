import csv
import io
import json
import os
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import httpx
from django.test import SimpleTestCase, override_settings
from django.test import Client

from ai import assistant, deterioration, forecast, llm, triage
from mock_mpi import service as mpi
from mock_mpi.data import PEOPLE

from . import demo, fhir, service
from .registry import MockConnector, history
from .store import FileStore, use_store

NO_AI = {'ANTHROPIC_API_KEY': '', 'AI_DISABLED': 'false'}
NORMAL = {'heart_rate': 78, 'respiratory_rate': 14, 'systolic_bp': 128, 'diastolic_bp': 80, 'temperature': 36.7,
          'spo2': 98, 'consciousness': 'A', 'on_oxygen': False}


class FhirMapperTests(SimpleTestCase):
    def test_patient_encounter_observation_condition_are_valid_r4(self):
        pat = fhir.patient(health_id='NHI-1', national_id='90010112345', given='Test', family='Person', gender='female',
                           birth_date='1990-01-01', region='Khomas')
        enc = fhir.set_triage(fhir.encounter(patient_id=pat['id']), 3)
        obs = fhir.vitals_observation(patient_id=pat['id'], encounter_id=enc['id'], vitals=NORMAL)
        cond = fhir.condition(patient_id=pat['id'], encounter_id=enc['id'], text='Chest pain')
        prac = fhir.practitioner(rid='prac-1', given='A', family='B', role='Nurse')
        for resource in (pat, enc, obs, cond, prac):
            self.assertEqual(fhir.validate(resource), [], resource['resourceType'])
        self.assertEqual(enc['class']['code'], 'EMER')
        self.assertEqual(fhir.triage_level(enc), 3)

    def test_vitals_round_trip_through_observation(self):
        obs = fhir.vitals_observation(patient_id='p', encounter_id='e', vitals=NORMAL)
        values = fhir.vitals_from_observation(obs)
        for key, value in NORMAL.items():
            self.assertEqual(values[key], value)
        codes = {c['code']['coding'][0]['code'] for c in obs['component']}
        self.assertTrue({'8867-4', '9279-1', '8480-6', '8462-4', '8310-5', '59408-5'} <= codes)

    def test_bundle_validates_entries(self):
        pat = fhir.patient(health_id='NHI-1', given='T', family='P', gender='male', birth_date='1980-05-05')
        self.assertEqual(fhir.validate(fhir.bundle([pat])), [])
        bad = fhir.bundle([{**pat, 'gender': 'man'}])
        self.assertTrue(any('gender' in e for e in fhir.validate(bad)))

    def test_validator_rejects_missing_required_and_bad_values(self):
        self.assertTrue(fhir.validate({'resourceType': 'Encounter', 'id': 'x'}))
        enc = fhir.encounter(patient_id='p')
        enc['status'] = 'waiting'
        self.assertTrue(any('status' in e for e in fhir.validate(enc)))
        obs = fhir.vitals_observation(patient_id='p', encounter_id='e', vitals=NORMAL)
        obs['subject'] = {'reference': 'not a reference'}
        self.assertTrue(any('subject' in e for e in fhir.validate(obs)))
        self.assertTrue(fhir.validate({'resourceType': 'Spaceship'}))

    def test_status_history_closes_previous_period(self):
        enc = fhir.encounter(patient_id='p')
        fhir.set_status(enc, 'triaged')
        fhir.set_status(enc, 'finished')
        self.assertIn('end', enc['statusHistory'][0]['period'])
        self.assertIn('end', enc['period'])
        self.assertEqual(fhir.validate(enc), [])


class RegistryTests(SimpleTestCase):
    def test_seventy_percent_in_registry_and_reproducible(self):
        self.assertEqual(len(PEOPLE), 50)
        self.assertEqual(sum(p['in_registry'] for p in PEOPLE), 35)
        from mock_mpi import data
        self.assertEqual(data._people(), PEOPLE)

    def test_lookup_by_health_or_national_id_returns_valid_bundle(self):
        by_health = mpi.lookup('NHI-1000001')
        by_national = mpi.lookup(PEOPLE[0]['national_id'])
        self.assertEqual(fhir.validate(by_health), [])
        self.assertEqual(by_health['entry'][0]['resource']['id'], by_national['entry'][0]['resource']['id'])
        hist = history(by_health)
        self.assertIn('Penicillin', hist['allergies'])
        self.assertTrue(hist['encounters'])

    def test_new_patients_are_not_found_but_can_be_prefilled(self):
        self.assertIsNone(MockConnector().lookup('NHI-1000040'))
        self.assertEqual(MockConnector().prefill('NHI-1000040')['health_id'], 'NHI-1000040')
        self.assertEqual(MockConnector().label, 'National registry (demo mock)')


class RuleTriageTests(SimpleTestCase):
    def test_normal_vitals_score_zero(self):
        result = triage.score(NORMAL)
        self.assertEqual(result['news2'], 0)
        self.assertEqual(result['level'], 5)

    def test_news2_bands(self):
        # RR 24 (2) + SpO2 93 (2) + HR 112 (2) + temp 38.4 (1) = 7 -> high -> Red
        high = {**NORMAL, 'respiratory_rate': 24, 'spo2': 93, 'heart_rate': 112, 'temperature': 38.4}
        self.assertEqual(triage.score(high)['news2'], 7)
        self.assertEqual(triage.score(high)['level'], 1)
        medium = {**NORMAL, 'respiratory_rate': 22, 'heart_rate': 112, 'temperature': 38.4}  # 2+2+1
        self.assertEqual(triage.score(medium)['band'], 'medium')
        single_red = {**NORMAL, 'consciousness': 'V'}
        self.assertEqual(triage.score(single_red)['band'], 'low-medium')
        self.assertEqual(triage.score({**NORMAL, 'heart_rate': 95})['level'], 4)

    def test_boundaries_and_oxygen(self):
        self.assertEqual(triage.news2_parts({**NORMAL, 'respiratory_rate': 8})['respiratory_rate'], 3)
        self.assertEqual(triage.news2_parts({**NORMAL, 'respiratory_rate': 25})['respiratory_rate'], 3)
        self.assertEqual(triage.news2_parts({**NORMAL, 'systolic_bp': 220})['systolic_bp'], 3)
        self.assertEqual(triage.news2_parts({**NORMAL, 'temperature': 35.0})['temperature'], 3)
        self.assertEqual(triage.news2_parts({**NORMAL, 'temperature': 39.1})['temperature'], 2)
        self.assertEqual(triage.news2_parts({**NORMAL, 'on_oxygen': True})['on_oxygen'], 2)

    def test_child_gets_caution(self):
        self.assertIsNotNone(triage.score(NORMAL, age=6)['caution'])
        self.assertIsNone(triage.score(NORMAL, age=40)['caution'])


class DeteriorationTests(SimpleTestCase):
    def test_worsening_vitals_suggest_moving_up(self):
        alert = deterioration.check(demo.SCRIPTED[2], demo.WORSENED, current_level=3)
        self.assertEqual(alert['suggested_level'], 2)
        self.assertIn('Suggest moving up to P2 Orange', alert['message'])
        self.assertTrue(any('NEWS2 rose' in r for r in alert['reasons']))

    def test_stable_or_better_vitals_raise_nothing(self):
        self.assertIsNone(deterioration.check(NORMAL, NORMAL, current_level=4))
        self.assertIsNone(deterioration.check(demo.WORSENED, NORMAL, current_level=2))

    def test_worse_but_already_covered_level_still_flags_review(self):
        alert = deterioration.check(NORMAL, demo.WORSENED, current_level=1)
        self.assertIsNone(alert['suggested_level'])


class ForecastTests(SimpleTestCase):
    def test_moving_average_by_weekday_and_hour(self):
        now = datetime(2026, 11, 6, 10, 30, tzinfo=timezone.utc)
        rows = forecast.seed_arrivals(now)
        self.assertEqual(len(rows), 8 * 7 * 24)
        result = forecast.forecast(rows, now)
        self.assertEqual(len(result['points']), 6)
        first = result['points'][0]
        target = datetime.fromisoformat(first['hour'])
        same_slot = [r['arrivals'] for r in rows if datetime.fromisoformat(r['hour']).weekday() == target.weekday()
                     and datetime.fromisoformat(r['hour']).hour == target.hour]
        self.assertEqual(first['expected'], round(sum(same_slot) / len(same_slot), 1))
        self.assertEqual(result['label'], 'Forecast')
        self.assertEqual(forecast.seed_arrivals(now), rows)


@patch.dict(os.environ, NO_AI)
class AssistantFallbackTests(SimpleTestCase):
    def test_triage_without_ai_uses_rules(self):
        result = assistant.suggest_triage(age=50, sex='male', vitals=NORMAL, complaint='Sprained ankle')
        self.assertEqual(result['source'], 'rules')
        self.assertIsNone(result['ai'])
        self.assertEqual(result['suggested_level'], 5)
        self.assertIn('rule-based', result['notice'])

    def test_note_and_summary_and_help_fallbacks(self):
        note = assistant.draft_note('Pain in the chest since this morning. On examination chest is clear. Plan: give aspirin and repeat ECG.')
        self.assertIn('chest', note['note']['presenting_complaint'].lower())
        self.assertIn('examination', note['note']['findings'].lower())
        self.assertIn('aspirin', note['note']['plan'].lower())
        summary = assistant.summarize(age=58, sex='female', conditions=['Asthma'], allergies=[], encounters=[])
        self.assertIn('No allergies recorded', summary['summary'])
        answer = assistant.answer_help('How do I confirm a triage level?')
        self.assertIn('triage', answer['section'].lower())

    def test_redaction_removes_identifiers(self):
        text = assistant.redact('Ndapewa Shilongo NHI-1000001 68031420001 has chest pain', ['Ndapewa', 'Shilongo'])
        for value in ('Ndapewa', 'Shilongo', 'NHI-1000001', '68031420001'):
            self.assertNotIn(value, text)


@patch.dict(os.environ, {'ANTHROPIC_API_KEY': 'test-key', 'ANTHROPIC_MODEL': 'claude-test', 'AI_DISABLED': 'false'})
class AssistantAITests(SimpleTestCase):
    def reply(self, data):
        response = MagicMock()
        response.raise_for_status.return_value = None
        response.json.return_value = {'content': [{'type': 'tool_use', 'name': 'respond', 'input': data}]}
        return response

    def test_ai_more_urgent_than_rules_is_highlighted_and_no_identifiers_sent(self):
        with patch('ai.llm.httpx.post', return_value=self.reply({'level': 2, 'reasons': ['Chest pain', 'Age'], 'confidence': 'medium'})) as post:
            result = assistant.suggest_triage(age=60, sex='male', vitals=NORMAL, complaint='Central chest pain')
        self.assertEqual(result['ai']['level'], 2)
        self.assertTrue(result['disagree'])
        self.assertEqual(result['more_urgent_source'], 'ai')
        self.assertEqual(result['suggested_level'], 2)
        sent = json.loads(post.call_args.kwargs['json']['messages'][0]['content'])
        self.assertEqual(set(sent), {'age', 'sex', 'complaint', 'vitals', 'rule_baseline'})
        self.assertEqual(post.call_args.kwargs['json']['model'], 'claude-test')

    def test_ai_failure_falls_back(self):
        with patch('ai.llm.httpx.post', side_effect=httpx.ConnectError('down')):
            result = assistant.suggest_triage(age=60, sex='male', vitals=NORMAL, complaint='x')
        self.assertEqual(result['source'], 'rules')
        self.assertIn('AI unavailable', result['notice'])

    def test_rules_more_urgent_wins_over_ai(self):
        sick = {**NORMAL, 'consciousness': 'U', 'spo2': 85, 'respiratory_rate': 30}
        with patch('ai.llm.httpx.post', return_value=self.reply({'level': 4, 'reasons': ['a', 'b'], 'confidence': 'low'})):
            result = assistant.suggest_triage(age=60, sex='male', vitals=sick, complaint='x')
        self.assertEqual(result['suggested_level'], 1)
        self.assertEqual(result['more_urgent_source'], 'rules')


@override_settings(CRAN_DEMO=True)
@patch.dict(os.environ, NO_AI)
class DemoApiTests(SimpleTestCase):
    def setUp(self):
        use_store(FileStore(None))
        service.reset_demo()
        self.client = Client()

    def tearDown(self):
        use_store(None)

    def post(self, url, data, role='nurse'):
        return self.client.post(url, json.dumps(data), content_type='application/json', HTTP_X_DEMO_ROLE=role)

    def get(self, url, role='nurse'):
        return self.client.get(url, HTTP_X_DEMO_ROLE=role)

    def test_disabled_without_flag(self):
        with override_settings(CRAN_DEMO=False):
            self.assertEqual(self.client.get('/api/cran/state/').status_code, 404)
            self.assertEqual(self.client.get('/fhir/Patient?identifier=x').status_code, 404)

    def test_seed_has_twelve_waiting_plus_scripted(self):
        rows = self.get('/api/cran/state/').json()['rows']
        self.assertEqual(len(rows), 13)
        levels = [r['level'] for r in rows]
        self.assertEqual(levels, sorted(levels))

    def test_full_demo_script(self):
        # 1. Registry lookup with summary
        found = self.post('/api/cran/lookup/', {'identifier': 'NHI-1000001'}).json()
        self.assertTrue(found['found'])
        self.assertEqual(found['registry'], 'National registry (demo mock)')
        self.assertIn('Penicillin', found['summary']['summary'])
        pid = found['patient']['id']
        # 2. Vitals -> suggestion -> confirm -> board
        made = self.post('/api/cran/arrivals/', {'patient_id': pid, 'complaint': 'Chest pain', 'vitals': {**NORMAL, 'heart_rate': 115}}).json()
        self.assertEqual(made['suggestion']['source'], 'rules')
        level = made['suggestion']['suggested_level']
        decision = self.post(f"/api/cran/encounters/{made['encounter_id']}/triage/", {'level': level, 'suggestion_id': made['suggestion_id']}).json()
        self.assertEqual(decision['action'], 'confirm')
        self.assertEqual(decision['user']['role'], 'nurse')
        self.assertTrue(decision['created_at'])
        rows = self.get('/api/cran/state/').json()['rows']
        self.assertIn(made['encounter_id'], [r['encounter_id'] for r in rows])
        # 3. Scripted deterioration -> alert -> confirm moves up
        service.trigger_deterioration()
        rows = self.get('/api/cran/state/').json()['rows']
        alerted = next(r for r in rows if r['alert'])
        self.assertEqual(alerted['alert']['suggested_level'], 2)
        self.post(f"/api/cran/alerts/{alerted['alert']['id']}/", {'action': 'confirm'})
        moved = next(r for r in self.get('/api/cran/state/').json()['rows'] if r['encounter_id'] == alerted['encounter_id'])
        self.assertEqual(moved['level'], 2)
        self.assertIsNone(moved['alert'])
        # 4. Doctor drafts and signs a note (nurse cannot sign)
        url = f"/api/cran/encounters/{made['encounter_id']}/notes/"
        self.assertEqual(self.post(url + 'draft/', {'transcript': 'Chest pain.'}).status_code, 403)
        draft = self.post(url + 'draft/', {'transcript': 'Chest pain for two hours. On examination heart sounds normal. Plan: ECG and troponin.'}, 'doctor').json()
        note = {**draft['note'], 'plan': draft['note']['plan'] + ' Review in 1 hour.'}
        signed = self.post(url, {'note': note, 'suggestion_id': draft['suggestion_id']}, 'doctor').json()
        self.assertTrue(signed['edited_by_clinician'])
        self.assertEqual(signed['signed_by']['role'], 'doctor')
        # 5. Supervisor dashboard + exports
        dash = self.get('/api/cran/dashboard/', 'supervisor').json()
        self.assertEqual(len(dash['forecast']['points']), 6)
        self.assertGreaterEqual(dash['arrivals_today'], 1)
        bundle = json.loads(self.get('/api/cran/export/bundle/', 'supervisor').content)
        self.assertEqual(bundle['type'], 'collection')
        self.assertEqual(fhir.validate(bundle), [])
        dhis = json.loads(self.get('/api/cran/export/dhis2/', 'supervisor').content)
        self.assertIn('DHIS2-compatible format (demo)', dhis['_label'])
        self.assertEqual(sum(int(v['value']) for v in dhis['dataValues']), 14)
        rows = list(csv.reader(io.StringIO(self.get('/api/cran/export/csv/', 'supervisor').content.decode('utf-8-sig'))))
        self.assertEqual(len(rows), 15)
        self.assertEqual(self.get('/api/cran/export/csv/', 'nurse').status_code, 403)

    def test_change_requires_reason_and_logs_both(self):
        pid = self.post('/api/cran/patients/', {'given': 'New', 'family': 'Person', 'gender': 'male', 'birth_date': '1999-02-02', 'health_id': 'NHI-1000040'}).json()['id']
        made = self.post('/api/cran/arrivals/', {'patient_id': pid, 'complaint': 'Ankle', 'vitals': NORMAL}).json()
        url = f"/api/cran/encounters/{made['encounter_id']}/triage/"
        self.assertEqual(self.post(url, {'level': 3, 'suggestion_id': made['suggestion_id']}).status_code, 400)
        changed = self.post(url, {'level': 3, 'suggestion_id': made['suggestion_id'], 'reason': 'Severe pain'}).json()
        self.assertEqual((changed['action'], changed['suggested_level'], changed['level']), ('change', 5, 3))
        audit = self.get('/api/cran/audit/').json()
        self.assertIn(made['suggestion_id'], [s['id'] for s in audit['suggestions']])

    def test_dismiss_keeps_level(self):
        enc_id = service.get_store().get_meta('scripted')['encounter_id']
        service.trigger_deterioration()
        alert = next(r['alert'] for r in self.get('/api/cran/state/').json()['rows'] if r['alert'])
        self.post(f"/api/cran/alerts/{alert['id']}/", {'action': 'dismiss'})
        row = next(r for r in self.get('/api/cran/state/').json()['rows'] if r['encounter_id'] == enc_id)
        self.assertEqual(row['level'], 3)

    def test_scripted_deterioration_fires_after_delay(self):
        scripted = service.get_store().get_meta('scripted')
        self.assertFalse(any(r['alert'] for r in self.get('/api/cran/state/').json()['rows']))
        later = datetime.now(timezone.utc) + timedelta(seconds=demo.DETERIORATION_DELAY + 1)
        with patch('cran.service._now', return_value=later):
            rows = self.get('/api/cran/state/').json()['rows']
        self.assertTrue(next(r for r in rows if r['encounter_id'] == scripted['encounter_id'])['alert'])

    def test_close_removes_from_board(self):
        enc_id = self.get('/api/cran/state/').json()['rows'][0]['encounter_id']
        self.post(f'/api/cran/encounters/{enc_id}/close/', {'disposition': 'admit'})
        self.assertNotIn(enc_id, [r['encounter_id'] for r in self.get('/api/cran/state/').json()['rows']])
        enc = service.get_store().get('Encounter', enc_id)
        self.assertEqual(enc['status'], 'finished')
        self.assertEqual(enc['hospitalization']['dischargeDisposition']['text'], 'Admitted to inpatient ward')

    def test_fhir_routes(self):
        found = self.post('/api/cran/lookup/', {'identifier': 'NHI-1000001'}).json()
        pid = found['patient']['id']
        search = self.client.get('/fhir/Patient?identifier=NHI-1000001')
        self.assertEqual(search['Content-Type'].split(';')[0], 'application/fhir+json')
        self.assertEqual(search.json()['total'], 1)
        self.assertEqual(fhir.validate(search.json()), [])
        self.assertEqual(self.client.get(f'/fhir/Patient/{pid}').json()['id'], pid)
        self.assertEqual(self.client.get('/fhir/Patient/nope').status_code, 404)
        enc = fhir.encounter(patient_id=pid)
        created = self.client.post('/fhir/Encounter', json.dumps(enc), content_type='application/fhir+json')
        self.assertEqual(created.status_code, 201)
        eid = created.json()['id']
        self.assertTrue(created['Location'].endswith(eid))
        obs = fhir.vitals_observation(patient_id=pid, encounter_id=eid, vitals=NORMAL)
        self.assertEqual(self.client.post('/fhir/Observation', json.dumps(obs), content_type='application/fhir+json').status_code, 201)
        bad = {**obs, 'status': 'whatever'}
        self.assertEqual(self.client.post('/fhir/Observation', json.dumps(bad), content_type='application/fhir+json').status_code, 422)
        orphan = fhir.encounter(patient_id='missing')
        self.assertEqual(self.client.post('/fhir/Encounter', json.dumps(orphan), content_type='application/fhir+json').status_code, 422)
        everything = self.client.get(f'/fhir/Encounter/{eid}/$everything').json()
        self.assertEqual(everything['resourceType'], 'Bundle')
        self.assertEqual({e['resource']['resourceType'] for e in everything['entry']}, {'Patient', 'Encounter', 'Observation'})
        self.assertEqual(fhir.validate(everything), [])
        self.assertEqual(self.client.get('/mock-mpi/fhir/Patient?identifier=NHI-1000002').json()['total'] >= 1, True)

    def test_csv_cells_are_formula_safe(self):
        self.assertEqual(service.safe_cell('=HYPERLINK("x")'), '\'=HYPERLINK("x")')

    def test_invalid_vitals_rejected(self):
        pid = self.post('/api/cran/lookup/', {'identifier': 'NHI-1000001'}).json()['patient']['id']
        response = self.post('/api/cran/arrivals/', {'patient_id': pid, 'complaint': 'x', 'vitals': {**NORMAL, 'spo2': 140}})
        self.assertEqual(response.status_code, 400)
