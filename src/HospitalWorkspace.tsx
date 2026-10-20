import { useEffect, useMemo, useRef, useState } from 'react';
import type { Hospital, HospitalContext } from './model';
import { apiRequest, ApiError } from './lib/api';
import { ProtectedRequests } from './lib/protectedRequests';

export function HospitalWorkspace({ children, authVersion }: { children: (context: HospitalContext) => React.ReactNode; authVersion: number }) {
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [context, setContext] = useState<HospitalContext | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    let alive = true;
    apiRequest<Hospital[]>('/necms/hospitals/').then(data => { if (alive) setHospitals(data); })
      .catch(error => { if (alive) setError(error instanceof Error ? error.message : 'Could not load hospitals.'); });
    return () => { alive = false; generation.current++; };
  }, []);
  async function select(hospital: string, purpose: HospitalContext['purpose'] = 'clinical') {
    const request = ++generation.current;
    setContext(null); setError(''); setBusy(true); // Unmount all previous clinical state immediately.
    try {
      const next = await apiRequest<HospitalContext>('/necms/contexts/', 'POST', { hospital_id: hospital, purpose });
      if (request === generation.current) setContext(next);
    } catch (error) { if (request === generation.current) setError(error instanceof Error ? error.message : 'Context denied.'); }
    finally { if (request === generation.current) setBusy(false); }
  }
  return <><div className="hospital-context-bar">
    <label>Hospital <select aria-label="Selected hospital" disabled={busy} value={context?.hospital_id ?? ''} onChange={event => void select(event.target.value)}>
      <option value="" disabled>Select an authorised hospital</option>
      {hospitals.map(h => <option key={h.id} value={h.id}>{h.name} ({h.facility_type})</option>)}
    </select></label>
    {context && <button className="secondary" onClick={() => void select(context.hospital_id, context.purpose)}>Renew access</button>}
    {context && <button className="secondary" onClick={() => void select(context.hospital_id, context.purpose === 'clinical' ? 'display' : 'clinical')}>{context.purpose === 'clinical' ? 'Restricted shared display' : 'Clinical workspace'}</button>}
    {error && <span role="alert">{error}</span>}
    {!busy && !hospitals.length && !error && <span>No active hospital memberships.</span>}
  </div>{context ? context.purpose === 'display' ? <RestrictedDisplay key={`${context.id}:${authVersion}`} context={context} /> : children(context) : <div className="login-shell">{busy ? 'Checking hospital access…' : 'Select a hospital to continue.'}</div>}</>;
}

type DisplayRow = { display_label: string; status: string; next_action: string; space_state: string };
function RestrictedDisplay({ context }: { context: HospitalContext }) {
  const [rows, setRows] = useState<DisplayRow[]>([]);
  const [error, setError] = useState('');
  const requests = useMemo(() => new ProtectedRequests(), []);
  useEffect(() => {
    requests.activate();
    async function refresh() {
      const ticket = requests.begin(); if (!ticket) return;
      try {
        const next = await apiRequest<DisplayRow[]>(`/necms/hospitals/${context.hospital_id}/display-board/`, 'GET', undefined, context.id, ticket.controller.signal);
        if (requests.accept(ticket)) { setRows(next); setError(''); }
      } catch (error) {
        const denied = error instanceof ApiError && [401,403].includes(error.status);
        if (denied ? requests.deny(ticket) : requests.accept(ticket)) { setRows([]); setError(error instanceof Error ? error.message : 'Display access denied.'); }
      } finally { requests.finish(ticket); }
    }
    void refresh(); const timer = window.setInterval(refresh, 5000);
    return () => { requests.close(); clearInterval(timer); };
  }, [context, requests]);
  return <main className="page-content"><h1>Emergency department display</h1><p>Restricted operational view · updates every five seconds</p>
    {error && <p role="alert">{error}</p>}<table><thead><tr><th>Display label</th><th>Status</th><th>Next service</th><th>Space</th></tr></thead>
    <tbody>{rows.map(row => <tr key={row.display_label}><td>{row.display_label}</td><td>{row.status}</td><td>{row.next_action}</td><td>{row.space_state}</td></tr>)}</tbody></table></main>;
}

export function HospitalStaff({ context, requests, onAccessDenied }: { context: HospitalContext; requests: ProtectedRequests; onAccessDenied: (message: string) => void }) {
  const [data, setData] = useState<{ memberships: { id: string; user_id: string; role_id: string; active: boolean }[]; roles: { id: string; code: string }[] } | null>(null);
  const [error, setError] = useState('');
  const [reason, setReason] = useState('');
  const gate = useMemo(() => new ProtectedRequests(), []);
  async function perform<T>(method = 'GET', body?: unknown) {
    const local = gate.begin(), parent = requests.begin();
    if (!local || !parent) { if (local) gate.finish(local); if (parent) requests.finish(parent); return; }
    try {
      const result = await apiRequest<T>(`/necms/hospitals/${context.hospital_id}/staff/`, method, body, context.id, AbortSignal.any([local.controller.signal, parent.controller.signal]));
      if (requests.current(parent) && (method === 'GET' ? gate.accept(local) : gate.current(local))) return result;
    } catch (failure) {
      if (!gate.current(local) || !requests.current(parent)) return;
      const message = failure instanceof Error ? failure.message : 'Staff access unavailable.';
      if (failure instanceof ApiError && [401,403].includes(failure.status)) {
        gate.deny(local); setData(null);
        if (requests.deny(parent)) onAccessDenied(message);
      } else if (gate.accept(local)) { setData(null); setError(message); }
    } finally { gate.finish(local); requests.finish(parent); }
  }
  async function refreshStaff() { const next = await perform<typeof data>(); if (next) { setData(next); setError(''); } }
  useEffect(() => {
    gate.activate(); const initial = setTimeout(() => void refreshStaff(), 0), timer = setInterval(() => void refreshStaff(), 5000);
    return () => { gate.close(); clearTimeout(initial); clearInterval(timer); };
  }, [context.id]);
  async function revoke(member: NonNullable<typeof data>['memberships'][number]) {
    const result = await perform('POST', { user_id: member.user_id, role_id: member.role_id, active: false, reason });
    if (result) await refreshStaff();
  }
  return <section className="activity-panel"><h2>Hospital staff access</h2>{error && <p role="alert">{error}</p>}
    <label>Reason for access change<input value={reason} maxLength={300} onChange={event => setReason(event.target.value)} /></label>
    {data?.memberships.map(m => <p key={m.id}>{m.user_id} · {data.roles.find(r => r.id === m.role_id)?.code} · {m.active ? 'Active' : 'Inactive'} {m.active && <button disabled={!reason.trim()} onClick={() => void revoke(m)}>Revoke access</button>}</p>)}</section>;
}
