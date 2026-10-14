from io import StringIO
from unittest.mock import patch

import httpx
from django.core.management import call_command
from django.test import SimpleTestCase, override_settings


@override_settings(SUPABASE_URL='https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY='test-key')
class DemoSeedTests(SimpleTestCase):
    def test_creates_ten_fictional_patients_with_automatic_references(self):
        login = httpx.Response(200, json={'access_token': 'user-token', 'user': {'id': 'user'}})
        with patch('getpass.getpass', return_value='not-a-real-password'), patch('httpx.post', return_value=login), patch('patients.management.commands.seed_demo_patients.staff_role', return_value='nurse'), patch('patients.management.commands.seed_demo_patients.request_supabase', side_effect=[[]] + ['visit-id'] * 10) as remote:
            call_command('seed_demo_patients', email='test@example.invalid', stdout=StringIO())
        writes = [call for call in remote.call_args_list if call.args[0] == 'POST']
        self.assertEqual(len(writes), 10)
        for call in writes:
            self.assertEqual(call.kwargs['body']['p_input']['patient_ref'], '')
            self.assertIn('Fictional test patient', call.kwargs['body']['p_input']['notes'])
            self.assertEqual(call.args[2], 'user-token')

    def test_rerun_skips_existing_seed_markers(self):
        login = httpx.Response(200, json={'access_token': 'user-token', 'user': {'id': 'user'}})
        fixtures = [{'notes': f'PatientFlow demo seed: {index:02d}. Fictional test patient.'} for index in range(1, 11)]
        with patch('getpass.getpass', return_value='not-a-real-password'), patch('httpx.post', return_value=login), patch('patients.management.commands.seed_demo_patients.staff_role', return_value='nurse'), patch('patients.management.commands.seed_demo_patients.request_supabase', return_value=fixtures) as remote:
            call_command('seed_demo_patients', email='test@example.invalid', stdout=StringIO())
        self.assertFalse(any(call.args[0] == 'POST' for call in remote.call_args_list))
