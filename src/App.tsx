import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Activity, ArrowRight, BedDouble, Check, ChevronRight, ClipboardList, Clock3, LayoutDashboard, LogOut, Monitor, Plus, RefreshCw, Search, ShieldCheck, Users, X } from 'lucide-react';
import { actions, active, ageAtDate, hospitalDate, canEditVisits, canManageResources, compareVisits, fullName, priorities, queuePosition, statuses, waitLabel, type BoardData, type Resource, type Visit, type VisitInput } from './model';
import { configurationError, supabase } from './lib/supabase';
import { loadBoard, resetDemo, saveVisit, setResourceState } from './lib/store';

type View = 'board' | 'resources' | 'activity' | 'archive';
const emptyBoard: BoardData = { visits: [], resources: [], events: [], role: 'viewer' };

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(!supabase);
  const [authError, setAuthError] = useState('');
  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    supabase.auth.getSession().then(({ data, error }) => {
      if (alive) { setSession(data.session); setAuthError(error?.message ?? ''); setAuthReady(true); }
    }).catch(error => { if (alive) { setAuthError(String(error)); setAuthReady(true); } });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => { setSession(next); setAuthReady(true); });
    return () => { alive = false; subscription.unsubscribe(); };
  }, []);
  if (configurationError) return <div className="login-shell"><div className="login-card"><h1>Connection setup</h1><p>{configurationError}</p></div></div>;
  if (!authReady) return <div className="login-shell">Checking staff session…</div>;
  if (supabase && !session) return <Login initialError={authError} />;
  return <Board key={session?.user.id ?? 'demo'} email={session?.user.email} />;
}

function Login({ initialError }: { initialError: string }) {
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const form = new FormData(event.currentTarget);
    try {
      const { error } = await supabase!.auth.signInWithPassword({ email: String(form.get('email')), password: String(form.get('password')) });
      if (error) throw error;
    } catch (error) { setError(error instanceof Error ? error.message : 'Unable to sign in.'); }
    finally { setBusy(false); }
  }
  return <div className="login-shell"><form className="login-card" onSubmit={submit}>
    <div className="brand-icon"><Activity size={26} /></div><p className="eyebrow">PATIENTFLOW</p>
    <h1>Your department.<br />One shared view.</h1><p>Sign in with your hospital staff account.</p>
    <label>Email<input type="email" name="email" autoComplete="username" required /></label>
    <label>Password<input type="password" name="password" autoComplete="current-password" required /></label>
    {error && <p className="error" role="alert">{error}</p>}
    <button className="primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}<ArrowRight size={17} /></button>
    <small>Accounts are provisioned by your administrator.</small>
  </form></div>;
}

