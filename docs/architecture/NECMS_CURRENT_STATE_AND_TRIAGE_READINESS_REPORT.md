# PatientFlow / NECMS — Current State and Triage Readiness Report

Assessment date: 2026-10-15. Repository baseline: `f625b90`, branch `feature/necms-multi-hospital`.

## Executive summary

PatientFlow is an operational emergency department tracking prototype. NECMS adds hospital isolation, capability-based access, restricted displays and security remediation in source code. These are useful foundations, but the repository does not yet implement a clinically approved triage or emergency booking platform.

For the client's problem, the software **displays patients in manually assigned P1–P5 order, then arrival order**. It does not establish whether the assigned priority is clinically correct, require the next patient treated to be first in that order, or capture a mandatory explanation for treating someone else first. It therefore cannot yet demonstrate that greater clinical urgency reliably receives appropriate attention.

The next design needs approved clinical assessment and reassessment, safe arrival before complete registration, explicit care events and accountable deviations from the displayed order. A television workflow is context for discovery, not a clinical specification.

This assessment inspected source, eight migrations, tests, configuration and architecture reports. No application, test, dependency, schema or hosted changes were made. Only this document was created. Tests were **not rerun** for this assessment; reported passes below are the recorded Milestone 2D results, checked against the existing test implementations. No credentials or patient-level hosted data were accessed.

## 1. Evidence and implementation status

Status terminology:

- **Implemented:** present in executable application or migration source; does not imply hosted deployment.
- **Locally tested:** prior recorded execution using synthetic fixtures, embedded PostgreSQL or mocked upstream services.
- **Partial:** some fields/controls exist, but the operational workflow is incomplete.
- **Planned/missing:** no implementation found in the inspected application/schema.
- **Hosted unverified:** no current managed-project evidence establishes deployment, configuration or behaviour.

Important source references used throughout:

| Ref | Source and relevant entry point |
| --- | --- |
| S1 | `src/model.ts:1` priorities/statuses/services; `:13` legacy roles; `:31` compareVisits; `:32` queuePosition; `:38` waitLabel; `:42` validation |
| S2 | `src/App.tsx:15` authentication; `:73` Board; `:93` canEdit; `:128` polling; `:170` board rows; `:201` VisitDialog; `:260` handover notes |
| S3 | `src/lib/store.ts:5` feature flag/routing; `:34` demo storage; `:63` loadBoard; `:67` saveVisit; `:109` setResourceState |
| S4 | `src/HospitalWorkspace.tsx:6` hospital selection; `:40` RestrictedDisplay; `:64` HospitalStaff |
| S5 | `src/lib/api.ts:4` user-token requests; `src/lib/protectedRequests.ts:4` lifecycle guard |
| S6 | `backend/config/settings.py:26` no ORM database; `:31` NECMS flag; `:33` DRF defaults; `backend/config/urls.py` all routes |
| S7 | `backend/patients/authentication.py:16` SupabaseAuthentication; `gateway.py:21` request_supabase; `gateway.py:62` legacy staff_role |
| S8 | `backend/patients/views.py` legacy endpoints; `serializers.py:15` VisitInputSerializer; `exceptions.py` response/error handling |
| S9 | `backend/patients/necms_views.py:14` object_body; `:32` hospital_context; `:53` contexts; `:92` visit; `:115` resource; `:124` staff; `:141` configuration |
| S10 | `supabase/migrations/202610130001_initial.sql` original visit/resource constraints, audit trigger and sample spaces |
| S11 | `supabase/migrations/202610140001_normalize_names.sql:9` patients; `:31` active-visit uniqueness; `:54` invoker view; `:63` audit; `202610140004_patient_date_of_birth.sql:4` age archive |
| S12 | `supabase/migrations/202610140005_auto_patient_references.sql:8` next_patient_reference; `:21` legacy save_visit |
| S13 | `supabase/migrations/202610140006_necms_hospital_isolation.sql:6` entities; `:63` ownership; `:99` context; `:121` require; `:172` RLS; `:196` board; `:220` display; `:237` memberships; `:256` config; `:283` save_visit; `:402` audit |
| S14 | `supabase/migrations/202610140007_necms_resource_audit_integrity.sql:4` atomic set_resource_state |
| S15 | `src/model.test.ts`, `src/lib/api.test.ts`, `src/lib/protectedRequests.test.ts`; Django `tests.py`, `test_necms.py`, `verify_necms_requests.py`, `test_migrations.py`, `test_demo_seed.py`, discovery wrapper |
| S16 | `supabase/tests/*.sql`; `scripts/check-database.mjs`, `check-hospital-database.mjs`, `check-hospital-review.mjs`, `check-browser.mjs`, `check-hospital-browser.mjs`, `run-isolated-checks.ps1` |
| S17 | `docs/architecture/NECMS_2D_COMPLETION_REPORT.md:79` recorded execution results; `NECMS_2C_COMPLETION_REPORT.md` integration gaps |
| S18 | `backend/patients/management/commands/apply_supabase_migrations.py`, `.env.example`, `.gitignore`, `vite.config.ts`, `package.json`, `backend/requirements.txt` |

