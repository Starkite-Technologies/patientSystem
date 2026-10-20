"""Disposable loopback PostgreSQL only. Never reads .env or DATABASE_URL."""
import argparse, concurrent.futures, hashlib, json, os, pathlib, subprocess, tempfile, threading, time, uuid
import psycopg
from psycopg.types.json import Jsonb
ROOT=pathlib.Path(__file__).resolve().parents[1]
LOCAL=pathlib.Path(tempfile.gettempdir())/'necms-3c-postgresql'
A='a0000000-0000-0000-0000-000000000001';B='b0000000-0000-0000-0000-000000000001'
U1='60000000-0000-0000-0000-000000000001';U2='60000000-0000-0000-0000-000000000002'
DEP='a3000000-0000-0000-0000-000000000001'
parser=argparse.ArgumentParser();parser.add_argument('--confirm-local-synthetic',action='store_true');args=parser.parse_args()
if not args.confirm_local_synthetic: raise SystemExit('Explicit --confirm-local-synthetic required; fixed disposable loopback target only.')
PASSWORD=(LOCAL/'owner-password.txt').read_text(encoding='utf-8').strip()
# Reject ambient libpq service/options settings as a possible target override.
# This is process-local; the user's parent environment is not changed.
for name in tuple(os.environ):
 if name.upper().startswith('PG'): del os.environ[name]
DB='necms_3c_synthetic_'+str(int(time.time()))
def connection(database=DB):
 return psycopg.connect(host='127.0.0.1',port=55439,dbname=database,user='necms_test_owner',password=PASSWORD,autocommit=True,connect_timeout=5,options='-c statement_timeout=15000')
admin=connection('postgres')
assert pathlib.Path(admin.execute('show data_directory').fetchone()[0]).resolve()==(LOCAL/'data').resolve(), 'Unverified cluster'
assert admin.execute('show listen_addresses').fetchone()[0]=='127.0.0.1'
admin.execute(psycopg.sql.SQL('create database {}').format(psycopg.sql.Identifier(DB)))
for role in ['anon','authenticated']:
 if not admin.execute('select 1 from pg_roles where rolname=%s',(role,)).fetchone():admin.execute(psycopg.sql.SQL('create role {}').format(psycopg.sql.Identifier(role)))
owner=connection()
owner.execute("create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;create publication supabase_realtime;")
def sqlfile(name):return (ROOT/name).read_text(encoding='utf-8')
for path in sorted((ROOT/'supabase/migrations').glob('*.sql')):
 owner.execute(path.read_text(encoding='utf-8'))
 if path.name=='202610130001_initial.sql':owner.execute(sqlfile('supabase/tests/name_migration_fixtures.sql'))
 if path.name=='202610140007_necms_resource_audit_integrity.sql':
  owner.execute(sqlfile('supabase/tests/hospital_isolation.sql'));owner.execute(sqlfile('supabase/tests/resource_audit_integrity.sql'));owner.execute('reset role')
 if path.name=='202610150001_necms_arrival_triage_foundations.sql':owner.execute(sqlfile('supabase/tests/arrival_triage.sql'));owner.execute('reset role')
owner.execute(sqlfile('supabase/tests/coordination.sql'));owner.execute('reset role')
if (ROOT/'supabase/tests/bounded_reads.sql').exists():
 owner.execute('update public.hospital_memberships set active=true,valid_until=null,authorization_version=authorization_version+1 where user_id in (%s,%s)',(U1,U2))
if (ROOT/'supabase/tests/presentation_security.sql').exists():
 owner.execute(sqlfile('supabase/tests/presentation_security.sql'));owner.execute('reset role')
 owner.execute(sqlfile('supabase/tests/bounded_reads.sql'));owner.execute('reset role')
owner.execute("update public.hospital_memberships set active=true,valid_until=null,authorization_version=authorization_version+1 where user_id in (%s,%s)",(U1,U2))
def user(user_id=U1,hospital=A):
 c=connection();c.execute('set role authenticated');c.execute("select set_config('request.jwt.claim.sub',%s,false)",(user_id,))
 ctx=c.execute('select public.necms_create_context(%s)',(hospital,)).fetchone()[0]
 c.execute("select set_config('request.headers',%s,false)",(json.dumps({'x-necms-context':ctx['id']}),));return c
seq=0
results=[]
def passed(name,details):results.append({'test':name,'result':'PASS','evidence':details});print(json.dumps(results[-1]),flush=True)
def arrive(c,department=DEP,payload=None):
 return c.execute('select public.necms_record_arrival(%s)',(Jsonb(payload or {'request_id':str(uuid.uuid4()),'department_id':department,'source':'other'}),)).fetchone()[0]
