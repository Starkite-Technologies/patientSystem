# NECMS synthetic hospital demonstration workflow

Proposal for Starkite Technologies and hospital stakeholders, 2026-10-15. **Synthetic demonstration only; not a clinical pilot approval or validated medical workflow.** No live patient details, real clinical decisions, executable orders or approved triage protocol are supplied by this document.

Use two explicitly fictional facilities, Synthetic Public A and Synthetic Private B, and synthetic staff accounts. Keep one operator responsible for the demonstration and one hospital reviewer observing permissions, clarity and record history. Start with approximately 10–100 synthetic encounters, not the 5,000-row load fixture. The mock browser harness and local SQL tests are separate; a real full-stack Supabase demonstration requires the hosted integration runbook first.

## Demonstration script

| Step | Staff action / synthetic case | Expected behaviour and discussion |
| --- | --- | --- |
| 1. Patient arrival | Reception/authorised intake selects Public A, records a fictional walk-in using Rapid Emergency Arrival. | Server issues patient/encounter UUIDs, PF reference and recorded arrival time. Hospital identity is checked; no clinical priority is computed. |
| 2. Unidentified intake | Record a separate synthetic arrival without names/DOB, reporting that care is already underway. | Provisional identity/TMP alias; no invented demographic values or priority. Care does not wait for form completion. Reconciliation later preserves identity/reference/history and requires a reason/version. |
| 3. Initial assessment | Qualified demonstration assessor records invented observation values clearly labelled synthetic and explicitly chooses a provisional urgency label. | Structured assessment/vital timestamps are preserved. Format checks do not calculate triage, diagnose, or interpret deterioration. No approved medical criteria exist in this prototype. |
| 4. Independent review | Another authorised staff account reviews with a rationale. | Self-review is rejected. An accepted manual value is displayed as provisional; it does not approve a protocol. Staff discuss whether the independent-review staffing model is appropriate locally. |
| 5. Queue presentation | Compare one unknown encounter with two independently reviewed demonstration encounters using distinct provisional labels. | Unknown urgency stays prominent in its own lane; reviewed lane uses manual value, queue-entry time and UUID. The software does not select who receives treatment. |
| 6. Assignment | Coordinator creates initial-review and laboratory-coordination tasks for the same encounter, assigning verified staff/team. | Concurrent work items coexist; legacy next-service/clinician text is preserved. These are coordination records, not laboratory or treatment orders. |
| 7. Call and acceptance | Call a patient; demonstrate call cancellation with a reason, then acceptance by the assigned person/team member. | Selection alone is read-only. Call, acceptance and acknowledgement are different attributed events. Incorrect person/team acceptance is denied. |
| 8. Treatment-start documentation | Authorised staff explicitly records a start, including an untriaged synthetic case. | Start is possible before identity/triage/call/acceptance completion. Work state changes; encounter care status and space remain separate. Earlier occurrence requires a late-entry explanation; recorded time stays server-owned. |
| 9. Apparent out-of-order care | In one service, start a lower provisional-label encounter while another ready higher-label encounter waits; optionally document circumstances after starting. | Immutable recording-time queue snapshot and provisional review appear. Missing explanation never blocks urgent care. A reviewer adds category/explanation; acknowledgement is not a negligence judgement. Different services are not compared as one eligible queue. |
| 10. Reassessment request | Nurse/doctor manually requests urgent review or nursing reassessment and confirms its request owner. | Request remains visibly unacknowledged until accepted/acknowledged. Completing the coordination task does not manufacture a clinical assessment. New reassessments and reviews append history. No timers or automatic escalation activate. |
| 11. Treatment space | Two accounts try to allocate the same fictional bed; change cleaning/availability after release. | One allocation succeeds; the conflicting operation fails without partial changes. Space, care status, urgency and task state remain independent. |
| 12. Discharge or transfer | Authorised staff explicitly changes encounter care status using the clinical care controls. | Resource is released under existing rules. Historical records remain. Outstanding tasks are not silently completed; cancel them explicitly with reasons. No cross-hospital patient sharing/transfer integration is implied. |
| 13. Shift coordination | Filter by service/team; inspect unacknowledged tasks, unknown urgency and available spaces; reassign accepted/underway work with an explanation. | Accepted work awaits the new owner; underway care continues with acknowledgement pending. Immutable ownership history survives. This is a handover aid, not an implemented formal handover/sign-off module. |
| 14. Privacy and downtime | Switch to Private B, open restricted display, revoke membership, then simulate disconnection/logout with pending requests. | No A records survive the switch; display receives only the restricted server fields. Denials clear protected data. Disconnected coordination snapshots are explicitly stale. A real outage/revocation policy still needs hospital approval. |

