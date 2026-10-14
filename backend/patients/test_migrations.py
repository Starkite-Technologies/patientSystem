from pathlib import Path
from django.conf import settings
from django.core.management.base import CommandError
from django.test import SimpleTestCase

from .management.commands.apply_supabase_migrations import migration_body


class MigrationWrapperTests(SimpleTestCase):
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