function Board({ email }: { email?: string }) {
  const [data, setData] = useState<BoardData>(emptyBoard);
  const [view, setView] = useState<View>('board');
  const [search, setSearch] = useState('');
  const [priority, setPriority] = useState('all');
  const [status, setStatus] = useState('all');
  const [action, setAction] = useState('all');
  const [editor, setEditor] = useState<Visit | 'new' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [connection, setConnection] = useState(supabase ? 'Connecting' : 'Local demo');
  const [loading, setLoading] = useState(true);
  const [wall, setWall] = useState(false);
  const [now, setNow] = useState(Date.now());
  const generation = useRef(0);
  const canEdit = canEditVisits(data.role);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    try {
      const next = await loadBoard();
      if (request === generation.current) { setData(next); setSyncedAt(Date.now()); setError(''); }
    } catch (error) { if (request === generation.current) setError(error instanceof Error ? error.message : 'Could not refresh the board.'); }
    finally { if (request === generation.current) setLoading(false); }
  }, []);
  useEffect(() => {
    void refresh();
    const reload = () => void refresh();
    window.addEventListener('storage', reload); window.addEventListener('patientflow-change', reload); window.addEventListener('online', reload);
    const timer = window.setInterval(() => { setNow(Date.now()); void refresh(); }, 30000);
    const channel = supabase?.channel('department-board')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'visits' }, reload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'resources' }, reload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'patients' }, reload)
      .subscribe(state => { setConnection(state === 'SUBSCRIBED' ? 'Live' : 'Reconnecting'); if (state === 'SUBSCRIBED') reload(); });
    return () => { generation.current++; clearInterval(timer); window.removeEventListener('storage', reload); window.removeEventListener('patientflow-change', reload); window.removeEventListener('online', reload); if (channel) void supabase!.removeChannel(channel); };
  }, [refresh]);
  useEffect(() => { if (!notice) return; const timeout = setTimeout(() => setNotice(''), 5000); return () => clearTimeout(timeout); }, [notice]);
  const current = data.visits.filter(active);
  const waiting = current.filter(v => ['waiting', 'ready'].includes(v.status));
  const available = data.resources.filter(r => r.state === 'available' && !current.some(v => v.resource_id === r.id));
  const visible = data.visits.filter(v => view === 'archive' ? !active(v) : active(v))
    .filter(v => `${fullName(v)} ${v.patient_ref} ${v.complaint} ${v.assigned_to} ${v.location}`.toLowerCase().includes(search.toLowerCase()))
    .filter(v => priority === 'all' || v.priority === Number(priority))
    .filter(v => status === 'all' || v.status === status)
    .filter(v => action === 'all' || v.next_action === action).sort(compareVisits);
  const stale = Boolean(error) || (syncedAt !== null && now - syncedAt > 60000);
  return <div className={`app-shell ${wall ? 'wall-mode' : ''}`}>
    {!wall && <aside className="sidebar">
      <a className="brand" href="#" onClick={e => { e.preventDefault(); setView('board'); }}><span className="brand-icon"><Activity size={24} /></span><span>Patient<span className="brand-light">Flow</span><small>CARE, CONNECTED</small></span></a>
      <div className="workspace"><span className="workspace-icon">ED</span><div>Emergency department<small>Department workspace</small></div><ChevronRight size={14} /></div>
      <p className="nav-label">WORKSPACE</p>
      <nav aria-label="Main navigation">{([
        ['board', LayoutDashboard, 'Patient board'], ['resources', BedDouble, 'Spaces & resources'], ['activity', ClipboardList, 'Activity log'], ['archive', Users, 'Completed visits'],
      ] as const).map(([key, Icon, label]) => <button key={key} className={view === key ? 'nav-active' : ''} onClick={() => { setView(key); setSearch(''); setPriority('all'); setStatus('all'); setAction('all'); }}><Icon size={18} />{label}{key === 'board' && <span className="nav-count">{current.length}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><ShieldCheck size={20} /><p>Shared visibility.<br /><strong>Clinician-led decisions.</strong></p></div>
      <div className="user"><span className="avatar">{email ? email.slice(0, 2).toUpperCase() : 'DC'}</span><div>{email ?? `Demo ${data.role}`}<small>{data.role}</small></div>{supabase && <button className="icon-button" aria-label="Sign out" onClick={async () => { const { error } = await supabase!.auth.signOut(); if (error) setError(error.message); }}><LogOut size={17} /></button>}</div>
    </aside>}
    <main>
      <header className="topbar"><span>Emergency department <ChevronRight size={13} /> <strong>{view === 'board' ? 'Patient board' : view === 'resources' ? 'Spaces & resources' : view === 'archive' ? 'Completed visits' : 'Activity log'}</strong></span><span className="topbar-date">{new Date(now).toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' })}<Clock3 size={15} />{new Date(now).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}</span></header>
      {!supabase && <div className="demo-banner"><span><strong>Demo workspace</strong> · Fictional patients, saved in this browser. Priority colours are illustrative.</span><button onClick={() => { if (window.confirm('Reset all fictional demo patients and changes?')) { resetDemo(); setNotice('Demo reset.'); } }}>Reset demo</button></div>}
      <div className="page-content">
        <div className="page-heading"><div><p className="eyebrow">DEPARTMENT OVERVIEW</p><h1>{view === 'board' ? 'Patient board' : view === 'resources' ? 'Spaces & resources' : view === 'archive' ? 'Completed visits' : 'Activity log'}</h1><p>{view === 'board' ? 'Every patient. Every next step. One shared view.' : view === 'resources' ? 'See what is available and where patients are receiving care.' : view === 'archive' ? 'Discharged and transferred patients remain in the visit history.' : 'A record of patient and resource changes.'}</p></div><div className="heading-actions"><button className="secondary" onClick={() => { setWall(!wall); setView('board'); }}><Monitor size={16} />{wall ? 'Exit display' : 'Display mode'}</button>{!wall && canEdit && <button className="primary" onClick={() => setEditor('new')}><Plus size={18} />Register patient</button>}</div></div>
        {error && <div className="error" role="alert">{error} <button onClick={() => void refresh()}>Retry</button></div>}
        {notice && <div className="notice" role="status"><Check size={16} />{notice}</div>}
        <section className="stats" aria-label="Department totals">
          <Stat label="Active patients" value={current.length} icon={<Users size={19} />} detail="Across the department" />
          <Stat label="High priority" value={current.filter(v => v.priority <= 2).length} icon={<Activity size={19} />} detail="Assigned P1 or P2" tone="red" />
          <Stat label="Waiting / ready" value={waiting.length} icon={<Clock3 size={19} />} detail="Pending their next service" tone="amber" />
          <Stat label="Available spaces" value={available.length} icon={<BedDouble size={19} />} detail={`Of ${data.resources.length} tracked spaces`} />
        </section>
        {(view === 'board' || view === 'archive') && <section className="board-panel">
          <div className="panel-heading"><div><h2>{view === 'archive' ? 'Visit history' : 'Department patients'} <span className="count-pill">{visible.length}</span></h2><p>Ordered by assigned priority, then arrival time.</p></div><div className={`sync-status ${stale ? 'sync-warning' : ''}`}><span className="status-dot" />{stale ? 'Updates delayed' : connection}<button className="icon-button" aria-label="Refresh board" onClick={() => void refresh()}><RefreshCw size={14} /></button></div></div>
          <div className="filters"><label className="search"><Search size={17} /><input aria-label="Search patients" placeholder="Search patients, reference, or clinician…" value={search} onChange={e => setSearch(e.target.value)} /></label><select aria-label="Filter by priority" value={priority} onChange={e => setPriority(e.target.value)}><option value="all">All priorities</option><option value={0} disabled>Choose a priority</option>{priorities.map((p, i) => <option key={p} value={i + 1}>{p}</option>)}</select><select aria-label="Filter by status" value={status} onChange={e => setStatus(e.target.value)}><option value="all">All statuses</option>{Object.entries(statuses).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select><select aria-label="Filter by next service" value={action} onChange={e => setAction(e.target.value)}><option value="all">All services</option>{Object.entries(actions).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          <div className="table-scroll" role="region" aria-label="Patient list" tabIndex={0}><table><thead><tr><th>Patient</th><th>Priority</th><th>Status</th><th>Location</th><th>Next step / queue</th><th>Clinician</th><th>Time in ED</th>{!wall && <th><span className="sr-only">Details</span></th>}</tr></thead><tbody>{visible.map(v => <tr key={v.id}>
            <td><div className="patient-cell">{!wall && <span className={`patient-avatar priority-border-${v.priority}`}>{fullName(v).split(' ').map(n => n[0]).slice(0, 2).join('')}</span>}<div><strong>{wall ? v.patient_ref : fullName(v)}</strong><small title="Age calculated at arrival">{wall ? `${ageAtDate(v.date_of_birth, hospitalDate(v.arrived_at)) ?? '—'} years` : `${v.patient_ref} · ${ageAtDate(v.date_of_birth, hospitalDate(v.arrived_at)) ?? '—'} years`}</small>{!wall && <span className="complaint">{v.complaint}{v.names_need_review && <small>Name needs review</small>}</span>}</div></div></td>
            <td><span className={`priority priority-${v.priority}`}><span />{priorities[v.priority - 1]}</span></td>
            <td><span className={`care-status status-${v.status}`}>{statuses[v.status]}</span></td>
            <td><span className="location"><BedDouble size={14} />{v.location || 'Unassigned'}</span></td>
            <td><div className="next-step">{actions[v.next_action]}{queuePosition(v, data.visits) !== null && <small><span className="queue-number">#{queuePosition(v, data.visits)}</span> in this service queue</small>}</div></td>
            <td className={v.assigned_to === 'Unassigned' || !v.assigned_to ? 'muted' : ''}>{v.assigned_to || 'Unassigned'}</td>
            <td><span className="time"><Clock3 size={14} />{waitLabel(v.arrived_at, active(v) ? now : Date.parse(v.updated_at))}</span></td>
            {!wall && <td><button className="icon-button" aria-label={`View ${fullName(v)}`} onClick={() => setEditor(v)}><ChevronRight size={18} /></button></td>}
          </tr>)}</tbody></table></div>
          {!visible.length && <div className="empty"><Users size={28} /><h3>{loading ? 'Loading patients…' : 'No patients to show'}</h3><p>{loading ? 'Fetching the latest board.' : 'Change your filters or register a patient.'}</p></div>}
          <footer className="board-footer"><span><ShieldCheck size={14} />Priorities assigned by clinical staff · Queue positions can change</span><span>{syncedAt ? `Last synced ${new Date(syncedAt).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}` : 'Not synchronised'}</span></footer>
        </section>}
        {view === 'resources' && <section className="resource-grid">{data.resources.map(r => {
          const patient = current.find(v => v.resource_id === r.id);
          return <article className="resource-card" key={r.id}><div className="resource-top"><BedDouble size={22} /><span className={`care-status ${patient ? 'status-in_treatment' : r.state === 'available' ? 'status-ready' : 'status-awaiting_results'}`}>{patient ? 'Occupied' : r.state}</span></div><h2>{r.name}</h2><p>{r.kind}</p><div className="resource-patient">{patient ? <><strong>{fullName(patient)}</strong><small>{patient.patient_ref} · {statuses[patient.status]}</small></> : <span>{r.state === 'available' ? 'Ready for assignment' : 'Unavailable for assignment'}</span>}</div>{canManageResources(data.role) && <label>Space status<select aria-label={`Status for ${r.name}`} value={r.state} disabled={Boolean(patient)} onChange={async e => { try { await setResourceState(r, e.target.value as Resource['state']); await refresh(); setNotice('Space status updated.'); } catch (error) { setError(error instanceof Error ? error.message : 'Could not update space.'); } }}><option value="available">Available</option><option value="cleaning">Cleaning</option><option value="unavailable">Unavailable</option></select></label>}</article>;
        })}</section>}
        {view === 'activity' && <section className="activity-panel"><h2>Recent changes</h2>{!data.events.length && <div className="empty"><ClipboardList size={28} /><h3>No changes yet</h3><p>Register or update a patient to see activity here.</p></div>}{data.events.map(event => <div className="activity-event" key={event.id}><span className="event-icon"><ClipboardList size={16} /></span><div><strong>{event.summary}</strong><small>{event.actor} · {new Date(event.created_at).toLocaleString('en-ZA')}</small></div><span className="count-pill">{event.action}</span></div>)}</section>}
        <p className="page-footnote">PatientFlow <span>•</span> Emergency care workspace {wall && <span>• Patient names hidden in display mode</span>}</p>
      </div>
    </main>
    {editor && <VisitDialog visit={editor === 'new' ? undefined : editor} data={data} readonly={!canEdit} onClose={() => setEditor(null)} onSaved={async () => { setEditor(null); await refresh(); setNotice(editor === 'new' ? 'Patient registered.' : 'Patient record updated.'); }} />}
  </div>;
}

function Stat({ label, value, icon, detail, tone = 'teal' }: { label: string; value: number; icon: React.ReactNode; detail: string; tone?: string }) {
  return <article className="stat"><div><span>{label}</span><span className={`stat-icon ${tone}`}>{icon}</span></div><strong>{value.toString().padStart(2, '0')}</strong><small>{detail}</small></article>;
}

function VisitDialog({ visit, data, readonly, onClose, onSaved }: { visit?: Visit; data: BoardData; readonly: boolean; onClose: () => void; onSaved: () => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [input, setInput] = useState<VisitInput>(visit ? { patient_ref: visit.patient_ref, first_name: visit.first_name, last_name: visit.last_name, date_of_birth: visit.date_of_birth, complaint: visit.complaint, priority: visit.priority, status: visit.status, next_action: visit.next_action, location: visit.location, resource_id: visit.resource_id, assigned_to: visit.assigned_to, notes: visit.notes } : { patient_ref: '', first_name: '', last_name: '', date_of_birth: null, complaint: '', priority: 0, status: 'waiting', next_action: 'assessment', location: 'Waiting area', resource_id: null, assigned_to: '', notes: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const set = <K extends keyof VisitInput>(key: K, value: VisitInput[K]) => setInput(previous => ({ ...previous, [key]: value }));
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setError(''); try { await saveVisit(input, visit); await onSaved(); } catch (error) { setError(error instanceof Error ? error.message : 'Unable to save patient.'); } finally { setBusy(false); } }
  return <dialog ref={dialog} className="visit-dialog" aria-labelledby="visit-dialog-title" onCancel={e => { if (busy) e.preventDefault(); else onClose(); }}>
    <form onSubmit={submit}>
      <div className="dialog-heading">
        <div className="dialog-title-group"><span className="dialog-symbol"><Users size={23} /></span><div>
          <p className="eyebrow">{visit ? visit.patient_ref : 'EMERGENCY DEPARTMENT'}</p>
          <h2 id="visit-dialog-title">{visit ? 'Patient details' : 'Register patient'}</h2>
          <p className="dialog-subtitle">{visit ? 'Review identity, care progress, and the next step.' : 'Start a visit and help the team prepare the next step.'}</p>
        </div></div>
        <button type="button" className="icon-button" aria-label="Close patient details" disabled={busy} onClick={onClose}><X size={20} /></button>
      </div>
      <div className="dialog-body">
        <fieldset disabled={readonly || busy} className="visit-fields">
          <section className="form-section" aria-labelledby="identity-heading">
            <div className="section-heading"><span className="section-number">01</span><div><h3 id="identity-heading">Patient identity</h3><p>Confirm who is receiving care.</p></div></div>
            <div className="form-grid">
              {!visit && <label className="full-width">Register for<select aria-label="Patient registration" value={input.patient_ref || 'new'} onChange={e => {
                const person = data.visits.find(v => v.patient_ref === e.target.value);
                setInput(previous => ({ ...previous, patient_ref: person?.patient_ref ?? '', first_name: person?.first_name ?? '', last_name: person?.last_name ?? '', date_of_birth: person?.date_of_birth ?? null }));
              }}><option value="new">New patient (new reference)</option>{Array.from(new Map(data.visits.map(v => [v.patient_id, v])).values()).map(person => <option key={person.patient_id} value={person.patient_ref}>{fullName(person)} - {person.patient_ref}</option>)}</select></label>}
              <label><span>First name <span className="required" aria-hidden="true">*</span></span><input aria-label="First name" required maxLength={160} autoComplete="given-name" value={input.first_name} onChange={e => set('first_name', e.target.value)} placeholder="e.g. Amara" /></label>
              <label><span>Last name <span className="required" aria-hidden="true">*</span></span><input aria-label="Last name" required maxLength={160} autoComplete="family-name" value={input.last_name} onChange={e => set('last_name', e.target.value)} placeholder="e.g. Ndlovu" /></label>
              <label>Date of birth<input aria-label="Date of birth (optional if unknown)" type="date" max={hospitalDate()} value={input.date_of_birth ?? ''} onChange={e => set('date_of_birth', e.target.value || null)} /><small className="field-help">Leave blank if unknown.</small></label>
              <label>Patient reference<input aria-label="Patient reference" readOnly value={input.patient_ref} placeholder="Generated on registration" /><small className="field-help">Assigned automatically for new patients.</small></label>
            </div>
            {visit && <p className="section-note">Identity changes apply across this patient's visits.{visit.names_need_review ? ' This migrated name needs review.' : ''}</p>}
          </section>
          <section className="form-section" aria-labelledby="care-heading">
            <div className="section-heading"><span className="section-number">02</span><div><h3 id="care-heading">Care & coordination</h3><p>Set urgency, current progress, and where care happens.</p></div></div>
            <div className="form-grid">
              <label className="full-width"><span>Presenting complaint <span className="required" aria-hidden="true">*</span></span><input aria-label="Presenting complaint" required maxLength={300} value={input.complaint} onChange={e => set('complaint', e.target.value)} placeholder="What brings the patient in today?" /></label>
              <label><span>Assigned priority <span className="required" aria-hidden="true">*</span></span><select aria-label="Assigned priority" className={input.priority ? `priority-select priority-border-${input.priority}` : ''} value={input.priority} onChange={e => set('priority', Number(e.target.value))}><option value={0} disabled>Choose a priority</option>{priorities.map((p, i) => <option key={p} value={i + 1}>{p}</option>)}</select><small className="field-help">Assigned by clinical staff.</small></label>
              <label>Care status<select aria-label="Care status" value={input.status} onChange={e => { set('status', e.target.value as Visit['status']); if (['discharged', 'transferred'].includes(e.target.value)) set('resource_id', null); }}>{Object.entries(statuses).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label>Next service<select aria-label="Next service" value={input.next_action} onChange={e => set('next_action', e.target.value as Visit['next_action'])}>{Object.entries(actions).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label>Responsible clinician<input aria-label="Responsible clinician" maxLength={120} value={input.assigned_to} onChange={e => set('assigned_to', e.target.value)} placeholder="Unassigned" /></label>
              <label>Assigned space<select aria-label="Assigned space" value={input.resource_id ?? ''} disabled={['discharged', 'transferred'].includes(input.status)} onChange={e => { const resource = data.resources.find(r => r.id === e.target.value); set('resource_id', resource?.id ?? null); set('location', resource?.name ?? 'Waiting area'); }}><option value="">No assigned space</option>{data.resources.map(r => { const unavailable = r.state !== 'available' || data.visits.some(v => v.id !== visit?.id && active(v) && v.resource_id === r.id); return <option key={r.id} value={r.id} disabled={unavailable}>{r.name}{unavailable ? ' - unavailable' : ''}</option>; })}</select></label>
              <label>Location<input aria-label="Location" maxLength={120} readOnly={Boolean(input.resource_id)} value={input.location} onChange={e => set('location', e.target.value)} /></label>
            </div>
          </section>
          <section className="form-section notes-section" aria-labelledby="handover-heading">
            <div className="section-heading"><span className="section-number">03</span><div><h3 id="handover-heading">Handover notes <span className="optional-label">Optional</span></h3><p>Keep the next person informed.</p></div></div>
            <label className="notes-field"><span className="sr-only">Handover notes</span><textarea aria-label="Handover notes" rows={3} maxLength={2000} value={input.notes} onChange={e => set('notes', e.target.value)} placeholder="Pending tasks, relevant observations, or handover information..." /></label>
            <small className="notes-count">{input.notes.length.toLocaleString()} / 2,000</small>
          </section>
        </fieldset>
      </div>
      <div className="dialog-footer">
        {error && <p className="error dialog-error" role="alert">{error}</p>}
        <div className="footer-content"><span className="footer-help">{readonly ? 'View-only access' : <><span className="required">*</span> Required fields</>}</span><div className="footer-buttons"><button type="button" className="secondary" disabled={busy} onClick={onClose}>Close</button>{!readonly && <button className="primary" disabled={busy}>{busy ? 'Saving...' : visit ? 'Save changes' : 'Register patient'}<Check size={17} /></button>}</div></div>
      </div>
    </form>
  </dialog>;
}
