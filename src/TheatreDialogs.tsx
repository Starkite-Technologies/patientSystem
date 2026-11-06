import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { AlertTriangle, Check, Scissors, X, Zap } from 'lucide-react';
import { fullName, hospitalDate, type Visit } from './model';
import { ApiError } from './lib/api';
import {
  bookTheatreCase, cancelTheatreCase, changeTheatrePriority, consequences, deadlineState, deadlineText, delayCategories, durations,
  fromLocalInput, loadPriorityHistory, ncepodLabels, needsDelayReason, priorityWarning, recordTheatreTime, specialties,
  theatrePermissions, theatreStatusLabels, toLocalInput, updateTheatreCase, type PriorityChange, type TheatreBooking, type TheatreData,
} from './lib/theatre';

type Flag = 'haemodynamically_unstable' | 'septic_shock' | 'organ_support' | 'anaesthetic_concern';
const flags: [Flag, string][] = [['haemodynamically_unstable', 'Haemodynamically unstable'], ['septic_shock', 'Septic shock'],
  ['organ_support', 'Vasopressors / organ support'], ['anaesthetic_concern', 'Major anaesthetic concern']];
const flagValue = (value: boolean | null | undefined) => value === true ? 'yes' : value === false ? 'no' : '';
const parseFlag = (value: string) => value === 'yes' ? true : value === 'no' ? false : null;

export function CodeBadge({ code, label, ncepod }: { code: string; label: string; ncepod: keyof typeof ncepodLabels }) {
  return <span className={`code-badge code-${ncepod}`}><strong>{code}</strong> {ncepodLabels[ncepod]}{label !== ncepodLabels[ncepod] && <small>{label}</small>}</span>;
}
export function DeadlineBadge({ booking, now }: { booking: TheatreBooking; now: number }) {
  const state = deadlineState(booking, now);
  return <span className={`deadline-badge deadline-${state ?? `status-${booking.status}`}`}>{state === 'exceeded' || state === 'immediate' ? <AlertTriangle aria-hidden="true" /> : null}{deadlineText(booking, now)}</span>;
}