## 2. Architecture and technology

Connected data flow: **React browser → Django REST API → Supabase Auth / user-scoped Data API → PostgreSQL functions, constraints and RLS.** Supabase sign-in occurs in the browser. Django verifies the bearer token with `/auth/v1/user`, then forwards that same user token and a publishable key. Runtime clinical requests do not use an owner/service-role credential. [S3, S5–S9]

The frontend uses React 19, TypeScript, Vite, Tailwind and Lucide. It renders registration/editing, board, service filters, resources, history, activity, hospital selection and display views. Framework declarations are in `package.json`; backend requirements specify Django 6.0 and Django REST Framework. Django handles authentication, validation, hospital/capability enforcement, response shaping and upstream errors. It is not an ORM-based patient store: the default Django database engine is dummy; PostgreSQL application tables are SQL-migration owned. Psycopg is used by migration tooling. [S2–S9, S18]

Without Supabase configuration, a separate fictional demo stores data in browser localStorage. Connected clinical data is not deliberately persisted through that demo storage path. Demo behaviour is not proof of multi-device or hosted behaviour. [S3]

NECMS requires separate frontend/backend feature flags, default false. When the backend flag is enabled, legacy unscoped clinical endpoints reject requests. Feature flags are rollout controls, not a substitute for correctly deployed RLS/functions. [S3, S6, S8, S18]

Current updates use polling: five seconds for NECMS clinical/display views and 30 seconds for the legacy board, plus manual/event-triggered refresh. No clinical websocket subscription is created by the current board. Migration 006 removes patients/visits/resources from the clinical publication. Older README realtime descriptions are superseded by executable source. Cancellation and lifecycle epochs block stale replies across denial, hospital changes and logout. [S2, S4, S5, S13]

Local source and synthetic verification are evidenced. Hosted application deployment, currently running services, actual applied migration history and managed-project configuration were not established. Reports record 006/007 execution only in disposable databases. A configured project URL does not establish isolation or deployment status. [S17]

## 3. Existing database architecture

Eight ordered SQL files exist: initial schema; name/identity normalisation; nurse/surgeon roles; nurse coordination; DOB; automatic references; hospital isolation (006); resource-audit fix (007). Their presence is not evidence they were applied to Supabase. [S10–S14]

| Entity | Actual responsibility and relationships |
| --- | --- |
| `patients` | UUID identity, reference, first/last name, optional DOB, name-review flag and version; referenced by multiple visits |
| `visits` | Encounter UUID, patient FK, complaint, integer priority, care status, one next_action, free-text location/assigned_to/notes, optional resource FK, arrival/update times and version |
| `resources` | Space UUID, name, kind and available/cleaning/unavailable state; occupancy derived from active visits |
| `staff_profiles` | Auth-user-linked identity and legacy role; not the NECMS hospital capability authority |
| `audit_events` | Actor ID/label, action/time, encounter/patient association, summary and protected before/after snapshots |
| Name/age archives | Restricted preservation of legacy values; old ages do not become invented birth dates |
| `hospitals`, `departments` | Facility identity/type/timezone and hospital-owned department definitions |
| `hospital_roles`, `capabilities`, `role_capabilities` | Hospital-specific role names mapped to explicit capabilities |
| `hospital_memberships` | User/hospital/role, active flag, validity expiry and authorisation version; one membership per user/hospital |
| `hospital_configuration` | Versioned operational settings, currently language and display_enabled only |
| Private `access_contexts` | Opaque user/membership/hospital/purpose-bound authorisation contexts, 15-minute default expiry |
| Private `registration_requests` | Hospital/user/request UUID and payload hash/result for registration retries |
| Private `ownership_reviews` | Ownership evidence/disposition scaffolding; no completed reconciliation workflow |

