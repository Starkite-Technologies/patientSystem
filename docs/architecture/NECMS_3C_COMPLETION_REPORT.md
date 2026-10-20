# NECMS Milestone 3C completion report

2026-10-15 · local synthetic verification · Starkite Technologies.

**Local hardening and the named verification scenarios passed. Hosted Supabase integration and hospital clinical approval remain incomplete. This is not a clinically validated or production-ready system.** No hosted project was connected, migrated or deployed; no real patient information was used. No clinical decision rules were added or activated.

## Verified implementation status and baseline

Reviewed the 2D, 3A, 3B completion reports, 3B design, migrations, Django authentication/gateway/permissions, React protected views and existing test suites against the actual working tree. Branch remains `feature/necms-multi-hospital`, tracked baseline `f625b90`. Uncommitted 3A/3B code and reports were preserved. No commit, stage, push, reset or cleanup of those changes was performed.

React/TypeScript/Vite, Django/DRF, Supabase Auth, user-token Data API access, PostgreSQL RLS and checked functions remain. Patient identity, urgency, encounter care status, treatment space and coordination work remain distinct. Clinical/coordination history stays append-only. Unknown hospital ownership remains pending/quarantined. No clinician role, medical score, threshold, reassessment deadline or escalation policy was invented or activated.

Repository/environment inspection confirmed `.env` exists with frontend Supabase variable names and Django debug configuration; values were not displayed or reused for testing. `.env.local` and `supabase/config.toml` were absent. That is not verification of a hosted project's identity, contents or migration history. Hosted URLs/keys are not authorisation. `.env*`, tokens, exports and generated artifacts remain ignored by Git; `.env.example` is the intended exception.

## Security findings and repairs

The complete severity/exploitability/file register is [NECMS_SECURITY_AND_READINESS_REGISTER.md](NECMS_SECURITY_AND_READINESS_REGISTER.md). Six confirmed issues were repaired without weakening server permission checks:

1. **Independent registration/update permissions:** the legacy UI no longer requires both hospital capabilities for either action. Register-only staff cannot edit, and update-only staff cannot register. Django and SQL still enforce their independent capabilities.
2. **Staff-panel protected lifecycle:** staff reads/mutations now share the parent clinical epoch and a local request guard. Polling, switch/logout cleanup, denial clearing and late-response rejection prevent stale membership records from being restored after revocation. A staff 401/403 also clears protected parent data.
3. **Error-path privacy headers:** a common API middleware supplies `no-store`, `Pragma: no-cache` and token/context `Vary` headers, including non-DRF errors/404s. Static assets retain their existing caching behaviour.
4. **Snapshot lock scope:** a forward migration replaces the work-event function without changing its signature, membership checks, transitions or evidence rules. It locks the target and eligible same-service candidate encounters in deterministic order, rather than every active hospital encounter. A real concurrent test proves an unrelated clinical update proceeds while the start transaction remains open.
5. **Lock-timeout classification:** SQLSTATE `55P03` now maps to sanitized HTTP 409 alongside stale/deadlock conflicts; raw diagnostics are not returned. No automatic blind mutation retry was added.
6. **Frontend bundle loading:** clinical and coordination screens load lazily with status fallbacks. The main chunk reduced from approximately 526 kB to **492.15 kB**, with separate **16.18 kB** and **20.38 kB** screen chunks. The final build has no >500 kB warning.

Additional reliability changes: the parent board no longer repeats its regular full-board poll while the coordination screen already polls its combined checked bundle. Initial/manual reads and denial clearing remain. The synthetic NECMS preview has an explicit persistent demonstration banner, including display contexts; it does not claim approved clinical protocols. This banner is a label, not an access-control or dataset-validation mechanism.

## Files created or changed for 3C

Created:

- `docs/architecture/NECMS_3C_COMPLETION_REPORT.md`.
- `docs/architecture/NECMS_HOSTED_INTEGRATION_RUNBOOK.md`.
- `docs/architecture/NECMS_HOSPITAL_PILOT_WORKFLOW.md`.
- `docs/architecture/NECMS_SECURITY_AND_READINESS_REGISTER.md`.
- `backend/patients/middleware.py`, `backend/patients/test_readiness.py`.
- `src/lib/visitPermissions.ts`, `src/lib/visitPermissions.test.ts`.
- `scripts/check-postgres-concurrency.py`, `scripts/check-readiness-database.mjs`, `scripts/check-readiness-browser.mjs`.
- `supabase/migrations/202610150003_necms_verification_hardening.sql`.

