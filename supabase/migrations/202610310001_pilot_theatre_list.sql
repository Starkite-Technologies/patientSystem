-- Pilot (single-department) schema only: emergency theatre list, Phase 1 (docs/architecture/THEATRE_LIST_DESIGN.md).
-- Priority codes and targets are PLACEHOLDERS (clinically_approved = false) until the surgical, anaesthetic and
-- theatre leads approve them. The software records priorities; it never changes one by itself.
begin;

alter table public.staff_profiles drop constraint staff_profiles_role_check;
alter table public.staff_profiles add constraint staff_profiles_role_check
  check (role in ('viewer','clinician','coordinator','nurse','surgeon','anaesthetist'));

create table public.theatre_priority_codes (
  code text primary key check (code ~ '^P[0-9]$'),
  ncepod text not null check (ncepod in ('immediate','urgent','expedited')),
  label text not null check (length(trim(label)) between 1 and 60),
  target_minutes integer not null check (target_minutes > 0),
  example text not null default '' check (length(example) <= 200),
  sort_order integer not null unique,
  clinically_approved boolean not null default false
);
insert into public.theatre_priority_codes(code,ncepod,label,target_minutes,example,sort_order) values
 ('P0','immediate','Immediate',15,'Uncontrolled haemorrhage',0),
 ('P1','urgent','Within 1 hour',60,'Selected limb- or organ-threatening emergencies',1),
 ('P2','urgent','Within 2 hours',120,'Time-critical surgical emergencies',2),
 ('P3','urgent','Within 6 hours',360,'Source control after resuscitation',3),
 ('P4','urgent','Within 12 hours',720,'Stable urgent surgical conditions',4),
 ('P5','expedited','Within 24 hours',1440,'Stable, needs early intervention',5),
 ('P6','expedited','Within 72 hours',4320,'Expedited procedures',6);

create sequence public.theatre_booking_reference_sequence as bigint;
create table public.theatre_bookings (
  id uuid primary key default gen_random_uuid(),
  booking_ref text not null unique default ('TB-' || lpad(nextval('public.theatre_booking_reference_sequence')::text, 6, '0')),
  patient_id uuid not null references public.patients(id),
  visit_id uuid references public.visits(id),
  mrn text not null default '' check (length(mrn) <= 40),
  sex text not null default 'unknown' check (sex in ('female','male','other','unknown')),
  location text not null check (length(trim(location)) between 1 and 120),
  specialty text not null default '' check (specialty in ('','General Surgery','Orthopaedics','Obstetrics and Gynaecology',
    'Neurosurgery','Urology','ENT','Maxillofacial Surgery','Vascular Surgery','Paediatric Surgery','Cardiothoracic Surgery','Plastic Surgery')),
  responsible_consultant text not null default '' check (length(responsible_consultant) <= 120),
  booked_by uuid,
  booked_by_name text not null,
  diagnosis text not null default '' check (length(diagnosis) <= 300),
  proposed_operation text not null check (length(trim(proposed_operation)) between 1 and 300),
  indication text not null default '' check (length(indication) <= 1000),
  priority_code text not null references public.theatre_priority_codes(code),
  delay_consequence text not null default '' check (delay_consequence in ('','death','limb_organ','sepsis','bowel','neurological','pain','other')),
  decision_at timestamptz not null,
  booked_at timestamptz not null default now(),
  estimated_minutes integer check (estimated_minutes between 10 and 1440),
  -- NULL means "not recorded", never "normal".
  haemodynamically_unstable boolean, septic_shock boolean, organ_support boolean, anaesthetic_concern boolean,
  ready_for_theatre boolean not null default false,
  details_complete boolean not null default true,
  status text not null default 'booked' check (status in ('booked','anaesthesia','operating','completed','cancelled')),
  theatre_id uuid references public.resources(id),
  planned_start timestamptz,
  anaesthesia_start_at timestamptz, incision_at timestamptz, completed_at timestamptz,
  delay_category text check (delay_category is null or delay_category in ('theatre_capacity','anaesthetist','surgeon','patient_optimisation',
    'investigations','blood_bank','equipment','critical_care_bed','transport','competing_emergency','administrative','other')),
  delay_note text not null default '' check (length(delay_note) <= 500),
  cancelled_reason text not null default '' check (length(cancelled_reason) <= 500),
  cancel_authorised_by text not null default '' check (length(cancel_authorised_by) <= 120),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  check (status <> 'cancelled' or length(trim(cancelled_reason)) >= 5)
);
create unique index one_case_in_each_theatre on public.theatre_bookings(theatre_id) where status in ('anaesthesia','operating');
create index theatre_bookings_open on public.theatre_bookings(status, decision_at);

