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
 const timings=[];
 for(const [size,increment] of [[100,100],[1000,900],[5000,4000]]){
  await db.exec(`with added as (insert into public.patients(hospital_id,ownership_state,patient_ref,first_name,last_name) select 'a0000000-0000-0000-0000-000000000001','verified','SYN-BENCH-'||gen_random_uuid(),'Synthetic','Load' from generate_series(1,${increment}) returning id), encounters as(insert into public.visits(hospital_id,ownership_state,patient_id,complaint,priority,status,next_action,triage_state,urgency_source) select 'a0000000-0000-0000-0000-000000000001','verified',id,'Synthetic performance fixture',null,'waiting','assessment','not_yet_triaged','not_assessed' from added returning id) insert into public.coordination_work_items(hospital_id,encounter_id,service_id,kind,title,created_by) select 'a0000000-0000-0000-0000-000000000001',id,current_setting('coord.service')::uuid,'other','Synthetic load work','60000000-0000-0000-0000-000000000001' from encounters; analyze public.coordination_work_items; analyze public.audit_events;`);
  const samples=[];let payload;
  for(let n=0;n<4;n++){const start=performance.now();payload=(await db.query('select public.necms_coordination_board() as data')).rows[0].data;samples.push(Number((performance.now()-start).toFixed(2)));}
  timings.push({synthetic_added_encounters:size,actual_active_encounters:payload.visits.length,work_items:payload.work_items.length,payload_bytes:Buffer.byteLength(JSON.stringify(payload)),cold_ms:samples[0],warm_ms:samples.slice(1)});
 }
 const plan=(await db.query("explain (analyze,buffers,format json) select * from public.coordination_work_items where hospital_id='a0000000-0000-0000-0000-000000000001' and encounter_id=current_setting('coord.low')::uuid")).rows;
 const history=[];
 for(const n of [100,1000]){
  await db.exec(`insert into public.coordination_events(hospital_id,encounter_id,work_item_id,actor_id,event,occurred_at,resulting_state,resulting_version,request_id) select 'a0000000-0000-0000-0000-000000000001',current_setting('coord.low')::uuid,current_setting('coord.low_work')::uuid,'60000000-0000-0000-0000-000000000001','synthetic_benchmark',statement_timestamp(),'underway',2,gen_random_uuid() from generate_series(1,${n===100?100:900});`);
  const start=performance.now();const payload=(await db.query("select public.necms_coordination_history(current_setting('coord.low')::uuid) as data")).rows[0].data;
  history.push({added_events:n,returned_events:payload.length,ms:Number((performance.now()-start).toFixed(2)),bytes:Buffer.byteLength(JSON.stringify(payload))});
 }
 console.log(JSON.stringify({engine:'PGlite single engine, synthetic only, no network/API throughput claim',board:timings,history,work_lookup_plan:plan},null,2));
}catch(error){console.error('3C readiness checks failed:',error.code??'',error.message,error.where??'');process.exitCode=1;}finally{await db.close();}