The main relationships are hospital → patients → encounters; hospital → departments/resources; user → memberships → hospital roles → capabilities. Composite foreign keys enforce compatible verified hospital ownership for encounter/patient/resource/audit relationships. Hospital patient references and resource names are unique within verified ownership; UUIDs remain unchanged. The reference generator remains a shared sequence. There is no national shared-patient index or cross-hospital identity merge. [S11–S14]

Priority, care status and location are separate fields, but this is only partial clinical separation: priority is not a versioned assessment; location is text plus an optional space assignment; movement/occupancy periods are not first-class historical records. Department columns exist but the encounter editor/save RPC do not provide department routing. [S1, S2, S13]

Unknown historical ownership defaults to pending with null hospital ID. Pending/quarantined records are not exposed by normal NECMS hospital policies. This preserves records without inventing provenance, but cutover before ownership review could hide active-care records. There is no implemented administrative reconciliation UI. [S13]

## 4. Current patient journey

| Step | What actually happens | Manual, simulated or missing |
| --- | --- | --- |
| Arrival | No record exists until staff save registration; arrived_at defaults to database time | No separate physical-arrival event, ambulance notification, referral intake or pre-arrival booking |
| Registration | VisitDialog collects names, optional DOB, complaint and required priority; existing hospital patient may be selected | Names and valid P1–P5 must be supplied; unknown identity/incomplete-registration care is not supported as a dedicated workflow |
| Reference | save_visit calls next_patient_reference for a new identity; PF-style reference and UUID generated | Existing references reused/preserved; gaps are possible; no demographic duplicate matching |
| Priority | Authorised editor manually selects P1–P5 | No assessment form/protocol/version/confirmation; ability is not restricted to a separate qualified-triage capability |
| Waiting | waiting/ready encounter with next_action participates in calculated service position | No separate queue-entry record, call-next, acceptance or reservation |
| Clinician | Staff type assigned_to | No staff FK, roster, availability, assignment acceptance or ownership team |
| Space | Staff choose an available resource; SQL locks/checks and unique index prevent conflicting active assignments | No clinical suitability matching, theatre scheduling or staff/equipment readiness checks |
| Service change | Staff edit next_action/status/location or resource and save | One current service replaces the previous value; no concurrent orders/tasks or per-service completion events |
| Deterioration | Staff can manually change priority/status and add notes | No structured reassessment, vital observations, alert, escalation recipient/acknowledgement or deadline |
| Discharge/transfer | Staff select terminal status; resource cleared, encounter retained in history | No mandatory disposition record, destination/receiving acceptance, transfer package or dedicated immutable departure time |

Entry points: VisitDialog and store.saveVisit [S2, S3], legacy create/update endpoints [S8], NECMS visit endpoint [S9], and latest SQL save_visit [S13]. Encounter status values are validated, but no clinical state-transition workflow or prerequisites are enforced. Treatment state can be set directly by an authorised editor.

## 5. Emergency booking and queueing

**Pre-arrival patient booking:** absent. There is no public patient portal, appointment/booking entity or booking API. **Reception emergency booking:** absent as a separate operation; staff with broad encounter permission can create the existing encounter. No receptionist-specific role separates administrative intake from clinical priority assignment. Walk-ins can be entered generically, but walk-in/ambulance/referral mode and provenance are not structured. [S1, S6, S8, S9]

**Care before complete registration:** not implemented digitally. The form, serializer and SQL require identifying names and priority. Optional DOB helps partial identity capture but is not an unidentified-patient pathway. This describes a software limitation, not a requirement to delay actual emergency care. [S1, S2, S8, S13]

