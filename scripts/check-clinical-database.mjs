import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
// Disposable embedded PostgreSQL only; no network client or connection string.
const db = new PGlite();
const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
try {
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`);
  const migrations = ['202610130001_initial','202610140001_normalize_names','202610140002_nurse_surgeon_roles','202610140003_nurse_coordination','202610140004_patient_date_of_birth','202610140005_auto_patient_references','202610140006_necms_hospital_isolation','202610140007_necms_resource_audit_integrity'];
  for (const migration of migrations) {
    await db.exec((await read(`supabase/migrations/${migration}.sql`)).replace(/^alter publication supabase_realtime add table .*;$/gm,''));
    if (migration===migrations[0]) await db.exec(await read('supabase/tests/name_migration_fixtures.sql'));
  }
  await db.exec(await read('supabase/tests/hospital_isolation.sql'));
  await db.exec(await read('supabase/tests/resource_audit_integrity.sql'));
  await db.exec('reset role');
  const snapshot = async () => (await db.query(`select jsonb_build_object('patients',(select jsonb_agg(to_jsonb(p)-'identity_status'-'temporary_identifier' order by id) from public.patients p),'visits',(select jsonb_agg(to_jsonb(v)-'triage_state'-'clinical_urgency'-'urgency_source'-'latest_assessment_at' order by id) from public.visits v),'audit',(select jsonb_agg(a order by id) from public.audit_events a),'resources',(select jsonb_agg(r order by id) from public.resources r),'names',(select jsonb_agg(n) from public.patient_name_migration_archive n),'ages',(select jsonb_agg(a) from public.patient_age_migration_archive a)) as data`)).rows[0].data;
  const before = await snapshot();
  const migration = await read('supabase/migrations/202610150001_necms_arrival_triage_foundations.sql');
  await db.exec('begin');
  await db.exec(migration.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,''));
  await db.exec('rollback');
  assert.equal((await db.query("select to_regclass('public.emergency_arrivals') as value")).rows[0].value,null);
  assert.deepEqual(await snapshot(),before);
  await db.exec(migration);
  assert.deepEqual(await snapshot(),before);
  assert.equal((await db.query("select count(*)::integer as n from public.role_capabilities where capability in ('arrival.register','identity.reconcile','triage.read','triage.create','triage.review','triage.reassess','priority.amend','protocol.admin','protocol.approve','clinical.timeline.read')")).rows[0].n,0,'No automatic capability grants');
  const fixtures = await read('supabase/tests/arrival_triage.sql');
  await db.exec(fixtures);
  console.log(`Clinical database checks passed: ${(fixtures.match(/select pg_temp.assert_true\(/g)||[]).length} named assertions and ${(fixtures.match(/select pg_temp.expect_error\(/g)||[]).length} negative SQL probes; immutable history, synthetic arrival/assessment/review/reconciliation, isolation, revocation, retries, stale versions and rollback/preservation. Real parallel connections and hosted Auth/REST remain untested.`);
} catch(error) { console.error('Clinical database checks failed:',error.code??'',error.message,error.where??''); process.exitCode=1; }
finally { await db.close(); }
