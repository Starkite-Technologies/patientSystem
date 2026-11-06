-- Emergency theatre list rules (Phase 1). Fixtures roll back.
begin;
insert into auth.users(id, email) values
 ('40000000-0000-0000-0000-000000000001','registrar@example.invalid'),
 ('40000000-0000-0000-0000-000000000002','consultant@example.invalid'),
 ('40000000-0000-0000-0000-000000000003','anaesthetist@example.invalid'),
 ('40000000-0000-0000-0000-000000000004','coordinator@example.invalid'),
 ('40000000-0000-0000-0000-000000000005','nurse@example.invalid'),
 ('40000000-0000-0000-0000-000000000006','viewer@example.invalid');
insert into public.staff_profiles(id,first_name,last_name,role) values
 ('40000000-0000-0000-0000-000000000001','Test','Registrar','clinician'),
 ('40000000-0000-0000-0000-000000000002','Test','Consultant','surgeon'),
 ('40000000-0000-0000-0000-000000000003','Test','Anaesthetist','anaesthetist'),
 ('40000000-0000-0000-0000-000000000004','Test','Coordinator','coordinator'),
 ('40000000-0000-0000-0000-000000000005','Test','Nurse','nurse'),
 ('40000000-0000-0000-0000-000000000006','Test','Viewer','viewer');
insert into public.resources(id,name,kind) values
 ('50000000-0000-0000-0000-000000000001','Test theatre A','Operating room'),
 ('50000000-0000-0000-0000-000000000002','Test bay','Treatment bay');
create temporary table ids(name text primary key, id uuid);
grant all on ids to authenticated;

-- Registrar books a complete case; viewer cannot book; incomplete standard booking is refused.
select set_config('request.jwt.claim.sub','40000000-0000-0000-0000-000000000001',true);
set local role authenticated;
do $$
declare full_input jsonb := '{"first_name":"Theatre","last_name":"Patient","location":"Ward 3","specialty":"General Surgery",
  "responsible_consultant":"Test Consultant","diagnosis":"Perforated viscus","proposed_operation":"Emergency laparotomy",
  "indication":"Generalised peritonitis","priority_code":"P3","delay_consequence":"sepsis","estimated_minutes":120,
  "haemodynamically_unstable":false,"septic_shock":false,"organ_support":false,"anaesthetic_concern":false}';
  case_id uuid;
begin
  case_id := public.book_theatre_case(full_input);
  insert into ids values ('standard', case_id);
  if (select booking_ref from public.theatre_bookings where id = case_id) !~ '^TB-[0-9]{6}$' then raise exception 'Booking reference missing'; end if;
  if not (select details_complete from public.theatre_bookings where id = case_id) then raise exception 'Complete booking marked incomplete'; end if;
  if (select booked_by_name from public.theatre_bookings where id = case_id) <> 'Test Registrar' then raise exception 'Booking clinician not recorded'; end if;
  if not exists (select 1 from public.audit_events where action = 'theatre_booked' and summary like '%Emergency laparotomy') then raise exception 'Booking audit missing'; end if;
  if (select deadline_at - decision_at from public.theatre_board where id = case_id) <> interval '6 hours' then raise exception 'Deadline not from decision time'; end if;
  begin
    perform public.book_theatre_case(full_input - 'indication');
    raise exception 'Incomplete standard booking accepted';
  exception when others then if sqlerrm not like 'Complete all required booking fields%' then raise; end if;
  end;
  -- Rapid P0: minimal fields, always P0, flagged incomplete.
  case_id := public.book_theatre_case('{"rapid":true,"first_name":"Rapid","last_name":"Case","location":"Resus","proposed_operation":"Laparotomy for haemorrhage","priority_code":"P5"}');
  insert into ids values ('rapid', case_id);
  if (select priority_code from public.theatre_bookings where id = case_id) <> 'P0' then raise exception 'Rapid booking not P0'; end if;
  if (select details_complete from public.theatre_bookings where id = case_id) then raise exception 'Rapid booking marked complete'; end if;
  begin
    perform public.change_theatre_priority(case_id, 1, 'P1', 'Registrar attempt');
    raise exception 'Registrar changed priority';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','40000000-0000-0000-0000-000000000006',true);
set local role authenticated;
do $$ begin
  perform public.book_theatre_case('{"rapid":true,"first_name":"A","last_name":"B","location":"Resus","proposed_operation":"X"}');
  raise exception 'Viewer booked a case';
exception when insufficient_privilege then null;
end $$;

-- Consultant changes priority only with a reason; the change is logged.
reset role;
select set_config('request.jwt.claim.sub','40000000-0000-0000-0000-000000000002',true);
set local role authenticated;
do $$ declare case_id uuid := (select id from ids where name = 'standard'); begin
  begin
    perform public.change_theatre_priority(case_id, 1, 'P1', '');
    raise exception 'Priority changed without reason';
  exception when others then if sqlerrm <> 'Give the clinical reason for the priority change.' then raise; end if;
  end;
  perform public.change_theatre_priority(case_id, 1, 'P1', 'Developed septic shock');
  if (select priority_code from public.theatre_bookings where id = case_id) <> 'P1' then raise exception 'Priority not changed'; end if;
  if not exists (select 1 from public.theatre_priority_changes where booking_id = case_id and from_code = 'P3' and to_code = 'P1') then raise exception 'Priority change not logged'; end if;
  if not exists (select 1 from public.audit_events where action = 'theatre_priority' and summary like '%P3 → P1: Developed septic shock') then raise exception 'Priority audit missing'; end if;
  if jsonb_array_length(public.list_theatre_staff()) <> 2 then raise exception 'Theatre staff list wrong'; end if;
end $$;

