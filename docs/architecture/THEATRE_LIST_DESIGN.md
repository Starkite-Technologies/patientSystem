# PatientFlow: Emergency theatre list (design)

Status: **proposal, not built.** Based on the "Emergency Theatre Booking and Prioritisation System" design
(NCEPOD classification, RCoA emergency anaesthesia guidance, RCS Good Surgical Practice), adapted to what
PatientFlow already has. Clinical categories, time targets and permissions below are placeholders until the
hospital's surgical, anaesthetic and theatre leads approve them (see "Decisions needed").

## 1. What changes, in one paragraph

PatientFlow gains a second board, the **Emergency theatre list**, next to the existing ED patient board.
Clinicians book a surgical case in under three minutes (under 30 seconds for an immediate case). Each case has
an **NCEPOD category** (clinical urgency, chosen by a clinician) and a **time target** counted from the
**decision to operate**. The list is ordered by urgency, then by time remaining; a separate **deadline colour**
shows how close each case is to its target. Every priority change, delay and theatre timestamp is recorded.
The software never changes a clinician's priority by itself.

The ED board (Manchester triage, counted from arrival) stays as it is. The two colour systems are kept on
separate screens so a colour never has two meanings on one page.

## 2. Reuse versus new

| Need | Today in PatientFlow | Theatre list |
|---|---|---|
| Patient identity | `patients` (name, DOB, PF reference) | Reused. Add optional hospital **MRN** and **sex**. |
| Link to ED visit | `visits` | Optional link: "Book for theatre" from an ED patient pre-fills identity. |
| Theatres | `resources` (Theatre 01, kind "Operating room"; available / cleaning / unavailable) | Reused as theatre status board, plus "in use until" and an "elective list" state. |
| Roles | viewer, clinician, surgeon, nurse, coordinator | Reused; add **anaesthetist**. |
| Activity log | `audit_events` via triggers | Reused for every booking change, priority change, delay and timestamp. |
| Export, Help, text size, display mode | Built | Extended to the theatre list. |
| Multi-hospital (Windhoek Central + Katutura) | NECMS groundwork, disabled | Later phase; one hospital first. |

## 3. Urgency model

Two separate things, always shown separately:

**A. Clinical urgency (chosen by a clinician, never changed by software)**

| Code | NCEPOD | Placeholder target | Example |
|---|---|---|---|
| P0 | Immediate | minutes | uncontrolled haemorrhage |
| P1 | Urgent | 1 h | selected limb/organ-threatening |
| P2 | Urgent | 2 h | time-critical emergencies |
| P3 | Urgent | 6 h | source control after resuscitation |
| P4 | Urgent | 12 h | stable urgent conditions |
| P5 | Expedited | 24 h | stable, needs early surgery |
| P6 | Expedited | 48-72 h | expedited procedures |

Codes, labels and targets live in a **configuration table**, not in code, so the hospital can approve and adjust
them without a release. P0-P6 are local operational codes, not official NCEPOD categories. Elective (NCEPOD 4)
stays out of this list.

**B. Deadline status (computed, changes with time)**

`deadline = decision_to_operate_at + target`, `remaining = deadline - now`.

| Colour | Meaning (placeholder thresholds, configurable) |
|---|---|
| Green | within target (less than 67% of target used) |
| Yellow | approaching (67-83%) |
| Orange | imminent (more than 83%) |
| Red | deadline exceeded: reason for delay required |
| Flashing red | P0 not yet in theatre |

The clock starts at the **decision to operate**, not at booking. Booking time is recorded too, so late booking
does not hide delay.

**Ordering:** P0 first; then by code (P1 before P2 ...); within the same code, earliest deadline first.
A less urgent case is never moved above a more urgent one because its deadline is closer. A consultant
(and anaesthetist, if approved) may override the order; the override needs a written reason and is logged.

## 4. Booking form

**Rapid booking (P0 only, target under 30 seconds):** patient (search or new) → procedure → location → Submit.
The rest is completed afterwards; the case shows "details incomplete" until it is.

**Standard booking (target 2-3 minutes),** with the design's 15 essential fields:

| # | Field | Required | Notes |
|---|---|---|---|
| 1 | Patient name | yes | from existing patient or new |
| 2 | Hospital MRN | yes (placeholder) | PF reference kept as fallback until MRN is available |
| 3 | Age / date of birth | yes | existing |
| 4 | Ward / location | yes | list plus free text |
| 5 | Surgical specialty | yes | configurable list |
| 6 | Responsible consultant | yes | staff list (surgeon role) |
| 7 | Booking clinician | automatic | from sign-in |
| 8 | Diagnosis | yes | |
| 9 | Proposed operation | yes | |
| 10 | Indication / brief summary | yes | |
| 11 | NCEPOD category | yes | |
| 12 | Time target (P-code) | yes | |
| 13 | Decision to operate (date/time) | yes | defaults to now, editable, not in the future |
| 14 | Estimated duration | yes | 30/60/90/120/180+ min |
| 15 | Readiness and critical support | yes | haemodynamically unstable, sepsis/septic shock, vasopressors/organ support, major anaesthetic concern |

Also asked at booking: **"Likely consequence if delayed beyond the target?"** (death/collapse, limb or organ loss,
sepsis progression, bowel ischaemia/perforation, neurological deterioration, uncontrolled pain, other).
The form **flags** (does not block or change) obvious mismatches, for example septic shock with P5.

Missing information is shown as "not recorded", never as normal.

## 5. Case lifecycle and timestamps

`booked → ready → anaesthesia started → surgery started → completed` (or `cancelled`, with reason and authoriser).

