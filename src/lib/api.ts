import { supabase } from './supabase';

export class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }
async function accessToken() {
  if (!supabase) throw new Error('Sign in before accessing the server.');
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new ApiError('Your staff session has expired. Sign in again.', 401);
  return data.session.access_token;
}
function errorMessage(payload: unknown, status: number) {
  const body = payload as { detail?: unknown; non_field_errors?: unknown } | null;
  if (typeof body?.detail === 'string') return body.detail;
  if (Array.isArray(body?.non_field_errors) && typeof body.non_field_errors[0] === 'string') return body.non_field_errors[0];
  if (status === 400) return 'Check the patient form for invalid or missing values.';
  return 'The Django server could not complete this request. Please try again.';
}
export async function apiRequest<T>(path: string, method = 'GET', body?: unknown, context?: string, signal?: AbortSignal): Promise<T> {
  const token = await accessToken();
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(context ? { 'X-NECMS-Context': context } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000),
    });
  } catch {
    throw new Error('The Django server could not be reached. Check the connection and try again.');
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(errorMessage(payload, response.status), response.status);
  if (!payload) throw new Error('The Django server returned an unexpected response.');
  return payload as T;
}
// File responses (CSV export): returns the body with the server-chosen file name.
export async function apiDownload(path: string, signal?: AbortSignal): Promise<{ blob: Blob; filename: string; rows: number }> {
  const token = await accessToken();
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000),
    });
  } catch {
    throw new Error('The Django server could not be reached. Check the connection and try again.');
  }
  if (!response.ok) throw new ApiError(errorMessage(await response.json().catch(() => null), response.status), response.status);
  const filename = /filename="([^"]+)"/.exec(response.headers.get('Content-Disposition') ?? '')?.[1] ?? 'patientflow-export.csv';
  return { blob: await response.blob(), filename, rows: Number(response.headers.get('X-PatientFlow-Rows') ?? 0) };
}
