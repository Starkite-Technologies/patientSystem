# NECMS integration, migration and recovery runbook

Prepared in 3C; hosted steps below are **not executed or authorised**. Never use the original PatientFlow project for destructive testing. No credentials belong in this file, Git, screenshots, logs or chat. Operator placeholders are not runnable deployment defaults.

## Gate 1: approve and identify the target

Record a named owner, exact project reference, purpose (dedicated synthetic test), region, organisation, expected PostgreSQL version, endpoint/project mapping and approval date. Separately record approval for the exact migration files/checksums and execution window. Merely owning a project or possessing its credentials is insufficient.

Confirm a clean target or documented synthetic-only contents. Inventory only schema/catalogue information and privacy-safe aggregate counts until data classification is approved. Do not download patient rows or copy live credentials/data into tests. Stop on uncertain ownership or mismatch. Use a separate ignored local environment file and separate browser profile; never silently reuse `.env` or CLI-linked project defaults.

## Required configuration checklist

- Verify CLI version and login interactively (`npx supabase login`); do not pass/paste a token in chat or shell history. Read-only project metadata requires target-specific approval too.
- Frontend: HTTPS project URL and publishable/anon key only, with verified project reference. Never service-role/secret/database credentials. Inspect built bundles locally for privileged-key patterns without printing matches.
- Django: same verified target, publishable key, independent private Django secret, `DEBUG=false`, explicit hosts, HTTPS and reviewed proxy settings. Enable NECMS flags only for the approved schema/application pairing.
- PostgreSQL administrative credentials: operator-only, least privilege, encrypted connection, validated server identity and dedicated test role. Do not give owner/BYPASSRLS credentials to the browser or Django user gateway.
- Supabase Auth: separate synthetic accounts for A-only, B-only, dual membership, revoked/expired, no-profile, no-membership and display-only cases. Use synthetic hospital/staff/patient fixtures; hospital capability grants require explicit review.
- Verify API errors and successes carry `Cache-Control: no-store` and context/token variation through the real reverse proxy. Verify logs contain no request bodies, credentials or clinical data.
- Verify managed publication membership and subscriptions. Keep raw clinical realtime disabled; do not add clinical tables to realtime to satisfy a test.
- Approve synthetic display projection/audience, device policy, retention, audit monitoring, network restrictions and an operational downtime procedure.

## Migration dependency inventory

Apply only verified missing migrations, in exact order; do not replay SQL against an unknown partial schema or repair history to hide differences.

| File | Dependency / effect |
| --- | --- |
| `202610130001_initial.sql` | Initial PatientFlow tables/functions/RLS/publication; assumes managed Auth roles/schema/publication |
| `202610140001_normalize_names.sql` | Name separation and migration archives |
| `202610140002_nurse_surgeon_roles.sql` | Legacy role changes |
| `202610140003_nurse_coordination.sql` | Legacy nurse coordination permissions |
| `202610140004_patient_date_of_birth.sql` | DOB and age archive; review historical precision |
| `202610140005_auto_patient_references.sql` | Sequence/default/reference generation and save function |
| `202610140006_necms_hospital_isolation.sql` | Hospitals/memberships/context/RLS/FKs; pending ownership; replaces policies/functions/view/indexes; removes raw clinical publication membership |
| `202610140007_necms_resource_audit_integrity.sql` | Replaces resource mutation function with mandatory attributed atomic audit |
| `202610150001_necms_arrival_triage_foundations.sql` | Nullable provisional identity/priority, independent assessments/reviews/vitals/history, legacy wrapper and recreated invoker view |
| `202610150002_necms_coordination.sql` | Work/team/service/exception tables, retries, event RPCs and RLS; no new role grants |
| `202610150003_necms_verification_hardening.sql` | Five supporting indexes and narrowed work-event snapshot locks; same function signature and permission checks |
| `202610190001_necms_bounded_reads.sql` | Private scoped cursors, bounded clinical/operational read RPC and indexes; no historical ownership/data backfill |
| `202610200001_necms_presentation_summaries.sql` | Additive full-scope reviewed/waiting/underway/review-count fields; replaces the same checked read function without changing grants or clinical criteria |

006 can make existing operational rows inaccessible because ownership stays pending. That is a deliberate safety boundary and an operational cutover risk. It drops global name/reference indexes/constraints in favour of hospital-aware equivalents; identity UUIDs and original values remain. 3A relaxes required fields and adds nullable-safe workflow; rolling back to an older application may fail on valid provisional rows. New history is append-only. No blanket hospital assignment or fabricated assessments/tasks are permitted.

Migrations use transactions, normal index builds and view/function replacement. On populated databases these can block reads/writes or wait for long transactions; benchmark table sizes and lock requirements beforehand. Decide a maintenance window and explicit lock/statement budgets. Do not replace them ad hoc with concurrent-index DDL inside a transaction. Verify dependent views, function overloads, ACLs and PostgREST schema reload before reopening traffic.

## Read-only preflight after target-specific approval

Compare migration ledger entries/checksums with the repository and actual catalogues: schemas/tables/columns/defaults/nullability, constraints/FKs/indexes, function signatures/definitions/security/search paths/ACLs, triggers, policies, table RLS flags, view invoker setting and publication tables. Manual SQL application may leave no CLI ledger; absence from the ledger is not proof that objects are absent. Produce a discrepancy register rather than automatically repairing it.

Inventory aggregate counts for pending/quarantined/verified ownership and inconsistent related-record ownership. Seek hospital/data-owner provenance, preserve all UUIDs/references/audit/archive content and quarantine unresolved records. No patient export is required for schema comparison. Local portable tests' mocked `auth.uid()` must **never replace** Supabase Auth functions on a hosted project.

