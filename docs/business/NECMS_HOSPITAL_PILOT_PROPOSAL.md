# NECMS discovery and conditional hospital pilot proposal

2026-10-20 · Starkite Technologies · **draft for discussion, not an agreed contract or quotation**.

## Problem and proposed solution

Emergency departments may struggle to maintain a shared view of arrivals, recorded urgency, pending services, responsibility, treatment spaces and care sequencing. The prospective client's concern—lower-urgency patients sometimes receiving care before higher-urgency patients—requires workflow investigation rather than an assumption that each differing sequence is inappropriate.

NECMS combines emergency arrival, provisional assessment documentation, independent review, concurrent operational tasks, staff-controlled coordination and immutable event evidence. It can make the recorded sequence and its explanations visible. It does not prescribe treatment order, diagnose, score observations automatically or establish that care was appropriate. No clinical or commercial outcomes have been measured.

## Suggested engagement sequence

1. **Fictional demonstration:** agreed audience and scenarios, no real data, signed demonstration feedback distinct from pilot approval.
2. **Paid discovery, subject to agreement:** interview reception, nursing, medical, coordination, hospital administration, clinical governance, information governance and IT; observe approved workflows; inventory devices/network/integrations; deliver a requirements register, risk/gap assessment, approved scope, capability matrix and costed implementation options.
3. **Synthetic integration rehearsal:** designated isolated hosting, actual Supabase Auth/REST/RLS tests, migration compatibility and restored-backup evidence, realistic load/device/accessibility tests and support rehearsal.
4. **Conditional limited pilot:** one named emergency department, selected trained staff and agreed hours/duration/workload. Live data is permitted only after separate clinical, security, privacy and hosting sign-offs, an executed agreement and explicit go-live approval. Start with an agreed parallel/shadow workflow where clinically and legally approved; the hospital chooses its authoritative record and fallback.

Hospital/site, duration, patient populations, concurrent users, record volumes and support hours are **TBD**. Multi-hospital technology does not imply approval for national deployment or inter-hospital record sharing. A pilot excludes autonomous triage/treatment, unapproved escalation, prescribing/orders/results integrations, offline clinical synchronisation, automated identity merge and replacement of the hospital's official record unless separately commissioned and validated.

## Participating roles and proposed capability matrix

Capabilities below already exist as software identifiers. This is a **proposed hospital assignment**, not proof of professional authority. `protocol.approve` is reserved; no operational protocol-approval route is provided. No roles are automatically granted by 3E migrations. The fictional harness assigns test capabilities only in memory, without hosted accounts.

| Role | Proposed routine scope / implemented capabilities | Explicit exclusions and decisions |
| --- | --- | --- |
| Reception | Minimum arrival through `arrival.register`; context metadata shell without clinical lists | No triage, queue, clinical timeline, exception or staff-management reads. Full reception-minimal identity lookup/reconciliation requires a separately reviewed projection and hospital policy; broad identity/encounter read must not be substituted. |
| Nurse | Approved bedside/intake scope: `arrival.register`, `triage.read`, `triage.create`, `triage.reassess`, `clinical.timeline.read`, `reassessment.request`, relevant operational actions; supporting `encounter.read`, `patient.identity.read`, `resource.read`, `queue.read` only if approved | Independent review, provisional priority amendment, treatment recording, identity reconciliation and professional scope require hospital decisions. The fictional nurse set is illustrative, not a scope-of-practice determination. |
| Doctor | Approved assessment/review/care scope: `triage.create`, `triage.reassess`, `triage.review`, `clinical.timeline.read`, relevant care/service actions and companion reads | Review own assessment remains disallowed. `priority.amend`, treatment recording and other capabilities require explicit approval. No prescribing or protocol activation is implied. |
| Emergency coordinator | Approved queue/call/responsibility functions: `queue.coordinate`, `patient.call`, `work.create`, `work.assign`, service/start/completion actions, `reassessment.request`, `escalation.acknowledge`, `exception.review`, companion reads | A coordinator job title does not confer clinical assessment or review authority. Who may record care start, close care or explain sequencing must be approved. |
| Hospital administrator | `membership.manage`, `hospital.configure`; delegation limited to held capabilities; reasoned changes and no self-management | No implicit clinical read or clinical role. An admin-only user cannot delegate clinical capabilities they do not hold; a separately authorised governance/provisioning operator is required. No UI for arbitrary Auth account creation or role/capability catalogue editing is claimed. |
| Demonstration facilitator | Broad union of synthetic grants for a walkthrough | Not a proposed operational role. Mock actor/role switching is neither real authentication nor proof of professional credentials. |

Hospital membership is per hospital and can differ across facilities. A hospital ID does not grant access. Department filters narrow hospital-wide authorised data; department-only authorisation is unfinished. Department-restricted staff cannot be piloted by treating a UI filter as an access control.

## Responsibilities and infrastructure

| Owner | Required contribution before pilot |
| --- | --- |
| Hospital executive sponsor | Scope, procurement route, funding decision, accountable acceptance owner and stop/go authority |
| Clinical leadership | Approved protocol/version, professional scope, review/amendment, readiness/exception, escalation/reassessment and handover policies; clinical safety acceptance |
| Nursing/medical/reception/coordination representatives | Validate real scenarios, forms, responsibilities, training and fallback procedures; identify workflow mismatch |
| Hospital IT / hosting owner | Approved isolated test and pilot environments, device/browser management, connectivity assessment, HTTPS/network access, monitoring, backup/restore and recovery objectives |
| Privacy/information-governance owner | Data authority, privacy assessment, audience/projection approval, retention/access/logging/device policies and incident responsibilities; legal review where required |
| Starkite Technologies | Agreed implementation and synthetic verification, discrepancy/risk reporting, configuration review, migration/recovery runbooks, training materials, support/maintenance plan and evidence handover |

