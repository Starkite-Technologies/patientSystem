# NECMS Milestone 2C — integration and security verification

Date: 2026-10-14. Reviewed application revision: `f7c5d30`. Result: **safe local verification completed with reproduced failures; hosted integration is blocked. Not ready for deployment, a clinical pilot, or progression to Milestone 3 implementation.** No application behavior or migration was changed to make tests pass.

## Scope and environment

Reviewed all four Milestone 2B commits:

| Commit | Review conclusion |
| --- | --- |
| `66c301f` | Hospital entities, nullable historical ownership, composite relationships, context-bound RLS/RPCs, retry ledger and synthetic checks match the core isolation direction. Full resource audit coverage has a reproduced defect. No hosted parity or genuine concurrency proof. |
| `4dae6f5` | Django preserves verified user-token forwarding and checks route/context/purpose/capabilities. Legacy clinical routes fail closed in NECMS mode. Malformed non-object JSON crashes three endpoints. Migration opt-in guard blocks accidental execution but is not approval/target verification. |
| `ac208d4` | Hospital switch unmounts old state and guards board response generations. Display whitelist is server-side and raw clinical sockets are absent. Overlapping polling has two reproduced revocation/latency defects. Text encoding regressed. |
| `f7c5d30` | Report correctly separates local evidence from hosted deployment and lists department/realtime/bootstrap gaps. Its passing-test statement is historical; the new 2C failure probes expose cases those tests did not cover. |

Authentication implementation, API gateway, SQL functions/policies, selector/context reset, restricted display, feature flags, management command and test harnesses were inspected. The implemented architecture is aligned in its core hospital isolation design, but cannot be accepted as fully satisfying revocation UI safety and complete auditability. Department-limited context grants and managed private realtime remain deferred; current access is hospital-wide and transport is polling.

Owner development intent from the prior instruction is acknowledged. Current `.env` still resolves to `znltmxajrztszhjuamak`. No separately designated test database URL or PostgreSQL connection is present. CLI project-list verification returned authentication-required (exit 1), with raw output/token values withheld. Therefore hosted project metadata, exact database endpoint, clean/synthetic-only status, least-privilege test credentials, deployed schema/migration history and restore procedure could not be verified. The original PatientFlow project was not used for database testing or schema queries.

All SQL execution used fresh in-memory PGlite, mocked Auth roles/users and existing fictional fixtures. Browser tests used local previews with synthetic sessions/mocked Django and blocked external HTTP. No real patient records were queried/copied, no hosted migrations/configuration changes were made, and no destructive hosted operation occurred. Docker was not installed. Feature flags and `.env` remain unchanged.

## Actual test executions

Passing a prior suite does not supersede the new failures below. All statuses are from executions in this milestone.

| Command/check | Actual result | Evidence boundary |
| --- | --- | --- |
| `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/run-isolated-checks.ps1` | Exit 0. Frontend 18/18, Django 40/40, TypeScript/Vite build, original database suite and hospital database suite passed. | Hosted connections replaced by unreachable local settings. Django upstream/Auth mocked; PGlite has one serialized engine. |
| `npm.cmd run test:browser`, `PREVIEW_URL=http://127.0.0.1:5174` | Exit 0; original PatientFlow demo workflows/layout passed. | Fictional localStorage only; no live backend. |
| `node scripts/check-hospital-browser.mjs`, preview port 5175 | Exit 0; baseline hospital switch, stale A response after B selection, ordinary revocation clearing, whitelist display and no clinical socket passed. | Django/Auth mocked. Local Vite HMR is excluded from clinical socket count. |
| Same browser command with `NECMS_REVIEW_CONNECTION=true` | Exit 0; simulated request abort clears clinical rows; retry reloads authorized B; simulated HTTP 401 clears rows; recovery works. | HTTP abort/401 are controlled simulations, not actual Supabase session expiry or infrastructure recovery. |
| Same command with `NECMS_REVIEW_DISPLAY_RACE=true` | **Exit 1.** Delayed authorized display response restored one synthetic row after a newer denial had cleared it. | Actual React/browser behavior; server timing/revocation mocked. |
| Same command with `NECMS_REVIEW_SLOW_DENIAL=true` | **Exit 1.** One synthetic clinical row remained visible after at least two HTTP 403 responses, each delayed six seconds. | Actual React five-second polling/generation logic; denied responses mocked. |
| `node scripts/check-hospital-review.mjs` | **Exit 1.** Four checks passed; resource-audit completeness failed: resource changed, zero audit events added. | Actual prepared SQL/RLS in PGlite with an authorized synthetic member lacking a global staff profile. |
| Django `test patients.verify_necms_requests --verbosity 1` | **7 tests: 4 passed, 3 failed.** Array JSON bodies returned 500 instead of 400 on context/staff/configuration routes. Expired-auth rejection, interruption denial, revalidation on recovery and permission change between requests passed. | Real Django request/permission/error handling; Auth/Data API responses mocked. |
| CLI project metadata | Exit 1; authentication required. | No project metadata/database inspection obtained. |

