import { supabase } from './supabase';

export class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }
export async function apiRequest<T>(path: string, method = 'GET', body?: unknown, context?: string, signal?: AbortSignal): Promise<T> {
  if (!supabase) throw new Error('Sign in before accessing the server.');
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new ApiError('Your staff session has expired. Sign in again.', 401);
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method, headers: { Authorization: `Bearer ${data.session.access_token}`, 'Content-Type': 'application/json', ...(context ? { 'X-NECMS-Context': context } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000),
    });
  } catch {
    throw new Error('The Django server could not be reached. Check the connection and try again.');
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    if (typeof payload?.detail === 'string') throw new ApiError(payload.detail, response.status);
    if (response.status === 400) throw new ApiError('Check the patient form for invalid or missing values.', response.status);
    throw new ApiError('The Django server could not complete this request. Please try again.', response.status);
  }
  if (!payload) throw new Error('The Django server returned an unexpected response.');
  return payload as T;
}
