# NECMS Milestone 3B completion report

Local development verification, 2026-10-15. **Operational prototype; neither clinically validated nor ready for hosted deployment.**

## Executive summary

Implemented an Emergency Coordination Board and hospital-scoped, independently tracked service work items. Staff explicitly record calls, acceptance, deferral, care start, completion, cancellation and reassignment. Manual urgent-review/reassessment requests have responsibility and acknowledgement tracking. Provisional sequencing reviews preserve contemporaneous queue evidence and subsequent explanations without blocking urgent care or judging clinical appropriateness.

Implementation and synthetic local verification are complete within the boundaries below. Real Supabase integration, independent-session concurrency, restoration and clinical governance remain unverified. No hosted service was contacted, no hosted migration was executed and no real patient information was used. No clinical scoring, timing thresholds, automatic escalation or AI was introduced.

## Existing baseline and compatibility

The repository contains the 2D permission/request-lifecycle safeguards and the complete 3A arrival, provisional identity, assessment/review, observation and timeline foundations described in their reports. At inspection, tracked HEAD was `f625b90`, branch `feature/necms-multi-hospital`; 3A implementation and its assessment/report were uncommitted working-tree changes. They were preserved, not recreated. This milestone also remains reviewable working-tree source; no new commit, staging, push or deployment is claimed.

The eight previously tracked migrations are unchanged. The separate 3A migration precedes the new 3B migration. No historical work items were fabricated, no ownership was inferred and no legacy patient/encounter/audit rows were backfilled. Patient UUIDs, PF reference generation and temporary identities remain intact. The old PatientFlow board, service hints, treatment-space management and clinical workspace remain available.

## Files created or extended

New 3B files:

- `docs/architecture/NECMS_3B_TECHNICAL_DESIGN.md` and this report.
- `supabase/migrations/202610150002_necms_coordination.sql` and `supabase/tests/coordination.sql`.
- `backend/patients/coordination_views.py` and `backend/patients/test_coordination.py`.
- `src/CoordinationBoard.tsx`, `src/lib/coordination.ts` and `src/lib/coordination.test.ts`.
- `scripts/check-coordination-database.mjs` and `scripts/check-coordination-browser.mjs`.

Extended existing working files:

- `backend/config/urls.py`: six coordination routes alongside the existing 3A routes.
- `backend/patients/gateway.py`: serialization/stale-version and deadlock SQL errors become sanitized HTTP 409 responses.
- `src/App.tsx`: capability-controlled coordination navigation, page title and protected child view.
- `src/clinical.css`: coordination counts and horizontally scrollable table layout using the existing interface styles. This file originated in the uncommitted 3A baseline.
- `scripts/run-isolated-checks.ps1`: coordination SQL runner follows the existing baseline, hospital and clinical checks; unreachable process-level configuration prevents accidental hosted access.

Other visible changes, including `src/model.ts`, `src/lib/store.ts`, `ClinicalWorkspace.tsx`, clinical API/tests and 3A documentation, belong to the preserved 3A working baseline. The Git diff against HEAD includes both milestones; review it accordingly. Dependencies, credentials and environment files were not changed for 3B. `.env*`, local tokens, database exports and generated test artifacts remain ignored; `.env.example` is the intended exception.

## Database architecture and execution status

The additive migration creates nine hospital-owned public tables:

| Entity | Purpose |
| --- | --- |
| `coordination_services` | Operational service catalogue; no medical suitability criteria |
| `care_teams`, `care_team_members` | Structured teams and hospital-membership-linked rosters |
| `operational_reason_categories` | Configurable documentation categories, without seeded clinical defaults |
| `future_escalation_policies` | Immutable version/document references; `active=false` enforced |
| `coordination_work_items` | Concurrent service/task records, ownership, readiness, state, timestamps and version |
| `coordination_events` | Immutable actor-attributed transitions, occurrence/recording times and queue snapshots |
| `operational_exceptions` | Start-event-linked provisional sequencing reviews |
| `exception_annotations` | Append-only acknowledgement/explanation history |

A private `coordination_requests` ledger stores hospital/actor/retry identifiers, operation/payload fingerprints and original mutation results. Composite foreign keys bind work to a verified encounter and same-hospital service, team and staff membership; exception/event/annotation relationships are similarly scoped. Queue and encounter-history indexes support the principal reads.