Changed existing working sources: `backend/config/settings.py`, `backend/patients/gateway.py`, `src/App.tsx`, `src/HospitalWorkspace.tsx`, `scripts/start-necms-test.mjs`, `scripts/run-isolated-checks.ps1`.

Earlier 3A/3B files visible in Git status were retained. Their migration files were not edited. No dependency manifest/lockfile, credential file, clinical protocol or hosted configuration was changed. Portable PostgreSQL binaries, test credentials and synthetic dumps are outside the repository in the user's temporary directory.

## Database migration and recovery findings

New additive migration `202610150003_necms_verification_hardening.sql` follows 006 → 007 → 3A → 3B. It adds five indexes: scoped work-to-encounter lookup, hospital exception chronology, exception annotation history, encounter audit history and patient-only audit history. It replaces only `necms_work_event`, retains its constrained search path and authenticated-only public RPC grant, and does no data backfill or automatic capability grant.

**Actual execution:** disposable PGlite databases and new synthetic-only databases on temporary localhost PostgreSQL 17.11. All eleven repository migrations were applied on the actual local server. Existing migration/clinical/coordination fixtures passed there. Nothing was run against hosted PatientFlow/Supabase.

Embedded rehearsal applied/rolled back the forward migration, confirmed the new index disappeared and twelve existing table snapshots stayed identical, then applied it and reran all 30 coordination assertions/22 negative probes. An additional populated-3B rehearsal compared every row in all **34 tables**, including existing work/events/exceptions/annotations, across the forward migration; all were preserved. Prior suites retain their earlier preservation/rollback checks. Sequence gaps are not treated as lost patient references and must not be renumbered.

Actual PostgreSQL recovery used custom-format `pg_dump`, a second fresh database and `pg_restore --exit-on-error --no-owner`. **All 34 persistent public/Auth/private tables matched by row count and sorted-row SHA256; function definitions/ACLs, table RLS flags and policies also matched.** Final dump was approximately 256 kB. This is real local restoration, not a Supabase platform backup or an established operational RPO/RTO. The restore target contained only the synthetic local Auth stub, never managed Auth configuration.

006 changes isolation and makes unresolved historical rows inaccessible; 3A permits valid null/provisional identities and priority. Returning to an old application/schema after new clinical writes is not a simple down migration. New indexes use ordinary transaction-bound builds and may hold significant locks on populated tables. Review target size, dependent views/functions, ownership provenance, cutover window, lock/statement budgets and forward recovery before any hosted application. The runbook documents exact approval and recovery gates.

## Actual independent-connection PostgreSQL verification

No server was initially installed. The official portable Windows PostgreSQL 17.11 runtime was safely provisioned in a fresh temporary directory without Docker, Windows service registration, system PATH changes or hosted credentials. Source/archive hash and reproduction constraints are recorded in the runbook. The cluster used SCRAM, a generated test-only owner credential, `127.0.0.1:55439`, 16 connections and 64 MB shared buffers. Test code verifies the exact local data directory/listen address, strips ambient libpq target overrides, creates timestamped synthetic databases and uses statement timeouts. The temporary server and both browser previews were stopped after verification; all three ports were confirmed closed. Disposable runtime/database/recovery artifacts remain in the temporary directory, outside Git.

**13 checks passed on real independent PostgreSQL connections**, with outcomes verified against committed state:

| Scenario | Observed result |
| --- | --- |
| Competing bed allocation | Exactly one care update commits and exactly one encounter occupies the bed; competing operation fails |
| Concurrent encounter updates | Exactly one version-1 update commits; resulting version is 2 |
| Simultaneous call/start | Exactly one transition commits; stale competitor returns `40001`; no duplicate transition event |
| Separate work-item transitions | Both admitted operations commit with distinct work/event IDs |
| Narrow snapshot-lock regression | Unrelated care update commits under 250 ms lock timeout while another work-start transaction remains open |
| Duplicate arrival requests | Two connections with the same actor/key/payload return the same identity/encounter; exactly one arrival exists |
| Duplicate coordination events | Same retry returns the same event; one committed event exists |
| Revocation during waiting write | An actual membership lock wait is observed; revocation commits first; pending write returns `42501` and version stays 1 |
| Concurrent hospital isolation | A and B both read legitimate own work; each sees zero other-hospital work |
| Audit-sink failure | Completion fails `23514`; work remains underway/version 2 with no completion event |
| RPC lock timeout | Actual `55P03`; no version change |
| Deadlock detector | Deliberately inverted owner row locks produce one `40P01` and one committed transaction |
| Dump/restore | 34 tables and function/ACL/RLS/policy evidence match in a fresh restored database |

