import { useState, type FormEvent } from 'react';
import { Bot, Database, Search, UserPlus } from 'lucide-react';
import { api, type History, type PatientCard, type Suggestion, type Summary, type Vitals } from './api';
import { TriageSuggestion } from './Suggestion';
import { emptyVitals, VitalsForm } from './VitalsForm';

interface Lookup { found: boolean; registry: string; patient?: PatientCard; history?: History | null; summary?: Summary | null; prefill?: Record<string, string>; registry_error?: string }

export function Arrival({ onDone }: { onDone: (encounterId: string) => void }) {
  const [identifier, setIdentifier] = useState('');
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [patient, setPatient] = useState<PatientCard | null>(null);
  const [newPatient, setNewPatient] = useState({ given: '', family: '', gender: '', birth_date: '', health_id: '', national_id: '', region: '' });
  const [vitals, setVitals] = useState<Vitals>(emptyVitals);
  const [complaint, setComplaint] = useState('');
  const [result, setResult] = useState<{ encounter_id: string; suggestion_id: string; suggestion: Suggestion } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function run<T>(work: () => Promise<T>) {
    setBusy(true); setError('');
    try { return await work(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  async function search(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      const found = await api<Lookup>('lookup/', { identifier });
      setLookup(found); setResult(null);
      if (found.found && found.patient) setPatient(found.patient);
      else {
        setPatient(null);
        const p = found.prefill || {};
        setNewPatient({ given: p.given || '', family: p.family || '', gender: p.gender || '', birth_date: p.birth_date || '',
          health_id: p.health_id || identifier, national_id: p.national_id || '', region: p.region || '' });
      }
    });
  }

  async function register(e: FormEvent) {
    e.preventDefault();
    await run(async () => setPatient(await api<PatientCard>('patients/', newPatient)));
  }

  async function suggest(e: FormEvent) {
    e.preventDefault();
    if (!patient) return;
    await run(async () => setResult(await api('arrivals/', { patient_id: patient.id, vitals, complaint })));
  }

  function reset() {
    setIdentifier(''); setLookup(null); setPatient(null); setResult(null); setVitals(emptyVitals); setComplaint('');
  }

  return (
    <div className="cran-page cran-arrival">
      <h2>Arrival</h2>
      <form className="cran-card cran-search" onSubmit={search}>
        <label className="cran-field cran-grow">
          <span>Health ID or national ID</span>
          <input autoFocus value={identifier} onChange={e => setIdentifier(e.target.value)} placeholder="e.g. NHI-1000001" disabled={!!result} />
        </label>
        <button className="cran-btn cran-btn-primary" disabled={busy || !identifier.trim() || !!result}><Search aria-hidden /> Search registry</button>
      </form>

      {lookup && (
        <section className="cran-card">
          <p className="cran-source"><Database aria-hidden /> {lookup.registry}</p>
          {lookup.registry_error && <p className="cran-notice">{lookup.registry_error}</p>}
          {lookup.found && patient ? (
            <RegistryRecord patient={patient} history={lookup.history ?? null} summary={lookup.summary ?? null} />
          ) : !patient ? (
            <form onSubmit={register}>
              <h3><UserPlus aria-hidden /> Not in the registry — register a new patient</h3>
              <div className="cran-grid2">
                <label className="cran-field"><span>First name</span><input required value={newPatient.given} onChange={e => setNewPatient({ ...newPatient, given: e.target.value })} /></label>
                <label className="cran-field"><span>Last name</span><input required value={newPatient.family} onChange={e => setNewPatient({ ...newPatient, family: e.target.value })} /></label>
                <label className="cran-field"><span>Sex</span>
                  <select required value={newPatient.gender} onChange={e => setNewPatient({ ...newPatient, gender: e.target.value })}>
                    <option value="">Choose…</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option><option value="unknown">Unknown</option>
                  </select></label>
                <label className="cran-field"><span>Date of birth</span><input required type="date" value={newPatient.birth_date} onChange={e => setNewPatient({ ...newPatient, birth_date: e.target.value })} /></label>
                <label className="cran-field"><span>Health ID</span><input value={newPatient.health_id} onChange={e => setNewPatient({ ...newPatient, health_id: e.target.value })} /></label>
                <label className="cran-field"><span>Region</span><input value={newPatient.region} onChange={e => setNewPatient({ ...newPatient, region: e.target.value })} /></label>
              </div>
              <button className="cran-btn cran-btn-primary" disabled={busy}><UserPlus aria-hidden /> Register patient</button>
            </form>
          ) : (
            <p className="cran-ok">Registered locally: <strong>{patient.name}</strong> ({patient.health_id}). Not in the national registry.</p>
          )}
        </section>
      )}

      {patient && !result && (
        <form className="cran-card" onSubmit={suggest}>
          <h3>Vitals and chief complaint for {patient.name}</h3>
          <VitalsForm value={vitals} onChange={setVitals} />
          <label className="cran-field"><span>Chief complaint</span>
            <textarea required rows={2} value={complaint} onChange={e => setComplaint(e.target.value)} placeholder="In plain words, e.g. chest pain for 1 hour" />
          </label>
          <button className="cran-btn cran-btn-primary cran-btn-big" disabled={busy}><Bot aria-hidden /> {busy ? 'Thinking…' : 'Get triage suggestion'}</button>
        </form>
      )}

      {result && (
        <TriageSuggestion encounterId={result.encounter_id} suggestionId={result.suggestion_id} suggestion={result.suggestion}
          onDecided={() => { const id = result.encounter_id; reset(); onDone(id); }} />
      )}
      {error && <p className="cran-error" role="alert">{error}</p>}
    </div>
  );
}

export function RegistryRecord({ patient, history, summary }: { patient: PatientCard; history: History | null; summary: Summary | null }) {
  return (
    <div className="cran-record">
      <div className="cran-identity">
        <strong className="cran-name">{patient.name}</strong>
        <span>{patient.age ?? '?'} years · {patient.sex} · born {patient.birth_date}</span>
        <span>Health ID {patient.health_id}{patient.national_id ? ` · National ID ${patient.national_id}` : ''}{patient.region ? ` · ${patient.region}` : ''}</span>
      </div>
      {summary && (
        <div className="cran-summary">
          <p className="cran-ai-tag">{summary.source === 'ai' ? 'Suggested by AI — summary' : 'Rule-based summary'}</p>
          <p>{summary.summary}</p>
          {summary.notice && <p className="cran-notice">{summary.notice}</p>}
        </div>
      )}
      {history && (
        <div className="cran-history">
          <div><h4>Allergies</h4>{history.allergies.length ? <ul className="cran-allergy">{history.allergies.map(a => <li key={a}>{a}</li>)}</ul> : <p>None recorded</p>}</div>
          <div><h4>Conditions</h4>{history.conditions.length ? <ul>{history.conditions.map(c => <li key={c}>{c}</li>)}</ul> : <p>None recorded</p>}</div>
          <div><h4>Past visits</h4>{history.encounters.length ? <ul>{history.encounters.map(e => <li key={e.date + e.reason}>{e.date} · {e.facility} · {e.reason}</li>)}</ul> : <p>None</p>}</div>
        </div>
      )}
    </div>
  );
}
