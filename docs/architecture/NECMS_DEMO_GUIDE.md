# NECMS fictional stakeholder demonstration

2026-10-19 · Namibia Emergency Care Management System · Starkite Technologies.

This is a **synthetic software demonstration**, not a live clinical pilot. It demonstrates intended coordination, visibility and traceability. No reduction in waiting times, clinical benefit, hospital approval, regulatory compliance or production capacity has been established.

## Safe launch and reset

Use the repository's existing Node dependencies and Microsoft Edge. Do not use an ordinary environment-loaded development server or existing hosted credentials for this demonstration.

Terminal 1:

```powershell
node scripts/start-paged-test.mjs
```

This binds only `127.0.0.1:5176`, overrides Supabase configuration with an invalid synthetic endpoint and enables the labelled paginated preview.

Terminal 2:

```powershell
node scripts/demo-necms.mjs
```

The interactive Edge window runs real React. Its Auth/API responses are **simulated by Playwright**, with all external traffic blocked. It never connects to a database or Supabase project. Opening 5176 directly without this harness does not provide the fictional service. Close the window to end the demonstration and stop the preview with Ctrl+C.

The overlay identifies the simulation and provides **Reset fictional browser demonstration** and **Switch fictional assessor / reviewer**. Reset replaces only in-memory fixture arrays, invalidates fixture continuation tokens and reloads the browser. The toolbar reinstalls on reload. No Django reset route, SQL reset function, database URL or live-data deletion operation exists. The actor switch simulates two fictional staff identities; it is not real Supabase login or professional qualification verification.

The fixture starts with 80 fictional encounters in Synthetic Public A and an empty Synthetic Private B. Two preloaded records have explicitly illustrative reviewed manual labels. Unknown identities/urgency remain unknown. Demo-created references use `SYN-DEMO-...`; normal application PF/UUID generation is unchanged. Reset does not touch clinical history in any actual database.

Automated checks, in another terminal while the preview runs:

```powershell
node scripts/check-paged-browser.mjs
node scripts/check-synthetic-demo.mjs
```

The old compatibility preview remains separate on 5175 (`start-necms-test.mjs`), and the original browser-local fictional PatientFlow demo on 5174 (`start-demo.mjs`). Compatibility mode is explicit through `VITE_NECMS_PAGED_READS=false`, not an automatic fallback when a new endpoint fails. New NECMS reads default to pagination. A normal production/hosted application is not authorised by any of these launch commands.

## Stakeholder narrative and scenarios

Begin with the client's problem: staff need to see who is waiting, what has been assessed, who owns the next task, where care is occurring and why apparent sequencing exceptions occurred. NECMS is designed to support those operations while clinicians retain decision-making authority.

| Scenario | Demonstration steps | Evidence boundary |
| --- | --- | --- |
| A — Normal arrival | Patient board → Register patient. Use clearly fictional names and a clinician-chosen illustrative legacy label; leave DOB unknown if desired. Save. | Browser fixture creates a fictional record. Real registration permissions/retries are also covered by Django/SQL suites; no hosted registration is claimed. |
| B — Unknown immediate care | Rapid Emergency Arrival → fictional department → ambulance → no name/DOB → immediate care already underway. | Provisional identity, temporary label and independent care status. No urgency is invented and care does not wait for form completion. |
| C — Manual urgency/review | Select that encounter on the clinical panel, record an explicitly fictional assessment/manual label. Switch the overlay to the fictional reviewer, enter a rationale and review. Use the coordination board's reviewed-label shortcut to find it. | Actor switching/Auth are simulated. Actual SQL independently rejects self-review in the clinical fixtures; no hospital-approved protocol or computed urgency is supplied. |
| D — Sequencing circumstances | Search `SYN-DEMO-0002` in coordination, select its timeline/actions and explicitly start work. The fixture's P1 example remains waiting for the same service. View recording-time evidence and acknowledge with the fictional configured category/explanation. | A provisional operational review, not an accusation or medical judgement. Missing explanation does not block start. SQL fixtures independently test immutable evidence and audit links. |
| E — Concurrent services | Select an encounter, create another work item, choose the fictional service and an operational task kind. | Multiple tasks coexist without overwriting legacy next-service or clinician text; these are not executable medical orders. |
| F — Reassessment ownership | Create nursing reassessment or urgent-review work, explicitly select the fictional nurse if desired, then acknowledge/complete through explicit actions. | Request, acknowledgement and completion are distinct. A completed task does not manufacture an assessment. No escalation timer or automatic clinical alert is enabled. |
| G — Treatment-space conflict | Assign Fictional bed 1 through clinical care controls. Explain that an attempted conflicting allocation is rejected. Show the automated synthetic-demo assertion and the real independent-connection PostgreSQL result. | Browser conflict is simulated. Actual local SQL proves exactly one committed bed allocation; no real hospital bed or networked Supabase test is involved. |
| H — Hospital isolation | Switch from Synthetic Public A to Private B; show that A's records disappear. Open Restricted shared display and show only its approved-style four-field projection. | Browser isolation is a client simulation; RLS/cursor isolation is independently exercised in local PostgreSQL. Hosted Auth/REST isolation still needs its own approved target. |

Navigate pages and search before suggesting nobody is waiting. Counts cover the entire authorised hospital/department scope, independent of search/service/page filters. Unknown urgency has its own lane and shortcut; reviewed-label shortcuts expose records outside the page. These are visibility filters, not automatic treatment recommendations.

Show changed/expired cursor reconciliation: the UI announces the change and returns to page one. Show stale/disconnected text and denial/logout clearing through the automated browser tests. Do not claim instantaneous revocation notification during an outage.

## Suggested 20-minute meeting

1. Five minutes: validate the hospital's actual coordination problem and professional responsibilities.
2. Ten minutes: scenarios A–H selectively, with a visible fictional-data banner and explicit simulated-versus-SQL evidence.
3. Five minutes: discuss protocol governance, privacy, missing integrations, facility/departments, device/network constraints and acceptance ownership.

Offer a **paid discovery engagement**, not an outcome guarantee: agree stakeholder interviews, approved workflow/protocol references, capability matrix, data/device/privacy requirements, integration inventory, recovery objectives and a costed implementation/pilot plan. A controlled pilot requires an approved target, real Auth/security verification, hospital clinical decisions, downtime/recovery procedures and explicit go/no-go criteria.

## Stop conditions and limitations

Stop if real patient data appears, the fixture/hospital label is missing, an ordinary hosted target is loaded, stale data is unclear or access boundaries behave unexpectedly. Do not paste credentials, show secret-bearing developer tools or present fixtures as real patient care.

The mock demo is not a replacement for real Django/Supabase end-to-end verification. Department filters narrow hospital-wide access; they do not implement department-only staff authorisation. Legacy read routes remain unbounded for compatibility. Revision/count calculation still scans scoped data. Managed TLS/cache/device policy, real session refresh/revocation, professional credential checks, identity merge, formal handover, roster retirement and clinical protocol activation remain unresolved or separately governed. See the 3D reports and existing hosted integration runbook.
