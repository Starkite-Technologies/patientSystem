import { useState } from 'react';
import { Bot, Calculator, Check, Pencil } from 'lucide-react';
import { api, type Suggestion } from './api';
import { allLevels, LevelBadge, levelInfo } from './levels';

// The AI suggests; the clinician decides. Confirm accepts the highlighted level, Change picks another (with a reason).
export function TriageSuggestion({ encounterId, suggestionId, suggestion, onDecided }: {
  encounterId: string; suggestionId: string; suggestion: Suggestion; onDecided: (level: number) => void;
}) {
  const [changing, setChanging] = useState(false);
  const [level, setLevel] = useState<number>(suggestion.suggested_level);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { rules, ai } = suggestion;
  const highlight = suggestion.suggested_level;

  async function decide(chosen: number) {
    setBusy(true); setError('');
    try {
      await api(`encounters/${encounterId}/triage/`, { level: chosen, suggestion_id: suggestionId, reason });
      onDecided(chosen);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <section className="cran-suggestion" aria-live="polite">
      <h3>Triage suggestion</h3>
      {suggestion.notice && <p className="cran-notice">{suggestion.notice}</p>}
      {suggestion.disagree && <p className="cran-disagree">The AI and the rules disagree. The more urgent level is highlighted.</p>}
      <div className="cran-suggestion-grid">
        <article className={`cran-option ${highlight === rules.level ? 'is-highlight' : ''}`}>
          <header><Calculator aria-hidden /> Rule-based baseline (always shown)</header>
          <LevelBadge level={rules.level} size="lg" />
          <ul>{rules.reasons.map(r => <li key={r}>{r}</li>)}</ul>
          {rules.caution && <p className="cran-caution">{rules.caution}</p>}
          <small>{rules.method}</small>
        </article>
        {ai ? (
          <article className={`cran-option ${highlight === ai.level ? 'is-highlight' : ''}`}>
            <header><Bot aria-hidden /> <span className="cran-ai-tag">Suggested by AI</span> <small>confidence {ai.confidence}</small></header>
            <LevelBadge level={ai.level} size="lg" />
            <ul>{ai.reasons.map(r => <li key={r}>{r}</li>)}</ul>
            <small>{ai.model} · prompt {ai.prompt}</small>
          </article>
        ) : (
          <article className="cran-option is-muted">
            <header><Bot aria-hidden /> AI suggestion</header>
            <p>Not available. The rule-based baseline is the suggestion.</p>
          </article>
        )}
      </div>
      {!changing ? (
        <div className="cran-actions">
          <button className="cran-btn cran-btn-primary" disabled={busy} onClick={() => decide(highlight)}>
            <Check aria-hidden /> Confirm P{highlight} {levelInfo(highlight).colour}
          </button>
          <button className="cran-btn" disabled={busy} onClick={() => setChanging(true)}><Pencil aria-hidden /> Change</button>
        </div>
      ) : (
        <div className="cran-change">
          <fieldset>
            <legend>Choose the level</legend>
            <div className="cran-level-picker">
              {allLevels.map(l => (
                <label key={l} className={level === l ? 'is-selected' : ''}>
                  <input type="radio" name="level" checked={level === l} onChange={() => setLevel(l)} />
                  <LevelBadge level={l} />
                </label>
              ))}
            </div>
          </fieldset>
          <label className="cran-field">Reason for changing the suggestion
            <input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. severe pain, clinical concern" />
          </label>
          <div className="cran-actions">
            <button className="cran-btn cran-btn-primary" disabled={busy} onClick={() => decide(level)}><Check aria-hidden /> Save P{level} {levelInfo(level).colour}</button>
            <button className="cran-btn" onClick={() => setChanging(false)}>Back</button>
          </div>
        </div>
      )}
      {error && <p className="cran-error" role="alert">{error}</p>}
    </section>
  );
}