## Backup, execution and recovery gates

Before approval, nominate an operator, backup location, encryption/access policy, RPO/RTO and recovery owner. Obtain a full target-appropriate database backup plus required role/grant/platform configuration evidence. A schema-only dump is not a data backup. Supabase Auth/storage/platform recovery may require provider-supported procedures beyond `pg_dump`.

Rehearse restoration into a second explicitly approved disposable synthetic target. Compare aggregate/table-content checksums, UUID/reference relationships, functions/ACLs, policies/RLS, constraints and indexes; rerun negative security tests. A backup that has not been restored is not adequate recovery evidence. Record elapsed restore time against the agreed RTO; 3C did not establish an RTO.

Only then request/record approval identifying project, endpoint, migration names/checksums, existing ownership classification, backup/recovery evidence and execution window. Execute through the reviewed migration mechanism, with `ON_ERROR_STOP`/equivalent and stop-on-failure. Do not mix manual SQL and CLI history without an agreed ledger procedure. No command in this document authorises a hosted execution.

On pre-commit failure, roll back the transaction and verify no schema/data drift. Sequence values can have gaps even after rollback; do not renumber references. On failure after commit, stop affected traffic, preserve new clinical records/audit, diagnose and prefer a reviewed forward fix. Never drop 3A/3B tables or restore an older backup over new records as an automatic rollback. If restoration is required, restore to a separate target, reconcile post-backup changes and obtain incident-owner approval before any cutover.

## Supabase integration acceptance suite

Use real user tokens and the publishable key against Django AND direct REST/RPC. Use no owner token to prove RLS. For every negative case, assert status, absence of protected payload and unchanged committed state; pair it with a positive authorised operation.

1. A-only reads/registers/updates A; cannot read B base tables, board, identity, assessments, events, work, exception or staff data. Repeat symmetrically for B.
2. Dual member selects A then B. Wrong/missing/other-user/stale/expired context and forged hospital/body ownership fail. No cross-hospital patient/resource/team/service links are accepted.
3. Revoke membership, remove capability, expire membership and deactivate hospital independently. Subsequent operations fail. Test writes waiting behind a revocation lock and writes already admitted before revocation; document commit order, not impossible retroactive cancellation claims.
4. Real Auth sign-in, refresh, JWT expiry, invalid signature, disabled user, sign-out and refresh-token revocation. Measure how long an already-issued access token remains accepted; do not assume logout instantly invalidates every JWT. Verify every clinical operation still checks live hospital membership.
5. Direct table reads and RPC calls cannot bypass context or capability. New direct writes, helper/legacy-wrapper execution and immutable-history update/delete fail. Inspect `PUBLIC`/anon/default privileges and managed role memberships.
6. Display-only context returns exactly `display_label`, controlled `status`, `next_action`, generic `space_state`; no identity/reference/complaint/notes/vitals/owner free text. It cannot request the clinical/coordination bundle. Validate payload at the server/network boundary.
7. Same-key arrival/event retries return identical IDs exactly once; changed payload fails. Same-bed/same-version/call-versus-start conflicts leave one consistent committed result. Concurrent A/B work remains isolated. Audit failure leaves no partial state/event.
8. Browser races: multiple held A replies after B switch; pending write/read after logout; delayed 200 after 401/403; slow denials with overlapping polls; staff and display denials. No cached patient data reappears. Test proxy caching, offline/recovery, session refresh and context renewal.
9. Keep raw realtime disabled and verify no clinical subscription/publication leak. Authorised polling revocation is bounded by the next completed check, not instantaneous push.

Record actual results separately from mock results. Export only synthetic test evidence; redact credentials. Repeat source changes through local suites before target execution.

## Local 3C reproduction and boundaries

Portable PostgreSQL 17.11 was downloaded from the [EDB archive page](https://www.enterprisedb.com/download-postgresql-binaries), linked by the [PostgreSQL Windows downloads page](https://www.postgresql.org/download/windows/). Archive `postgresql-17.11-5-windows-x64-binaries.zip`, SHA256 `80379b2c04d51c30225532e0ae04509899141e9957ed096fe749d7fd9df8f82f`. The hash identifies the downloaded artifact; it is not an independently published signature check.

The server used a fresh temporary `necms-3c-postgresql` directory, random test-only owner password, SCRAM authentication, UTF-8/C locale, `listen_addresses=127.0.0.1`, port 55439, max 16 connections, 64 MB shared buffers. No Windows service, Docker, PATH change or hosted credential was used. Runtime and backups are outside Git in the user's temporary directory. Stop the process after testing; review/remove disposable artifacts separately when no longer needed.

To reproduce, provision a fresh matching portable cluster using `initdb` with a locally generated password file, never a password literal in commands. Check port availability and refuse existing unknown data directories. Append only the loopback configuration. Launch `pg_ctl` with a hidden window; never bind publicly. `scripts/check-postgres-concurrency.py` accepts only the fixed loopback endpoint and verifies `data_directory`/listen settings; it creates new timestamped synthetic databases and does not read `.env`/`DATABASE_URL`.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run-isolated-checks.ps1
.\.venv\Scripts\python.exe scripts/check-postgres-concurrency.py --confirm-local-synthetic
node scripts/check-hospital-review.mjs
```

The Python suite runs real independent connections and dump/restore but installs an Auth identity stub in its disposable databases. Never run its setup against managed Supabase. It verifies row hashes and function/ACL/RLS/policy equality across 34 tables after restoration; it does not back up cluster-global credentials or platform settings. Browser suites require the existing synthetic preview scripts, not an ordinary environment-loaded server. Additional 3C browser regression: `node scripts/check-readiness-browser.mjs` against port 5175. Do not treat these commands as a hosted test plan execution.
