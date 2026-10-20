-- PREPARED ONLY. Run manually only after the exact hosted target is approved
-- for read-only inspection. This is not a migration or deployment command.
-- Catalogue metadata only: no patient/Auth-user rows or function source bodies.
begin read only;
set local statement_timeout = '15s';
set local lock_timeout = '2s';

select current_database() as database_name, current_user as database_role,
       inet_server_addr() as server_address, inet_server_port() as server_port,
       current_setting('server_version') as server_version;
-- Database name/server IP alone cannot establish the Supabase project identity.

select n.nspname as schema_name, c.relname as object_name, c.relkind,
       c.relrowsecurity as rls_enabled, c.relforcerowsecurity as force_rls,
       pg_get_userbyid(c.relowner) as owner_role, c.relacl::text as table_acl,
       c.reloptions as object_options
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname in ('public','necms_private') and c.relkind in ('r','p','v','m','S')
order by 1,2;

select n.nspname as schema_name, c.relname as table_name, a.attname as column_name,
       format_type(a.atttypid,a.atttypmod) as data_type, a.attnotnull as not_null,
       a.attidentity as identity_mode, a.attgenerated as generated_mode,
       md5(coalesce(pg_get_expr(d.adbin,d.adrelid),'')) as default_expression_hash,
       a.attacl::text as column_acl
from pg_attribute a join pg_class c on c.oid=a.attrelid
join pg_namespace n on n.oid=c.relnamespace
left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum
where n.nspname in ('public','necms_private') and c.relkind in ('r','p','v')
  and a.attnum>0 and not a.attisdropped
order by 1,2,a.attnum;

select n.nspname as schema_name, c.relname as table_name, x.conname,
       x.contype, x.convalidated, x.condeferrable, x.condeferred,
       md5(pg_get_constraintdef(x.oid)) as definition_hash
from pg_constraint x join pg_class c on c.oid=x.conrelid
join pg_namespace n on n.oid=c.relnamespace
where n.nspname in ('public','necms_private') order by 1,2,3;

select schemaname,tablename,indexname,md5(indexdef) as definition_hash
from pg_indexes where schemaname in ('public','necms_private') order by 1,2,3;

select schemaname,tablename,policyname,permissive,roles,cmd,
       md5(coalesce(qual,'')) as using_expression_hash,
       md5(coalesce(with_check,'')) as check_expression_hash
from pg_policies where schemaname in ('public','necms_private') order by 1,2,3;

select n.nspname as schema_name,p.proname,
       pg_get_function_identity_arguments(p.oid) as argument_types,
       pg_get_function_result(p.oid) as return_type,
       p.prosecdef as security_definer,p.provolatile,
       pg_get_userbyid(p.proowner) as owner_role,p.proacl::text as function_acl,
       (select v from unnest(p.proconfig) v where v like 'search_path=%' limit 1) as search_path,
       md5(pg_get_functiondef(p.oid)) as definition_hash
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('public','necms_private') and p.prokind='f'
order by 1,2,3;

select n.nspname as schema_name,c.relname as table_name,t.tgname,
       t.tgenabled,md5(pg_get_triggerdef(t.oid)) as definition_hash
from pg_trigger t join pg_class c on c.oid=t.tgrelid
join pg_namespace n on n.oid=c.relnamespace
where n.nspname in ('public','necms_private') and not t.tgisinternal
order by 1,2,3;

select pubname,schemaname,tablename from pg_publication_tables
where schemaname in ('public','necms_private') order by 1,2,3;

select to_regclass('supabase_migrations.schema_migrations') is not null as migration_ledger_exists;
-- If present and readable, separately inspect ONLY its version/name columns.
-- Do not export its statements column or automatically repair the ledger.
-- Missing ledger entries do not prove that manually applied SQL is absent.

rollback;