**Ordering:** compareVisits sorts ascending priority, ascending arrived_at, then UUID. queuePosition includes only active waiting/ready encounters with the same next_action; none has no queue. Priority therefore precedes arrival within these displayed queues. Position is computed from loaded data, not a persisted hospital-wide scheduling commitment. The NECMS board SQL also orders active encounters by priority/arrival. [S1, S13:196; tests S15]

**Services:** assessment, imaging, laboratory, treatment, surgery, admission and none. There are no separate doctor/nurse/lab-worklist entities, staff-pool routing or multiple simultaneous service requests. Awaiting-results and in-treatment encounters are excluded from queuePosition even if their next_action names a service. [S1]

**Overrides:** authorised editors may change priority or begin treatment for any editable encounter. Updates are audited with old/new encounter snapshots, so a priority change is recoverable administratively. No mandatory override reason, senior approval, distinct priority-change event or explanation of out-of-order treatment is required. Frontend audit summaries do not provide a full clinical rationale. [S2, S8, S13:283, S13:402]

**Immediate highlighting:** assigned P1/P2 counts and coloured priority badges exist after successful save/refresh. This is visual emphasis, not deterioration detection or a reliable emergency notification; NECMS updates normally wait for polling. [S2:163, S2:172]

**Why a lower-priority patient was treated first:** free-text notes and snapshots may offer clues, but the system cannot reliably reconstruct which patients were clinically competing at that moment, their eligibility/resources, or the decision rationale. It does not detect an inappropriate decision simply from queue order. **Waiting-delay detection/reporting:** elapsed ED time exists, but no approved wait targets, time-to-first-clinician measure, reassessment timer, threshold notification or breach report. Completed encounters use updated_at as the elapsed-time endpoint; later edits can change it, so it is not an immutable departure or untreated-wait measure. [S1:38, S2:177]

## 6. Clinical triage readiness

| Capability | Finding |
| --- | --- |
| Structured clinical assessment | Missing; complaint and general notes only |
| Presenting complaint | Implemented free-text field, maximum 300 characters |
| Vital signs with observation times | Missing schema, UI and API |
| Urgency classification | Integer 1–5 with illustrative labels/colours only |
| SATS or another approved protocol | No implemented protocol definition, clinical criteria or validation evidence |
| Protocol versioning | Missing; operational configuration versions are not clinical protocol versions |
| Suggested priority calculation | Missing; no medical score or AI triage |
| Clinician review/confirmation | Saving a manual priority exists; separate assessment review/sign-off absent |
| Reassessment history | Generic audit snapshots exist; independent structured reassessment records do not |
| Deterioration/escalation | Manual edits only; no detection, delivery, recipient or acknowledgement workflow |
| Overdue reassessment | No deadlines or notification machinery |
| Triage-change audit | Generic encounter before/after snapshots; no dedicated assessment rationale/protocol/assessor record |

Evidence: complete active encounter fields and validation [S1, S2, S8], SQL entities/functions [S10–S14], and route inventory [S6]. P1–P5 must not be represented as SATS categories or a validated triage scale. Any future suggested classification requires hospital-approved criteria, versioning, qualified review and validation; clinical decision authority remains with healthcare professionals.

## 7. Emergency department operations and gap analysis

Priority labels below are development priorities: **Gate** must precede live use; **High** addresses the client's core workflow; **Next** follows those foundations. They are not patient triage categories.