The explicit Django review module is not named `test*.py`, so it is invoked separately and is not silently counted in the baseline's 40 tests. Failed assertions remain failed, without expected-failure markers, altered authorization or suppressed RLS. The completion gate includes all listed commands, not just the baseline suite.

New verification artifacts: `scripts/check-hospital-review.mjs`, `backend/patients/verify_necms_requests.py`, optional negative/recovery modes in `scripts/check-hospital-browser.mjs`, and this report. No migration files, clinical rules, authentication implementation or UI source were modified in 2C.

## Security acceptance coverage

| Requirement | Local finding | Hosted integration |
| --- | --- | --- |
| A cannot read B | Selected-context RLS/view/board SQL checks pass with synthetic A/B; quarantine denied. | REST enforcement and header propagation not executed. |
| A cannot update B | Checked `save_visit` and space RPC deny foreign UUIDs; no unauthorized result rows. | Live RPC transport not executed. |
| Django membership/capability enforcement | Missing/forged/mismatched context, display-purpose access and absent capability deny; permission removal is rechecked between requests. | Real Auth/membership lifecycle not executed. |
| Direct REST cannot bypass RLS | Direct authenticated SQL role/policy checks pass; ordinary table writes are revoked. | **Not proven by direct REST requests.** SQL is narrower evidence. |
| Privileged functions cannot bypass authority | Tested context/role/foreign ID negative cases pass; no PUBLIC execute on NECMS functions in test catalog. | Actual deployed overloads/owners/grants unverified. |
| Revocation | Database membership/version/expiry checks and ordinary fast-denial UI pass. **Slow/overlapping UI responses fail.** | Real session/revocation transport not executed. |
| Dual-hospital context switch | Database selected-context tests and delayed-A browser test pass. | Distinct real hospital accounts not exercised. |
| Restricted display | SQL field whitelist excludes identity/notes/free text; display-only base reads/clinical RPC deny. **Stale display restoration after denial fails.** | Managed projection transport untested. |
| Composite relationships | Foreign patient/resource FKs reject in actual SQL, including owner-level fixture attempts. | Hosted catalog compatibility unverified. |
| Identical registration retry | Sequential identical actor/hospital/key returns same UUID; changed payload rejects. | Genuine simultaneous requests and lost-response replay untested. |

Catalog review checks additionally passed for 16 non-profile application/archive/private tables with RLS enabled and zero PUBLIC EXECUTE grants on NECMS functions. `staff_profiles` remains covered by the original own-profile policy; mock `auth.users` is test-only, not a claim about managed Auth permissions. No RLS was disabled or grant broadened to bypass a denial.

## Confirmed findings and remediation

### C-01 — clinical board denial starvation (high, release blocker)

`src/App.tsx` starts a new poll every five seconds and increments its response generation even while previous requests are pending. If responses take six seconds, each denial arrives after a newer generation exists and is discarded. The last clinical dataset remains visible despite repeated revocation denials. This is reproducible locally, not merely a theoretical concurrency concern.

