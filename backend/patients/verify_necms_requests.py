"""Explicit 2C/2D review and remediation checks, invoked in addition to baseline.

Run: manage.py test patients.verify_necms_requests
All authentication/upstream behavior is mocked. No hosted calls or credentials.
"""
from unittest.mock import patch
from django.test import SimpleTestCase, override_settings
from rest_framework.test import APIClient
from rest_framework.exceptions import AuthenticationFailed
from .exceptions import UpstreamUnavailable, WorkflowConflict

HOSPITAL = 'a0000000-0000-0000-0000-000000000001'
CONTEXT = '70000000-0000-0000-0000-000000000001'
USER = '60000000-0000-0000-0000-000000000001'


@override_settings(NECMS_ENABLED=True, DEBUG=False)
class RequestReviewTests(SimpleTestCase):
    def setUp(self):
        self.client = APIClient()
        self.client.raise_request_exception = False
        self.client.credentials(HTTP_AUTHORIZATION='Bearer synthetic-review-token', HTTP_X_NECMS_CONTEXT=CONTEXT)
        auth = patch('patients.authentication.request_supabase', return_value={'id': USER})
        auth.start()
        self.addCleanup(auth.stop)
        self.info = {'hospital_id': HOSPITAL, 'purpose': 'clinical',
                     'capabilities': ['encounter.read', 'membership.manage', 'hospital.configure']}

    def path(self, suffix):
        return f'/api/necms/hospitals/{HOSPITAL}/{suffix}/'

    def test_array_context_request_is_client_error(self):
        with patch('patients.necms_views.request_supabase') as rpc:
            response = self.client.post('/api/necms/contexts/', [], format='json')
        rpc.assert_not_called()
        self.assertEqual(response.status_code, 400, 'Malformed JSON must not produce a server exception')

    def test_array_staff_request_is_client_error(self):
        with patch('patients.necms_views.request_supabase', return_value=self.info) as rpc:
            response = self.client.post(self.path('staff'), [], format='json')
        self.assertEqual(rpc.call_count, 1, 'Only the permission check should run')
        self.assertEqual(response.status_code, 400)

    def test_array_configuration_request_is_client_error(self):
        with patch('patients.necms_views.request_supabase', return_value=self.info) as rpc:
            response = self.client.post(self.path('configuration'), [], format='json')
        self.assertEqual(rpc.call_count, 1)
        self.assertEqual(response.status_code, 400)

    def test_expired_authentication_stops_all_clinical_operations(self):
        with patch('patients.authentication.request_supabase', side_effect=AuthenticationFailed('Session expired.')), patch('patients.necms_views.request_supabase') as rpc:
            response = self.client.get(self.path('board'))
        self.assertEqual(response.status_code, 401)
        rpc.assert_not_called()

    def test_interruption_does_not_fall_back_to_global_access(self):
        with patch('patients.necms_views.request_supabase', side_effect=UpstreamUnavailable()) as rpc:
            response = self.client.get(self.path('board'))
        self.assertEqual(response.status_code, 503)
        self.assertEqual(rpc.call_count, 1)

    def test_recovery_revalidates_context(self):
        with patch('patients.necms_views.request_supabase', side_effect=[UpstreamUnavailable(), self.info, {'visits': []}]) as rpc:
            self.assertEqual(self.client.get(self.path('board')).status_code, 503)
            self.assertEqual(self.client.get(self.path('board')).status_code, 200)
        self.assertEqual(rpc.call_count, 3)

    def test_permission_change_is_not_cached_between_requests(self):
        with patch('patients.necms_views.request_supabase', side_effect=[self.info, {'visits': []}, {**self.info, 'capabilities': []}]) as rpc:
            self.assertEqual(self.client.get(self.path('board')).status_code, 200)
            self.assertEqual(self.client.get(self.path('board')).status_code, 403)
        self.assertEqual(rpc.call_count, 3)

    def test_other_non_object_body_types_are_rejected(self):
        for body in (None, True, 7, 'synthetic-sensitive-value'):
            for endpoint in ('/api/necms/contexts/', self.path('staff'), self.path('configuration')):
                with self.subTest(body_type=type(body).__name__, endpoint=endpoint), patch('patients.necms_views.request_supabase', return_value=self.info):
                    response = self.client.generic('POST', endpoint, __import__('json').dumps(body), content_type='application/json')
                self.assertEqual(response.status_code, 400)
                self.assertNotIn('Traceback', response.content.decode())

    def test_malformed_json_is_400(self):
        with patch('patients.necms_views.request_supabase') as rpc:
            response = self.client.generic('POST', '/api/necms/contexts/', '{broken', content_type='application/json')
        self.assertEqual(response.status_code, 400)
        rpc.assert_not_called()

    def test_unauthenticated_and_unauthorised_bodies_keep_401_and_403(self):
        self.client.credentials()
        with patch('patients.necms_views.request_supabase') as rpc:
            self.assertEqual(self.client.post('/api/necms/contexts/', [], format='json').status_code, 401)
        rpc.assert_not_called()
        self.client.credentials(HTTP_AUTHORIZATION='Bearer synthetic-review-token', HTTP_X_NECMS_CONTEXT=CONTEXT)
        with patch('patients.necms_views.request_supabase', return_value={**self.info, 'capabilities': []}) as rpc:
            self.assertEqual(self.client.post(self.path('staff'), [], format='json').status_code, 403)
        self.assertEqual(rpc.call_count, 1)

    def test_state_conflict_stays_409(self):
        with patch('patients.necms_views.request_supabase', side_effect=[{**self.info, 'capabilities': ['resource.coordinate']}, WorkflowConflict('Space is occupied.')]):
            response = self.client.patch(self.path('resources/a2000000-0000-0000-0000-000000000001'), {'state': 'cleaning'}, format='json')
        self.assertEqual(response.status_code, 409)

    def test_unexpected_internal_errors_are_not_converted_to_400(self):
        with patch('patients.necms_views.request_supabase', side_effect=RuntimeError('synthetic-internal-diagnostic')):
            response = self.client.post('/api/necms/contexts/', {'hospital_id': HOSPITAL}, format='json')
        self.assertEqual(response.status_code, 500)
        self.assertNotIn('synthetic-internal-diagnostic', response.content.decode())
        self.assertNotIn('Traceback', response.content.decode())

    def test_diagnostic_log_does_not_include_request_payload(self):
        with self.assertLogs('patients.necms_views', level='WARNING') as logs:
            response = self.client.post('/api/necms/contexts/', 'synthetic-sensitive-value', format='json')
        self.assertEqual(response.status_code, 400)
        self.assertNotIn('synthetic-sensitive-value', '\n'.join(logs.output))
