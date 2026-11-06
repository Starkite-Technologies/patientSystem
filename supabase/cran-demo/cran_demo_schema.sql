-- PatientFlow CRAN demo store (FHIR R4 resources as JSONB). SYNTHETIC DATA ONLY.
--
-- DO NOT apply this to the PatientFlow pilot project or any project holding real data.
-- It grants the anon role read/write so the unauthenticated stage demo works.
-- Use it only on a separate, throwaway Supabase project created for the demo,
-- then set CRAN_STORE=supabase, CRAN_SUPABASE_URL and CRAN_SUPABASE_KEY.
-- It is deliberately outside supabase/migrations/ so no migration runner picks it up.

create table if not exists public.fhir_resources (
  id text not null,
  resource_type text not null check (resource_type in
    ('Patient','Practitioner','Encounter','Observation','Condition','AllergyIntolerance')),
  resource jsonb not null check (resource->>'resourceType' = resource_type and resource->>'id' = id),
  updated_at timestamptz not null default now(),
  primary key (id)
);
create index if not exists fhir_resources_type_idx on public.fhir_resources (resource_type);
create index if not exists fhir_resources_encounter_idx on public.fhir_resources ((resource->'encounter'->>'reference'));
create index if not exists fhir_resources_identifier_idx on public.fhir_resources using gin ((resource->'identifier'));

create table if not exists public.cran_records (
  id text primary key,
  kind text not null,             -- suggestions | decisions | alerts | notes | meta
  data jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists cran_records_kind_idx on public.cran_records (kind, created_at);

alter table public.fhir_resources enable row level security;
alter table public.cran_records enable row level security;
create policy cran_demo_resources_anon on public.fhir_resources for all to anon using (true) with check (true);
create policy cran_demo_records_anon on public.cran_records for all to anon using (true) with check (true);

-- Live board: broadcast row changes to the browser (Supabase Realtime).
alter publication supabase_realtime add table public.fhir_resources, public.cran_records;
