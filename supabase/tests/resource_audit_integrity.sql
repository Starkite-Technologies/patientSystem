-- Synthetic only. Reuse fictional A/B fixture identities; no automatic profiles.
reset role;
update public.hospital_memberships set active=true,valid_until=null,
 authorization_version=authorization_version+1 where user_id='60000000-0000-0000-0000-000000000004';
insert into public.resources(id,hospital_id,ownership_state,name,kind)
values('a2000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000001','verified','Synthetic audit space','Test');
set role authenticated;
select set_config('request.jwt.claim.sub','60000000-0000-0000-0000-000000000004',false);
select set_config('request.headers',jsonb_build_object('x-necms-context',public.necms_create_context('a0000000-0000-0000-0000-000000000001')->>'id')::text,false);
select set_config('audit_test.before',(select count(*)::text from public.audit_events where action='resource_updated'),false);
select pg_temp.expect_error('select public.set_resource_state(''a2000000-0000-0000-0000-000000000003'',''cleaning'')','42501');
do $$ begin
 if (select state from public.resources where id='a2000000-0000-0000-0000-000000000003')<>'available' then raise exception 'Missing profile changed space'; end if;
 if (select count(*) from public.audit_events where action='resource_updated')<>current_setting('audit_test.before')::bigint then raise exception 'Denied mutation logged as successful'; end if;
end $$;
reset role;
-- Explicit fixture provisioning: the application never creates this identity.
insert into public.staff_profiles(id,first_name,last_name,role)
values('60000000-0000-0000-0000-000000000004','Synthetic','Audit staff','viewer');
set role authenticated;
select public.set_resource_state('a2000000-0000-0000-0000-000000000003','cleaning');
do $$ begin
 if (select count(*) from public.audit_events where action='resource_updated')<>current_setting('audit_test.before')::bigint+1 then raise exception 'Resource audit missing or duplicated'; end if;
 -- Snapshot privileges remain protected. Validate attribution as test owner below.
end $$;
select pg_temp.expect_error('select public.set_resource_state(''b2000000-0000-0000-0000-000000000001'',''cleaning'')','P0001');
reset role;
do $$ declare event public.audit_events; begin
 select * into event from public.audit_events where action='resource_updated' order by created_at desc limit 1;
 if event.actor_id<>'60000000-0000-0000-0000-000000000004'::uuid or event.hospital_id<>'a0000000-0000-0000-0000-000000000001'::uuid
 or event.created_at is null or event.actor is null or event.before_record->>'state'<>'available' or event.after_record->>'state'<>'cleaning'
 or event.after_record->>'resource_id'<>'a2000000-0000-0000-0000-000000000003'
 or event.after_record->>'context_id' is distinct from current_setting('request.headers')::jsonb->>'x-necms-context'
 or event.after_record->>'membership_id' is null then raise exception 'Resource audit attribution/details invalid'; end if;
 if event.after_record ? 'patient_id' or event.after_record ? 'notes' then raise exception 'Unnecessary clinical detail in resource audit'; end if;
end $$;
-- Tighten the disposable audit sink to fail insertion. Never disable RLS.
create function pg_temp.reject_resource_audit() returns trigger language plpgsql as $$
begin if new.action='resource_updated' then raise exception 'Synthetic audit sink failure' using errcode='23514'; end if; return new; end $$;
create trigger synthetic_audit_sink before insert on public.audit_events for each row execute function pg_temp.reject_resource_audit();
set role authenticated;
select pg_temp.expect_error('select public.set_resource_state(''a2000000-0000-0000-0000-000000000003'',''available'')','23514');
do $$ begin
 if (select state from public.resources where id='a2000000-0000-0000-0000-000000000003')<>'cleaning' then raise exception 'Audit failure did not roll back mutation'; end if;
 if (select count(*) from public.audit_events where action='resource_updated')<>current_setting('audit_test.before')::bigint+1 then raise exception 'Failed audit left partial event'; end if;
end $$;
reset role;
drop trigger synthetic_audit_sink on public.audit_events;
