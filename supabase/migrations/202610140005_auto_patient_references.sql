-- Apply after patient_date_of_birth. Existing references are preserved.
begin;
create sequence public.patient_reference_sequence as bigint;
-- Start above any existing PF references, including manually imported ones.
select setval('public.patient_reference_sequence',
 greatest(coalesce((select max(substring(patient_ref from '^PF-([0-9]+)$')::bigint)
 from public.patients where patient_ref ~ '^PF-[0-9]+$'),0)+1,1),false);
create function public.next_patient_reference() returns text
language plpgsql security definer set search_path='' as $$
declare candidate text; number_text text;
begin
 loop
  number_text := nextval('public.patient_reference_sequence')::text;
  candidate := 'PF-' || lpad(number_text,greatest(6,length(number_text)),'0');
  if not exists(select 1 from public.patients where lower(trim(patient_ref))=lower(candidate)) then return candidate; end if;
 end loop;
end $$;
revoke all on sequence public.patient_reference_sequence from public,anon,authenticated;
revoke all on function public.next_patient_reference() from public,anon,authenticated;
alter table public.patients alter column patient_ref set default public.next_patient_reference();
create or replace function public.save_visit(p_input jsonb, p_id uuid default null, p_version integer default null, p_patient_version integer default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  staff_role text := public.current_staff_role();
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
    if reference is null then
      loop
        reference := public.next_patient_reference();
        insert into public.patients(patient_ref, first_name, last_name, date_of_birth)
        values(reference, given_name, family_name, birth_date) on conflict do nothing returning id into person_id;
        exit when person_id is not null;
      end loop;
    else
      insert into public.patients(patient_ref, first_name, last_name, date_of_birth)
      values(reference, given_name, family_name, birth_date) on conflict do nothing returning id into person_id;
    end if;
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
    if reference is null then reference := person.patient_ref; end if;
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
