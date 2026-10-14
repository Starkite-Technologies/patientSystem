-- Fictional fixtures only, executed in the disposable checker, never hosted.
insert into public.hospitals(id,code,name,facility_type) values
 ('a0000000-0000-0000-0000-000000000001','SYNTH-A','Synthetic Public A','public'),
 ('b0000000-0000-0000-0000-000000000001','SYNTH-B','Synthetic Private B','private');
insert into auth.users(id,email) values
 ('60000000-0000-0000-0000-000000000001','single@example.invalid'),
 ('60000000-0000-0000-0000-000000000002','dual@example.invalid'),
 ('60000000-0000-0000-0000-000000000003','display@example.invalid');
insert into public.staff_profiles(id,first_name,last_name,role)
 select id,'Synthetic','Staff','viewer' from auth.users where id::text like '60000000%';
insert into public.hospital_roles(id,hospital_id,code) values
 ('a1000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','nurse'),
 ('b1000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001','surgeon'),
 ('a1000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001','display');
insert into public.role_capabilities select r.id,c.code from public.hospital_roles r cross join public.capabilities c
 where r.code in ('nurse','surgeon') and c.code not in ('membership.manage','hospital.configure')
 and (r.code<>'surgeon' or c.code<>'resource.coordinate');
insert into public.role_capabilities values ('a1000000-0000-0000-0000-000000000002','display.read');
insert into public.hospital_memberships(hospital_id,user_id,role_id,active) values
 ('a0000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001',true),
 ('a0000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000002','a1000000-0000-0000-0000-000000000001',true),
 ('b0000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000002','b1000000-0000-0000-0000-000000000001',true),
 ('a0000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000003','a1000000-0000-0000-0000-000000000002',true);
insert into public.resources(id,hospital_id,ownership_state,name,kind) values
 ('a2000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','verified','Synthetic bay','Test'),
 ('b2000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001','verified','Synthetic bay','Test');
create function pg_temp.expect_error(sql_text text,expected_state text) returns void language plpgsql as $$
declare actual_state text;
begin
 begin execute sql_text; exception when others then get stacked diagnostics actual_state=returned_sqlstate; end;
 if actual_state is distinct from expected_state then raise exception 'Expected SQLSTATE %, got %',expected_state,actual_state; end if;
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub','60000000-0000-0000-0000-000000000002',false);
select set_config('request.headers',jsonb_build_object('x-necms-context',public.necms_create_context('b0000000-0000-0000-0000-000000000001')->>'id')::text,false);
do $$ declare c jsonb; v uuid; payload jsonb:= '{"patient_ref":"TEST-SHARED","first_name":"Synthetic","last_name":"Patient","date_of_birth":null,"complaint":"Fictional test","priority":3,"status":"waiting","next_action":"assessment","location":"Test","resource_id":null,"assigned_to":"","notes":"Synthetic only"}'; begin
 v:=public.save_visit(payload); perform set_config('test.b_visit',v::text,false);
 perform set_config('test.b_patient',(select patient_id::text from public.visits where id=v),false);
