# NECMS Milestone 3A — Safe Emergency Arrival and Clinical Triage Foundations

Date: 2026-10-15. Branch: `feature/necms-multi-hospital`. Starting tracked baseline: `f625b90`.

## Executive summary

Implemented and locally tested rapid emergency arrival, provisional patient identity, explicit identity completion, append-only assessments/reassessments and vital observations, independent provisional assessment review, clinical timeline, and care/space coordination before completed demographics or triage.

The existing React/TypeScript, Django/DRF, Supabase Auth and SQL-owned PostgreSQL architecture is retained. New application paths remain under NECMS mode and require explicit hospital capabilities. Existing normal registration, board, resources, audit history and Milestone 2D request guards are preserved.

**This is a synthetic-tested software foundation, not a clinically validated triage system.** No hosted migrations, records, authentication settings or deployment were changed. No medical score, SATS mapping, clinical thresholds, reassessment interval, treatment deadline or AI was introduced. Protocol approval/activation is deliberately inactive pending governed clinical design.

## Features implemented

| Feature | Actual behaviour |
| --- | --- |
| Rapid Emergency Arrival | Department and arrival source are required; names/DOB are optional. Server generates arrival UUID/time, patient UUID/reference and encounter UUID. Source supports walk-in, ambulance, referral and other; referring facility is optional text. |
| Immediate care | Staff can record care already underway without supplying names, DOB, complaint or priority. Encounter can be in treatment while still Not Yet Triaged. The UI explicitly tells staff not to wait for the form before providing urgent care. |
| Provisional identity | Missing name components remain NULL. A server-generated TMP UUID alias accompanies the existing PF reference format. No placeholder name, DOB, complaint or priority is inserted. |
| Identity completion | Dedicated reconciliation requires capability, patient version, confirmed names and a reason; DOB may remain unknown. Original patient/encounter UUIDs, PF reference, temporary alias and history survive. Immutable before/after reconciliation records are retained. |
| Duplicate protection | Matching another same-hospital name/DOB blocks completion for separate review. There is no silent merge, cross-hospital identity search, demographic matching algorithm or operational merge endpoint. |
| Awaiting Triage | Separate list includes active legacy encounters without structured triage, new unassessed arrivals and assessments awaiting review; care-underway status remains independently visible. |
| Structured assessment | Complaint, labelled observation text map, seven kinds of vital observations, clinician-entered provisional P1–P5 priority, notes, optional approved-version link, assessor identity and server timestamp. Initial and reassessment records remain distinct. |
| Review/sign-off | Independent reviewer records accepted/rejected decision, actor/time and mandatory rationale in a separate immutable record. Acceptance records provisional manual urgency on the encounter; it does not approve a clinical protocol. |
| Priority amendments | Changing an already reviewed provisional priority requires priority.amend as well as review authority. Legacy priority changes through the old save API also require priority.amend. No new capability is automatically granted. |
| Care without demographics/triage | Dedicated care operation changes care status, next service, clinician text, location and space under existing encounter-update permission. It never requires or changes demographic identity or priority. Version/occupancy/hospital checks remain enforced. |
| Clinical timeline | Server-ordered arrival, registration, identity reconciliation, assessment, reassessment, review, priority and encounter-status events; administrative, clinical and generic encounter activity are distinguished. Controlled old/new status/priority details are returned instead of raw audit snapshots. |
| Tracking board | Shows Not Yet Triaged, legacy/unvalidated or provisional urgency source, provisional identity, elapsed time since server-recorded arrival and latest completed provisional assessment time. |

An accepted review produces `completed_provisional`, not a claim of validated or protocol-approved triage. The underlying assessment remains an immutable `recorded` row; its review is a separate event. The UI and API preserve this distinction.

## Database changes and migration status

New migration: `supabase/migrations/202610150001_necms_arrival_triage_foundations.sql`.

**Execution:** applied and transactionally rolled back/reapplied only inside fresh in-memory PGlite databases with synthetic Auth/roles and fictional fixtures. Never executed against hosted Supabase. The eight existing migration files remain unchanged.

New tables:

