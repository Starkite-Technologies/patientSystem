# NECMS Milestone 2D completion report

Date: 2026-10-14. Branch: `feature/necms-multi-hospital`.

**The four reproduced defects are fixed and pass local regression checks. Hosted security, deployment readiness and clinical validation are not established.** No hosted database, configuration or patient records were changed. Milestone 3 was not implemented.

## Scope and commits

Reviewed the 2C findings and reproduction harnesses against baseline commit `dc4d06c`. Retained React, Django, Supabase Auth, PostgreSQL, hospital capabilities, context validation and RLS. No dependency changes, ownership backfill, clinical priority changes or AI were introduced.

| Commit | Change |
| --- | --- |
| `cceb33f` | Protected-view lifecycle, cancellation and stale-response guards; browser/unit regressions |
| `c2c7bf8` | Atomic resource audit forward fix and disposable SQL regressions |
| `1467494` | Malformed request validation and normal discovery of request regressions |

This report is committed separately. Nothing was pushed. Commits use the repository-preparation automation identity rather than representing a clinician or a verified personal Git identity.

## Root causes and fixes

### C-01: slow access denials left clinical data visible

The board accepted only the most recently **started** refresh. With five-second polling and six-second denials, every denial was superseded before it completed. Previously loaded clinical rows remained visible.

`ProtectedRequests` now binds requests to an authorisation/lifecycle epoch. Read ordering follows the newest settled response, so merely starting another poll cannot starve a slow reply. Any current-epoch 401/403 invalidates the epoch, aborts all its requests, clears the board/resources/activity/history and closes the patient editor. Replies from invalidated epochs cannot update state even if transport ignores cancellation. History, registration and resource updates participate in the same guard.

Hospital switching unmounts the previous workspace immediately. Token changes remount protected views; logout clears the session/view before waiting for remote sign-out. A late initial session lookup cannot replace a newer authentication event. Missing sessions and non-JSON HTTP denials retain their 401/403 classification. Requests retain a 60-second timeout and use `cache: no-store`.

Mutation completion checks epoch validity rather than read ordering: a newer authorised poll must not discard completion of a successful write. This preserves demo registration and subsequent fresh reads while still rejecting callbacks after denial/logout/context change.

Django and PostgreSQL remain the permission authorities. Clearing the interface grants no access. Revocation visibility is still bounded by the next request and its response; polling does not provide instantaneous notification of a server-side membership change. During a complete outage the client cannot independently discover remote revocation. Infrastructure/session/cache behaviour needs managed integration testing.

### C-02: delayed display success restored cleared rows

The display checked only whether its component was mounted. An older successful response could arrive after a newer denial and repopulate the table.

Restricted display requests now use the same cancellation and epoch guard. Denial, unmount, hospital/display context change and authentication changes invalidate outstanding replies. Only a fresh authorised request can restore rows. The existing server-side `necms_display_board` projection remains unchanged; it supplies display label, controlled status, next service and generic space state, without patient identity/complaint/notes. Raw clinical realtime subscriptions remain disabled.

Browser timing probes deliberately remove the fetch cancellation signal in selected test modes. This verifies stale-response protection independently of AbortController. The override exists only inside the synthetic browser harness, not application code.

### C-03: resource change succeeded without an audit event

The prior resource function updated the space, then used `INSERT ... SELECT` from `staff_profiles`. An authorised hospital member with no profile selected zero rows, silently producing no audit record.

New additive migration `202610140007_necms_resource_audit_integrity.sql` replaces only `set_resource_state(uuid,text)`. It retains live hospital/context/capability checks and membership locking. A missing staff profile raises permission denial (`42501`) **before** resource mutation. No identity or capability is fabricated; administrators must provision the actual staff identity separately. Legacy global profile role is not substituted for hospital capabilities.

Successful changes insert an explicit audit row containing authenticated actor ID/name, hospital, action, server timestamp, resource ID, before/after state, context ID and membership ID. The audit snapshots contain no patient identity or clinical notes. Resource update and audit insertion share the PostgreSQL transaction; audit insertion failure rolls back the resource update. Fixed search path and restricted function execution grants are retained.

The SQL fixture explicitly provisions one fictional profile as the test owner for the positive case, using a legacy viewer role to prove hospital capability remains authoritative. It does not model automatic application provisioning.

### C-04: three malformed bodies returned HTTP 500

`contexts`, staff POST and configuration POST called `.get()` on an array without checking object shape, raising AttributeError before mutation RPC execution.