Remediation: prevent overlapping refreshes or use a per-context request coordinator that preserves context-switch protection while processing access-denial responses for the currently active context. Clear records/dialogs/staff state on denial and enforce expiry/staleness clearing under a hung connection. Verify that slow success/denial, context switch and retry cannot starve updates. Do not remove the hospital-switch generation guard wholesale.

### C-02 — delayed display response restores denied rows (high, release blocker)

`RestrictedDisplay` in `src/HospitalWorkspace.tsx` uses only an `alive` flag, with overlapping periodic requests. A newer HTTP 403 clears rows, but an older successful response can subsequently repopulate them. The reproduced row has only the restricted operational fields; it is not a full patient-identity leak, but it violates revoked-access display clearing.

Remediation: share the context-bound request coordination/invalidation approach with the clinical board; discard stale completions after denial/expiry, clear display state, and require a fresh validated context where appropriate. Preserve the server-side whitelist and dedicated display capability.

### C-03 — resource changes can miss audit (high, integrity blocker)

`set_resource_state` in migration `202610140006_necms_hospital_isolation.sql` updates the resource, then inserts an audit event using `SELECT ... FROM staff_profiles WHERE id=auth.uid()`. Memberships reference Auth users and do not require a global profile; an authorized member with no profile can therefore change resource state while the insert produces zero rows. The synthetic fixture proves state changed and audit increment was zero.

Remediation: insert an audit event unconditionally using verified actor UUID and an appropriate fallback name (or atomically reject the entire mutation if hospital policy requires a profile). Include resource identity and old/new state in protected audit data. Review membership/profile provisioning invariants. Use a reviewed forward migration rather than silently rewriting a published migration or backfilling fictional audit history.

### C-04 — malformed request bodies cause server errors (medium)

`contexts`, `staff` and `configuration` in `backend/patients/necms_views.py` call `.get()` on request data without confirming object shape. Authenticated array requests produce HTTP 500 rather than a validation response. The mutation RPC is not reached in these failure cases; no authorization bypass was reproduced.

Remediation: use explicit serializers/object-shape validation before dictionary access, maintain existing permission checks and return sanitized HTTP 400. Keep debug output disabled in any shared environment.

### C-05 — text encoding regression (low, static review)

The React commit changed valid punctuation into mojibake, for example the original ellipsis in the login loading text and bullets in the footer. UTF-8 comparisons against `20c2e03` confirm the source strings changed, rather than merely terminal display encoding. A similar resource-summary delimiter merits correction during forward hardening. Existing layout/browser tests did not catch this. Restore the intended UTF-8 text without changing clinical vocabulary or workflows.

### C-06 — independent capabilities are conflated in UI (medium, static review)

`canEdit` requires both `encounter.register` and `encounter.update_legacy` before exposing registration or editing. A staff role approved for only one operation loses that authorized workflow in the UI even though the server permits it. No privilege escalation results. Separate per-operation controls and verify roles with read+register-only and read+update-only capability sets. This case was identified from source, not exercised by a new browser role fixture.

Other known gaps remain: department-limited grants, rate/retention controls for contexts/retry ledger, scalable identity lookup, reviewed onboarding/role bootstrap, kiosk session/placement policy, deployment TLS/cache settings and unresolved Vitest-chain audit warnings. These were not repaired or represented as verified in this milestone.

## Concurrency findings

Genuinely exercised: concurrent/delayed **browser HTTP mock handlers** with real React state transitions; current-context requests overlapping polling; delayed old-hospital response after switching; sequential PostgreSQL version/resource conflicts and idempotency; per-request Django permission revalidation.

The browser overlap uses one synthetic dual-member session. It does not demonstrate simultaneous operations by distinct authenticated hospital users.

Not genuinely exercised: two real PostgreSQL connections contending for the same space, encounter, membership lock or idempotency row; simultaneous users in a managed Supabase project; revocation during an already-authorized write. PGlite queues one engine and is not proof of multi-session lock behavior. `FOR SHARE` membership locks and unique indexes were inspected but mutual administrator revocation/deadlock handling still requires a real concurrency harness.

