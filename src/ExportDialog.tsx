import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Download, X } from 'lucide-react';
import { actions, hospitalDate, priorities, statuses } from './model';
import { downloadExport, type ExportFilters, type ExportScope } from './lib/exportVisits';
import { HelpLink } from './HelpPage';
import type { HelpSectionId } from './help/manual';

interface Props {
  scope: ExportScope; filters: Omit<ExportFilters, 'from' | 'to'>; shownCount: number;
  onClose: () => void; onExported: (message: string) => void; onHelp: (section: HelpSectionId) => void;
}
const eyebrows: Record<ExportScope, string> = { board: 'PATIENT BOARD', completed: 'COMPLETED VISITS', theatre: 'EMERGENCY THEATRE LIST' };

export function ExportDialog({ scope, filters, shownCount, onClose, onExported, onHelp }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pending = useRef<AbortController | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { dialog.current?.showModal(); return () => pending.current?.abort(); }, []);
  const theatre = scope === 'theatre';
  const dateLabel = theatre ? 'Decision to operate' : 'Arrived';
  const active = [
    filters.q.trim() && `Search: "${filters.q.trim()}"`,
    filters.priority !== 'all' && `Triage: ${priorities[Number(filters.priority) - 1]}`,
    filters.status !== 'all' && `Status: ${statuses[filters.status as keyof typeof statuses]}`,
    filters.action !== 'all' && `Next service: ${actions[filters.action as keyof typeof actions]}`,
  ].filter(Boolean) as string[];
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (from && to && from > to) { setError('The start date must be on or before the end date.'); return; }
    pending.current = new AbortController(); setBusy(true); setError('');
    try {
      const { rows, filename } = await downloadExport(scope, { ...filters, from, to }, pending.current.signal);
      const noun = theatre ? (rows === 1 ? 'theatre case' : 'theatre cases') : (rows === 1 ? 'visit' : 'visits');
      onExported(`Exported ${rows} ${noun} to ${filename}. Recorded in the Activity log.`);
    } catch (error) {
      if (!pending.current?.signal.aborted) setError(error instanceof Error ? error.message : 'The export could not be created.');
    } finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="visit-dialog export-dialog" aria-labelledby="export-title" onCancel={e => { if (busy) e.preventDefault(); else onClose(); }}>
    <form onSubmit={submit}>
      <div className="dialog-heading">
        <div><p className="eyebrow">{eyebrows[scope]}</p>
          <h2 id="export-title">Export to CSV <HelpLink section="export" onOpen={section => { onClose(); onHelp(section); }} /></h2></div>
        <button type="button" className="icon-button" aria-label="Close export" disabled={busy} onClick={onClose}><X size={20} /></button>
      </div>
      <div className="form-grid">
        <label>{dateLabel} from<input type="date" aria-label={`${dateLabel} from`} max={hospitalDate()} value={from} onChange={e => setFrom(e.target.value)} /></label>
        <label>{dateLabel} to<input type="date" aria-label={`${dateLabel} to`} max={hospitalDate()} value={to} onChange={e => setTo(e.target.value)} /></label>
      </div>
      <div className="export-summary">
        {theatre
          ? <p>{from || to ? 'All cases decided in the chosen dates, including completed and cancelled ones.' : 'Leave the dates blank to export the open theatre list.'}</p>
          : <><p><strong>Filters used:</strong> {active.length ? active.join(' · ') : 'none (all patients in this view)'}</p>
            <p>{from || to ? 'Only visits that arrived in the chosen dates are included.' : 'Leave the dates blank to include all arrival dates.'} {shownCount} {shownCount === 1 ? 'patient is' : 'patients are'} shown on screen now.</p></>}
        <p className="help-note">The file contains patient information. Your name, the time and the {theatre ? 'booking' : 'patient'} references are recorded in the Activity log.</p>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="dialog-footer"><button type="button" className="secondary" disabled={busy} onClick={onClose}>Cancel</button>
        <button className="primary" disabled={busy}><Download size={17} />{busy ? 'Preparing…' : 'Download CSV'}</button></div>
    </form>
  </dialog>;
}
