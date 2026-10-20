// Browser-only fictional service: no database client, configured URL or real token.
export const A='a0000000-0000-0000-0000-000000000001',B='b0000000-0000-0000-0000-000000000001';
const service='a4000000-0000-0000-0000-000000000001',department='a3000000-0000-0000-0000-000000000001',reason='a5000000-0000-0000-0000-000000000001';
export async function installSyntheticFixture(context, options={}){
 const port=String(options.presentation?5177:5176);
 const state={actor:'fictional-assessor',role:'facilitator',revision:1,denied:false,failRead:false,hold:false,releases:[],held:0,reads:[],writes:0,visits:[],work:[],events:[],exceptions:[],assessments:[],contexts:new Map(),tokens:new Map()};
 function reset(){
  state.actor='fictional-assessor';state.role='facilitator';state.releases.splice(0).forEach(r=>r());state.hold=false;state.held=0;state.failRead=false;state.contexts.clear();state.writes=0;state.revision++;state.denied=false;state.visits=[];state.work=[];state.events=[];state.exceptions=[];state.assessments=[];state.tokens.clear();
  for(let n=1;n<=(options.presentation?3:80);n++){
   const id='d1000000-0000-0000-0000-'+String(n).padStart(12,'0'),known=n%3!==0;
   state.visits.push({id,patient_id:id,patient_ref:'SYN-DEMO-'+String(n).padStart(4,'0'),first_name:known?'Fictional':null,last_name:known?'Person '+n:null,date_of_birth:null,patient_version:1,names_need_review:false,identity_status:known?'confirmed':'provisional',temporary_identifier:known?null:'TMP-SYN-'+n,complaint:'Fictional workflow demonstration',priority:null,clinical_urgency:n===1?1:n===2?4:null,latest_assessment_at:n<3?'2026-10-19T07:00:00Z':null,urgency_source:n<3?'provisional_manual':'not_assessed',triage_state:n<3?'completed_provisional':'not_yet_triaged',status:'waiting',next_action:'assessment',location:'',resource_id:null,assigned_to:'',notes:'Fictional only',arrived_at:'2026-10-19T06:00:00Z',updated_at:'2026-10-19T07:00:00Z',version:1,department_id:department});
   state.work.push({id:'e1000000-0000-0000-0000-'+String(n).padStart(12,'0'),encounter_id:id,service_id:service,kind:n===3?'urgent_review':'initial_review',title:'Fictional review '+n,state:'waiting',eligible:true,assignee_id:null,team_id:null,created_at:'2026-10-19T06:00:00Z',queue_entered_at:'2026-10-19T06:00:00Z',acknowledged_at:null,completed_at:null,version:1});
  }
  if(options.presentation){
   const now=Date.now();
   for(let i=0;i<3;i++){const v=state.visits[i],w=state.work[i];
    v.first_name=i===2?null:'Fictional';v.last_name=i===2?null:'Patient '+['A','B','C'][i];v.identity_status=i===2?'provisional':'confirmed';v.clinical_urgency=i===0?4:i===1?1:null;
    v.arrived_at=new Date(now-[45,25,10][i]*60000).toISOString();v.latest_assessment_at=i<2?new Date(now-[40,20][i]*60000).toISOString():null;
    if(i<2)state.assessments.push({id:'f1000000-0000-0000-0000-'+String(i+1).padStart(12,'0'),encounter_id:v.id,kind:'initial',manual_priority:v.clinical_urgency,complaint:v.complaint,assessor_id:'fictional-assessor',assessed_at:v.latest_assessment_at,observations:{general:'Predetermined fictional scenario input'},notes:'Synthetic example, not an approved protocol',vitals:[],review:{decision:'accepted',reason:'Predetermined fictional independent review',reviewer_id:'fictional-reviewer',reviewed_at:v.latest_assessment_at}});
    w.created_at=v.arrived_at;w.queue_entered_at=v.arrived_at;w.assignee_id='60000000-0000-0000-0000-000000000001';w.title='Fictional same-service assessment '+['A','B','C'][i];
   }
  }
 }reset();state.reset=reset;
 const allCaps=['encounter.read','patient.identity.read','resource.read','queue.read','queue.coordinate','patient.call','service.accept','treatment.record','work.create','work.assign','work.complete','display.read','reassessment.request','escalation.acknowledge','exception.review','clinical.timeline.read','encounter.register','arrival.register','encounter.update_legacy','triage.read','triage.create','triage.reassess','triage.review'];
 const reads=['encounter.read','patient.identity.read','resource.read','queue.read','triage.read','clinical.timeline.read'];
 const roleCaps={
  reception:['arrival.register'],
  nurse:[...reads,'arrival.register','triage.create','triage.reassess','encounter.update_legacy','reassessment.request','work.create','service.accept','escalation.acknowledge','work.complete'],
  doctor:[...reads,'triage.create','triage.reassess','triage.review','priority.amend','encounter.update_legacy','service.accept','treatment.record','work.complete'],
  coordinator:[...reads,'queue.coordinate','patient.call','work.create','work.assign','treatment.record','service.accept','work.complete','reassessment.request','escalation.acknowledge','exception.review'],
  administrator:['membership.manage','hospital.configure'],
  facilitator:[...allCaps,'membership.manage','hospital.configure','priority.amend']
 };
 state.capabilities=()=>roleCaps[state.role];
 await context.addInitScript(()=>{
  const encode=value=>btoa(JSON.stringify(value)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  localStorage.setItem('sb-isolated-test-auth-token',JSON.stringify({access_token:encode({alg:'HS256',typ:'JWT'})+'.'+encode({sub:'synthetic-user',exp:Math.floor(Date.now()/1000)+3600})+'.synthetic',refresh_token:'synthetic-only',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user:{id:'synthetic-user',email:'fictional@example.invalid'}}));
 });
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.hostname==='isolated-test.supabase.invalid'&&url.pathname==='/auth/v1/logout')return route.fulfill({status:204});
  if(url.hostname!=='127.0.0.1'||url.port!==port)return route.abort();
  if(url.pathname==='/__synthetic_demo_reset__'){reset();return route.fulfill({contentType:'application/json',body:'{"synthetic":true}'});}
  if(url.pathname==='/__synthetic_demo_role__'){
   const role=url.searchParams.get('role');if(!role)return route.fulfill({contentType:'application/json',body:JSON.stringify({synthetic_role:state.role})});if(!Object.hasOwn(roleCaps,role))return route.fulfill({status:400,body:'Invalid fictional role'});
   state.role=role;state.contexts.clear();return route.fulfill({contentType:'application/json',body:JSON.stringify({synthetic_role:role})});
  }
  if(url.pathname==='/__synthetic_demo_actor__'){state.actor=state.actor==='fictional-assessor'?'fictional-reviewer':'fictional-assessor';return route.fulfill({contentType:'application/json',body:JSON.stringify({synthetic_actor:state.actor})});}
  if(!url.pathname.startsWith('/api/'))return route.continue();
  const reply=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)}).catch(e=>{if(!req.failure())throw e;});
  if(url.pathname==='/api/necms/hospitals/')return reply([{id:A,name:'Synthetic Public A',facility_type:'public'},{id:B,name:'Synthetic Private B',facility_type:'private'}]);
  if(url.pathname==='/api/necms/contexts/'){const c={...req.postDataJSON(),id:'synthetic-context-'+state.contexts.size,expires_at:'2099-01-01T00:00:00Z'};state.contexts.set(c.id,c);return reply(c,201);}
  const c=state.contexts.get(req.headers()['x-necms-context']);if(!c||c.hospital_id!==url.pathname.split('/')[4])return reply({detail:'Synthetic context denied'},403);
  const caps=state.capabilities();
  if(state.denied)return reply({detail:'Synthetic membership revoked'},403);
  const required=(()=>{
   if(url.pathname.endsWith('/display-board/'))return 'display.read';
   if(url.pathname.endsWith('/staff/')&&!url.pathname.includes('/read/'))return 'membership.manage';
   if(req.method()==='POST'){
    if(url.pathname.endsWith('/arrivals/'))return 'arrival.register';
    if(url.pathname.endsWith('/visits/'))return 'encounter.register';
    if(url.pathname.endsWith('/care/'))return 'encounter.update_legacy';
    if(url.pathname.includes('/assessments/')&&url.pathname.endsWith('/review/'))return 'triage.review';
    if(url.pathname.endsWith('/assessments/'))return req.postDataJSON().kind==='reassessment'?'triage.reassess':'triage.create';
    if(url.pathname.includes('/exceptions/'))return 'exception.review';
    if(url.pathname.endsWith('/work-items/'))return ['urgent_review','nursing_reassessment'].includes(req.postDataJSON().kind)?'reassessment.request':'work.create';
    if(url.pathname.includes('/work-items/'))return {start:'treatment.record',call:'patient.call',accept:'service.accept',reassign:'work.assign',complete:'work.complete',acknowledge:'escalation.acknowledge'}[req.postDataJSON().event]??'queue.coordinate';
   }
   if(url.pathname.endsWith('/arrivals/'))return 'arrival.register';
   if(url.pathname.includes('/read/'))return {queue:'queue.read',patients:'patient.identity.read',encounters:'encounter.read',assessments:'triage.read',vitals:'triage.read',timeline:'clinical.timeline.read',work_events:'queue.read',evidence:'queue.read',exceptions:'exception.review',annotations:'exception.review',resources:'resource.read',departments:'encounter.read',staff:'queue.read',audit:'audit.summary.read'}[url.pathname.split('/').at(-2)]??'queue.read';
   return null;
  })();
  if(required&&!caps.includes(required))return reply({detail:'Fictional role capability denied'},403);
  if(url.pathname.endsWith('/staff/')&&!url.pathname.includes('/read/')){
   if(req.method()==='POST')return reply({id:'fictional-membership'});
   return reply({memberships:[{id:'fictional-membership',user_id:'fictional-demo-nurse',role_id:'fictional-role',active:true,authorization_version:1}],roles:[{id:'fictional-role',code:'Fictional nurse'}]});
  }
  if(url.pathname.endsWith('/display-board/'))return reply([{display_label:'ED-FICTIONAL',status:'waiting',next_action:'assessment',space_state:'Unassigned'}]);
  const envelope=items=>({items,total:items.length,next_cursor:null,revision:String(state.revision),server_time:new Date().toISOString(),capabilities:caps});
  const bed={id:'a6000000-0000-0000-0000-000000000001',name:'Fictional bed 1',kind:'Synthetic treatment space',state:'available',occupied:state.visits.some(v=>v.resource_id==='a6000000-0000-0000-0000-000000000001'&&!['discharged','transferred'].includes(v.status))};
  if(url.pathname.endsWith('/workspace/')){let visits=c.hospital_id===A&&caps.includes('encounter.read')?state.visits:[];const q=url.searchParams.get('q')?.toLowerCase();if(q)visits=visits.filter(v=>(v.patient_ref+' '+v.first_name+' '+v.last_name).toLowerCase().includes(q));return reply({role:'nurse',capabilities:caps,visits:visits.slice(0,25),resources:c.hospital_id===A&&caps.includes('resource.read')?[bed]:[],patients:[],events:[],page:{total:visits.length,next_cursor:null}});}
  if(url.pathname.endsWith('/arrivals/')&&req.method()==='GET')return reply([{id:department,name:'Fictional emergency department'}]);
  if(req.method()==='POST'&&(url.pathname.endsWith('/arrivals/')||url.pathname.endsWith('/visits/'))){
   if(c.hospital_id!==A)return reply({detail:'Synthetic target denied'},403);const input=req.postDataJSON(),rapid=url.pathname.endsWith('/arrivals/'),values=rapid?input:input.input;
   if(!rapid&&values.patient_ref&&state.visits.some(v=>v.patient_ref===values.patient_ref))return reply({detail:'Fictional patient already has an active encounter'},409);
   const v={...state.visits[2],...values,id:crypto.randomUUID(),patient_id:crypto.randomUUID(),patient_ref:'SYN-DEMO-'+String(state.visits.length+1).padStart(4,'0'),identity_status:values.first_name&&values.last_name?'confirmed':'provisional',temporary_identifier:values.first_name&&values.last_name?null:'TMP-SYN-'+crypto.randomUUID(),clinical_urgency:null,latest_assessment_at:null,urgency_source:rapid?'not_assessed':'legacy_unvalidated',triage_state:rapid?'not_yet_triaged':'legacy_unassessed',status:values.immediate_care?'in_treatment':'waiting',arrived_at:new Date().toISOString(),version:1};
   state.visits.unshift(v);state.revision++;state.writes++;return reply({id:v.id,encounter_id:v.id,patient_id:v.patient_id},201);
  }
  if(req.method()==='POST'&&url.pathname.endsWith('/care/')){
   const v=state.visits.find(v=>v.id===url.pathname.split('/').at(-3)),input=req.postDataJSON();if(!v||c.hospital_id!==A)return reply({},403);
   if(v.version!==input.version)return reply({detail:'Stale fictional encounter'},409);
   if(input.resource_id&&state.visits.some(other=>other.id!==v.id&&other.resource_id===input.resource_id&&!['discharged','transferred'].includes(other.status)))return reply({detail:'Fictional bed already assigned'},409);
   state.events.unshift({id:crypto.randomUUID(),encounter_id:v.id,event:'care_'+input.status,recorded_at:new Date().toISOString(),actor_id:state.actor});Object.assign(v,input);if(['discharged','transferred'].includes(v.status))v.resource_id=null;v.version++;state.revision++;state.writes++;return reply({status:'updated'});
  }
  if(req.method()==='POST'&&url.pathname.endsWith('/assessments/')){
   const input=req.postDataJSON(),v=state.visits.find(v=>v.id===url.pathname.split('/').at(-3));if(!v||c.hospital_id!==A)return reply({},403);if(v.version!==input.version)return reply({detail:'Stale fictional encounter'},409);
   const assessment={...input,id:crypto.randomUUID(),encounter_id:v.id,assessor_id:state.actor,assessed_at:new Date().toISOString(),review:null};state.assessments.unshift(assessment);v.triage_state='awaiting_review';v.version++;state.events.unshift({id:crypto.randomUUID(),encounter_id:v.id,event:'assessment_recorded',recorded_at:new Date().toISOString(),actor_id:state.actor});state.revision++;state.writes++;return reply({id:assessment.id},201);
  }
  if(req.method()==='POST'&&url.pathname.includes('/assessments/')&&url.pathname.endsWith('/review/')){
   const a=state.assessments.find(a=>a.id===url.pathname.split('/').at(-3)),input=req.postDataJSON();if(!a||c.hospital_id!==A||a.assessor_id===state.actor)return reply({detail:'Independent fictional reviewer required'},403);
   const v=state.visits.find(v=>v.id===a.encounter_id);if(v.version!==input.version||a.review)return reply({detail:'Stale fictional review'},409);
   a.review={decision:input.decision,reason:input.reason,reviewed_at:new Date().toISOString(),reviewer_id:state.actor};v.triage_state=input.decision==='accepted'?'completed_provisional':'not_yet_triaged';if(input.decision==='accepted'){v.clinical_urgency=a.manual_priority;v.latest_assessment_at=a.assessed_at;v.urgency_source='provisional_manual';}v.version++;state.revision++;state.writes++;return reply({status:'reviewed'});
  }
  if(url.pathname.includes('/read/')){
   const readKind=url.pathname.split('/').at(-2);
   const companions={queue:['encounter.read','patient.identity.read','resource.read'],exceptions:['queue.read','encounter.read','patient.identity.read'],annotations:['queue.read','encounter.read','patient.identity.read'],encounters:['patient.identity.read'],staff:['patient.identity.read']};
   if((companions[readKind]??[]).some(cap=>!caps.includes(cap)))return reply({detail:'Fictional companion capability denied'},403);
   const kind=url.pathname.split('/').at(-2);state.reads.push(kind);let items=[];const own=c.hospital_id===A?state.visits:[],active=own.filter(v=>!['discharged','transferred'].includes(v.status));
   if(kind==='queue'){
    if(state.failRead){state.failRead=false;return route.abort();}
    items=state.work.filter(w=>(url.searchParams.get('closed')==='true'?own:active).some(v=>v.id===w.encounter_id)&& (url.searchParams.get('closed')==='true'||!['completed','cancelled'].includes(w.state))).map(w=>({encounter:own.find(v=>v.id===w.encounter_id),work:w,service_name:'Fictional assessment service',team_name:'',clinician_name:w.assignee_id?'Fictional Nurse':''}));
    for(const v of (url.searchParams.get('closed')==='true'?own:active))if(!state.work.some(w=>w.encounter_id===v.id))items.push({encounter:v,work:null,service_name:'No structured service',team_name:'',clinician_name:''});
    const reviewed=v=>v.urgency_source==='provisional_manual'&&v.latest_assessment_at!=null&&v.clinical_urgency!=null;
    items.sort((a,b)=>Number(reviewed(a.encounter))-Number(reviewed(b.encounter))||(reviewed(a.encounter)&&reviewed(b.encounter)?a.encounter.clinical_urgency-b.encounter.clinical_urgency:0)||(a.work?.id??a.encounter.id).localeCompare(b.work?.id??b.encounter.id));
    for(const key of ['service','state','encounter','triage','urgency','department']){const value=url.searchParams.get(key);if(value)items=items.filter(r=>key==='service'?r.work?.service_id===value:key==='state'?r.work?.state===value:key==='encounter'?r.encounter.id===value:key==='triage'?r.encounter.triage_state===value:key==='department'?r.encounter.department_id===value:value==='unknown'?!reviewed(r.encounter):reviewed(r.encounter)&&String(r.encounter.clinical_urgency)===value);}
    const q=url.searchParams.get('q')?.toLowerCase();if(q)items=items.filter(r=>(r.encounter.patient_ref+' '+(r.work?.title??'')).toLowerCase().includes(q));
   }else if(kind==='encounters')items=own.filter(v=>url.searchParams.get('closed')==='true'?['discharged','transferred'].includes(v.status):!['discharged','transferred'].includes(v.status)).filter(v=>(v.patient_ref+' '+v.first_name+' '+v.last_name).toLowerCase().includes((url.searchParams.get('q')??'').toLowerCase()));
   else if(kind==='services')items=[{id:service,name:'Fictional assessment service'}];
   else if(kind==='departments')items=[{id:department,name:'Fictional emergency department'}];
   else if(kind==='reasons')items=[{id:reason,name:'Fictional operational circumstance'}];
   else if(kind==='patients')items=active.map(v=>({...v,patient_id:v.patient_id})).filter(v=>(v.patient_ref+' '+v.first_name+' '+v.last_name).toLowerCase().includes((url.searchParams.get('q')??'').toLowerCase()));
   else if(kind==='work_events')items=state.events.filter(e=>e.encounter_id===url.searchParams.get('encounter')).map(({evidence,...e})=>e);
   else if(kind==='exceptions')items=state.exceptions.filter(e=>!url.searchParams.get('encounter')||e.encounter_id===url.searchParams.get('encounter'));
   else if(kind==='annotations')items=state.exceptions.find(e=>e.id===url.searchParams.get('record'))?.annotations??[];
   else if(kind==='evidence')items=state.events.find(e=>e.id===url.searchParams.get('record'))?.evidence??[];
   else if(kind==='assessments')items=state.assessments.filter(a=>a.encounter_id===url.searchParams.get('encounter'));
   else if(kind==='resources')items=c.hospital_id===A?[bed]:[];
   else if(kind==='staff')items=[{id:'60000000-0000-0000-0000-000000000001',name:'Fictional Nurse'}];
   else if(kind==='timeline')items=state.events.filter(e=>e.encounter_id===url.searchParams.get('encounter')).map(e=>({id:e.id,action:e.event,category:'coordination',created_at:e.recorded_at,actor_id:e.actor_id}));
   else if(['teams','vitals','audit'].includes(kind))items=[];
   else return reply({detail:'Unknown synthetic read'},404);
   const filter=[...url.searchParams.entries()].filter(([k])=>k!=='cursor').sort().toString(),token=state.tokens.get(url.searchParams.get('cursor'));
   if(url.searchParams.has('cursor')&&(!token||token.revision!==state.revision||token.filter!==filter||token.context!==c.id))return reply({detail:'Synthetic read changed. Refresh first page.'},409);
   const offset=token?.offset??0,size=Number(url.searchParams.get('size')??25),all=items;let next=null;
   if(all.length>offset+size){next='page-'+state.tokens.size;state.tokens.set(next,{offset:offset+size,revision:state.revision,filter,context:c.id});}items=all.slice(offset,offset+size);
   const result={...envelope(items),total:all.length,next_cursor:next,summary:kind==='queue'?{reviewed_patients:active.filter(v=>v.urgency_source==='provisional_manual'&&v.latest_assessment_at&&v.clinical_urgency!==null).length,waiting_service_patients:active.filter(v=>state.work.some(w=>w.encounter_id===v.id&&['waiting','called','accepted'].includes(w.state))).length,underway_services:state.work.filter(w=>w.state==='underway'&&active.some(v=>v.id===w.encounter_id)).length,pending_exceptions:caps.includes('exception.review')?state.exceptions.filter(e=>e.annotations.length===0).length:null,active_patients:active.length,unknown_urgency:active.filter(v=>!v.latest_assessment_at).length,awaiting_triage:active.filter(v=>!v.latest_assessment_at).length,awaiting_review:active.filter(v=>v.triage_state==='awaiting_review').length,care_underway:active.filter(v=>v.status==='in_treatment').length,unacknowledged_reviews:state.work.filter(w=>active.some(v=>v.id===w.encounter_id)&&['urgent_review','nursing_reassessment'].includes(w.kind)&&!w.acknowledged_at&&!['completed','cancelled'].includes(w.state)).length,available_spaces:c.hospital_id===A&&!bed.occupied?1:0,provisional_waiting_by_label:Object.fromEntries([1,2,3,4,5].map(n=>[String(n),active.filter(v=>v.clinical_urgency===n&&state.work.some(w=>w.encounter_id===v.id&&['waiting','called','accepted'].includes(w.state))).length]))}:null};
   if(state.hold&&kind==='queue'){state.held++;await new Promise(resolve=>state.releases.push(resolve));}return reply(result);
  }
  if(req.method()==='POST'&&url.pathname.includes('/coordination/')){
   state.writes++;const input=req.postDataJSON();if(!input.request_id)return reply({detail:'Retry key required'},400);
   if(url.pathname.endsWith('/work-items/')){const w={...state.work[0],id:crypto.randomUUID(),encounter_id:input.encounter_id,service_id:input.service_id,kind:input.kind,title:input.title,eligible:input.eligible,assignee_id:input.assignee_id??(['urgent_review','nursing_reassessment'].includes(input.kind)?'60000000-0000-0000-0000-000000000001':null),team_id:input.team_id??null,acknowledged_at:null,completed_at:null,state:'waiting',version:1};state.work.push(w);state.revision++;return reply({id:w.id},201);}
   if(url.pathname.includes('/work-items/')){
    const w=state.work.find(w=>w.id===url.pathname.split('/').at(-3));if(!w)return reply({},404);if(w.version!==input.version)return reply({detail:'Stale synthetic work'},409);
    const evidence=input.event==='start'?structuredClone(state.work.filter(candidate=>candidate.id!==w.id&&candidate.service_id===w.service_id&&candidate.eligible&&['waiting','called','accepted'].includes(candidate.state)).map(candidate=>({work_item_id:candidate.id,encounter_id:candidate.encounter_id,patient_ref:state.visits.find(v=>v.id===candidate.encounter_id)?.patient_ref,state:candidate.state,version:candidate.version,urgency:state.visits.find(v=>v.id===candidate.encounter_id)?.clinical_urgency??null}))):[];
    const old=w.state;if(input.event==='reassign'){if(!input.reason)return reply({detail:'Assignment reason required'},400);w.assignee_id=input.assignee_id??null;w.acknowledged_at=null;if(w.state==='accepted')w.state='waiting';}
    w.state={start:'underway',call:'called',accept:'accepted',defer:'deferred',complete:'completed',cancel:'cancelled',resume:'waiting',call_cancel:'waiting',acknowledge:'accepted'}[input.event]??w.state;if(['accept','acknowledge'].includes(input.event))w.acknowledged_at=new Date().toISOString();w.version++;state.revision++;

    const event={id:crypto.randomUUID(),encounter_id:w.encounter_id,work_item_id:w.id,actor_id:'synthetic-user',event:input.event,recorded_at:new Date().toISOString(),occurred_at:new Date().toISOString(),previous_state:old,resulting_state:w.state,reason:input.reason??'',late_entry_reason:'',sequence_status:evidence.some(e=>e.encounter_id!==w.encounter_id&&e.urgency!==null&&state.visits.find(v=>v.id===w.encounter_id)?.clinical_urgency>e.urgency)?'provisional_sequence_review':'not_applicable',evidence_count:evidence.length,queue_snapshot:[],evidence};state.events.unshift(event);
    if(input.event==='start'&&event.sequence_status==='provisional_sequence_review')state.exceptions.push({id:crypto.randomUUID(),encounter_id:w.encounter_id,work_item_id:w.id,event_id:event.id,patient_ref:state.visits.find(v=>v.id===w.encounter_id)?.patient_ref,review_state:'unexplained',explanation:'',annotations:[],annotation_count:0});return reply({id:event.id,version:w.version,state:w.state});
   }
   if(url.pathname.includes('/exceptions/')){const e=state.exceptions.find(e=>e.id===url.pathname.split('/').at(-3));if(e){e.review_state='acknowledged';e.annotations.push({id:crypto.randomUUID(),explanation:input.explanation,recorded_at:new Date().toISOString()});state.revision++;}return reply({id:crypto.randomUUID()});}
   return reply({detail:'Unsupported synthetic operation'},400);
  }
  return reply({detail:'No synthetic handler; request blocked'},404);
 });
 return state;
}