**Executed only in disposable PGlite test databases.** Tests applied the existing migration sequence and synthetic fixtures, compared all original columns in twelve existing tables before/after 3B, and verified transactional DDL rollback. No existing data changes or automatic capability grants were observed. This proves embedded transactional preservation, not a backup restore or deployment rehearsal. No hosted migration, seed, repair, reset, linking or configuration change was performed.

## API routes and permission model

All routes are under `/api/necms/hospitals/<hospital_id>/`:

| Method and suffix | Behaviour |
| --- | --- |
| GET `coordination/` | Checked clinical coordination bundle |
| POST `coordination/work-items/` | Explicit work/review-request creation |
| POST `coordination/work-items/<work_id>/events/` | Versioned transition |
| GET `coordination/encounters/<visit_id>/events/` | Immutable operational history |
| POST `coordination/exceptions/<exception_id>/review/` | Append acknowledgement with category/explanation |
| POST `coordination/configuration/` | Create operational catalogue/roster entry or inactive policy reference |

Supabase Auth, Django token verification, validated hospital context and user-token database access are retained. Django checks the route capability; privileged SQL functions independently recheck live membership, context purpose, capability and related record ownership. Browser hospital identifiers never grant access.

Twelve new capabilities receive **no default grants**: `queue.read`, `queue.coordinate`, `patient.call`, `service.accept`, `treatment.record`, `work.create`, `work.assign`, `work.complete`, `reassessment.request`, `escalation.acknowledge`, `exception.review`, `coordination.configure`. Synthetic fixtures explicitly grant capabilities only within disposable tests. A reviewed hospital-specific capability matrix is required before operational use.

New tables have RLS, checked read policies and no authenticated direct-write grants. Reads require the selected clinical context and queue/encounter/identity permissions; exception records additionally require exception review, and policy-reference reads require configuration permission. Private helpers have no authenticated/public execute privilege. Event/history/policy mutations are rejected by immutable-history triggers. Actor profile and active same-hospital assignee/team membership are validated. Acceptance requires the responsible person or a verified team member. Assignment alone does not imply acceptance.

Restricted display contexts cannot fetch the coordination bundle. Existing server-side restricted display projection remains the only display dataset. Raw clinical realtime remains disabled; polling uses the protected request lifecycle.

## Workflows, ordering and sequencing evidence

Work state is separate from acuity, encounter care status and physical space. Supported states are waiting, called, accepted, underway, deferred, completed and cancelled. Explicit readiness is independent of state. Several services may remain active for one encounter without overwriting `next_action` or historical free-text assignment.

Call cancellation, deferral, cancellation and reassignment require explanations. Reassigning accepted work returns it to waiting and clears acknowledgement. Reassigning underway care preserves underway state with the new owner's acknowledgement pending. Terminal work cannot transition. Closing an encounter does not silently complete its remaining work; cancellation remains available. Completion of a reassessment work item does not create a clinical assessment or diagnostic result.

Start can be recorded before calls, acceptance, completed demographics or triage. Missing sequencing explanations never block it. Server recording time is authoritative; explicitly supplied earlier occurrence needs a late-entry explanation and cannot be in the future. Earlier care snapshots are labelled **recording-time evidence**, not evidence of the queue at that earlier occurrence.

Unknown/untriaged/legacy-unvalidated urgency appears in a prominent separate lane, without a numerical low-priority rank. Each lane is sorted independently. Reviewed provisional/manual urgency orders its lane numerically, then queue-entry time, then UUID; unknown work uses queue-entry time and UUID. An outstanding reassessment keeps the previous independently reviewed value visible with its pending state. This presentation is not a clinically approved scheduling policy and never selects a patient for staff.

Starting work captures ready waiting/called/accepted work for the same service, including stable identifiers, states, versions, responsibility, entry times and encounter urgency/source/status. A reviewed lower-urgency start with another reviewed higher-urgency encounter creates a provisional review. Different services and the same encounter are excluded from the higher-candidate comparison. Unknown target urgency is recorded separately. Staff can explain at start or later acknowledge with a configured category. Initial evidence and all annotations remain immutable. Labels distinguish unexplained, documented/pending review and acknowledged records; none asserts negligence or clinical inappropriateness.

Mutations use a stable retry UUID, operation/payload fingerprint and transactional audit. Identical retries return the original result even after the work version changes. Changed retry payloads and stale versions are rejected. Service advisory locks, work-row locks and ordered encounter share locks protect snapshots in the implementation; real concurrent-session behaviour is not yet demonstrated.

