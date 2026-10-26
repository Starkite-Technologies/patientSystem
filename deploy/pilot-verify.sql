-- PatientFlow pilot: read-only verification after the six legacy migrations.
-- Run in the Supabase SQL Editor of the PILOT project. Changes nothing.
-- Every row should say PASS.
with checks(check_name, ok) as (
  -- Legacy tables exist.
  select 'tables: patients, visits, resources, audit_events, staff_profiles',
    (select count(*) = 5 from pg_tables where schemaname = 'public'
       and tablename in ('patients','visits','resources','audit_events','staff_profiles'))
  union all
  select 'view: visit_board exists', to_regclass('public.visit_board') is not null
  union all
  -- RLS on every public table.
  select 'RLS enabled on every public table',
    not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity)
  union all
  -- Realtime publication.
  select 'realtime publishes visits, resources, patients',
    (select count(*) = 3 from pg_publication_tables where pubname = 'supabase_realtime'
       and schemaname = 'public' and tablename in ('visits','resources','patients'))
  union all
  -- Migration 0005 (auto patient references) applied.
  select 'migration 0005: patient_reference_sequence exists',
    to_regclass('public.patient_reference_sequence') is not null
  union all
  -- Migration 0002 role constraint includes nurse and surgeon.
  select 'migration 0002: nurse/surgeon roles allowed',
    exists (select 1 from pg_constraint where conname = 'staff_profiles_role_check'
            and pg_get_constraintdef(oid) like '%surgeon%' and pg_get_constraintdef(oid) like '%nurse%')
  union all
  -- No NECMS schema.
  select 'no NECMS tables (hospitals, hospital_memberships)',
    to_regclass('public.hospitals') is null and to_regclass('public.hospital_memberships') is null
  union all
  select 'no necms_* functions and no necms_private schema',
    not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname like 'necms\_%')
    and not exists (select 1 from pg_namespace where nspname = 'necms_private')
  union all
  -- Write functions: authenticated yes, anon no.
  select 'save_visit: authenticated can execute, anon cannot',
    has_function_privilege('authenticated', 'public.save_visit(jsonb,uuid,integer,integer)', 'execute')
    and not has_function_privilege('anon', 'public.save_visit(jsonb,uuid,integer,integer)', 'execute')
  union all
  select 'set_resource_state: authenticated can execute, anon cannot',
    has_function_privilege('authenticated', 'public.set_resource_state(uuid,text)', 'execute')
    and not has_function_privilege('anon', 'public.set_resource_state(uuid,text)', 'execute')
  union all
  select 'old 3-argument save_visit removed',
    to_regprocedure('public.save_visit(jsonb,uuid,integer)') is null
  union all
  -- Anonymous role cannot read tables directly.
  select 'anon has no SELECT on patient tables',
    not has_table_privilege('anon', 'public.patients', 'select')
    and not has_table_privilege('anon', 'public.visits', 'select')
    and not has_table_privilege('anon', 'public.visit_board', 'select')
)
select case when ok then 'PASS' else 'FAIL' end as result, check_name
from checks
order by ok, check_name;