c=user();service=c.execute("select public.necms_coordination_configuration(%s,%s)",(uuid.uuid4(),Jsonb({'kind':'service','code':'CONCURRENT','name':'Synthetic concurrency service'}))).fetchone()[0]['id'];c.close()
def work(c,encounter,service_id=service):
 return c.execute('select public.necms_create_work(%s,%s)',(Jsonb({'encounter_id':encounter,'service_id':service_id,'kind':'other','title':'Synthetic concurrency task','eligible':True}),uuid.uuid4())).fetchone()[0]['id']
def event(c,w,action='start',version=1,retry=None):return c.execute('select public.necms_work_event(%s,%s,%s,%s,%s)',(w,version,action,retry or uuid.uuid4(),Jsonb({}))).fetchone()[0]
def parallel(jobs):
 barrier=threading.Barrier(len(jobs))
 def run(job):
  try:barrier.wait(timeout=10);return {'ok':job()}
  except psycopg.Error as e:return {'error':e.sqlstate}
 with concurrent.futures.ThreadPoolExecutor(max_workers=len(jobs)) as pool:return list(pool.map(run,jobs))
def care(c,v,r=None):
 return c.execute('select public.necms_update_care(%s,1,%s)',(v,Jsonb({'status':'in_treatment','next_action':'treatment','resource_id':r,'assigned_to':'','location':''}))).fetchone()[0]
with user() as x,user(U2) as y:
 v1=arrive(x)['encounter_id'];v2=arrive(y)['encounter_id'];bed=str(uuid.uuid4())
 owner.execute("insert into public.resources(id,hospital_id,ownership_state,name,kind) values(%s,%s,'verified','Synthetic concurrent bed','Test')",(bed,A))
 out=parallel([lambda:care(x,v1,bed),lambda:care(y,v2,bed)]);assert sum('ok'in r for r in out)==1,out
 assert owner.execute('select count(*) from public.visits where resource_id=%s',(bed,)).fetchone()[0]==1
 passed('competing bed allocation',out)
 v=arrive(x)['encounter_id'];out=parallel([lambda:care(x,v),lambda:care(y,v)]);assert sum('ok'in r for r in out)==1,out
 assert owner.execute('select version from public.visits where id=%s',(v,)).fetchone()[0]==2
 passed('concurrent encounter updates reject stale writer',out)
 w=work(x,arrive(x)['encounter_id']);out=parallel([lambda:event(x,w,'call'),lambda:event(y,w)]);assert sum('ok'in r for r in out)==1,out
 assert owner.execute('select count(*) from public.coordination_events where work_item_id=%s',(w,)).fetchone()[0]==2
 passed('concurrent call and start on same version',out)
 w1=work(x,arrive(x)['encounter_id']);w2=work(y,arrive(y)['encounter_id']);out=parallel([lambda:event(x,w1),lambda:event(y,w2)]);assert all('ok'in r for r in out),out
 assert owner.execute("select count(*) from public.coordination_work_items where id in (%s,%s) and state='underway'",(w1,w2)).fetchone()[0]==2
 passed('independent work transitions commit',out)
 # Regression for 3C: an admitted service start must not lock unrelated encounters.
 unrelated=arrive(y)['encounter_id'];target=work(x,arrive(x)['encounter_id'])
 x.execute('begin');event(x,target);y.execute("set lock_timeout='250ms'")
 try:care(y,unrelated)
 finally:x.execute('commit');y.execute("set lock_timeout='0'")
 assert owner.execute('select version from public.visits where id=%s',(unrelated,)).fetchone()[0]==2
 passed('narrow snapshot locks permit unrelated clinical update',{'unrelated_update_committed':True,'other_start_transaction_open':True})
 # A read must not acquire broad clinical row locks; a subsequent cursor detects the commit.
 if (ROOT/'supabase/migrations/202610190001_necms_bounded_reads.sql').exists():
  owner.execute('begin');owner.execute('update public.visits set version=version+1 where id=%s',(unrelated,))
  x.execute("set lock_timeout='250ms'")
  first=x.execute("select public.necms_read_page('queue','{}',null,1)").fetchone()[0]
  assert first['next_cursor'];owner.execute('commit');x.execute("set lock_timeout='0'")
  try:x.execute("select public.necms_read_page('queue','{}',%s,1)",(first['next_cursor'],));raise AssertionError('Concurrent change did not invalidate cursor')
  except psycopg.Error as e:assert e.sqlstate=='40001'
  passed('nonblocking paged read and committed-change reconciliation',{'read_during_writer':True,'stale_cursor':'40001'})


 # Same identity in two independent connections to exercise retry locking.
 with user() as same:
  payload={'request_id':str(uuid.uuid4()),'department_id':DEP,'source':'other'}
  out=parallel([lambda:arrive(x,payload=payload),lambda:arrive(same,payload=payload)]);assert all('ok'in r for r in out) and out[0]['ok']==out[1]['ok'],out
  assert owner.execute('select count(*) from public.emergency_arrivals where request_id=%s',(payload['request_id'],)).fetchone()[0]==1
  passed('duplicate arrival request',out)
  w=work(x,arrive(x)['encounter_id']);retry=uuid.uuid4();out=parallel([lambda:event(x,w,retry=retry),lambda:event(same,w,retry=retry)]);assert all('ok'in r for r in out) and out[0]['ok']==out[1]['ok'],out
  assert owner.execute('select count(*) from public.coordination_events where request_id=%s',(retry,)).fetchone()[0]==1
  passed('duplicate coordination event',out)
 # Hold revocation lock, then a previously authorised context attempts a write.
 w=work(x,arrive(x)['encounter_id']);owner.execute('begin');owner.execute('update public.hospital_memberships set active=false,authorization_version=authorization_version+1 where hospital_id=%s and user_id=%s',(A,U1))
 with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
  def denied_write():
   try:return event(x,w)
   except psycopg.Error as e:return e.sqlstate
  pending=pool.submit(denied_write)
  deadline=time.monotonic()+5;blocked=False
  while time.monotonic()<deadline:
   blocked=owner.execute("select wait_event_type='Lock' from pg_stat_activity where pid=%s",(x.info.backend_pid,)).fetchone()[0]
   if blocked:break
   time.sleep(.02)
  assert blocked,'Write did not demonstrably wait on membership lock'
  owner.execute('commit');out=pending.result(timeout=10);assert out=='42501',out
 assert owner.execute('select version from public.coordination_work_items where id=%s',(w,)).fetchone()[0]==1
 passed('revocation wins against waiting write',{'sqlstate':out,'observed_lock_wait':blocked,'unchanged_version':1})
