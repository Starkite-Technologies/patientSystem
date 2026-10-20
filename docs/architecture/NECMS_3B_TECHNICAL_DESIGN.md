# NECMS 3B technical design

Local development only, 2026-10-15. Existing tracked HEAD is f625b90; the complete, uncommitted 3A source and its reports are the working baseline. Preserve those changes. No hosted access, migration execution, new clinical criteria or protocol activation is authorised.

## Baseline and compatibility

Inspection confirms the 3A arrival, reconciliation, assessment/review, care and timeline RPCs/components exist, as do the 2D cancellation/epoch guards. The reports describe local synthetic verification, not deployed functionality. The working tree contains uncommitted 3A files and the assessment document; this is a version-control difference from assuming a committed 3A baseline, not a missing implementation.

Add hospital-owned coordination services, teams/rosters, reason categories, work items, immutable work events, sequencing review records/annotations and inactive escalation policy versions. Do not backfill work items or reinterpret historical statuses. Existing next_action and assigned_to remain legacy hints, never authoritative structured task assignment. New work items take precedence only within the new coordination board; the old board remains available. Multiple work items may coexist for a patient, including simultaneous services. No work item is a medical order.

## API and authority

All routes under /api/necms/hospitals/<hospital>/ require bearer authentication and the existing live clinical context. Django and each privileged SQL function independently check capabilities and hospital relationships. New capabilities receive no default role grants: queue.read, queue.coordinate, patient.call, service.accept, treatment.record, work.create, work.assign, work.complete, reassessment.request, escalation.acknowledge, exception.review, coordination.configure.

GET coordination/ returns a checked server projection of active encounters, work items, verified current staff, services, teams, reason categories and provisional sequencing reviews. POST coordination/work-items/ creates an explicit task. POST coordination/work-items/<id>/events/ records a versioned transition. GET coordination/encounters/<id>/events/ returns operational history. POST coordination/exceptions/<id>/review/ appends an acknowledgement. POST coordination/configuration/ registers operational catalogue entries/roster membership or an inactive policy reference; it cannot set clinical criteria or activate a policy.

Every mutation requires a caller retry UUID. A private hospital/actor/request ledger hashes operation and payload and returns the original result for identical retries, even after the work version changes. Different payload/operation reuse is rejected. Transactional audit and immutable event recording are mandatory.

## State machine

Work states: waiting, called, accepted, underway, deferred, completed, cancelled. Creation is waiting. call: waiting -> called; call_cancel: called -> waiting; accept: waiting/called -> accepted; acknowledge: waiting/called/deferred -> accepted for manual review/reassessment requests; defer: waiting/called/accepted -> deferred; resume: deferred -> waiting; start: waiting/called/accepted/deferred -> underway; complete: accepted/underway -> completed; cancel: any nonterminal -> cancelled. Readiness changes preserve state and require attribution. Reassignment is versioned, requires a reason and resets accepted work to waiting; underway care continues with a new acknowledgement pending. Terminal records cannot transition. Cancellation, call cancellation, deferral, reassignment and late documentation require reasons.

Acceptance requires the actor to be the assigned person or a current member of the assigned team; an unassigned ordinary task may be accepted by a holder of service.accept, thereby explicitly assuming responsibility. A person/team is verified within the same hospital. Manual urgent-review/reassessment requests retain a named request owner (creator if no person/team is selected), and remain unacknowledged until an explicit acceptance/acknowledgement event. Completion never automatically completes a clinical assessment or supplies a diagnostic result.

Explicit start may occur directly without triage/acceptance/demographic completion. It records coordination only; no clinical status is silently changed. Board selection is read-only. Occurred_at may be supplied for earlier care, requiring a late-entry reason; recorded_at always comes from the server. Snapshot evidence is explicitly at recording time and must not be presented as the queue at an earlier occurrence time.

## Ordering and sequencing evidence

Only provisional_manual urgency with a last completed assessment timestamp participates in provisional numerical comparison. A pending reassessment does not erase the previous reviewed value, and its pending state stays visible; a new unreviewed assessment never supplies the displayed value. Unknown/untriaged/legacy-unvalidated encounters are shown in a separate prominent lane, not assigned a low rank. Within the reviewed lane order by manually reviewed value, queue-entry time, work UUID. Untriaged lane orders by queue-entry time and UUID. Service filters keep distinct queues; teams filter responsibility, not a clinical eligibility algorithm.

Reassigning an accepted task resets it to waiting with no new-owner acknowledgement. Care already underway is not paused by reassignment: its new owner may explicitly accept/acknowledge while the underway state remains intact. Both transitions preserve the prior owner/acknowledgement in immutable event history.

Eligible means staff explicitly marked the work item ready for the selected configured service. A start snapshots same-service ready waiting/called/accepted tasks and their encounter urgency/source/state, assignment, queue-entry time and versions. It records unknown urgency separately. A reviewed lower-urgency start with reviewed higher-urgency candidates creates a provisional sequencing review, not an accusation. Missing reasons never block start. Optional active reason category/explanation is recorded; reviewers can later acknowledge with a reason and category. Preserve event-linked snapshot and annotations. No automatic notifications, escalation or deadline.

Service-level advisory locking serialises coordination changes; work/encounter versions prevent silent overwrite. Snapshot capture uses server transaction evidence and encounter locking. Real concurrent-session behaviour is a separate blocked gate unless an isolated local server is actually available; embedded execution is not proof.

## UI and privacy

Extend the clinical workspace with an Emergency Coordination Board: visible counts, unknown/reviewed lanes, filters, structured ownership, current space/care status, arrival/queue elapsed times, latest assessment, tasks, explicit action buttons and operational timeline. Show freshness/errors and clear protected data on 401/403, context/capability changes, switch or logout using the existing lifecycle guards. No raw realtime. Restricted displays continue to use their existing server projection; never deliver the coordination bundle to display contexts.

## Clinical dependencies and acceptance

Reason/service/team catalogues are operational configuration only, not medical suitability rules. No production defaults or clinical role grants are seeded. Protocol approval, urgency interpretation, service eligibility policy, scope of staff authority, exception review, late-documentation rules, team governance, escalation criteria/intervals and care targets need hospital approval. Escalation policy references remain inactive with no activation endpoint.

Verify synthetic queue ordering/visibility, transitions, retries, snapshots/reasons/acknowledgement, reassessment ownership, pre-triage start, FK/RLS boundaries, revocation, audit rollback and immutable history. Run existing frontend/Django/build/database/browser suites plus new SQL/API/UI checks. Verify preservation across additive migration and transaction rollback. No dependency installation, hosted connection, deployment or real patient data is needed.
