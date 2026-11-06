import { useState } from 'react';
import { BellRing, Check, ClipboardList, Copy, HeartPulse, Timer, X } from 'lucide-react';
import { api, type Alert, type BoardState, type Row } from './api';
import { LevelBadge, levelInfo, minutes } from './levels';

const statusText: Record<string, string> = { arrived: 'Awaiting triage', triaged: 'Waiting', 'in-progress': 'In treatment' };

export function Board({ state, now, onOpen, onChanged }: { state: BoardState; now: number; onOpen: (id: string) => void; onChanged: () => void }) {
  const [handover, setHandover] = useState<{ lines: string[]; overall: string; source: string; notice: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const alerts = state.rows.filter(r => r.alert);
  const serverOffset = now - Date.parse(state.server_time);

  async function makeHandover() {
    setBusy(true); setError('');
    try { setHandover(await api('handover/')); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="cran-page cran-board">
      <div className="cran-board-head">
        <h2>Live triage board <small>{state.rows.length} active</small></h2>
        <button className="cran-btn" onClick={makeHandover} disabled={busy}><ClipboardList aria-hidden /> {busy ? 'Writing…' : 'Shift handover'}</button>
      </div>
      {error && <p className="cran-error" role="alert">{error}</p>}
      {alerts.map(r => <AlertBanner key={r.alert!.id} row={r} alert={r.alert!} onOpen={onOpen} onChanged={onChanged} />)}
      {handover && <Handover data={handover} onClose={() => setHandover(null)} />}
      <ol className="cran-rows">
        {state.rows.map(r => <BoardRow key={r.encounter_id} row={r} now={now - serverOffset} onOpen={onOpen} />)}
      </ol>
      {!state.rows.length && <p className="cran-empty">No active patients.</p>}
    </div>
  );
}

function BoardRow({ row, now, onOpen }: { row: Row; now: number; onOpen: (id: string) => void }) {
  const info = levelInfo(row.level);
  const wait = Math.max(0, Math.floor((now - Date.parse(row.arrived_at)) / 60000));
  const overdue = info.targetMinutes !== null && row.status === 'triaged' && wait > info.targetMinutes;
  return (
    <li>
      <button className={`cran-row cran-row-${info.key} ${row.alert ? 'has-alert' : ''}`} onClick={() => onOpen(row.encounter_id)}>
        <LevelBadge level={row.level} />
        <span className="cran-row-main">
          <strong>{row.patient.name}</strong>
          <span>{row.patient.age ?? '?'}{(row.patient.sex || '?')[0].toUpperCase()} · {row.complaint || 'No complaint recorded'}</span>
        </span>
        <span className="cran-row-meta">
          <span className={`cran-timer ${overdue ? 'is-over' : ''}`}><Timer aria-hidden /> {minutes(wait)}{overdue && <em> Over target</em>}</span>
          <span className="cran-row-sub"><HeartPulse aria-hidden /> NEWS2 {row.news2 ?? '—'} · {statusText[row.status] || row.status}</span>
        </span>
        {row.alert && <span className="cran-row-alert"><BellRing aria-hidden /> Alert</span>}
      </button>
    </li>
  );
}

function AlertBanner({ row, alert, onOpen, onChanged }: { row: Row; alert: Alert; onOpen: (id: string) => void; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function decide(action: 'confirm' | 'dismiss') {
    setBusy(true); setError('');
    try { await api(`alerts/${alert.id}/`, { action }); onChanged(); } catch (e) { setError((e as Error).message); setBusy(false); }
  }
  return (
    <section className="cran-alert" role="alert">
      <BellRing className="cran-alert-icon" aria-hidden />
      <div className="cran-alert-body">
        <p className="cran-alert-title">Deterioration: <button className="cran-link" onClick={() => onOpen(row.encounter_id)}>{row.patient.name}</button> <LevelBadge level={row.level} size="sm" /></p>
        <p className="cran-alert-msg">{alert.message}</p>
        <ul>{alert.reasons.map(r => <li key={r}>{r}</li>)}</ul>
        <p className="cran-alert-src">Suggested by the rule engine (NEWS2). You decide.</p>
        {error && <p className="cran-error">{error}</p>}
      </div>
      <div className="cran-actions">
        {alert.suggested_level ? (
          <button className="cran-btn cran-btn-danger" disabled={busy} onClick={() => decide('confirm')}><Check aria-hidden /> Confirm P{alert.suggested_level} {levelInfo(alert.suggested_level).colour}</button>
        ) : (
          <button className="cran-btn cran-btn-primary" disabled={busy} onClick={() => decide('dismiss')}><Check aria-hidden /> Reviewed</button>
        )}
        <button className="cran-btn" disabled={busy} onClick={() => decide('dismiss')}><X aria-hidden /> Dismiss</button>
      </div>
    </section>
  );
}

function Handover({ data, onClose }: { data: { lines: string[]; overall: string; source: string; notice: string | null }; onClose: () => void }) {
  const text = [...data.lines, data.overall].join('\n');
  return (
    <section className="cran-card cran-handover">
      <header>
        <h3>Shift handover <span className="cran-ai-tag">{data.source === 'ai' ? 'Suggested by AI' : 'Rule-based draft'}</span></h3>
        <div className="cran-actions">
          <button className="cran-btn" onClick={() => navigator.clipboard?.writeText(text)}><Copy aria-hidden /> Copy</button>
          <button className="cran-btn" onClick={onClose}><X aria-hidden /> Close</button>
        </div>
      </header>
      {data.notice && <p className="cran-notice">{data.notice}</p>}
      <ol>{data.lines.map((l, i) => <li key={i}>{l}</li>)}</ol>
      <p><strong>{data.overall}</strong></p>
      <small>Draft for the clinician to check. Positions match the board order.</small>
    </section>
  );
}