| Capability | Current implementation | Evidence | Missing functionality | Risk | Recommended priority |
| --- | --- | --- | --- | --- | --- |
| Safe arrival/intake | Combined identity and encounter form | S2, S8, S13 | Unknown identity, arrival mode/time, rapid intake, safe reconciliation | Urgent care absent from board until form complete | High |
| Clinical triage | Manual illustrative priority | S1, S2 | Approved protocol, structured assessment, assessor/sign-off/version | Incorrect labels may appear authoritative | High |
| Priority-aware queues | Per-service waiting/ready ordering | S1:31 | Eligibility/readiness, call/accept events, accountable deviations | Display order cannot ensure correct care sequence | High |
| Reassessment/escalation | Priority/notes editable | S13:283 | Repeated assessments, due times, urgent acknowledgement | Deterioration can go unnoticed digitally | High |
| Live board | Polling, filtering, status/location/priority | S2, S4 | Managed end-to-end verification, freshness policy | Delayed or stale operational picture | Gate |
| Multiple service queues | One next_action and filters | S1 | Parallel requests, doctor/nurse worklists, task owner/completion | Outstanding work obscured or overwritten | High |
| Bed/resuscitation management | Generic spaces including resus, occupancy conflicts | S10, S13, S14 | Capability/suitability, equipment/staff readiness, location history | Available does not mean clinically suitable | High |
| Operating room availability | Generic theatre resource/state | S10, S3 | Case schedule, theatre team, turnaround/readiness and reservations | Space indicator mistaken for full surgical capacity | Next |
| Clinician assignment | Free-text assigned_to | S2, S8 | Verified staff/team FK, shifts, acceptance, cover | Ambiguous responsibility | High |
| Clinical tasks | General notes and one next action | S1 | Concurrent assignments, due/completion/cancellation events | Missed or duplicated work | High |
| Department transfers | Department tables/optional columns | S13:11 | Routing UI/API, movement events, receiving acceptance | Location/status changes mistaken for completed handover | Next |
| Hospital transfers | transferred status only | S1, S13 | Destination, consent/policy, transfer linkage and receipt | No continuity across hospital boundary | Next |
| Shift handover | Free-text handover notes | S2:260 | Outgoing/incoming team, structured items and acknowledgement | No confirmed transfer of responsibility | High |
| Waiting-time monitoring | ED elapsed display | S1:38, S2:177 | Service waits, first assessment/treatment timestamps, approved targets | ED duration confused with untreated waiting | High |
| Waiting escalation | None | S1, S13 | Approved timers, recipient/acknowledgement, breach handling | Long waits not actively managed | High |
| Hospital settings | Versioned language/display_enabled API | S9:141, S13:256 | Settings UI, approved clinical configuration; language rendering not implemented | Configuration mistaken for protocol support | Next |
| Reporting/analytics | Four operational counts, recent activity/history | S2, S13:196 | Validated metrics, historical intervals, reports/export permissions | Cannot substantiate prioritisation outcomes | Next |
| Multi-hospital security | Context/capability/RLS/composite FKs | S9, S13 | Real Auth/REST/concurrency verification, departmental scope | Source isolation not demonstrated in hosted operation | Gate |
| Recovery/connectivity | Retry/errors, synthetic rollback checks | S5, S16, S18 | Restore drill, downtime reconciliation, device/cache policy | No verified clinical continuity during outages | Gate |

## 8. Staff roles and permissions

### Legacy PatientFlow roles

| Implemented role | Read board/history/audit summaries | Register/edit encounters, priority, clinician text, identity and space assignment | Change unoccupied space state |
| --- | --- | --- | --- |
| viewer | Yes | No | No |
| clinician | Yes | Yes | No |
| surgeon | Yes | Yes | No |
| nurse | Yes | Yes | Yes |
| coordinator | Yes | Yes | Yes |

These are software permissions, not verification of professional registration or clinical scope. A doctor can be represented by clinician; no distinct doctor, receptionist, triage nurse, laboratory technician or radiographer role is defined. A coordinator can currently change priority through the same broad edit permission. Legacy staff provisioning is administrative SQL/Auth work, not public signup or a Django admin workflow. [S1:13, S7, S8; role migrations 002/003]

### NECMS hospital capabilities

Hospital roles are configurable records, not a fixed production permission matrix. Migration 006 creates the capability catalogue but does **not** provision a complete hospital/nurse/surgeon/administrator role setup. Fictional nurse, surgeon, display and later administrator fixtures are test assignments, not approved deployed policy. [S13, `supabase/tests/hospital_isolation.sql`]

Implemented capabilities: encounter.read, encounter.register, encounter.update_legacy, patient.identity.read, patient.identity.update, resource.read, resource.coordinate, audit.summary.read, display.read, membership.manage and hospital.configure.

Board access additionally requires patient.identity.read and resource.read. Registration/update use separate capabilities; changing existing identity additionally requires patient.identity.update. There are no separate triage, escalation, override, task, handover or transfer capabilities yet. [S9, S13]

