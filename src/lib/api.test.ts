import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from './api';

const auth = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('./supabase', () => ({ supabase: { auth } }));

beforeEach(() => {
  auth.getSession.mockResolvedValue({ data: { session: { access_token: 'test-user-token' } }, error: null });
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('Django API client', () => {
  it('binds each request to its explicit hospital context', async () => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response('{}', { status: 200 }))); vi.stubGlobal('fetch', fetch);
    await apiRequest('/necms/hospitals/A/board/', 'GET', undefined, 'context-A');
    await apiRequest('/necms/hospitals/B/board/', 'GET', undefined, 'context-B');
    expect(fetch.mock.calls[0][1].headers['X-NECMS-Context']).toBe('context-A');
    expect(fetch.mock.calls[1][1].headers['X-NECMS-Context']).toBe('context-B');
  });
  it('uses the signed-in token and sends versioned edits to Django', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'visit' }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    await apiRequest('/visits/visit/', 'PATCH', { input: { priority: 2 }, version: 4 });
    expect(fetch).toHaveBeenCalledWith('/api/visits/visit/', expect.objectContaining({
      method: 'PATCH', cache: 'no-store',
      headers: { Authorization: 'Bearer test-user-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: { priority: 2 }, version: 4 }),
    }));
  });
  it('does not send requests without a signed-in session', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(apiRequest('/board/')).rejects.toThrow('Sign in again');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('surfaces server workflow conflicts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: 'This space is already assigned to another patient.' }), { status: 409 })));
    await expect(apiRequest('/visits/', 'POST', {})).rejects.toThrow('already assigned');
  });
  it('handles an unreachable backend with an actionable message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network details')));
    await expect(apiRequest('/board/')).rejects.toThrow('Django server could not be reached');
  });
});
