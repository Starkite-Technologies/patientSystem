from unittest.mock import patch
import httpx

from django.test import SimpleTestCase, override_settings
from rest_framework.test import APIClient

from .exceptions import UpstreamUnavailable, WorkflowConflict
from .gateway import request_supabase, staff_role

USER_ID = '10000000-0000-0000-0000-000000000001'
VISIT_ID = '20000000-0000-0000-0000-000000000001'
INPUT = {
    'patient_ref': 'TEST-01', 'first_name': 'Fictional', 'last_name': 'Person', 'date_of_birth': '1996-05-20',
    'complaint': 'Test', 'priority': 3, 'status': 'waiting', 'next_action': 'assessment',
    'location': 'Waiting area', 'resource_id': None, 'assigned_to': '', 'notes': '',
}


@override_settings(SUPABASE_URL='https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY='test-publishable')
class ApiTests(SimpleTestCase):
    def setUp(self):
        self.client = APIClient()

    def login(self):
        self.client.credentials(HTTP_AUTHORIZATION='Bearer test-user-token')

    def test_health_does_not_require_authentication(self):
        result = self.client.get('/api/health/')
        self.assertEqual(result.status_code, 200)
        self.assertTrue(result.json()['supabase_configured'])

    def test_missing_authentication_is_rejected_without_upstream_calls(self):
        with patch('patients.authentication.request_supabase') as remote:
            result = self.client.get('/api/board/')
        self.assertEqual(result.status_code, 401)
        remote.assert_not_called()

    def test_verified_user_token_is_forwarded_and_snapshots_are_not_requested(self):
        self.login()
        with patch('patients.authentication.request_supabase', return_value={'id': USER_ID}) as auth, patch('patients.views.staff_role', return_value='viewer'), patch('patients.views.request_supabase', side_effect=[[], [], []]) as remote:
            result = self.client.get('/api/board/')
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()['role'], 'viewer')
        auth.assert_called_once_with('GET', '/auth/v1/user', 'test-user-token')
        self.assertEqual(result['Cache-Control'], 'no-store')
        self.assertTrue(all(call.args[2] == 'test-user-token' for call in remote.call_args_list))
        self.assertNotIn('before_record', remote.call_args_list[-1].kwargs['params']['select'])

    def test_viewer_cannot_write(self):
        self.login()
        with patch('patients.authentication.request_supabase', return_value={'id': USER_ID}), patch('patients.views.staff_role', return_value='viewer'), patch('patients.views.request_supabase') as remote:
            result = self.client.post('/api/visits/', {'input': INPUT}, format='json')
        self.assertEqual(result.status_code, 403)
        remote.assert_not_called()

    def test_clinician_can_register_with_server_validated_input(self):
        self.login()
        with patch('patients.authentication.request_supabase', return_value={'id': USER_ID}), patch('patients.views.staff_role', return_value='clinician'), patch('patients.views.request_supabase', return_value=VISIT_ID) as remote:
            result = self.client.post('/api/visits/', {'input': INPUT}, format='json')
        self.assertEqual(result.status_code, 201)
        self.assertEqual(result.json()['id'], VISIT_ID)
        self.assertEqual(remote.call_args.kwargs['body']['p_input'], INPUT)

    def test_new_registration_does_not_require_a_reference(self):
        self.login()
        values = {key: value for key, value in INPUT.items() if key != 'patient_ref'}
        with patch('patients.authentication.request_supabase', return_value={'id': USER_ID}), patch('patients.views.staff_role', return_value='nurse'), patch('patients.views.request_supabase', return_value=VISIT_ID) as remote:
            result = self.client.post('/api/visits/', {'input': values}, format='json')
            self.assertEqual(result.status_code, 201)
            self.assertEqual(remote.call_args.kwargs['body']['p_input']['patient_ref'], '')

    def test_nurse_and_surgeon_profiles_are_recognized(self):
        for role in ('nurse', 'surgeon'):
            with self.subTest(role=role), patch('patients.gateway.request_supabase', return_value=[{'role': role}]):
                self.assertEqual(staff_role('user-token', USER_ID), role)

    def test_nurse_and_surgeon_can_register_and_update_visits(self):
        self.login()
        for role in ('nurse', 'surgeon'):
            with self.subTest(role=role), patch('patients.authentication.request_supabase', return_value={'id': USER_ID}), patch('patients.views.staff_role', return_value=role), patch('patients.views.request_supabase', return_value=VISIT_ID) as remote:
                created = self.client.post('/api/visits/', {'input': INPUT}, format='json')
                updated = self.client.patch(f'/api/visits/{VISIT_ID}/', {'input': INPUT, 'version': 1, 'patient_version': 1}, format='json')
                self.assertEqual(created.status_code, 201)
                self.assertEqual(updated.status_code, 200)
                self.assertEqual(remote.call_count, 2)

    def test_surgeon_cannot_change_resource_availability(self):
        self.login()
        for role in ('surgeon',):
            with self.subTest(role=role), patch('patients.authentication.request_supabase', return_value={'id': USER_ID}), patch('patients.views.staff_role', return_value=role), patch('patients.views.request_supabase') as remote:
                result = self.client.patch(f'/api/resources/{VISIT_ID}/', {'state': 'available'}, format='json')
                self.assertEqual(result.status_code, 403)
                remote.assert_not_called()

    def test_invalid_priority_is_rejected_before_database_call(self):
        self.login()
        with patch('patients.authentication.request_supabase', return_value={'id': USER_ID}), patch('patients.views.staff_role', return_value='clinician'), patch('patients.views.request_supabase') as remote:
            result = self.client.post('/api/visits/', {'input': {**INPUT, 'priority': True}}, format='json')
        self.assertEqual(result.status_code, 400)
        remote.assert_not_called()

    def test_update_requires_version(self):
        self.login()
        with patch('patients.authentication.request_supabase', return_value={'id': USER_ID}), patch('patients.views.staff_role', return_value='clinician'), patch('patients.views.request_supabase') as remote:
            result = self.client.patch(f'/api/visits/{VISIT_ID}/', {'input': INPUT}, format='json')
        self.assertEqual(result.status_code, 400)
        remote.assert_not_called()

    def test_blank_last_name_is_rejected(self):
        self.login()
        with patch('patients.authentication.request_supabase', return_value={'id': USER_ID}), patch('patients.views.staff_role', return_value='clinician'), patch('patients.views.request_supabase') as remote:
            result = self.client.post('/api/visits/', {'input': {**INPUT, 'last_name': ' '}}, format='json')
        self.assertEqual(result.status_code, 400)
        remote.assert_not_called()

    def test_invalid_or_future_birth_dates_are_rejected(self):
        self.login()
        for birth_date in ('2001-02-29', '2999-01-01'):
            with self.subTest(date=birth_date), patch('patients.authentication.request_supabase', return_value={'id': USER_ID}), patch('patients.views.staff_role', return_value='nurse'), patch('patients.views.request_supabase') as remote:
                result = self.client.post('/api/visits/', {'input': {**INPUT, 'date_of_birth': birth_date}}, format='json')
                self.assertEqual(result.status_code, 400)
                remote.assert_not_called()

    def test_unknown_birth_date_is_allowed(self):
        self.login()
        with patch('patients.authentication.request_supabase', return_value={'id': USER_ID}), patch('patients.views.staff_role', return_value='nurse'), patch('patients.views.request_supabase', return_value=VISIT_ID) as remote:
            result = self.client.post('/api/visits/', {'input': {**INPUT, 'date_of_birth': None}}, format='json')
            self.assertEqual(result.status_code, 201)
            self.assertIsNone(remote.call_args.kwargs['body']['p_input']['date_of_birth'])

    def test_name_edits_require_patient_version(self):
        self.login()
        with patch('patients.authentication.request_supabase', return_value={'id': USER_ID}), patch('patients.views.staff_role', return_value='clinician'), patch('patients.views.request_supabase') as remote:
            result = self.client.patch(f'/api/visits/{VISIT_ID}/', {'input': INPUT, 'version': 1}, format='json')
        self.assertEqual(result.status_code, 400)
        remote.assert_not_called()

    def test_stale_update_returns_conflict(self):
        self.login()
        with patch('patients.authentication.request_supabase', return_value={'id': USER_ID}), patch('patients.views.staff_role', return_value='clinician'), patch('patients.views.request_supabase', side_effect=WorkflowConflict('Updated elsewhere')):
            result = self.client.patch(f'/api/visits/{VISIT_ID}/', {'input': INPUT, 'version': 1, 'patient_version': 1}, format='json')
        self.assertEqual(result.status_code, 409)

    def test_clinician_cannot_change_resource_state(self):
        self.login()
        with patch('patients.authentication.request_supabase', return_value={'id': USER_ID}), patch('patients.views.staff_role', return_value='clinician'), patch('patients.views.request_supabase') as remote:
            result = self.client.patch(f'/api/resources/{VISIT_ID}/', {'state': 'available'}, format='json')
        self.assertEqual(result.status_code, 403)
        remote.assert_not_called()

    def test_nurse_and_coordinator_can_change_resource_state(self):
        self.login()
        for role in ('nurse', 'coordinator'):
            with self.subTest(role=role), patch('patients.authentication.request_supabase', return_value={'id': USER_ID}), patch('patients.views.staff_role', return_value=role), patch('patients.views.request_supabase', return_value=None) as remote:
                result = self.client.patch(f'/api/resources/{VISIT_ID}/', {'state': 'cleaning'}, format='json')
                self.assertEqual(result.status_code, 200)
                self.assertEqual(remote.call_args.kwargs['body'], {'p_id': VISIT_ID, 'p_state': 'cleaning'})

    def test_network_error_fails_closed(self):
        self.login()
        with patch('httpx.request', side_effect=httpx.ConnectError('private network details')):
            result = self.client.get('/api/board/')
        self.assertEqual(result.status_code, 503)
        self.assertNotIn('private network', result.content.decode())

    def test_invalid_supabase_token_is_rejected(self):
        self.login()
        with patch('httpx.request', return_value=httpx.Response(401, json={'message': 'invalid'})):
            result = self.client.get('/api/board/')
        self.assertEqual(result.status_code, 401)

    def test_gateway_does_not_expose_unknown_database_errors(self):
        with patch('httpx.request', return_value=httpx.Response(500, json={'message': 'private database details'})):
            with self.assertRaises(UpstreamUnavailable) as exc:
                request_supabase('POST', '/rest/v1/rpc/save_visit', 'user-token', body={})
        self.assertNotIn('private database', str(exc.exception))

    def test_database_policy_is_applied_for_the_original_user(self):
        with patch('httpx.request', return_value=httpx.Response(200, json=[])) as remote:
            request_supabase('GET', '/rest/v1/visits', 'user-token')
        self.assertEqual(remote.call_args.kwargs['headers']['Authorization'], 'Bearer user-token')
        self.assertEqual(remote.call_args.kwargs['headers']['apikey'], 'test-publishable')
