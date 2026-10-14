import { supabase } from './supabase';

export async function apiRequest<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  if (!supabase) throw new Error('Sign in before accessing the server.');
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new Error('Your staff session has expired. Sign in again.');
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method, headers: { Authorization: `Bearer ${data.session.access_token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store', signal: AbortSignal.timeout(60000),
    });
  } catch {
    throw new Error('The Django server could not be reached. Check the connection and try again.');
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    if (typeof payload?.detail === 'string') throw new Error(payload.detail);
    if (response.status === 400) throw new Error('Check the patient form for invalid or missing values.');
    throw new Error('The Django server could not complete this request. Please try again.');
  }
  if (!payload) throw new Error('The Django server returned an unexpected response.');
  return payload as T;
}
