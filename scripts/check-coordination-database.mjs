import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
const db=new PGlite();
const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');
try {
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`);
 for(const migration of ['202610130001_initial','202610140001_normalize_names','202610140002_nurse_surgeon_roles','202610140003_nurse_coordination','202610140004_patient_date_of_birth','202610140005_auto_patient_references','202610140006_necms_hospital_isolation','202610140007_necms_resource_audit_integrity']) {
  await db.exec((await read(`supabase/migrations/${migration}.sql`)).replace(/^alter publication supabase_realtime add table .*;$/gm,''));
  if(migration==='202610130001_initial')await db.exec(await read('supabase/tests/name_migration_fixtures.sql'));
 }
 await db.exec(await read('supabase/tests/hospital_isolation.sql'));await db.exec(await read('supabase/tests/resource_audit_integrity.sql'));
 await db.exec(await read('supabase/migrations/202610150001_necms_arrival_triage_foundations.sql'));await db.exec(await read('supabase/tests/arrival_triage.sql'));await db.exec('reset role');
 const tables=['patients','visits','resources','audit_events','patient_name_migration_archive','patient_age_migration_archive','emergency_arrivals','identity_reconciliations','triage_assessments','vital_observations','triage_reviews','triage_protocol_versions'];
 const snapshot=async()=>{const out={};for(const table of tables)out[table]=(await db.query(`select to_jsonb(t) as data from public.${table} t order by to_jsonb(t)::text`)).rows;return out;};
 const before=await snapshot(),migration=await read('supabase/migrations/202610150002_necms_coordination.sql');
 await db.exec('begin');await db.exec(migration.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,''));await db.exec('rollback');
 assert.equal((await db.query("select to_regclass('public.coordination_work_items') as value")).rows[0].value,null);assert.deepEqual(await snapshot(),before);
 await db.exec(migration);assert.deepEqual(await snapshot(),before);
 assert.equal((await db.query("select count(*)::integer as n from public.role_capabilities where capability in ('queue.read','queue.coordinate','patient.call','service.accept','treatment.record','work.create','work.assign','work.complete','reassessment.request','escalation.acknowledge','exception.review','coordination.configure')")).rows[0].n,0);
 const fixture=await read('supabase/tests/coordination.sql');await db.exec(fixture);
 console.log(`Coordination SQL checks passed: ${(fixture.match(/select pg_temp.assert_true\(/g)||[]).length} named assertions, ${(fixture.match(/select pg_temp.expect_error\(/g)||[]).length} negative probes; 12-table preservation, rollback and no automatic grants. Embedded single engine; real multi-connection/Auth/REST remain unverified.`);
}catch(error){console.error('Coordination SQL checks failed:',error.code??'',error.message,error.where??'');process.exitCode=1;}finally{await db.close();}
