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

 await db.exec(migration);
 const beforeHardening=await snapshot();
 const hardening=await read('supabase/migrations/202610150003_necms_verification_hardening.sql');
 // Rehearse forward migration with populated 3B history, not only empty new tables.
 const allTables=(await db.query("select schemaname,tablename from pg_tables where schemaname in ('public','auth','necms_private') order by 1,2")).rows;
 const allSnapshot=async()=>{const out={};for(const t of allTables){const identifier=value=>'"'+value.replaceAll('"','""')+'"';out[t.schemaname+'.'+t.tablename]=(await db.query(`select to_jsonb(t) as data from ${identifier(t.schemaname)}.${identifier(t.tablename)} t order by to_jsonb(t)::text`)).rows;}return out;};
 await db.exec('begin');await db.exec(await read('supabase/tests/coordination.sql'));await db.exec('reset role');
 const populated=await allSnapshot();await db.exec(hardening.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,''));
 assert.deepEqual(await allSnapshot(),populated);await db.exec('rollback');
 console.log(`Populated 3B forward-recovery rehearsal preserved every row in ${allTables.length} tables, including coordination events and exceptions.`);

 await db.exec('begin');await db.exec(hardening.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,''));await db.exec('rollback');
 assert.equal((await db.query("select to_regclass('public.coordination_encounter') as value")).rows[0].value,null);
 assert.deepEqual(await snapshot(),beforeHardening);
 await db.exec(hardening);assert.deepEqual(await snapshot(),beforeHardening);
 const fixture=await read('supabase/tests/coordination.sql');await db.exec(fixture);
 await db.exec(`reset role;update public.hospital_memberships set active=true,authorization_version=authorization_version+1 where user_id='60000000-0000-0000-0000-000000000001';select pg_temp.act('60000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001');`);
 const indexes=(await db.query("select indexname from pg_indexes where schemaname='public' and indexname in ('coordination_encounter','exception_hospital_time','exception_annotation_history','audit_encounter_history','audit_patient_history')")).rows;
 assert.equal(indexes.length,5);
 const body=(await db.query("select pg_get_functiondef('public.necms_work_event(uuid,integer,text,uuid,jsonb)'::regprocedure) as body")).rows[0].body;
 assert.ok(body.includes('q.service_id=w.service_id'));assert.ok(body.includes('for share'));
 console.log('3C forward migration and transactional rollback/preservation passed; 3B 30 assertions and 22 negative probes passed against hardened function.');

 const original=await allSnapshot();const boundedMigration=await read('supabase/migrations/202610190001_necms_bounded_reads.sql');
 await db.exec('begin');await db.exec(boundedMigration.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,''));await db.exec('rollback');assert.equal((await db.query("select to_regclass('necms_private.read_cursors') as value")).rows[0].value,null);assert.deepEqual(await allSnapshot(),original);
 await db.exec(boundedMigration);
 const after=await allSnapshot();assert.deepEqual(after,original);
 await db.exec(await read('supabase/tests/bounded_reads.sql'));
 const tests=await read('supabase/tests/bounded_reads.sql');console.log(`3D SQL checks passed: ${(tests.match(/pg_temp.assert_true\(/g)||[]).length} assertions and ${(tests.match(/pg_temp.expect_error\(/g)||[]).length} negative probes; existing rows preserved and DDL rollback verified.`);
}catch(error){console.error('3D read checks failed:',error.code??'',error.message,error.where??'');process.exitCode=1;}finally{await db.close();}