Target infrastructure retains React/Vite, Django/DRF, Supabase Auth and PostgreSQL/RLS. Supported browser/device matrix, server placement/region, subscriptions and hardware must be agreed after assessment. The free Supabase account is a development choice, not an endorsed clinical service level. Do not use a real-data database for destructive testing or copy patient records into development. No paid infrastructure is created by this proposal.

## Privacy, training and operational acceptance

Use synthetic-only test data and least-privilege accounts. Approve separate live-data handling, retention, access review, session/device policy, wall-display audience, audit monitoring, hosting/provider responsibilities and incident escalation before a pilot. Verify real Auth expiry/revocation, direct REST/RLS, restricted fields, proxy/cache behaviour and restoration. Unresolved ownership stays quarantined.

Training includes known/unidentified arrival, urgency-source limitations, patient/page search, same-service and parallel tasks, responsibility/acknowledgement, manual reassessment, care-before-registration, space conflicts, evidence/addenda, discharge/history, stale-data recognition, logout/privacy and downtime. Rehearse role-specific scenarios and record attendance/competency according to hospital policy. Clinical judgement and existing emergency procedures remain authoritative.

Proposed software acceptance: A–J demonstration succeeds; unknown patients remain visible; no cross-hospital access; restricted display excludes identity; explicit actions preserve history; duplicate retries and space conflicts are rejected; reset is synthetic-only; target hardware is usable. Separate clinical/hosting/privacy/security sign-offs remain mandatory. No universal response-time, uptime or waiting-time target is invented here.

## Proposed success measures, definitions and limitations

Agree baselines, denominators, observation windows, owners and targets during discovery. Suggested measures are not claims of achieved improvement:

- **Documentation coverage:** eligible pilot encounters with required arrival, responsibility and review documentation / all eligible pilot encounters; hospital defines required fields and exclusions.
- **Operational visibility:** sampled active encounters with an agreed current service/responsible-person/location record / sampled active encounters. Missing data is reported, not inferred.
- **Sequencing-review documentation:** recorded provisional sequencing reviews with a staff explanation/acknowledgement / recorded provisional reviews; this measures documentation, never clinical correctness.
- **Queue and history usability:** trained users completing agreed tasks, observed errors and qualitative feedback, stratified by role/device.
- **Technical reliability:** observed request latency/error distributions at agreed load, stale-display incidents, access-test outcomes and restoration time against approved objectives.
- **Patient-flow timing, if approved:** timestamp definitions, late-entry/clock differences and case-mix constraints must be established before analysing waiting times. Clinical outcomes and causal benefit require a separate evaluation design.

No raw patient data should appear in commercial reporting; use approved privacy-safe aggregates. Missing or biased records must be disclosed. Do not interpret a count of apparent order changes as malpractice or proof of avoidable delay.

## Commercial structure: placeholders only

| Work package | Proposed charging basis | Price placeholder / quotation inputs |
| --- | --- | --- |
| Discovery/workflow assessment | Fixed deliverables or agreed time-based assessment | `[NAD amount TBD]`; facilities, interview/observation days, travel, stakeholders, deliverables |
| Configuration/implementation | Scoped project with change control and acceptance milestones | `[NAD amount TBD]`; users/roles, data provenance, integrations, migration effort, hosting/security and load requirements |
| Staff training | Sessions/cohorts or agreed training package | `[NAD amount TBD]`; shifts, staff numbers, materials, trainer location and refresher needs |
| Support/maintenance | Agreed recurring service tier | `[NAD amount TBD per period]`; coverage hours, response objectives, monitoring, updates and incident responsibilities |
| Optional multi-hospital expansion | Separately assessed per-site/organisation scope | `[NAD amount TBD]`; facilities, governance, connectivity, configuration and support complexity |
| Hosting/provider/hardware costs | Explicit pass-through or customer-managed arrangement | `[costs TBD]`; plans, region, storage, backups, service levels, devices and taxes |

No fees, budget, customer commitment, margin, service levels or payment terms are agreed. A quotation needs authorised requirements, delivery/acceptance scope, schedule, procurement/tax review, ownership/licensing terms, provider costs, exclusions and ongoing responsibilities. Commercial negotiation is separate from clinical and security approval.

## Support, stop conditions and next decision

Agree support contacts/hours, version/change management, vulnerability review, maintenance windows, training refreshers, access review, audit/retention operations, recovery drills and incident response. Do not promise continuous availability without assessed infrastructure and contractual service levels. Intermittent connectivity requires an approved manual fallback; no durable offline clinical-write workflow exists.

Pause/stop a pilot for unsafe workflow, privacy breach, uncertain identity/ownership, unreliable freshness, access failures, loss of authoritative history, untested recovery or hospital withdrawal of approval. Record the authorised rollback/forward-recovery decision while preserving new records and audit evidence.

Requested next decision: agree a fictional walkthrough and, if useful, scope a paid discovery engagement. This document is not consent to a live-data pilot, hosted migration, clinical protocol activation or deployment.
