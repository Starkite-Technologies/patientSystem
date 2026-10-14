import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Embedded PostgreSQL verifies the schema/RPC/RLS. Supabase-specific publication
// and managed Auth/Realtime still require an integration check on the project.
const database = new PGlite();
try {
  await database.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;
  `);
  const migration = await readFile(new URL('../supabase/migrations/202610130001_initial.sql', import.meta.url), 'utf8');
  await database.exec(migration.replace('alter publication supabase_realtime add table public.visits, public.resources;', ''));
  await database.exec(await readFile(new URL('../supabase/tests/name_migration_fixtures.sql', import.meta.url), 'utf8'));
  const normalization = await readFile(new URL('../supabase/migrations/202610140001_normalize_names.sql', import.meta.url), 'utf8');
  await database.exec(normalization.replace('alter publication supabase_realtime add table public.patients;', ''));
  await database.exec(await readFile(new URL('../supabase/migrations/202610140002_nurse_surgeon_roles.sql', import.meta.url), 'utf8'));
  await database.exec(await readFile(new URL('../supabase/migrations/202610140003_nurse_coordination.sql', import.meta.url), 'utf8'));
  await database.exec(await readFile(new URL('../supabase/migrations/202610140004_patient_date_of_birth.sql', import.meta.url), 'utf8'));
  await database.exec(await readFile(new URL('../supabase/migrations/202610140005_auto_patient_references.sql', import.meta.url), 'utf8'));
  await database.exec(await readFile(new URL('../supabase/tests/normalization.sql', import.meta.url), 'utf8'));
  await database.exec(await readFile(new URL('../supabase/tests/workflow.sql', import.meta.url), 'utf8'));
  await database.exec(await readFile(new URL('../supabase/tests/clinical_roles.sql', import.meta.url), 'utf8'));
  await database.exec(await readFile(new URL('../supabase/tests/date_of_birth.sql', import.meta.url), 'utf8'));
  await database.exec(await readFile(new URL('../supabase/tests/auto_references.sql', import.meta.url), 'utf8'));
  console.log('Database checks passed: name migration, patient normalization, RLS, roles, audit, version checks, discharge, and resource conflicts.');
} finally {
  await database.close();
}
