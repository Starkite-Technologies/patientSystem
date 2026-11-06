from io import StringIO
from unittest.mock import MagicMock, patch

import httpx
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import SimpleTestCase, override_settings

MARKER = 'PILOT-FICTIONAL-20261026'


def reply(body=None, status=200, content=None, headers=None):
    return httpx.Response(status, json=body if content is None else None, content=content, headers=headers,
                          request=httpx.Request('GET', 'http://127.0.0.1:4173'))


@override_settings(NECMS_ENABLED=False, SUPABASE_URL='https://example.invalid', SUPABASE_PUBLISHABLE_KEY='synthetic')
class PilotSessionTests(SimpleTestCase):
    def run_check(self, replies, login_status=200):
        client = MagicMock()
        client.post.return_value = reply({'access_token': 'synthetic-token'}, login_status)
        client.get.side_effect = replies
        output = StringIO()
        with patch('patients.management.commands.check_pilot_session.getpass.getpass', return_value='synthetic-password'), \
                patch('patients.management.commands.check_pilot_session.httpx.Client') as factory, \
                patch('patients.management.commands.check_pilot_session.httpx.post') as logout:
            factory.return_value.__enter__.return_value = client
            call_command('check_pilot_session', email='staff@example.invalid', stdout=output)
        self.assertNotIn('synthetic-token', output.getvalue())
        self.assertNotIn('synthetic-password', output.getvalue())
        return output.getvalue(), client, logout

    def test_coordinator_export_requires_matching_new_audit(self):
        visit = {'status': 'waiting', 'complaint': MARKER}
        csv = f'Patient reference,Presenting complaint\r\nFICTIONAL-001,{MARKER}\r\n'.encode()
        output, client, logout = self.run_check([
            reply({'role': 'coordinator', 'visits': [visit], 'events': []}),
            reply(content=csv, headers={'content-type': 'text/csv'}),
            reply({'events': [{'id': 'new', 'action': 'exported', 'summary': 'Exported FICTIONAL-001'}]}),
        ])
        self.assertIn('Export and new Activity log event verified', output)
        self.assertEqual(client.get.call_args_list[1].kwargs['params']['q'], MARKER)
        self.assertEqual(logout.call_args.kwargs['params'], {'scope': 'local'})

    def test_unmarked_patients_are_not_exported(self):
        with self.assertRaisesMessage(CommandError, 'Register an active fictional patient'):
            self.run_check([reply({'role': 'coordinator', 'visits': [], 'events': []})])

    def test_non_coordinator_refusal_is_checked(self):
        output, _, _ = self.run_check([reply({'role': 'surgeon'}), reply({}, 403)])
        self.assertIn('correctly refused', output)

    def test_failed_login_stops_before_board_or_export(self):
        with self.assertRaisesMessage(CommandError, 'Staff sign-in failed'):
            self.run_check([], login_status=400)

    def test_missing_export_audit_fails_acceptance(self):
        csv = f'Patient reference,Presenting complaint\r\nFICTIONAL-001,{MARKER}\r\n'.encode()
        with self.assertRaisesMessage(CommandError, 'matching new Activity log event'):
            self.run_check([
                reply({'role': 'coordinator', 'visits': [{'status': 'waiting', 'complaint': MARKER}], 'events': []}),
                reply(content=csv, headers={'content-type': 'text/csv'}), reply({'events': []}),
            ])