Buttons on the case record the times: **decision to operate, booked, anaesthesia start, incision, completed.**
Readiness (separate from urgency): anaesthesia review, consent, crossmatch/blood products, imaging, antibiotics,
fasting, resuscitation, ready for transfer, ICU/HCU bed needed and confirmed, special equipment. An incomplete
checklist never moves a case down the list.

**Delays:** once a case passes its deadline, saving it requires a delay reason (theatre capacity, anaesthetist,
surgeon, patient optimisation, investigations, blood bank, equipment, ICU/HCU bed, transport, competing
emergency, administrative, other + text). Patient optimisation is reported separately from avoidable delay.

**Deterioration:** a "Patient deteriorating: request reprioritisation" button flags the case red on every screen
and asks the consultant to review the priority. It does not change the priority itself.

## 6. Screens

1. **Theatre list** (all signed-in roles): code + NCEPOD word + clinical colour; patient; specialty; procedure;
   time since decision; target; **time remaining with deadline colour**; readiness; theatre/status; consultant.
   Table on wide screens, cards on tablets and phones (same approach as the ED board). Display mode hides names.
2. **Book case**: rapid and standard forms (section 4).
3. **Case detail**: readiness checklist, anaesthesia section (anaesthetists), timestamps, priority history,
   delay reason, cancel.
4. **Theatres**: each theatre's state (occupied / available / cleaning / elective list / unavailable),
   current case and expected free time. Coordinators update it.
5. **Handover list** (Phase 2): outstanding cases, codes, deadlines, changes and delays, printable at shift change.
6. **Reports** (Phase 3): see section 9.

## 7. Roles and permissions (placeholder, needs approval)

| Action | Medical officer / registrar (clinician) | Consultant (surgeon) | Anaesthetist (new role) | Theatre coordinator | Theatre nurse (nurse) | Viewer / management |
|---|---|---|---|---|---|---|
| Book case | yes | yes | yes | no | no | no |
| Set priority at booking | yes | yes | no | no | no | no |
| Change priority later | request only | yes | joint review | request only | no | no |
| Override list order | no | yes | yes (if approved) | no | no | no |
| Assign theatre / start time | no | joint | joint | yes | no | no |
| Readiness checklist | yes | yes | yes | yes | yes | no |
| Anaesthesia section | no | no | yes | no | no | no |
| Record timestamps | yes | yes | yes | yes | yes | no |
| Delay reason | yes | yes | yes | yes | no | no |
| Cancel | consultant authorisation | yes | no | with documented authorisation | no | no |
| Export / reports | no | yes | yes | yes | no | reports only |

Nobody can lower a priority without a written reason; the coordinator can never lower it.

## 8. Data model (new pilot migration, applied only after approval)

- `theatre_priority_codes` (code, ncepod_category, label, target_minutes, examples, active) - configuration.
- `theatre_bookings` (id, booking_ref `TB-000001`, patient_id, visit_id nullable, mrn, sex, location, specialty,
  responsible_consultant_id, booked_by, diagnosis, proposed_operation, indication, priority_code,
  delay_consequence, decision_at, booked_at, estimated_minutes, critical flags, readiness fields,
  status, theatre_id → resources, planned_start, anaesthesia_start_at, incision_at, completed_at,
  cancelled_reason, delay_category, delay_note, deterioration_flagged_at, version).
- `theatre_priority_changes` (booking, from, to, by, at, reason) - append-only.
- Checked functions only (same pattern as `save_visit`): `book_theatre_case`, `update_theatre_case`
  (version-checked), `change_theatre_priority` (reason required, role-checked, never automatic),
  `record_theatre_time`, `record_theatre_delay`, `flag_deterioration`.
- Row-level security as today; anonymous access blocked; every write audited.
- `resources` gains `in_use_until` and an `elective_list` state for theatres.
- Role list gains `anaesthetist`.

## 9. Measures (Phase 3)

Bookings by specialty and category; median decision-to-theatre time; % within target per code; deadlines
exceeded; delay reasons; theatre utilisation; cancellations; out-of-hours operating; priority overrides;
cases waiting for ICU/HCU. Coordinator CSV export from Phase 1.

## 10. Phases

| Phase | Scope |
|---|---|
| **1. MVP** | Configuration table; booking (rapid + standard, 15 fields); theatre list with clinical and deadline colours; case detail with timestamps, priority change log, delay reason, cancel; theatre status; anaesthetist role; Help sections; export; tests. |
| 2 | Full readiness checklist and anaesthesia section; deterioration button; handover list; in-app alerts for P0, approaching and exceeded deadlines. |
| 3 | Acknowledged alerts outside the app (SMS / WhatsApp / pager); reports; MRN lookup from the hospital system; second hospital (NECMS). |

In-app alerts only work while someone has PatientFlow open. Until Phase 3, P0 mobilisation must still use
the hospital's existing emergency call process.

## 11. Decisions needed before building Phase 1

1. **Codes and targets:** approve P0-P6 (or fewer) with targets and examples, by the surgical, anaesthetic and theatre leads.
2. **Who changes priority:** consultant only, or consultant + anaesthetist jointly.
3. **Deadline colour thresholds:** 67% / 83% or other.
4. **Theatres:** names and number of emergency theatres; whether elective lists are shown.
5. **Specialties:** list for this hospital.
6. **MRN:** available at booking now, or PF reference until integration.
7. **Placement:** theatre list beside the ED board (recommended), or theatre list only for the pilot.
8. **Governance:** who owns the clinical rules, and the downtime (paper) procedure.

Until real data is approved: fictional patients only on the pilot, as now.
