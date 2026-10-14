-- Apply once to a new Supabase project using the SQL Editor or Supabase CLI.
begin;

create table public.staff_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (length(trim(display_name)) between 1 and 120),
  role text not null check (role in ('clinician', 'coordinator', 'viewer'))
);
create table public.resources (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  kind text not null,
  state text not null default 'available' check (state in ('available', 'cleaning', 'unavailable'))
);
create table public.visits (
  id uuid primary key default gen_random_uuid(),
  patient_ref text not null check (length(trim(patient_ref)) between 1 and 80),
  patient_name text not null check (length(trim(patient_name)) between 1 and 160),
  age integer check (age between 0 and 130),
  complaint text not null check (length(trim(complaint)) between 1 and 300),
  priority integer not null check (priority between 1 and 5),
  status text not null check (status in ('waiting', 'ready', 'in_treatment', 'awaiting_results', 'observation', 'discharged', 'transferred')),
  next_action text not null check (next_action in ('assessment', 'imaging', 'laboratory', 'treatment', 'surgery', 'admission', 'none')),
  location text not null default '' check (length(location) <= 120),
  resource_id uuid references public.resources(id),
  assigned_to text not null default '' check (length(assigned_to) <= 120),
  notes text not null default '' check (length(notes) <= 2000),
  arrived_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  check (status not in ('discharged', 'transferred') or resource_id is null)
);
create unique index one_active_visit_per_patient on public.visits (lower(trim(patient_ref))) where status not in ('discharged', 'transferred');
create unique index one_patient_per_space on public.visits(resource_id) where resource_id is not null and status not in ('discharged', 'transferred');
create index visits_priority_arrival on public.visits(priority, arrived_at);
create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid references public.visits(id),
  actor text not null,
  actor_id uuid,
  action text not null,
  created_at timestamptz not null default now(),
  summary text not null,
  before_record jsonb,
  after_record jsonb
);
create index audit_events_time on public.audit_events(created_at desc);

create function public.current_staff_role() returns text
language sql stable security definer set search_path = ''
as $$ select role from public.staff_profiles where id = auth.uid() $$;

alter table public.staff_profiles enable row level security;
alter table public.visits enable row level security;
alter table public.resources enable row level security;
alter table public.audit_events enable row level security;
create policy own_profile on public.staff_profiles for select to authenticated using (id = auth.uid());
create policy staff_read_visits on public.visits for select to authenticated using ((select public.current_staff_role()) is not null);
create policy staff_read_resources on public.resources for select to authenticated using ((select public.current_staff_role()) is not null);
create policy staff_read_events on public.audit_events for select to authenticated using ((select public.current_staff_role()) is not null);

-- Writes only through checked functions. Users cannot grant themselves roles.
revoke all on public.staff_profiles, public.visits, public.resources, public.audit_events from anon, authenticated;
grant select on public.staff_profiles, public.visits, public.resources to authenticated;
grant select (id, visit_id, actor, actor_id, action, created_at, summary) on public.audit_events to authenticated;

create function public.record_visit_event() returns trigger
language plpgsql security definer set search_path = '' as $$
declare actor_name text;
begin
  select display_name into actor_name from public.staff_profiles where id = auth.uid();
  insert into public.audit_events (visit_id, actor, actor_id, action, summary, before_record, after_record)
  values (new.id, coalesce(actor_name, 'System administrator'), auth.uid(),
    case when tg_op = 'INSERT' then 'registered' else 'updated' end,
    new.patient_ref || ' · P' || new.priority || ' · ' || replace(new.status, '_', ' '),
    case when tg_op = 'UPDATE' then to_jsonb(old) else null end, to_jsonb(new));
  return new;
end $$;
create trigger visit_audit after insert or update on public.visits for each row execute function public.record_visit_event();

create function public.save_visit(p_input jsonb, p_id uuid default null, p_version integer default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  staff_role text := public.current_staff_role();
  existing public.visits;
  chosen_resource public.resources;
  saved_id uuid;
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
    insert into public.visits(patient_ref, patient_name, age, complaint, priority, status, next_action, location, resource_id, assigned_to, notes)
    values(trim(p_input->>'patient_ref'), trim(p_input->>'patient_name'), (p_input->>'age')::integer, trim(p_input->>'complaint'), (p_input->>'priority')::integer,
      new_status, p_input->>'next_action', new_location, resource, coalesce(p_input->>'assigned_to',''), coalesce(p_input->>'notes','')) returning id into saved_id;
  else
    update public.visits set patient_ref = trim(p_input->>'patient_ref'), patient_name = trim(p_input->>'patient_name'), age = (p_input->>'age')::integer,
      complaint = trim(p_input->>'complaint'), priority = (p_input->>'priority')::integer, status = new_status, next_action = p_input->>'next_action',
      location = new_location, resource_id = resource, assigned_to = coalesce(p_input->>'assigned_to',''), notes = coalesce(p_input->>'notes',''),
      updated_at = now(), version = version + 1 where id = p_id returning id into saved_id;
  end if;
  return saved_id;
end $$;

create function public.set_resource_state(p_id uuid, p_state text) returns void
language plpgsql security definer set search_path = '' as $$
declare space_name text;
begin
  if public.current_staff_role() is distinct from 'coordinator' then raise exception 'A coordinator account is required.' using errcode = '42501'; end if;
  select name into space_name from public.resources where id = p_id for update;
  if not found then raise exception 'Space not found.'; end if;
  if exists (select 1 from public.visits where resource_id = p_id and status not in ('discharged', 'transferred')) then raise exception 'Release the assigned patient before changing this space.'; end if;
  update public.resources set state = p_state where id = p_id;
  insert into public.audit_events(actor, actor_id, action, summary)
  select display_name, auth.uid(), 'resource_updated', space_name || ' · ' || p_state from public.staff_profiles where id = auth.uid();
end $$;

revoke all on function public.current_staff_role() from public, anon;
revoke all on function public.save_visit(jsonb, uuid, integer) from public, anon;
revoke all on function public.set_resource_state(uuid, text) from public, anon;
revoke all on function public.record_visit_event() from public, anon, authenticated;
grant execute on function public.current_staff_role() to authenticated;
grant execute on function public.save_visit(jsonb, uuid, integer) to authenticated;
grant execute on function public.set_resource_state(uuid, text) to authenticated;

insert into public.resources(name,kind,state) values
  ('Resus 01','Resuscitation','available'), ('Treatment 02','Treatment bay','available'),
  ('Treatment 03','Treatment bay','available'), ('Treatment 04','Treatment bay','cleaning'), ('Theatre 01','Operating room','available');

-- Realtime carries visit/resource changes; clients fetch audit summaries separately.
alter publication supabase_realtime add table public.visits, public.resources;
commit;
