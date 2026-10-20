-- LOCAL SYNTHETIC TESTING ONLY. No hosted execution is authorised.
-- No clinical thresholds, scores, intervals or default capability grants.
begin;
insert into public.capabilities(code) values
 ('arrival.register'),('identity.reconcile'),('triage.read'),('triage.create'),
 ('triage.review'),('triage.reassess'),('priority.amend'),('protocol.admin'),('protocol.approve'),('clinical.timeline.read');

alter table public.patients alter column first_name drop not null, alter column last_name drop not null,
 add column identity_status text not null default 'confirmed' check(identity_status in ('confirmed','provisional')),
 add column temporary_identifier text unique,
 add constraint confirmed_identity check(identity_status='provisional' or (first_name is not null and last_name is not null));
alter table public.visits alter column priority drop not null, alter column complaint drop not null,
 add column triage_state text not null default 'legacy_unassessed' check(triage_state in ('legacy_unassessed','not_yet_triaged','awaiting_review','completed_provisional')),
 add column clinical_urgency integer check(clinical_urgency between 1 and 5),
 add column urgency_source text not null default 'legacy_unvalidated' check(urgency_source in ('legacy_unvalidated','not_assessed','provisional_manual')),
 add column latest_assessment_at timestamptz;

create table public.emergency_arrivals (
 id uuid primary key default gen_random_uuid(), hospital_id uuid not null references public.hospitals,
 department_id uuid not null, patient_id uuid not null, encounter_id uuid not null,
 ownership_state text not null default 'verified' check(ownership_state='verified'),
 arrived_at timestamptz not null default clock_timestamp(), source text not null check(source in ('walk-in','ambulance','referral','other')),
 referring_facility text check(length(referring_facility)<=200), identity_status text not null check(identity_status in ('confirmed','provisional')),
 immediate_care boolean not null default false, actor_id uuid not null references auth.users,
 request_id uuid not null, payload_hash text not null,
 unique(hospital_id,id), unique(encounter_id), unique(hospital_id,actor_id,request_id),
 foreign key(hospital_id,department_id) references public.departments(hospital_id,id),
 foreign key(hospital_id,patient_id,ownership_state) references public.patients(hospital_id,id,ownership_state),
 foreign key(hospital_id,encounter_id,ownership_state) references public.visits(hospital_id,id,ownership_state)
);
create table public.identity_reconciliations (
 id uuid primary key default gen_random_uuid(), hospital_id uuid not null, patient_id uuid not null,
 ownership_state text not null default 'verified' check(ownership_state='verified'),
 actor_id uuid not null references auth.users, recorded_at timestamptz not null default clock_timestamp(),
 reason text not null check(length(trim(reason)) between 1 and 500), previous_identity jsonb not null, completed_identity jsonb not null,
 foreign key(hospital_id,patient_id,ownership_state) references public.patients(hospital_id,id,ownership_state)
);
-- Draft registry only. No application function can approve/activate a protocol.
-- Separate governed clinical approval/activation is deliberately deferred to 3B.
create table public.triage_protocol_versions (
 id uuid primary key default gen_random_uuid(), hospital_id uuid not null references public.hospitals,
 protocol_identifier text not null check(length(trim(protocol_identifier)) between 1 and 100), version text not null check(length(trim(version)) between 1 and 50),
 approval_status text not null default 'draft' check(approval_status in ('draft','approved','rejected')),
 activation_status text not null default 'inactive' check(activation_status in ('inactive','active','retired')),
 effective_from timestamptz, effective_until timestamptz, created_by uuid not null references auth.users, created_at timestamptz not null default clock_timestamp(),
 approved_by uuid references auth.users, approved_at timestamptz, approval_reference text,
 unique(hospital_id,id), unique(hospital_id,protocol_identifier,version),
 check(effective_until is null or (effective_from is not null and effective_until>effective_from)),
 check(approval_status<>'approved' or (approved_by is not null and approved_at is not null and nullif(trim(approval_reference),'') is not null and approved_by<>created_by)),
 check(activation_status<>'active' or (approval_status='approved' and effective_from is not null))
);
create table public.triage_assessments (
 id uuid primary key default gen_random_uuid(), hospital_id uuid not null, encounter_id uuid not null,
 ownership_state text not null default 'verified' check(ownership_state='verified'),
 kind text not null check(kind in ('initial','reassessment')), assessor_id uuid not null references auth.users,
 assessed_at timestamptz not null default clock_timestamp(), complaint text not null check(length(trim(complaint)) between 1 and 300),
 observations jsonb not null default '{}' check(jsonb_typeof(observations)='object' and octet_length(observations::text)<=5000),
 manual_priority integer not null check(manual_priority between 1 and 5), urgency_source text not null default 'provisional_manual' check(urgency_source='provisional_manual'),
 status text not null default 'recorded' check(status='recorded'), notes text not null default '' check(length(notes)<=2000),
 protocol_version_id uuid, request_id uuid not null, payload_hash text not null,
 unique(hospital_id,id), unique(hospital_id,encounter_id,id), unique(hospital_id,assessor_id,request_id),
 foreign key(hospital_id,encounter_id,ownership_state) references public.visits(hospital_id,id,ownership_state),
 foreign key(hospital_id,protocol_version_id) references public.triage_protocol_versions(hospital_id,id)
);
create unique index one_initial_assessment on public.triage_assessments(encounter_id) where kind='initial';
create index triage_encounter_time on public.triage_assessments(hospital_id,encounter_id,assessed_at,id);
create table public.vital_observations (
 id uuid primary key default gen_random_uuid(), hospital_id uuid not null, assessment_id uuid not null,
 kind text not null check(kind in ('heart_rate','respiratory_rate','blood_pressure','temperature','oxygen_saturation','consciousness','pain')),
 measurement_status text not null check(measurement_status in ('measured','unknown','unavailable','not_measured')),
 value numeric, systolic numeric, diastolic numeric, text_value text check(length(text_value)<=160), unit text not null,
 observed_at timestamptz not null default statement_timestamp(), recorded_at timestamptz not null default clock_timestamp(), actor_id uuid not null references auth.users,
 unique(assessment_id,kind), foreign key(hospital_id,assessment_id) references public.triage_assessments(hospital_id,id),
 check(observed_at<=recorded_at),
 check((value is null or value::text not in ('NaN','Infinity','-Infinity')) and (systolic is null or systolic::text not in ('NaN','Infinity','-Infinity')) and (diastolic is null or diastolic::text not in ('NaN','Infinity','-Infinity'))),
 check(unit=case kind when 'heart_rate' then 'bpm' when 'respiratory_rate' then 'breaths/min' when 'blood_pressure' then 'mmHg' when 'temperature' then 'C' when 'oxygen_saturation' then '%' when 'consciousness' then 'text' when 'pain' then 'score/10' end),
 check(case when measurement_status<>'measured' then value is null and systolic is null and diastolic is null and text_value is null
 when kind='blood_pressure' then value is null and text_value is null and systolic is not null and diastolic is not null and systolic>=diastolic and diastolic>=0
 when kind='consciousness' then value is null and systolic is null and diastolic is null and nullif(trim(text_value),'') is not null
 else value is not null and value::text not in ('NaN','Infinity','-Infinity') and systolic is null and diastolic is null and text_value is null and
 case kind when 'temperature' then value> -273.15 when 'oxygen_saturation' then value between 0 and 100 when 'pain' then value between 0 and 10 else value>=0 end end)
);
create table public.triage_reviews (
 id uuid primary key default gen_random_uuid(), hospital_id uuid not null, encounter_id uuid not null, assessment_id uuid not null unique,
 reviewer_id uuid not null references auth.users, reviewed_at timestamptz not null default clock_timestamp(),
 decision text not null check(decision in ('accepted','rejected')), reason text not null check(length(trim(reason)) between 1 and 500),
 foreign key(hospital_id,encounter_id,assessment_id) references public.triage_assessments(hospital_id,encounter_id,id)
);

