-- Both new roles can provide clinical care; nurses also coordinate resource availability.
begin;
insert into auth.users(id,email) values
 ('40000000-0000-0000-0000-000000000001','nurse-test@example.invalid'),
 ('40000000-0000-0000-0000-000000000002','surgeon-test@example.invalid');
insert into public.staff_profiles(id,first_name,last_name,role) values
 ('40000000-0000-0000-0000-000000000001','Test','Nurse','nurse'),
 ('40000000-0000-0000-0000-000000000002','Test','Surgeon','surgeon');

select set_config('request.jwt.claim.sub','40000000-0000-0000-0000-000000000001',true);
set local role authenticated;
do $$
declare input jsonb; visit uuid;
begin
 if public.current_staff_role() <> 'nurse' then raise exception 'Clinical role was not recognized'; end if;
 input := '{"patient_ref":"ROLE-nurse","first_name":"Fictional","last_name":"Patient","date_of_birth":"1996-05-20","complaint":"Test","priority":3,"status":"waiting","next_action":"assessment","location":"Waiting area","resource_id":null,"assigned_to":"","notes":""}'::jsonb;
 visit := public.save_visit(input);
 perform public.save_visit(input || '{"priority":2,"status":"in_treatment"}'::jsonb,visit,1,1);
 if not exists(select 1 from public.visit_board where id=visit and priority=2 and status='in_treatment') then raise exception 'Clinical update did not persist'; end if;
 perform public.set_resource_state((select id from public.resources where name='Treatment 02'),'cleaning');
 if (select state from public.resources where name='Treatment 02') <> 'cleaning' then raise exception 'Nurse could not coordinate spaces'; end if;
 perform public.set_resource_state((select id from public.resources where name='Treatment 02'),'available');
 begin
  update public.staff_profiles set role='coordinator';
  raise exception 'Clinical role could escalate privileges';
 exception when insufficient_privilege then null;
 end;
end $$;
reset role;

select set_config('request.jwt.claim.sub','40000000-0000-0000-0000-000000000002',true);
set local role authenticated;
do $$
declare input jsonb; visit uuid;
begin
 if public.current_staff_role() <> 'surgeon' then raise exception 'Clinical role was not recognized'; end if;
 input := '{"patient_ref":"ROLE-surgeon","first_name":"Fictional","last_name":"Patient","date_of_birth":"1996-05-20","complaint":"Test","priority":3,"status":"waiting","next_action":"assessment","location":"Waiting area","resource_id":null,"assigned_to":"","notes":""}'::jsonb;
 visit := public.save_visit(input);
 perform public.save_visit(input || '{"priority":2,"status":"in_treatment"}'::jsonb,visit,1,1);
 if not exists(select 1 from public.visit_board where id=visit and priority=2 and status='in_treatment') then raise exception 'Clinical update did not persist'; end if;
 begin
  perform public.set_resource_state((select id from public.resources limit 1),'cleaning');
  raise exception 'Clinical role could change space availability';
 exception when insufficient_privilege then null;
 end;
 begin
  update public.staff_profiles set role='coordinator';
  raise exception 'Clinical role could escalate privileges';
 exception when insufficient_privilege then null;
 end;
end $$;
reset role;
rollback;
