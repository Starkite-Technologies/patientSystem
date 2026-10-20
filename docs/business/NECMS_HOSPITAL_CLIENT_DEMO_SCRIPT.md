# NECMS hospital client demonstration script

2026-10-20 · Starkite Technologies · fictional local software walkthrough. No customer agreement, medical validation or deployment approval is implied.

## Purpose and evidence boundaries

Ask the client to confirm the problem: staff need a shared view of who is waiting, their recorded urgency, what service they need, who is responsible, and why care sometimes starts in an apparent different order. NECMS records and presents those facts. It does not infer urgency from observations, select treatment, accuse staff or enforce medical waiting deadlines.

The browser runs real React with simulated Auth/API responses. The separate automated PostgreSQL tests execute actual database permission, history, conflict and recovery logic with an Auth identity stub. Neither establishes real Supabase integration or clinical effectiveness. Keep the synthetic banner and simulated-service toolbar visible throughout.

## Safe preparation and launch

Use only installed project dependencies and Edge. In two terminals from the repository:

```powershell
node scripts/start-client-demo.mjs
node scripts/demo-client-necms.mjs
```

The dedicated preview binds `127.0.0.1:5177`, overrides Supabase URL/key with fictional values and enables presentation mode. The Playwright launcher blocks non-local network requests, intercepts local Auth/API calls and opens a separate browser context. Do not substitute a normal environment-loaded development server or a real staff session. Visiting the URL alone does not install the simulated service.

The toolbar offers a fictional role selector, assessor/reviewer switch and **Reset fictional shift**. Role changes discard mock contexts and reload; select Synthetic Public A again. Reset restores exactly three fictional encounters, restores their two illustrative fixture assessments and discards added in-memory events/assessments and reloads. It never calls Django, SQL or any database. Old callbacks carry old contexts and cannot authorise a new one. No real Auth accounts, passwords or hospital records are created.

Before presenting: facilitator rehearses on the actual laptop, checks zoom/focus/tablet layout, chooses audience/privacy settings and agrees recording consent and stop conditions. The broad facilitator grant set is a synthetic convenience, not a proposed hospital job role. Use role switching to explain least privilege. Close the interactive browser and stop the preview with Ctrl+C at the end.

## Opening narrative and three-patient problem

“All records you see are fictional. Manual provisional labels are illustrative and have not been approved as a clinical triage protocol. Clinical staff retain all care decisions.”

| Patient | Fixed narrative input at each reset | What to show |
| --- | --- | --- |
| A, `SYN-DEMO-0001` | Arrived about 45 minutes before reset; fictional clinician-entered/reviewed P4; same assessment service | Arrival timestamp, elapsed time, source/review label and responsible fictional nurse |
| B, `SYN-DEMO-0002` | Arrived about 25 minutes before reset; fictional clinician-entered/reviewed P1; same service | Later arrival yet earlier presentation within the reviewed lane |
| C, `SYN-DEMO-0003` | Arrived about 10 minutes before reset; provisional identity and no urgency | Separate unknown/untriaged lane; no numerical low-urgency substitution |

These values are predetermined synthetic narrative inputs, not software-generated assessments. Timings are relative to reset and are not clinical targets. The two reviewed examples are preloaded fixtures; the later assessment/review exercise demonstrates explicit entry rather than manufacturing historical medical evidence.

## Guided shift: stages A–J