create table public.theatre_priority_changes (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.theatre_bookings(id),
  from_code text not null, to_code text not null,
  changed_by uuid, changed_by_name text not null,
  changed_at timestamptz not null default now(),
  reason text not null check (length(trim(reason)) between 5 and 500)
);

alter table public.theatre_priority_codes enable row level security;
alter table public.theatre_bookings enable row level security;
alter table public.theatre_priority_changes enable row level security;
create policy staff_read_theatre_codes on public.theatre_priority_codes for select to authenticated using ((select public.current_staff_role()) is not null);
create policy staff_read_theatre_bookings on public.theatre_bookings for select to authenticated using ((select public.current_staff_role()) is not null);
create policy staff_read_theatre_changes on public.theatre_priority_changes for select to authenticated using ((select public.current_staff_role()) is not null);
revoke all on public.theatre_priority_codes, public.theatre_bookings, public.theatre_priority_changes from public, anon, authenticated;
grant select on public.theatre_priority_codes, public.theatre_bookings, public.theatre_priority_changes to authenticated;
revoke all on sequence public.theatre_booking_reference_sequence from public, anon, authenticated;

create view public.theatre_board with (security_invoker = true) as
select b.*, p.patient_ref, p.first_name, p.last_name, p.date_of_birth,
       c.ncepod, c.label as priority_label, c.target_minutes, c.sort_order as priority_order, c.clinically_approved,
       b.decision_at + make_interval(mins => c.target_minutes) as deadline_at, r.name as theatre_name
from public.theatre_bookings b
join public.patients p on p.id = b.patient_id
join public.theatre_priority_codes c on c.code = b.priority_code
left join public.resources r on r.id = b.theatre_id;
revoke all on public.theatre_board from public, anon, authenticated;
grant select on public.theatre_board to authenticated;

-- Name of the signed-in staff member for records.
create function public.theatre_actor() returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select trim(first_name || ' ' || last_name) from public.staff_profiles where id = auth.uid()), 'System administrator')
$$;

