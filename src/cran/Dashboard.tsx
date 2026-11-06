import { useEffect, useState } from 'react';
import { BellRing, FileJson, FileSpreadsheet, Share2, Users } from 'lucide-react';
import { api, download } from './api';
import { LevelBadge, minutes } from './levels';

interface Point { hour: string; label: string; expected: number; low: number; high: number }
interface Dash {
  levels: { level: number; colour: string; label: string; count: number; avg_wait: number | null }[];
  untriaged: number; active: number; arrivals_today: number; arrivals_today_by_hour: Record<string, number>;
  forecast: { label: string; method: string; points: Point[]; expected_total: number }; open_alerts: number; date: string;
}

export function Dashboard({ version }: { version: string }) {
  const [data, setData] = useState<Dash | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { api<Dash>('dashboard/').then(d => { setData(d); setError(''); }).catch(e => setError(e.message)); }, [version]);
  if (error) return <div className="cran-page"><p className="cran-error">{error}</p></div>;
  if (!data) return <div className="cran-page"><p>Loading…</p></div>;
  const run = (path: string) => download(path).catch(e => setError(e.message));
  const maxCount = Math.max(1, ...data.levels.map(l => l.count));

  return (
    <div className="cran-page cran-dashboard">
      <h2>Supervisor dashboard <small>{data.date}</small></h2>
      <div className="cran-kpis">
        <div className="cran-kpi"><Users aria-hidden /><strong>{data.active}</strong><span>active patients</span></div>
        <div className="cran-kpi"><strong>{data.arrivals_today}</strong><span>arrivals today</span></div>
        <div className="cran-kpi"><BellRing aria-hidden /><strong>{data.open_alerts}</strong><span>open alerts</span></div>
        <div className="cran-kpi"><strong>{data.forecast.expected_total}</strong><span>expected next 6 h (forecast)</span></div>
      </div>
      <div className="cran-dash-grid">
        <section className="cran-card">
          <h3>Patients and average wait by level</h3>
          <div className="cran-table-wrap"><table className="cran-table cran-level-table">
            <thead><tr><th>Level</th><th>Patients</th><th></th><th>Avg wait (waiting)</th></tr></thead>
            <tbody>
              {data.levels.map(l => (
                <tr key={l.level}>
                  <td><LevelBadge level={l.level} size="sm" /></td>
                  <td><strong>{l.count}</strong></td>
                  <td className="cran-bar-cell"><span className={`cran-bar cran-bg-${l.colour.toLowerCase()}`} style={{ width: `${(l.count / maxCount) * 100}%` }} /></td>
                  <td>{l.avg_wait === null ? '—' : minutes(l.avg_wait)}</td>
                </tr>
              ))}
              {data.untriaged > 0 && <tr><td><LevelBadge level={null} size="sm" /></td><td><strong>{data.untriaged}</strong></td><td /><td /></tr>}
            </tbody>
          </table></div>
        </section>
        <section className="cran-card">
          <h3>Crowding forecast — next 6 hours <span className="cran-tag">Forecast</span></h3>
          <ForecastChart points={data.forecast.points} />
          <p className="cran-hint">{data.forecast.method}</p>
        </section>
        <section className="cran-card">
          <h3>Exports</h3>
          <div className="cran-exports">
            <button className="cran-btn" onClick={() => run(`export/bundle/?date=${data.date}`)}><FileJson aria-hidden /> FHIR Bundle (today)</button>
            <button className="cran-btn" onClick={() => run(`export/dhis2/?date=${data.date}`)}><Share2 aria-hidden /> DHIS2-style report</button>
            <button className="cran-btn" onClick={() => run(`export/csv/?date=${data.date}`)}><FileSpreadsheet aria-hidden /> CSV</button>
          </div>
          <p className="cran-hint">FHIR R4 JSON · DHIS2-compatible format (demo) with placeholder codes · CSV for spreadsheets. Synthetic data only.</p>
        </section>
      </div>
    </div>
  );
}

function ForecastChart({ points }: { points: Point[] }) {
  const max = Math.max(1, ...points.map(p => p.high));
  const w = 520, h = 220, pad = 30, bw = (w - pad * 2) / points.length;
  const y = (v: number) => h - pad - (v / max) * (h - pad * 2);
  return (
    <svg className="cran-forecast" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Forecast arrivals: ${points.map(p => `${p.label} ${p.expected}`).join(', ')}`}>
      <line x1={pad} x2={w - pad} y1={h - pad} y2={h - pad} className="cran-axis" />
      {points.map((p, i) => {
        const x = pad + i * bw + bw * 0.2, width = bw * 0.6;
        return (
          <g key={p.hour}>
            <line x1={x + width / 2} x2={x + width / 2} y1={y(p.low)} y2={y(p.high)} className="cran-range" />
            <rect x={x} y={y(p.expected)} width={width} height={h - pad - y(p.expected)} className="cran-fbar" rx="4" />
            <text x={x + width / 2} y={Math.min(y(p.expected), y(p.high)) - 8} textAnchor="middle" className="cran-fval">{p.expected}</text>
            <text x={x + width / 2} y={h - 8} textAnchor="middle">{p.label}</text>
          </g>
        );
      })}
    </svg>
  );
}
