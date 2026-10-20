# NECMS clinical governance and pilot approval checklist

2026-10-20. **All hospital approvals outstanding.** This is an agenda and evidence checklist, not a clinical protocol, legal opinion or operational authorisation. Software capability names do not establish professional qualifications.

| Decision requiring approval | Required evidence and responsible owner | Status |
| --- | --- | --- |
| 1. Protocol and version | Clinical leadership approves protocol provenance/licence/version, populations, categories, display vocabulary, exceptions and validation plan. No P1–P5 mapping to an approved protocol is assumed. | Unapproved; no active scoring engine |
| 2. Professional responsibilities | Medical/nursing governance defines assessment, review, amendment, care-start documentation, delegation, coordination and access scopes; HR/professional verification responsibility documented. | Unapproved; no credential registry |
| 3. Review and amendments | Approve independent-review staffing, acceptance/rejection, authority for priority amendment, late entry and addenda/supersession/corrections preserving originals. | Provisional independent review exists; correction workflow incomplete |
| 4. Treatment-order exceptions | Define same-service/readiness interpretation, evidence audience, categories, explanation/acknowledgement ownership, independent review and non-punitive handling. Explain resource/patient needs and avoid automatic accusations. | Software records provisional evidence only; policy unsigned |
| 5. Reassessment | Define who requests/performs/documents reassessment and what qualifies as completion. Hospital determines any timing/clinical criteria through separate validation. | Manual work requests exist; no approved intervals |
| 6. Escalation | Name recipients, covering staff, acknowledgement/fallback and incident ownership; validate any future triggers/deadlines separately. | Manual ownership/acknowledgement only; no automatic escalation |
| 7. Service readiness | Nursing/medical/service leads define eligible/ready states, parallel requests, resource suitability, reassignment and cancellation/completion meanings. | Operational flags exist; no medical suitability rules |
| 8. Unidentified patients | Approve temporary identifiers/wristbands, emergency care before registration, identity checks, duplicate review, reconciliation and any future merge authority. | Provisional identity/completion exists; no automatic merge |
| 9. Shift handover | Define outgoing/incoming responsibility, explicit acceptance, outstanding tasks and escalation coverage; distinguish task reassignment from a formal clinical handover. | Reassignment/acceptance exists; formal handover incomplete |
| 10. Privacy and retention | Information governance approves least-privilege roles, reception/department/display datasets, shared devices, retention, access review, audit oversight, reporting and applicable legal review. | Hospital isolation local-tested; department-only and reception-minimal projections incomplete |
| 11. Downtime and recovery | Clinical/IT owners approve authoritative record, paper/manual process, late entry/reconciliation, connectivity/power fallback, recovery operator, RPO/RTO, restore and cutover rehearsal. | Stale indicators/retry IDs and local recovery tested; no offline-write queue or managed recovery approval |
| 12. Clinical safety and acceptance | Hospital safety lead reviews hazard register, synthetic scenarios, staff training, human factors/accessibility, monitoring, stop criteria and final go/no-go authority. | No clinical validation or pilot approval |

## Evidence and sign-off gates

- [ ] Named clinical accountable executive and multidisciplinary review group.
- [ ] Versioned protocol/workflow/scope documents with explicit approval dates and change-control owner.
- [ ] Clinical/operational separation understood: urgency, care status, physical location and service work are independent.
- [ ] Unknown urgency remains explicit; incomplete administration/review does not prevent emergency care.
- [ ] Queue order is visibility, not a mandatory treatment instruction; explanations do not establish clinical appropriateness.
- [ ] History and audit corrections preserve originals; access/review and safeguarding of sensitive narratives agreed.
- [ ] Approved capability matrix, professional scope and independent-review staffing validated with real users.
- [ ] Actual hosted Auth/REST/RLS/display/revocation, schema compatibility and recovery passed on an approved synthetic target.
- [ ] Device, reception/department privacy and downtime gaps resolved or excluded through an explicit safe scope.
- [ ] Training, incident reporting, support, pilot monitoring and stop/forward-recovery procedures accepted.
- [ ] Separate signed security/privacy/hosting approvals and specific live-data pilot authorisation.

Sign-off must identify hospital, department, software/migration version, approving person/role, evidence, exclusions, date and review expiry. Do not prefill approval names or mark boxes from local software tests. No protocol, clinical threshold, notification or escalation timer is activated by this milestone.