## Frontend behaviour

The new board shows active-patient, awaiting-triage/review, waiting-service, underway, unacknowledged-request and available-space counts. It displays reference, arrival/queue elapsed times, triage/source/review state, last completed assessment, encounter care status, service, verified owner/team, physical space and operational work state. Search, service/team/state filters, closed-work inclusion, work creation/actions, sequencing acknowledgement and configuration are implemented. Encounters without structured work remain visible with clearly labelled legacy hints.

Selecting a patient is read-only. Operational and existing clinical/administrative timelines are available without replacing 3A assessment history. Manual urgent-review/reassessment requests retain an explicit person/team or the recording staff member as request owner; acknowledgement and completion remain distinct. Policy configuration stores inactive references only.

Five-second authorised polling and server snapshot timestamps expose confirmed versus stale/disconnected data. The board retains explicitly marked last-confirmed data on transport failure and clears it on access denial. Epoch/cancellation checks protect hospital switch, capability changes and logout even when mocked transport ignores cancellation. A 401/403 invalidates pending successes. Desktop/tablet layout was browser-tested; this is not a full accessibility or hospital usability assessment.

## Automated results actually executed

All following checks passed locally with synthetic data. No failed test remains in the final runs.

| Check | Actual result and scope |
| --- | --- |
| `scripts/run-isolated-checks.ps1` | Passed frontend, Django, build and all four embedded database runners |
| Frontend Vitest | **40 passed**, including 8 coordination tests: reviewed/unknown urgency, ordering/ties, transitions and acknowledgement |
| Django | **90 passed**, including 20 coordination tests; upstream Auth/Data API mocked, not hosted integration |
| TypeScript/Vite build | Passed; minified main JavaScript approximately 526 kB triggers the existing >500 kB chunk warning |
| Baseline SQL | Passed name/identity normalization, RLS, roles, audit, versions, discharge and space-conflict checks |
| Hospital SQL | Passed preservation/rollback, isolation, revocation, retries, stale versions, resource/profile/audit-failure checks |
| Existing clinical SQL | **32 named assertions, 25 negative probes** passed |
| New coordination SQL, final expanded run | **30 named assertions, 22 negative probes** passed, plus twelve-table preservation, DDL rollback and no automatic grants |
| Existing hospital review script | Passed preserved tables, removed clinical publication, RLS, restricted function execution and resource-audit probes |
| Legacy demo browser | Passed registration/edit/persistence/discharge, resources/activity, filters, display privacy, mobile layout and duplicate validation |
| Existing clinical browser | Passed unknown/immediate-care arrival, retry, assessments/vitals/reconciliation/timeline, capabilities and pending-request switch/logout |
| Existing hospital browser | Passed with all five `NECMS_REVIEW_*` modes enabled: multiple pending switch, logout/reauthentication, slow denial, connection recovery/auth rejection and delayed display success |
| New coordination browser | Passed unknown/reviewed lanes, selection without mutation, concurrent services, explicit start, explanation/acknowledgement and immutable evidence, service filters/tablet bounds, disconnected recovery, delayed-success rejection, role/display restrictions, switch and logout |
| Git whitespace check | Passed; ordinary LF/CRLF conversion notices remain |

Coordination SQL additionally verifies same-encounter concurrent services without legacy overwrite, team acceptance, readiness/deferral/resume/cancellation, earlier/future timestamp validation, event retry identity, stale-version failure, start before triage, immutable queue evidence, cross-hospital direct RLS for work/events/exceptions/annotations, composite-FK rejection, direct-write denial, membership/capability revocation and atomic rollback when the audit sink fails.

Browser checks run real React in headless Edge with synthetic Auth/Django responses and external traffic blocked. They prove client behaviour and request contracts, not deployed server security. Embedded tests execute actual PostgreSQL SQL/RLS/function logic with mocked Auth identity. They use one PGlite engine; no simultaneous independent connections were tested. The final expanded coordination SQL run followed the aggregate run; the coordination browser was rerun after independently sorting the two lanes.

## Limitations, security gates and clinical governance

