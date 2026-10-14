# NECMS Milestone 2B — isolated implementation report

Date: 2026-10-14. Status: **isolated source implementation and regression checks completed; hosted verification/deployment gates remain blocked.** This is an operational prototype, not clinically validated software. No hosted database, patient records or configuration were changed. No production deployment occurred.

## 1. Environment verification and execution boundary

The project owner's development intent is acknowledged from the user instruction. The local application configuration resolves to project reference `znltmxajrztszhjuamak`. A captured, sanitized CLI project-list authentication check failed (exit 1); no usable authenticated management session was established. No PostgreSQL `DATABASE_URL` is configured. Therefore actual project metadata, database endpoint/permissions, deployed schema/history, ownership evidence and an executable hosted backup/restore procedure could not be verified.

User permission explicitly allowed isolated source implementation when hosted verification fails. All database execution here used disposable in-memory PGlite, mocked Auth roles/users and exclusively fictional fixtures. Browser integration used synthetic local sessions, mocked Django responses and blocked external HTTP traffic. No hosted migration was attempted and no real patient information was copied or queried. A managed Supabase integration environment remains unavailable without authentication/provisioned access.

Both feature flags remain false by default: `NECMS_ENABLED` in Django and `VITE_NECMS_ENABLED` in React. `.env` was not changed. The existing hosted prototype remains on its previous mode; do not enable these flags there before schema and deployment approval.

## 2. Files created or modified

| Area | Files |
| --- | --- |
| Prepared migration | `supabase/migrations/202610140006_necms_hospital_isolation.sql` |
| Database security tests | `supabase/tests/hospital_isolation.sql`, `scripts/check-hospital-database.mjs` |
| Django scoped API | `backend/patients/necms_views.py`, `backend/patients/gateway.py`, `backend/patients/views.py`, `backend/patients/serializers.py`, `backend/config/settings.py`, `backend/config/urls.py` |
| Django security/runner tests | `backend/patients/test_necms.py`, `backend/patients/test_migrations.py` |
| Hosted migration safety | `backend/patients/management/commands/apply_supabase_migrations.py` |
| React integration | `src/HospitalWorkspace.tsx`, `src/App.tsx`, `src/model.ts`, `src/lib/api.ts`, `src/lib/store.ts`, `src/styles.css`, `src/lib/api.test.ts` |
| Isolated browser checks | `scripts/start-necms-test.mjs`, `scripts/check-hospital-browser.mjs`, `scripts/start-demo.mjs` |
| Test configuration | `scripts/run-isolated-checks.ps1`, `.env.example`, `package.json` |
| Earlier CLI work included in local commits | `.gitignore`, `package-lock.json`, Supabase dev dependency in `package.json`; previously installed CLI 2.120.0. No existing locked package versions were changed by that installation. |
| Documentation | This report; NECMS section in `README.md`. |

The six baseline migration files are byte-equivalent after newline normalization to baseline commit `d4398be`. No historical source migration was edited. Local commits are on `feature/necms-multi-hospital`; nothing is pushed. Use `git log` for the small database, API, UI/test and documentation commit sequence.

Implementation commits: `66c301f` (schema/disposable tests), `4dae6f5` (Django permissions/API), `ac208d4` (React context/display/browser tests). All implementation was validated before these commits. The completion documentation is committed separately. Commits use the previously disclosed automation identity with per-command settings; no global Git identity was changed.

## 3. Migration and recovery status

The new migration is prepared for review, not approved for hosted execution. It was executed only inside `check-hospital-database.mjs`: once within an explicitly rolled-back transaction, and then in a fresh successful transaction on the same disposable baseline. The checker proves rollback removes the added hospital table and preserves baseline patient identity values. It then verifies successful application preserves original patient UUIDs/references and audit UUIDs/timestamps/snapshots. This local rehearsal does not prove hosted restore capability or real deployment lock times.

Existing ownership is never inferred: original patients, visits, spaces and audit records receive null ownership with `pending` state. Original records and private name/age archives remain preserved. Verified operational rows require non-null hospital ownership. Pending/quarantined records deny ordinary clinical access. Only fictional test fixtures were explicitly assigned to the fictional hospitals.

Global normalized reference/resource-name uniqueness becomes hospital-scoped for verified rows. Existing UUIDs and reference strings are not rewritten, and the PF reference sequence remains intact. Existing active-patient/space uniqueness and version guards are retained. Case-sensitive public identity data is not republished.

The Django migration runner now refuses prepared NECMS files before connecting unless `--include-necms` is explicitly supplied. That flag is an execution guard, **not proof of target verification or approval**. Do not run it until target, schema, provenance, recovery and the specific execution are approved. Other tools, including Supabase CLI, do not inherit this guard; no database-changing CLI command was used.

