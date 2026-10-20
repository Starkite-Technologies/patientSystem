import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite(),read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');
try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`);
 const {readdir}=await import('node:fs/promises');
 for(const name of (await readdir(new URL('../supabase/migrations',import.meta.url))).filter(n=>n.endsWith('.sql')&&n<'202610200001').sort()){
  await db.exec((await read('supabase/migrations/'+name)).replace(/^alter publication supabase_realtime add table .*;$/gm,''));
  if(name==='202610130001_initial.sql')await db.exec(await read('supabase/tests/name_migration_fixtures.sql'));
  if(name==='202610140007_necms_resource_audit_integrity.sql'){await db.exec(await read('supabase/tests/hospital_isolation.sql'));await db.exec(await read('supabase/tests/resource_audit_integrity.sql'));await db.exec('reset role');}
  if(name==='202610150001_necms_arrival_triage_foundations.sql'){await db.exec(await read('supabase/tests/arrival_triage.sql'));await db.exec('reset role');}
 }
 await db.exec(await read('supabase/tests/coordination.sql'));await db.exec('reset role');
 const tables=(await db.query("select schemaname,tablename from pg_tables where schemaname in ('public','auth','necms_private') order by 1,2")).rows;
 const snapshot=async()=>{const out={};for(const t of tables)out[t.schemaname+'.'+t.tablename]=(await db.query(`select to_jsonb(t) as data from "${t.schemaname}"."${t.tablename}" t order by to_jsonb(t)::text`)).rows;return out;};
 const before=await snapshot(),migration=await read('supabase/migrations/202610200001_necms_presentation_summaries.sql');
 const definition=async()=>(await db.query("select pg_get_functiondef('public.necms_read_page(text,jsonb,uuid,integer)'::regprocedure) as body")).rows[0].body;
 const originalDefinition=await definition();
 await db.exec('begin');await db.exec(migration.replace(/^begin;$/m,'').replace(/^commit;$/m,''));assert.deepEqual(await snapshot(),before);await db.exec('rollback');assert.deepEqual(await snapshot(),before);
 assert.equal(await definition(),originalDefinition);
 await db.exec(migration);assert.deepEqual(await snapshot(),before);
 assert.ok((await definition()).includes('underway_services'));
 await db.exec(await read('supabase/tests/presentation_security.sql'));
 const tests=await read('supabase/tests/presentation_security.sql');console.log(`3E database: ${tests.match(/pg_temp.assert_true\(/g).length} assertions, ${tests.match(/pg_temp.expect_error\(/g).length} negative probes passed; ${tables.length}-table preservation and DDL rollback passed. Embedded Auth stub, not hosted REST.`);
}catch(e){console.error('3E database failure:',e.code,e.message,e.where??'');process.exitCode=1;}finally{await db.close();}