owner.execute('update public.hospital_memberships set active=true,authorization_version=authorization_version+1 where hospital_id=%s and user_id=%s',(A,U1))
with user() as x,user(U2,B) as y:
 def scoped(c,own,other):
  allowed=c.execute('select count(*) from public.coordination_work_items where hospital_id=%s',(own,)).fetchone()[0]
  forbidden=c.execute('select count(*) from public.coordination_work_items where hospital_id=%s',(other,)).fetchone()[0];assert forbidden==0;return {'own':allowed,'other':forbidden}
 # Create a real B task in this disposable fixture, so neither side is an empty positive.
 dep=owner.execute('select id from public.departments where hospital_id=%s limit 1',(B,)).fetchone()[0]
 sb=y.execute('select public.necms_coordination_configuration(%s,%s)',(uuid.uuid4(),Jsonb({'kind':'service','code':'CONCURRENT','name':'Synthetic B concurrency'}))).fetchone()[0]['id'];work(y,arrive(y,str(dep))['encounter_id'],sb)
 out=parallel([lambda:scoped(x,A,B),lambda:scoped(y,B,A)]);assert all(r['ok']['own']>0 for r in out),out
 passed('hospital isolation during concurrent reads',out)
 w=work(x,arrive(x)['encounter_id']);event(x,w)
 owner.execute("create function public.synthetic_reject_audit() returns trigger language plpgsql as $$begin if new.action='coordination_complete' then raise exception 'Synthetic audit rejection' using errcode='23514';end if;return new;end$$;create trigger synthetic_reject_audit before insert on public.audit_events for each row execute function public.synthetic_reject_audit();")
 try:event(x,w,'complete',2);raise AssertionError('Audit failure did not reject write')
 except psycopg.Error as e:assert e.sqlstate=='23514'
 assert owner.execute('select state,version from public.coordination_work_items where id=%s',(w,)).fetchone()==('underway',2)
 assert owner.execute("select count(*) from public.coordination_events where work_item_id=%s and event='complete'",(w,)).fetchone()[0]==0
 owner.execute('drop trigger synthetic_reject_audit on public.audit_events;drop function public.synthetic_reject_audit()')
 passed('actual audit-failure transaction rollback',{'state':'underway','version':2,'partial_complete_events':0})
 # Lock timeout through real RPC, no mutation may commit.
 owner.execute('begin');owner.execute("select pg_advisory_xact_lock(hashtextextended(%s,1))",(A+service,));x.execute("set lock_timeout='250ms'")
 try:event(x,w,'complete',2);raise AssertionError('Expected lock timeout')
 except psycopg.Error as e:assert e.sqlstate=='55P03'
 finally:owner.execute('rollback');x.execute("set lock_timeout='0'")
 assert owner.execute('select version from public.coordination_work_items where id=%s',(w,)).fetchone()[0]==2
 passed('RPC lock timeout',{'sqlstate':'55P03','unchanged_version':2})
 # Generic inverse row-lock probe validates actual server deadlock detection;
 # not a claim that a particular clinical workflow deadlocks.
 barrier=threading.Barrier(2)
 def lock_cycle(c,first,second):
  try:
   with c.transaction():
    c.execute('select 1 from public.coordination_work_items where id=%s for update',(first,));barrier.wait(timeout=5);c.execute('select 1 from public.coordination_work_items where id=%s for update',(second,))
   return 'committed'
  except psycopg.Error as e:return e.sqlstate
 # Use owner connections: authenticated roles correctly lack FOR UPDATE rights.
 with connection() as d1,connection() as d2,concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
  futures=[pool.submit(lock_cycle,d1,w1,w2),pool.submit(lock_cycle,d2,w2,w1)];out=[f.result(timeout=10) for f in futures]
 assert sorted(out)==['40P01','committed'],out
 passed('server deadlock detection with inverse row locks',out)