Expired database contexts and membership validity were verified in SQL. Expired Supabase JWTs/refresh-token behavior remain simulated via Auth rejection. Connection abort/recovery in browser and upstream unavailability in Django were simulated; no real infrastructure outage/recovery was attempted.

## Migration, publication and recovery findings

The baseline checker actually rehearsed additive migration rollback in disposable PGlite and then successful application. Rollback removed newly created hospital objects and retained baseline identity values. The new review checker compares all original columns in patients, visits, resources, audit events and both private migration archives before/after 006: all six table snapshots match, excluding only deliberately added ownership/department columns. Original UUIDs/references/audit content are preserved; no old ownership is assigned.

The review checker creates a synthetic `supabase_realtime` publication and runs the original publication additions without stripping them: three clinical tables exist in the publication before 006 and zero afterward. This executes the removal branch in actual PostgreSQL catalog semantics. PGlite has no managed websocket delivery, so this is not live Realtime integration or a hosted-configuration assertion.

No hosted schema/migration history comparison, restore from backup, forward-fix migration, production rollback, lock-duration measurement or deployment rehearsal was executed. Transactional DDL rollback is narrower than a tested hosted backup/restore procedure. Never restore global RLS as rollback or silently relabel unknown historical records.

## Reproduction commands

Use only the existing isolated previews and synthetic harnesses. The negative commands intentionally exit nonzero on the reviewed code. Do not replace these with ordinary live dev/seed/migration commands.

```powershell
# Baseline, unreachable hosted settings and disposable SQL
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/run-isolated-checks.ps1
node scripts/check-hospital-review.mjs

# Terminal 1: synthetic NECMS preview
node scripts/start-necms-test.mjs

# Fresh terminal for each mode, to avoid retaining flags between runs
node scripts/check-hospital-browser.mjs
$env:NECMS_REVIEW_CONNECTION='true'
node scripts/check-hospital-browser.mjs
Remove-Item Env:NECMS_REVIEW_CONNECTION
$env:NECMS_REVIEW_DISPLAY_RACE='true'
node scripts/check-hospital-browser.mjs
Remove-Item Env:NECMS_REVIEW_DISPLAY_RACE
$env:NECMS_REVIEW_SLOW_DENIAL='true'
node scripts/check-hospital-browser.mjs
Remove-Item Env:NECMS_REVIEW_SLOW_DENIAL
```

Explicit Django review was run with process-only `SUPABASE_URL=https://127.0.0.1:1`, synthetic publishable/secret placeholders, debug false and testserver allowed; it uses mocked upstream methods. Command: `.venv\Scripts\python.exe backend\manage.py test patients.verify_necms_requests --verbosity 1`. Never put production secrets on a command line. Original demo check uses `start-demo.mjs` on 5174 and `PREVIEW_URL` pointing there. Stop owned preview servers afterward; no deployment artifacts or fixture screenshots should be committed.

## Deployment blockers and Milestone 3 recommendation

1. Fix C-01/C-02/C-03 and malformed-input validation, preserving the new failing probes as acceptance tests; review the smaller UI regressions too.
2. Establish a separately designated clean/synthetic integration project with documented owner approval. Authenticate locally without sharing tokens; verify exact reference/endpoint, permissions, schema/history and protected configuration.
3. Demonstrate approved backup/restore or forward recovery; verify provenance/active-care continuity and obtain explicit approval for the specific migration execution. No such approval/execution is inferred from this report.
4. Execute direct REST/RPC, real Auth/session, least-privilege account and real multi-connection concurrency tests in that verified environment. Keep raw clinical subscriptions disabled.
5. Approve capability/department/display/onboarding/device policies and clear deployment/load/security gates.

**Recommendation: do not start Milestone 3 implementation or approve hosted deployment yet.** The base isolation design has useful passing local evidence, but reproduced revocation and audit defects plus missing managed integration prevent acceptance. This milestone records the failures; it does not weaken tests, fix clinical rules, introduce AI, or authorize hosted changes.
