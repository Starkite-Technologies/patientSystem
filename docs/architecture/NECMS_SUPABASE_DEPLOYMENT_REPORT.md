# Supabase NECMS deployment report

2026-10-21. Original project deployment under the user's explicit authorisation. **Schema deployment is complete; clinical validation, hospital provisioning and production readiness are not established.** Earlier milestone reports describe their historical local-only execution and are not rewritten as hosted integration successes.

## Authorisation and target

The user explicitly authorised deployment to the original PatientFlow project after the original-project restriction was explained. They then authenticated the CLI locally and confirmed: **the existing patient records are fictional; keep ownership unassigned**. No hospital ownership or professional permissions were invented.

Verified through authenticated CLI metadata and a read-only Management API query:

- Project reference: `znltmxajrztszhjuamak`; project name: PatientSystem.
- Region: `eu-west-1`; project status: `ACTIVE_HEALTHY` at inspection.
- Database endpoint: `db.znltmxajrztszhjuamak.supabase.co`; PostgreSQL **17.11**.
- Supabase CLI **2.120.0**. Normal cached CLI authentication was used without displaying or exporting a token. No CLI upgrade, Docker, paid infrastructure, project-link command or public application deployment was performed.

## Baseline verification and migration decision

Read-only catalogue inspection found the original schema corresponding to the first six repository migrations. Column types/nullability/default hashes, existing indexes, function signatures/definition hashes, policies and trigger definitions matched that baseline. Existing foreign-key, primary-key, check and unique constraints matched. The embedded comparison engine was PostgreSQL 18.6 and exposed 32 additional not-null catalogue entries; the hosted PostgreSQL 17.11 column nullability flags nevertheless matched exactly. Recovery rehearsal used actual PostgreSQL 17.11.

The Supabase CLI migration ledger was absent. This indicated manual/schema-only application history; it was not treated as permission to replay the initial migration. The six existing migrations were **not rerun**, and no migration-history repair or fabricated ledger entry was created. Seven pending migrations were selected by verified object compatibility and reviewed source, not file names alone. Future CLI `db push` must not blindly replay the ledger-less history; reconcile that process through a separately reviewed procedure.

The hosted application had 10 patients, 10 active encounters, 5 resources, 10 audit events and 1 staff profile; both migration archive tables were empty. These were reported only as aggregate counts. No patient names, observations, staff credentials or record contents were displayed or committed.

## Recovery preparation and scope

The backup API returned no usable backup entry (`backups=null`, empty physical backup metadata); PITR was disabled. Provider-managed restoration was not claimed. Before hosted DDL, an application recovery snapshot was read into process memory and encrypted with Windows **CurrentUser DPAPI** into the ignored `backups/` directory. No plaintext record export was written or published.

The encrypted artifact bundles the original seven public application tables, reference-sequence state, exact first-six migration SQL, original column catalogue, original-value digests and the pending migration manifest. Its encrypted contents were decrypted in memory and restored into a newly created, verified loopback-only PostgreSQL 17.11 recovery database. Counts and sorted JSON digests matched all original values across all seven tables. Existing profile identifiers were represented by local Auth identity stubs, without exporting real Auth credentials. The seven pending migrations were then rehearsed there, preserving original values, unassigned ownership and zero hospital memberships.

This is **application-schema/data recovery evidence**, not complete Supabase project disaster recovery. Managed Auth credentials, signing material, storage and platform settings were not exported or restored; these migrations do not alter Auth user rows. DPAPI recovery requires the same Windows user/profile and its keys. Keep the encrypted backup securely; it is not a portable cross-user backup or a substitute for an independent provider recovery plan. No operational RPO/RTO is asserted. Do not automatically restore an old snapshot over future records; preserve later changes and prefer reviewed forward recovery.

The private recovery proof records the encrypted artifact SHA256, restore database, counts and generated-plan hash. These private artifacts are ignored by Git. No backup/data file belongs in GitHub.

## Actual hosted execution

Executed via the authenticated Management API using the explicit project reference. The CLI `--linked` query flag selected Management API transport; the repository was not linked with the project-link command.

All seven files were combined into **one transaction**, retaining their SQL/security semantics while removing only the individual outer BEGIN/COMMIT wrappers. The batch used lock/statement timeouts, acquired original-table locks, compared the complete pre-deployment catalogue with the reviewed snapshot, and checked original-column counts/digests before and after DDL. Schema drift, a stale data backup, failure to acquire locks or any unexpected original-value change would abort the batch. Final hosted result: `preservation_checks_passed`, seven migrations committed.

