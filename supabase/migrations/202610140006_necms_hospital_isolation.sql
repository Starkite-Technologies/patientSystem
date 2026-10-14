-- PREPARED LOCALLY ONLY. Hosted execution requires schema/provenance/recovery
-- verification and explicit approval. No historical ownership backfill.
begin;
create schema necms_private;
revoke all on schema necms_private from public, anon, authenticated;
create table public.hospitals (
 id uuid primary key default gen_random_uuid(), code text not null unique,
 name text not null, facility_type text not null check(facility_type in ('public','private','other')),
 active boolean not null default true, timezone text not null default 'Africa/Windhoek'
);
create table public.departments (
 id uuid primary key default gen_random_uuid(), hospital_id uuid not null references public.hospitals,
 code text not null, name text not null, active boolean not null default true,
 unique(hospital_id,id), unique(hospital_id,code)
);
create table public.capabilities (code text primary key);
insert into public.capabilities values ('encounter.read'),('encounter.register'),('encounter.update_legacy'),
 ('patient.identity.read'),('patient.identity.update'),('resource.read'),('resource.coordinate'),
 ('audit.summary.read'),('display.read'),('membership.manage'),('hospital.configure');
create table public.hospital_roles (
 id uuid primary key default gen_random_uuid(), hospital_id uuid not null references public.hospitals,
 code text not null, unique(hospital_id,id), unique(hospital_id,code)
);
create table public.role_capabilities (
 role_id uuid references public.hospital_roles on delete restrict,
 capability text references public.capabilities, primary key(role_id,capability)
);
create table public.hospital_memberships (
 id uuid primary key default gen_random_uuid(), hospital_id uuid not null references public.hospitals,
 user_id uuid not null references auth.users on delete restrict, role_id uuid not null,
 active boolean not null default false, authorization_version integer not null default 1,
 valid_until timestamptz, unique(hospital_id,user_id), unique(hospital_id,id),
 foreign key(hospital_id,role_id) references public.hospital_roles(hospital_id,id)
);
create index membership_user on public.hospital_memberships(user_id,hospital_id);
create table public.hospital_configuration (
 id uuid primary key default gen_random_uuid(), hospital_id uuid not null references public.hospitals,
 version integer not null, settings jsonb not null default '{}',
 created_at timestamptz not null default now(), actor_id uuid,
 unique(hospital_id,version)
);
create table necms_private.access_contexts (
 id uuid primary key default gen_random_uuid(), hospital_id uuid not null,
 membership_id uuid not null, user_id uuid not null references auth.users on delete restrict,
 authorization_version integer not null, purpose text not null check(purpose in ('clinical','display')),
 expires_at timestamptz not null default now()+interval '15 minutes',
 foreign key(hospital_id,membership_id) references public.hospital_memberships(hospital_id,id)
);
create index contexts_expiry on necms_private.access_contexts(expires_at);
create table necms_private.registration_requests (
 hospital_id uuid references public.hospitals, user_id uuid not null,
 request_id uuid not null, payload_hash text not null, result_id uuid,
 primary key(hospital_id,user_id,request_id)
);
alter table necms_private.registration_requests enable row level security;
-- Retained administrative provenance evidence is private, not a patient export.
create table necms_private.ownership_reviews (
 id uuid primary key default gen_random_uuid(), entity_type text not null,
 entity_id uuid not null, evidence_reference text not null, approved_hospital_id uuid references public.hospitals,
 reviewer_id uuid, reviewed_at timestamptz not null default now(), disposition text not null
 check(disposition in ('pending','quarantined','verified'))
);
alter table public.patients add column hospital_id uuid references public.hospitals,
 add column ownership_state text not null default 'pending';
alter table public.visits add column hospital_id uuid references public.hospitals,
 add column ownership_state text not null default 'pending', add column department_id uuid;
alter table public.resources add column hospital_id uuid references public.hospitals,
 add column ownership_state text not null default 'pending', add column department_id uuid;
alter table public.audit_events add column hospital_id uuid references public.hospitals,
 add column ownership_state text not null default 'pending';
alter table public.patients add constraint patient_owner check(
 (ownership_state='verified' and hospital_id is not null) or
 (ownership_state in ('pending','quarantined') and hospital_id is null)),
 add unique(hospital_id,id,ownership_state);
alter table public.resources add constraint resource_owner check(
 (ownership_state='verified' and hospital_id is not null) or
 (ownership_state in ('pending','quarantined') and hospital_id is null)),
 add unique(hospital_id,id,ownership_state),
 add foreign key(hospital_id,department_id) references public.departments(hospital_id,id);
