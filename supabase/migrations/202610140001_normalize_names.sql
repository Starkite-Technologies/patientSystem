-- Apply after 202610130001_initial.sql, including on databases already using it.
-- Full historical names are preserved in an administrator-only migration archive.
begin;
create table public.patient_name_migration_archive as
select id as visit_id, patient_ref, patient_name from public.visits;
alter table public.patient_name_migration_archive enable row level security;
revoke all on public.patient_name_migration_archive from anon, authenticated;

create table public.patients (
 id uuid primary key default gen_random_uuid(),
 patient_ref text not null check (length(trim(patient_ref)) between 1 and 80),
 first_name text not null check (length(trim(first_name)) between 1 and 160),
 last_name text not null check (length(trim(last_name)) <= 160),
 names_need_review boolean not null default false,
 version integer not null default 1,
 check (names_need_review or length(trim(last_name)) >= 1)
);
create unique index patients_reference_unique on public.patients(lower(trim(patient_ref)));
-- Keep the most recently updated identity when multiple visits share a reference.
-- Every migrated name needs review; a whitespace split is not authoritative.
insert into public.patients(patient_ref,first_name,last_name,names_need_review)
select distinct on (lower(trim(patient_ref))) trim(patient_ref),
 split_part(trim(patient_name), ' ', 1),
 ltrim(substr(trim(patient_name), length(split_part(trim(patient_name), ' ', 1))+1)), true
from public.visits order by lower(trim(patient_ref)), updated_at desc, id;

alter table public.visits add column patient_id uuid references public.patients(id);
update public.visits v set patient_id=p.id from public.patients p where lower(trim(v.patient_ref))=lower(trim(p.patient_ref));
alter table public.visits alter column patient_id set not null;
drop index public.one_active_visit_per_patient;
create unique index one_active_visit_per_patient on public.visits(patient_id) where status not in ('discharged','transferred');
create index visits_patient_id on public.visits(patient_id);
drop trigger visit_audit on public.visits;
drop function public.save_visit(jsonb,uuid,integer);
alter table public.visits drop column patient_ref, drop column patient_name;

alter table public.staff_profiles add column first_name text, add column last_name text,
 add column legacy_name text, add column names_need_review boolean not null default false;
update public.staff_profiles set legacy_name=display_name,
 first_name=split_part(trim(display_name),' ',1),
 last_name=ltrim(substr(trim(display_name),length(split_part(trim(display_name),' ',1))+1)), names_need_review=true;
alter table public.staff_profiles alter column first_name set not null, alter column last_name set not null;
alter table public.staff_profiles add check (length(trim(first_name)) between 1 and 160),
 add check (length(trim(last_name)) <= 160), add check (names_need_review or length(trim(last_name))>=1);
alter table public.staff_profiles drop column display_name;
revoke select on public.staff_profiles from authenticated;
grant select(id,first_name,last_name,role,names_need_review) on public.staff_profiles to authenticated;

alter table public.patients enable row level security;
create policy staff_read_patients on public.patients for select to authenticated using ((select public.current_staff_role()) is not null);
revoke all on public.patients from anon,authenticated;
grant select on public.patients to authenticated;
-- security_invoker keeps both visits and patients RLS in effect.
create view public.visit_board with (security_invoker=true) as
select v.*, p.patient_ref, p.first_name, p.last_name, p.names_need_review, p.version as patient_version
from public.visits v join public.patients p on p.id=v.patient_id;
revoke all on public.visit_board from anon,authenticated;
grant select on public.visit_board to authenticated;

alter table public.audit_events add column patient_id uuid references public.patients(id);
update public.audit_events e set patient_id=v.patient_id from public.visits v where e.visit_id=v.id;

create or replace function public.record_visit_event() returns trigger
language plpgsql security definer set search_path='' as $$
declare actor_name text; reference text;
begin
 select trim(first_name || ' ' || last_name) into actor_name from public.staff_profiles where id=auth.uid();
 select patient_ref into reference from public.patients where id=new.patient_id;
 insert into public.audit_events(visit_id,patient_id,actor,actor_id,action,summary,before_record,after_record)
 values(new.id,new.patient_id,coalesce(actor_name,'System administrator'),auth.uid(),
 case when tg_op='INSERT' then 'registered' else 'updated' end,
 reference || ' ? P' || new.priority || ' ? ' || replace(new.status,'_',' '),
 case when tg_op='UPDATE' then to_jsonb(old) else null end,to_jsonb(new));
 return new;
end $$;
create trigger visit_audit after insert or update on public.visits for each row execute function public.record_visit_event();

create function public.record_patient_event() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into public.audit_events(patient_id,actor,actor_id,action,summary,before_record,after_record)
 select new.id,coalesce((select trim(first_name || ' ' || last_name) from public.staff_profiles where id=auth.uid()),'System administrator'),
 auth.uid(),'patient_updated',new.patient_ref || ' ? Patient names updated',to_jsonb(old),to_jsonb(new);
 return new;