# Dump/restore into a second fresh database; compare every persistent table.
owner.execute('reset role')
def snapshot(c):
 out={}
 tables=c.execute("select schemaname,tablename from pg_tables where schemaname in ('public','auth','necms_private') order by 1,2").fetchall()
 for schema,table in tables:
  query=psycopg.sql.SQL('select to_jsonb(t)::text from {}.{} t order by to_jsonb(t)::text').format(psycopg.sql.Identifier(schema),psycopg.sql.Identifier(table))
  rows=[r[0] for r in c.execute(query)];out[schema+'.'+table]={'rows':len(rows),'sha256':hashlib.sha256(json.dumps(rows).encode()).hexdigest()}
 return out
def security_catalog(c):
 tables=c.execute("select n.nspname,c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and n.nspname in ('public','auth','necms_private') order by 1,2").fetchall()
 functions=c.execute("select p.proname,pg_get_function_identity_arguments(p.oid),p.prosecdef,p.proconfig,p.proacl::text,pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by 1,2").fetchall()
 policies=c.execute("select schemaname,tablename,policyname,permissive,roles::text,cmd,qual,with_check from pg_policies where schemaname in ('public','necms_private') order by 1,2,3").fetchall()
 return json.dumps({'tables':tables,'functions':functions,'policies':policies},sort_keys=True)
security_before=security_catalog(owner)
before=snapshot(owner);dump=LOCAL/(DB+'.dump');environment={**os.environ,'PGPASSWORD':PASSWORD,'PGHOST':'127.0.0.1','PGPORT':'55439','PGUSER':'necms_test_owner'}
restore=DB+'_restore';admin.execute(psycopg.sql.SQL('create database {}').format(psycopg.sql.Identifier(restore)))
for command in [[str(LOCAL/'pgsql/bin/pg_dump.exe'),'-Fc','-f',str(dump),DB],[str(LOCAL/'pgsql/bin/pg_restore.exe'),'--exit-on-error','--no-owner','-d',restore,str(dump)]]:
 result=subprocess.run(command,env=environment,capture_output=True,text=True)
 assert result.returncode==0, 'Local dump/restore failed: '+result.stderr[:300]
with connection(restore) as restored:
 assert snapshot(restored)==before,'Restored row content differs'
 assert security_catalog(restored)==security_before,'Restored function/RLS/policy configuration differs'
 passed('custom-format dump and fresh-database restoration',{'tables_compared':len(before),'dump_bytes':dump.stat().st_size,'all_row_hashes_match':True,'function_acl_rls_policies_match':True})
print(json.dumps({'database':DB,'server':owner.execute('select version()').fetchone()[0],'checks':len(results),'result':'PASS','scope':'Actual independent PostgreSQL connections; Auth identity stubbed, no Supabase REST integration'},indent=2))
owner.close();admin.close()