create function public.necms_clinical_actor() returns uuid language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.staff_profiles where id=auth.uid()) then raise exception 'Provision staff identity first.' using errcode='42501'; end if;
 return auth.uid();
end $$;
create function public.necms_foundation_event(h uuid,v uuid,p uuid,event_action text,details jsonb) returns void
language plpgsql security definer set search_path='' as $$
begin
 insert into public.audit_events(hospital_id,ownership_state,visit_id,patient_id,actor,actor_id,action,summary,after_record)
 values(h,'verified',v,p,(select trim(first_name||' '||last_name) from public.staff_profiles where id=auth.uid()),public.necms_clinical_actor(),event_action,event_action,details);
end $$;
-- Immutable clinical/arrival history even for accidental owner UPDATE/DELETE.
create function public.necms_immutable_history() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Append-only history cannot be changed.' using errcode='42501'; end $$;
do $$ declare t text; cap text; begin
 foreach t in array array['emergency_arrivals','identity_reconciliations','triage_assessments','vital_observations','triage_reviews','triage_protocol_versions'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('create trigger immutable_history before update or delete on public.%I for each row execute function public.necms_immutable_history()',t);
 if t<>'triage_protocol_versions' then
 cap:=case when t='emergency_arrivals' then 'encounter.read' when t='identity_reconciliations' then 'patient.identity.read' else 'triage.read' end;
 execute format('create policy clinical_hospital_read on public.%I for select to authenticated using(hospital_id=(public.necms_context()).hospital_id and public.necms_has(%L))',t,cap);
 execute format('grant select on public.%I to authenticated',t);
 end if;
 end loop;
end $$;
create function public.necms_arrival_options() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare h uuid:=public.necms_require('arrival.register'); begin
 return coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name)) from public.departments where hospital_id=h and active),'[]'); end $$;
