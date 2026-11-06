-- Coordinator exports are recorded; other roles and anonymous callers are refused. Fixtures roll back.
begin;
insert into auth.users(id, email) values
 ('30000000-0000-0000-0000-000000000001', 'export-coordinator@example.invalid'),
 ('30000000-0000-0000-0000-000000000002', 'export-clinician@example.invalid');
insert into public.staff_profiles(id,first_name,last_name,role) values
 ('30000000-0000-0000-0000-000000000001','Export','Coordinator','coordinator'),
 ('30000000-0000-0000-0000-000000000002','Export','Clinician','clinician');

select set_config('request.jwt.claim.sub','30000000-0000-0000-0000-000000000002',true);
set local role authenticated;
do $$ begin
  perform public.record_export('board', '{}'::jsonb, array['PF-000001']);
  raise exception 'Clinician export unexpectedly recorded';
exception when insufficient_privilege then null;
end $$;

reset role;
select set_config('request.jwt.claim.sub','30000000-0000-0000-0000-000000000001',true);
set local role authenticated;
do $$
declare event_id uuid; refs text[];
begin
  event_id := public.record_export('completed', '{"from":"2026-10-01"}'::jsonb, array['PF-000001','PF-000002']);
  if (select summary from public.audit_events where id = event_id) <> 'Exported 2 completed visits to CSV: PF-000001, PF-000002' then
    raise exception 'Unexpected export summary';
  end if;
  if (select actor from public.audit_events where id = event_id) <> 'Export Coordinator' then raise exception 'Export actor missing'; end if;
  select array_agg('PF-' || lpad(i::text, 6, '0')) into refs from generate_series(1, 30) i;
  event_id := public.record_export('board', '{}'::jsonb, refs);
  if (select summary from public.audit_events where id = event_id) not like '%PF-000025 and 5 more' then raise exception 'Long export summary not truncated'; end if;
  event_id := public.record_export('board', '{}'::jsonb, '{}');
  if (select summary from public.audit_events where id = event_id) <> 'Exported 0 current board visits to CSV' then raise exception 'Empty export summary'; end if;
  begin
    perform public.record_export('everything', '{}'::jsonb, '{}');
    raise exception 'Unknown scope accepted';
  exception when invalid_parameter_value then null;
  end;
end $$;
-- Staff can read the summary but not the full row list.
do $$ begin
  perform after_record from public.audit_events limit 1;
  raise exception 'after_record unexpectedly readable';
exception when insufficient_privilege then null;
end $$;

reset role;
set local role anon;
do $$ begin
  perform public.record_export('board', '{}'::jsonb, '{}');
  raise exception 'Anonymous export unexpectedly recorded';
exception when insufficient_privilege then null;
end $$;
rollback;
