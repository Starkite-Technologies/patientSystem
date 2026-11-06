import csv
import io
import re
from unittest.mock import patch

from django.test import SimpleTestCase, override_settings
from rest_framework.test import APIClient

from .exceptions import UpstreamUnavailable
from .export_views import safe_cell

USER_ID = '10000000-0000-0000-0000-000000000001'


def visit(ref, priority, status='waiting', **extra):
    return {'id': f'20000000-0000-0000-0000-{ref[-6:].rjust(12, "0")}', 'patient_id': '30000000-0000-0000-0000-000000000001',
            'resource_id': None, 'patient_ref': ref, 'first_name': 'Fictional', 'last_name': 'Person', 'date_of_birth': '1990-06-15',
            'complaint': 'Test complaint', 'priority': priority, 'status': status, 'next_action': 'assessment',
            'location': 'Waiting area', 'assigned_to': 'Dr Test', 'notes': 'Private handover', 'version': 1, 'patient_version': 1,
            'arrived_at': '2026-10-26T08:00:00+00:00', 'updated_at': '2026-10-26T09:30:00+00:00', **extra}


@override_settings(SUPABASE_URL='https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY='test-publishable')
class ExportTests(SimpleTestCase):
    def setUp(self):
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION='Bearer test-user-token')

    def export(self, role, upstream, query='scope=board'):
        with patch('patients.authentication.request_supabase', return_value={'id': USER_ID}), \
                patch('patients.export_views.staff_role', return_value=role), \
                patch('patients.export_views.request_supabase', side_effect=upstream) as remote:
            return self.client.get(f'/api/export/?{query}'), remote

    def rows(self, result):
        text = result.content.decode('utf-8')
        self.assertTrue(text.startswith('﻿'))
        return list(csv.reader(io.StringIO(text[1:])))

    def test_only_coordinators_can_export(self):
        for role in ('viewer', 'clinician', 'nurse', 'surgeon'):
            result, remote = self.export(role, [])
            self.assertEqual(result.status_code, 403, role)
            remote.assert_not_called()

    def test_board_export_is_recorded_sorted_and_free_of_internal_ids(self):
        upstream = [[visit('PF-000003', 3), visit('PF-000001', 1, complaint='=HYPERLINK("x")')], 'event-id']
        result, remote = self.export('coordinator', upstream)
        self.assertEqual(result.status_code, 200)
        self.assertRegex(result['Content-Disposition'], r'attachment; filename="patientflow-visits-\d{4}-\d{2}-\d{2}\.csv"')
        self.assertEqual(result['X-PatientFlow-Rows'], '2')
        self.assertEqual(result['Cache-Control'], 'no-store')
        rows = self.rows(result)
        self.assertEqual(rows[0][0], 'Patient reference')
        self.assertEqual([r[0] for r in rows[1:]], ['PF-000001', 'PF-000003'])
        self.assertEqual(rows[1][5], 'P1 · Red – Immediate')
        self.assertEqual(rows[1][11], "'=HYPERLINK(\"x\")")
        body = result.content.decode('utf-8')
        self.assertIsNone(re.search(r'[0-9a-f]{8}-[0-9a-f]{4}-', body))
        self.assertNotIn('Private handover', body)
        audit = remote.call_args_list[-1]
        self.assertEqual(audit.args[:2], ('POST', '/rest/v1/rpc/record_export'))
        self.assertEqual(audit.kwargs['body']['p_patient_refs'], ['PF-000001', 'PF-000003'])
        self.assertEqual(audit.kwargs['body']['p_scope'], 'board')

    def test_no_file_without_audit_entry(self):
        result, _ = self.export('coordinator', [[visit('PF-000001', 1)], UpstreamUnavailable()])
        self.assertEqual(result.status_code, 503)
        self.assertNotIn('text/csv', result.get('Content-Type', ''))

    def test_filters_dates_and_search_are_applied(self):
        upstream = [[visit('PF-000001', 2, 'discharged', assigned_to='Dr Amupolo'), visit('PF-000002', 2, 'discharged')], 'event-id']
        result, remote = self.export('coordinator', upstream,
                                     'scope=completed&from=2026-10-01&to=2026-10-26&priority=2&status=discharged&action=assessment&q=amupolo')
        self.assertEqual(result.status_code, 200)
        self.assertIn('patientflow-completed-visits-', result['Content-Disposition'])
        params = remote.call_args_list[0].kwargs['params']
        self.assertIn(('status', 'in.(discharged)'), params)
        self.assertIn(('priority', 'eq.2'), params)
        self.assertIn(('next_action', 'eq.assessment'), params)
        self.assertIn(('arrived_at', 'gte.2026-10-01T00:00:00+02:00'), params)
        self.assertIn(('arrived_at', 'lt.2026-10-27T00:00:00+02:00'), params)
        self.assertEqual([r[0] for r in self.rows(result)[1:]], ['PF-000001'])
        self.assertEqual(remote.call_args_list[-1].kwargs['body']['p_filters']['q'], 'amupolo')

    def test_completed_time_in_ed_uses_last_update_and_has_no_overdue(self):
        result, _ = self.export('coordinator', [[visit('PF-000001', 5, 'transferred')], 'event-id'], 'scope=completed')
        row = self.rows(result)[1]
        self.assertEqual(row[13], '90')
        self.assertEqual(row[14], '')
        self.assertEqual(row[12], '2026-10-26 10:00')

    def test_invalid_queries_fetch_nothing(self):
        for query in ('scope=everything', 'scope=board&from=2026-10-26&to=2026-10-01', 'scope=completed&status=waiting', 'scope=board&priority=9'):
            result, remote = self.export('coordinator', [], query)
            self.assertEqual(result.status_code, 400, query)
            remote.assert_not_called()

    def test_large_exports_are_paged(self):
        first = [visit(f'PF-{i:06d}', 4) for i in range(1000)]
        result, remote = self.export('coordinator', [first, [visit('PF-001000', 4)], 'event-id'])
        self.assertEqual(result['X-PatientFlow-Rows'], '1001')
        self.assertIn(('offset', '1000'), remote.call_args_list[1].kwargs['params'])

    def test_formula_prefixes_and_line_breaks_are_escaped(self):
        for value in ('=1+1', '+1', '-1', '@SUM(A1)', '\t=1', '\r=1', '\n=1', '  =1', ' \t@SUM(A1)'):
            self.assertEqual(safe_cell(value), "'" + value)
        self.assertEqual(safe_cell('Fictional person'), 'Fictional person')

    def test_maximum_end_date_is_rejected_without_fetching(self):
        result, remote = self.export('coordinator', [], 'scope=board&to=9999-12-31')
        self.assertEqual(result.status_code, 400)
        remote.assert_not_called()

    def test_limit_allows_exactly_maximum_and_refuses_more_without_audit(self):
        with patch('patients.export_views.PAGE_SIZE', 2), patch('patients.export_views.MAX_ROWS', 4):
            page = [visit('PF-000001', 4), visit('PF-000002', 4)]
            result, remote = self.export('coordinator', [page, page, [], 'event-id'])
            self.assertEqual(result.status_code, 200)
            self.assertEqual(result['X-PatientFlow-Rows'], '4')
            result, remote = self.export('coordinator', [page, page, [visit('PF-000003', 4)]])
            self.assertEqual(result.status_code, 400)
            self.assertTrue(all(call.args[0] == 'GET' for call in remote.call_args_list))

    @override_settings(NECMS_ENABLED=True)
    def test_export_refused_in_hospital_mode(self):
        result, remote = self.export('coordinator', [])
        self.assertEqual(result.status_code, 403)
        remote.assert_not_called()

    def test_export_requires_a_session(self):
        self.client.credentials()
        result = self.client.get('/api/export/?scope=board')
        self.assertEqual(result.status_code, 401)