Do not present generated names, observations or provisional labels as clinical examples or recommendations. Hospital staff choose the demonstration values and judge the workflow. Stop if real patient data appears, the target is uncertain, permissions differ unexpectedly or the interface does not identify stale data.

## Proposed capability matrix — requires hospital approval

This is a workshop proposal, **not seeded grants**. Each hospital currently assigns one capability-bearing role per membership; multi-duty roles require an explicitly reviewed combined capability set, not an assumed multi-role mechanism. The same person may have different roles at different hospitals. Global legacy role names do not grant NECMS capabilities.

| Function / capability group | Reception | Nurse | Doctor | Coordinator | Administrator |
| --- | --- | --- | --- | --- | --- |
| Minimum selected clinical board reads | Limited approved intake view needed; current board is broader | Proposed clinical reads | Proposed clinical reads | Proposed operational clinical reads | None by default |
| Rapid arrival `arrival.register` | Proposed | Proposed | Proposed | Hospital decision | No default |
| Identity read/completion `patient.identity.read`, `identity.reconcile` | Proposed trained intake staff | Hospital decision | Hospital decision | No default completion | No default clinical access |
| Legacy registration `encounter.register` | No default: form includes clinician-entered priority | Hospital decision | Hospital decision | Hospital decision | No default |
| Care/status/location `encounter.update_legacy` | No | Proposed within scope | Proposed within scope | Only if clinically authorised | No |
| Assessment/reassessment `triage.read/create/reassess` | No | Qualified staff only | Qualified staff only | Only if qualified separately | No |
| Independent review / `priority.amend` | No | Hospital-designated reviewer | Hospital-designated reviewer | No automatic clinical authority | No |
| Queue read/create/call/assign/coordinate | Intake calls only if approved | Proposed | Proposed | Proposed | No default |
| Acceptance/start/completion `service.accept`, `treatment.record`, `work.complete` | No | Within approved clinical scope | Within approved clinical scope | Not from job title alone | No |
| Manual reassessment request / acknowledgement | No default | Proposed within scope | Proposed within scope | Request only if approved; no automatic clinician acknowledgement | No |
| Operational exception review | No | Designated reviewer | Designated reviewer | Designated operational reviewer | No default |
| Resource coordination | No | Proposed | Hospital decision | Proposed | No default |
| Membership/configuration management | No | No default | No default | Delegated operational catalogue only if approved | Proposed audited administration, no implied clinical permission |
| Protocol administration/approval | No | Separate governance role | Separate governance role | No | Draft registry only if designated; approval remains unavailable |
| Restricted wall display | Separate device/display membership and context, approved projection only | Same | Same | Same | Provisioning only |

The current application lacks a dedicated minimal reception projection and department-limited authorisation. Do not grant the entire clinical board to reception just to make this proposal work. Synthetic walkthroughs may use explicitly labelled test permissions; a real pilot needs those policy/design gaps resolved. Administrators must not casually grant themselves clinical authority; membership delegation restrictions remain in SQL.

## Questions requiring hospital leadership decisions

1. Which facility/departments and professional groups are in scope? Who owns the pilot, clinical safety review and acceptance decision?
2. Which approved protocol/version, urgency vocabulary, assessment formats and review rules apply? Is independent review always feasible? Who can amend an already reviewed value?
3. Who may create/acknowledge/complete each service task, mark operational readiness, call patients and assign/reassign teams? How is professional qualification verified?
4. Who owns an urgent-review request until accepted, and how are unacknowledged requests handled during shift changes? What manual downtime/phone escalation procedure already exists?
5. Which sequencing categories, late-documentation policy and operational review process are appropriate? How are corrections/addenda made without rewriting history or implying blame?
6. What reassessment/escalation rules, intervals and recipients would need clinical approval in a later milestone? None are activated here.
7. How are unidentified patients labelled, wristbanded and reconciled? Who handles potential duplicates/twins and a separately governed merge process?
8. What may reception, coordinators, public screens and private staff devices see? Approve display fields, retention, idle timeout, department scope and logs.
9. How are unresolved historical ownership, transfer/discharge tasks, formal handover and post-outage reconciliation handled?
10. What recovery objectives, network/device constraints, permitted workload, rollback/cutover owner and stop conditions must be met before any approved synthetic hosted demonstration?

Record decisions as signed/versioned hospital policy references. A software demonstration, passing tests or this proposed matrix is not clinical approval.
