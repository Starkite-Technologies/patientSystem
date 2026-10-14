-- Run on a development database after the migration. All fixtures roll back.
begin;
insert into auth.users(id, email) values
 ('10000000-0000-0000-0000-000000000001', 'coordinator-test@example.invalid'),
 ('10000000-0000-0000-0000-000000000002', 'viewer-test@example.invalid'),
 ('10000000-0000-0000-0000-000000000003', 'unprovisioned-test@example.invalid');
insert into public.staff_profiles(id,first_name,last_name,role) values
 ('10000000-0000-0000-0000-000000000001','Test','Coordinator','coordinator'),
 ('10000000-0000-0000-0000-000000000002','Test','Viewer','viewer');
insert into public.resources(id,name,kind) values ('20000000-0000-0000-0000-000000000001','Test space','Test');
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
set local role authenticated;
do $$
declare first_id uuid; second_id uuid; input jsonb;
begin
 input := '{"patient_ref":"TEST-A","first_name":"Test","last_name":"Patient","date_of_birth":"1996-05-20","complaint":"Test","priority":3,"status":"waiting","next_action":"assessment","location":"Waiting area","resource_id":"20000000-0000-0000-0000-000000000001","assigned_to":"Test clinician","notes":""}'::jsonb;
 first_id := public.save_visit(input);
 if (select location from public.visits where id=first_id) <> 'Test space' then raise exception 'Assigned location was not derived from resource'; end if;
 if not exists (select 1 from public.audit_events where visit_id=first_id and action='registered') then raise exception 'Registration audit missing'; end if;
 begin
   perform public.save_visit(input || '{"patient_ref":"TEST-B"}'::jsonb);
   raise exception 'Double assignment unexpectedly succeeded';
 exception when others then
   if sqlerrm <> 'This space is already assigned to another patient.' then raise; end if;
 end;
 perform public.save_visit(input || '{"priority":2}'::jsonb, first_id, 1);
 begin
   perform public.save_visit(input, first_id, 1);
   raise exception 'Stale update unexpectedly succeeded';
 exception when others then
   if sqlerrm <> 'This patient was updated elsewhere. Close and reopen the record.' then raise; end if;
 end;
 begin
   perform public.set_resource_state('20000000-0000-0000-0000-000000000001','cleaning');
   raise exception 'Occupied space state change unexpectedly succeeded';
 exception when others then
   if sqlerrm <> 'Release the assigned patient before changing this space.' then raise; end if;
 end;
 perform public.save_visit(input || '{"status":"discharged"}'::jsonb, first_id, 2);
 if (select resource_id from public.visits where id=first_id) is not null then raise exception 'Discharge failed to release space'; end if;
 perform public.set_resource_state('20000000-0000-0000-0000-000000000001','cleaning');
 begin
   perform public.save_visit(input || '{"patient_ref":"TEST-B"}'::jsonb);
   raise exception 'Cleaning space assignment unexpectedly succeeded';
 exception when others then
   if sqlerrm <> 'This space is not available.' then raise; end if;
 end;
 perform public.set_resource_state('20000000-0000-0000-0000-000000000001','available');
 second_id := public.save_visit(input || '{"patient_ref":"TEST-B"}'::jsonb);
 if second_id is null then raise exception 'Space was not reusable'; end if;
 begin
   update public.visits set priority=1 where id=second_id;
   raise exception 'Direct table mutation unexpectedly allowed';
 exception when insufficient_privilege then null;
 end;
 begin
   update public.staff_profiles set role='viewer';
   raise exception 'Self-service role mutation unexpectedly allowed';
 exception when insufficient_privilege then null;
 end;
 begin
   perform before_record from public.audit_events;
   raise exception 'Audit snapshots unexpectedly exposed';
 exception when insufficient_privilege then null;
 end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
set local role authenticated;
do $$ begin
 if not exists (select 1 from public.visit_board where patient_ref='TEST-B') then raise exception 'Provisioned viewer cannot read'; end if;
 if (select count(*) from public.staff_profiles) <> 1 then raise exception 'Other staff profiles exposed'; end if;
 begin
   perform public.save_visit('{}'::jsonb);
   raise exception 'Viewer write unexpectedly allowed';
 exception when insufficient_privilege then null;
 end;
 begin
   perform public.set_resource_state('20000000-0000-0000-0000-000000000001','available');
   raise exception 'Viewer resource change unexpectedly allowed';
 exception when insufficient_privilege then null;
 end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
set local role authenticated;
do $$ begin
 if exists (select 1 from public.visits) then raise exception 'Unprovisioned user can read visits'; end if;
 if exists (select 1 from public.visit_board) then raise exception 'Normalized view bypassed staff permissions'; end if;
 if exists (select 1 from public.patients) then raise exception 'Unprovisioned user can read patient identities'; end if;
 begin
   perform public.save_visit('{}'::jsonb);
   raise exception 'Unprovisioned write unexpectedly allowed';
 exception when insufficient_privilege then null;
 end;
end $$;
reset role;
set local role anon;
do $$ begin
 begin
   perform id from public.visits;
   raise exception 'Anonymous read unexpectedly allowed';
 exception when insufficient_privilege then null;
 end;
 begin
   perform public.save_visit('{}'::jsonb);
   raise exception 'Anonymous write unexpectedly allowed';
 exception when insufficient_privilege then null;
 end;
end $$;
reset role;
rollback;
