import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Activity, BarChart3, Bot, CircleHelp, Database, IdCard, LayoutDashboard, RotateCcw, ShieldCheck, Stethoscope, UserPlus, X, Zap } from 'lucide-react';
import { api, setRole, subscribe, type BoardState, type DemoRole } from './api';
import { Arrival } from './Arrival';
import { Board } from './Board';
import { Dashboard } from './Dashboard';
import { PatientView } from './PatientView';
import { LevelBadge } from './levels';
import './cran.css';

type View = 'home' | 'arrival' | 'board' | 'dashboard' | 'patient';
const roles: { id: DemoRole; label: string; name: string }[] = [
  { id: 'nurse', label: 'Nurse', name: 'Saara Iita' },
  { id: 'doctor', label: 'Doctor', name: 'Dr Tuhafeni Iileka' },
  { id: 'supervisor', label: 'Supervisor', name: 'Kaarina Uugwanga' },
];

export function CranApp() {
  const [view, setView] = useState<View>('home');
  const [role, setRoleState] = useState<DemoRole>('nurse');
  const [state, setState] = useState<BoardState | null>(null);
  const [offline, setOffline] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [encounter, setEncounter] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [idsOpen, setIdsOpen] = useState(false);
  const [message, setMessage] = useState('');

  const refresh = useCallback(() => api<BoardState>('state/').then(s => { setState(s); setOffline(false); }).catch(() => setOffline(true)), []);
  useEffect(() => { refresh(); return subscribe(refresh); }, [refresh]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  

  const changeRole = (next: DemoRole) => {
    setRole(next); setRoleState(next);
    if (next === 'supervisor' && view === 'arrival') setView('dashboard');
  };
  const open = (id: string) => { setEncounter(id); setView('patient'); };
  async function demoAction(path: string, text: string) {
    try { await api(path, {}); setMessage(text); await refresh(); setTimeout(() => setMessage(''), 4000); }
    catch (e) { setMessage((e as Error).message); }
  }
  const version = state ? `${state.version}-${state.rows.map(r => `${r.level}${r.alert?.id ?? ''}${r.status}`).join('')}` : '0';
  const alertCount = state?.rows.filter(r => r.alert).length ?? 0;

  return (
    <div className="cran">
      <header className="cran-header">
        <button className="cran-brand" onClick={() => setView('home')} aria-label="PatientFlow home">
          <Activity aria-hidden /> <span><strong>PatientFlow</strong><small>by Starkite Technologies</small></span>
        </button>
        <nav className="cran-nav" aria-label="Main">
          {role !== 'supervisor' && <NavButton active={view === 'arrival'} onClick={() => setView('arrival')} icon={<UserPlus aria-hidden />} label="Arrival" />}
          <NavButton active={view === 'board' || view === 'patient'} onClick={() => setView('board')} icon={<LayoutDashboard aria-hidden />} label={`Board${alertCount ? ` (${alertCount} alert${alertCount > 1 ? 's' : ''})` : ''}`} alert={alertCount > 0} />
          {role !== 'nurse' && <NavButton active={view === 'dashboard'} onClick={() => setView('dashboard')} icon={<BarChart3 aria-hidden />} label="Dashboard" />}
        </nav>
        <div className="cran-roles" role="group" aria-label="Demo role">
          {roles.map(r => <button key={r.id} className={role === r.id ? 'is-active' : ''} aria-pressed={role === r.id} onClick={() => changeRole(r.id)} title={r.name}>{r.label}</button>)}
        </div>
        <button className="cran-icon-btn" onClick={() => setHelpOpen(true)} aria-label="Help"><CircleHelp aria-hidden /></button>
      </header>
      <div className="cran-strip">
        <span className={`cran-ai ${state?.ai.available ? 'is-on' : 'is-off'}`}><Bot aria-hidden /> {state?.ai.message ?? 'Connecting…'}</span>
        <span><Database aria-hidden /> {state?.registry ?? 'National registry (demo mock)'}</span>
        <span className="cran-demo-label">Demo · synthetic data only · signed in as {roles.find(r => r.id === role)!.name}</span>
        <span className="cran-demo-buttons">
          <button className="cran-btn cran-btn-small" onClick={() => setIdsOpen(true)}><IdCard aria-hidden /> Demo IDs</button>
          <button className="cran-btn cran-btn-small" onClick={() => demoAction('demo/trigger/', 'Scripted deterioration triggered.')} disabled={!!state?.scripted.done}><Zap aria-hidden /> Trigger deterioration</button>
          <button className="cran-btn cran-btn-small" onClick={() => { if (confirm('Reset the demo to its starting state?')) demoAction('demo/reset/', 'Demo reset. Deterioration fires in about 60 seconds.'); }}><RotateCcw aria-hidden /> Reset demo</button>
        </span>
      </div>
      {offline && <p className="cran-error cran-banner" role="alert">Cannot reach the PatientFlow server. Retrying…</p>}
      {message && <p className="cran-ok cran-banner" role="status">{message}</p>}

      <main className="cran-main">
        {view === 'home' && <Landing onStart={() => setView(role === 'supervisor' ? 'dashboard' : 'arrival')} onBoard={() => setView('board')} />}
        {view === 'arrival' && <Arrival onDone={() => { refresh(); setView('board'); }} />}
        {view === 'board' && state && <Board state={state} now={now} onOpen={open} onChanged={refresh} />}
        {view === 'patient' && encounter && <PatientView encounterId={encounter} role={role} version={version} onBack={() => { refresh(); setView('board'); }} />}
        {view === 'dashboard' && <Dashboard version={version} />}
      </main>
      <footer className="cran-footer">PatientFlow by Starkite Technologies · CRAN Tech Challenge demo · Synthetic data · AI suggestions are advisory: clinicians decide.</footer>
      {helpOpen && <HelpPanel onClose={() => setHelpOpen(false)} />}
      {idsOpen && <DemoIds onClose={() => setIdsOpen(false)} />}
    </div>
  );
}

function NavButton({ active, onClick, icon, label, alert }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; alert?: boolean }) {
  return <button className={`cran-nav-btn ${active ? 'is-active' : ''} ${alert ? 'has-alert' : ''}`} aria-current={active ? 'page' : undefined} onClick={onClick}>{icon}{label}</button>;
}