The shared `object_body` validator rejects non-object JSON with DRF ValidationError (400). DRF syntax errors remain 400. Authentication and capability checks preserve 401/403; existing workflow conflicts remain 409. Unexpected internal exceptions still produce 500 rather than being mislabelled as client errors. Tests with debug disabled confirm no stack trace/internal diagnostic in the response. The validation warning records operation/status without request body, credentials or patient identifiers; normal server error logging remains in place.

## Files created or modified

| Area | Files |
| --- | --- |
| Protected state | `src/App.tsx`, `src/HospitalWorkspace.tsx`, new `src/lib/protectedRequests.ts` |
| API/cancellation | `src/lib/api.ts`, `src/lib/store.ts` |
| Frontend tests | `src/lib/api.test.ts`, new `src/lib/protectedRequests.test.ts`, `scripts/check-hospital-browser.mjs` |
| Request validation | `backend/patients/necms_views.py`, `backend/patients/verify_necms_requests.py`, new `backend/patients/test_necms_review_regressions.py` |
| Audit migration/test | New `supabase/migrations/202610140007_necms_resource_audit_integrity.sql`, new `supabase/tests/resource_audit_integrity.sql` |
| Disposable database runners | `scripts/check-hospital-database.mjs`, `scripts/check-hospital-review.mjs` |
| Report | New `docs/architecture/NECMS_2D_COMPLETION_REPORT.md` |

The seven existing migrations, original database fixtures, original browser workflow, `.env` configuration and dependency manifests were not modified. Ignore rules still exclude credentials, local tokens, build outputs and test screenshots; only `.env.example` is tracked. Reviewed changes had no literal credential-pattern matches. Synthetic fixtures remain clearly identified.

## Migration execution and recovery evidence

Migration 007 executed only in fresh in-memory PGlite databases with synthetic Auth/roles and fictional fixtures. It was not linked, pushed or applied to any hosted project.

The hospital runner rehearsed 006 and 007 inside an explicit transaction and rolled them back, confirmed baseline hospital objects were absent and baseline identities unchanged, then applied both successfully. The dedicated audit fixture forced audit insertion to fail and verified unchanged resource state and audit count. No RLS was disabled.

The review runner again checked six nonempty legacy table/archive snapshots and original publication removal, then applied 007 and ran the missing-profile probe. All five review checks passed. This is disposable PostgreSQL evidence, **not a hosted backup/restore demonstration**. Historical ownership remains unresolved/pending; no historical UUID, reference, encounter or audit event was relabelled or removed.

## Tests executed and actual results

| Check | Result and evidence boundary |
| --- | --- |
| Frontend `npm.cmd test` | **26 passed**, three files: model 13, API 7, protected requests 6 |
| Django `manage.py test patients` | **53 passed**, system check clean; includes 13 request review tests through normal discovery; upstream Auth/RPC mocked |
| Explicit `patients.verify_necms_requests` | **13 passed** in the remediation run; included again in final 53-test suite |
| TypeScript/Vite `npm.cmd run build` | **Passed**; production artifact built locally, not deployed |
| Original `npm.cmd run test:database` | **Passed**: names/DOB, normalisation, roles, RLS, audit, versions, discharge, resource conflicts in disposable PGlite |
| `npm.cmd run test:hospitals` | **Passed**: two fictional hospitals, isolation, revocation/context expiry, cross-hospital relationships, retry/version/resource conflicts, preservation/transaction rollback, missing-profile denial, attributed audit and audit-failure rollback |
| `node scripts/check-hospital-review.mjs` | **5 checks passed**: six-table preservation, publication removal 3 to 0, missing-profile resource protection, RLS catalog (16 non-profile tables), no PUBLIC NECMS execute |
| Original `check-browser.mjs` with demo URL 5174 | **Passed**: registration, editing, treatment-space allocation/persistence, discharge, resources, activity, filters, display privacy, mobile layout and duplicates |
| Hospital browser default | **Passed**: selector, stale A reply after B switch, restricted display, revocation clearing and no clinical websocket |
| Hospital browser connection mode | **Passed**: simulated interruption, retry recovery, 401 clearing and fresh authorised recovery |
| Hospital browser display-race mode | **Passed**: held 200 delivered after newer 403 cannot restore display rows |
| Hospital browser slow-denial mode | **Passed**: two delivered six-second denials clear clinical rows despite overlapping polling; fresh authorised recovery also checked |
| Hospital browser multiple-switch mode | **Passed**: at least two pending A requests cannot restore A data after switching to B |
| Hospital browser logout mode | **Passed**: logout while B read pending, late reply ignored, reauthentication shows no prior clinical rows until a fresh selected context/read |
| Git diff whitespace and credential-pattern review | **Passed**; no application secrets, generated outputs or `.env` staged |

