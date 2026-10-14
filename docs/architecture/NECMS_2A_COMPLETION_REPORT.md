# NECMS Milestone 2A completion report

Review date: 2026-10-14. Scope: repository safety, read-only verification and isolated baseline tests. No hospital-isolation implementation, new migration files, hosted migrations, hosted record changes or clinical/UI changes were made. PatientFlow remains an operational prototype.

## 1. Repository and development branch

The repository was already initialized on `main` with no local commits. The configured remote remains `https://github.com/Starkite-Technologies/patientSystem.git`. A successful read-only `git ls-remote --heads --tags` returned no advertised heads/tags. No remote branch was fetched, changed or pushed; no force-push occurred. This establishes the observed remote state, not a claim about unavailable/unadvertised objects.

Established local root baseline commit:

```text
d4398bebbc255db5eba107ba6a3415e25513d03e
chore: establish audited PatientFlow baseline for NECMS
```

Created and switched to `feature/necms-multi-hospital` from that commit. This completion document and environment guide are a subsequent documentation commit on that branch; consult `git log` for the resulting tip. Branch has no upstream and has not been pushed. Milestone 1's untracked-repository statements are historical findings, superseded by this report.

Git had no configured author. An optional author question received no preference before the commit, so the disclosed automation identity `NECMS Repository Preparation <necms-preparation@users.noreply.github.com>` was used with per-command configuration. Global/local user identity configuration was not changed. Set the desired author identity before future human-authored commits.

### Commit safety evidence

- Audited 60 original candidate files and 61 staged baseline files after adding the safety script. Scanned staged Git blob contents, not just filenames, for private keys, Supabase secret/publishable values, JWT-shaped values, GitHub tokens, AWS key IDs and credential-bearing database URLs. No matches requiring exclusion were found. The initial candidate scan also checked quoted password assignments and nontext files.
- Reviewed data-bearing source/test files: existing application/demo fixtures are explicitly fictional and SQL fixtures are tests. No database dumps, hosted patient exports or actual environment values were staged. Literal test placeholders are not operational credentials. Pattern scans cannot independently prove the provenance of every possible string; future commits still need review.
- `.env.example` contains empty configuration values, not credentials. `.env` is ignored and untracked. Reviewed migration files are schema/function code rather than patient exports; test SQL inserts are existing fictional fixtures.
- Extended `.gitignore` for database dumps/backups/local databases, credential/key material, export/patient-data directories, logs, coverage and private tool/cloud directories. Existing rules exclude dependencies, virtual environments, build output, screenshots, caches and `.env*` except the empty example.
- Verified representative ignored paths using `git check-ignore`. Never use `git add -f` to override these rules for sensitive content. Ignore rules are an additional safeguard, not a content classifier.
- Git emitted LF-to-CRLF warnings under existing Windows configuration. No global newline configuration or migration content was changed. Migration runner fingerprints normalize newlines through Python `read_text`; preserve the six published files and their canonical fingerprints.
- Escalated Git initially reported ownership mismatch between sandbox and desktop users. Used a command-local `safe.directory` exception for this exact workspace; no global trust exception was added.

## 2. Database schema and migration verification

### Actual hosted checks executed

The existing `check_supabase` command completed successfully, read-only:

- Supabase Auth settings endpoint accepted project configuration.
- Anonymous `visit_board` request selected only `id` with `limit=0` and was denied with the expected permission error.
- No patient rows, Auth users, passwords, JWTs or project configuration values were printed or retrieved for this report.

Configured local environment names were inspected without printing values. `.env` has a project URL, publishable key and development debug setting. No `DATABASE_URL`, database-owner connection, management token or authenticated staff session was available for this review. The publishable key does not provide catalog/ledger inspection or privileged aggregate ownership inspection.

**Full hosted schema comparison could not be performed.** Permission denial at the board route is limited evidence; it does not attest the view definition or all migrations. No missing/unapplied/manually applied migration can be conclusively classified with the available access.