-- Nurse cannot assign a theatre but can mark readiness; coordinator assigns; only operating rooms accepted.
reset role;
select set_config('request.jwt.claim.sub','40000000-0000-0000-0000-000000000005',true);
set local role authenticated;
do $$ declare case_id uuid := (select id from ids where name = 'standard'); begin
  begin
    perform public.update_theatre_case(case_id, 2, '{"theatre_id":"50000000-0000-0000-0000-000000000001"}');
    raise exception 'Nurse assigned theatre';
  exception when insufficient_privilege then null;
  end;
  perform public.update_theatre_case(case_id, 2, '{"ready_for_theatre":true}');
end $$;
reset role;
select set_config('request.jwt.claim.sub','40000000-0000-0000-0000-000000000004',true);
set local role authenticated;
do $$ declare standard uuid := (select id from ids where name = 'standard'); rapid uuid := (select id from ids where name = 'rapid'); begin
  begin
    perform public.update_theatre_case(standard, 3, '{"theatre_id":"50000000-0000-0000-0000-000000000002"}');
    raise exception 'Non-theatre space accepted';
  exception when others then if sqlerrm <> 'Choose an operating theatre.' then raise; end if;
  end;
  begin
    perform public.update_theatre_case(standard, 3, '{"diagnosis":"Changed"}');
    raise exception 'Coordinator changed clinical details';
  exception when insufficient_privilege then null;
  end;
  perform public.update_theatre_case(standard, 3, '{"theatre_id":"50000000-0000-0000-0000-000000000001"}');
  perform public.update_theatre_case(rapid, 1, '{"theatre_id":"50000000-0000-0000-0000-000000000001"}');
  -- Stale version is refused.
  begin
    perform public.update_theatre_case(standard, 3, '{"ready_for_theatre":false}');
    raise exception 'Stale update accepted';
  exception when others then if sqlerrm <> 'This theatre case was updated elsewhere. Close and reopen it.' then raise; end if;
  end;
  -- One case in a theatre at a time.
  perform public.record_theatre_time(standard, 4, 'anaesthesia');
  begin
    perform public.record_theatre_time(rapid, 2, 'anaesthesia');
    raise exception 'Two cases in one theatre';
  exception when unique_violation then null;
  end;
  perform public.record_theatre_time(standard, 5, 'incision');
  perform public.record_theatre_time(standard, 6, 'completed');
  if (select status from public.theatre_bookings where id = standard) <> 'completed' then raise exception 'Case not completed'; end if;
  begin
    perform public.update_theatre_case(standard, 7, '{"ready_for_theatre":true}');
    raise exception 'Closed case updated';
  exception when others then if sqlerrm <> 'This theatre case is closed.' then raise; end if;
  end;
  -- Coordinator cancels only with the authorising consultant recorded.
  begin
    perform public.cancel_theatre_case(rapid, 2, 'Patient transferred out');
    raise exception 'Cancel without authoriser';
  exception when others then if sqlerrm <> 'Record which consultant authorised the cancellation.' then raise; end if;
  end;
  perform public.cancel_theatre_case(rapid, 2, 'Patient transferred out', 'Test Consultant');
  if (select status from public.theatre_bookings where id = rapid) <> 'cancelled' then raise exception 'Case not cancelled'; end if;
end $$;

-- Past the deadline: details need a delay reason; timestamps are never blocked.
reset role;
select set_config('request.jwt.claim.sub','40000000-0000-0000-0000-000000000001',true);
set local role authenticated;
do $$ declare late uuid; begin
  late := public.book_theatre_case(('{"first_name":"Late","last_name":"Case","location":"Ward 5","specialty":"Urology",
    "responsible_consultant":"Test Consultant","diagnosis":"Obstruction","proposed_operation":"Cystoscopy","indication":"Retention",
    "priority_code":"P3","delay_consequence":"pain","estimated_minutes":60,"haemodynamically_unstable":false,"septic_shock":false,
    "organ_support":false,"anaesthetic_concern":false,"decision_at":"' || (now() - interval '7 hours')::text || '"}')::jsonb);
  begin
    perform public.update_theatre_case(late, 1, '{"diagnosis":"Clot retention"}');
    raise exception 'Overdue update without delay reason';
  exception when others then if sqlerrm <> 'This case is past its deadline. Record the reason for delay.' then raise; end if;
  end;
  perform public.update_theatre_case(late, 1, '{"diagnosis":"Clot retention","delay_category":"theatre_capacity","delay_note":"Both theatres busy"}');
  if not exists (select 1 from public.audit_events where action in ('theatre_delay','theatre_updated') and summary like 'TB-%') then raise exception 'Delay audit missing'; end if;
  begin
    perform public.cancel_theatre_case(late, 2, 'Registrar cancels');
    raise exception 'Registrar cancelled';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Exports: theatre list by surgeon allowed, ED board by surgeon refused.
reset role;
select set_config('request.jwt.claim.sub','40000000-0000-0000-0000-000000000002',true);
set local role authenticated;
do $$ begin
  if (select summary from public.audit_events where id = public.record_export('theatre', '{}'::jsonb, array['TB-000001'])) <> 'Exported 1 theatre case to CSV: TB-000001' then
    raise exception 'Theatre export summary wrong';
  end if;
  begin
    perform public.record_export('board', '{}'::jsonb, '{}');
    raise exception 'Surgeon exported the ED board';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
set local role anon;
do $$ begin
  perform public.book_theatre_case('{}'::jsonb);
  raise exception 'Anonymous booking accepted';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  perform 1 from public.theatre_bookings limit 1;
  raise exception 'Anonymous read of theatre bookings';
exception when insufficient_privilege then null;
end $$;
rollback;
