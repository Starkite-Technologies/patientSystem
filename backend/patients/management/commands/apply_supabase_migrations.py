import hashlib
import os
import re
from pathlib import Path

import psycopg
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError


def migration_body(sql):
    # Files contain an outer transaction; the runner owns it so history and SQL
    # commit together. Function bodies retain their own BEGIN/END blocks.
    sql, begins = re.subn(r'^begin;\s*$', '', sql, count=1, flags=re.MULTILINE | re.IGNORECASE)
    sql, commits = re.subn(r'^commit;\s*$', '', sql, count=1, flags=re.MULTILINE | re.IGNORECASE)
    if begins != 1 or commits != 1:
        raise CommandError('A migration does not have the expected outer transaction.')
    return sql


class Command(BaseCommand):
    help = 'Apply tracked Supabase SQL migrations using the private DATABASE_URL.'

    def handle(self, *args, **options):
        database_url = os.getenv('DATABASE_URL', '').strip()
        if not database_url:
            raise CommandError('Add DATABASE_URL to the ignored .env. The publishable key cannot run migrations.')
        migrations = sorted((Path(settings.ROOT_DIR) / 'supabase' / 'migrations').glob('*.sql'))
        try:
            connection = psycopg.connect(database_url, sslmode='require', connect_timeout=10, autocommit=True)
        except psycopg.Error:
            raise CommandError('Could not connect to PostgreSQL. Check DATABASE_URL and network access; credentials were not printed.') from None
        try:
            with connection:
                # Session lock serializes migration runners across connections.
                connection.execute('select pg_advisory_lock(734291806)')
                with connection.transaction():
                    history_exists = connection.execute("select to_regclass('public._patientflow_migrations')").fetchone()[0]
                    tables_exist = connection.execute("select to_regclass('public.staff_profiles')").fetchone()[0]
                    if tables_exist and not history_exists:
                        raise CommandError('PatientFlow tables already exist without migration history. Inspect manually applied migrations before using this runner; nothing was reapplied.')
                    connection.execute('''create table if not exists public._patientflow_migrations (
                        name text primary key, checksum text not null,
                        applied_at timestamptz not null default now()
                    )''')
                    connection.execute('alter table public._patientflow_migrations enable row level security')
                    connection.execute('revoke all on public._patientflow_migrations from public, anon, authenticated')
                for path in migrations:
                    sql = path.read_text(encoding='utf-8')
                    checksum = hashlib.sha256(sql.encode('utf-8')).hexdigest()
                    recorded = connection.execute('select checksum from public._patientflow_migrations where name=%s', (path.name,)).fetchone()
                    if recorded:
                        if recorded[0] != checksum:
                            raise CommandError(f'{path.name} differs from its applied version. Restore it or add a new migration.')
                        self.stdout.write(f'Already applied: {path.name}')
                        continue
                    with connection.transaction():
                        connection.execute(migration_body(sql), prepare=False)
                        connection.execute('insert into public._patientflow_migrations(name, checksum) values (%s,%s)', (path.name, checksum))
                    self.stdout.write(self.style.SUCCESS(f'Applied: {path.name}'))
        except psycopg.Error as error:
            raise CommandError(f'Migration failed (SQLSTATE {error.sqlstate or "unknown"}). The current migration was rolled back; previous successes remain recorded. Credentials were not printed.') from None
        self.stdout.write(self.style.SUCCESS('Supabase migrations are up to date.'))
