import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BedDouble, ChevronRight, Clock3, Plus, RefreshCw, Scissors, Search, ShieldCheck, Zap } from 'lucide-react';
import { ageAtDate, formatMinutes, fullName, hospitalDate, type Visit } from './model';
import { ApiError } from './lib/api';
import {
  compareTheatre, deadlineState, isOpen, loadTheatre, minutesWaiting, theatreOccupancy, theatrePermissions,
  theatreStatusLabels, type TheatreBooking, type TheatreData,
} from './lib/theatre';
import { BookingDialog, CaseDialog, CodeBadge, DeadlineBadge } from './TheatreDialogs';

const emptyTheatre: TheatreData = { role: 'viewer', codes: [], bookings: [], theatres: [], staff: [] };
const conditionFlags = (b: TheatreBooking) => [b.haemodynamically_unstable && 'Unstable', b.septic_shock && 'Septic shock', b.organ_support && 'Organ support', b.anaesthetic_concern && 'Anaesthetic concern'].filter(Boolean) as string[];

export function TheatreList({ visits, now, wall, onNotice, onDenied }: { visits: Visit[]; now: number; wall: boolean; onNotice: (text: string) => void; onDenied: (text: string) => void }) {
  const [data, setData] = useState<TheatreData>(emptyTheatre);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [booking, setBooking] = useState<'standard' | 'rapid' | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try { setData(await loadTheatre()); setSyncedAt(Date.now()); setError(''); }
    catch (e) {
      if (e instanceof ApiError && [401, 403].includes(e.status)) { setData(emptyTheatre); onDenied(e.message); }
      setError(e instanceof Error ? e.message : 'Could not load the theatre list.');
    } finally { setLoaded(true); }
  }, [onDenied]);
  useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 30000); return () => clearInterval(timer); }, [refresh]);
  const can = theatrePermissions(data.role);
  const all = useMemo(() => [...data.bookings].sort(compareTheatre), [data.bookings]);
  const openCases = all.filter(isOpen);
  const visible = openCases.filter(b => `${fullName(b)} ${b.patient_ref} ${b.booking_ref} ${b.mrn} ${b.proposed_operation} ${b.diagnosis} ${b.specialty} ${b.responsible_consultant} ${b.location}`.toLowerCase().includes(search.toLowerCase()));
  const closed = all.filter(b => !isOpen(b));
  const waiting = openCases.filter(b => b.status === 'booked');
  const immediate = waiting.filter(b => b.ncepod === 'immediate');
  const pastDeadline = waiting.filter(b => deadlineState(b, now) === 'exceeded');
  const freeTheatres = data.theatres.filter(t => t.state === 'available' && !theatreOccupancy(t, data.bookings).current);
  const unapproved = data.codes.some(c => !c.clinically_approved);
  const stale = Boolean(error) || (syncedAt !== null && now - syncedAt > 90000);
  const active = openId ? data.bookings.find(b => b.id === openId) : undefined;
  const changed = async (text: string) => { await refresh(); onNotice(text); };

  return <div className="theatre-view">
    {unapproved && !wall && <div className="theatre-banner" role="note"><ShieldCheck size={18} aria-hidden="true" /><p><strong>Not yet clinically approved.</strong> Priority codes, time targets and deadline colours are placeholders until the surgical, anaesthetic and theatre leads approve them. For P0 cases, always use the hospital's emergency call process as well.</p></div>}
    {error && <div className="error" role="alert">{error} <button onClick={() => void refresh()}>Retry</button></div>}
    <section className="stats" aria-label="Theatre totals">
      <Stat label="Open cases" value={openCases.length} detail="Awaiting theatre or in theatre" icon={<Scissors size={19} />} />
      <Stat label="Immediate (P0) waiting" value={immediate.length} detail="Not yet in theatre" icon={<Zap size={19} />} tone="red" />
      <Stat label="Past deadline" value={pastDeadline.length} detail="Waiting beyond target" icon={<AlertTriangle size={19} />} tone="amber" />
      <Stat label="Theatres free" value={freeTheatres.length} detail={`Of ${data.theatres.length} operating theatres`} icon={<BedDouble size={19} />} />
    </section>

    <section className="board-panel">
      <div className="panel-heading">
        <div><h2>Emergency theatre list <span className="count-pill">{visible.length}</span></h2><p>Most urgent code first, then the nearest deadline. The clock starts at the decision to operate.</p></div>
        <div className="panel-actions">
          <div className={`sync-status ${stale ? 'sync-warning' : ''}`}><span className="status-dot" />{stale ? 'Updates delayed' : 'Live list'}<button className="icon-button" aria-label="Refresh theatre list" onClick={() => void refresh()}><RefreshCw size={14} /></button></div>
          {!wall && can.book && <><button className="primary danger" onClick={() => setBooking('rapid')}><Zap size={16} />Rapid P0</button><button className="primary" onClick={() => setBooking('standard')}><Plus size={17} />Book case</button></>}
        </div>
      </div>
      {!wall && <div className="filters"><label className="search"><Search size={17} /><input aria-label="Search theatre cases" placeholder="Search patient, booking, operation, consultant…" value={search} onChange={e => setSearch(e.target.value)} /></label></div>}
      <div className="table-scroll" role="region" aria-label="Theatre cases" tabIndex={0}><table className="board-table theatre-table"><thead><tr><th>Priority</th><th>Patient</th><th>Operation</th><th>Waiting</th><th>Deadline</th><th>Readiness</th><th>Theatre</th>{!wall && <th><span className="sr-only">Details</span></th>}</tr></thead>
        <tbody>{visible.map(b => { const state = deadlineState(b, now); const condition = conditionFlags(b); return <tr key={b.id} className={`theatre-row deadline-row-${state ?? 'none'}`}>
          <td className="cell-triage" data-label="Priority"><CodeBadge code={b.priority_code} label={b.priority_label} ncepod={b.ncepod} /></td>
          <td className="cell-patient"><div className="patient-cell"><div><strong>{wall ? b.booking_ref : fullName(b)}</strong><small>{wall ? b.patient_ref : `${b.booking_ref} · ${b.patient_ref}`} · {ageAtDate(b.date_of_birth, hospitalDate(b.decision_at)) ?? '—'} years{b.specialty ? ` · ${b.specialty}` : ''}</small>{!b.details_complete && <small className="incomplete-flag">Details incomplete</small>}</div></div></td>
          <td className="cell-next" data-label="Operation"><div className="next-step"><strong className="op-name">{b.proposed_operation}</strong>{!wall && b.diagnosis && <small>{b.diagnosis}</small>}{b.responsible_consultant && <small>{b.responsible_consultant}</small>}</div></td>
          <td className="cell-time" data-label="Waiting"><span className="time"><Clock3 size={14} />{formatMinutes(minutesWaiting(b, now))}</span><small className="triage-target">Target: {b.priority_label}</small></td>
          <td className="cell-status" data-label="Deadline"><DeadlineBadge booking={b} now={now} />{b.delay_category && <small className="triage-target">Delay recorded</small>}</td>
          <td className="cell-clinician" data-label="Readiness"><span className={`care-status ${b.ready_for_theatre ? 'status-ready' : ''}`}>{b.ready_for_theatre ? 'Ready' : 'Not ready'}</span>{condition.length > 0 && <small className="condition-flags">{condition.join(' · ')}</small>}</td>
          <td className="cell-location" data-label="Theatre"><span className="location"><BedDouble size={14} />{b.theatre_name ?? 'Not assigned'}</span>{b.status !== 'booked' && <small className="triage-target">{theatreStatusLabels[b.status]}</small>}{b.planned_start && b.status === 'booked' && <small className="triage-target">Planned {new Date(b.planned_start).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}</small>}</td>
          {!wall && <td className="cell-open"><button className="icon-button" aria-label={`Open ${b.booking_ref}`} onClick={() => setOpenId(b.id)}><ChevronRight size={18} /></button></td>}
        </tr>; })}</tbody></table></div>
      {!visible.length && <div className="empty"><Scissors size={28} /><h3>{!loaded ? 'Loading theatre list…' : search ? 'No matching cases' : 'No open theatre cases'}</h3><p>{!loaded ? 'Fetching the latest bookings.' : can.book ? 'Book a case when the decision to operate is made.' : 'Cases appear here as soon as they are booked.'}</p></div>}
      <footer className="board-footer"><span><ShieldCheck size={14} />Priority set by clinicians · Never changed automatically</span><span>{syncedAt ? `Last synced ${new Date(syncedAt).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}` : 'Not synchronised'}</span></footer>
    </section>

    <div className="theatre-columns">
      <section className="board-panel theatre-status-panel" aria-labelledby="theatres-heading">
        <div className="panel-heading"><div><h2 id="theatres-heading">Operating theatres</h2><p>Current case, expected free time and next planned case.</p></div></div>
        <div className="theatre-cards">{data.theatres.map(t => { const { current, expectedFree, next } = theatreOccupancy(t, data.bookings); const label = current ? 'In use' : t.state === 'available' ? 'Available' : t.state === 'cleaning' ? 'Cleaning' : 'Unavailable';
          return <article key={t.id} className={`theatre-card theatre-${current ? 'busy' : t.state}`}><div className="theatre-card-top"><h3>{t.name}</h3><span className="care-status">{label}</span></div>
            {current ? <p><strong>{current.booking_ref}</strong> · {current.proposed_operation}<small>{theatreStatusLabels[current.status]}{expectedFree ? ` · expected free ${new Date(expectedFree).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}` : ''}</small></p> : <p className="muted">{t.state === 'available' ? 'Ready for the next case' : 'Not available for cases'}</p>}
            {next && <p className="theatre-next">Next: <strong>{next.priority_code}</strong> {next.booking_ref} · {next.proposed_operation}</p>}
          </article>; })}
          {!data.theatres.length && loaded && <p className="muted">No operating theatres set up. In Spaces, a theatre has the type "Operating room".</p>}
        </div>
      </section>
      <section className="board-panel code-legend" aria-labelledby="codes-heading">
        <div className="panel-heading"><div><h2 id="codes-heading">Priority codes</h2><p>{unapproved ? 'Placeholders, awaiting clinical approval.' : 'Approved by the clinical leads.'}</p></div></div>
        <ul>{data.codes.map(c => <li key={c.code}><CodeBadge code={c.code} label={c.label} ncepod={c.ncepod} /><span>{c.example}</span></li>)}</ul>
        <p className="legend-note">Deadline colours: <span className="deadline-badge deadline-within">On target</span> <span className="deadline-badge deadline-approaching">Approaching</span> <span className="deadline-badge deadline-imminent">Imminent</span> <span className="deadline-badge deadline-exceeded">Past deadline</span></p>
      </section>
    </div>

    {!wall && closed.length > 0 && <details className="board-panel closed-cases"><summary>Completed and cancelled in the last 24 hours <span className="count-pill">{closed.length}</span></summary>
      <ul>{closed.map(b => <li key={b.id}><button className="link-button" onClick={() => setOpenId(b.id)}>{b.booking_ref}</button> · {fullName(b)} · {b.proposed_operation} · <strong>{theatreStatusLabels[b.status]}</strong>{b.status === 'cancelled' ? `: ${b.cancelled_reason}` : ''}</li>)}</ul>
    </details>}

    {booking && <BookingDialog data={data} visits={visits} rapid={booking === 'rapid'} onClose={() => setBooking(null)} onDenied={onDenied} onSaved={text => { setBooking(null); void changed(text); }} />}
    {active && <CaseDialog booking={active} data={data} now={now} onClose={() => setOpenId(null)} onDenied={onDenied} onChanged={changed} />}
  </div>;
}

function Stat({ label, value, icon, detail, tone = 'teal' }: { label: string; value: number; icon: React.ReactNode; detail: string; tone?: string }) {
  return <article className="stat"><div><span>{label}</span><span className={`stat-icon ${tone}`}>{icon}</span></div><strong>{value.toString().padStart(2, '0')}</strong><small>{detail}</small></article>;
}
