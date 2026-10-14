begin;
do $$ begin
 if exists(select 1 from public.patients where date_of_birth is not null) then raise exception 'DOB was incorrectly inferred from age'; end if;
 if (select count(*) from public.patient_age_migration_archive where recorded_age is not null) <> 3 then raise exception 'Recorded ages were not preserved'; end if;
 if exists(select 1 from information_schema.columns where table_schema='public' and table_name in ('patients','visits','visit_board') and column_name='age') then raise exception 'Derived age is still stored in the active schema'; end if;
end $$;
select set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000001',true);
set local role authenticated;
do $$
declare input jsonb;
begin
 input := '{"patient_ref":"migration-01","first_name":"Mary Jane","last_name":"van der Berg","date_of_birth":"1991-05-20","complaint":"Test","priority":3,"status":"waiting","next_action":"assessment","location":"Waiting area","resource_id":null,"assigned_to":"","notes":""}'::jsonb;
 perform public.save_visit(input,'91000000-0000-0000-0000-000000000002',1,1);
 if (select count(*) from public.visit_board where date_of_birth='1991-05-20') <> 2 then raise exception 'DOB did not apply across patient visits'; end if;
 begin
  perform public.save_visit(input || jsonb_build_object('patient_ref','DOB-FUTURE','date_of_birth',current_date+2));
  raise exception 'Future DOB accepted';
 exception when check_violation then null;
 end;
 begin
  perform public.save_visit(input || '{"patient_ref":"DOB-INVALID","date_of_birth":"2001-02-29"}'::jsonb);
  raise exception 'Invalid date accepted';
 exception when datetime_field_overflow then null;
 end;
 begin
  perform public.save_visit(input || '{"date_of_birth":"1992-01-01"}'::jsonb,'91000000-0000-0000-0000-000000000001',1,1);
  raise exception 'Stale identity version accepted';
 exception when others then
  if sqlerrm <> 'Patient details were updated elsewhere. Close and reopen the record.' then raise; end if;
 end;
 begin
  perform recorded_age from public.patient_age_migration_archive;
  raise exception 'Migration age archive exposed';
 exception when insufficient_privilege then null;
 end;
end $$;
reset role;
rollback;
