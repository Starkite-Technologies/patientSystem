from pathlib import Path
from django.conf import settings
from django.core.management.base import CommandError
from django.test import SimpleTestCase
from django.core.management import call_command
from unittest.mock import patch

from .management.commands.apply_supabase_migrations import migration_body


class MigrationWrapperTests(SimpleTestCase):
    def test_necms_execution_is_blocked_before_connection_without_explicit_opt_in(self):
        with patch('patients.management.commands.apply_supabase_migrations.psycopg.connect') as connect:
            with self.assertRaisesMessage(CommandError, 'Prepared NECMS migrations are blocked'):
                call_command('apply_supabase_migrations')
        connect.assert_not_called()
    def test_all_project_migrations_can_be_wrapped_atomically(self):
        paths = list((Path(settings.ROOT_DIR) / 'supabase' / 'migrations').glob('*.sql'))
        self.assertTrue(paths)
        for path in paths:
            with self.subTest(migration=path.name):
                body = migration_body(path.read_text(encoding='utf-8'))
                self.assertIn('function', body)
                self.assertNotRegex(body, r'(?im)^commit;\s*$')

    def test_function_transaction_blocks_are_preserved(self):
        sql = 'begin;\ncreate function demo() returns void as $$\nbegin\n null;\nend $$ language plpgsql;\ncommit;\n'
        self.assertIn('$$\nbegin\n null;', migration_body(sql))

    def test_unexpected_outer_transactions_are_rejected(self):
        with self.assertRaises(CommandError):
            migration_body('select 1;')
