import { useEffect, useState } from 'react';
import { LogOut } from 'lucide-react';
import type { Role } from './model';
import { textSizes, type TextSize } from './lib/textSize';
import { readStartView, saveStartView, type StartView } from './lib/preferences';
import { deadlineThresholds, loadTheatre, theatrePermissions, type PriorityCode } from './lib/theatre';
import { developerCredit, supportEmail, type HelpSectionId } from './help/manual';
import { CodeBadge } from './TheatreDialogs';

const roleLabels: Record<Role, string> = { viewer: 'Viewer', clinician: 'Clinician (medical officer / registrar)', surgeon: 'Consultant surgeon',
  anaesthetist: 'Anaesthetist', nurse: 'Nurse', coordinator: 'Coordinator' };
function roleSummary(role: Role) {
  const theatre = theatrePermissions(role);
  return [
    ['clinician', 'surgeon', 'nurse', 'coordinator'].includes(role) ? 'Register and update ED patients' : 'View the ED board',
    ['nurse', 'coordinator'].includes(role) && 'Change space status',
    theatre.book && 'Book theatre cases',
    theatre.changePriority && 'Change theatre priority (with a reason)',
    theatre.assignTheatre && 'Assign theatres',
    theatre.cancel && 'Cancel theatre cases',
    role === 'coordinator' ? 'Export the ED board, completed visits and theatre list' : theatre.export && 'Export the theatre list',
  ].filter(Boolean) as string[];
}

export function SettingsPage({ email, role, textSize, onTextSize, onLogout, onHelp, theatreEnabled }: {
  email?: string; role: Role; textSize: TextSize; onTextSize: (size: TextSize) => void; onLogout?: () => void;
  onHelp: (section: HelpSectionId) => void; theatreEnabled: boolean;
}) {
  const [startView, setStartView] = useState<StartView>(readStartView);
  const [codes, setCodes] = useState<PriorityCode[] | null>(null);
  useEffect(() => { if (theatreEnabled) loadTheatre().then(d => setCodes(d.codes)).catch(() => setCodes([])); }, [theatreEnabled]);
  const chooseStart = (view: StartView) => { setStartView(view); saveStartView(view); };
  return <div className="settings-page">
    <section className="settings-card" aria-labelledby="settings-display">
      <h2 id="settings-display">Display</h2>
      <p className="settings-hint">Saved on this device and browser only.</p>
      <div className="settings-row"><div><h3>Text size</h3><p>Everything on the screen grows, including the boards and Help.</p></div>
        <div className="segmented" role="group" aria-label="Text size">{textSizes.map(s => <button key={s.id} type="button" aria-pressed={textSize === s.id} onClick={() => onTextSize(s.id)}>{s.label}</button>)}</div></div>
      <div className="settings-preview" aria-hidden="true"><strong>Sample patient</strong><span className="priority priority-2"><span />P2 · Orange – Very urgent</span><span className="time">1h 05m</span></div>
      {theatreEnabled && <div className="settings-row"><div><h3>First screen after sign-in</h3><p>Surgeons and theatre staff may prefer the theatre list.</p></div>
        <div className="segmented" role="group" aria-label="First screen">{([['board', 'Patient board'], ['theatre', 'Theatre list']] as const).map(([id, label]) => <button key={id} type="button" aria-pressed={startView === id} onClick={() => chooseStart(id)}>{label}</button>)}</div></div>}
    </section>

    <section className="settings-card" aria-labelledby="settings-account">
      <h2 id="settings-account">Your account</h2>
      <dl className="settings-list"><div><dt>Signed in as</dt><dd>{email ?? 'Demo user'}</dd></div><div><dt>Role</dt><dd>{roleLabels[role]}</dd></div></dl>
      <h3>What your role can do</h3>
      <ul className="settings-bullets">{roleSummary(role).map(item => <li key={item}>{item}</li>)}</ul>
      <p className="settings-hint">Your role and password are managed by the administrator. <button className="link-button" onClick={() => onHelp('roles')}>Who can do what</button></p>
      {onLogout && <button className="secondary" onClick={onLogout}><LogOut size={16} />Sign out</button>}
    </section>

    {theatreEnabled && <section className="settings-card" aria-labelledby="settings-theatre">
      <h2 id="settings-theatre">Theatre priority codes</h2>
      <p className="settings-hint">Read-only here. Codes, targets and colour thresholds are changed by the administrator after clinical approval.</p>
      {codes === null ? <p>Loading…</p> : <table className="settings-table"><thead><tr><th>Code, NCEPOD category and target</th><th>Approved</th></tr></thead>
        <tbody>{codes.map(c => <tr key={c.code}><td><CodeBadge code={c.code} label={c.label} ncepod={c.ncepod} />{c.example && <small className="settings-hint"> {c.example}</small>}</td><td>{c.clinically_approved ? 'Yes' : 'Not yet'}</td></tr>)}</tbody></table>}
      <p className="settings-hint">Deadline colours: approaching at {Math.round(deadlineThresholds.approaching * 100)}% of the target, imminent at {Math.round(deadlineThresholds.imminent * 100)}%, past deadline at 100%.</p>
    </section>}

    <section className="settings-card" aria-labelledby="settings-about">
      <h2 id="settings-about">About and support</h2>
      <dl className="settings-list"><div><dt>Application</dt><dd>PatientFlow · Emergency care workspace</dd></div><div><dt>Developer</dt><dd>{developerCredit.replace('Developed by ', '')}</dd></div>
        <div><dt>Support</dt><dd><span className="copyable">{supportEmail}</span></dd></div></dl>
      <button className="secondary" onClick={() => onHelp('problems')}>Page not opening or not updating?</button>
    </section>
  </div>;
}
