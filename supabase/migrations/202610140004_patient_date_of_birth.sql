-- Apply after nurse_coordination. DOB belongs to the patient, not the visit.
-- Existing numeric ages cannot determine exact DOBs; keep those values archived.
begin;
create table public.patient_age_migration_archive as
select id as visit_id, patient_id, age as recorded_age, arrived_at from public.visits;
alter table public.patient_age_migration_archive enable row level security;
revoke all on public.patient_age_migration_archive from public,anon,authenticated;
alter table public.patients add column date_of_birth date;
-- Unknown DOB is NULL. Never infer a date from previously entered age.
alter table public.patients add constraint patients_dob_not_future
 check(date_of_birth is null or date_of_birth <= (current_timestamp at time zone 'Africa/Johannesburg')::date);
drop view public.visit_board;
alter table public.visits drop column age;
create view public.visit_board with (security_invoker=true) as
select v.*, p.patient_ref,p.first_name,p.last_name,p.date_of_birth,p.names_need_review,p.version as patient_version
from public.visits v join public.patients p on p.id=v.patient_id;
revoke all on public.visit_board from public,anon,authenticated;
grant select on public.visit_board to authenticated;

create or replace function public.record_patient_event() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into public.audit_events(patient_id,actor,actor_id,action,summary,before_record,after_record)
 select new.id,coalesce((select trim(first_name || ' ' || last_name) from public.staff_profiles where id=auth.uid()),'System administrator'),
 auth.uid(),'patient_updated',new.patient_ref || ' ? Patient identity updated',to_jsonb(old),to_jsonb(new);
 return new;
end $$;
create or replace function public.save_visit(p_input jsonb, p_id uuid default null, p_version integer default null, p_patient_version integer default null) returns uuid
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
  birth_date date := nullif(p_input->>'date_of_birth','')::date;
  family_name text := trim(p_input->>'last_name');
  resource uuid := nullif(p_input->>'resource_id', '')::uuid;
  new_status text := p_input->>'status';
  new_location text := coalesce(p_input->>'location', '');
begin
  if staff_role is null or staff_role not in ('clinician', 'coordinator', 'nurse', 'surgeon') then
    raise exception 'A nurse, surgeon, clinician, or coordinator account is required.' using errcode = '42501';
  end if;
  if p_id is not null then
    select * into existing from public.visits where id = p_id for update;
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
    insert into public.patients(patient_ref, first_name, last_name, date_of_birth)
    values(reference, given_name, family_name, birth_date) on conflict do nothing returning id into person_id;
    if person_id is null then
      select * into person from public.patients where lower(trim(patient_ref)) = lower(reference) for update;
      person_id := person.id;
      if person.first_name <> given_name or person.last_name <> family_name or person.date_of_birth is distinct from birth_date then
        raise exception 'This patient reference has different identity details. Review the existing patient record before registering another visit.';
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
    if person.first_name <> given_name or person.last_name <> family_name or person.date_of_birth is distinct from birth_date or person.names_need_review then
      if p_patient_version is null then raise exception 'Reload the patient record before changing identity details.'; end if;
      update public.patients set first_name=given_name, last_name=family_name, date_of_birth=birth_date, names_need_review=false,
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
    insert into public.visits(patient_id, complaint, priority, status, next_action, location, resource_id, assigned_to, notes)
    values(person_id, trim(p_input->>'complaint'), (p_input->>'priority')::integer,
      new_status, p_input->>'next_action', new_location, resource, coalesce(p_input->>'assigned_to',''), coalesce(p_input->>'notes','')) returning id into saved_id;
  else
    update public.visits set
      complaint = trim(p_input->>'complaint'), priority = (p_input->>'priority')::integer, status = new_status, next_action = p_input->>'next_action',
      location = new_location, resource_id = resource, assigned_to = coalesce(p_input->>'assigned_to',''), notes = coalesce(p_input->>'notes',''),
      updated_at = now(), version = version + 1 where id = p_id returning id into saved_id;
  end if;
  return saved_id;
end $$;

revoke all on function public.save_visit(jsonb,uuid,integer,integer) from public,anon;
grant execute on function public.save_visit(jsonb,uuid,integer,integer) to authenticated;
notify pgrst,'reload schema';
commit;
