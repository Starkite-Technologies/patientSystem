-- Executed after the name migration against the test fixtures above.
begin;
do $$ begin
 if (select count(*) from public.patients) <> 2 then raise exception 'Repeat visits did not share one patient'; end if;
 if (select count(distinct patient_id) from public.visits where id in ('91000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000002')) <> 1 then raise exception 'Patient identity duplicated'; end if;
 if (select last_name from public.patients where lower(patient_ref)='migration-01') <> 'Jane van der Berg' then raise exception 'Name tokens lost'; end if;
 if exists(select 1 from public.patients where not names_need_review) then raise exception 'Migrated names not flagged for review'; end if;
 if (select count(*) from public.patient_name_migration_archive where patient_name='Mary Jane van der Berg') <> 2 then raise exception 'Historical source names lost'; end if;
 if (select legacy_name from public.staff_profiles where id='90000000-0000-0000-0000-000000000001') <> 'Migration Coordinator' then raise exception 'Staff source name lost'; end if;
 if exists(select 1 from information_schema.columns where table_schema='public' and table_name='visits' and column_name in ('patient_name','patient_ref','first_name','last_name')) then raise exception 'Names still duplicated on visits'; end if;
end $$;
select set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000001',true);
set local role authenticated;
do $$
declare input jsonb;
begin
 input := '{"patient_ref":"migration-01","first_name":"Mary Jane","last_name":"van der Berg","date_of_birth":null,"complaint":"Test","priority":3,"status":"waiting","next_action":"assessment","location":"Waiting area","resource_id":null,"assigned_to":"","notes":""}'::jsonb;
 perform public.save_visit(input,'91000000-0000-0000-0000-000000000002',1,1);
 if (select count(*) from public.visit_board where first_name='Mary Jane' and last_name='van der Berg') <> 2 then raise exception 'Name change did not apply across visits'; end if;
 if exists(select 1 from public.visit_board where lower(patient_ref)='migration-01' and names_need_review) then raise exception 'Review flag not cleared'; end if;
 if not exists(select 1 from public.audit_events where action='patient_updated') then raise exception 'Patient identity audit missing'; end if;
 begin
  perform public.save_visit(input || '{"first_name":"Different"}'::jsonb,'91000000-0000-0000-0000-000000000001',1,1);
  raise exception 'Stale patient version accepted';
 exception when others then
  if sqlerrm <> 'Patient details were updated elsewhere. Close and reopen the record.' then raise; end if;
 end;
 begin
  perform * from public.patient_name_migration_archive;
  raise exception 'Historical import archive exposed';
 exception when insufficient_privilege then null;
 end;
 begin
  perform legacy_name from public.staff_profiles;
  raise exception 'Staff legacy name exposed';
 exception when insufficient_privilege then null;
 end;
end $$;
reset role;
set local role anon;
do $$ begin
 begin
  perform id from public.visit_board;
  raise exception 'Anonymous view access allowed';
 exception when insufficient_privilege then null;
 end;
end $$;
reset role;
rollback;