create function public.necms_record_arrival(p_input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare h uuid:=public.necms_require('arrival.register',true); actor uuid:=public.necms_clinical_actor();
 r public.emergency_arrivals; p uuid; v uuid; a uuid; ref text; temp text; identity text; arrival_time timestamptz:=clock_timestamp();
 given text:=nullif(trim(p_input->>'first_name'),''); family text:=nullif(trim(p_input->>'last_name'),'');
 birth date:=nullif(p_input->>'date_of_birth','')::date; dep uuid:=(p_input->>'department_id')::uuid;
 retry uuid:=(p_input->>'request_id')::uuid; hash text:=encode(sha256(convert_to(p_input::text,'UTF8')),'hex');
begin
 if retry is null or dep is null or p_input ? 'hospital_id' or coalesce(p_input->>'source','') not in ('walk-in','ambulance','referral','other') then raise exception 'Invalid arrival.' using errcode='23514'; end if;
 -- Serialise retries before creating identity/encounter. No duplicate partial records.
 perform pg_advisory_xact_lock(hashtextextended(h::text||actor::text||retry::text,0));
 select * into r from public.emergency_arrivals where hospital_id=h and actor_id=actor and request_id=retry;
 if found then
 if r.payload_hash<>hash then raise exception 'Arrival retry changed.' using errcode='23514'; end if;
 return jsonb_build_object('id',r.id,'encounter_id',r.encounter_id,'patient_id',r.patient_id); end if;
 if not exists(select 1 from public.departments where id=dep and hospital_id=h and active) or birth>current_date then raise exception 'Invalid department or date.' using errcode='23514'; end if;
 identity:=case when given is null or family is null then 'provisional' else 'confirmed' end;
 temp:=case when identity='provisional' then 'TMP-'||gen_random_uuid()::text end;
 ref:=public.next_patient_reference();
 insert into public.patients(hospital_id,ownership_state,patient_ref,first_name,last_name,date_of_birth,identity_status,temporary_identifier)
 values(h,'verified',ref,given,family,birth,identity,temp) returning id into p;
 insert into public.visits(hospital_id,ownership_state,department_id,patient_id,complaint,priority,status,next_action,triage_state,urgency_source,arrived_at)
 values(h,'verified',dep,p,null,null,case when coalesce((p_input->>'immediate_care')::boolean,false) then 'in_treatment' else 'waiting' end,'assessment','not_yet_triaged','not_assessed',arrival_time) returning id into v;
 insert into public.emergency_arrivals(hospital_id,department_id,patient_id,encounter_id,source,referring_facility,identity_status,immediate_care,actor_id,request_id,payload_hash,arrived_at)
 values(h,dep,p,v,p_input->>'source',nullif(trim(p_input->>'referring_facility'),''),identity,coalesce((p_input->>'immediate_care')::boolean,false),actor,retry,hash,arrival_time) returning id into a;
 perform public.necms_foundation_event(h,v,p,'physical_arrival',jsonb_build_object('arrival_id',a,'source',p_input->>'source','identity_status',identity));
 return jsonb_build_object('id',a,'encounter_id',v,'patient_id',p);
end $$;

create function public.necms_reconcile_identity(p_patient uuid,p_version integer,p_input jsonb) returns void language plpgsql security definer set search_path='' as $$
declare h uuid:=public.necms_require('identity.reconcile',true); actor uuid:=public.necms_clinical_actor(); person public.patients; completed jsonb;
 given text:=trim(p_input->>'first_name'); family text:=trim(p_input->>'last_name'); birth date:=nullif(p_input->>'date_of_birth','')::date;
begin
 select * into person from public.patients where id=p_patient and hospital_id=h and ownership_state='verified' for update;
 if not found then raise exception 'Patient not accessible.' using errcode='42501'; end if;
 if person.version is distinct from p_version then raise exception 'Patient details were updated elsewhere. Close and reopen the record.'; end if;
 if person.identity_status<>'provisional' or given is null or family is null or length(given) not between 1 and 160 or length(family) not between 1 and 160 or birth>current_date or nullif(trim(p_input->>'reason'),'') is null then raise exception 'Invalid identity completion.' using errcode='23514'; end if;
 -- Serialise matching reconciliations; never silently merge identities.
 perform pg_advisory_xact_lock(hashtextextended(h::text||lower(given)||':'||lower(family)||coalesce(birth::text,''),0));
 if birth is not null and exists(select 1 from public.patients where hospital_id=h and id<>p_patient and lower(first_name)=lower(given) and lower(last_name)=lower(family) and date_of_birth=birth) then raise exception 'Potential duplicate identity requires separate review.' using errcode='23514'; end if;
 update public.patients set first_name=given,last_name=family,date_of_birth=birth,identity_status='confirmed',names_need_review=false,version=version+1 where id=p_patient returning to_jsonb(patients) into completed;
 insert into public.identity_reconciliations(hospital_id,patient_id,actor_id,reason,previous_identity,completed_identity) values(h,p_patient,actor,p_input->>'reason',to_jsonb(person),completed);
 perform public.necms_foundation_event(h,null,p_patient,'identity_reconciled',jsonb_build_object('patient_version',person.version+1));
end $$;

create function public.necms_record_assessment(p_encounter uuid,p_version integer,p_input jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare h uuid; actor uuid:=public.necms_clinical_actor(); encounter public.visits; assessment public.triage_assessments;
 saved uuid; observation jsonb; protocol uuid:=nullif(p_input->>'protocol_version_id','')::uuid;
 retry uuid:=(p_input->>'request_id')::uuid; hash text:=encode(sha256(convert_to(p_input::text,'UTF8')),'hex');
begin
 if coalesce(p_input->>'kind','') not in ('initial','reassessment') or retry is null then raise exception 'Invalid assessment.' using errcode='23514'; end if;
 h:=public.necms_require(case when p_input->>'kind'='initial' then 'triage.create' else 'triage.reassess' end,true);
 select * into encounter from public.visits where id=p_encounter and hospital_id=h and ownership_state='verified' for update;
 if not found then raise exception 'Encounter not accessible.' using errcode='42501'; end if;
 select * into assessment from public.triage_assessments where hospital_id=h and assessor_id=actor and request_id=retry;
 if found then
 if assessment.payload_hash<>hash or assessment.encounter_id<>p_encounter then raise exception 'Assessment retry changed.' using errcode='23514'; end if;
 return assessment.id; end if;
 if encounter.version is distinct from p_version then raise exception 'This patient was updated elsewhere. Close and reopen the record.'; end if;
 if encounter.status in ('discharged','transferred') then raise exception 'Assessment requires an active encounter.' using errcode='23514'; end if;
 if p_input->>'kind'='reassessment' and not exists(select 1 from public.triage_assessments where encounter_id=p_encounter) then raise exception 'Initial assessment required.' using errcode='23514'; end if;
 if protocol is not null and not exists(select 1 from public.triage_protocol_versions where id=protocol and hospital_id=h and approval_status='approved' and activation_status='active' and effective_from<=statement_timestamp() and (effective_until is null or effective_until>statement_timestamp())) then raise exception 'Protocol is not clinically active.' using errcode='42501'; end if;
 insert into public.triage_assessments(hospital_id,encounter_id,kind,assessor_id,complaint,observations,manual_priority,notes,protocol_version_id,request_id,payload_hash)
 values(h,p_encounter,p_input->>'kind',actor,trim(p_input->>'complaint'),coalesce(p_input->'observations','{}'),(p_input->>'manual_priority')::integer,coalesce(p_input->>'notes',''),protocol,retry,hash) returning id into saved;
 for observation in select * from jsonb_array_elements(coalesce(p_input->'vitals','[]')) loop
 insert into public.vital_observations(hospital_id,assessment_id,kind,measurement_status,value,systolic,diastolic,text_value,unit,observed_at,actor_id)
 values(h,saved,observation->>'kind',observation->>'measurement_status',(observation->>'value')::numeric,(observation->>'systolic')::numeric,(observation->>'diastolic')::numeric,observation->>'text_value',observation->>'unit',coalesce((observation->>'observed_at')::timestamptz,statement_timestamp()),actor);
 end loop;
 update public.visits set triage_state='awaiting_review',updated_at=clock_timestamp(),version=version+1 where id=p_encounter;
 perform public.necms_foundation_event(h,p_encounter,encounter.patient_id,case when p_input->>'kind'='initial' then 'initial_assessment_recorded' else 'reassessment_recorded' end,jsonb_build_object('assessment_id',saved));
 return saved;
end $$;
create function public.necms_review_assessment(p_assessment uuid,p_version integer,p_decision text,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare h uuid:=public.necms_require('triage.review',true); actor uuid:=public.necms_clinical_actor(); a public.triage_assessments; v public.visits;
begin
 select * into a from public.triage_assessments where id=p_assessment and hospital_id=h;
 if not found then raise exception 'Assessment not accessible.' using errcode='42501'; end if;
 select * into v from public.visits where id=a.encounter_id and hospital_id=h for update;
 if v.version is distinct from p_version then raise exception 'This patient was updated elsewhere. Close and reopen the record.'; end if;
 if a.assessor_id=actor then raise exception 'Independent assessment review required.' using errcode='42501'; end if;
 if v.status in ('discharged','transferred') or p_decision not in ('accepted','rejected') or p_decision is null or nullif(trim(p_reason),'') is null then raise exception 'Invalid review.' using errcode='23514'; end if;
 if exists(select 1 from public.triage_assessments where encounter_id=a.encounter_id and (assessed_at,id)>(a.assessed_at,a.id)) then raise exception 'Review the latest assessment.' using errcode='23514'; end if;
 if p_decision='accepted' and v.clinical_urgency is not null and v.clinical_urgency<>a.manual_priority then perform public.necms_require('priority.amend',true); end if;
 insert into public.triage_reviews(hospital_id,encounter_id,assessment_id,reviewer_id,decision,reason) values(h,a.encounter_id,a.id,actor,p_decision,p_reason);
 update public.visits set triage_state=case when p_decision='accepted' then 'completed_provisional' else 'not_yet_triaged' end,
 clinical_urgency=case when p_decision='accepted' then a.manual_priority else clinical_urgency end,
 urgency_source=case when p_decision='accepted' then 'provisional_manual' else urgency_source end,
 latest_assessment_at=case when p_decision='accepted' then a.assessed_at else latest_assessment_at end,updated_at=clock_timestamp(),version=version+1 where id=v.id;
 perform public.necms_foundation_event(h,v.id,v.patient_id,'assessment_reviewed',jsonb_build_object('assessment_id',a.id,'decision',p_decision));
 if p_decision='accepted' and v.clinical_urgency is distinct from a.manual_priority then
 perform public.necms_foundation_event(h,v.id,v.patient_id,'priority_changed',jsonb_build_object('previous',v.clinical_urgency,'current',a.manual_priority,'source','provisional_manual','reason',p_reason)); end if;
end $$;

-- Protect legacy priority/identity editing too; old normal registration survives.
alter function public.save_visit(jsonb,uuid,integer,integer) rename to necms_legacy_save_visit;
revoke all on function public.necms_legacy_save_visit(jsonb,uuid,integer,integer) from public,anon,authenticated;
create function public.save_visit(p_input jsonb,p_id uuid default null,p_version integer default null,p_patient_version integer default null) returns uuid language plpgsql security definer set search_path='' as $$
declare h uuid; v public.visits; identity text;
begin
 h:=public.necms_require(case when p_id is null then 'encounter.register' else 'encounter.update_legacy' end,true);
 if p_id is not null then
 select * into v from public.visits where id=p_id and hospital_id=h and ownership_state='verified' for update;
 if not found then raise exception 'Patient visit not found.'; end if;
 select identity_status into identity from public.patients where id=v.patient_id;
 if identity='provisional' then raise exception 'Use explicit provisional identity reconciliation and clinical assessment.' using errcode='42501'; end if;
 if v.priority is distinct from (p_input->>'priority')::integer then perform public.necms_require('priority.amend',true); end if;
 elsif exists(select 1 from public.patients where hospital_id=h and ownership_state='verified' and identity_status='provisional' and lower(trim(patient_ref))=lower(trim(p_input->>'patient_ref'))) then
 raise exception 'Use explicit provisional identity reconciliation.' using errcode='42501';
 end if;
 return public.necms_legacy_save_visit(p_input,p_id,p_version,p_patient_version);
end $$;

drop view public.visit_board;
create view public.visit_board with(security_invoker=true) as select v.*,p.patient_ref,p.first_name,p.last_name,p.date_of_birth,p.names_need_review,p.version as patient_version,p.identity_status,p.temporary_identifier
 from public.visits v join public.patients p on p.id=v.patient_id and p.hospital_id=v.hospital_id;
revoke all on public.visit_board from public,anon,authenticated;
grant select on public.visit_board to authenticated;

create function public.necms_assessment_history(p_encounter uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare h uuid:=public.necms_require('triage.read'); begin
 perform public.necms_require('encounter.read');
 if not exists(select 1 from public.visits where id=p_encounter and hospital_id=h and ownership_state='verified') then raise exception 'Encounter not accessible.' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('vitals',coalesce((select jsonb_agg(o) from public.vital_observations o where o.assessment_id=a.id),'[]'),'review',(select to_jsonb(r) from public.triage_reviews r where r.assessment_id=a.id)) order by assessed_at,id) from public.triage_assessments a where hospital_id=h and encounter_id=p_encounter),'[]'); end $$;
create function public.necms_clinical_timeline(p_encounter uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare h uuid:=public.necms_require('clinical.timeline.read'); begin
 perform public.necms_require('encounter.read');
 if not exists(select 1 from public.visits where id=p_encounter and hospital_id=h and ownership_state='verified') then raise exception 'Encounter not accessible.' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(e order by created_at,id) from(select id,
 case when action='updated' and before_record->'priority' is distinct from after_record->'priority' then 'legacy_priority_changed'
 when action='updated' and before_record->'status' is distinct from after_record->'status' then 'encounter_status_changed' else action end as action,actor_id,actor,
 case when action='physical_arrival' then coalesce((select arrived_at from public.emergency_arrivals where encounter_id=p_encounter),created_at) else created_at end as created_at,
 case when action in ('physical_arrival','registered','identity_reconciled','patient_updated') then 'administrative' when action in ('initial_assessment_recorded','reassessment_recorded','assessment_reviewed','priority_changed') then 'clinical' else 'encounter_update' end as category,summary,
 jsonb_strip_nulls(jsonb_build_object('previous_status',before_record->'status','current_status',after_record->'status',
 'previous_legacy_priority',before_record->'priority','current_legacy_priority',after_record->'priority',
 'assessment_id',after_record->'assessment_id','decision',after_record->'decision',
 'previous_provisional_priority',case when action='priority_changed' then after_record->'previous' end,
 'current_provisional_priority',case when action='priority_changed' then after_record->'current' end)) as details
 from public.audit_events where hospital_id=h and (visit_id=p_encounter or (visit_id is null and patient_id=(select patient_id from public.visits where id=p_encounter))))e),'[]'); end $$;
