export const vitalUnits = { heart_rate: 'bpm', respiratory_rate: 'breaths/min', blood_pressure: 'mmHg', temperature: 'C', oxygen_saturation: '%', consciousness: 'text', pain: 'score/10' } as const;
export type VitalKind = keyof typeof vitalUnits;
export type Vital = { kind: VitalKind; measurement_status: 'measured' | 'unknown' | 'unavailable' | 'not_measured'; unit: string; value?: number | null; systolic?: number | null; diastolic?: number | null; text_value?: string | null; observed_at?: string };
export function validateVital(v: Vital) {
  if (v.unit !== vitalUnits[v.kind]) throw new Error('Incorrect observation unit.');
  const numbers = [v.value, v.systolic, v.diastolic];
  if (numbers.some(value => value != null && !Number.isFinite(value))) throw new Error('Measurements must be finite.');
  if (v.measurement_status !== 'measured') {
    if ([...numbers, v.text_value].some(value => value != null)) throw new Error('Unknown/unavailable measurements must not contain substituted values.');
    return;
  }
  if (v.kind === 'consciousness') { if (!v.text_value?.trim() || numbers.some(value => value != null)) throw new Error('Enter the observed consciousness description.'); return; }
  if (v.kind === 'blood_pressure') { if (v.systolic == null || v.diastolic == null || v.diastolic < 0 || v.systolic < v.diastolic || v.value != null || v.text_value != null) throw new Error('Check systolic and diastolic measurements.'); return; }
  if (v.value == null || v.systolic != null || v.diastolic != null || v.text_value != null) throw new Error('Enter the measured value.');
  if (v.kind === 'temperature' ? v.value <= -273.15 : v.value < 0 || (v.kind === 'oxygen_saturation' && v.value > 100) || (v.kind === 'pain' && v.value > 10)) throw new Error('Invalid measurement for this recording format.');
}