The deadlock test is an explicit server lock-cycle probe, **not proof of a particular clinical workflow deadlocking**. Local Auth identities are stubbed, while actual roles, RLS, functions, locks and transactions execute. This is not real Supabase bearer-token/REST integration or stress testing. Concurrent capability deletion, hospital deactivation, identity reconciliation and every possible lock graph were not verified. Previously admitted writes can finish before revocation commits; no retroactive cancellation guarantee is claimed.

## Automated test results

All final executed checks passed; none were suppressed, marked expected failure or weakened to obtain a pass.

| Check | Actual result / boundary |
| --- | --- |
| Frontend Vitest | **44 passed**, six files; includes four independent permission regressions |
| Django `manage.py test patients` | **94 passed**, system check clean; upstream Auth/Data API mocked |
| TypeScript/Vite build | Passed; main JS 492.15 kB, no chunk warning; built locally, not deployed |
| Baseline SQL runner | Passed normalisation, roles/RLS, audit, reference/DOB, stale versions, discharge/resource conflicts |
| Hospital SQL runner | Passed isolation, preservation/rollback, context/revocation, retry/version/resource and audit failure checks |
| Clinical SQL | **32 assertions / 25 negative probes** passed |
| Coordination SQL | **30 assertions / 22 negative probes** passed |
| 3C readiness SQL/performance runner | Passed forward-migration rollback/preservation, five index checks and all coordination fixtures against the hardened function; measured workloads below |
| Existing hospital review | Five review results passed: preservation, publication removal, profile/audit protection, RLS and restricted execution |
| Real PostgreSQL suite | **13 checks passed** as above, including actual recovery |
| Legacy demo browser | Passed registration/edit/persistence/discharge, resources/activity, filters, privacy, mobile layout and duplicate validation |
| Clinical browser | Passed rapid/unknown arrival, retry, assessment/vital/reconciliation/history, permission and switch/logout flows |
| Coordination browser | Passed lane ordering, explicit work events, concurrent services, immutable evidence/review, filters/tablet, stale/recovery and denial/switch/logout races |
| Hospital browser | Passed with all five review modes enabled: multiple switch, logout/reauthentication, slow denial, connection/auth failure and delayed display success |
| New readiness browser | Passed register-only/update-only/read-only checks, explicit synthetic banner, staff denial clearing and delayed-success rejection with abort intentionally ignored |
| Git/UTF-8 review | Tracked diff whitespace checks pass with ordinary LF/CRLF notices; environment/generated files ignored; no staging/commit/push |

`scripts/run-isolated-checks.ps1` now includes the readiness SQL/performance runner. Browser checks use real React in Edge, local synthetic previews and mocked Auth/Django with external traffic blocked. They do not prove deployed server security. No hosted authentication, schema inspection, REST/RPC request or production configuration check was performed.

The first local `initdb` invocation failed because PowerShell split a password-file argument incorrectly. No database was initialized by that attempt. Corrected argument passing initialized the disposable cluster and all subsequent real suites passed. The normal test runner emits expected validation warnings for intentionally malformed request bodies; these are not failed tests.

## Performance evidence and limitations

The recorded aggregate-run `check-readiness-database.mjs` measurements use **one PGlite engine on this laptop**, actual SQL plus JavaScript result decoding/serialization. All records are synthetic; counts include five earlier active fixtures. These are observations, not capacity targets, API timings, network/device performance or production sizing; repeated runs vary.

| Active encounters / work items | Returned JSON bytes | First measured query ms | Subsequent three ms |
| --- | ---: | ---: | --- |
| 105 / 104 | 172,496 | 26.98 | 24.05, 24.71, 21.76 |
| 1,005 / 1,004 | 1,569,114 | 215.85 | 203.97, 202.59, 204.51 |
| 5,005 / 5,004 | 7,776,150 | 2,678.87 | 2,784.08, 2,688.23, 2,898.34 |

