import csv
import io
from unittest.mock import MagicMock, patch

import httpx
from django.test import SimpleTestCase, override_settings
from rest_framework.exceptions import PermissionDenied
from rest_framework.test import APIClient

from .exceptions import WorkflowConflict
from .gateway import request_supabase, staff_role

USER_ID = '10000000-0000-0000-0000-000000000001'
CASE_ID = '20000000-0000-0000-0000-000000000009'
BOOKING = {'location': 'Ward 3', 'proposed_operation': 'Emergency laparotomy', 'first_name': 'Fictional', 'last_name': 'Person',
           'priority_code': 'P3', 'specialty': 'General Surgery', 'responsible_consultant': 'Dr Test', 'diagnosis': 'Perforation',
           'indication': 'Peritonitis', 'delay_consequence': 'sepsis', 'estimated_minutes': 120, 'haemodynamically_unstable': False,
           'septic_shock': False, 'organ_support': False, 'anaesthetic_concern': False}


def theatre_row(ref, code, order, status='booked'):
    return {'booking_ref': ref, 'patient_ref': 'PF-000001', 'mrn': '', 'first_name': 'Fictional', 'last_name': 'Person',
            'date_of_birth': None, 'sex': 'unknown', 'specialty': 'Urology', 'responsible_consultant': 'Dr Test', 'booked_by_name': 'Test Registrar',
            'diagnosis': 'Retention', 'proposed_operation': '=cmd()', 'indication': 'Pain', 'priority_code': code, 'ncepod': 'urgent',
            'priority_label': 'Within 6 hours', 'priority_order': order, 'decision_at': '2026-10-31T08:00:00+00:00', 'booked_at': '2026-10-31T08:05:00+00:00',
            'deadline_at': '2026-10-31T14:00:00+00:00', 'status': status, 'ready_for_theatre': True, 'theatre_name': 'Theatre 01',
            'planned_start': None, 'anaesthesia_start_at': None, 'incision_at': None, 'completed_at': None, 'delay_category': None,
            'delay_note': '', 'cancelled_reason': '', 'id': CASE_ID, 'patient_id': USER_ID}


@override_settings(SUPABASE_URL='https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY='test-publishable', NECMS_ENABLED=False)
class TheatreApiTests(SimpleTestCase):
    def setUp(self):
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION='Bearer test-user-token')

    def call(self, method, path, data=None, upstream=None, role='surgeon'):
        with patch('patients.authentication.request_supabase', return_value={'id': USER_ID}), \
                patch('patients.theatre_views.staff_role', return_value=role), \
                patch('patients.theatre_views.request_supabase', side_effect=upstream or [None]) as remote:
            return getattr(self.client, method)(path, data, format='json'), remote

    def test_board_returns_list_codes_theatres_and_staff(self):
        result, remote = self.call('get', '/api/theatre/', upstream=[[{'code': 'P0'}], [{'booking_ref': 'TB-000001'}], [{'name': 'Theatre 01'}], [{'name': 'Dr Test'}]])
        self.assertEqual(result.status_code, 200)
        self.assertEqual(set(result.json()), {'role', 'codes', 'bookings', 'theatres', 'staff'})
        self.assertEqual(result['Cache-Control'], 'no-store')
        bookings_params = remote.call_args_list[1].kwargs['params']
        self.assertIn('status.in.(booked,anaesthesia,operating)', bookings_params['or'])
        self.assertTrue(all(call.args[2] == 'test-user-token' for call in remote.call_args_list))

    @override_settings(NECMS_ENABLED=True)
    def test_disabled_in_multi_hospital_mode(self):
        result, remote = self.call('get', '/api/theatre/')
        self.assertEqual(result.status_code, 403)
        remote.assert_not_called()

    def test_booking_is_forwarded_to_checked_function(self):
        result, remote = self.call('post', '/api/theatre/bookings/', {'input': BOOKING}, upstream=[CASE_ID], role='clinician')
        self.assertEqual(result.status_code, 201)
        self.assertEqual(remote.call_args.args[:2], ('POST', '/rest/v1/rpc/book_theatre_case'))
        sent = remote.call_args.kwargs['body']['p_input']
        self.assertEqual(sent['priority_code'], 'P3')
        self.assertFalse(sent['rapid'])

    def test_booking_without_patient_or_operation_is_refused_before_the_database(self):
        for data in ({'location': 'Ward', 'proposed_operation': 'X'}, {**BOOKING, 'proposed_operation': ' '}, {**BOOKING, 'priority_code': 'urgent'}):
            result, remote = self.call('post', '/api/theatre/bookings/', {'input': data})
            self.assertEqual(result.status_code, 400, data)
            remote.assert_not_called()

    def test_update_sends_only_the_fields_the_user_changed(self):
        result, remote = self.call('patch', f'/api/theatre/bookings/{CASE_ID}/', {'version': 3, 'input': {'ready_for_theatre': True}}, role='nurse')
        self.assertEqual(result.status_code, 200)
        self.assertEqual(remote.call_args.kwargs['body'], {'p_id': CASE_ID, 'p_version': 3, 'p_input': {'ready_for_theatre': True}})

    def test_priority_change_needs_a_reason(self):
        result, remote = self.call('post', f'/api/theatre/bookings/{CASE_ID}/priority/', {'version': 1, 'code': 'P1', 'reason': 'no'})
        self.assertEqual(result.status_code, 400)
        remote.assert_not_called()
        result, remote = self.call('post', f'/api/theatre/bookings/{CASE_ID}/priority/', {'version': 1, 'code': 'P1', 'reason': 'Septic shock'})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(remote.call_args.kwargs['body']['p_reason'], 'Septic shock')

    def test_times_and_cancel_are_validated(self):
        result, remote = self.call('post', f'/api/theatre/bookings/{CASE_ID}/times/', {'version': 1, 'event': 'started'})
        self.assertEqual(result.status_code, 400)
        result, remote = self.call('post', f'/api/theatre/bookings/{CASE_ID}/times/', {'version': 1, 'event': 'incision'})
        self.assertEqual(remote.call_args.kwargs['body']['p_at'], None)
        result, remote = self.call('post', f'/api/theatre/bookings/{CASE_ID}/cancel/', {'version': 1, 'reason': 'Transferred out', 'authorised_by': 'Dr Test'}, role='coordinator')
        self.assertEqual(result.status_code, 200)
        self.assertEqual(remote.call_args.kwargs['body']['p_authorised_by'], 'Dr Test')


