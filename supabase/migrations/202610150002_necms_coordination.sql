-- LOCAL ONLY. Operational coordination, not medical orders or approved triage.
begin;
insert into public.capabilities values ('queue.read'),('queue.coordinate'),('patient.call'),('service.accept'),('treatment.record'),('work.create'),('work.assign'),('work.complete'),('reassessment.request'),('escalation.acknowledge'),('exception.review'),('coordination.configure');
create table public.coordination_services(id uuid primary key default gen_random_uuid(),hospital_id uuid not null references public.hospitals,code text not null,name text not null check(length(trim(name)) between 1 and 120),active boolean not null default true,unique(hospital_id,id),unique(hospital_id,code));
create table public.care_teams(id uuid primary key default gen_random_uuid(),hospital_id uuid not null references public.hospitals,name text not null check(length(trim(name)) between 1 and 120),active boolean not null default true,unique(hospital_id,id),unique(hospital_id,name));
create table public.care_team_members(hospital_id uuid not null,team_id uuid not null,user_id uuid not null,primary key(team_id,user_id),foreign key(hospital_id,team_id) references public.care_teams(hospital_id,id),foreign key(hospital_id,user_id) references public.hospital_memberships(hospital_id,user_id));
create table public.operational_reason_categories(id uuid primary key default gen_random_uuid(),hospital_id uuid not null references public.hospitals,code text not null,name text not null check(length(trim(name)) between 1 and 160),active boolean not null default true,unique(hospital_id,id),unique(hospital_id,code));
create table public.future_escalation_policies(id uuid primary key default gen_random_uuid(),hospital_id uuid not null references public.hospitals,version text not null,document_reference text not null,active boolean not null default false check(active=false),created_by uuid not null references auth.users,created_at timestamptz not null default clock_timestamp(),unique(hospital_id,version));
create table public.coordination_work_items(
 id uuid primary key default gen_random_uuid(),hospital_id uuid not null,encounter_id uuid not null,ownership_state text not null default 'verified' check(ownership_state='verified'),service_id uuid not null,
 kind text not null check(kind in ('initial_review','nursing_reassessment','laboratory','imaging','treatment','transfer_preparation','urgent_review','other')),
 state text not null default 'waiting' check(state in ('waiting','called','accepted','underway','deferred','completed','cancelled')),
 eligible boolean not null default false,assignee_id uuid,team_id uuid,created_by uuid not null references auth.users,
 created_at timestamptz not null default clock_timestamp(),queue_entered_at timestamptz not null default clock_timestamp(),acknowledged_at timestamptz,completed_at timestamptz,
 title text not null check(length(trim(title)) between 1 and 200),version integer not null default 1,
 unique(hospital_id,id),unique(hospital_id,encounter_id,id),foreign key(hospital_id,encounter_id,ownership_state) references public.visits(hospital_id,id,ownership_state),
 foreign key(hospital_id,service_id) references public.coordination_services(hospital_id,id),foreign key(hospital_id,assignee_id) references public.hospital_memberships(hospital_id,user_id),foreign key(hospital_id,team_id) references public.care_teams(hospital_id,id)
);
create index coordination_queue on public.coordination_work_items(hospital_id,service_id,state,eligible,queue_entered_at,id);
create table public.coordination_events(
 id uuid primary key default gen_random_uuid(),hospital_id uuid not null,encounter_id uuid not null,work_item_id uuid not null,
 actor_id uuid not null references auth.users,event text not null,recorded_at timestamptz not null default clock_timestamp(),occurred_at timestamptz not null,
 previous_state text,resulting_state text not null,previous_version integer,resulting_version integer not null,
 reason text not null default '' check(length(reason)<=1000),late_entry_reason text not null default '' check(length(late_entry_reason)<=500),
 request_id uuid not null,details jsonb not null default '{}',queue_snapshot jsonb not null default '[]',sequence_status text not null default 'not_applicable',
 unique(hospital_id,id),foreign key(hospital_id,encounter_id,work_item_id) references public.coordination_work_items(hospital_id,encounter_id,id),check(occurred_at<=recorded_at)
);
create index coordination_history on public.coordination_events(hospital_id,encounter_id,recorded_at,id);
create table public.operational_exceptions(
 id uuid primary key default gen_random_uuid(),hospital_id uuid not null,encounter_id uuid not null,work_item_id uuid not null,event_id uuid not null,
 reason_category_id uuid,explanation text not null default '' check(length(explanation)<=1000),created_at timestamptz not null default clock_timestamp(),
 unique(hospital_id,id),unique(event_id),foreign key(hospital_id,event_id) references public.coordination_events(hospital_id,id),
 foreign key(hospital_id,encounter_id,work_item_id) references public.coordination_work_items(hospital_id,encounter_id,id),foreign key(hospital_id,reason_category_id) references public.operational_reason_categories(hospital_id,id)
);
create table public.exception_annotations(
 id uuid primary key default gen_random_uuid(),hospital_id uuid not null,exception_id uuid not null,actor_id uuid not null references auth.users,
 reason_category_id uuid not null,explanation text not null check(length(trim(explanation)) between 1 and 1000),recorded_at timestamptz not null default clock_timestamp(),
 foreign key(hospital_id,exception_id) references public.operational_exceptions(hospital_id,id),foreign key(hospital_id,reason_category_id) references public.operational_reason_categories(hospital_id,id)
);
create table necms_private.coordination_requests(hospital_id uuid not null,actor_id uuid not null,request_id uuid not null,operation text not null,payload_hash text not null,result jsonb,primary key(hospital_id,actor_id,request_id));
alter table necms_private.coordination_requests enable row level security;
revoke all on necms_private.coordination_requests from public,anon,authenticated;
do $$ declare t text; begin
 foreach t in array array['coordination_services','care_teams','care_team_members','operational_reason_categories','future_escalation_policies','coordination_work_items','coordination_events','operational_exceptions','exception_annotations'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('create policy coordination_read on public.%I for select to authenticated using(hospital_id=(public.necms_context()).hospital_id and public.necms_has(''queue.read'') and public.necms_has(''encounter.read'') and public.necms_has(''patient.identity.read'')%s)',t,case when t in ('operational_exceptions','exception_annotations') then ' and public.necms_has(''exception.review'')' when t='future_escalation_policies' then ' and public.necms_has(''coordination.configure'')' else '' end);
 execute format('grant select on public.%I to authenticated',t);
 if t in ('coordination_events','operational_exceptions','exception_annotations','future_escalation_policies') then
 execute format('create trigger immutable_history before update or delete on public.%I for each row execute function public.necms_immutable_history()',t); end if;
 end loop; end $$;

create function public.necms_coord_retry(h uuid,r uuid,op text,payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare entry necms_private.coordination_requests; fingerprint text:=encode(sha256(convert_to(payload::text,'UTF8')),'hex'); begin
 if r is null then raise exception 'Retry identifier required.' using errcode='23514'; end if;
 perform pg_advisory_xact_lock(hashtextextended(h::text||auth.uid()::text||r::text,0));
 insert into necms_private.coordination_requests values(h,auth.uid(),r,op,fingerprint,null) on conflict do nothing;
 select * into entry from necms_private.coordination_requests where hospital_id=h and actor_id=auth.uid() and request_id=r for update;
 if entry.operation<>op or entry.payload_hash<>fingerprint then raise exception 'Retry identifier payload changed.' using errcode='23514'; end if;
 return entry.result; end $$;
create function public.necms_coord_finish(h uuid,r uuid,result_value jsonb) returns jsonb language plpgsql security definer set search_path='' as $$ begin
 update necms_private.coordination_requests set result=result_value where hospital_id=h and actor_id=auth.uid() and request_id=r; return result_value; end $$;
create function public.necms_validate_responsibility(h uuid,person uuid,team uuid) returns void language plpgsql security definer set search_path='' as $$ begin
 if person is not null and not exists(select 1 from public.hospital_memberships m join public.staff_profiles p on p.id=m.user_id where m.hospital_id=h and m.user_id=person and m.active and (m.valid_until is null or m.valid_until>statement_timestamp())) then raise exception 'Active hospital staff required.' using errcode='42501'; end if;
 if team is not null and not exists(select 1 from public.care_teams where hospital_id=h and id=team and active) then raise exception 'Active hospital team required.' using errcode='42501'; end if;
 if person is not null and team is not null and not exists(select 1 from public.care_team_members where hospital_id=h and team_id=team and user_id=person) then raise exception 'Staff does not belong to selected team.' using errcode='42501'; end if;
end $$;
create function public.necms_create_work(p_input jsonb,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare h uuid; actor uuid:=public.necms_clinical_actor(); existing jsonb; w public.coordination_work_items; v public.visits;
 service uuid:=(p_input->>'service_id')::uuid; encounter uuid:=(p_input->>'encounter_id')::uuid;
 person uuid:=nullif(p_input->>'assignee_id','')::uuid; team uuid:=nullif(p_input->>'team_id','')::uuid; event_id uuid; event_kind text; event_time timestamptz;
begin
 h:=public.necms_require(case when p_input->>'kind' in ('nursing_reassessment','urgent_review') then 'reassessment.request' else 'work.create' end,true);
 existing:=public.necms_coord_retry(h,p_request,'create',p_input);if existing is not null then return existing; end if;
 if p_input ? 'hospital_id' then raise exception 'Ownership is server controlled.' using errcode='42501'; end if;
 if not exists(select 1 from public.coordination_services where id=service and hospital_id=h and active) then raise exception 'Service not accessible.' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(h::text||service::text,1));
 select * into v from public.visits where id=encounter and hospital_id=h and ownership_state='verified' for share;
 if not found or v.status in ('discharged','transferred') then raise exception 'Active encounter required.' using errcode='42501'; end if;
 if p_input->>'kind' in ('nursing_reassessment','urgent_review') and person is null and team is null then person:=actor; end if;
 if person is not null and person<>actor or team is not null then perform public.necms_require('work.assign',true); end if;
 perform public.necms_validate_responsibility(h,person,team);
 insert into public.coordination_work_items(hospital_id,encounter_id,service_id,kind,eligible,assignee_id,team_id,created_by,title)
 values(h,encounter,service,p_input->>'kind',coalesce((p_input->>'eligible')::boolean,false),person,team,actor,trim(p_input->>'title')) returning * into w;
 event_kind:=case w.kind when 'urgent_review' then 'urgent_review_requested' when 'nursing_reassessment' then 'reassessment_requested' else 'work_created' end;
 event_time:=clock_timestamp();
 insert into public.coordination_events(hospital_id,encounter_id,work_item_id,actor_id,event,recorded_at,occurred_at,resulting_state,resulting_version,request_id,details)
 values(h,encounter,w.id,actor,event_kind,event_time,event_time,'waiting',1,p_request,jsonb_build_object('service_id',service,'assignee_id',person,'team_id',team)) returning id into event_id;
 perform public.necms_foundation_event(h,encounter,v.patient_id,event_kind,jsonb_build_object('work_item_id',w.id,'event_id',event_id));
 return public.necms_coord_finish(h,p_request,jsonb_build_object('id',w.id,'event_id',event_id,'version',1));
end $$;

create function public.necms_work_event(p_work uuid,p_version integer,p_event text,p_request uuid,p_input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare h uuid; actor uuid:=public.necms_clinical_actor(); w public.coordination_work_items; v public.visits; current_w public.coordination_work_items;
 cap text; previous jsonb; result_state text; evidence jsonb:='[]'; event_id uuid; comparison text:='not_applicable';
 reason text:=coalesce(p_input->>'reason',''); late_reason text:=coalesce(p_input->>'late_entry_reason',''); happened timestamptz;
 person uuid; team uuid; category uuid:=nullif(p_input->>'reason_category_id','')::uuid; higher integer:=0;
begin
 cap:=case p_event when 'call' then 'patient.call' when 'call_cancel' then 'patient.call' when 'accept' then 'service.accept' when 'acknowledge' then 'escalation.acknowledge' when 'start' then 'treatment.record' when 'complete' then 'work.complete' when 'reassign' then 'work.assign' when 'defer' then 'queue.coordinate' when 'resume' then 'queue.coordinate' when 'cancel' then 'queue.coordinate' when 'readiness' then 'queue.coordinate' else null end;
 if cap is null then raise exception 'Unknown coordination event.' using errcode='23514'; end if;
 h:=public.necms_require(cap,true);
 previous:=public.necms_coord_retry(h,p_request,'event',jsonb_build_object('work',p_work,'version',p_version,'event',p_event,'input',p_input));if previous is not null then return previous; end if;
 select * into w from public.coordination_work_items where id=p_work and hospital_id=h;
 if not found then raise exception 'Work item not accessible.' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(h::text||w.service_id::text,1));
 select * into w from public.coordination_work_items where id=p_work and hospital_id=h for update;
 if w.version is distinct from p_version then raise exception 'This work item was updated elsewhere. Refresh before retrying.' using errcode='40001'; end if;
 if w.state in ('completed','cancelled') then raise exception 'Work item is terminal.' using errcode='23514'; end if;
 -- Stable snapshot against concurrent encounter urgency changes (not a clinical lock policy).
 perform 1 from public.visits where hospital_id=h and ownership_state='verified' and status not in ('discharged','transferred') order by id for share;
 select * into v from public.visits where id=w.encounter_id and hospital_id=h;
 if v.status in ('discharged','transferred') and p_event<>'cancel' then raise exception 'Encounter is closed; cancel remaining coordination explicitly.' using errcode='23514'; end if;
 person:=w.assignee_id;team:=w.team_id;result_state:=w.state;
 if p_event in ('call_cancel','defer','cancel','reassign') and nullif(trim(reason),'') is null then raise exception 'Operational reason required.' using errcode='23514'; end if;
 if p_event='call' and w.state='waiting' then result_state:='called';
 elsif p_event='call_cancel' and w.state='called' then result_state:='waiting';
 elsif p_event in ('accept','acknowledge') and (w.state in ('waiting','called') or (p_event='acknowledge' and w.state='deferred') or (w.state='underway' and w.acknowledged_at is null)) then
  if p_event='acknowledge' and w.kind not in ('urgent_review','nursing_reassessment') then raise exception 'Not a clinical review request.' using errcode='23514'; end if;
  if person is not null and person<>actor then raise exception 'Only responsible staff can accept.' using errcode='42501'; end if;
  if team is not null and not exists(select 1 from public.care_team_members where hospital_id=h and team_id=team and user_id=actor) then raise exception 'Team membership required.' using errcode='42501'; end if;
  person:=actor;perform public.necms_validate_responsibility(h,person,team);result_state:=case when w.state='underway' then 'underway' else 'accepted' end;
 elsif p_event='defer' and w.state in ('waiting','called','accepted') then result_state:='deferred';
 elsif p_event='resume' and w.state='deferred' then result_state:='waiting';
 elsif p_event='start' and w.state in ('waiting','called','accepted','deferred') then result_state:='underway';
 elsif p_event='complete' and w.state in ('accepted','underway') then result_state:='completed';
 elsif p_event='cancel' then result_state:='cancelled';
 elsif p_event='reassign' then
  person:=nullif(p_input->>'assignee_id','')::uuid;team:=nullif(p_input->>'team_id','')::uuid;
  if w.kind in ('urgent_review','nursing_reassessment') and person is null and team is null then raise exception 'Clinical request requires an explicit owner.' using errcode='23514'; end if;
  perform public.necms_validate_responsibility(h,person,team);
  if w.state='accepted' then result_state:='waiting';end if;
 elsif p_event='readiness' and jsonb_typeof(p_input->'eligible')='boolean' then null;
 else raise exception 'Invalid work item transition.' using errcode='23514'; end if;
 happened:=coalesce(nullif(p_input->>'occurred_at','')::timestamptz,clock_timestamp());
 if p_input->>'occurred_at' is not null and nullif(trim(late_reason),'') is null then raise exception 'Earlier occurrence requires a late-entry explanation.' using errcode='23514'; end if;
 if happened>clock_timestamp() then raise exception 'Occurrence cannot be in the future.' using errcode='23514'; end if;
 if category is not null and not exists(select 1 from public.operational_reason_categories where id=category and hospital_id=h and active) then raise exception 'Reason category not accessible.' using errcode='42501'; end if;
 if p_event='start' then
  select coalesce(jsonb_agg(jsonb_build_object('work_item_id',q.id,'encounter_id',q.encounter_id,'patient_ref',p.patient_ref,'service_id',q.service_id,'state',q.state,'eligible',q.eligible,'version',q.version,'assignee_id',q.assignee_id,'team_id',q.team_id,'queue_entered_at',q.queue_entered_at,'urgency',case when e.latest_assessment_at is not null and e.urgency_source='provisional_manual' then e.clinical_urgency end,'urgency_source',e.urgency_source,'triage_state',e.triage_state) order by q.queue_entered_at,q.id),'[]') into evidence
  from public.coordination_work_items q join public.visits e on e.id=q.encounter_id and e.hospital_id=q.hospital_id
  join public.patients p on p.id=e.patient_id and p.hospital_id=h
  where q.hospital_id=h and q.service_id=w.service_id and q.id<>w.id and q.eligible and q.state in ('waiting','called','accepted') and e.status not in ('discharged','transferred');
  if v.latest_assessment_at is not null and v.urgency_source='provisional_manual' and v.clinical_urgency is not null then
   select count(*) into higher from jsonb_array_elements(evidence) item where (item->>'urgency')::integer<v.clinical_urgency and (item->>'encounter_id')::uuid<>w.encounter_id;
   comparison:=case when higher>0 then 'provisional_sequence_review' else 'no_higher_reviewed_candidate_recorded' end;
  else comparison:='unknown_or_unreviewed_urgency'; end if;
 end if;
 update public.coordination_work_items set state=result_state,assignee_id=person,team_id=team,
 eligible=case when p_event='readiness' then (p_input->>'eligible')::boolean else eligible end,
 acknowledged_at=case when p_event in ('accept','acknowledge') then clock_timestamp() when p_event='reassign' then null else acknowledged_at end,
 completed_at=case when result_state in ('completed','cancelled') then clock_timestamp() else completed_at end,version=version+1 where id=w.id returning * into current_w;
 insert into public.coordination_events(hospital_id,encounter_id,work_item_id,actor_id,event,occurred_at,previous_state,resulting_state,previous_version,resulting_version,reason,late_entry_reason,request_id,details,queue_snapshot,sequence_status)
 values(h,w.encounter_id,w.id,actor,case when p_event='acknowledge' then 'escalation_acknowledged' else p_event end,happened,w.state,result_state,w.version,current_w.version,reason,late_reason,p_request,
 jsonb_build_object('previous_assignee_id',w.assignee_id,'assignee_id',person,'previous_team_id',w.team_id,'team_id',team,'service_id',w.service_id,'previous_eligible',w.eligible,'eligible',current_w.eligible,'reason_category_id',category,'snapshot_basis','recording_time','late_documentation',p_input->>'occurred_at' is not null,'target_reviewed_urgency',case when v.latest_assessment_at is not null and v.urgency_source='provisional_manual' then v.clinical_urgency end,'target_urgency_source',v.urgency_source,'target_triage_state',v.triage_state),evidence,comparison) returning id into event_id;
 if higher>0 then insert into public.operational_exceptions(hospital_id,encounter_id,work_item_id,event_id,reason_category_id,explanation) values(h,w.encounter_id,w.id,event_id,category,reason); end if;
 perform public.necms_foundation_event(h,w.encounter_id,v.patient_id,'coordination_'||p_event,jsonb_build_object('work_item_id',w.id,'event_id',event_id,'previous_state',w.state,'state',result_state));
 return public.necms_coord_finish(h,p_request,jsonb_build_object('id',event_id,'work_item_id',w.id,'version',current_w.version,'state',result_state));
end $$;

create function public.necms_review_sequence(p_exception uuid,p_category uuid,p_explanation text,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare h uuid:=public.necms_require('exception.review',true);actor uuid:=public.necms_clinical_actor(); e public.operational_exceptions; previous jsonb;saved uuid;begin
 previous:=public.necms_coord_retry(h,p_request,'exception_review',jsonb_build_object('exception',p_exception,'category',p_category,'explanation',p_explanation));if previous is not null then return previous; end if;
 select * into e from public.operational_exceptions where id=p_exception and hospital_id=h;
 if not found or not exists(select 1 from public.operational_reason_categories where id=p_category and hospital_id=h and active) then raise exception 'Review record/category not accessible.' using errcode='42501'; end if;
 insert into public.exception_annotations(hospital_id,exception_id,actor_id,reason_category_id,explanation) values(h,e.id,actor,p_category,p_explanation) returning id into saved;
 perform public.necms_foundation_event(h,e.encounter_id,(select patient_id from public.visits where id=e.encounter_id),'operational_exception_acknowledged',jsonb_build_object('exception_id',e.id,'annotation_id',saved));
 return public.necms_coord_finish(h,p_request,jsonb_build_object('id',saved));end $$;

create function public.necms_coordination_configuration(p_request uuid,p_input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare h uuid:=public.necms_require('coordination.configure',true);actor uuid:=public.necms_clinical_actor();previous jsonb;saved uuid;kind text:=p_input->>'kind';begin
 previous:=public.necms_coord_retry(h,p_request,'configuration',p_input);if previous is not null then return previous;end if;
 if kind='service' then insert into public.coordination_services(hospital_id,code,name) values(h,p_input->>'code',trim(p_input->>'name')) returning id into saved;
 elsif kind='team' then insert into public.care_teams(hospital_id,name) values(h,trim(p_input->>'name')) returning id into saved;
 elsif kind='reason' then insert into public.operational_reason_categories(hospital_id,code,name) values(h,p_input->>'code',trim(p_input->>'name')) returning id into saved;
 elsif kind='team_member' then
 perform public.necms_validate_responsibility(h,(p_input->>'user_id')::uuid,null);perform public.necms_validate_responsibility(h,null,(p_input->>'team_id')::uuid);
 insert into public.care_team_members values(h,(p_input->>'team_id')::uuid,(p_input->>'user_id')::uuid);saved:=(p_input->>'team_id')::uuid;
 elsif kind='inactive_policy' and nullif(trim(p_input->>'document_reference'),'') is not null then
 insert into public.future_escalation_policies(hospital_id,version,document_reference,created_by) values(h,p_input->>'version',p_input->>'document_reference',actor) returning id into saved;
 else raise exception 'Only operational configuration or inactive policy references are allowed.' using errcode='23514'; end if;
 if p_input ? 'active' or p_input ? 'threshold' or p_input ? 'deadline' then raise exception 'Clinical activation is not available.' using errcode='42501';end if;
 perform public.necms_foundation_event(h,null,null,'coordination_configuration_created',jsonb_build_object('kind',kind,'id',saved));
 return public.necms_coord_finish(h,p_request,jsonb_build_object('id',saved));end $$;

create function public.necms_coordination_board() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare h uuid:=public.necms_require('queue.read');begin
 perform public.necms_require('encounter.read');perform public.necms_require('patient.identity.read');perform public.necms_require('resource.read');
 return public.necms_board()||jsonb_build_object('server_time',statement_timestamp(),
 'closed_encounters',coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'patient_ref',v.patient_ref,'arrived_at',v.arrived_at,'triage_state',v.triage_state,'clinical_urgency',v.clinical_urgency,'urgency_source',v.urgency_source,'latest_assessment_at',v.latest_assessment_at,'status',v.status,'location',v.location,'resource_id',v.resource_id,'assigned_to',v.assigned_to,'priority',v.priority)) from public.visit_board v where v.hospital_id=h and v.status in ('discharged','transferred') and exists(select 1 from public.coordination_work_items w where w.encounter_id=v.id and w.hospital_id=h)),'[]'),
 'work_items',coalesce((select jsonb_agg(w order by queue_entered_at,id) from public.coordination_work_items w where hospital_id=h),'[]'),
 'services',coalesce((select jsonb_agg(s) from public.coordination_services s where hospital_id=h and active),'[]'),
 'teams',coalesce((select jsonb_agg(t) from public.care_teams t where hospital_id=h and active),'[]'),
 'staff',coalesce((select jsonb_agg(jsonb_build_object('id',m.user_id,'name',trim(p.first_name||' '||p.last_name))) from public.hospital_memberships m join public.staff_profiles p on p.id=m.user_id where m.hospital_id=h and m.active and (m.valid_until is null or m.valid_until>statement_timestamp())),'[]'),
 'reasons',coalesce((select jsonb_agg(r) from public.operational_reason_categories r where hospital_id=h and active),'[]'),
 'exceptions',case when public.necms_has('exception.review') then coalesce((select jsonb_agg(to_jsonb(e)||jsonb_build_object('review_state',case when exists(select 1 from public.exception_annotations a where a.exception_id=e.id) then 'acknowledged' when e.reason_category_id is not null or nullif(e.explanation,'') is not null then 'documented_pending_review' else 'unexplained' end,'annotations',coalesce((select jsonb_agg(a order by recorded_at,id) from public.exception_annotations a where a.exception_id=e.id),'[]'))) from public.operational_exceptions e where hospital_id=h),'[]') else '[]'::jsonb end);
end $$;
create function public.necms_coordination_history(p_encounter uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare h uuid:=public.necms_require('queue.read');begin
 perform public.necms_require('encounter.read');
 perform public.necms_require('patient.identity.read');
 if not exists(select 1 from public.visits where id=p_encounter and hospital_id=h and ownership_state='verified') then raise exception 'Encounter not accessible.' using errcode='42501';end if;
 return coalesce((select jsonb_agg(e order by recorded_at,id) from public.coordination_events e where hospital_id=h and encounter_id=p_encounter),'[]');end $$;
do $$ declare f record;begin
 for f in select oid::regprocedure signature,proname from pg_proc where pronamespace='public'::regnamespace and proname in ('necms_coord_retry','necms_coord_finish','necms_validate_responsibility','necms_create_work','necms_work_event','necms_review_sequence','necms_coordination_configuration','necms_coordination_board','necms_coordination_history') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 if f.proname not in ('necms_coord_retry','necms_coord_finish','necms_validate_responsibility') then execute format('grant execute on function %s to authenticated',f.signature);end if;
 end loop;end $$;
notify pgrst,'reload schema';
commit;