- `emergency_arrivals`: hospital/department/patient/encounter, server time, source/referrer, identity status at arrival, immediate-care report, actor and idempotency key/hash. One arrival per encounter.
- `identity_reconciliations`: immutable patient identity before/after, actor/time/reason.
- `triage_protocol_versions`: hospital/identifier/version, approval and activation status, effective dates and clinical approval metadata. Application-created records are drafts/inactive.
- `triage_assessments`: immutable assessor/time, encounter, initial/reassessment kind, complaint/observations, manual provisional priority, notes, protocol reference and retry key/hash.
- `vital_observations`: immutable kind, measurement availability state, typed values, units, observation/recording timestamps and actor, linked to an assessment.
- `triage_reviews`: immutable assessment/encounter-linked reviewer/time, accepted/rejected decision and rationale; one review per assessment.

Existing tables extended:

- `patients`: identity_status and temporary_identifier; name columns allow NULL for explicit provisional identity. Confirmed identity still requires both names. Existing rows retain confirmed status without invented assessments.
- `visits`: nullable legacy priority/complaint for rapid arrival; triage_state, clinical_urgency, urgency_source and latest_assessment_at. Existing rows default to legacy_unassessed/legacy_unvalidated without overwriting priorities or clinical history.
- `visit_board`: recreated as an invoker view to include added fields and identity indicators; existing RLS authority retained.
- `save_visit`: same public signature retained, with a restricted legacy implementation underneath. Provisional identity cannot be completed through normal registration/editing, and legacy priority amendments have a separate permission check.

Composite foreign keys bind new clinical records to the same hospital and verified patient/encounter ownership. New tables have RLS and default-deny writes. Application users cannot UPDATE/DELETE clinical history; append-only triggers also reject accidental owner UPDATE/DELETE. Supporting indexes enforce single initial assessment, unique observation kind per assessment, retry identity and scoped protocol versions.

Arrival retries serialise on hospital/actor/request ID and compare canonical payload hash before creating identity/encounter/event. Assessments use actor/request IDs, encounter row locking and version checks. Identity completion uses patient locking/version checks and matching-identity serialisation. These mechanisms were tested sequentially in embedded PostgreSQL; real parallel-session lock behaviour remains unverified.

Six-table preservation snapshots cover original patient/visit/audit/resource columns and both migration archives before/after the new migration and rollback rehearsal. Unknown hospital ownership remains pending/quarantined under existing rules, never assigned automatically.

## API endpoints

All below use `/api/necms/hospitals/<hospital_id>/`, bearer authentication and validated X-NECMS-Context. Django forwards the user token; PostgreSQL independently authorises each function.

| Endpoint | Method | Permission and behaviour |
| --- | --- | --- |
| `arrivals/` | GET | arrival.register; active departments available for rapid intake |
| `arrivals/` | POST | arrival.register; required retry UUID, server-owned hospital/time, optional demographics |
| `patients/<patient_id>/reconcile/` | POST | identity.reconcile; patient version and reason required; no merge target accepted |
| `visits/<visit_id>/assessments/` | GET | triage.read, plus encounter.read in SQL; assessment/vital/review history |
| `visits/<visit_id>/assessments/` | POST | triage.create or triage.reassess according to kind; encounter version and retry UUID |
| `assessments/<assessment_id>/review/` | POST | triage.review; independent reviewer, encounter version and rationale; priority.amend for changing an existing provisional urgency |
| `visits/<visit_id>/timeline/` | GET | clinical.timeline.read and encounter.read; curated event projection |
| `visits/<visit_id>/care/` | POST | encounter.update_legacy; status/service/location/clinician/space without identity or priority changes |
| `triage-protocols/` | POST | protocol.admin; draft identifier/version only; no approval/activation fields accepted |

Malformed arrays/JSON, invalid observations and unexpected ownership/approval fields are rejected. Existing 401/403/409 and unexpected-error behaviour remain intact. Protocol approval/activation endpoints are intentionally absent.

## Interface and files changed

The current design language is extended with a responsive clinical panel, rather than replacing the application. Native forms/buttons, explicit labels, keyboard activation, focus outlines, loading/disabled states, retry errors and textual urgency/identity labels are used. Observation history is displayed as readable values and timestamps, not raw record JSON. Original restricted display projection is unchanged.