| Area | Repository/development evidence | Hosted verification |
| --- | --- | --- |
| Migration sequence | Six ordered files; see [baseline](NECMS_BASELINE.md) for exact names and canonical fingerprints. | Applied sequence/checksums unknown; dashboard-applied files may lack the custom ledger. |
| Tables/view | Expected staff profiles, patients, visits, resources, audit, private name/age archives and joined board. Existing in-memory schema tests passed. | Board permission route check only; columns, view options and table definitions unverified. |
| Constraints/indexes | Existing tests exercised identity/reference behavior, active-visit/space guards, DOB and version rules. | Actual catalog definitions/validity unverified. |
| Functions/triggers | Existing SQL and regression checks exercised checked functions/audit. | Bodies, overloads, owners, grants, search paths and trigger definitions unverified. |
| RLS/grants | Existing local tests passed against mocked Auth roles in PGlite. Current source uses global staff-role authorization. | Anonymous board denial verified; authenticated access and complete policy/grant inventory unverified. |
| Realtime/Auth configuration | Local source subscribes to clinical tables; tests mock Auth or use demo mode. | Publication contents, private/public settings, session configuration and revocation behavior unverified. |

PGlite is intentionally different from hosted Supabase: ephemeral in-memory storage, mocked Auth schema/roles and removed managed Realtime publication statements. Django has a dummy database backend and user-token Data API gateway; it is not a local copy of hosted PostgreSQL. Browser tests operate on fictional localStorage records. Passing local tests does not prove hosted parity.

### Read-only evidence required next

A database owner must provide a protected schema-only catalog export or authorize a read-only inspection connection. Keep connection credentials in ignored local/private configuration, never in this report or chat. Inspect:

1. Custom `_patientflow_migrations` existence and filename/checksum history, plus any Supabase-managed migration history if present. Reconcile dashboard execution against catalog evidence; do not manufacture history.
2. Table columns/defaults, constraints including validation status, index definitions/validity, FK/delete behavior, view definitions and security-invoker options.
3. All function signatures/overloads, definitions, ownership, execute grants and search paths; triggers and audit behavior.
4. Effective table/column/schema grants, RLS enablement/policies, exposed Data API schemas and publication membership.
5. Auth/Realtime settings and restore capability through authorized read-only configuration inspection.

Use read-only transactions and schema-only output; do not export patient row contents. Store full administrative evidence privately, commit only sanitized conclusions. If definitions differ, stop and design a reviewed forward correction later. Do not replay migrations merely to discover which ones succeeded.

## 3. Existing-record ownership

The current source schema has no hospital ownership or membership/provenance model. Local demo/test labels establish fictional source fixtures only; they do not prove the contents or ownership of the hosted project. Deployment messages, patient reference format, resource name or staff email do not establish hospital provenance.

| Aggregate | Verified finding |
| --- | --- |
| Total hosted patients/encounters/resources/audit records | Not obtainable with available access; no count query executed. |
| Records with confirmed hospital ownership | Not determined; no approved provenance manifest available. |
| Unknown or conflicting ownership counts | Not determined; unavailable is not zero. |
| Records reassigned/deleted/quarantined in 2A | None. |

Next, the responsible data owner should confirm facility provenance from source-system/import records and approved operational evidence. An authorized aggregate-only review can reconcile total/verified/unknown/conflicting counts without returning names, DOBs, complaints, notes or row lists. Store the actual mapping manifest privately. Counts alone cannot establish ownership.

Proposed preservation remains additive: retain all original UUIDs/references/encounters/audit snapshots; later add ownership/state fields. Unresolved records remain in place with restricted pending/quarantined ownership rather than receiving an assumed hospital. Conflicting linked graphs require review before assignment. Active-care continuity must be approved before excluding unresolved encounters from an operational board. No quarantine mechanism or ownership backfill was implemented in 2A.

## 4. Isolated development readiness