The staff API can inspect memberships/roles and add/change/revoke membership with checks; the UI exposes inspection and revocation, not full account/role creation. Self-management is rejected, delegation cannot exceed capabilities held, reasons are required, and changes increment authorisation version. An approved bootstrap process remains unresolved. Resource mutation additionally rejects a missing staff profile after 007. [S4:64, S13:237, S14]

Confirmed UI issue remains: canEdit requires both encounter.register and encounter.update_legacy, hiding an individually authorised operation from roles holding only one. Hospital department-scoped permissions are not implemented. [S2:93]

## 9. API, security, concurrency and deployment status

### API surface

| Routes | Actual behaviour |
| --- | --- |
| `/api/health/` | Unauthenticated process/config-presence check; not a database readiness guarantee |
| Legacy `/api/board/`, `/api/visits/`, `/api/visits/<id>/`, `/api/resources/<id>/` | GET board, POST registration, PATCH encounter/resource; disabled when NECMS backend mode is enabled |
| `/api/necms/hospitals/`, `/api/necms/contexts/` | List current memberships; issue checked clinical/display context |
| `/api/necms/hospitals/<hospital>/board/`, `history/`, `display-board/` | Scoped GET projections; history paginated 100 records; display uses a distinct restricted RPC |
| Same hospital prefix `visits/`, `visits/<id>/`, `resources/<id>/` | POST encounter and PATCH encounter/resource via checked RPCs |
| Same hospital prefix `staff/`, `configuration/` | GET/POST capability-protected management functions |

Routes use bearer authentication; NECMS operations require an opaque X-NECMS-Context that must match the hospital route, user, purpose and live permissions. A browser hospital ID is not sufficient authority. [S6, S9]

### Verified source controls

RLS restricts verified records to the authorised hospital and capability; legacy permissive policies are removed by 006. New management/private tables default-deny direct access. Invoker views preserve table RLS; security-definer functions have fixed search paths, explicit checks and restricted execute grants. Writes lock/recheck membership before proceeding. [S13]

Patient/encounter versions reject stale edits; resource row locks and active-occupancy uniqueness protect allocations. Retry keys are scoped to hospital/user and payload hash; identical retries return the original result, changed payload is rejected. Keys are optional at API/SQL level; the NECMS UI generates one per registration dialog. This is retry protection, not demographic deduplication: submitting the same person as a new identity with a new key can still create duplicates. [S2:201, S3:67, S11–S13]

Encounter/identity triggers record mutations; resource updates and audit insert succeed/fail together after 007. Missing resource actor profiles are denied. Snapshots are not exposed through ordinary staff audit selection; UI has recent summaries. There is no complete access/read audit, dedicated triage-decision audit or demonstrated tamper-evident external audit retention. Encounter audit labels can fall back to System administrator when profile is missing, although auth.uid is recorded; do not mistake that label for verified professional identity. [S10, S13:402, S14]

The 2D fixes clear protected state on explicit denial, prevent old responses restoring rows, invalidate on logout/auth change and cancel requests. Server authorisation still operates independently. Revocation becomes visible to the client only after a responding request; complete disconnection cannot reveal remote revocation immediately. Browser storage/session/device security and real token refresh remain integration concerns. [S2, S4, S5]

Malformed NECMS object bodies return 400; missing/invalid auth 401, denied permission 403, recognised workflow conflicts 409, upstream failure 503. Unexpected internal faults remain 500. Normal responses/handled errors use no-store; debug must be disabled in shared environments. Credentials must stay outside Git and browser secret-key variables. [S7–S9, S18]

### Privacy distinctions

NECMS restricted display obtains only pseudonymous display label, status, next_action and generic space state from the server. It is still authenticated operational data; its deployment location/session policy needs approval. Legacy wall mode merely hides some fields in the UI while full clinical data remains in browser state. It is not an equivalent privacy boundary or a public waiting-room screen. [S2:158, S4:40, S13:220]

The NECMS board currently returns all verified patient choices for the hospital alongside active encounters. This supports returning-patient selection but creates a data-minimisation and scale concern; a scoped search endpoint would need separate design. Hospital timezone is stored, but current DOB/date calculations still use the fixed Africa/Johannesburg configuration rather than hospital settings. [S1:48, S6, S13:196]