end $$;
select set_config('request.headers',jsonb_build_object('x-necms-context',public.necms_create_context('a0000000-0000-0000-0000-000000000001')->>'id')::text,false);
do $$ declare v uuid; payload jsonb:= '{"patient_ref":"TEST-SHARED","first_name":"Synthetic","last_name":"Patient","date_of_birth":null,"complaint":"Fictional test","priority":3,"status":"waiting","next_action":"assessment","location":"Test","resource_id":null,"assigned_to":"","notes":"Synthetic only"}'; begin
 v:=public.save_visit(payload||'{"resource_id":"a2000000-0000-0000-0000-000000000001"}');
 perform set_config('test.a_visit',v::text,false);
 if (select count(*) from public.patients)<>1 then raise exception 'Selected context leaked another hospital or quarantine'; end if;
 if (select count(*) from public.visits)<>1 then raise exception 'Encounter RLS failed'; end if;
 if jsonb_array_length(public.necms_board()->'visits')<>1 then raise exception 'Board leaked'; end if;
 perform pg_temp.expect_error(format('select public.save_visit(%L::jsonb,%L::uuid,1,1)',payload,current_setting('test.b_visit')),'P0001');
 perform pg_temp.expect_error(format('select public.save_visit(%L::jsonb)',payload||'{"patient_ref":"TEST-CROSS","resource_id":"b2000000-0000-0000-0000-000000000001"}'),'P0001');
 perform pg_temp.expect_error(format('select public.save_visit(%L::jsonb)',payload||'{"hospital_id":"b0000000-0000-0000-0000-000000000001"}'),'42501');
 perform pg_temp.expect_error(format('select public.save_visit(%L::jsonb,%L::uuid,99,1)',payload,current_setting('test.a_visit')),'P0001');
 perform pg_temp.expect_error(format('select public.save_visit(%L::jsonb)',payload||'{"patient_ref":"TEST-OCCUPIED","resource_id":"a2000000-0000-0000-0000-000000000001"}'),'P0001');
 perform pg_temp.expect_error('insert into public.hospital_memberships(hospital_id,user_id,role_id,active) values(gen_random_uuid(),auth.uid(),gen_random_uuid(),true)','42501');
end $$;
-- A-only staff cannot select B or reuse the dual user's context UUID.
select set_config('request.jwt.claim.sub','60000000-0000-0000-0000-000000000001',false);
select pg_temp.expect_error('select public.necms_create_context(''b0000000-0000-0000-0000-000000000001'')','42501');
select pg_temp.expect_error('select public.necms_board()','42501');
select set_config('test.single_context',public.necms_create_context('a0000000-0000-0000-0000-000000000001')->>'id',false);
select set_config('request.headers',jsonb_build_object('x-necms-context',current_setting('test.single_context'))::text,false);
do $$ begin
 if exists(select 1 from public.patients where hospital_id='b0000000-0000-0000-0000-000000000001') then raise exception 'Cross-hospital read'; end if;
 perform pg_temp.expect_error('select public.set_resource_state(''b2000000-0000-0000-0000-000000000001'',''cleaning'')','P0001');
end $$;
-- Dedicated display identity gets a whitelist, even through direct RPC.
select set_config('request.jwt.claim.sub','60000000-0000-0000-0000-000000000003',false);
select set_config('request.headers',jsonb_build_object('x-necms-context',public.necms_create_context('a0000000-0000-0000-0000-000000000001','display')->>'id')::text,false);
do $$ declare result jsonb; keys text[]; begin
 result:=public.necms_display_board();
 select array_agg(k order by k) into keys from jsonb_object_keys(result->0)k;
 if keys is distinct from array['display_label','next_action','space_state','status'] then raise exception 'Display fields leaked'; end if;
 if result::text like '%Synthetic%' or result::text like '%TEST-SHARED%' then raise exception 'Display identity leak'; end if;
 perform pg_temp.expect_error('select public.necms_board()','42501');
 if exists(select 1 from public.patients) then raise exception 'Display read base identity'; end if;
end $$;
reset role;

-- Constraint checks cannot be bypassed by an owner connection.
update public.visits set status='discharged' where id=current_setting('test.b_visit')::uuid;
select pg_temp.expect_error(format('update public.visits set patient_id=%L::uuid where id=%L::uuid',current_setting('test.b_patient'),current_setting('test.a_visit')),'23503');
select pg_temp.expect_error(format('update public.visits set resource_id=''b2000000-0000-0000-0000-000000000001'' where id=%L::uuid',current_setting('test.a_visit')),'23503');
-- Grant removal takes effect in a cached context; restore only synthetic grant.
delete from public.role_capabilities where role_id='a1000000-0000-0000-0000-000000000001' and capability='encounter.read';
set role authenticated;
select set_config('request.jwt.claim.sub','60000000-0000-0000-0000-000000000001',false);
select set_config('request.headers',jsonb_build_object('x-necms-context',current_setting('test.single_context'))::text,false);
select pg_temp.expect_error('select public.necms_board()','42501');
reset role;
insert into public.role_capabilities values('a1000000-0000-0000-0000-000000000001','encounter.read');
update public.hospital_memberships set active=false,authorization_version=authorization_version+1 where user_id='60000000-0000-0000-0000-000000000001';
set role authenticated;
select pg_temp.expect_error('select public.necms_board()','42501');
select pg_temp.expect_error('select public.necms_context_info()','42501');
select set_config('request.headers','{}',false);
select pg_temp.expect_error('select * from public.visit_board','42501');
reset role;
do $$ begin
 if exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename in ('patients','visits','resources')) then raise exception 'Raw clinical stream exposed'; end if;
 if (select count(*) from public.visits where ownership_state='verified')<>2 then raise exception 'Denied operations changed encounter count'; end if;
