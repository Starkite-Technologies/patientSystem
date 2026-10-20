"""Synthetic fixed-loopback benchmark; runs actual migration/security setup first."""
import runpy,time,json,sys,os,pathlib,concurrent.futures
from unittest.mock import patch
from psycopg.types.json import Jsonb
state=runpy.run_path(str(pathlib.Path(__file__).with_name('check-postgres-concurrency.py')))
owner=state['connection']();user=state['user']();A=state['A'];U1=state['U1'];DEP=state['DEP']
owner.execute("select set_config('request.jwt.claim.sub',%s,false)",(U1,))
results=[]
for target in (100,1000,5000,10000):
 current=owner.execute("select count(*) from public.visits where hospital_id=%s and status not in ('discharged','transferred')",(A,)).fetchone()[0]
 increment=max(0,target-current)
 service=state['service']
 owner.execute("""with people as(insert into public.patients(hospital_id,ownership_state,patient_ref,first_name,last_name)
 select %s,'verified','SYN-LOAD-'||gen_random_uuid(),'Synthetic','Benchmark' from generate_series(1,%s) returning id),
 encounters as(insert into public.visits(hospital_id,ownership_state,department_id,patient_id,complaint,priority,status,next_action,triage_state,urgency_source)
 select %s,'verified',%s,id,'Synthetic load fixture',null,'waiting','assessment','not_yet_triaged','not_assessed' from people returning id)
 insert into public.coordination_work_items(hospital_id,encounter_id,service_id,kind,title,created_by)
 select %s,id,%s,'other','Synthetic load task',%s from encounters""",(A,increment,A,DEP,A,service,U1))
 owner.execute('analyze public.visits;analyze public.patients;analyze public.coordination_work_items;analyze public.audit_events')
 item={'active_encounters':owner.execute("select count(*) from public.visits where hospital_id=%s and status not in ('discharged','transferred')",(A,)).fetchone()[0]}
 for label,query,args in [
 ('legacy_3c','select public.necms_coordination_board()',()),
 ('paged','select public.necms_read_page(%s,%s,null,25)',('queue',Jsonb({}))),
 ('search','select public.necms_read_page(%s,%s,null,25)',('patients',Jsonb({'q':'SYN-LOAD-'}))),
 ('filter','select public.necms_read_page(%s,%s,null,25)',('queue',Jsonb({'triage':'not_yet_triaged','service':service})))]:
  timings=[];data=None
  for _ in range(3):
   started=time.perf_counter();data=user.execute(query,args).fetchone()[0];timings.append(round((time.perf_counter()-started)*1000,2))
  plan=user.execute('explain(analyze,buffers,format json) '+query,args).fetchone()[0][0]
  item[label]={'python_roundtrip_decode_ms':timings,'json_bytes':len(json.dumps(data,separators=(',',':')).encode()),'sql_execution_ms':plan['Execution Time'],'sql_planning_ms':plan['Planning Time']}
  if label=='paged':item[label]['returned_rows']=len(data['items']);assert len(data['items'])<=25
 results.append(item);print(json.dumps(item),flush=True)
# In-process Django request path: real serializers/context checks/SQL, Auth identity stub.
os.environ.update({'DJANGO_SETTINGS_MODULE':'config.settings','DJANGO_DEBUG':'false','DJANGO_SECRET_KEY':'synthetic-benchmark-only','DJANGO_ALLOWED_HOSTS':'testserver,localhost,127.0.0.1','SUPABASE_URL':'https://synthetic.invalid','SUPABASE_PUBLISHABLE_KEY':'synthetic','NECMS_ENABLED':'true'})
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'backend'))
import django;django.setup()
from rest_framework.test import APIClient
context=user.execute('select (public.necms_context()).id::text').fetchone()[0]
def gateway(method,path,token,**kwargs):
 if path=='/auth/v1/user':return {'id':U1}
 assert kwargs.get('context')==context
 if path.endswith('necms_context_info'):return user.execute('select public.necms_context_info()').fetchone()[0]
 assert path.endswith('necms_read_page')
 b=kwargs['body'];return user.execute('select public.necms_read_page(%s,%s,%s,%s)',(b['p_kind'],Jsonb(b['p_filters']),b['p_cursor'],b['p_size'])).fetchone()[0]
api=[]
with patch('patients.authentication.request_supabase',side_effect=gateway),patch('patients.necms_views.request_supabase',side_effect=gateway):
 client=APIClient();client.credentials(HTTP_AUTHORIZATION='Bearer synthetic',HTTP_X_NECMS_CONTEXT=context)
 for _ in range(3):
  started=time.perf_counter();r=client.get(f'/api/necms/hospitals/{A}/read/queue/');elapsed=(time.perf_counter()-started)*1000
  assert r.status_code==200 and r['Cache-Control']=='no-store'
  api.append({'in_process_request_ms':round(elapsed,2),'bytes':len(r.content)})
def reader(_):
 c=state['user']()
 try:
  start=time.perf_counter();r=c.execute("select public.necms_read_page('queue')").fetchone()[0];return {'ms':round((time.perf_counter()-start)*1000,2),'rows':len(r['items'])}
 finally:c.close()
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:parallel=list(pool.map(reader,range(4)))
lookup_encounter=owner.execute('select encounter_id from public.coordination_work_items where hospital_id=%s limit 1',(A,)).fetchone()[0]
lookup_plan=user.execute("explain(analyze,buffers,format json) select id from public.coordination_work_items where hospital_id=%s and encounter_id=%s",(A,lookup_encounter)).fetchone()[0]
out={'environment':'Portable PostgreSQL 17.11, loopback, 64MB shared buffers, laptop; synthetic Auth stub; no hosted or network HTTP throughput claim','database':state['DB'],'workloads':results,'django_test_client_at_largest_workload':api,'four_parallel_readers':parallel,'lookup_plan':lookup_plan}
dest=pathlib.Path(__file__).resolve().parents[1]/'test-results/necms-3d-performance.json';dest.parent.mkdir(exist_ok=True);dest.write_text(json.dumps(out,indent=2),encoding='utf-8')
print(json.dumps({'django':api,'parallel_readers':parallel,'artifact':str(dest)}),flush=True)
owner.close();user.close()