| Applied migration | SHA256 of reviewed local file |
| --- | --- |
| `202610140006_necms_hospital_isolation.sql` | `80a7d0c491559ee29209f913604be6f020d9e8dc3b830250dad84160141d2a0b` |
| `202610140007_necms_resource_audit_integrity.sql` | `dca40f4ba4b6d711f605b107e78dbaa19a378f36516666659600e36f704290d2` |
| `202610150001_necms_arrival_triage_foundations.sql` | `8f5633cca90c858d223806c110d1ad815546cda0a457f765187a049398069625` |
| `202610150002_necms_coordination.sql` | `f6aaaacaa2a286f74f1c59c130860427a827e3b4167a2d01a452f27ea7b493fd` |
| `202610150003_necms_verification_hardening.sql` | `13ef0b50daf7e70062e0e45b129df8316dc300f4b6eca0f38d5864aa1c98a143` |
| `202610190001_necms_bounded_reads.sql` | `ec5b280055174576917f835f630c9165ce34b8dc0e9a16502a6275df57d5a34b` |
| `202610200001_necms_presentation_summaries.sql` | `01ba7deb9974ec1031847aa841d3aa26fb88d0c256a75b869a445096485edfe5` |

The migration files themselves remain unchanged. There was no hosted reset, seed, record deletion, ownership backfill, triage activation, staff-role grant or membership creation. No RLS disabling was used. Initial failed backup-preparation SELECT attempts made no schema/data changes: sequence metadata needed explicit fields rather than a sequence composite conversion. That query was corrected before the backup was produced. SQL was supplied through private temporary files to avoid Windows argument-length limits; temporary operator files were removed after execution.

## Post-deployment results actually verified

| Check | Result |
| --- | --- |
| Original application row values | All seven original-table counts/digests matched after commit |
| Patients / encounters / resources / audit events / staff profiles | 10 / 10 / 5 / 10 / 1, preserved |
| Unassigned patients / encounters / resources | 10 / 10 / 5, all pending with NULL hospital |
| New hospitals / memberships | 0 / 0; no automatic access or clinical authority |
| Fabricated assessments / work items | 0 / 0 |
| Application tables without RLS | 0 in public/private application schemas |
| Authenticated direct-write table grants | 0 |
| Anonymous executable NECMS functions | 0 |
| Raw clinical publication tables | 0 |
| Actual anonymous REST hospital-list RPC | HTTP 401, access denied |
| Actual anonymous REST clinical-view request | HTTP 401, access denied |

The two REST smoke checks used only the configured public/anonymous key and displayed no response bodies or record values. This is real managed REST denial evidence, but **not** full authenticated multi-hospital integration, token refresh/expiry, capability revocation, clinical workflow or clinician-user end-to-end verification. Existing local 3E results (52 frontend, 112 Django, 15 client checks, 14 concurrency/recovery checks) remain their earlier scoped evidence and were not rerun or relabelled as hosted test passes here.

## Application configuration and what users will see

Enabled `NECMS_ENABLED=true` and `VITE_NECMS_ENABLED=true` in the ignored local `.env`, preserving existing credentials without exposing them. Restart Django and Vite to load these flags. Nothing was deployed to a public frontend/backend host.

**The normal application currently has no authorised hospital to select.** This is expected: the existing records deliberately remain pending/unassigned, and no hospital, role or membership was invented. Supabase Auth accounts were preserved, but a global legacy nurse role does not grant NECMS hospital membership. Historical records will not appear on a hospital board until a separately verified ownership mapping is approved.

The next configuration step is to name an actual or clearly fictional hospital/department for new work, approve a least-privilege capability matrix, and provision an authorised hospital administrator/staff membership. Do not automatically attach the old fictional records to that hospital. Hospital clinical approval is still needed before any real clinical use.

The independent fictional client demonstration still runs through `start-client-demo.mjs` / `demo-client-necms.mjs`; its simulated service does not demonstrate real authenticated hosted integration.

## Source, artifacts and operational limits

Added the target-specific operator `scripts/prepare-hosted-deployment.py`. Its default command requires the original six-migration baseline, creates an encrypted backup and rehearses locally; it refuses that preparation after NECMS is present. The explicit execution path requires the verified encrypted artifact, plan/migration hashes and recovery proof, with in-transaction schema/data guards. It is a reviewed one-target operator, **not a general deployment, record-export or destructive rollback tool**. Do not edit flags/guards to bypass a mismatch.

Final read-only checks confirmed the reference sequence state matched its predeployment snapshot. Repeating baseline preparation was rejected because NECMS already exists, before any backup or migration. The temporary local PostgreSQL server was stopped after verification.

Private verification metadata, digests, encrypted backup, recovery proof and execution/REST results remain in ignored local locations. Staff/clinical data was never published. The GitHub report contains aggregate evidence only.

Remaining gates: hospital/professional governance; reception-minimal and department-only access; role provisioning; real authenticated A/B isolation and session/capability tests; legacy bulk access and sustained load; device/TLS/cache/downtime policies; independent managed disaster recovery and support approval. No production-readiness or clinical-outcome claim follows from schema deployment.
