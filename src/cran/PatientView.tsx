import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, Bed, Bot, Check, FileJson, HeartPulse, Home, Mic, MicOff, PenLine, Stethoscope, X } from 'lucide-react';
import { api, download, type Alert, type DemoRole, type History, type PatientCard, type Suggestion, type Summary, type Vitals } from './api';
import { RegistryRecord } from './Arrival';
import { LevelBadge, levelInfo, clock } from './levels';
import { TriageSuggestion } from './Suggestion';
import { emptyVitals, VitalsForm } from './VitalsForm';

interface Decision { id: string; created_at: string; kind: string; action: string; level?: number | null; previous_level?: number | null; suggested_level?: number | null; reason?: string; user: { name: string; role: string } }
interface Note { id: string; presenting_complaint: string; findings: string; plan: string; signed_by: { name: string }; signed_at: string; draft_source: string; edited_by_clinician: boolean }
interface Detail {
  level: number | null; status: string; patient: PatientCard; complaint: string | null; history: History | null; summary: Summary | null; registry: string;
  vitals: (Vitals & { news2: number })[]; decisions: Decision[]; alerts: Alert[]; notes: Note[];
  pending_suggestion: { id: string; suggestion: Suggestion } | null; encounter: { period: { start: string } };
}

export function PatientView({ encounterId, role, version, onBack }: { encounterId: string; role: DemoRole; version: string; onBack: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => api<Detail>(`encounters/${encounterId}/`).then(setDetail).catch(e => setError(e.message)), [encounterId]);
  useEffect(() => { load(); }, [load, version]);

  if (!detail) return <div className="cran-page">{error ? <p className="cran-error">{error}</p> : <p>Loading…</p>}</div>;
  const closed = detail.status === 'finished';
  const openAlerts = detail.alerts.filter(a => a.status === 'open');

  async function act(path: string, body: object) {
    setError('');
    try { await api(path, body); await load(); } catch (e) { setError((e as Error).message); }
  }

  return (
    <div className="cran-page cran-patient">
      <button className="cran-btn cran-back" onClick={onBack}><ArrowLeft aria-hidden /> Back to board</button>
      <header className="cran-patient-head">
        <div>
          <h2>{detail.patient.name}</h2>
          <p>{detail.patient.age ?? '?'} years · {detail.patient.sex} · {detail.patient.health_id} · arrived {clock(detail.encounter.period.start)}</p>
          <p className="cran-complaint">{detail.complaint}</p>
        </div>
        <LevelBadge level={detail.level} size="lg" />
      </header>
      <div className="cran-actions cran-patient-actions">
        {detail.status === 'triaged' && <button className="cran-btn" onClick={() => act(`encounters/${encounterId}/treat/`, {})}><Stethoscope aria-hidden /> Start treatment</button>}
        {!closed && <button className="cran-btn" onClick={() => act(`encounters/${encounterId}/close/`, { disposition: 'discharge' })}><Home aria-hidden /> Discharge</button>}
        {!closed && <button className="cran-btn" onClick={() => act(`encounters/${encounterId}/close/`, { disposition: 'admit' })}><Bed aria-hidden /> Admit</button>}
        {(role === 'doctor' || role === 'supervisor') && <button className="cran-btn" onClick={() => download(`export/bundle/?encounter=${encounterId}`).catch(e => setError(e.message))}><FileJson aria-hidden /> FHIR Bundle (this visit)</button>}
        {closed && <span className="cran-ok">Visit closed</span>}
      </div>
      {error && <p className="cran-error" role="alert">{error}</p>}

      {openAlerts.map(a => (
        <section key={a.id} className="cran-alert" role="alert">
          <div className="cran-alert-body"><p className="cran-alert-msg">{a.message}</p><ul>{a.reasons.map(r => <li key={r}>{r}</li>)}</ul></div>
          <div className="cran-actions">
            {a.suggested_level && <button className="cran-btn cran-btn-danger" onClick={() => act(`alerts/${a.id}/`, { action: 'confirm' })}><Check aria-hidden /> Confirm P{a.suggested_level}</button>}
            <button className="cran-btn" onClick={() => act(`alerts/${a.id}/`, { action: 'dismiss' })}><X aria-hidden /> Dismiss</button>
          </div>
        </section>
      ))}

      {detail.status === 'arrived' && <PendingTriage encounterId={encounterId} pending={detail.pending_suggestion} onDone={load} />}

      <div className="cran-patient-grid">
        <section className="cran-card">
          <h3>Registry</h3>
          <p className="cran-source">{detail.registry}</p>
          <RegistryRecord patient={detail.patient} history={detail.history} summary={detail.summary} />
        </section>
        <section className="cran-card">
          <h3><HeartPulse aria-hidden /> Vitals over time</h3>
          <VitalsTrend vitals={detail.vitals} />
          {!closed && <AddVitals encounterId={encounterId} onSaved={load} />}
        </section>
        <section className="cran-card">
          <h3><PenLine aria-hidden /> Notes</h3>
          {detail.notes.map(n => (
            <article key={n.id} className="cran-note">
              <p><strong>Presenting complaint:</strong> {n.presenting_complaint}</p>
              <p><strong>Findings:</strong> {n.findings}</p>
              <p><strong>Plan:</strong> {n.plan}</p>
              <small>Signed by {n.signed_by.name} at {clock(n.signed_at)} · draft {n.draft_source === 'ai' ? 'suggested by AI' : n.draft_source === 'rules' ? 'rule-based' : 'manual'}{n.edited_by_clinician ? ', edited by clinician' : ''}</small>
            </article>
          ))}
          {!detail.notes.length && <p>No signed notes yet.</p>}
          {!closed && (role === 'doctor' ? <Dictation encounterId={encounterId} onSigned={load} /> : <p className="cran-hint">Switch to Doctor to dictate and sign notes.</p>)}
        </section>
        <section className="cran-card">
          <h3>Triage history</h3>
          <ol className="cran-timeline">
            {[...detail.decisions].sort((a, b) => b.created_at.localeCompare(a.created_at)).map(d => (
              <li key={d.id}>
                <span className="cran-time">{clock(d.created_at)}</span>
                <span>{describe(d)} — <strong>{d.user.name}</strong> ({d.user.role})</span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}

function describe(d: Decision) {
  const lv = (l?: number | null) => (l ? `P${l} ${levelInfo(l).colour}` : '—');
  if (d.kind === 'triage') return d.action === 'confirm' ? `Confirmed ${lv(d.level)}${d.suggested_level ? ' (as suggested)' : ''}` : `Changed suggestion ${lv(d.suggested_level)} to ${lv(d.level)}${d.reason ? `: “${d.reason}”` : ''}`;
  if (d.kind === 'alert') return d.action === 'confirm' ? `Deterioration alert confirmed: ${lv(d.previous_level)} → ${lv(d.level)}` : `Deterioration alert dismissed (suggested ${lv(d.suggested_level)})`;
  if (d.kind === 'note') return d.action === 'confirm' ? 'Signed note (draft unchanged)' : 'Signed note (edited draft)';
  if (d.kind === 'disposition') return d.action === 'admit' ? 'Admitted' : 'Discharged';
  return d.action;
}

function PendingTriage({ encounterId, pending, onDone }: { encounterId: string; pending: Detail['pending_suggestion']; onDone: () => void }) {
  const [current, setCurrent] = useState(pending);
  const [error, setError] = useState('');
  if (!current) {
    return <section className="cran-card"><button className="cran-btn cran-btn-primary" onClick={() => api(`encounters/${encounterId}/retriage/`, {}).then(r => setCurrent({ id: r.suggestion_id, suggestion: r.suggestion })).catch(e => setError(e.message))}><Bot aria-hidden /> Get triage suggestion</button>{error && <p className="cran-error">{error}</p>}</section>;
  }
  return <TriageSuggestion encounterId={encounterId} suggestionId={current.id} suggestion={current.suggestion} onDecided={onDone} />;
}

function VitalsTrend({ vitals }: { vitals: (Vitals & { news2: number })[] }) {
  if (!vitals.length) return <p>No vitals recorded.</p>;
  const max = Math.max(8, ...vitals.map(v => v.news2));
  const w = 320, h = 90, step = vitals.length > 1 ? (w - 40) / (vitals.length - 1) : 0;
  const pts = vitals.map((v, i) => [20 + i * step, h - 15 - (v.news2 / max) * (h - 30)]);
  return (
    <>
      <svg className="cran-trend" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`NEWS2 trend: ${vitals.map(v => v.news2).join(', ')}`}>
        <polyline fill="none" strokeWidth="3" points={pts.map(p => p.join(',')).join(' ')} />
        {pts.map(([x, y], i) => <g key={i}><circle cx={x} cy={y} r="5" /><text x={x} y={y - 9} textAnchor="middle">{vitals[i].news2}</text></g>)}
      </svg>
      <div className="cran-table-wrap">
        <table className="cran-table">
          <thead><tr><th>Time</th><th>HR</th><th>RR</th><th>BP</th><th>Temp</th><th>SpO₂</th><th>ACVPU</th><th>NEWS2</th></tr></thead>
          <tbody>{vitals.map((v, i) => (
            <tr key={i}><td>{clock(v.at)}</td><td>{v.heart_rate}</td><td>{v.respiratory_rate}</td><td>{v.systolic_bp}/{v.diastolic_bp}</td><td>{v.temperature}</td><td>{v.spo2}{v.on_oxygen ? ' (O₂)' : ''}</td><td>{v.consciousness}</td><td><strong>{v.news2}</strong></td></tr>
          ))}</tbody>
        </table>
      </div>
    </>
  );
}

function AddVitals({ encounterId, onSaved }: { encounterId: string; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [vitals, setVitals] = useState<Vitals>(emptyVitals);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  async function save(e: FormEvent) {
    e.preventDefault(); setError('');
    try {
      const r = await api(`encounters/${encounterId}/vitals/`, { vitals });
      setResult(r.alert ? `Saved. ${r.alert.message}` : `Saved. NEWS2 ${r.news2}, no deterioration.`);
      setOpen(false); setVitals(emptyVitals); onSaved();
    } catch (err) { setError((err as Error).message); }
  }
  if (!open) return <><button className="cran-btn" onClick={() => setOpen(true)}><HeartPulse aria-hidden /> Record new vitals</button>{result && <p className="cran-ok">{result}</p>}</>;
  return (
    <form onSubmit={save}>
      <VitalsForm value={vitals} onChange={setVitals} />
      <div className="cran-actions"><button className="cran-btn cran-btn-primary">Save vitals</button><button type="button" className="cran-btn" onClick={() => setOpen(false)}>Cancel</button></div>
      {error && <p className="cran-error">{error}</p>}
    </form>
  );
}

type Recognition = { lang: string; continuous: boolean; interimResults: boolean; start: () => void; stop: () => void; onresult: (e: any) => void; onend: () => void; onerror: (e: any) => void };

function Dictation({ encounterId, onSigned }: { encounterId: string; onSigned: () => void }) {
  const [transcript, setTranscript] = useState('');
  const [listening, setListening] = useState(false);
  const [draft, setDraft] = useState<{ suggestion_id: string; source: string; notice: string | null; note: Record<string, string> } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const recognition = useRef<Recognition | null>(null);
  const base = useRef('');
  const Speech = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

  function start() {
    setError('');
    const r: Recognition = new Speech();
    r.lang = 'en-ZA'; r.continuous = true; r.interimResults = true;
    base.current = transcript ? transcript.trim() + ' ' : '';
    r.onresult = (e: any) => {
      let text = '';
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      setTranscript(base.current + text);
    };
    r.onend = () => setListening(false);
    r.onerror = (e: any) => { setError(e.error === 'not-allowed' ? 'Microphone access was blocked. Type the note instead.' : 'Dictation stopped. You can type instead.'); setListening(false); };
    recognition.current = r; r.start(); setListening(true);
  }

  async function makeDraft() {
    setBusy(true); setError('');
    try { setDraft(await api(`encounters/${encounterId}/notes/draft/`, { transcript })); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function sign() {
    if (!draft) return;
    setBusy(true); setError('');
    try { await api(`encounters/${encounterId}/notes/`, { note: draft.note, suggestion_id: draft.suggestion_id }); setDraft(null); setTranscript(''); onSigned(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="cran-dictation">
      {!draft ? (
        <>
          <div className="cran-actions">
            {Speech ? (listening
              ? <button className="cran-btn cran-btn-danger" onClick={() => recognition.current?.stop()}><MicOff aria-hidden /> Stop</button>
              : <button className="cran-btn" onClick={start}><Mic aria-hidden /> Start dictation</button>)
              : <span className="cran-hint">Dictation needs Chrome or Edge. Type the note below.</span>}
            {listening && <span className="cran-listening">Listening…</span>}
          </div>
          <label className="cran-field"><span>Transcript</span>
            <textarea rows={4} value={transcript} onChange={e => setTranscript(e.target.value)} placeholder="e.g. Fever and cough for three days. On examination crackles at the right base, saturation 94 percent. Plan: chest X-ray, start antibiotics, review in one hour." />
          </label>
          <button className="cran-btn cran-btn-primary" disabled={busy || !transcript.trim()} onClick={makeDraft}><Bot aria-hidden /> {busy ? 'Drafting…' : 'Draft note'}</button>
        </>
      ) : (
        <div className="cran-draft">
          <p className="cran-ai-tag">{draft.source === 'ai' ? 'Suggested by AI — edit before signing' : 'Rule-based draft — edit before signing'}</p>
          {draft.notice && <p className="cran-notice">{draft.notice}</p>}
          {(['presenting_complaint', 'findings', 'plan'] as const).map(k => (
            <label key={k} className="cran-field"><span>{k === 'presenting_complaint' ? 'Presenting complaint' : k === 'findings' ? 'Findings' : 'Plan'}</span>
              <textarea rows={3} value={draft.note[k]} onChange={e => setDraft({ ...draft, note: { ...draft.note, [k]: e.target.value } })} />
            </label>
          ))}
          <div className="cran-actions">
            <button className="cran-btn cran-btn-primary" disabled={busy} onClick={sign}><Check aria-hidden /> Sign note</button>
            <button className="cran-btn" onClick={() => setDraft(null)}>Back to transcript</button>
          </div>
        </div>
      )}
      {error && <p className="cran-error">{error}</p>}
    </div>
  );
}
