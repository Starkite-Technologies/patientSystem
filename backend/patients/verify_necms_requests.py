"""Explicit 2C review checks. Known regressions fail; not part of baseline discovery.

Run: manage.py test patients.verify_necms_requests
All authentication/upstream behavior is mocked. No hosted calls or credentials.
"""
from unittest.mock import patch
from django.test import SimpleTestCase, override_settings
from rest_framework.test import APIClient
from rest_framework.exceptions import AuthenticationFailed
from .exceptions import UpstreamUnavailable

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
