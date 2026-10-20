-- 3E: additive operational summary fields only; no grants, clinical criteria or data rewrite.
begin;
create or replace function public.necms_read_page(p_kind text,p_filters jsonb default '{}',p_cursor uuid default null,p_size integer default 25) returns jsonb language plpgsql security definer set search_path='' as $$
declare h uuid; c necms_private.access_contexts; token necms_private.read_cursors; revision text; fingerprint text; position integer:=0; rows jsonb; total bigint; next_id uuid; query text; sort text; capability text; summary jsonb;
 dep uuid:=nullif(p_filters->>'department','')::uuid; service uuid:=nullif(p_filters->>'service','')::uuid;
 person uuid:=nullif(p_filters->>'clinician','')::uuid; team uuid:=nullif(p_filters->>'team','')::uuid;
 encounter uuid:=nullif(p_filters->>'encounter','')::uuid; record_id uuid:=nullif(p_filters->>'record','')::uuid;
 q text:=coalesce(p_filters->>'q',''); state text:=p_filters->>'state'; urgency text:=p_filters->>'urgency'; triage text:=p_filters->>'triage';
begin
 capability:=case p_kind when 'queue' then 'queue.read' when 'patients' then 'patient.identity.read' when 'encounters' then 'encounter.read'
 when 'assessments' then 'triage.read' when 'vitals' then 'triage.read' when 'timeline' then 'clinical.timeline.read' when 'work_events' then 'queue.read'
 when 'evidence' then 'queue.read' when 'exceptions' then 'exception.review' when 'annotations' then 'exception.review' when 'audit' then 'audit.summary.read'
 when 'staff' then 'queue.read' when 'teams' then 'queue.read' when 'services' then 'queue.read' when 'reasons' then 'queue.read' when 'departments' then 'encounter.read' when 'resources' then 'resource.read' else null end;
 if capability is null then raise exception 'Unknown read collection.' using errcode='23514';end if;
 h:=public.necms_require(capability);c:=public.necms_context();
 if p_filters is null or jsonb_typeof(p_filters)<>'object' then raise exception 'Filters must be an object.' using errcode='23514';end if;
 if exists(select 1 from jsonb_object_keys(p_filters) k where not (k=any(case p_kind
 when 'queue' then array['q','department','service','clinician','team','state','urgency','triage','encounter','closed']
 when 'encounters' then array['q','department','closed'] when 'patients' then array['q']
 when 'assessments' then array['encounter'] when 'vitals' then array['encounter'] when 'timeline' then array['encounter']
 when 'work_events' then array['encounter'] when 'exceptions' then array['encounter'] when 'audit' then array['encounter']
 when 'evidence' then array['record'] when 'annotations' then array['record'] else array['q'] end))) then
 raise exception 'Filter not supported for this collection.' using errcode='23514';end if;

 if p_size is null or p_size<1 or p_size>50 or jsonb_typeof(p_filters)<>'object' or length(q)>100
 or exists(select 1 from jsonb_object_keys(p_filters) k where k not in ('q','department','service','clinician','team','state','urgency','triage','encounter','record','closed'))
 or (p_filters ? 'closed' and jsonb_typeof(p_filters->'closed')<>'boolean') then raise exception 'Invalid page parameters.' using errcode='23514';end if;
 if state is not null and state not in ('waiting','called','accepted','underway','deferred','completed','cancelled') then raise exception 'Invalid work state.' using errcode='23514';end if;
 if triage is not null and triage not in ('legacy_unassessed','not_yet_triaged','awaiting_review','completed_provisional') then raise exception 'Invalid triage filter.' using errcode='23514';end if;
 if urgency is not null and urgency not in ('unknown','1','2','3','4','5') then raise exception 'Invalid provisional urgency.' using errcode='23514';end if;
 if dep is not null and not exists(select 1 from public.departments where hospital_id=h and id=dep) then raise exception 'Department not accessible.' using errcode='42501';end if;
 if service is not null and not exists(select 1 from public.coordination_services where hospital_id=h and id=service) then raise exception 'Service not accessible.' using errcode='42501';end if;
 if team is not null and not exists(select 1 from public.care_teams where hospital_id=h and id=team) then raise exception 'Team not accessible.' using errcode='42501';end if;
 if person is not null and not exists(select 1 from public.hospital_memberships where hospital_id=h and user_id=person and active) then raise exception 'Staff not accessible.' using errcode='42501';end if;
 if encounter is not null and not exists(select 1 from public.visits where hospital_id=h and ownership_state='verified' and id=encounter) then raise exception 'Encounter not accessible.' using errcode='42501';end if;
 if p_kind in ('queue','work_events','evidence') then perform public.necms_require('encounter.read');perform public.necms_require('patient.identity.read');end if;
 if p_kind='queue' then perform public.necms_require('resource.read');end if;
 if p_kind in ('exceptions','annotations') then perform public.necms_require('queue.read');perform public.necms_require('encounter.read');perform public.necms_require('patient.identity.read');end if;
 if p_kind in ('assessments','vitals','timeline') then perform public.necms_require('encounter.read');end if;
 if p_kind in ('assessments','vitals','timeline','work_events') and encounter is null then raise exception 'Encounter required.' using errcode='23514';end if;
 revision:=public.necms_read_revision(h);fingerprint:=md5(p_filters::text);
 if p_cursor is not null then
 select * into token from necms_private.read_cursors where id=p_cursor and user_id=auth.uid() and context_id=c.id and hospital_id=h and kind=p_kind;
 if not found then raise exception 'Read cursor not accessible.' using errcode='42501';end if;
 if token.expires_at<=clock_timestamp() or token.revision<>revision or token.filter_hash<>fingerprint or token.page_size<>p_size then raise exception 'Read sequence changed. Refresh from the first page.' using errcode='40001';end if;
 position:=token.position;end if;
 if p_kind='queue' then
 query:=$q$select jsonb_build_object('encounter',to_jsonb(e)-'notes','work',to_jsonb(w),'service_name',s.name,'team_name',t.name,'clinician_name',trim(p.first_name||' '||p.last_name)) item,
 case when e.urgency_source='provisional_manual' and e.latest_assessment_at is not null and e.clinical_urgency is not null then 1 else 0 end lane,
 case when e.urgency_source='provisional_manual' and e.latest_assessment_at is not null then coalesce(e.clinical_urgency,0) else 0 end rank,
 coalesce(w.queue_entered_at,e.arrived_at) entered,e.id eid,coalesce(w.id,'00000000-0000-0000-0000-000000000000'::uuid) wid
 from public.visit_board e left join public.coordination_work_items w on w.hospital_id=e.hospital_id and w.encounter_id=e.id and (coalesce(($2->>'closed')::boolean,false) or w.state not in ('completed','cancelled'))
 left join public.coordination_services s on s.id=w.service_id and s.hospital_id=$1 left join public.care_teams t on t.id=w.team_id and t.hospital_id=$1 left join public.staff_profiles p on p.id=w.assignee_id
 where e.hospital_id=$1 and e.ownership_state='verified' and (coalesce(($2->>'closed')::boolean,false) or e.status not in ('discharged','transferred'))
 and ($2->>'department' is null or e.department_id=($2->>'department')::uuid) and ($2->>'service' is null or w.service_id=($2->>'service')::uuid)
 and ($2->>'state' is null or w.state=$2->>'state') and ($2->>'triage' is null or e.triage_state=$2->>'triage')
 and ($2->>'team' is null or w.team_id=($2->>'team')::uuid) and ($2->>'clinician' is null or w.assignee_id=($2->>'clinician')::uuid)
 and ($2->>'encounter' is null or e.id=($2->>'encounter')::uuid)
 and (coalesce($2->>'q','')='' or strpos(lower(concat_ws(' ',e.patient_ref,e.temporary_identifier,e.first_name,e.last_name,w.title)),lower($2->>'q'))>0)
 and ($2->>'urgency' is null or case when e.urgency_source='provisional_manual' and e.latest_assessment_at is not null then coalesce(e.clinical_urgency::text,'unknown') else 'unknown' end=$2->>'urgency')$q$;
 sort:='lane,rank,entered,eid,wid';
 select jsonb_build_object('active_patients',count(*),'awaiting_triage',count(*) filter(where e.triage_state in ('legacy_unassessed','not_yet_triaged')),
 'awaiting_review',count(*) filter(where e.triage_state='awaiting_review'),'unknown_urgency',count(*) filter(where e.urgency_source<>'provisional_manual' or e.latest_assessment_at is null or e.clinical_urgency is null),
 'reviewed_patients',count(*) filter(where e.urgency_source='provisional_manual' and e.latest_assessment_at is not null and e.clinical_urgency is not null),
 'waiting_service_patients',count(*) filter(where exists(select 1 from public.coordination_work_items w where w.hospital_id=h and w.encounter_id=e.id and w.state in ('waiting','called','accepted'))),
 'underway_services',(select count(*) from public.coordination_work_items w join public.visits v on v.id=w.encounter_id and v.hospital_id=w.hospital_id where w.hospital_id=h and w.state='underway' and v.status not in ('discharged','transferred') and (dep is null or v.department_id=dep)),
 'pending_exceptions',case when public.necms_has('exception.review') then (select count(*) from public.operational_exceptions x join public.visits v on v.id=x.encounter_id and v.hospital_id=x.hospital_id where x.hospital_id=h and (dep is null or v.department_id=dep) and not exists(select 1 from public.exception_annotations a where a.exception_id=x.id)) else null end,
 'care_underway',count(*) filter(where e.status='in_treatment'),
 'provisional_waiting_by_label',jsonb_build_object('1',count(*) filter(where e.clinical_urgency=1 and e.urgency_source='provisional_manual' and exists(select 1 from public.coordination_work_items w where w.encounter_id=e.id and w.state in ('waiting','called','accepted'))),'2',count(*) filter(where e.clinical_urgency=2 and e.urgency_source='provisional_manual' and exists(select 1 from public.coordination_work_items w where w.encounter_id=e.id and w.state in ('waiting','called','accepted'))),'3',count(*) filter(where e.clinical_urgency=3 and e.urgency_source='provisional_manual' and exists(select 1 from public.coordination_work_items w where w.encounter_id=e.id and w.state in ('waiting','called','accepted'))),'4',count(*) filter(where e.clinical_urgency=4 and e.urgency_source='provisional_manual' and exists(select 1 from public.coordination_work_items w where w.encounter_id=e.id and w.state in ('waiting','called','accepted'))),'5',count(*) filter(where e.clinical_urgency=5 and e.urgency_source='provisional_manual' and exists(select 1 from public.coordination_work_items w where w.encounter_id=e.id and w.state in ('waiting','called','accepted')))),
 'unacknowledged_reviews',(select count(*) from public.coordination_work_items w join public.visits v on v.id=w.encounter_id where w.hospital_id=h and w.kind in ('urgent_review','nursing_reassessment') and w.state not in ('completed','cancelled') and w.acknowledged_at is null and (dep is null or v.department_id=dep)),
 'available_spaces',(select count(*) from public.resources r where r.hospital_id=h and r.ownership_state='verified' and r.state='available' and (dep is null or r.department_id=dep) and not exists(select 1 from public.visits v where v.resource_id=r.id and v.status not in ('discharged','transferred')))) into summary
 from public.visits e where e.hospital_id=h and e.ownership_state='verified' and e.status not in ('discharged','transferred') and (dep is null or e.department_id=dep);
 elsif p_kind='patients' then
 query:=$q$select jsonb_build_object('patient_id',id,'patient_ref',patient_ref,'first_name',first_name,'last_name',last_name,'date_of_birth',date_of_birth,'identity_status',identity_status,'temporary_identifier',temporary_identifier,'patient_version',version) item,lower(patient_ref) ref,id from public.patients where hospital_id=$1 and ownership_state='verified' and (coalesce($2->>'q','')='' or strpos(lower(concat_ws(' ',patient_ref,temporary_identifier,first_name,last_name,date_of_birth::text)),lower($2->>'q'))>0)$q$;sort:='ref,id';
 elsif p_kind='encounters' then
 perform public.necms_require('patient.identity.read');
 query:=$q$select to_jsonb(v) item,coalesce(clinical_urgency,priority,999) rank,arrived_at,id from public.visit_board v where hospital_id=$1 and ownership_state='verified' and (case when coalesce(($2->>'closed')::boolean,false) then status in ('discharged','transferred') else status not in ('discharged','transferred') end) and ($2->>'department' is null or department_id=($2->>'department')::uuid) and (coalesce($2->>'q','')='' or strpos(lower(concat_ws(' ',patient_ref,first_name,last_name,temporary_identifier)),lower($2->>'q'))>0)$q$;sort:='rank,arrived_at,id';
 elsif p_kind='assessments' then
 query:=$q$select to_jsonb(a)||jsonb_build_object('vitals',coalesce((select jsonb_agg(o order by observed_at,id) from public.vital_observations o where o.assessment_id=a.id),'[]'),'review',(select to_jsonb(r) from public.triage_reviews r where r.assessment_id=a.id)) item,assessed_at,id from public.triage_assessments a where hospital_id=$1 and encounter_id=($2->>'encounter')::uuid$q$;sort:='assessed_at desc,id desc';
 elsif p_kind='vitals' then
 query:=$q$select to_jsonb(o) item,o.observed_at,o.id from public.vital_observations o join public.triage_assessments a on a.id=o.assessment_id and a.hospital_id=o.hospital_id where o.hospital_id=$1 and a.encounter_id=($2->>'encounter')::uuid$q$;sort:='observed_at desc,id desc';
 elsif p_kind in ('timeline','audit') then
 query:=$q$select jsonb_build_object('id',a.id,'action',a.action,'actor',a.actor,'actor_id',a.actor_id,'created_at',a.created_at,'summary',a.summary,'category',case when a.action in ('initial_assessment_recorded','reassessment_recorded','assessment_reviewed','priority_changed') then 'clinical' else 'operational_or_administrative' end) item,a.created_at,a.id from public.audit_events a where a.hospital_id=$1 and a.ownership_state='verified' and ($2->>'encounter' is null or a.visit_id=($2->>'encounter')::uuid or (a.visit_id is null and a.patient_id=(select patient_id from public.visits where id=($2->>'encounter')::uuid and hospital_id=$1)))$q$;sort:='created_at desc,id desc';
 elsif p_kind='work_events' then
 query:=$q$select jsonb_build_object('id',id,'event',event,'work_item_id',work_item_id,'actor_id',actor_id,'recorded_at',recorded_at,'occurred_at',occurred_at,'previous_state',previous_state,'resulting_state',resulting_state,'reason',reason,'late_entry_reason',late_entry_reason,'sequence_status',sequence_status,'details',details,'queue_snapshot','[]'::jsonb,'evidence_count',jsonb_array_length(e.queue_snapshot)) item,e.recorded_at,e.id from public.coordination_events e where hospital_id=$1 and encounter_id=($2->>'encounter')::uuid$q$;sort:='recorded_at desc,id desc';
 elsif p_kind='evidence' then
 if not exists(select 1 from public.coordination_events where id=record_id and hospital_id=h) then raise exception 'Event not accessible.' using errcode='42501';end if;
 query:=$q$select value item,ordinality from public.coordination_events e cross join lateral jsonb_array_elements(e.queue_snapshot) with ordinality where e.hospital_id=$1 and e.id=($2->>'record')::uuid$q$;sort:='ordinality';
 elsif p_kind='exceptions' then
 query:=$q$select to_jsonb(e)||jsonb_build_object('patient_ref',(select p.patient_ref from public.patients p join public.visits v on v.patient_id=p.id and v.hospital_id=p.hospital_id where v.id=e.encounter_id and v.hospital_id=e.hospital_id),'annotation_count',(select count(*) from public.exception_annotations a where a.exception_id=e.id),'annotations','[]'::jsonb,'review_state',case when exists(select 1 from public.exception_annotations a where a.exception_id=e.id) then 'acknowledged' when e.reason_category_id is not null or nullif(e.explanation,'') is not null then 'documented_pending_review' else 'unexplained' end) item,e.created_at,e.id from public.operational_exceptions e where hospital_id=$1 and ($2->>'encounter' is null or encounter_id=($2->>'encounter')::uuid)$q$;sort:='created_at desc,id desc';
 elsif p_kind='annotations' then
 if not exists(select 1 from public.operational_exceptions where id=record_id and hospital_id=h) then raise exception 'Exception not accessible.' using errcode='42501';end if;
 query:=$q$select to_jsonb(a) item,recorded_at,id from public.exception_annotations a where hospital_id=$1 and exception_id=($2->>'record')::uuid$q$;sort:='recorded_at desc,id desc';
 elsif p_kind='staff' then
 perform public.necms_require('patient.identity.read');
 query:=$q$select jsonb_build_object('id',m.user_id,'name',trim(p.first_name||' '||p.last_name)) item,m.user_id id from public.hospital_memberships m join public.staff_profiles p on p.id=m.user_id where m.hospital_id=$1 and m.active and (m.valid_until is null or m.valid_until>statement_timestamp()) and (coalesce($2->>'q','')='' or strpos(lower(p.first_name||' '||p.last_name),lower($2->>'q'))>0)$q$;sort:='id';
 else
 query:=case p_kind when 'services' then 'select to_jsonb(t) item,name,id from public.coordination_services t where hospital_id=$1 and active'
 when 'teams' then 'select to_jsonb(t) item,name,id from public.care_teams t where hospital_id=$1 and active'
 when 'reasons' then 'select to_jsonb(t) item,name,id from public.operational_reason_categories t where hospital_id=$1 and active'
 when 'departments' then 'select to_jsonb(t) item,name,id from public.departments t where hospital_id=$1 and active'
 when 'resources' then 'select to_jsonb(t)||jsonb_build_object(''occupied'',exists(select 1 from public.visits v where v.hospital_id=$1 and v.resource_id=t.id and v.status not in (''discharged'',''transferred''))) item,name,id from public.resources t where hospital_id=$1 and ownership_state=''verified''' end;
 query:=query||' and (coalesce($2->>''q'','''')='''' or strpos(lower(name),lower($2->>''q''))>0)';sort:='name,id';
 end if;
 execute 'select count(*) from ('||query||') matched' into total using h,p_filters;
 execute 'select coalesce(jsonb_agg(item),''[]''::jsonb) from (select item from ('||query||') matched order by '||sort||' limit $3 offset $4) page' into rows using h,p_filters,p_size,position;
 if public.necms_read_revision(h)<>revision then raise exception 'Read sequence changed. Refresh from the first page.' using errcode='40001';end if;
 perform public.necms_require(capability);
 if position+p_size<total then insert into necms_private.read_cursors(user_id,context_id,hospital_id,kind,filter_hash,revision,page_size,position) values(auth.uid(),c.id,h,p_kind,fingerprint,revision,p_size,position+p_size) returning id into next_id;end if;
 delete from necms_private.read_cursors where id in (select id from necms_private.read_cursors where user_id=auth.uid() and expires_at<clock_timestamp() limit 100);
 return jsonb_build_object('items',rows,'total',total,'next_cursor',next_id,'revision',revision,'server_time',statement_timestamp(),'summary',summary,'scope',jsonb_build_object('hospital_id',h,'department_id',dep),'capabilities',(public.necms_context_info())->'capabilities');
end $$;
revoke all on function public.necms_read_page(text,jsonb,uuid,integer) from public,anon;
grant execute on function public.necms_read_page(text,jsonb,uuid,integer) to authenticated;
notify pgrst,'reload schema';
commit;