alter table public.visits add constraint visit_owner check(
 (ownership_state='verified' and hospital_id is not null) or
 (ownership_state in ('pending','quarantined') and hospital_id is null)),
 add unique(hospital_id,id,ownership_state),
 add foreign key(hospital_id,patient_id,ownership_state) references public.patients(hospital_id,id,ownership_state),
 add foreign key(hospital_id,resource_id,ownership_state) references public.resources(hospital_id,id,ownership_state),
 add foreign key(hospital_id,department_id) references public.departments(hospital_id,id);
alter table public.audit_events add constraint audit_owner check(
 (ownership_state='verified' and hospital_id is not null) or
 (ownership_state in ('pending','quarantined') and hospital_id is null)),
 add foreign key(hospital_id,patient_id,ownership_state) references public.patients(hospital_id,id,ownership_state),
 add foreign key(hospital_id,visit_id,ownership_state) references public.visits(hospital_id,id,ownership_state);
drop index public.patients_reference_unique;
create unique index patients_reference_unique on public.patients(hospital_id,lower(trim(patient_ref))) where ownership_state='verified';
alter table public.resources drop constraint resources_name_key;
create unique index resources_hospital_name on public.resources(hospital_id,lower(trim(name))) where ownership_state='verified';
create index visits_hospital_active on public.visits(hospital_id,status,priority,arrived_at);
create index audit_hospital_time on public.audit_events(hospital_id,created_at desc);

create function public.necms_context() returns necms_private.access_contexts
language plpgsql stable security definer set search_path='' as $$
declare c necms_private.access_contexts; context_id uuid;
begin
 context_id:=nullif(coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}')->>'x-necms-context','')::uuid;
 select a.* into c from necms_private.access_contexts a
 join public.hospital_memberships m on m.id=a.membership_id and m.hospital_id=a.hospital_id
 join public.hospitals h on h.id=a.hospital_id
 where a.id=context_id and a.user_id=auth.uid() and m.user_id=auth.uid()
 and m.active and h.active and (m.valid_until is null or m.valid_until>statement_timestamp())
 and a.expires_at>statement_timestamp() and a.authorization_version=m.authorization_version;
 if not found then raise exception 'An active authorised hospital context is required.' using errcode='42501'; end if;
 return c;
end $$;
create function public.necms_has(p_cap text) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare c necms_private.access_contexts:=public.necms_context();
begin
 if (p_cap='display.read') is distinct from (c.purpose='display') then return false; end if;
 return exists(select 1 from public.hospital_memberships m join public.role_capabilities r on r.role_id=m.role_id
 where m.id=c.membership_id and r.capability=p_cap);
end $$;
create function public.necms_require(p_cap text,p_write boolean default false) returns uuid
language plpgsql security definer set search_path='' as $$
declare c necms_private.access_contexts;
begin
 c:=public.necms_context();
 if p_write then
  perform 1 from public.hospital_memberships where id=c.membership_id for share;
  -- Recheck after acquiring the membership lock; revoke commits serialize here.
  c:=public.necms_context();
 end if;
 if not public.necms_has(p_cap) then raise exception 'Hospital capability required.' using errcode='42501'; end if;
 return c.hospital_id;
end $$;
create function public.necms_hospitals() returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',h.id,'name',h.name,'facility_type',h.facility_type)), '[]')
 from public.hospitals h join public.hospital_memberships m on m.hospital_id=h.id
 where m.user_id=auth.uid() and m.active and h.active and (m.valid_until is null or m.valid_until>statement_timestamp())
$$;
create function public.necms_create_context(p_hospital uuid,p_purpose text default 'clinical') returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.hospital_memberships; c necms_private.access_contexts;
begin
 if auth.uid() is null or p_purpose not in ('clinical','display') then raise exception 'Invalid context.' using errcode='42501'; end if;
 select hm.* into m from public.hospital_memberships hm join public.hospitals h on h.id=hm.hospital_id
 where hm.hospital_id=p_hospital and hm.user_id=auth.uid() and hm.active and h.active
 and (hm.valid_until is null or hm.valid_until>statement_timestamp()) for share of hm;
 if not found then raise exception 'Hospital membership required.' using errcode='42501'; end if;
 if p_purpose='clinical' and not exists(select 1 from public.role_capabilities where role_id=m.role_id and capability<>'display.read') then
 raise exception 'Clinical context permission required.' using errcode='42501'; end if;
 if p_purpose='display' and not exists(select 1 from public.role_capabilities where role_id=m.role_id and capability='display.read') then
 raise exception 'Display permission required.' using errcode='42501'; end if;
 insert into necms_private.access_contexts(hospital_id,membership_id,user_id,authorization_version,purpose)
 values(p_hospital,m.id,auth.uid(),m.authorization_version,p_purpose) returning * into c;
 return jsonb_build_object('id',c.id,'hospital_id',c.hospital_id,'purpose',c.purpose,'expires_at',c.expires_at);
