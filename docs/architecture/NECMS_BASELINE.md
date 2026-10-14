# NECMS baseline — Milestone 1

Review date: 2026-10-14. Status: repository inspection and preparation only. PatientFlow is an operational prototype; these checks do not establish clinical validation or production readiness. No application source, migrations, or hosted records were changed by this review.

Related documents: [design](NECMS_MULTI_HOSPITAL_DESIGN.md), [migration plan](NECMS_MIGRATION_PLAN.md), [security tests](NECMS_SECURITY_TEST_PLAN.md), [roadmap](NECMS_IMPLEMENTATION_ROADMAP.md).

## Evidence and limits

The inspected workspace contains React source, Django source, six ordered SQL migrations, existing tests and management commands. `git status --short` reports the application files as untracked; `git rev-parse --verify HEAD` fails because there is no baseline commit. Establish a reviewed commit before implementation so changes and recovery are reproducible. Do not commit `.env`, credentials, patient exports, or generated test screenshots.

The only hosted check executed was the existing read-only `check_supabase` command: Auth settings were reachable and a zero-row anonymous board request was denied. This does **not** establish which migrations are applied, the deployed column/function definitions, authenticated access, publication configuration, or ownership of any records. The environment has no database connection URL available for catalog inspection. Historical messages about running SQL in the dashboard are not migration evidence.

## Runtime architecture

| Component | Actual responsibility and dependency |
| --- | --- |
| `src/App.tsx` | Login, tracking board, queues, spaces, activity, registration/edit dialog and display mode. Uses Supabase session authentication, Django data requests and Supabase Realtime notifications. |
| `src/model.ts` | Flattened visit types; illustrative P1–P5 priorities; status/action lists; queue ordering; DOB/age calculations. |
| `src/lib/supabase.ts` | Browser client using project URL and publishable key. No clinical service-role credential belongs here. |
| `src/lib/api.ts` | Reads the Supabase session, sends its bearer token to Django, disables response caching and handles timeouts/errors. |
| `src/lib/store.ts` | Switches between Django-backed live operations and a localStorage demo. Demo storage is not an offline clinical synchronization system. |
| `backend/patients/authentication.py` | Verifies bearer token through Supabase `/auth/v1/user`; establishes the authenticated user UUID. |
| `backend/patients/gateway.py` | Forwards the user's token and configured publishable key to Supabase Data API. Reads the user's global staff role. |
| `backend/patients/views.py`, `serializers.py` | Authorize roles, validate fields, fetch board/resources/audit summaries and invoke PostgreSQL write functions. |
| `backend/config/settings.py`, `urls.py` | Django/DRF configuration and routing. Database backend is dummy: SQL schema is managed through Supabase migrations, not Django ORM models. Vite proxies `/api` to Django in development. |
| PostgreSQL | Authoritative tables, RLS, security-invoker board view, write RPCs, version checks, locks, constraints and audit triggers. |
| Realtime | Browser subscribes to public patients, visits and resources on a common channel; changes trigger a full refresh. Thirty-second polling and online-event refresh provide fallback. |

Declared stack: React 19, TypeScript 5.9, Vite 7, Supabase JS 2, Django 6, DRF, httpx and psycopg for migration tooling. `package-lock.json` and `backend/requirements.txt` are the dependency baselines. No Docker deployment or hospital deployment pipeline was found in the inspected files. Hospital date handling currently hardcodes `Africa/Johannesburg` rather than a facility configuration.

## Repository migration sequence versus applied sequence

The following is the **expected local sequence**, not a verified hosted history:

| Order | Migration | Result and compatibility risk |
| --- | --- | --- |
| 1 | `202610130001_initial.sql` | Creates global staff profiles, resources, visits and audit events; global-role RLS, RPCs and Realtime publication entries. |
| 2 | `202610140001_normalize_names.sql` | Creates patients and links visits by patient UUID; splits names and flags review; archives old names; drops original visit identity columns and staff display name; creates joined `visit_board`. |
| 3 | `202610140002_nurse_surgeon_roles.sql` | Adds nurse/surgeon to the global role vocabulary and updates clinical write authorization. |
| 4 | `202610140003_nurse_coordination.sql` | Grants resource coordination to nurses as well as coordinators in the database function. |
| 5 | `202610140004_patient_date_of_birth.sql` | Adds optional patient DOB, archives legacy ages and drops encounter age. No fabricated DOB backfill. Replaces dependent view/function definitions. |
| 6 | `202610140005_auto_patient_references.sql` | Adds reference sequence/helper/default and updates `save_visit` to generate references when omitted. Preserves existing references. |

