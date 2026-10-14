import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';

// No connection string, network client, real Auth identity or persisted database.
const database = new PGlite();
try {
  await database.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as
    $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`);
  const names = ['202610130001_initial', '202610140001_normalize_names', '202610140002_nurse_surgeon_roles',
    '202610140003_nurse_coordination', '202610140004_patient_date_of_birth', '202610140005_auto_patient_references'];
  for (const name of names) {
    let sql = await readFile(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), 'utf8');
    sql = sql.replace(/^alter publication supabase_realtime add table .*;$/gm, '');
    await database.exec(sql);
    if (name === names[0]) await database.exec(await readFile(new URL('../supabase/tests/name_migration_fixtures.sql', import.meta.url), 'utf8'));
  }
  const original = (await database.query(`select id,patient_ref,first_name,last_name,date_of_birth from public.patients order by id`)).rows;
  const audit = (await database.query(`select id,created_at,before_record,after_record from public.audit_events order by id`)).rows;
  const proposed = await readFile(new URL('../supabase/migrations/202610140006_necms_hospital_isolation.sql', import.meta.url), 'utf8');
  const auditFix = await readFile(new URL('../supabase/migrations/202610140007_necms_resource_audit_integrity.sql', import.meta.url), 'utf8');
  await database.exec('begin;');
  await database.exec(proposed.replace(/^begin;\s*$/m, '').replace(/^commit;\s*$/m, ''));
  await database.exec(auditFix.replace(/^begin;\s*$/m, '').replace(/^commit;\s*$/m, ''));
  await database.exec('rollback;');
  assert.equal((await database.query("select to_regclass('public.hospitals') as name")).rows[0].name, null);
  assert.deepEqual((await database.query(`select id,patient_ref,first_name,last_name,date_of_birth from public.patients order by id`)).rows, original);
  await database.exec(proposed);
  await database.exec(auditFix);
  assert.deepEqual((await database.query(`select id,patient_ref,first_name,last_name,date_of_birth from public.patients order by id`)).rows, original);
  assert.deepEqual((await database.query(`select id,created_at,before_record,after_record from public.audit_events order by id`)).rows, audit);
  assert.equal((await database.query(`select count(*)::integer as n from public.patients where hospital_id is not null`)).rows[0].n, 0);
  await database.exec(await readFile(new URL('../supabase/tests/hospital_isolation.sql', import.meta.url), 'utf8'));
  await database.exec(await readFile(new URL('../supabase/tests/resource_audit_integrity.sql', import.meta.url), 'utf8'));
  console.log('Hospital database checks passed: preservation/rollback, isolation, revocation, stale versions, resource conflicts and retries; missing profiles rejected, attributed audit recorded, and audit-sink failure rolls back resource mutation. Mock Auth/PGlite only; hosted REST/Realtime and real parallel connections remain untested.');
} catch (error) {
  console.error('Hospital database checks failed:', error.code ?? '', error.message, error.where ?? '');
  process.exitCode = 1;
} finally { await database.close(); }
