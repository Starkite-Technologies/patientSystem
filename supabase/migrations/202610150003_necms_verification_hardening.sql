-- LOCAL ONLY. Forward hardening after 3B; no data backfill or clinical rule changes.
begin;
-- FK lookup/history paths lacked matching leading columns.
create index coordination_encounter on public.coordination_work_items(hospital_id,encounter_id,id);
create index exception_hospital_time on public.operational_exceptions(hospital_id,created_at,id);
create index exception_annotation_history on public.exception_annotations(hospital_id,exception_id,recorded_at,id);
create index audit_encounter_history on public.audit_events(hospital_id,visit_id,created_at,id);
create index audit_patient_history on public.audit_events(hospital_id,patient_id,created_at,id) where visit_id is null;
-- Keep the existing service lock and lock candidates in deterministic encounter order.
-- Unrelated services no longer acquire share locks across all active encounters.
create or replace function public.necms_work_event(p_work uuid,p_version integer,p_event text,p_request uuid,p_input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
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
 perform 1 from public.visits e where e.hospital_id=h and e.ownership_state='verified'
 and (e.id=w.encounter_id or (e.status not in ('discharged','transferred') and exists(
 select 1 from public.coordination_work_items q where q.hospital_id=h and q.encounter_id=e.id
 and q.service_id=w.service_id and q.eligible and q.state in ('waiting','called','accepted'))))
 order by e.id for share;
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

revoke all on function public.necms_work_event(uuid,integer,text,uuid,jsonb) from public,anon;
grant execute on function public.necms_work_event(uuid,integer,text,uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