| Change | Files |
| --- | --- |
| New clinical API/serializers and tests | `backend/patients/clinical_views.py`, `backend/patients/test_clinical.py` |
| Route integration | `backend/config/urls.py` |
| New clinical interface | `src/ClinicalWorkspace.tsx`, `src/clinical.css` |
| Board/legacy compatibility | `src/App.tsx`, `src/model.ts`, `src/lib/store.ts` |
| Observation validation/tests | `src/lib/clinical.ts`, `src/lib/clinical.test.ts` |
| Migration and synthetic SQL fixtures | `supabase/migrations/202610150001_necms_arrival_triage_foundations.sql`, `supabase/tests/arrival_triage.sql` |
| Isolated SQL/browser checks | `scripts/check-clinical-database.mjs`, `scripts/check-clinical-browser.mjs` |
| Aggregate runner | `scripts/run-isolated-checks.ps1` now includes the clinical SQL suite |
| Completion report | `docs/architecture/NECMS_3A_COMPLETION_REPORT.md` |

The pre-existing untracked current-state assessment document was preserved, not rewritten as part of 3A. Dependencies, environment files and existing migrations/tests were not modified. Source changes are left reviewable on the existing feature branch; no commit, push or deployment was performed in this milestone.

## Capabilities and clinical safety boundaries

Ten capability identifiers are added without assigning any to existing roles:

`arrival.register`, `identity.reconcile`, `triage.read`, `triage.create`, `triage.review`, `triage.reassess`, `priority.amend`, `protocol.admin`, `protocol.approve`, `clinical.timeline.read`.

New protected writes require a provisioned staff profile for attributable identity. No profile, role or clinical authority is fabricated. Profile global role does not replace hospital capabilities. Fixture grants apply only to synthetic test roles.

Protocol administration can create drafts only. Approval/activation metadata and integrity constraints exist, but **a governed clinical approval/activation process is not implemented**. protocol.approve is reserved, not an active approval route. Draft protocols cannot be linked as active protocols in assessments. No thresholds or sample clinical protocols are seeded. A future owner-level migration is not itself evidence of qualified clinical approval.

Vital validation concerns recording formats and basic physical limits, not normal ranges or urgency thresholds: finite nonnegative rates/pressures; systolic not below diastolic; saturation percentage 0–100; Celsius above absolute zero; explicit numeric 0–10 pain recording format; consciousness as observed text. Unknown/unavailable/not-measured values contain no substituted numbers. An explicitly measured zero rate is representable; it does not generate a diagnosis or recommendation. Clinical plausibility ranges, approved pain/consciousness scales and any supported protocol still require hospital review.

Manual P1–P5 entries remain legacy/unvalidated labels. Review acceptance copies an explicit clinician-entered provisional value to a separate clinical_urgency field; it never computes urgency from vital signs, converts to SATS or overwrites the historical legacy priority. New unassessed arrivals have NULL priority, remain visibly untriaged and receive no invented numbered priority queue position. A reviewed provisional value can influence existing display ordering, but the software never selects treatment or enforces a medical care sequence.

The independent-review restriction is a conservative provisional software control, not an assertion that a hospital has approved the staffing model. No licence/credential registry or professional scope verification is implemented.

## Security and audit protections

- Every clinical operation validates hospital context and capability in Django and PostgreSQL. A browser hospital ID never grants access.
- Fixed-search-path security-definer RPCs have explicit checks; internal actor/audit/history helpers and the underlying legacy save function are not executable by normal application roles. Anonymous access is denied.
- Existing policies are not weakened. New RLS permits scoped reads only; normal writes run through constrained RPCs. Private or pending ownership is not promoted.
- Encounter/patient versions reject stale writes; composite keys and resource locking preserve hospital and occupancy boundaries.
- Clinical/arrival/reconciliation history is append-only. Reviews and reassessments add records rather than overwriting prior observations.
- Actor IDs, hospital, timestamps and operations are retained. Audit failure rolls assessment creation and encounter changes back together. Milestone 2D atomic resource auditing remains in place.
- Clinical requests share the 2D protected-view lifecycle, cancellation and denial handling. Selection, encounter versions, capability changes, hospital switching and logout invalidate pending clinical reads. Explicit 401/403 clears the protected parent view.
- Restricted wall display receives the existing server projection; no additional clinical tables were added to raw realtime publications. Raw clinical subscriptions remain disabled.

## Tests executed and results

All tests used synthetic fixtures, unreachable hosted settings, disposable embedded PostgreSQL or mocked local browser routes. No real patient information was copied or tested.