Added [run-isolated-checks.ps1](../../scripts/run-isolated-checks.ps1), tested successfully. It runs existing frontend/Django/build/in-memory database checks while overriding both frontend/backend Supabase settings and the migration database URL with unreachable loopback settings. Nonempty sentinels prevent Windows empty-variable removal from allowing dotenv fallback to hosted configuration. The script restores the invoking process's environment in `finally`. No hosted migration/seed command is invoked.

Retained existing `start-demo.mjs`: it sets frontend Supabase variables to empty strings in Node before loading Vite and serves the clearly labelled fictional demo on loopback port 5174. Used it for browser regressions. The temporary owned preview process was stopped afterward. No live clinical data was copied and no hosted project or paid infrastructure was created.

See [development safety guide](NECMS_DEVELOPMENT_SAFETY.md) for exact commands, limitations and recovery. This is an isolated **software regression environment**, not yet a full managed Supabase integration environment. Normal `npm run dev`, Django runserver, seed commands or migration commands can still load the existing `.env`; those commands are not made universally safe by the test runner. Do not use them for NECMS development against an unclassified hosted project.

## 5. Actual baseline results for this milestone

Runtime observed: Node v24.19.0 and Python 3.14.7. Commands below were actually executed, not inferred from Milestone 1:

| Check | Result and boundary |
| --- | --- |
| `npm.cmd test` | 17 passed in 2 files; no test failures. |
| Django `test patients --verbosity 1` | 27 passed; system check reported no issues. HTTP/Auth paths are mocked. |
| `npm.cmd run build` | TypeScript/Vite build passed; 1,627 modules transformed. Isolated connection settings were embedded; output is not a deployable clinical build. |
| `npm.cmd run test:database` | Existing in-memory checks passed for normalization, RLS/roles, audit, versions, discharge, resource conflicts, DOB and references. Existing migrations executed only inside the disposable checker; no new files or hosted migration operation. |
| `npm.cmd run test:browser`, port 5174 | Passed existing fictional demo workflows/layout checks; no hosted data path. The first attempted launch was not executed because automatic approval review could not complete due to workspace credits. After review became available, retry succeeded. |
| `check_supabase` | Passed read-only Auth reachability and anonymous board denial only. |

Warnings/limitations: Git ownership mismatch and CRLF warnings as recorded above; initial sandbox remote lookup failed, followed by successful read-only approved lookup; browser approval initially failed before execution. These are operational failures, not passing tests. No automated test assertion failed in the completed runs.

Not executed: hosted catalog/history comparison; authenticated live clinical reads/writes; real Supabase isolation/realtime/revocation tests; real multi-connection PostgreSQL race tests; restore drill; hosted provenance/count inspection. No hospital isolation tests exist in the current prototype.

## 6. Blockers and exact preparation for Milestone 2B

Repository safety and isolated regressions are ready. Hosted verification and ownership remain blocked by insufficient access/evidence. Before implementing hospital isolation:

1. Obtain read-only hosted schema/history attestation and reconcile it with the six unchanged migration files. Confirm the target project/environment classification without committing project credentials.
2. Obtain data-owner provenance approval and privacy-safe aggregate counts; define private mapping and quarantine review responsibilities, including active-care continuity.
3. Approve hospital/department boundaries, membership/capability matrix, delegated administrators, context lifetime and restricted display audience/fields.
4. Select an explicitly separate disposable PostgreSQL/Supabase test environment and verify its isolation. Any hosted creation/configuration change needs separate approval; do not create paid infrastructure by default or copy live records.
5. Rehearse backup/restore or approved forward recovery and document the later staged/live execution runbook.
6. Implement and execute the specified direct REST/RPC, context/revocation, composite-FK, display-network and real Realtime tests when 2B is authorized. Disable raw clinical websocket exposure rather than accepting a failed isolation test.

Current security risks remain unchanged: global staff permissions, direct Supabase access paths, browser-only wall display masking, unscoped clinical Realtime and unknown hosted drift/ownership. Git/test preparation does not fix them or establish clinical readiness.

Stop here. No Milestone 2B schema, hospital isolation policy, clinical changes or hosted writes are included. Await explicit review/approval for the next scope.