The final aggregate runner used process-only unreachable loopback Supabase/database settings and synthetic placeholders. Browser tests used Microsoft Edge, local Vite previews, mocked Django/Auth responses and blocked external traffic. SQL tests use a single embedded engine, not concurrent managed connections. No hosted security test is claimed.

Failures encountered and resolved, without weakening acceptance assertions:

- Initial original browser invocation omitted the isolated demo URL and stopped at the login screen; rerun explicitly used 5174.
- The correctly targeted original browser test exposed the mutation/read-order regression described above; fixed and rerun passed. A dedicated unit test now covers this ordering.
- The slow-denial harness initially left its mock membership revoked before the subsequent positive display step. Its security assertion passed; the harness now explicitly restores mock access and checks recovery before that step. The original denial/display assertions remain.
- Direct PowerShell script invocation was blocked by local execution policy. The existing test runner then completed with process-only `-ExecutionPolicy Bypass`; no persistent machine policy was changed.

No tests were marked skipped, expected-failure or disabled to obtain these results. Previously failing 2C probes now assert successful remediation, including explicit missing-profile rejection and unchanged resource state.

## Reproduction commands

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/run-isolated-checks.ps1
node scripts/check-hospital-review.mjs

# Separate terminal: mock-only NECMS preview, port 5175
node scripts/start-necms-test.mjs
# Each browser mode in a fresh terminal/process to avoid retained flags:
node scripts/check-hospital-browser.mjs
$env:NECMS_REVIEW_DISPLAY_RACE='true'; node scripts/check-hospital-browser.mjs
$env:NECMS_REVIEW_SLOW_DENIAL='true'; node scripts/check-hospital-browser.mjs
$env:NECMS_REVIEW_CONNECTION='true'; node scripts/check-hospital-browser.mjs
$env:NECMS_REVIEW_MULTIPLE_SWITCH='true'; node scripts/check-hospital-browser.mjs
$env:NECMS_REVIEW_LOGOUT='true'; node scripts/check-hospital-browser.mjs

# Separate terminal: fictional browser-local demo, port 5174
node scripts/start-demo.mjs
# In another terminal:
$env:PREVIEW_URL='http://127.0.0.1:5174'
node scripts/check-browser.mjs
```

Do not substitute a hosted application, ordinary environment-loaded development server or hosted database for these isolated harnesses. Owned test preview processes were stopped after verification.

## Remaining concerns and next milestone recommendation

The four requested defects have passing local evidence. Other 2C findings remain outside this remediation: C-05 text encoding, C-06 register/update capability conflation in the UI, department-limited permissions, onboarding/bootstrap policy, context/retry retention/rate controls, kiosk policy and previously reported development-dependency audit findings. No new dependency audit or remediation was performed here.

Hosted integration remains blocked by missing verified schema/history, clean/synthetic target evidence, real test-account credentials, recovery demonstration and approval of the exact migration execution. Prior project-owner development intent alone does not satisfy those gates. No hosted authentication or schema check was performed in this milestone.

Before hosted execution or deployment:

1. Verify the explicitly designated isolated project, endpoint, synthetic-only data, least-privilege accounts and migration compatibility without accessing patient-level records.
2. Demonstrate backup/restore or approved forward recovery, resolve historical provenance and active-care continuity, review 006/007 impact and obtain explicit execution approval.
3. Test real Supabase Auth/session refresh/expiry, direct REST/RPC RLS, actual managed publication configuration, TLS/cache/device privacy and membership changes. Keep raw clinical realtime disabled.
4. Use multiple real PostgreSQL connections for competing resource/encounter writes, repeated idempotency keys, revocation during writes and lock/deadlock recovery. Current SQL conflicts are sequential, and browser races use mocked handlers.
5. Resolve remaining approved capability/display/onboarding policies and review the outstanding UI/security findings before declaring readiness.

**Milestone 2D remediation is complete locally. Ready for isolated integration review; not ready for hosted deployment or Milestone 3 implementation.** Stop here pending review and explicit approval for subsequent work.
