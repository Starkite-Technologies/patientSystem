// CRAN demo API client. Synthetic data only; the role switcher sets X-Demo-Role.
import { createClient } from '@supabase/supabase-js';

export type DemoRole = 'nurse' | 'doctor' | 'supervisor';
let role: DemoRole = 'nurse';
export const setRole = (next: DemoRole) => { role = next; };
export const currentRole = () => role;

export class CranError extends Error {}

export async function api<T = any>(path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/cran/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Demo-Role': role },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new CranError('The PatientFlow server is not reachable. Check that the demo is running.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new CranError(data.detail || `Request failed (${response.status}).`);
  return data as T;
}

export async function download(path: string) {
  const response = await fetch(`/api/cran/${path}`, { headers: { 'X-Demo-Role': role } });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new CranError(data.detail || 'Export failed.');
  }
  const name = /filename="([^"]+)"/.exec(response.headers.get('Content-Disposition') || '')?.[1] || 'export';
  const url = URL.createObjectURL(await response.blob());
  const link = Object.assign(document.createElement('a'), { href: url, download: name });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Live updates: Supabase Realtime when the demo store is a Supabase project,
// otherwise a short poll (the local file store). Both call `onChange`.
export function subscribe(onChange: () => void, intervalMs = 2000) {
  const timer = setInterval(onChange, intervalMs);
  const url = import.meta.env.VITE_CRAN_SUPABASE_URL;
  const key = import.meta.env.VITE_CRAN_SUPABASE_KEY;
  let cleanup = () => {};
  if (import.meta.env.VITE_CRAN_REALTIME === 'supabase' && url && key) {
    const client = createClient(url, key);
    const channel = client.channel('cran-board')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fhir_resources' }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cran_records' }, onChange)
      .subscribe();
    cleanup = () => { client.removeChannel(channel); };
  }
  return () => { clearInterval(timer); cleanup(); };
}

export interface Vitals {
  heart_rate: number | ''; respiratory_rate: number | ''; systolic_bp: number | ''; diastolic_bp: number | '';
  temperature: number | ''; spo2: number | ''; consciousness: 'A' | 'C' | 'V' | 'P' | 'U' | ''; on_oxygen: boolean;
  at?: string; news2?: number;
}
export interface PatientCard { id: string; name: string; health_id: string | null; national_id: string | null; age: number | null; sex: string | null; birth_date: string | null; region: string | null; source: string }
export interface Alert { id: string; encounter_id: string; suggested_level: number | null; reasons: string[]; message: string; news2: number; status: string; created_at: string }
export interface Row { encounter_id: string; status: string; level: number | null; arrived_at: string; wait_minutes: number; overdue: boolean; patient: PatientCard; complaint: string | null; vitals: Vitals | null; news2: number | null; alert: Alert | null }
export interface AIStatus { available: boolean; mode: 'ai' | 'rules'; model?: string; message: string }
export interface BoardState { rows: Row[]; server_time: string; ai: AIStatus; version: number; registry: string; scripted: { encounter_id?: string; at?: string; done?: boolean } }
export interface RuleResult { news2: number; level: number; colour: string; label: string; reasons: string[]; caution: string | null; method: string }
export interface AIResult { level: number; colour: string; label: string; reasons: string[]; confidence: string; model: string; prompt: string }
export interface Suggestion { rules: RuleResult; ai: AIResult | null; source: 'ai' | 'rules'; notice: string | null; suggested_level: number; disagree: boolean; more_urgent_source: 'ai' | 'rules' | null }
export interface History { encounters: { date: string; facility: string; reason: string }[]; conditions: string[]; allergies: string[] }
export interface Summary { source: 'ai' | 'rules'; summary: string; notice: string | null }
