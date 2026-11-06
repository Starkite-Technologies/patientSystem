import type { Vitals } from './api';

export const emptyVitals: Vitals = { heart_rate: '', respiratory_rate: '', systolic_bp: '', diastolic_bp: '', temperature: '', spo2: '', consciousness: 'A', on_oxygen: false };

const fields: [keyof Vitals, string, string, number?][] = [
  ['heart_rate', 'Heart rate', '/min'],
  ['respiratory_rate', 'Respiratory rate', '/min'],
  ['systolic_bp', 'BP systolic', 'mmHg'],
  ['diastolic_bp', 'BP diastolic', 'mmHg'],
  ['temperature', 'Temperature', '°C', 0.1],
  ['spo2', 'SpO₂', '%'],
];

export function VitalsForm({ value, onChange }: { value: Vitals; onChange: (v: Vitals) => void }) {
  const set = (key: keyof Vitals, v: unknown) => onChange({ ...value, [key]: v });
  return (
    <div className="cran-vitals">
      {fields.map(([key, label, unit, step]) => (
        <label key={key} className="cran-field">
          <span>{label} <small>{unit}</small></span>
          <input inputMode="decimal" type="number" step={step ?? 1} required value={value[key] as number | ''}
                 onChange={e => set(key, e.target.value === '' ? '' : Number(e.target.value))} />
        </label>
      ))}
      <label className="cran-field">
        <span>Consciousness <small>ACVPU</small></span>
        <select value={value.consciousness} onChange={e => set('consciousness', e.target.value)}>
          <option value="A">A – Alert</option>
          <option value="C">C – New confusion</option>
          <option value="V">V – Responds to voice</option>
          <option value="P">P – Responds to pain</option>
          <option value="U">U – Unresponsive</option>
        </select>
      </label>
      <label className="cran-check">
        <input type="checkbox" checked={value.on_oxygen} onChange={e => set('on_oxygen', e.target.checked)} /> On oxygen
      </label>
    </div>
  );
}