function Landing({ onStart, onBoard }: { onStart: () => void; onBoard: () => void }) {
  return (
    <div className="cran-landing">
      <section className="cran-hero">
        <h1>PatientFlow <span>by Starkite Technologies</span></h1>
        <p className="cran-tagline">AI-assisted emergency triage, built on the national FHIR standard.</p>
        <div className="cran-actions">
          <button className="cran-btn cran-btn-primary cran-btn-big" onClick={onStart}><Stethoscope aria-hidden /> Start the demo</button>
          <button className="cran-btn cran-btn-big" onClick={onBoard}><LayoutDashboard aria-hidden /> Open the live board</button>
        </div>
      </section>
      <section className="cran-pillars">
        <article><LayoutDashboard aria-hidden /><h3>Live triage board</h3><p>Every patient by urgency and waiting time, updated live. Colour, name and shape for each level.</p>
          <div className="cran-level-row">{[1, 2, 3, 4, 5].map(l => <LevelBadge key={l} level={l} size="sm" />)}</div></article>
        <article><Database aria-hidden /><h3>National integration</h3><p>HL7 FHIR R4 resources and APIs, with a national registry connector. The registry here is a demo mock.</p></article>
        <article><ShieldCheck aria-hidden /><h3>AI that suggests, never decides</h3><p>Every suggestion shows its reasons and a rule-based safety baseline. The clinician confirms or changes it, and both are logged.</p></article>
      </section>
    </div>
  );
}

function HelpPanel({ onClose }: { onClose: () => void }) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<{ answer: string; section: string; source: string; notice: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function ask(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try { setAnswer(await api('help/', { question })); } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  return (
    <aside className="cran-drawer" role="dialog" aria-label="How do I…?">
      <header><h2><CircleHelp aria-hidden /> How do I…?</h2><button className="cran-icon-btn" onClick={onClose} aria-label="Close help"><X aria-hidden /></button></header>
      <form onSubmit={ask}>
        <label className="cran-field"><span>Ask about using PatientFlow</span><input autoFocus value={question} onChange={e => setQuestion(e.target.value)} placeholder="e.g. How do I confirm a triage level?" /></label>
        <button className="cran-btn cran-btn-primary" disabled={busy || !question.trim()}>{busy ? 'Looking…' : 'Ask'}</button>
      </form>
      <div className="cran-suggest-qs">
        {['How do I register a new patient?', 'What do the colours mean?', 'How do I dictate a note?', 'How is the forecast calculated?'].map(q =>
          <button key={q} className="cran-chip" onClick={() => setQuestion(q)}>{q}</button>)}
      </div>
      {error && <p className="cran-error">{error}</p>}
      {answer && (
        <div className="cran-help-answer">
          <p className="cran-ai-tag">{answer.source === 'ai' ? 'Suggested by AI, from the user manual' : 'From the user manual'} · {answer.section}</p>
          {answer.notice && <p className="cran-notice">{answer.notice}</p>}
          <div className="cran-help-text">{answer.answer.split('\n').map((line, i) => <p key={i}>{line}</p>)}</div>
        </div>
      )}
    </aside>
  );
}

function DemoIds({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<{ health_id: string; national_id: string; name: string; in_registry: boolean }[]>([]);
  useEffect(() => { api('directory/').then(setRows).catch(() => setRows([])); }, []);
  return (
    <aside className="cran-drawer" role="dialog" aria-label="Demo IDs">
      <header><h2><IdCard aria-hidden /> Demo IDs (synthetic)</h2><button className="cran-icon-btn" onClick={onClose} aria-label="Close"><X aria-hidden /></button></header>
      <p className="cran-hint">NHI-1000001 is the scripted demo patient. IDs 36–50 are not in the registry, to show the new-patient path.</p>
      <table className="cran-table">
        <thead><tr><th>Health ID</th><th>Name</th><th>Registry</th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.health_id}><td><code>{r.health_id}</code></td><td>{r.name}</td><td>{r.in_registry ? 'Found' : 'New'}</td></tr>)}</tbody>
      </table>
    </aside>
  );
}