### Deployment and recovery blockers

No live schema/history comparison, real REST/RPC RLS exercise, managed Auth/session test or real multi-session lock contention was performed for this assessment. Earlier local tests do not resolve them. Migration 006 changes policies/views/indexes/functions as well as adding entities; it is not a harmless metadata-only addition. Pending ownership can remove normal visibility of old active encounters. [S13, S17]

The runner uses migration checksums, a session advisory lock, per-migration transactions and rejection of existing tables without tracked history. It requires explicit inclusion of NECMS files, but the switch does not mechanically prove target safety or constitute approval. No executed hosted backup/restore exists in the evidence. Reinstating global read policies is not an acceptable isolation rollback. [S18, `NECMS_MIGRATION_PLAN.md`]

Further blockers: department-limited grants; approved role/bootstrap policy; retention/rate limits for contexts/retry records; monitored operations and load testing; actual TLS/cache/device settings; validated downtime process; remaining UI encoding/capability defects; previously reported development-dependency vulnerabilities, not freshly audited here. No offline clinical synchronisation or conflict reconciliation is implemented. No national rollout readiness is established.

## 10. Automated verification evidence

Latest recorded execution is Milestone 2D on 2026-10-14, at the current code baseline. These are historical results, **not a fresh assessment test run**. [S15–S17]

| Suite | Recorded result | What it does not establish |
| --- | --- | --- |
| Frontend | 26 passed: model 13, API 7, lifecycle 6 | Clinical correctness of manually assigned priority |
| Django | 53 passed, including 13 request regressions | Real hosted Auth/Data API behaviour; upstream mocked |
| TypeScript/Vite | Build passed | Deployed application readiness |
| Original database suite | Passed | Current hosted schema compatibility |
| Hospital SQL suite | Passed isolation, revocation, conflicts/retries, preservation and audit rollback | Genuine simultaneous PostgreSQL sessions; PGlite is one engine with synthetic Auth |
| Database review | Five checks passed: legacy preservation, publication removal, profile guard, RLS and function grants | Managed Realtime delivery or hosted restoration |
| Original browser | Passed registration/editing/space allocation/persistence/discharge/resources/activity/filter/display/mobile/duplicate checks | Live hospital workflows |
| Hospital browser | Default, connection, delayed display, slow denial, multiple pending switch and logout modes passed | Real Auth/network/security; Django/Auth responses mocked |

Original failed 2C cases have regression coverage after 2D: slow-denial data clearing, late display response rejection, missing-profile resource rejection/atomic audit, and three array-body endpoints returning 400. SQL also exercises cross-hospital reads/updates/references, display restrictions and membership expiry. True multi-user/multi-connection races, revocation during an authorised write, real restore and managed REST access remain unverified. Tests do not currently cover a clinical assessment, escalation or reporting workflow because those features are absent.

## 11. Recommended development roadmap

These are proposed milestones, not authorisation to implement them. Security/target verification starts first and remains an acceptance gate for all later hosted work. Clinical work must not silently replace existing P1–P5 values with invented protocol categories.