create function public.theatre_require(p_roles text[], p_message text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare r text := public.current_staff_role();
begin
  if r is null or not (r = any(p_roles)) then raise exception '%', p_message using errcode = '42501'; end if;
  return r;
end $$;

create function public.book_theatre_case(p_input jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  rapid boolean := coalesce((p_input->>'rapid')::boolean, false);
  person uuid := nullif(p_input->>'patient_id', '')::uuid;
  decided timestamptz := coalesce(nullif(p_input->>'decision_at', '')::timestamptz, now());
  chosen text := case when rapid then 'P0' else nullif(p_input->>'priority_code', '') end;
  new_id uuid;
  complete boolean;
begin
  perform public.theatre_require(array['clinician','surgeon','anaesthetist'], 'Only clinicians, surgeons and anaesthetists can book theatre cases.');
  if nullif(trim(p_input->>'proposed_operation'), '') is null or nullif(trim(p_input->>'location'), '') is null then
    raise exception 'Enter the proposed operation and the patient''s location.';
  end if;
  if chosen is null or not exists (select 1 from public.theatre_priority_codes c where c.code = chosen) then
    raise exception 'Choose a priority code.';
  end if;
  if decided > now() + interval '5 minutes' or decided < now() - interval '7 days' then
    raise exception 'The decision to operate must be within the last 7 days and not in the future.';
  end if;
  complete := nullif(p_input->>'specialty', '') is not null and nullif(trim(p_input->>'responsible_consultant'), '') is not null
    and nullif(trim(p_input->>'diagnosis'), '') is not null and nullif(trim(p_input->>'indication'), '') is not null
    and nullif(p_input->>'delay_consequence', '') is not null and nullif(p_input->>'estimated_minutes', '') is not null
    and p_input ? 'haemodynamically_unstable' and p_input->>'haemodynamically_unstable' is not null
    and p_input->>'septic_shock' is not null and p_input->>'organ_support' is not null and p_input->>'anaesthetic_concern' is not null;
  if not rapid and not complete then
    raise exception 'Complete all required booking fields, or use rapid booking for an immediate case.';
  end if;
  if person is null then
    if nullif(trim(p_input->>'first_name'), '') is null or nullif(trim(p_input->>'last_name'), '') is null then
      raise exception 'Enter the patient''s first and last name.';
    end if;
    insert into public.patients(first_name, last_name, date_of_birth)
    values (trim(p_input->>'first_name'), trim(p_input->>'last_name'), nullif(p_input->>'date_of_birth', '')::date)
    returning id into person;
  elsif not exists (select 1 from public.patients where id = person) then
    raise exception 'Patient not found.';
  end if;
  insert into public.theatre_bookings(patient_id, visit_id, mrn, sex, location, specialty, responsible_consultant, booked_by, booked_by_name,
    diagnosis, proposed_operation, indication, priority_code, delay_consequence, decision_at, estimated_minutes,
    haemodynamically_unstable, septic_shock, organ_support, anaesthetic_concern, details_complete)
  values (person, nullif(p_input->>'visit_id', '')::uuid, coalesce(trim(p_input->>'mrn'), ''), coalesce(nullif(p_input->>'sex', ''), 'unknown'),
    trim(p_input->>'location'), coalesce(p_input->>'specialty', ''), coalesce(trim(p_input->>'responsible_consultant'), ''),
    auth.uid(), public.theatre_actor(), coalesce(trim(p_input->>'diagnosis'), ''), trim(p_input->>'proposed_operation'),
    coalesce(trim(p_input->>'indication'), ''), chosen, coalesce(p_input->>'delay_consequence', ''), decided,
    nullif(p_input->>'estimated_minutes', '')::integer, (p_input->>'haemodynamically_unstable')::boolean, (p_input->>'septic_shock')::boolean,
    (p_input->>'organ_support')::boolean, (p_input->>'anaesthetic_concern')::boolean, complete)
  returning id into new_id;
  return new_id;
end $$;

create function public.update_theatre_case(p_id uuid, p_version integer, p_input jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  b public.theatre_bookings;
  r text := public.current_staff_role();
  deadline timestamptz;
  clinical text[] := array['mrn','sex','location','specialty','responsible_consultant','diagnosis','proposed_operation','indication',
    'delay_consequence','decision_at','estimated_minutes','haemodynamically_unstable','septic_shock','organ_support','anaesthetic_concern'];
  field text;
begin
  select * into b from public.theatre_bookings where id = p_id for update;
  if not found then raise exception 'Theatre case not found.'; end if;
  if b.version <> p_version then raise exception 'This theatre case was updated elsewhere. Close and reopen it.'; end if;
  if b.status in ('completed','cancelled') then raise exception 'This theatre case is closed.'; end if;
  if p_input ? 'priority_code' then raise exception 'Use Change priority to change the priority code.'; end if;
  if p_input = '{}'::jsonb then raise exception 'Nothing to update.'; end if;
  for field in select jsonb_object_keys(p_input) loop
    if field = any(clinical) then
      perform public.theatre_require(array['clinician','surgeon','anaesthetist'], 'Only clinicians, surgeons and anaesthetists can change clinical details.');
    elsif field = 'ready_for_theatre' then
      perform public.theatre_require(array['clinician','surgeon','anaesthetist','coordinator','nurse'], 'Your role cannot change theatre readiness.');
    elsif field in ('theatre_id','planned_start') then
      perform public.theatre_require(array['coordinator','surgeon','anaesthetist'], 'Only the theatre coordinator, surgeon or anaesthetist can assign a theatre.');
    elsif field in ('delay_category','delay_note') then
      perform public.theatre_require(array['clinician','surgeon','anaesthetist','coordinator'], 'Your role cannot record the reason for delay.');
    else
      raise exception 'Unknown theatre field.';
    end if;
  end loop;
  if p_input ? 'theatre_id' and nullif(p_input->>'theatre_id', '') is not null and not exists
     (select 1 from public.resources where id = (p_input->>'theatre_id')::uuid and kind = 'Operating room') then
    raise exception 'Choose an operating theatre.';
  end if;
  if p_input ? 'decision_at' and ((p_input->>'decision_at')::timestamptz > now() + interval '5 minutes'
     or (p_input->>'decision_at')::timestamptz < now() - interval '7 days') then
    raise exception 'The decision to operate must be within the last 7 days and not in the future.';
  end if;
  update public.theatre_bookings set
    mrn = case when p_input ? 'mrn' then coalesce(trim(p_input->>'mrn'), '') else mrn end,
    sex = case when p_input ? 'sex' then coalesce(nullif(p_input->>'sex', ''), 'unknown') else sex end,
    location = case when p_input ? 'location' then trim(p_input->>'location') else location end,
    specialty = case when p_input ? 'specialty' then coalesce(p_input->>'specialty', '') else specialty end,
    responsible_consultant = case when p_input ? 'responsible_consultant' then coalesce(trim(p_input->>'responsible_consultant'), '') else responsible_consultant end,
    diagnosis = case when p_input ? 'diagnosis' then coalesce(trim(p_input->>'diagnosis'), '') else diagnosis end,
    proposed_operation = case when p_input ? 'proposed_operation' then trim(p_input->>'proposed_operation') else proposed_operation end,
    indication = case when p_input ? 'indication' then coalesce(trim(p_input->>'indication'), '') else indication end,
    delay_consequence = case when p_input ? 'delay_consequence' then coalesce(p_input->>'delay_consequence', '') else delay_consequence end,
    decision_at = case when p_input ? 'decision_at' then (p_input->>'decision_at')::timestamptz else decision_at end,
    estimated_minutes = case when p_input ? 'estimated_minutes' then nullif(p_input->>'estimated_minutes', '')::integer else estimated_minutes end,
    haemodynamically_unstable = case when p_input ? 'haemodynamically_unstable' then (p_input->>'haemodynamically_unstable')::boolean else haemodynamically_unstable end,
    septic_shock = case when p_input ? 'septic_shock' then (p_input->>'septic_shock')::boolean else septic_shock end,
    organ_support = case when p_input ? 'organ_support' then (p_input->>'organ_support')::boolean else organ_support end,
    anaesthetic_concern = case when p_input ? 'anaesthetic_concern' then (p_input->>'anaesthetic_concern')::boolean else anaesthetic_concern end,
    ready_for_theatre = case when p_input ? 'ready_for_theatre' then coalesce((p_input->>'ready_for_theatre')::boolean, false) else ready_for_theatre end,
    theatre_id = case when p_input ? 'theatre_id' then nullif(p_input->>'theatre_id', '')::uuid else theatre_id end,
    planned_start = case when p_input ? 'planned_start' then nullif(p_input->>'planned_start', '')::timestamptz else planned_start end,
    delay_category = case when p_input ? 'delay_category' then nullif(p_input->>'delay_category', '') else delay_category end,
    delay_note = case when p_input ? 'delay_note' then coalesce(trim(p_input->>'delay_note'), '') else delay_note end,
    updated_at = now(), version = version + 1
  where id = p_id returning * into b;
  update public.theatre_bookings set details_complete = (specialty <> '' and responsible_consultant <> '' and diagnosis <> '' and indication <> ''
    and delay_consequence <> '' and estimated_minutes is not null and haemodynamically_unstable is not null and septic_shock is not null
    and organ_support is not null and anaesthetic_concern is not null) where id = p_id;
  -- Past the deadline and not yet in theatre: a reason for delay must be recorded (nurses only update readiness).
  select b.decision_at + make_interval(mins => target_minutes) into deadline from public.theatre_priority_codes where code = b.priority_code;
  if b.status = 'booked' and now() > deadline and b.delay_category is null and r <> 'nurse' then
    raise exception 'This case is past its deadline. Record the reason for delay.';
  end if;
end $$;

create function public.change_theatre_priority(p_id uuid, p_version integer, p_code text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.theatre_bookings;
begin
  perform public.theatre_require(array['surgeon','anaesthetist'], 'Only a consultant surgeon or anaesthetist can change the priority.');
  if length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'Give the clinical reason for the priority change.'; end if;
  select * into b from public.theatre_bookings where id = p_id for update;
  if not found then raise exception 'Theatre case not found.'; end if;
  if b.version <> p_version then raise exception 'This theatre case was updated elsewhere. Close and reopen it.'; end if;
  if b.status in ('completed','cancelled') then raise exception 'This theatre case is closed.'; end if;
  if not exists (select 1 from public.theatre_priority_codes where code = p_code) then raise exception 'Choose a priority code.'; end if;
  if b.priority_code = p_code then raise exception 'The case already has this priority.'; end if;
  insert into public.theatre_priority_changes(booking_id, from_code, to_code, changed_by, changed_by_name, reason)
  values (p_id, b.priority_code, p_code, auth.uid(), public.theatre_actor(), trim(p_reason));
  update public.theatre_bookings set priority_code = p_code, updated_at = now(), version = version + 1 where id = p_id;
end $$;

-- Timestamps are never blocked by a missing delay reason: recording that surgery started must always work.
create function public.record_theatre_time(p_id uuid, p_version integer, p_event text, p_at timestamptz default null) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.theatre_bookings; moment timestamptz := coalesce(p_at, now());
begin
  perform public.theatre_require(array['clinician','surgeon','anaesthetist','coordinator','nurse'], 'Your role cannot record theatre times.');
  select * into b from public.theatre_bookings where id = p_id for update;
  if not found then raise exception 'Theatre case not found.'; end if;
  if b.version <> p_version then raise exception 'This theatre case was updated elsewhere. Close and reopen it.'; end if;
  if moment > now() + interval '1 minute' or moment < b.decision_at - interval '1 minute' then
    raise exception 'That time must be after the decision to operate and not in the future.';
  end if;
  if p_event = 'anaesthesia' then
    if b.status <> 'booked' then raise exception 'Anaesthesia start can only be recorded for a booked case.'; end if;
    if b.theatre_id is null then raise exception 'Assign a theatre first.'; end if;
    update public.theatre_bookings set anaesthesia_start_at = moment, status = 'anaesthesia', updated_at = now(), version = version + 1 where id = p_id;
  elsif p_event = 'incision' then
    if b.status not in ('booked','anaesthesia') then raise exception 'Surgery start can only be recorded before the case is completed.'; end if;
    if b.theatre_id is null then raise exception 'Assign a theatre first.'; end if;
    if b.anaesthesia_start_at is not null and moment < b.anaesthesia_start_at then raise exception 'Surgery cannot start before anaesthesia.'; end if;
    update public.theatre_bookings set incision_at = moment, status = 'operating', updated_at = now(), version = version + 1 where id = p_id;
  elsif p_event = 'completed' then
    if b.status not in ('anaesthesia','operating') then raise exception 'Only a case in theatre can be completed.'; end if;
    if moment < coalesce(b.incision_at, b.anaesthesia_start_at) then raise exception 'Completion cannot be before the start.'; end if;
    update public.theatre_bookings set completed_at = moment, status = 'completed', ready_for_theatre = false, updated_at = now(), version = version + 1 where id = p_id;
  else
    raise exception 'Unknown theatre event.';
  end if;
end $$;

create function public.cancel_theatre_case(p_id uuid, p_version integer, p_reason text, p_authorised_by text default '') returns void
language plpgsql security definer set search_path = '' as $$
declare b public.theatre_bookings; r text;
begin
  r := public.theatre_require(array['surgeon','coordinator'], 'Only the consultant surgeon or the theatre coordinator can cancel a case.');
  if length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'Give the reason for cancelling.'; end if;
  if r = 'coordinator' and length(trim(coalesce(p_authorised_by, ''))) < 3 then
    raise exception 'Record which consultant authorised the cancellation.';
  end if;
  select * into b from public.theatre_bookings where id = p_id for update;
  if not found then raise exception 'Theatre case not found.'; end if;
  if b.version <> p_version then raise exception 'This theatre case was updated elsewhere. Close and reopen it.'; end if;
  if b.status <> 'booked' then raise exception 'Only a case that has not started can be cancelled.'; end if;
  update public.theatre_bookings set status = 'cancelled', cancelled_reason = trim(p_reason),
    cancel_authorised_by = case when r = 'surgeon' then public.theatre_actor() else trim(p_authorised_by) end,
    ready_for_theatre = false, updated_at = now(), version = version + 1 where id = p_id;
end $$;

-- Names of consultants and anaesthetists for the booking form (staff cannot read other staff profiles directly).
create function public.list_theatre_staff() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if public.current_staff_role() is null then raise exception 'Staff access required.' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('name', trim(first_name || ' ' || last_name), 'role', role) order by role, last_name, first_name)
    from public.staff_profiles where role in ('surgeon','anaesthetist')), '[]'::jsonb);
end $$;

create function public.record_theatre_event() returns trigger
language plpgsql security definer set search_path = '' as $$
declare action text; summary text;
begin
  if tg_op = 'INSERT' then
    action := 'theatre_booked';
    summary := new.booking_ref || ' · Booked ' || new.priority_code || ' · ' || new.proposed_operation;
  elsif new.status <> old.status then
    action := 'theatre_' || new.status;
    summary := new.booking_ref || ' · ' || case new.status when 'anaesthesia' then 'Anaesthesia started' when 'operating' then 'Surgery started'
      when 'completed' then 'Completed' else 'Cancelled: ' || new.cancelled_reason end;
  elsif new.priority_code <> old.priority_code then
    action := 'theatre_priority';
    summary := new.booking_ref || ' · Priority ' || old.priority_code || ' → ' || new.priority_code || ': '
      || coalesce((select reason from public.theatre_priority_changes where booking_id = new.id order by changed_at desc limit 1), '');
  elsif new.delay_category is distinct from old.delay_category or new.delay_note <> old.delay_note then
    action := 'theatre_delay';
    summary := new.booking_ref || ' · Delay reason: ' || coalesce(new.delay_category, 'cleared');
  elsif new.version = old.version then
    return new;  -- details_complete recalculation only
  else
    action := 'theatre_updated';
    summary := new.booking_ref || ' · Case details updated';
  end if;
  insert into public.audit_events(patient_id, actor, actor_id, action, summary)
  values (new.patient_id, public.theatre_actor(), auth.uid(), action, summary);
  return new;
end $$;
create trigger theatre_audit after insert or update on public.theatre_bookings for each row execute function public.record_theatre_event();

-- Exports: theatre list may be exported by coordinators, surgeons and anaesthetists; ED board and completed visits by coordinators.
create or replace function public.record_export(p_scope text, p_filters jsonb, p_patient_refs text[]) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  actor_name text; event_id uuid;
  refs text[] := coalesce(p_patient_refs, '{}');
  row_count integer := cardinality(coalesce(p_patient_refs, '{}'));
  listed text; noun text; role text := public.current_staff_role();
begin
  if p_scope is null or p_scope not in ('board', 'completed', 'theatre') then
    raise exception 'Unknown export scope.' using errcode = '22023';
  end if;
  if (p_scope = 'theatre' and role is distinct from 'coordinator' and role is distinct from 'surgeon' and role is distinct from 'anaesthetist')
     or (p_scope <> 'theatre' and role is distinct from 'coordinator') then
    raise exception 'Your role cannot export this list.' using errcode = '42501';
  end if;
  if row_count > 10000 then
    raise exception 'Export is limited to 10,000 visits.' using errcode = '22023';
  end if;
  select trim(first_name || ' ' || last_name) into actor_name from public.staff_profiles where id = auth.uid();
  listed := case
    when row_count = 0 then ''
    when row_count <= 25 then ': ' || array_to_string(refs, ', ')
    else ': ' || array_to_string(refs[1:25], ', ') || ' and ' || (row_count - 25) || ' more'
  end;
  noun := case p_scope when 'board' then ' current board' when 'completed' then ' completed' else ' theatre' end
    || case when p_scope = 'theatre' then case when row_count = 1 then ' case' else ' cases' end
            else case when row_count = 1 then ' visit' else ' visits' end end;
  insert into public.audit_events(actor, actor_id, action, summary, after_record)
  values (coalesce(actor_name, 'Coordinator'), auth.uid(), 'exported', 'Exported ' || row_count || noun || ' to CSV' || listed,
    jsonb_build_object('scope', p_scope, 'filters', coalesce(p_filters, '{}'::jsonb), 'row_count', row_count, 'patient_refs', to_jsonb(refs)))
  returning id into event_id;
  return event_id;
end $$;

do $$ declare f text; begin
  foreach f in array array['public.theatre_actor()','public.theatre_require(text[],text)','public.record_theatre_event()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['public.book_theatre_case(jsonb)','public.update_theatre_case(uuid,integer,jsonb)',
    'public.change_theatre_priority(uuid,integer,text,text)','public.record_theatre_time(uuid,integer,text,timestamptz)',
    'public.cancel_theatre_case(uuid,integer,text,text)','public.list_theatre_staff()','public.record_export(text,jsonb,text[])'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
notify pgrst, 'reload schema';
commit;