@override_settings(SUPABASE_URL='https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY='test-publishable')
class TheatreGatewayTests(SimpleTestCase):
    def upstream(self, status, payload):
        result = MagicMock(spec=httpx.Response)
        result.status_code, result.content, result.is_error = status, b'x', status >= 400
        result.json.return_value = payload
        return patch('patients.gateway.httpx.request', return_value=result)

    def test_theatre_role_refusals_keep_their_wording(self):
        with self.upstream(403, {'code': '42501', 'message': 'Only a consultant surgeon or anaesthetist can change the priority.'}):
            with self.assertRaisesMessage(PermissionDenied, 'Only a consultant surgeon or anaesthetist can change the priority.'):
                request_supabase('POST', '/rest/v1/rpc/change_theatre_priority', 'token')
        with self.upstream(403, {'code': '42501', 'message': 'permission denied for table theatre_bookings'}):
            with self.assertRaisesMessage(PermissionDenied, 'Your staff account cannot perform this action.'):
                request_supabase('GET', '/rest/v1/theatre_board', 'token')

    def test_theatre_rules_and_busy_theatre_are_explained(self):
        with self.upstream(400, {'code': 'P0001', 'message': 'This case is past its deadline. Record the reason for delay.'}):
            with self.assertRaisesMessage(WorkflowConflict, 'Record the reason for delay.'):
                request_supabase('POST', '/rest/v1/rpc/update_theatre_case', 'token')
        with self.upstream(409, {'code': '23505', 'message': 'duplicate key value violates unique constraint "one_case_in_each_theatre"'}):
            with self.assertRaisesMessage(WorkflowConflict, 'This theatre already has a case in progress.'):
                request_supabase('POST', '/rest/v1/rpc/record_theatre_time', 'token')

    def test_anaesthetist_is_a_staff_role(self):
        with patch('patients.gateway.request_supabase', return_value=[{'role': 'anaesthetist'}]):
            self.assertEqual(staff_role('token', USER_ID), 'anaesthetist')


@override_settings(SUPABASE_URL='https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY='test-publishable', NECMS_ENABLED=False)
class TheatreExportTests(SimpleTestCase):
    def setUp(self):
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION='Bearer test-user-token')

    def export(self, role, upstream, query='scope=theatre'):
        with patch('patients.authentication.request_supabase', return_value={'id': USER_ID}), \
                patch('patients.export_views.staff_role', return_value=role), \
                patch('patients.export_views.request_supabase', side_effect=upstream) as remote:
            return self.client.get(f'/api/export/?{query}'), remote

    def test_surgeon_exports_open_theatre_list_with_booking_refs(self):
        result, remote = self.export('surgeon', [[theatre_row('TB-000002', 'P1', 1), theatre_row('TB-000001', 'P0', 0)], 'event'])
        self.assertEqual(result.status_code, 200)
        self.assertIn('patientflow-theatre-list-', result['Content-Disposition'])
        rows = list(csv.reader(io.StringIO(result.content.decode('utf-8')[1:])))
        self.assertEqual(rows[0][0], 'Booking reference')
        self.assertEqual(rows[1][11], "'=cmd()")
        self.assertIn(('status', 'in.(booked,anaesthesia,operating)'), remote.call_args_list[0].kwargs['params'])
        self.assertEqual(remote.call_args_list[-1].kwargs['body']['p_scope'], 'theatre')
        self.assertEqual(remote.call_args_list[-1].kwargs['body']['p_patient_refs'], ['TB-000002', 'TB-000001'])

    def test_theatre_dates_filter_decision_time_and_include_closed_cases(self):
        result, remote = self.export('anaesthetist', [[], 'event'], 'scope=theatre&from=2026-10-01&to=2026-10-31')
        params = remote.call_args_list[0].kwargs['params']
        self.assertIn(('decision_at', 'gte.2026-10-01T00:00:00+02:00'), params)
        self.assertFalse(any(key == 'status' for key, _ in params))

    def test_roles_and_ed_filters(self):
        for role, query in (('nurse', 'scope=theatre'), ('surgeon', 'scope=board'), ('clinician', 'scope=theatre')):
            result, remote = self.export(role, [], query)
            self.assertEqual(result.status_code, 403, (role, query))
            remote.assert_not_called()
        result, remote = self.export('coordinator', [], 'scope=theatre&priority=2')
        self.assertEqual(result.status_code, 400)
