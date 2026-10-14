-- Additive forward fix. Disposable testing only until hosted target, impact,
-- recovery and this exact execution have been reviewed and approved.
begin;
create or replace function public.set_resource_state(p_id uuid,p_state text) returns void
language plpgsql security definer set search_path='' as $$
declare
 hospital uuid:=public.necms_require('resource.coordinate',true);
 context_record necms_private.access_contexts:=public.necms_context();
 previous public.resources;
 actor_name text;
begin
 -- Membership capabilities remain the authority; legacy profile.role is not.
 -- A missing identity is rejected atomically, never silently fabricated.
 select trim(first_name||' '||last_name) into actor_name from public.staff_profiles where id=auth.uid();
 if not found then raise exception 'Provision the staff identity before changing a treatment space.' using errcode='42501'; end if;
 if p_state is null or p_state not in ('available','cleaning','unavailable') then
  raise exception 'Invalid treatment space state.' using errcode='23514';
 end if;
 select * into previous from public.resources
 where id=p_id and hospital_id=hospital and ownership_state='verified' for update;
 if not found then raise exception 'Space not found.'; end if;
 if exists(select 1 from public.visits where resource_id=p_id and status not in ('discharged','transferred')) then
  raise exception 'Release the assigned patient before changing this space.';
 end if;
 update public.resources set state=p_state where id=previous.id;
 -- If INSERT fails, PostgreSQL rolls back the resource UPDATE as well.
 insert into public.audit_events(hospital_id,ownership_state,actor,actor_id,action,created_at,summary,before_record,after_record)
 values(hospital,'verified',actor_name,auth.uid(),'resource_updated',clock_timestamp(),'Treatment space status changed',
 jsonb_build_object('resource_id',previous.id,'hospital_id',hospital,'state',previous.state),
 jsonb_build_object('resource_id',previous.id,'hospital_id',hospital,'state',p_state,
 'context_id',context_record.id,'membership_id',context_record.membership_id));
end $$;
revoke all on function public.set_resource_state(uuid,text) from public,anon;
grant execute on function public.set_resource_state(uuid,text) to authenticated;
notify pgrst,'reload schema';
commit;