end $$;
create trigger patient_audit after update on public.patients for each row execute function public.record_patient_event();
revoke all on function public.record_patient_event() from public,anon,authenticated;
create function public.save_visit(p_input jsonb, p_id uuid default null, p_version integer default null, p_patient_version integer default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  staff_role text := public.current_staff_role();
  existing public.visits;
  chosen_resource public.resources;
  saved_id uuid;
  person public.patients;
  person_id uuid;
  reference text := trim(p_input->>'patient_ref');
  given_name text := trim(p_input->>'first_name');
  family_name text := trim(p_input->>'last_name');
  resource uuid := nullif(p_input->>'resource_id', '')::uuid;
  new_status text := p_input->>'status';
  new_location text := coalesce(p_input->>'location', '');
begin
  if staff_role is null or staff_role not in ('clinician', 'coordinator') then
    raise exception 'A clinician or coordinator account is required.' using errcode = '42501';
  end if;
  if p_id is not null then
    select * into existing from public.visits where id = p_id for update;
    if not found then raise exception 'Patient visit not found.'; end if;
    if p_version is distinct from existing.version then raise exception 'This patient was updated elsewhere. Close and reopen the record.'; end if;
  end if;
  if given_name is null or family_name is null or length(given_name) not between 1 and 160 or length(family_name) not between 1 and 160 then
    raise exception 'First and last name are required.' using errcode = '23514';
  end if;
  if p_id is null then
    insert into public.patients(patient_ref, first_name, last_name)
    values(reference, given_name, family_name) on conflict do nothing returning id into person_id;
    if person_id is null then
      select * into person from public.patients where lower(trim(patient_ref)) = lower(reference) for update;
      person_id := person.id;
      if person.first_name <> given_name or person.last_name <> family_name then
        raise exception 'This patient reference has different names. Review the existing patient record before registering another visit.';
      end if;
    end if;
  else
    select * into person from public.patients where id = existing.patient_id for update;
    person_id := person.id;
    if lower(reference) is distinct from lower(trim(person.patient_ref)) then
      raise exception 'The patient reference cannot be changed on an existing visit.';
    end if;
    if p_patient_version is not null and p_patient_version is distinct from person.version then
      raise exception 'Patient details were updated elsewhere. Close and reopen the record.';
    end if;
    if person.first_name <> given_name or person.last_name <> family_name or person.names_need_review then
      if p_patient_version is null then raise exception 'Reload the patient record before changing names.'; end if;
      update public.patients set first_name=given_name, last_name=family_name, names_need_review=false,
        version=version+1 where id=person_id;
    end if;
  end if;
  if new_status in ('discharged', 'transferred') then resource := null; end if;
  if resource is not null then
    select * into chosen_resource from public.resources where id = resource for update;
    if not found or chosen_resource.state <> 'available' then raise exception 'This space is not available.'; end if;
    if exists (select 1 from public.visits where resource_id = resource and status not in ('discharged', 'transferred') and id is distinct from p_id) then
      raise exception 'This space is already assigned to another patient.';
    end if;
    new_location := chosen_resource.name;
  end if;
  if p_id is null then
    insert into public.visits(patient_id, age, complaint, priority, status, next_action, location, resource_id, assigned_to, notes)
    values(person_id, (p_input->>'age')::integer, trim(p_input->>'complaint'), (p_input->>'priority')::integer,
      new_status, p_input->>'next_action', new_location, resource, coalesce(p_input->>'assigned_to',''), coalesce(p_input->>'notes','')) returning id into saved_id;
  else
    update public.visits set age = (p_input->>'age')::integer,
      complaint = trim(p_input->>'complaint'), priority = (p_input->>'priority')::integer, status = new_status, next_action = p_input->>'next_action',
      location = new_location, resource_id = resource, assigned_to = coalesce(p_input->>'assigned_to',''), notes = coalesce(p_input->>'notes',''),
      updated_at = now(), version = version + 1 where id = p_id returning id into saved_id;
  end if;
  return saved_id;
end $$;

create or replace function public.set_resource_state(p_id uuid, p_state text) returns void
language plpgsql security definer set search_path = '' as $$
declare space_name text;
begin
  if public.current_staff_role() is distinct from 'coordinator' then raise exception 'A coordinator account is required.' using errcode = '42501'; end if;
  select name into space_name from public.resources where id = p_id for update;
  if not found then raise exception 'Space not found.'; end if;
  if exists (select 1 from public.visits where resource_id = p_id and status not in ('discharged', 'transferred')) then raise exception 'Release the assigned patient before changing this space.'; end if;
  update public.resources set state = p_state where id = p_id;
  insert into public.audit_events(actor, actor_id, action, summary)
  select trim(first_name || ' ' || last_name), auth.uid(), 'resource_updated', space_name || ' · ' || p_state from public.staff_profiles where id = auth.uid();
end $$;


revoke all on function public.save_visit(jsonb,uuid,integer,integer) from public,anon;
grant execute on function public.save_visit(jsonb,uuid,integer,integer) to authenticated;
alter publication supabase_realtime add table public.patients;
notify pgrst, 'reload schema';
commit;