create function public.necms_register_protocol(p_identifier text,p_version text) returns uuid language plpgsql security definer set search_path='' as $$
declare h uuid:=public.necms_require('protocol.admin',true); actor uuid:=public.necms_clinical_actor(); saved uuid; begin
 insert into public.triage_protocol_versions(hospital_id,protocol_identifier,version,created_by) values(h,trim(p_identifier),trim(p_version),actor) returning id into saved;
 perform public.necms_foundation_event(h,null,null,'protocol_draft_created',jsonb_build_object('protocol_id',saved)); return saved; end $$;
-- Care coordination is independent of identity completion and clinical triage.
create function public.necms_update_care(p_encounter uuid,p_version integer,p_input jsonb) returns void language plpgsql security definer set search_path='' as $$
declare h uuid:=public.necms_require('encounter.update_legacy',true); actor uuid:=public.necms_clinical_actor(); v public.visits; r public.resources;
 space uuid:=nullif(p_input->>'resource_id','')::uuid; new_status text:=p_input->>'status'; new_location text:=coalesce(p_input->>'location','');
begin
 select * into v from public.visits where id=p_encounter and hospital_id=h and ownership_state='verified' for update;
 if not found then raise exception 'Encounter not accessible.' using errcode='42501'; end if;
 if v.version is distinct from p_version then raise exception 'This patient was updated elsewhere. Close and reopen the record.'; end if;
 if p_input ? 'priority' or p_input ? 'patient_id' or p_input ? 'hospital_id' then raise exception 'Care operation cannot change identity or urgency.' using errcode='42501'; end if;
 if new_status in ('discharged','transferred') then space:=null; end if;
 if space is not null then
 select * into r from public.resources where id=space and hospital_id=h and ownership_state='verified' for update;
 if not found or r.state<>'available' then raise exception 'This space is not available.'; end if;
 if exists(select 1 from public.visits where resource_id=space and status not in ('discharged','transferred') and id<>p_encounter) then raise exception 'This space is already assigned to another patient.'; end if;
 new_location:=r.name;
 end if;
 update public.visits set status=new_status,next_action=p_input->>'next_action',resource_id=space,location=new_location,
 assigned_to=coalesce(p_input->>'assigned_to',''),updated_at=clock_timestamp(),version=version+1 where id=p_encounter;
end $$;
-- Helpers are not callable by application roles. All new public RPCs deny anon/PUBLIC.
do $$ declare f record; begin
 for f in select oid::regprocedure as signature,proname from pg_proc where pronamespace='public'::regnamespace and proname in
 ('necms_clinical_actor','necms_foundation_event','necms_immutable_history','necms_arrival_options','necms_record_arrival','necms_reconcile_identity','necms_record_assessment','necms_review_assessment','necms_assessment_history','necms_clinical_timeline','necms_register_protocol','necms_update_care','save_visit') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 if f.proname not in ('necms_clinical_actor','necms_foundation_event','necms_immutable_history') then execute format('grant execute on function %s to authenticated',f.signature); end if;
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