The custom `apply_supabase_migrations` command orders files by name, serializes runners with an advisory lock, tracks filename and SHA-256 in private `public._patientflow_migrations`, and commits each file with its history record. It refuses an existing schema without history. Manual dashboard execution may not create this ledger. Several files create objects without `IF NOT EXISTS`; blindly replaying them is unsafe. Do not edit published migrations or manufacture ledger entries from filenames alone.

Expected schema after all six files:

| Object | Important fields/invariants |
| --- | --- |
| `staff_profiles` | Auth user UUID; first/last names, legacy name/review metadata; global role: viewer, clinician, coordinator, nurse or surgeon. |
| `patients` | UUID, reference, first/last names, optional DOB, name-review flag, version. Case/whitespace-normalized reference uniqueness. |
| `visits` | UUID, patient FK; complaint, priority 1–5, status, one next action, free-text location/assignment/notes, optional resource FK; arrival/update timestamps and version. One active visit per patient; one active patient per space. |
| `resources` | UUID, globally unique name, kind and available/cleaning/unavailable state. |
| `audit_events` | UUID, encounter/patient links as applicable, actor identity, action/time/summary and old/new snapshots where provided by clinical triggers. |
| `visit_board` | Security-invoker join of visits and patients, including DOB and patient version. |
| Private archives | `patient_name_migration_archive`, `patient_age_migration_archive`; original identity/age information preserved during conversion. Not ordinary user datasets. |
| Functions | `current_staff_role`, `save_visit(jsonb,uuid,integer,integer)`, resource state setter, visit/patient audit triggers, `next_patient_reference`. |

Before any later migration, a database owner must inspect columns, constraints, indexes, policies, grants, view security options, every function overload/body/owner/search path, trigger definitions, publication membership and schema exposure. Compare these with all six SQL files, not just the ledger. Particularly verify removal of old `save_visit` overloads, DOB/view consistency, nurse resource permissions and the reference helper's privileges. Reconcile differences in staging with a new migration; never assume the local schema matches deployment.

Local migration fingerprints captured during inspection use the runner's method: UTF-8 `read_text` with universal newline normalization, then SHA-256 of the encoded text. These fingerprints describe repository content, not hosted execution:

| Migration suffix | SHA-256 |
| --- | --- |
| `initial` | `378ea540f0fcfd5cf602502686a7cdef5c79c3a10bbf10f04d8795d1e1434949` |
| `normalize_names` | `e2794ec5894a0694f507aac75ae1015757ba76cfbc4f7692b14520ddac462975` |
| `nurse_surgeon_roles` | `eeb180639d1fa5f2bcc5b82f2cacdee1331da646647aef1f25e47660898ef316` |
| `nurse_coordination` | `4ded6d45802f2c7f95b2547c8f1f8cbac1b98ea58d3c95ea0bd62509ff57abb6` |
| `patient_date_of_birth` | `4fdea541b0fc48eaf9ecc0e536409c4509fd917aa458a901f2c2ba5ebab1f3fc` |
| `auto_patient_references` | `9271aae31ac23e8f20cc4d37e412607ccdb6f572e7a5aa8682d182d92d377c4a` |

## Authentication and current access control

1. React signs in using Supabase email/password and receives a session. Django validates the bearer token with Supabase Auth for each authenticated request.
2. Django fetches `staff_profiles` and permits the globally configured role. Clinical writes allow nurse, surgeon, clinician and coordinator; resource changes allow nurse/coordinator. A profile is not a hospital membership.
3. Database RLS permits provisioned staff to read clinical tables across the project. A user can read their own staff profile. Authenticated table writes are revoked; writes go through security-definer functions with their own global-role checks. Audit reads grant a limited column set rather than full snapshots.
4. `save_visit` locks existing encounters/patients and allocated spaces; checks encounter/patient versions; verifies identity on reference reuse; prevents concurrent active use of a space. These safeguards should be retained.
5. Authenticated callers can reach Supabase directly. Django-only filtering or a browser hospital selector cannot establish isolation. No hospital ID, membership, contextual capability or hospital-specific RLS currently exists.

## Features to retain and gaps