end $$;

-- Retry and discharge regression within a freshly authorised context.
set role authenticated;
select set_config('request.jwt.claim.sub','60000000-0000-0000-0000-000000000002',false);
select set_config('request.headers',jsonb_build_object('x-necms-context',public.necms_create_context('b0000000-0000-0000-0000-000000000001')->>'id')::text,false);
do $$ declare saved uuid; payload jsonb:= '{"_request_id":"71000000-0000-0000-0000-000000000001","first_name":"Synthetic","last_name":"Retry","date_of_birth":null,"complaint":"Test","priority":3,"status":"waiting","next_action":"assessment","location":"Test","resource_id":null,"assigned_to":"","notes":""}'; begin
 saved:=public.save_visit(payload);
 if public.save_visit(payload)<>saved then raise exception 'Retry created duplicate'; end if;
 perform pg_temp.expect_error(format('select public.save_visit(%L::jsonb)',payload||'{"priority":2}'),'23514');
 perform public.save_visit(payload||'{"status":"discharged"}',saved,1,1);
end $$;
reset role;

-- Bootstrap is test-owner-only, not a public membership creation path.
insert into auth.users(id,email) values('60000000-0000-0000-0000-000000000004','admin@example.invalid');
insert into public.hospital_roles(id,hospital_id,code) values('a1000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000001','administrator');
insert into public.role_capabilities select 'a1000000-0000-0000-0000-000000000003',code from public.capabilities;
insert into public.hospital_memberships(hospital_id,user_id,role_id,active) values('a0000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000004','a1000000-0000-0000-0000-000000000003',true);
set role authenticated;
select set_config('request.jwt.claim.sub','60000000-0000-0000-0000-000000000004',false);
select set_config('request.headers',jsonb_build_object('x-necms-context',public.necms_create_context('a0000000-0000-0000-0000-000000000001')->>'id')::text,false);
select public.necms_set_membership('60000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001',false,'Synthetic revocation');
select pg_temp.expect_error('select public.necms_set_membership(''60000000-0000-0000-0000-000000000004'',''a1000000-0000-0000-0000-000000000003'',true,''Test'')','42501');
select pg_temp.expect_error('select public.necms_set_membership(''60000000-0000-0000-0000-000000000001'',''b1000000-0000-0000-0000-000000000001'',true,''Test'')','42501');
select public.necms_configuration('{"language":"en","display_enabled":true}');
select pg_temp.expect_error('select public.necms_configuration(''{"priority_thresholds":1}'')','23514');
reset role;


-- Expiry and membership validity are checked against the DB, not JWT claims.
update necms_private.access_contexts set expires_at=now()-interval '1 second'
 where id=(current_setting('request.headers')::jsonb->>'x-necms-context')::uuid;
set role authenticated;
select pg_temp.expect_error('select public.necms_staff()','42501');
reset role;
update public.hospital_memberships set valid_until=now()-interval '1 second' where user_id='60000000-0000-0000-0000-000000000004';
set role authenticated;
select pg_temp.expect_error('select public.necms_create_context(''a0000000-0000-0000-0000-000000000001'')','42501');
reset role;
set role anon;
select pg_temp.expect_error('select public.necms_create_context(''a0000000-0000-0000-0000-000000000001'')','42501');
select pg_temp.expect_error('select * from public.visit_board','42501');
reset role;