| Check | Actual result | Boundary |
| --- | --- | --- |
| Frontend Vitest | **32 passed, 0 failed**, four files: model 13, API 7, protected requests 6, clinical 6 | Unit tests, not clinical validation |
| Django discovery | **70 passed, 0 failed**; 17 new clinical tests added to the previous 53; system check clean | Real Django validation/permissions; Auth/Data API mocked |
| TypeScript/Vite build | **Passed** | Final JS chunk about 505.52 kB; >500 kB warning remains; no deployment |
| Original database checks | **Passed**, script exit 0 | Existing normalization, roles, versions, references, audit, discharge and resource conflicts |
| Existing hospital SQL suite | **Passed**, script exit 0 | Isolation, revocation, retry/version conflicts, preservation and atomic resource audit |
| New clinical SQL suite | **32 named positive/integrity assertions + 25 expected-error probes passed**; additional runner preservation/rollback/no-auto-grant assertions passed | Embedded PostgreSQL with synthetic Auth; no real parallel sessions |
| Existing database review | **5 checks passed**, 0 failed | Original publication removal/preservation/RLS/function-grant/audit checks; not managed Realtime |
| Original demo browser | **Passed**, script exit 0 | Registration, editing, space allocation, persistence, discharge, activity, filters, display privacy, mobile and duplicate validation |
| Existing hospital browser | **Default plus connection, slow-denial, delayed-display, multiple-pending-switch and logout modes passed** | Real Edge/React; Django/Auth and network failures mocked |
| New clinical browser | **Passed**, script exit 0 | Keyboard rapid arrival, unknown identity, care underway, same-key retry after simulated transport failure, space allocation before triage, awaiting state, vital rejection, assessment creation, reconciliation, timeline, role restrictions, mobile panel bounds, hospital clearing and logout with pending arrival |

SQL negative cases include forged/cross-hospital departments/encounters/observations/spaces, revoked membership, self-review, missing amendment authority, stale patient/encounter versions, inactive protocol linkage, changed retry payload, immutable history mutation/deletion, attempted helper execution, legacy identity-completion bypass, possible duplicate completion and anonymous RPC calls. An injected assessment-audit failure verifies that neither the assessment nor encounter version partially commits.

No tests were disabled or marked expected-failure to obtain these results. Relevant development failures were repaired: nullable-model TypeScript incompatibility; missing explicit select accessible labels; a newly introduced text separator encoding problem; success feedback cleared by version refresh; and synthetic fixtures that used a cleaning space or failed to increment the encounter version. The history assertion was corrected to inspect its containing record. Clinical SQL and browser checks were rerun after those corrections.

Reproduction, using already installed dependencies only:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/run-isolated-checks.ps1
node scripts/check-hospital-review.mjs
node scripts/check-clinical-database.mjs

# Terminal 1: mock-only NECMS preview
node scripts/start-necms-test.mjs
# Terminal 2:
node scripts/check-clinical-browser.mjs
node scripts/check-hospital-browser.mjs
# Other hospital browser modes use the existing NECMS_REVIEW_* flags.