Retain registration and repeat visits, separate patient/encounter UUIDs, DOB storage, reference generation, tracking board, service views, spaces, nurse coordination, optimistic concurrency, audit snapshots, stale-data feedback and existing layout improvements.

Clinical acuity, care status and physical location are separate columns, but the priority vocabulary is illustrative and unversioned. Queue grouping uses one `next_action`; this cannot represent simultaneous clinical tasks. Physical location duplicates resource names in free text. Assigned staff are text rather than accepted responsibility or handover records. Only discharge/transfer close visits; there is no explicit closure/departure timestamp. Editing a completed record can change duration or reopen it without a dedicated reasoned transition. Acuity history, structured triage/reassessment, vital observations, escalation and location history are absent. Required names and priority obstruct incomplete emergency registration. These are later clinical milestones, not changes authorized here.

## Risks visible in current source

- **Privacy/access:** global role exposes all facilities' records; wall mode hides fields in React after fetching full records; raw Realtime subscriptions are not hospital scoped. Audit summaries and free text can also contain identifying information.
- **Data conversion:** name normalization chooses an identity from visits sharing a normalized reference and flags uncertain splits. Old columns are dropped after archives; any recovery must inspect archives and snapshots rather than infer values. Do not drop archives. UUID/ref replacement or unverified hospital assignment would break lineage.
- **Concurrency:** current version and space guards help, but a lost create response can lead to a second patient/reference on retry. New hospital checks must occur inside the same write transaction. Existing SQL tests do not demonstrate real parallel-connection race handling.
- **Board completeness:** unpaginated sequential Data API reads may hit hosted row limits and hide active records; separate requests are not a consistent board snapshot. Repeated realtime refreshes can discard earlier responses. No hospital context exists to bind returned data.
- **Workflow/safety:** priority colors have no approved protocol; location, staff ownership and reassessment history are incomplete. Discharge releases a space without automatically establishing cleaning readiness. Silent stale-data operation or inferred clinical decisions would be unsafe.
- **Audit:** visit/patient snapshots exist, but access, membership/configuration changes and resource before/after history are incomplete. Actor identity must survive future membership revocation and staff deactivation.
- **Operations:** no established versioned baseline, restore rehearsal, verified hosted configuration or clinical downtime procedure. The free Supabase account is a development choice, not an established production hosting arrangement.

## Executed baseline checks

Executed on 2026-10-14; each completed with exit code 0:

| Command | Actual result | What it does not prove |
| --- | --- | --- |
| `npm.cmd test` | 17 tests passed across 2 files. | Hospital isolation or clinical correctness. |
| `.venv\Scripts\python.exe backend\manage.py test patients --verbosity 1` | 27 tests passed; Django system check reported no issues. | Real Supabase permissions; HTTP interactions are mocked. |
| `npm.cmd run test:database` | Existing database checks passed. | Hosted configuration, real Realtime, or multi-connection concurrency. |
| `npm.cmd run build` | TypeScript and Vite production build passed. | Deployment security or availability. |
| `npm.cmd run test:browser` with `PREVIEW_URL=http://127.0.0.1:5174` | Existing browser checks passed against isolated demo: registration/edit/persistence, discharge, resources, activity, filters, display rendering, responsive dialog and frozen table header. | Server-side display privacy or live clinical operation. |
| `.venv\Scripts\python.exe backend\manage.py check_supabase` | Auth reachability and anonymous board denial passed. | Full applied migration sequence or authenticated hospital access. |

The database checker executes the existing SQL migrations in disposable in-memory PGlite with mock Auth roles and Realtime publication statements removed. It did not run hosted migrations. Browser checks used the existing fixture-based local demo with Supabase configuration explicitly disabled; no live patient records were created. Build and screenshot outputs are generated artifacts, not source changes. No NECMS security acceptance tests exist or were executed yet.

## Unverified decisions and hosted facts

Applied migrations/checksums and schema drift; actual staff permissions; record provenance; backups/restore facilities; hosting region and data governance; project row limits; Auth/MFA/session policies; exposed schemas and function grants; Realtime channel settings and revocation behavior; HTTPS/proxy/cache deployment settings; multi-facility legal/data-sharing authority. Hospital staff must confirm facility/department boundaries, authorized capabilities, shared-screen audiences, ownership evidence, downtime workflow and later clinical protocols. This documentation contains no hosted patient data or secrets.