After an approved isolation cutover, recovery must not restore legacy global access. Use maintenance gating and a compatible forward fix, preserving post-cutover records/audit. Hosted backup/restore and active-care continuity still need an executable, rehearsed runbook before any live operation.

## 4. Database architecture implemented in the prepared migration

- Hospitals with public/private/other facility type, code, active state and configured timezone; hospital-owned departments.
- Existing global staff identities retained. Hospital memberships bind Auth UUID, hospital, role, active/validity state and authorization version; revocation preserves membership rows/history.
- Hospital-specific roles map to an explicit capability vocabulary. New tables deny direct authenticated writes/reads; checked RPCs expose only authorized operations. No global staff role automatically grants facility access.
- Versioned hospital operational configuration, with a narrow language/display allowlist and audit events. No clinical scoring criteria or AI were added.
- Hospital ownership/state on patients, visits, treatment spaces and audit. Composite hospital/identity/state FKs reject foreign hospital patients/resources and nonverified parents; department FKs reject foreign hospital departments.
- Private opaque access contexts bind user, membership, hospital, purpose, authorization version and 15-minute expiry. Private provenance-review records support later approved reconciliation; no ownership backfill tool or automatic assignment is provided.
- Private registration request ledger deduplicates retries by hospital/user/request UUID and SHA-256 payload fingerprint. Changed retry payloads reject. The result and clinical audit changes commit atomically.
- Clinical board RPC uses one snapshot, includes all active encounters and scoped resources/identity lookup, and limits recent audit summaries. Completed history is served separately in stable pages of 100. No implicit Data API row-limit paging of active encounters.

Hospital-wide capability scope is implemented. Department ownership/integrity exists, but department-limited membership/context grants are not implemented; do not represent this release as enforcing department-level clinical isolation. Role/config bootstrap requires a separately reviewed administrative procedure; test fixture bootstrap is not a hosted setup script.

## 5. Authentication and permission enforcement

Supabase Auth remains the authentication provider. Django continues verifying the bearer token through Supabase Auth and forwarding the original token/publishable key; no service-role credential is introduced.

New endpoints are under `/api/necms/`: authorized hospital list, checked context issuance, hospital-bound board/history/display, encounter/resource mutations, staff membership management and operational configuration. Every clinical operation validates `X-NECMS-Context` and route hospital through a checked database context RPC, then checks its capability. The database repeats checks independently inside mutations. Browser/body hospital IDs and role fields grant nothing.

PostgreSQL resolves the untrusted context header to a user-bound private row and rechecks membership activity, hospital activity, validity, context expiry and authorization version. Capabilities are read live. Revocation/grant removal is effective on subsequent operations with the old JWT/context. Mutations hold a membership `FOR SHARE` lock so revocation updates serialize with previously authorized writes. Real parallel-connection race behavior is not yet proven by the single-connection checker.

Legacy global clinical RLS policies are removed in the new migration and replaced with hospital/context/capability policies. Direct table mutations remain revoked. Privileged functions have fixed search paths, fully qualified application objects, explicit capability checks and narrowed execute grants. Anonymous access is denied. Legacy API routes refuse requests when NECMS mode is enabled; there is no scoped-to-global fallback.

Membership management is hospital-bound, prohibits self-management, rejects foreign role IDs, requires a reason and prevents granting capabilities the caller does not hold. Revocation can remove another member's access without granting privileges. The initial UI exposes audited revocation; the API supports approved role assignment/reactivation. Full invitation/onboarding and hospital role-definition editors are deferred.

## 6. Frontend and display changes

Added a small authorized hospital selector around the existing screens. Public/private facilities use the same interface with separate data/context. Switching or renewing context immediately unmounts the old board/dialog/staff state; request generations prevent delayed responses from restoring old records. Explicit context travels with each request; no global browser-selected hospital setting is used as authority.

Preserved registration, return-patient identity selection, reference generation, DOB, existing clinical P1–P5 vocabulary/ordering, resource coordination, history, audit and dialog/table layout. Clinical action controls use returned capabilities in NECMS mode, while server/database checks remain authoritative. History has previous/next page controls. Requests denied during polling clear clinical data, dialogs and sync status rather than showing stale protected information.

NECMS shared display uses a separate display-purpose context and server RPC whitelist: encounter-local opaque display label, controlled status/action and generic assigned/unassigned space state. Names, DOB, patient IDs/references, complaint, notes, staff text, precise location and audit data are not returned. Clinical RPCs/base-table identity reads deny display-only contexts. The previous UI-only wall masking is disabled within NECMS mode. A hospital can disable display through its operational configuration.

For actual shared screens, provision a dedicated identity with only `display.read`; a clinician's personal token still has their original clinical authority when explicitly requesting a clinical context. A UI toggle does not revoke that personal authority. Device/session policy requires hospital review.

## 7. Realtime isolation and revocation limits

