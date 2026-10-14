from unittest.mock import patch
from django.test import SimpleTestCase, override_settings
from rest_framework.test import APIClient
from .tests import INPUT, USER_ID, VISIT_ID

HOSPITAL = 'a0000000-0000-0000-0000-000000000001'
OTHER = 'b0000000-0000-0000-0000-000000000001'
CONTEXT = '70000000-0000-0000-0000-000000000001'


@override_settings(NECMS_ENABLED=True)
class HospitalApiTests(SimpleTestCase):
    def setUp(self):
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION='Bearer synthetic-token', HTTP_X_NECMS_CONTEXT=CONTEXT)
        self.auth = patch('patients.authentication.request_supabase', return_value={'id': USER_ID})
        self.auth.start()
        self.addCleanup(self.auth.stop)

    def info(self, capabilities=None, purpose='clinical'):
        return {'hospital_id': HOSPITAL, 'purpose': purpose, 'capabilities': capabilities or ['encounter.read']}

    def path(self, suffix, hospital=HOSPITAL):
        return f'/api/necms/hospitals/{hospital}/{suffix}/'

    def test_context_header_is_forwarded_with_user_token(self):
        with patch('patients.necms_views.request_supabase', side_effect=[self.info(), {'visits': []}]) as remote:
            result = self.client.get(self.path('board'))
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result['Cache-Control'], 'no-store')
        self.assertTrue(all(c.args[2] == 'synthetic-token' and c.kwargs['context'] == CONTEXT for c in remote.call_args_list))

    def test_missing_or_forged_context_does_not_fetch_clinical_data(self):
        for value in ('', 'forged-hospital-id'):
            self.client.credentials(HTTP_AUTHORIZATION='Bearer synthetic-token', HTTP_X_NECMS_CONTEXT=value)
            with patch('patients.necms_views.request_supabase') as remote:
                self.assertEqual(self.client.get(self.path('board')).status_code, 403)
            remote.assert_not_called()

    def test_route_hospital_cannot_override_context(self):
        with patch('patients.necms_views.request_supabase', return_value=self.info()) as remote:
            self.assertEqual(self.client.get(self.path('board', OTHER)).status_code, 403)
        self.assertEqual(remote.call_count, 1)

    def test_display_token_cannot_read_clinical_board(self):
        with patch('patients.necms_views.request_supabase', return_value=self.info(['display.read'], 'display')) as remote:
            self.assertEqual(self.client.get(self.path('board')).status_code, 403)
        self.assertEqual(remote.call_count, 1)

    def test_display_uses_checked_projection_not_clinical_select(self):
        projection = [{'display_label': 'ED-synthetic', 'status': 'waiting', 'next_action': 'assessment', 'space_state': 'Unassigned'}]
        with patch('patients.necms_views.request_supabase', side_effect=[self.info(['display.read'], 'display'), projection]) as remote:
            result = self.client.get(self.path('display-board'))
        self.assertEqual(result.json(), projection)
        self.assertEqual(remote.call_args.args[1], '/rest/v1/rpc/necms_display_board')

    def test_registration_retains_versioned_scoped_rpc(self):
        with patch('patients.necms_views.request_supabase', side_effect=[self.info(['encounter.register']), VISIT_ID]) as remote:
            result = self.client.post(self.path('visits'), {'input': INPUT}, format='json')
        self.assertEqual(result.status_code, 201)
        self.assertEqual(remote.call_args.kwargs['body']['p_input'], INPUT)
        self.assertEqual(remote.call_args.kwargs['context'], CONTEXT)

    def test_browser_cannot_submit_record_ownership(self):
        with patch('patients.necms_views.request_supabase', return_value=self.info(['encounter.register'])) as remote:
            result = self.client.post(self.path('visits'), {'input': {**INPUT, 'hospital_id': OTHER}}, format='json')
        self.assertEqual(result.status_code, 400)
        self.assertEqual(remote.call_count, 1)

    def test_revoked_membership_denial_stops_operation(self):
        from rest_framework.exceptions import PermissionDenied
        with patch('patients.necms_views.request_supabase', side_effect=PermissionDenied('Membership revoked.')) as remote:
            self.assertEqual(self.client.get(self.path('board')).status_code, 403)
        self.assertEqual(remote.call_count, 1)

    def test_staff_management_requires_its_own_capability(self):
        with patch('patients.necms_views.request_supabase', return_value=self.info()) as remote:
            self.assertEqual(self.client.get(self.path('staff')).status_code, 403)
        self.assertEqual(remote.call_count, 1)

    def test_legacy_route_is_closed_in_necms_mode(self):
        with patch('patients.views.request_supabase') as remote:
            self.assertEqual(self.client.get('/api/board/').status_code, 403)
        remote.assert_not_called()

    def test_context_issuance_does_not_accept_client_roles(self):
        with patch('patients.necms_views.request_supabase', return_value={'id': CONTEXT}) as remote:
            result = self.client.post('/api/necms/contexts/', {'hospital_id': HOSPITAL, 'role': 'administrator'}, format='json')
        self.assertEqual(result.status_code, 201)
        self.assertEqual(remote.call_args.kwargs['body'], {'p_hospital': HOSPITAL, 'p_purpose': 'clinical'})

    @override_settings(NECMS_ENABLED=False)
    def test_unapproved_mode_is_disabled(self):
        with patch('patients.necms_views.request_supabase') as remote:
            self.assertEqual(self.client.get(self.path('board')).status_code, 403)
        remote.assert_not_called()