Operational history returned 109 events/72,623 bytes in 2.40 ms and 1,009 events/640,447 bytes in 14.78 ms. No history pagination was added. Full assessment history and patient-selection lists also remain unbounded.

`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` on the scoped encounter work lookup selected **Index Scan using `coordination_encounter`**, actual two rows, four shared-buffer hits, approximately 0.074 ms scan / 0.192 ms execution. The measured plan uses the test owner to inspect physical lookup performance; it is not proof of managed per-user RLS planner cost. The full explain evidence is emitted by the reproducible script. Main-board RPC internals, managed network latency and HTTP/API throughput were not load-tested.

Indexes, narrower locks, reduced duplicate polling and lazy screen bundles are implemented improvements. Large-list/search/history pagination and a bounded operational board projection remain an important open scale risk. They were not silently approximated by dropping patients from a response. Demonstration scope must be deliberately small until those improvements and production-like tests are complete.

## Hosted blockers, clinical dependencies and demonstration decision

No hosted identity, clean/synthetic classification, migration ledger/schema compatibility, managed least-privilege credentials, provider recovery or exact execution approval was established. Therefore hosted operations remain blocked. Existing project URLs or owner intent do not resolve those gates.

Clinical governance remains unresolved: approved protocol/version and urgency interpretation, professional authority, independent review staffing, identity/duplicate policy, readiness definitions, service/exception ownership, reassessment/escalation policy and correction/addendum rules. The proposed capability matrix and synthetic workflow in [NECMS_HOSPITAL_PILOT_WORKFLOW.md](NECMS_HOSPITAL_PILOT_WORKFLOW.md) require hospital approval and grant nothing automatically. Reception-minimal projections, department scope, roster retirement, formal handover and identity merge are not complete features.

Passing local tests supports a clearly labelled **local synthetic software demonstration** and source/workflow review. It does not establish a clinically governed pilot, real full-stack Supabase demonstration, production capacity, certified accessibility or hospital deployment readiness. No automatic clinical actions or executable medical orders exist. The security/readiness register lists remaining risks, severity and owners; the [hosted integration runbook](NECMS_HOSTED_INTEGRATION_RUNBOOK.md) supplies verification and recovery gates.

## INFORMATION FOR CHATGPT — MILESTONE 3D

- Preserve the existing stack, all uncommitted 3A/3B source and the 2D protected request fixes. 3C is also uncommitted; no hosted database was touched.
- 3C fixed independent UI permissions, staff denial/stale-response handling, API cache/error coverage and lock-timeout classification; reduced duplicate polling, split bundles and labelled the synthetic preview.
- New forward migration is `202610150003_necms_verification_hardening.sql`: five indexes and narrower work-event snapshot locks, no clinical or historical data changes. Executed only in disposable embedded and temporary loopback PostgreSQL databases.
- Actual evidence: 44 frontend / 94 Django tests; warning-free build; all original SQL/browser suites; new readiness/browser/SQL checks; **13 real independent-connection PostgreSQL checks including fresh-database restoration**. Auth stub/REST mock limitations remain; do not describe this as Supabase integration success.
- The large-board benchmark exposes an unresolved unpaginated payload/latency problem. 3D should implement bounded, capability-checked board/search/history pagination without hiding patients, and test contention/API/device behaviour at an agreed workload. Preserve unknown-urgency visibility and immutable evidence.
- Verify and obtain approval for an exact dedicated synthetic-only Supabase target, catalogue/migration compatibility, user-token accounts and recovery. Only after target-specific execution approval should real hosted Auth/REST/RLS/display/session negative tests run. Keep raw clinical realtime disabled.
- Obtain hospital decisions for protocols, professional scope, review/exception ownership, reassessment/escalation and pilot privacy/downtime policy. No unapproved scoring, automatic treatment decisions or clinical escalation should be activated.
- Agree demonstration scope, synthetic dataset, reception/department/device privacy, stop conditions and acceptance owner. Continue source review and address the register's open security/scale gaps before an approved hospital demonstration. No permission to deploy, commit/push or modify hosted records is implied.