end $$;
create function public.necms_context_info() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c necms_private.access_contexts:=public.necms_context(); caps jsonb; role_code text;
begin
 select r.code into role_code from public.hospital_memberships m join public.hospital_roles r on r.id=m.role_id where m.id=c.membership_id;
 select coalesce(jsonb_agg(r.capability),'[]') into caps from public.hospital_memberships m
 join public.role_capabilities r on r.role_id=m.role_id where m.id=c.membership_id
 and ((c.purpose='display' and r.capability='display.read') or (c.purpose='clinical' and r.capability<>'display.read'));
 return jsonb_build_object('hospital_id',c.hospital_id,'purpose',c.purpose,'role',role_code,'capabilities',caps);
end $$;
-- Remove EVERY legacy clinical read policy; permissive policies combine with OR.
drop policy staff_read_patients on public.patients;
drop policy staff_read_visits on public.visits;
drop policy staff_read_resources on public.resources;
drop policy staff_read_events on public.audit_events;
create policy hospital_patients on public.patients for select to authenticated using
 (ownership_state='verified' and hospital_id=(public.necms_context()).hospital_id and public.necms_has('patient.identity.read'));
create policy hospital_visits on public.visits for select to authenticated using
 (ownership_state='verified' and hospital_id=(public.necms_context()).hospital_id and public.necms_has('encounter.read'));
create policy hospital_resources on public.resources for select to authenticated using
 (ownership_state='verified' and hospital_id=(public.necms_context()).hospital_id and public.necms_has('resource.read'));
create policy hospital_audit on public.audit_events for select to authenticated using
 (ownership_state='verified' and hospital_id=(public.necms_context()).hospital_id and public.necms_has('audit.summary.read'));
-- New tables default-deny direct access; only narrow checked RPCs expose them.
do $$ declare t text; begin
 foreach t in array array['hospitals','departments','capabilities','hospital_roles','role_capabilities','hospital_memberships','hospital_configuration'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 end loop;
end $$;
alter table necms_private.access_contexts enable row level security;
alter table necms_private.ownership_reviews enable row level security;
-- Recreate invoker view to include ownership. Base-table RLS remains authoritative.
drop view public.visit_board;
create view public.visit_board with(security_invoker=true) as
select v.*,p.patient_ref,p.first_name,p.last_name,p.date_of_birth,p.names_need_review,p.version as patient_version
from public.visits v join public.patients p on p.id=v.patient_id and p.hospital_id=v.hospital_id;
revoke all on public.visit_board from public,anon,authenticated;
grant select on public.visit_board to authenticated;
create function public.necms_board() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare h uuid:=public.necms_require('encounter.read'); result jsonb;
begin
 perform public.necms_require('patient.identity.read'); perform public.necms_require('resource.read');
 -- One snapshot; active rows have no Data API page limit. History is separate.
 select jsonb_build_object('visits',coalesce((select jsonb_agg(v order by priority,arrived_at,id) from public.visit_board v
 where hospital_id=h and ownership_state='verified' and status not in ('discharged','transferred')),'[]'),
 'patients',coalesce((select jsonb_agg(p) from(select id as patient_id,patient_ref,first_name,last_name,date_of_birth from public.patients where hospital_id=h and ownership_state='verified')p),'[]'),
 'resources',coalesce((select jsonb_agg(r order by name) from public.resources r where hospital_id=h and ownership_state='verified'),'[]'),
 'events',case when public.necms_has('audit.summary.read') then coalesce((select jsonb_agg(e) from
 (select id,visit_id,actor,action,created_at,summary from public.audit_events where hospital_id=h and ownership_state='verified' order by created_at desc limit 30)e),'[]') else '[]'::jsonb end) into result;
 return result||public.necms_context_info();
end $$;
create function public.necms_history(p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare h uuid:=public.necms_require('encounter.read');
begin
 perform public.necms_require('patient.identity.read');
 if p_offset<0 then raise exception 'Invalid offset.'; end if;
 return coalesce((select jsonb_agg(v) from(select * from public.visit_board where hospital_id=h and ownership_state='verified'
 and status in ('discharged','transferred') order by arrived_at desc,id limit 100 offset p_offset)v),'[]');
end $$;
-- Controlled server-side display dataset: no identity, notes or free-text labels.
create function public.necms_display_board() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare h uuid:=public.necms_require('display.read');
begin
 if coalesce((select (settings->>'display_enabled')::boolean from public.hospital_configuration where hospital_id=h order by version desc limit 1),true)=false then
 raise exception 'Shared display is disabled.' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(d) from(select 'ED-'||substr(md5(v.id::text||h::text),1,10) as display_label,
 v.status,v.next_action,case when v.resource_id is null then 'Unassigned' else 'Assigned space' end as space_state
 from public.visits v where v.hospital_id=h and v.ownership_state='verified' and v.status not in ('discharged','transferred') order by v.arrived_at,v.id)d),'[]');
