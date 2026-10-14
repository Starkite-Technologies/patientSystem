import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';

// Verification probes only. No connection string or hosted API client.
const db = new PGlite();
const findings = [];
const baseline = new Map();
const preservedTables = ['patients','visits','resources','audit_events','patient_name_migration_archive','patient_age_migration_archive'];
try {
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
    create publication supabase_realtime;`);
  for (const name of ['202610130001_initial','202610140001_normalize_names','202610140002_nurse_surgeon_roles','202610140003_nurse_coordination','202610140004_patient_date_of_birth','202610140005_auto_patient_references','202610140006_necms_hospital_isolation']) {
    let sql = await readFile(new URL(`../supabase/migrations/${name}.sql`,import.meta.url),'utf8');
    if (name==='202610140006_necms_hospital_isolation') {
      assert.equal((await db.query("select count(*)::integer as n from pg_publication_tables where pubname='supabase_realtime'")).rows[0].n,3);
      for (const table of preservedTables) {
        baseline.set(table,(await db.query(`select to_jsonb(t) as data from public.${table} t order by to_jsonb(t)::text`)).rows.map(row=>row.data));
      }
    }
    await db.exec(sql);
    if (name==='202610130001_initial') {
      await db.exec(await readFile(new URL('../supabase/tests/name_migration_fixtures.sql',import.meta.url),'utf8'));
      await db.exec("insert into public.resources(id,name,kind) values('c2000000-0000-0000-0000-000000000001','Synthetic legacy resource','Test')");
    }
  }
  for (const table of preservedTables) {
    assert.ok(baseline.get(table).length > 0, `Preservation fixture is empty for ${table}`);
    const after=(await db.query(`select to_jsonb(t)-'hospital_id'-'ownership_state'-'department_id' as data from public.${table} t`)).rows.map(row=>row.data);
    const canonical = rows => rows.map(row=>JSON.stringify(Object.fromEntries(Object.entries(row).sort(([a],[b])=>a.localeCompare(b))))).sort();
    assert.deepEqual(canonical(after),canonical(baseline.get(table)),`Historical columns changed in ${table}`);
  }
  findings.push({ check:'all_original_record_columns_and_archives_preserved',result:'PASS',tables:preservedTables.length });
  assert.equal((await db.query("select count(*)::integer as n from pg_publication_tables where pubname='supabase_realtime'")).rows[0].n,0);
  findings.push({ check:'clinical_publication_tables_removed',result:'PASS',before:3,after:0 });
  await db.exec(await readFile(new URL('../supabase/tests/hospital_isolation.sql',import.meta.url),'utf8'));
  await db.exec(`reset role;
    update public.hospital_memberships set valid_until=null,active=true,authorization_version=authorization_version+1 where user_id='60000000-0000-0000-0000-000000000004';
    insert into public.resources(id,hospital_id,ownership_state,name,kind) values('a2000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001','verified','Synthetic audit review space','Test');
    set role authenticated;
    select set_config('request.jwt.claim.sub','60000000-0000-0000-0000-000000000004',false);
    select set_config('request.headers',jsonb_build_object('x-necms-context',public.necms_create_context('a0000000-0000-0000-0000-000000000001')->>'id')::text,false);`);
  const before = (await db.query("select count(*)::integer as n from public.audit_events where action='resource_updated'")).rows[0].n;
  await db.query("select public.set_resource_state('a2000000-0000-0000-0000-000000000002','cleaning')");
  const after = (await db.query("select count(*)::integer as n from public.audit_events where action='resource_updated'")).rows[0].n;
  const state = (await db.query("select state from public.resources where id='a2000000-0000-0000-0000-000000000002'")).rows[0].state;
  try { assert.equal(after-before,1,'Every permitted resource change must create an audit event, including members without a global profile');
    findings.push({ check:'resource_audit_completeness',result:'PASS' });
  } catch { findings.push({ check:'resource_audit_completeness',result:'FAIL',resource_changed:state==='cleaning',audit_events_added:after-before }); }
  // Catalog verification without disabling RLS or broadening test grants.
  const tables=(await db.query(`select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','necms_private') and c.relkind='r' and c.relname<>'staff_profiles'`)).rows;
  assert.ok(tables.every(t=>t.relrowsecurity),'A clinical/ownership table lacks RLS');
  findings.push({ check:'catalog_rls_enabled',result:'PASS',table_count:tables.length });
  const publicExecute=(await db.query(`select count(*)::integer as n from pg_proc p join pg_namespace n on n.oid=p.pronamespace,
    lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where n.nspname='public' and p.proname like 'necms_%' and a.grantee=0 and a.privilege_type='EXECUTE'`)).rows[0].n;
  assert.equal(publicExecute,0); findings.push({ check:'no_public_necms_execute',result:'PASS' });
  console.log(JSON.stringify(findings,null,2));
  if (findings.some(f=>f.result==='FAIL')) process.exitCode=1;
} catch(error) { console.error('Review checks failed:',error.code??'',error.message); process.exitCode=1; }
finally { await db.close(); }