function Dialog({ title, eyebrow, subtitle, busy, onClose, onSubmit, children, wide }: { title: ReactNode; eyebrow: string; subtitle: string; busy: boolean; onClose: () => void; onSubmit: (event: FormEvent) => void; children: ReactNode; wide?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className={`visit-dialog theatre-dialog ${wide ? 'theatre-dialog-wide' : ''}`} aria-labelledby="theatre-dialog-title" onCancel={e => { if (busy) e.preventDefault(); else onClose(); }}>
    <form onSubmit={onSubmit}>
    <div className="dialog-heading">
      <div className="dialog-title-group"><span className="dialog-symbol"><Scissors size={22} /></span><div>
        <p className="eyebrow">{eyebrow}</p><h2 id="theatre-dialog-title">{title}</h2><p className="dialog-subtitle">{subtitle}</p>
      </div></div>
      <button type="button" className="icon-button" aria-label="Close" disabled={busy} onClick={onClose}><X size={20} /></button>
    </div>
    {children}
    </form>
  </dialog>;
}
function Section({ number, title, hint, children }: { number: string; title: string; hint?: string; children: ReactNode }) {
  return <section className="form-section"><div className="section-heading"><span className="section-number">{number}</span><div><h3>{title}</h3>{hint && <p>{hint}</p>}</div></div>{children}</section>;
}
function FlagFields({ values, onChange, required, disabled }: { values: Partial<Record<Flag, boolean | null>>; onChange: (key: Flag, value: boolean | null) => void; required: boolean; disabled?: boolean }) {
  return <div className="form-grid">{flags.map(([key, label]) => <label key={key}><span>{label}{required && <span className="required" aria-hidden="true"> *</span>}</span>
    <select required={required} disabled={disabled} value={flagValue(values[key])} onChange={e => onChange(key, parseFlag(e.target.value))}>
      <option value="">{required ? 'Choose' : 'Not recorded'}</option><option value="no">No</option><option value="yes">Yes</option>
    </select></label>)}</div>;
}
const message = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;
const codeOption = (c: { code: string; ncepod: keyof typeof ncepodLabels; label: string }) =>
  c.label === ncepodLabels[c.ncepod] ? `${c.code} · ${c.label}` : `${c.code} · ${ncepodLabels[c.ncepod]} · ${c.label}`;

export function BookingDialog({ data, visits, rapid: startRapid, onClose, onSaved, onDenied }: { data: TheatreData; visits: Visit[]; rapid: boolean; onClose: () => void; onSaved: (text: string) => void; onDenied: (text: string) => void }) {
  const [rapid, setRapid] = useState(startRapid);
  const [form, setForm] = useState<Record<string, string>>({ patient: 'new', first_name: '', last_name: '', date_of_birth: '', mrn: '', sex: 'unknown', location: '',
    specialty: '', responsible_consultant: '', diagnosis: '', proposed_operation: '', indication: '', priority_code: '', delay_consequence: '',
    estimated_minutes: '', decision_at: toLocalInput(new Date().toISOString()) });
  const [flagState, setFlags] = useState<Partial<Record<Flag, boolean | null>>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (key: string, value: string) => setForm(previous => ({ ...previous, [key]: value }));
  const chosenVisit = visits.find(v => v.id === form.patient);
  const code = data.codes.find(c => c.code === form.priority_code);
  const warning = rapid ? '' : priorityWarning(code, flagState);
  const consultants = data.staff.filter(s => s.role === 'surgeon');
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    const patient = chosenVisit ? { patient_id: chosenVisit.patient_id, visit_id: chosenVisit.id } : { first_name: form.first_name, last_name: form.last_name, date_of_birth: form.date_of_birth || null };
    const input: Record<string, unknown> = { rapid, ...patient, location: form.location, proposed_operation: form.proposed_operation, mrn: form.mrn, sex: form.sex,
      decision_at: fromLocalInput(form.decision_at) };
    if (!rapid) Object.assign(input, { specialty: form.specialty, responsible_consultant: form.responsible_consultant, diagnosis: form.diagnosis, indication: form.indication,
      priority_code: form.priority_code, delay_consequence: form.delay_consequence, estimated_minutes: Number(form.estimated_minutes), ...flagState });
    try { await bookTheatreCase(input); onSaved(rapid ? 'Immediate case booked. Start the emergency call process now.' : 'Theatre case booked.'); }
    catch (e) { if (e instanceof ApiError && e.status === 401) onDenied(e.message); else setError(message(e, 'Unable to book the case.')); }
    finally { setBusy(false); }
  }
  return <Dialog eyebrow="EMERGENCY THEATRE LIST" title={rapid ? 'Rapid booking: immediate (P0)' : 'Book a theatre case'} busy={busy} onClose={onClose}
    subtitle={rapid ? 'Patient, procedure and location only. Complete the rest after theatre is mobilised.' : 'About 2–3 minutes. Fields marked * are required.'} onSubmit={submit}>
      <div className="dialog-body">
        <div className="segmented" role="group" aria-label="Booking type">
          <button type="button" aria-pressed={!rapid} onClick={() => setRapid(false)}>Standard booking</button>
          <button type="button" aria-pressed={rapid} onClick={() => setRapid(true)}><Zap size={15} />Rapid P0</button>
        </div>
        {rapid && <p className="help-note theatre-alert"><strong>P0 · Immediate.</strong> Also start the hospital's emergency call process: this list only alerts people who have it open.</p>}
        <fieldset disabled={busy} className="visit-fields">
          <Section number="01" title="Patient" hint="Choose a patient already in the department, or enter a new one.">
            <div className="form-grid">
              <label className="full-width">Patient<select value={form.patient} onChange={e => set('patient', e.target.value)}>
                <option value="new">New patient</option>{visits.map(v => <option key={v.id} value={v.id}>{fullName(v)} · {v.patient_ref} · {v.location || 'No location'}</option>)}
              </select></label>
              {!chosenVisit && <>
                <label><span>First name <span className="required" aria-hidden="true">*</span></span><input required maxLength={160} value={form.first_name} onChange={e => set('first_name', e.target.value)} /></label>
                <label><span>Last name <span className="required" aria-hidden="true">*</span></span><input required maxLength={160} value={form.last_name} onChange={e => set('last_name', e.target.value)} /></label>
                <label>Date of birth<input type="date" max={hospitalDate()} value={form.date_of_birth} onChange={e => set('date_of_birth', e.target.value)} /></label>
              </>}
              <label>Hospital MRN<input maxLength={40} value={form.mrn} onChange={e => set('mrn', e.target.value)} placeholder="If known" /></label>
              {!rapid && <label>Sex<select value={form.sex} onChange={e => set('sex', e.target.value)}><option value="unknown">Not recorded</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></select></label>}
              <label><span>Ward / location <span className="required" aria-hidden="true">*</span></span><input required maxLength={120} value={form.location} onChange={e => set('location', e.target.value)} placeholder={chosenVisit?.location || 'e.g. Ward 3, Resus'} /></label>
            </div>
          </Section>
          <Section number="02" title="Operation" hint={rapid ? undefined : 'Diagnosis, operation and why it is needed.'}>
            <div className="form-grid">
              <label className="full-width"><span>Proposed operation <span className="required" aria-hidden="true">*</span></span><input required maxLength={300} value={form.proposed_operation} onChange={e => set('proposed_operation', e.target.value)} placeholder="e.g. Emergency laparotomy" /></label>
              {!rapid && <>
                <label><span>Surgical specialty <span className="required" aria-hidden="true">*</span></span><select required value={form.specialty} onChange={e => set('specialty', e.target.value)}><option value="">Choose</option>{specialties.map(s => <option key={s}>{s}</option>)}</select></label>
                <label><span>Responsible consultant <span className="required" aria-hidden="true">*</span></span><input required list="theatre-consultants" maxLength={120} value={form.responsible_consultant} onChange={e => set('responsible_consultant', e.target.value)} /><datalist id="theatre-consultants">{consultants.map(c => <option key={c.name} value={c.name} />)}</datalist></label>
                <label className="full-width"><span>Diagnosis <span className="required" aria-hidden="true">*</span></span><input required maxLength={300} value={form.diagnosis} onChange={e => set('diagnosis', e.target.value)} /></label>
                <label className="full-width"><span>Indication / brief summary <span className="required" aria-hidden="true">*</span></span><textarea required rows={2} maxLength={1000} value={form.indication} onChange={e => set('indication', e.target.value)} /></label>
                <label><span>Estimated duration <span className="required" aria-hidden="true">*</span></span><select required value={form.estimated_minutes} onChange={e => set('estimated_minutes', e.target.value)}><option value="">Choose</option>{durations.map(d => <option key={d} value={d}>{d} min</option>)}</select></label>
              </>}
              <label><span>Decision to operate <span className="required" aria-hidden="true">*</span></span><input required type="datetime-local" value={form.decision_at} onChange={e => set('decision_at', e.target.value)} /><small className="field-help">The deadline counts from this time.</small></label>
            </div>
          </Section>
          {!rapid && <Section number="03" title="Urgency" hint="Chosen by the clinician. PatientFlow never changes it.">
            <div className="form-grid">
              <label className="full-width"><span>Priority code <span className="required" aria-hidden="true">*</span></span><select required value={form.priority_code} onChange={e => set('priority_code', e.target.value)}>
                <option value="">Choose</option>{data.codes.map(c => <option key={c.code} value={c.code}>{codeOption(c)}{c.example ? ` (e.g. ${c.example})` : ''}</option>)}
              </select></label>
              <label className="full-width"><span>Likely consequence if delayed beyond the target <span className="required" aria-hidden="true">*</span></span><select required value={form.delay_consequence} onChange={e => set('delay_consequence', e.target.value)}><option value="">Choose</option>{Object.entries(consequences).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            </div>
          </Section>}
          {!rapid && <Section number="04" title="Patient condition" hint="Missing information is shown as not recorded, never as normal.">
            <FlagFields values={flagState} required onChange={(key, value) => setFlags(previous => ({ ...previous, [key]: value }))} />
            {warning && <p className="theatre-warning" role="status"><AlertTriangle aria-hidden="true" />{warning}</p>}
          </Section>}
        </fieldset>
      </div>
      <div className="dialog-footer">
        {error && <p className="error dialog-error" role="alert">{error}</p>}
        <div className="footer-content"><span className="footer-help"><span className="required">*</span> Required fields</span><div className="footer-buttons">
          <button type="button" className="secondary" disabled={busy} onClick={onClose}>Cancel</button>
          <button className={rapid ? 'primary danger' : 'primary'} disabled={busy}>{busy ? 'Booking…' : rapid ? 'Book immediate case' : 'Book case'}<Check size={17} /></button>
        </div></div>
      </div>
  </Dialog>;
}

export function CaseDialog({ booking, data, now, onClose, onChanged, onDenied }: { booking: TheatreBooking; data: TheatreData; now: number; onClose: () => void; onChanged: (text: string) => Promise<void>; onDenied: (text: string) => void }) {
  const can = theatrePermissions(data.role);
  const open = ['booked', 'anaesthesia', 'operating'].includes(booking.status);
  const initial = () => ({ location: booking.location, specialty: booking.specialty, responsible_consultant: booking.responsible_consultant, diagnosis: booking.diagnosis,
    proposed_operation: booking.proposed_operation, indication: booking.indication, delay_consequence: booking.delay_consequence, mrn: booking.mrn, sex: booking.sex,
    estimated_minutes: booking.estimated_minutes ? String(booking.estimated_minutes) : '', theatre_id: booking.theatre_id ?? '', planned_start: toLocalInput(booking.planned_start),
    delay_category: booking.delay_category ?? '', delay_note: booking.delay_note, ready_for_theatre: booking.ready_for_theatre ? 'yes' : 'no' });
  const [form, setForm] = useState(initial);
  const [flagState, setFlags] = useState<Partial<Record<Flag, boolean | null>>>({});
  const [newCode, setNewCode] = useState('');
  const [reason, setReason] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [authorisedBy, setAuthorisedBy] = useState('');
  const [history, setHistory] = useState<PriorityChange[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setForm(initial()); setFlags({}); setNewCode(''); setReason(''); }, [booking.version]);
  useEffect(() => { loadPriorityHistory(booking).then(r => setHistory(r.changes)).catch(() => setHistory([])); }, [booking.id, booking.version]);
  const set = (key: string, value: string) => setForm(previous => ({ ...previous, [key]: value }));
  const overdue = needsDelayReason(booking, now);
  // Save closes the window like the ED patient form; one-press actions keep it open.
  const run = async (action: () => Promise<unknown>, done: string, close = false) => {
    setBusy(true); setError('');
    try { await action(); await onChanged(done); if (close) onClose(); }
    catch (e) { if (e instanceof ApiError && e.status === 401) onDenied(e.message); else setError(message(e, 'The change could not be saved.')); }
    finally { setBusy(false); }
  };
  function changedFields() {
    const before = initial() as Record<string, string>; const input: Record<string, unknown> = {};
    const after = form as Record<string, string>;
    const groups: [boolean, string[]][] = [[can.clinical, ['location', 'specialty', 'responsible_consultant', 'diagnosis', 'proposed_operation', 'indication', 'delay_consequence', 'mrn', 'sex', 'estimated_minutes']],
      [can.assignTheatre, ['theatre_id', 'planned_start']], [can.delay, ['delay_category', 'delay_note']], [can.readiness, ['ready_for_theatre']]];
    for (const [allowed, keys] of groups) if (allowed) for (const key of keys) if (after[key] !== before[key]) {
      input[key] = key === 'estimated_minutes' ? (after[key] ? Number(after[key]) : null) : key === 'planned_start' ? fromLocalInput(after[key])
        : key === 'ready_for_theatre' ? after[key] === 'yes' : key === 'theatre_id' || key === 'delay_category' ? after[key] || null : after[key];
    }
    if (can.clinical) Object.assign(input, flagState);
    return input;
  }
  const save = (event: FormEvent) => { event.preventDefault(); const input = changedFields(); if (!Object.keys(input).length) { setError('Nothing has changed.'); return; } void run(() => updateTheatreCase(booking, input), 'Theatre case updated.', true); };
  const name = `${fullName(booking)} · ${booking.patient_ref}`;
  const time = (iso: string | null) => iso ? new Date(iso).toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
  return <Dialog wide eyebrow={booking.booking_ref} title={booking.proposed_operation} subtitle={name} busy={busy} onClose={onClose} onSubmit={save}>
      <div className="dialog-body">
        <div className="case-summary">
          <CodeBadge code={booking.priority_code} label={booking.priority_label} ncepod={booking.ncepod} />
          <DeadlineBadge booking={booking} now={now} />
          <span className={`care-status theatre-status-${booking.status}`}>{theatreStatusLabels[booking.status]}</span>
          {!booking.details_complete && <span className="care-status theatre-incomplete">Details incomplete</span>}
        </div>
        {overdue && <p className="theatre-warning" role="alert"><AlertTriangle aria-hidden="true" />This case is past its deadline. {can.delay ? 'Record the reason for delay below before saving other changes.' : 'Ask the team to record the reason for delay.'}</p>}

        <Section number="01" title="Theatre times" hint="Recorded with one press. Never blocked, even after the deadline.">
          <dl className="time-grid">
            <div><dt>Decision to operate</dt><dd>{time(booking.decision_at)}</dd></div><div><dt>Booked</dt><dd>{time(booking.booked_at)} · {booking.booked_by_name}</dd></div>
            <div><dt>Deadline</dt><dd>{time(booking.deadline_at)}</dd></div><div><dt>Anaesthesia start</dt><dd>{time(booking.anaesthesia_start_at)}</dd></div>
            <div><dt>Surgery start</dt><dd>{time(booking.incision_at)}</dd></div><div><dt>Completed</dt><dd>{time(booking.completed_at)}</dd></div>
          </dl>
          {can.times && open && <div className="action-row">
            <button type="button" className="secondary" disabled={busy || booking.status !== 'booked'} onClick={() => void run(() => recordTheatreTime(booking, 'anaesthesia'), 'Anaesthesia start recorded.')}>Anaesthesia started now</button>
            <button type="button" className="secondary" disabled={busy || !['booked', 'anaesthesia'].includes(booking.status)} onClick={() => void run(() => recordTheatreTime(booking, 'incision'), 'Surgery start recorded.')}>Surgery started now</button>
            <button type="button" className="secondary" disabled={busy || !['anaesthesia', 'operating'].includes(booking.status)} onClick={() => void run(() => recordTheatreTime(booking, 'completed'), 'Case completed.')}>Completed now</button>
          </div>}
          {!booking.theatre_id && open && <small className="field-help">Assign a theatre before recording anaesthesia or surgery start.</small>}
        </Section>

        <fieldset disabled={busy || !open} className="visit-fields">
          {(overdue || booking.delay_category) && <Section number="02" title="Reason for delay" hint="Required once the deadline has passed.">
            <div className="form-grid">
              <label><span>Delay reason {overdue && <span className="required" aria-hidden="true">*</span>}</span><select disabled={!can.delay} required={overdue && can.delay} value={form.delay_category} onChange={e => set('delay_category', e.target.value)}><option value="">Choose</option>{Object.entries(delayCategories).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label>Details<input disabled={!can.delay} maxLength={500} value={form.delay_note} onChange={e => set('delay_note', e.target.value)} /></label>
            </div>
          </Section>}
          <Section number="03" title="Theatre and readiness">
            <div className="form-grid">
              <label>Theatre<select aria-label="Theatre" disabled={!can.assignTheatre} value={form.theatre_id} onChange={e => set('theatre_id', e.target.value)}><option value="">Not assigned</option>{data.theatres.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
              <label>Planned start<input aria-label="Planned start" disabled={!can.assignTheatre} type="datetime-local" value={form.planned_start} onChange={e => set('planned_start', e.target.value)} /></label>
              <label>Ready for theatre<select aria-label="Ready for theatre" disabled={!can.readiness} value={form.ready_for_theatre} onChange={e => set('ready_for_theatre', e.target.value)}><option value="no">Not yet</option><option value="yes">Ready</option></select></label>
            </div>
            <FlagFields disabled={!can.clinical} required={false} values={{ haemodynamically_unstable: booking.haemodynamically_unstable, septic_shock: booking.septic_shock, organ_support: booking.organ_support, anaesthetic_concern: booking.anaesthetic_concern, ...flagState }} onChange={(key, value) => setFlags(previous => ({ ...previous, [key]: value }))} />
          </Section>
          <Section number="04" title="Clinical details">
            <div className="form-grid">
              <label className="full-width">Proposed operation<input disabled={!can.clinical} required maxLength={300} value={form.proposed_operation} onChange={e => set('proposed_operation', e.target.value)} /></label>
              <label>Specialty<select disabled={!can.clinical} value={form.specialty} onChange={e => set('specialty', e.target.value)}><option value="">Not recorded</option>{specialties.map(s => <option key={s}>{s}</option>)}</select></label>
              <label>Responsible consultant<input disabled={!can.clinical} maxLength={120} value={form.responsible_consultant} onChange={e => set('responsible_consultant', e.target.value)} /></label>
              <label className="full-width">Diagnosis<input disabled={!can.clinical} maxLength={300} value={form.diagnosis} onChange={e => set('diagnosis', e.target.value)} /></label>
              <label className="full-width">Indication<textarea disabled={!can.clinical} rows={2} maxLength={1000} value={form.indication} onChange={e => set('indication', e.target.value)} /></label>
              <label>Consequence if delayed<select disabled={!can.clinical} value={form.delay_consequence} onChange={e => set('delay_consequence', e.target.value)}><option value="">Not recorded</option>{Object.entries(consequences).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label>Estimated duration<select disabled={!can.clinical} value={form.estimated_minutes} onChange={e => set('estimated_minutes', e.target.value)}><option value="">Not recorded</option>{durations.map(d => <option key={d} value={d}>{d} min</option>)}</select></label>
              <label>Location<input disabled={!can.clinical} required maxLength={120} value={form.location} onChange={e => set('location', e.target.value)} /></label>
              <label>Hospital MRN<input disabled={!can.clinical} maxLength={40} value={form.mrn} onChange={e => set('mrn', e.target.value)} /></label>
            </div>
          </Section>
        </fieldset>

        <Section number="05" title="Priority" hint="Changed only by a consultant surgeon or anaesthetist, with a reason. Every change is kept.">
          {can.changePriority && open && <div className="form-grid">
            <label>New priority code<select value={newCode} onChange={e => setNewCode(e.target.value)}><option value="">Choose</option>{data.codes.filter(c => c.code !== booking.priority_code).map(c => <option key={c.code} value={c.code}>{codeOption(c)}</option>)}</select></label>
            <label>Clinical reason<input maxLength={500} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Developed septic shock" /></label>
            <div className="full-width"><button type="button" className="secondary" disabled={busy || !newCode || reason.trim().length < 5} onClick={() => void run(() => changeTheatrePriority(booking, newCode, reason), 'Priority changed.')}>Change priority</button></div>
          </div>}
          <ul className="priority-history">{history === null ? <li>Loading history…</li> : history.length ? history.map((h, i) => <li key={i}><strong>{h.from_code} → {h.to_code}</strong> · {h.reason}<small>{h.changed_by_name} · {time(h.changed_at)}</small></li>) : <li>No changes since booking ({booking.priority_code}).</li>}</ul>
        </Section>

        {can.cancel && booking.status === 'booked' && <Section number="06" title="Cancel case" hint={data.role === 'coordinator' ? 'Record the consultant who authorised the cancellation.' : 'Only before anaesthesia starts.'}>
          <div className="form-grid">
            <label>Reason<input maxLength={500} value={cancelReason} onChange={e => setCancelReason(e.target.value)} /></label>
            {data.role === 'coordinator' && <label>Authorised by<input maxLength={120} value={authorisedBy} onChange={e => setAuthorisedBy(e.target.value)} /></label>}
            <div className="full-width"><button type="button" className="secondary danger-outline" disabled={busy || cancelReason.trim().length < 5 || (data.role === 'coordinator' && authorisedBy.trim().length < 3)} onClick={() => { if (window.confirm(`Cancel ${booking.booking_ref}?`)) void run(() => cancelTheatreCase(booking, cancelReason, authorisedBy), 'Case cancelled.'); }}>Cancel this case</button></div>
          </div>
        </Section>}
      </div>
      <div className="dialog-footer">
        {error && <p className="error dialog-error" role="alert">{error}</p>}
        <div className="footer-content"><span className="footer-help">{open ? 'Save applies sections 02–04.' : 'This case is closed.'}</span><div className="footer-buttons">
          <button type="button" className="secondary" disabled={busy} onClick={onClose}>Close</button>
          {open && (can.clinical || can.assignTheatre || can.readiness || can.delay) && <button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}<Check size={17} /></button>}
        </div></div>
      </div>
  </Dialog>;
}
