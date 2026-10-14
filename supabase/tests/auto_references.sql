begin;
select set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000001',true);
set local role authenticated;
do $$
declare input jsonb; first_visit uuid; second_visit uuid; first_ref text; second_ref text;
begin
 input := '{"first_name":"Fictional","last_name":"Patient","date_of_birth":null,"complaint":"Test","priority":3,"status":"waiting","next_action":"assessment","location":"Waiting area","resource_id":null,"assigned_to":"","notes":""}'::jsonb;
 first_visit := public.save_visit(input);
 second_visit := public.save_visit(input || '{"patient_ref":""}'::jsonb);
 select patient_ref into first_ref from public.visit_board where id=first_visit;
 select patient_ref into second_ref from public.visit_board where id=second_visit;
 if first_ref !~ '^PF-[0-9]{6,}$' or second_ref !~ '^PF-[0-9]{6,}$' or first_ref=second_ref then raise exception 'Generated references are invalid or duplicated'; end if;
 perform public.save_visit(input || '{"status":"discharged"}'::jsonb,first_visit,1,1);
 if (select patient_ref from public.visit_board where id=first_visit) <> first_ref then raise exception 'Edit changed patient reference'; end if;
 perform public.save_visit(input || jsonb_build_object('patient_ref',first_ref));
 if (select count(distinct patient_id) from public.visit_board where patient_ref=first_ref) <> 1 then raise exception 'Repeat visit did not reuse patient identity'; end if;
 if (select count(*) from public.visit_board where patient_ref=first_ref) <> 2 then raise exception 'Repeat visit missing'; end if;
 if not exists(select 1 from public.patients where patient_ref='MIGRATION-02') then raise exception 'Existing references were changed'; end if;
 begin
  perform public.next_patient_reference();
  raise exception 'Staff can directly consume reference sequence';
 exception when insufficient_privilege then null;
 end;
end $$;
reset role;
rollback;