1. **A — Arrival visibility.** Open Emergency Overview. Read arrival times and waiting durations. Show the full-scope counts and that the unknown lane precedes the separate reviewed lane. Within the reviewed lane B precedes A. Explain paging/search: a page is not the whole department. Selection alone records nothing.
2. **B — Rapid registration.** Patient Arrival opens the existing minimum-arrival form. Register a clearly fictional known person, then another unidentified ambulance arrival. For the latter, leave demographics blank and explicitly report immediate care already underway. No urgency is supplied. The overview must include both even without work items. Reception demonstrates intake without clinical-history access; full identity reconciliation/merge remains separately governed.
3. **C — Observations and assessment.** Awaiting Triage → choose C. Mark a vital as measured and enter an explicitly fictional recording; leave unavailable values unset. Enter a manual provisional label and supporting observations, then Record assessment. Observations do not calculate urgency; the encounter awaits review.
4. **D — Independent review.** Switch the fictional assessor/reviewer in the toolbar. Record a rationale and accept as provisional. Explain that mock actor switching is not real authentication or verification of professional qualifications. The assessment and review remain separate records. No approved medical protocol is activated.
5. **E — Service coordination.** Emergency Coordination shows several independent work items and explicit operational readiness. Search/filter by a configured service, staff responsibility or state. Counts cover the entire authorised hospital/department, irrespective of a search/page. A service task is not an executable medical order.
6. **F — Responsibility and start.** Reset to show the original three patients if needed. Select A's timeline/actions. Record call, acceptance, a reassignment with explanation, then new acceptance. Reassignment clears prior acknowledgement. Explicitly start A while B is waiting. Emergency care is not blocked by a missing sequencing explanation. Work underway and encounter care status are distinct; update encounter status through care coordination when appropriate.
7. **G — Treatment space.** Awaiting Triage clinical controls → assign Fictional bed 1 to A. Treatment Spaces shows occupied status. A conflicting assignment is unavailable/rejected. State the evidence boundary: browser rejection is simulated; independent PostgreSQL tests prove one committed allocation. Availability does not establish clinical suitability.
8. **H — Operational accountability.** Return to A's events and expand Queue evidence. Identify B's higher recorded label, C's unknown urgency, states and versions at start-recording time. Open Operational Review, return to evidence and append an acknowledgement/explanation using the fictional operational category. Explain visibly: resources or patient needs may justify a different order; this is not a finding of negligence or clinical correctness. Original evidence stays unchanged. Earlier-occurrence entries would be recording-time evidence, not reconstructed history.
9. **I — Manual reassessment.** Select B, create a nursing reassessment/urgent-review task, assign responsibility and explicitly acknowledge it. Several tasks coexist. Acknowledgement and completion are separate. Completing a work item does not create a new assessment. No automated escalation or deadline exists.
10. **J — Discharge/transfer and history.** In clinical care controls mark A discharged or transferred. The space is released; assessment and operational history remain. Clinical Timeline → Completed encounters → select A. Outstanding service work is not silently completed by discharge; document any required cancellation explicitly. This is operational closure, not a completed hospital discharge-summary or transfer-acceptance process.

Demonstrate Hospital Administration only with its capability: hospital-scoped staff access and reasoned revocation. It is not an identity-provider account-creation interface. Switch to Private B to show A's clinical content clearing. Restricted shared display receives only display label, status, next action and generic space state; names/complaints/notes are excluded. Show freshness text and explain that offline screens cannot learn remote revocation instantly.

## Role walkthrough and acceptance

Use the proposed matrix in the pilot proposal. Reception sees Patient Arrival only; the administrator sees Hospital Administration only. Clinical pages require their full companion capabilities. Nurse, doctor and coordinator sets are synthetic examples requiring hospital approval; job titles alone grant nothing. Direct requests also need server/database permissions—hidden navigation is not security evidence.

Technical rehearsal:

```powershell
node scripts/check-client-demo.mjs
```

It runs headless Edge and writes ignored synthetic screenshots/results under `test-results/`. It does not establish hospital acceptance. The facilitator should verify the three-patient sequence, A–J stages, role restrictions, readable unknown/stale states, completed history, reset and device privacy on the presentation hardware.

## Closing and stop conditions

Invite a separately agreed paid discovery engagement to validate actual hospital workflows, professional scope, protocol governance, integrations, privacy, hosting and recovery needs, then quote implementation. Do not claim waiting-time reduction, clinical benefit, an agreed fee or a signed pilot.

Stop if the fictional labels disappear, real data or an unapproved endpoint appears, privacy/access fails, reset is unclear, or staff interpret provisional ordering as a treatment instruction. Hosted security verification, clinical governance, privacy/security approval and support/recovery acceptance are prerequisites to any live-data pilot. See the requirements and clinical-governance checklists.