Raw patient/visit/resource Postgres Changes subscriptions are removed from the React board. The prepared migration removes these tables from `supabase_realtime` publication where present. No PHI Broadcast channel or outbox publisher is introduced. This milestone uses fresh authorized polling every five seconds in NECMS mode, with visible synchronization/stale status.

This is a deliberately restricted transport, **not implemented managed realtime**. It avoids relying on cached websocket authorization or expecting HTTP context headers in websocket RLS. There are no clinical sockets to retain after context switch/revocation. Browser checks distinguish Vite's local HMR socket from clinical sockets. Database publication checks and browser no-clinical-socket assertions passed; actual hosted publication/auth behavior remains untested.

Server access revocation applies on the next operation. The client detects denial at its next poll/action and clears displayed data; it cannot retroactively erase data already delivered, and continuous polling assumes connectivity. Dedicated kiosk session/timeout procedures and any future private invalidation transport need real hosted tests. Raw streams must not be reenabled to recover perceived realtime functionality.

## 8. Actual automated results

Final local executions completed with exit 0:

| Command/check | Actual result |
| --- | --- |
| `npm.cmd test` | 18 tests passed across 2 files. |
| Django `test patients --verbosity 1` | 40 tests passed; system check no issues. Includes the original 27, 12 scoped API tests and migration opt-in guard. |
| `npm.cmd run build` | TypeScript/Vite build passed; 1,628 modules. Isolated settings only; not a production artifact. |
| `npm.cmd run test:database` | Original disposable database regressions passed. |
| `npm.cmd run test:hospitals` | Prepared migration application/rollback/preservation and hospital SQL assertions passed. Synthetic public/private hospitals, selected context, own reads, foreign reads/writes, forged context/ownership, anonymous denial, composite FKs, role/capability changes, revocation/expiry, display whitelist, audited administration/configuration, stale versions, resource conflicts and retry deduplication. |
| Existing `npm.cmd run test:browser`, demo port 5174 | Existing PatientFlow fictional registration/edit/persistence/discharge/resource/filter/layout checks passed. |
| `node scripts/check-hospital-browser.mjs`, test port 5175 | Selector, delayed A response after B switch, restricted display output, revoked-access clearing and zero clinical sockets passed. Django/Auth are mocked, external HTTP blocked. |

Development failures were fixed and rerun: a stable SQL snapshot test issued and used a new context in one statement; FK testing first hit the existing active-patient unique constraint; a reused Fetch Response body broke the new two-request mock; the browser socket assertion initially counted local Vite HMR; a fixture retry block temporarily reset the test role before a display check. Final runs pass. These fixes did not weaken RLS or the capability/ownership checks.

Not executed/proven: hosted migration/schema comparison, live Supabase Auth/Data API calls, private channel join/revocation, real simultaneous PostgreSQL connections, hosting row/response/load limits, hosted backup/restore and deployment rehearsal. Sequential space/version conflicts are not evidence of genuine concurrency. No claim that a direct REST integration test passed; direct SQL role/RLS tests are narrower evidence.

Existing dependency warnings remain: the earlier audit reported three affected Vitest-chain packages (two critical, one moderate). No automatic major upgrade/force fix was performed. Use trusted tests only and review a compatible tooling upgrade separately.

## 9. Security findings and remaining work

Hosted project intent is approved, but technical isolation, metadata, schema/history, provenance and recovery verification are incomplete. No live execution is permitted from this report. Unknown active-care ownership needs hospital-approved continuity/reconciliation; new RLS intentionally hides unassigned history and must not be deployed casually to an operational board.

Real PostgREST header propagation/type/function discovery and direct API isolation need managed integration testing. Review every deployed legacy overload/policy/default grant; catalog drift could create bypasses absent locally. Future clinical tables must carry the same composite ownership checks. Realtime is polling-only; any private transport requires additional implementation and hosted revocation tests.

Department-level access scoping, approved role bootstrap/onboarding, retention/cleanup for contexts and request ledgers, pageable/searchable identity lookup for large hospitals, provisioning of restricted display devices, and operational load tests remain. No national patient matching/sharing is implemented. Hospital configuration language choices are an initial operational allowlist, not a complete Namibian localization policy.

## 10. Readiness for Milestone 3

Ready for review of isolated source changes, not hosted deployment or clinical use. Before claiming 2B complete end-to-end or proceeding to a clinical pilot: establish authenticated read-only metadata/catalog access; attest exact target/endpoint/schema/history; verify record provenance/active-care continuity; approve bootstrap/capabilities/device policies; run real PostgreSQL and managed Supabase acceptance tests; rehearse recovery/cutover; then obtain approval for the specific migration execution.

Milestone 3 emergency-arrival/lifecycle work may be planned after review, but this report does not authorize it. No clinical priority criteria or AI triage were added. Stop here and await review.