1. **Hosted integration blocked:** no verified isolated project's identity, schema/history, least-privilege test credentials, executable recovery or specific execution approval was established here. Existing credentials are not evidence of a safe target. Real Auth expiry/revocation, REST/RLS enforcement and deployment configuration remain untested.
2. **Concurrency and recovery blocked:** no local PostgreSQL service/binaries were found through PATH, Windows service inspection or the standard installation path. No real multi-connection contention/deadlock/revocation-in-flight, migration restore or managed backup exercise was run. Transactional PGlite rollback and 409 mapping are narrower evidence.
3. **Clinical approval outstanding:** no approved triage protocol, urgency interpretation, eligibility policy, reassessment interval, escalation recipient/deadline, treatment target, staff scope or exception-review governance exists in this implementation. P1-P5 remain provisional/legacy. Staff control all treatment and review decisions.
4. **Operational configuration is foundational:** entries/roster memberships can be created; retirement, roster removal, correction/supersession and governed approval workflows are not implemented. Inactive escalation records are document/version references, not a runnable policy engine. No medical orders, results, prescriptions, notifications or automated deterioration detection exist.
5. **Scale remains unverified:** board/work/exception/history bundles are not paginated; snapshot locks span active hospital encounters and may contend with clinical writes. Load, query/index planning, lock ordering, timeout policy and retention need isolated production-like evaluation. Retry ledgers have no new retention/rate-control programme.
6. **Downtime is partial:** stale indicators and retry IDs support transient transport failures; no offline clinical-write queue or reconciliation workflow exists. Lost client retry keys do not prevent all duplicate real-world requests. Polling revocation clears on the next denial rather than pushing instantaneous revocation to the browser.
7. **Interface/security follow-up:** full accessibility, clinical usability, managed wall-device/session/cache/TLS policy and department-level restrictions remain. Existing legacy permission/UI and dependency-audit findings in earlier reports are not declared resolved. No dependency audit/remediation was performed in 3B. Configuration-capable staff may need additional roster governance before pilot use.
8. **History and ownership:** no historical encounter state, patient UUID, audit event or reference was rewritten. Unknown ownership remains quarantined under the existing model. Corrections need audited addenda/supersession, not edits to history. Work underway is operational documentation and does not automatically modify encounter care status or allocate a treatment space.

Before clinical use, hospital staff must approve service definitions/readiness, urgency presentation, professional scope and capability grants, manual review ownership, reassignment/handovers, late entry, exception categories/review and correction policy. Any future protocol or automatic escalation requires separate clinical validation and an explicit activation design.

## Recommendation and next steps

3B is ready for source and hospital-workflow review. It is not approved for clinical operation, hosted migration or production deployment. Do not broaden automated clinical functionality to compensate for missing approvals.

Next, designate and verify an isolated synthetic-only PostgreSQL/Supabase target, inventory its exact schema/migration history, rehearse recovery, review migration impact and obtain approval for that specific execution. Run real user-token Auth/REST/RLS negative tests and independent-session concurrent work-start, space-conflict, retry and revocation tests. Then assess load, device privacy and hospital usability; agree the clinical governance and capability matrix before a controlled pilot.

## INFORMATION FOR CHATGPT — MILESTONE 3C

- Preserve the existing React/Django/Supabase/PostgreSQL stack, 2D protection and uncommitted 3A foundations. New 3B source is not a hosted deployment and is not yet committed.
- The only new 3B migration is `202610150002_necms_coordination.sql`, after the 3A arrival/triage foundation. It ran only in disposable PGlite; original migration files and historical rows remain unchanged.
- Built: hospital service/team/roster/reason catalogues, independent concurrent work, validated transitions, explicit calls/acceptance/start, structured responsibility, manual reassessment/urgent requests, inactive policy references, immutable operational timelines, provisional sequencing evidence/review, retry/audit/concurrency foundations and a protected polling coordination board.
- The tested local baseline is 40 frontend and 90 Django tests, successful build, baseline/hospital/clinical SQL, new coordination SQL (30 assertions/22 negative probes), existing review probes and all listed browser flows. Auth/API browser upstreams are mocked; single-engine SQL is not real concurrency proof.
- No triage rules, automatic clinical priority, escalation timing, medical orders or clinical protocol activation exist. Hospital approval is still required for clinical meaning, staff authority, service readiness, exception review, reassessment/escalation and correction policy.
- 3C should focus on real isolated integration, concurrency/recovery, source review, load/privacy/device/usability evidence and hospital governance. Do not migrate a hosted database, change records, add clinical automation or deploy without separately verified safety and explicit authorisation.