end $$;
create function public.necms_staff() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare h uuid:=public.necms_require('membership.manage');
begin
 return jsonb_build_object('memberships',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'user_id',m.user_id,'role_id',m.role_id,'active',m.active,'authorization_version',m.authorization_version)) from public.hospital_memberships m where hospital_id=h),'[]'),
 'roles',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'code',r.code)) from public.hospital_roles r where hospital_id=h),'[]'));
end $$;
create function public.necms_set_membership(p_user uuid,p_role uuid,p_active boolean,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare h uuid:=public.necms_require('membership.manage',true); saved uuid; old_record jsonb;
begin
 if p_user=auth.uid() or nullif(trim(p_reason),'') is null then raise exception 'Self-management is forbidden; a reason is required.' using errcode='42501'; end if;
 if not exists(select 1 from public.hospital_roles where id=p_role and hospital_id=h) then raise exception 'Role not authorised.' using errcode='42501'; end if;
 if p_active and exists(select 1 from public.role_capabilities proposed where proposed.role_id=p_role and not exists(
 select 1 from public.hospital_memberships actor join public.role_capabilities held on held.role_id=actor.role_id
 where actor.id=(public.necms_context()).membership_id and held.capability=proposed.capability)) then
 raise exception 'Cannot delegate capabilities you do not hold.' using errcode='42501'; end if;
 select to_jsonb(m) into old_record from public.hospital_memberships m where hospital_id=h and user_id=p_user for update;
 insert into public.hospital_memberships(hospital_id,user_id,role_id,active) values(h,p_user,p_role,p_active)
 on conflict(hospital_id,user_id) do update set role_id=excluded.role_id,active=excluded.active,
 authorization_version=public.hospital_memberships.authorization_version+1 returning id into saved;
 insert into public.audit_events(hospital_id,ownership_state,actor,actor_id,action,summary,before_record,after_record)
 values(h,'verified','Hospital administrator',auth.uid(),'membership_changed',trim(p_reason),old_record,
 (select to_jsonb(m) from public.hospital_memberships m where id=saved));
 return saved;
end $$;
create function public.necms_configuration(p_settings jsonb default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare h uuid:=public.necms_require('hospital.configure',p_settings is not null); version_number integer; result jsonb;
begin
 if p_settings is not null then
  if jsonb_typeof(p_settings)<>'object' or p_settings- 'language' - 'display_enabled'<>'{}'::jsonb
  or (p_settings ? 'language' and p_settings->>'language' not in ('en','af','de'))
  or (p_settings ? 'display_enabled' and jsonb_typeof(p_settings->'display_enabled')<>'boolean') then raise exception 'Invalid operational configuration.' using errcode='23514'; end if;
  perform 1 from public.hospitals where id=h for update;
  select coalesce(max(version),0)+1 into version_number from public.hospital_configuration where hospital_id=h;
  insert into public.hospital_configuration(hospital_id,version,settings,actor_id) values(h,version_number,p_settings,auth.uid());
  insert into public.audit_events(hospital_id,ownership_state,actor,actor_id,action,summary,after_record)
  values(h,'verified','Hospital administrator',auth.uid(),'configuration_changed','Operational configuration changed',p_settings);
 end if;
 select jsonb_build_object('version',version,'settings',settings) into result from public.hospital_configuration where hospital_id=h order by version desc limit 1;
 return coalesce(result,'{}');
end $$;
-- Raw clinical row streaming is disabled. Context headers are not websocket
-- authority. The initial transport is fresh, user-scoped polling only.
do $$ declare t text; begin
 foreach t in array array['patients','visits','resources'] loop
 if exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
 execute format('alter publication supabase_realtime drop table public.%I',t);
 end if;
 end loop;
end $$;

create or replace function public.save_visit(p_input jsonb, p_id uuid default null, p_version integer default null, p_patient_version integer default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  hospital uuid;
  client_request_id uuid := nullif(p_input->>'_request_id','')::uuid;
  input_hash text := encode(sha256(convert_to((p_input-'_request_id')::text,'UTF8')),'hex');
  prior_request necms_private.registration_requests;
  existing public.visits;
  chosen_resource public.resources;
  saved_id uuid;
  person public.patients;
  person_id uuid;
  reference text := nullif(trim(p_input->>'patient_ref'),'');
  given_name text := trim(p_input->>'first_name');
  birth_date date := nullif(p_input->>'date_of_birth','')::date;
  family_name text := trim(p_input->>'last_name');
  resource uuid := nullif(p_input->>'resource_id', '')::uuid;
  new_status text := p_input->>'status';
  new_location text := coalesce(p_input->>'location', '');
begin
  hospital:=public.necms_require(case when p_id is null then 'encounter.register' else 'encounter.update_legacy' end,true);
  if p_input ? 'hospital_id' and (p_input->>'hospital_id')::uuid is distinct from hospital then
    raise exception 'Hospital mismatch.' using errcode='42501';
  end if;
  if p_id is null and client_request_id is not null then
    insert into necms_private.registration_requests(hospital_id,user_id,request_id,payload_hash)
    values(hospital,auth.uid(),client_request_id,input_hash) on conflict do nothing;
    select * into prior_request from necms_private.registration_requests r
    where r.hospital_id=hospital and r.user_id=auth.uid() and r.request_id=client_request_id for update;
    if prior_request.payload_hash is distinct from input_hash then
      raise exception 'Registration retry payload changed.' using errcode='23514';
    end if;
    if prior_request.result_id is not null then return prior_request.result_id; end if;
  end if;
  if p_id is not null then
    select * into existing from public.visits where id = p_id and hospital_id=hospital and ownership_state='verified' for update;
    if not found then raise exception 'Patient visit not found.'; end if;
    if p_version is distinct from existing.version then raise exception 'This patient was updated elsewhere. Close and reopen the record.'; end if;
  end if;
  if given_name is null or family_name is null or length(given_name) not between 1 and 160 or length(family_name) not between 1 and 160 then
    raise exception 'First and last name are required.' using errcode = '23514';
  end if;
  if birth_date > (current_timestamp at time zone 'Africa/Johannesburg')::date then
    raise exception 'Date of birth cannot be in the future.' using errcode = '23514';
  end if;
  if p_id is null then
    if reference is null then
      loop
        reference := public.next_patient_reference();
        insert into public.patients(hospital_id,ownership_state,patient_ref, first_name, last_name, date_of_birth)
        values(hospital,'verified',reference, given_name, family_name, birth_date) on conflict do nothing returning id into person_id;
        exit when person_id is not null;
      end loop;
    else
      insert into public.patients(hospital_id,ownership_state,patient_ref, first_name, last_name, date_of_birth)
      values(hospital,'verified',reference, given_name, family_name, birth_date) on conflict do nothing returning id into person_id;
    end if;
    if person_id is null then
      select * into person from public.patients where hospital_id=hospital and ownership_state='verified' and lower(trim(patient_ref)) = lower(reference) for update;
      person_id := person.id;
      if person.first_name <> given_name or person.last_name <> family_name or person.date_of_birth is distinct from birth_date then
        raise exception 'This patient reference has different identity details. Review the existing patient record before registering another visit.';
      end if;
    end if;
  else
    select * into person from public.patients where id = existing.patient_id and hospital_id=hospital and ownership_state='verified' for update;
    person_id := person.id;
    if reference is null then reference := person.patient_ref; end if;
    if lower(reference) is distinct from lower(trim(person.patient_ref)) then
      raise exception 'The patient reference cannot be changed on an existing visit.';
    end if;
    if p_patient_version is not null and p_patient_version is distinct from person.version then
      raise exception 'Patient details were updated elsewhere. Close and reopen the record.';
    end if;
    if person.first_name <> given_name or person.last_name <> family_name or person.date_of_birth is distinct from birth_date or person.names_need_review then
      if p_patient_version is null then raise exception 'Reload the patient record before changing identity details.'; end if;
      perform public.necms_require('patient.identity.update',true);
      update public.patients set first_name=given_name, last_name=family_name, date_of_birth=birth_date, names_need_review=false,
        version=version+1 where id=person_id;
    end if;
  end if;
  if new_status in ('discharged', 'transferred') then resource := null; end if;
  if resource is not null then
    select * into chosen_resource from public.resources where id = resource and hospital_id=hospital and ownership_state='verified' for update;
    if not found or chosen_resource.state <> 'available' then raise exception 'This space is not available.'; end if;
    if exists (select 1 from public.visits where resource_id = resource and status not in ('discharged', 'transferred') and id is distinct from p_id) then
      raise exception 'This space is already assigned to another patient.';
    end if;
    new_location := chosen_resource.name;
  end if;
  if p_id is null then
    insert into public.visits(hospital_id,ownership_state,patient_id, complaint, priority, status, next_action, location, resource_id, assigned_to, notes)
    values(hospital,'verified',person_id, trim(p_input->>'complaint'), (p_input->>'priority')::integer,
      new_status, p_input->>'next_action', new_location, resource, coalesce(p_input->>'assigned_to',''), coalesce(p_input->>'notes','')) returning id into saved_id;
  else
    update public.visits set
      complaint = trim(p_input->>'complaint'), priority = (p_input->>'priority')::integer, status = new_status, next_action = p_input->>'next_action',
      location = new_location, resource_id = resource, assigned_to = coalesce(p_input->>'assigned_to',''), notes = coalesce(p_input->>'notes',''),
      updated_at = now(), version = version + 1 where id = p_id returning id into saved_id;
  end if;
  if p_id is null and client_request_id is not null then
    update necms_private.registration_requests r set result_id=saved_id
    where r.hospital_id=hospital and r.user_id=auth.uid() and r.request_id=client_request_id;
  end if;
  return saved_id;
end $$;

create or replace function public.set_resource_state(p_id uuid, p_state text) returns void
language plpgsql security definer set search_path = '' as $$
declare space_name text; hospital uuid;
begin
  hospital:=public.necms_require('resource.coordinate',true);
  select name into space_name from public.resources where id = p_id and hospital_id=hospital and ownership_state='verified' for update;
  if not found then raise exception 'Space not found.'; end if;
  if exists (select 1 from public.visits where resource_id = p_id and status not in ('discharged', 'transferred')) then raise exception 'Release the assigned patient before changing this space.'; end if;
  update public.resources set state = p_state where id = p_id;
  insert into public.audit_events(hospital_id,ownership_state,actor, actor_id, action, summary)
  select hospital,'verified',trim(first_name || ' ' || last_name), auth.uid(), 'resource_updated', space_name || ' Â· ' || p_state from public.staff_profiles where id = auth.uid();
end $$;
create or replace function public.record_visit_event() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into public.audit_events(hospital_id,ownership_state,visit_id,patient_id,actor,actor_id,action,summary,before_record,after_record)
 values(new.hospital_id,new.ownership_state,new.id,new.patient_id,
 coalesce((select trim(first_name||' '||last_name) from public.staff_profiles where id=auth.uid()),'System administrator'),auth.uid(),
 case when tg_op='INSERT' then 'registered' else 'updated' end,'Encounter changed',
 case when tg_op='UPDATE' then to_jsonb(old) else null end,to_jsonb(new)); return new;
end $$;
create or replace function public.record_patient_event() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into public.audit_events(hospital_id,ownership_state,patient_id,actor,actor_id,action,summary,before_record,after_record)
 values(new.hospital_id,new.ownership_state,new.id,'Staff member',auth.uid(),'patient_updated','Identity changed',to_jsonb(old),to_jsonb(new));
 return new;
end $$;
-- Deny PUBLIC's default function EXECUTE, including all new overloads.
do $$ declare f record; begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname like 'necms_%' loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to authenticated',f.signature);
 end loop;
end $$;
revoke all on function public.record_visit_event(),public.record_patient_event() from public,anon,authenticated;
revoke all on function public.save_visit(jsonb,uuid,integer,integer),public.set_resource_state(uuid,text) from public,anon;
grant execute on function public.save_visit(jsonb,uuid,integer,integer),public.set_resource_state(uuid,text) to authenticated;
notify pgrst,'reload schema';
commit;