# Separate fictional-only legacy preview:
node scripts/start-demo.mjs
# Another terminal:
$env:PREVIEW_URL='http://127.0.0.1:5174'
node scripts/check-browser.mjs
```

Never substitute a hosted environment or ordinary environment-loaded dev server for the synthetic previews. Test builds are not deployment builds. Owned preview processes were stopped after verification.

## Remaining limitations and hosted blockers

1. **No hosted verification or execution.** Supabase project isolation, exact schema/history, real Auth/REST/RLS behaviour, managed configuration and backup/restore remain unverified. 006/007 and the new migration require reviewed compatibility/provenance/recovery and explicit execution approval before any hosted application.
2. **No approved clinical workflow.** Protocol approval/activation, clinically governed categories/criteria, professional authority, exceptions and independent-review policy remain for 3B. Accepted assessments are explicitly provisional, not approved triage.
3. **No real concurrency demonstration.** Row/advisory locks, uniqueness and stale-version checks run in embedded PostgreSQL, but simultaneous connections, revocation during writes and lock/deadlock recovery still need isolated integration testing.
4. **Arrival time means server-recorded arrival capture.** Care may have begun before data entry. No exact earlier intervention time or late-documentation correction workflow is claimed; browser clocks do not supply authoritative arrival timestamps.
5. **No merge or full identity matching.** Same-name/DOB collision is a conservative block, not proof of identity. Twins/false matches and duplicate arrivals require a separately governed review/merge process. New-session/lost retry keys do not provide demographic deduplication.
6. **No offline clinical synchronisation.** Existing retry/error behaviour remains; durable downtime intake, offline encrypted storage and reconciliation are not implemented. Polling cannot instantly reveal revocation during a complete outage.
7. **Limited operational model.** Clinician remains text, one next service remains, department transfer/shift handover/task/escalation/approved waiting targets and analytics are not added. No clinical treatment decisions are automated.
8. **Scale and interface follow-up.** Assessment/timeline history and hospital patient choices are not newly paginated/searched; large-volume/load testing remains. The build's chunk-size warning remains. Mobile bounds/keyboard use were tested, not full assistive-technology or clinical usability certification.
9. **Existing findings remain.** Legacy register/update UI capability conflation, older encoding defects, department-limited access, context/retry retention/rate controls, kiosk/device/TLS/cache policies and previously reported dependency audit findings remain outside 3A. No new dependency audit/remediation was performed.
10. **Review and correction policy.** History is immutable and no deletion/correction/retirement UI is supplied. A future audited addendum/supersession process must preserve evidence. Draft protocol records cannot be edited/activated through this foundation; create a new version and await governed workflow.

## Clinical decisions requiring hospital approval

- Approved triage protocol/version, patient populations, observation formats/units, clinical plausibility checks and any urgency vocabulary beyond explicitly unvalidated P1–P5.
- Which staff may register arrivals, reconcile identity, assess, reassess, review, amend priority, administer drafts and approve protocols; whether independent review is feasible and appropriate.
- What counts as completed approved triage, how provisional findings are presented, and when a suggested score would be permissible after validation.
- Unknown identity and wristband/temporary-alias policy, duplicate review/merge authority, late documentation and correction rules.
- Reassessment intervals, deterioration/escalation recipients, acknowledgement, resource suitability, exceptions and waiting targets. None were invented here.
- Department scope, clinical display audience, retention, downtime, transfer and handover responsibilities; pilot acceptance owner.

## Recommendation

3A is complete as a locally tested arrival and provisional assessment foundation. It is ready for technical/clinical design review, not clinical operation or hosted deployment. The next milestone should establish the approved workflow and run real isolated integration/security/concurrency/recovery verification before expanding clinical coordination.

## INFORMATION FOR CHATGPT — NEXT MILESTONE

- Preserve React 19/TypeScript/Vite/Tailwind, Django 6/DRF, Supabase Auth, user-token Data API access and SQL/RLS authority. No new runtime framework or Docker dependency was introduced.
- New migration is `202610150001_necms_arrival_triage_foundations.sql`; prior eight files remain intact. All execution was disposable PGlite only. Hosted identity/schema/recovery/execution approval remains mandatory.
- New entities: emergency arrivals, identity reconciliation history, protocol-version drafts, assessments, vital observations and reviews. Assessments/reviews are append-only; completed provisional state is derived onto the encounter, without replacing legacy priority.
- Rapid arrival and care allocation do not require complete identity or triage. Unknown demographics/priority stay NULL. Patient UUID, encounter UUID, PF reference and temporary alias survive reconciliation. No automatic merge exists.
- Ten new capabilities have no default grants. Django and PostgreSQL check them independently; normal care updates retain encounter.update_legacy. Protocol administration creates inactive drafts; protocol.approve is reserved pending governance.
- Vital observations are timestamped and structured, with availability states and format/physical-limit checks only. No scoring thresholds, normal ranges, automatic urgency, SATS mapping, reassessment interval, escalation deadline or AI exists.
- UI adds rapid arrival, awaiting-triage list, clinical assessment/history, reconciliation, independent review, care-before-triage and chronological controlled timeline. 2D cancellation/epoch guards and restricted display boundaries remain in place.
- Actual results: 32 frontend and 70 Django tests pass; build passes with a chunk warning; existing database/browser checks pass; new SQL has 32 named assertions and 25 negative probes; clinical browser workflow passes. Browser upstreams/Auth are mocked and SQL concurrency is not multi-session.
- Milestone 3B must obtain qualified hospital approval of protocol versions, staff scope, review/activation and correction policy, provisional urgency meaning, care-order exceptions, reassessment/escalation rules, service readiness, pilot scope and acceptance criteria. Validate real Auth/REST/RLS, concurrency, devices, privacy and recovery in an explicitly approved isolated project. Do not interpret this report as permission to migrate or deploy.