| Milestone | Dependencies and complexity | Testing and acceptance criteria |
| --- | --- | --- |
| A. Integration/security gate | Verified isolated synthetic project, least-privilege accounts, schema/provenance review, recovery and exact migration approval. High. | Actual Auth/REST/RPC RLS, revocation/session/cache/display tests; real competing connections; successful restore/forward recovery. No production testing or ambiguous target. |
| B. Safe emergency arrival | Approved arrival identifiers, unknown identity policy, registration/clinical role separation and downtime process. Medium–high. | Arrival recorded with minimum approved data, identity may remain provisional, later reconciliation preserves encounter/audit; retries and duplicates tested. No required form step should digitally exclude emergency care. |
| C. Clinician-approved triage | Hospital-selected licensed/approved protocol, versions, observations/units, assessor authority, scope and review process. High. | Structured timestamped assessment, protocol-version reference, clinician confirmation and preserved reassessments. Approved reference cases and unsafe/unknown-input cases reviewed by specialists; no autonomous clinical decisions. |
| D. Priority-aware work coordination | B/C, verified timestamps, service eligibility and clinically agreed ordering/exception policy. High. | Priority ordering under ties/reprioritisation; simultaneous service requests; call/accept/treatment events; clinically justified out-of-order reasons are auditable. Ordering cannot silently turn into automated treatment authority. |
| E. Reassessment and escalation | C/D, approved due-time/alert policies, recipient/cover model, reliable notification delivery and downtime rules. High. | Repeat assessments never overwrite history; overdue/urgent events reach responsible staff with acknowledgement/fallback; races, outages, revoked access and alert fatigue reviewed. |
| F. Clinical coordination/handovers | Verified staff teams/shifts, concurrent task model, locations and transfer policies. High. | Task assignment/completion and receiving handover acceptance; department/hospital transitions preserve responsibility and privacy; pending work survives shifts and retries. |
| G. Operational reporting/pilot readiness | Reliable arrival/assessment/treatment/exit events, approved metric definitions and privacy/retention controls. Medium–high. | Validated time-to-assessment, urgency-specific waits and exceptions; reconciled totals, restricted reports, performance/device/accessibility testing, downtime drill and signed clinical/operational acceptance. |

The client problem should be evaluated using assessed urgency, readiness, resource/service differences and recorded decisions. A numerical queue inversion alone is not sufficient evidence that care was inappropriate. Hospital specialists must define what constitutes an unacceptable delay or exception before software flags it.

## 12. Decisions requiring clinical or client input

- Which hospitals/departments and patient populations are in the first pilot, and who owns clinical governance?
- Which approved triage protocol/version applies, who may assess/reassess/override, and how are uncertainty and exceptions handled?
- What are the required assessment/vital-sign fields, units, observation times, review steps and escalation recipients?
- How are physical arrival, triage, first clinician contact, treatment start and departure defined and captured?
- What minimal identity enables immediate care, and who may reconcile provisional/duplicate identities?
- When may a lower-priority patient appropriately be treated first, and what rationale/approval must be recorded?
- Are service queues shared or separate, and how do readiness, clinician teams, resource suitability and simultaneous tasks interact?
- Who accepts shift/departments/hospital transfers and remains responsible until acceptance?
- Which receptionist/nurse/doctor/surgeon/administrator capabilities and department restrictions are approved?
- What screen audiences, device/session policies, downtime procedures, retention, hosting and privacy requirements apply?
- What evidence establishes historical hospital ownership and permits migration of existing records?

## INFORMATION CHATGPT NEEDS BEFORE DESIGNING THE NEXT MILESTONE

1. Baseline is `f625b90`; only this assessment document was added. React/TypeScript, Django/DRF, Supabase Auth and SQL-owned PostgreSQL must be preserved.
2. NECMS hospital code and migrations 006/007 exist; hosted deployment/schema and isolation remain unverified. Do not apply migrations without target/provenance/recovery checks and specific approval.
3. Current encounter has one integer priority, one care status, one next service, text clinician/location/notes and optional resource. It has no structured triage, vital signs, reassessment, task or transfer model.
4. Queue ordering is manually assigned P1–P5, then arrival, then UUID; only waiting/ready encounters in the same service receive queue positions. Sorting does not enforce clinical treatment order.
5. Registration requires names, complaint and a valid priority; safe unidentified/minimal arrival is a missing prerequisite. No public emergency booking or structured ambulance/referral intake exists.
6. Preserve patient/encounter UUIDs, references and audit history. Unknown hospital provenance must remain pending/quarantined, never silently assigned.
7. Hospital access requires live membership, capability and server-checked context, not a browser hospital ID. Keep raw clinical subscriptions disabled; preserve the server-only display projection and 2D response guards.
8. Last recorded local results were 26 frontend and 53 Django tests plus build/database/browser passes; they are not hosted or clinical validation. No tests were rerun in this assessment.
9. Before clinical design, obtain the approved protocol, clinician roles, minimal-arrival policy, reassessment/escalation rules, legitimate queue exceptions, pilot scope, downtime policy and acceptance owner.
10. Recommended next step is a reviewed integration/security gate alongside clinical workflow discovery, followed by safe arrival and structured clinician-approved triage. This report does not authorise implementation, deployment or automated medical decisions.
