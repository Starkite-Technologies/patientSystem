import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiDownload } from './api';
import { exportQuery } from './exportVisits';

const auth = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('./supabase', () => ({ supabase: { auth } }));
beforeEach(() => auth.getSession.mockResolvedValue({ data: { session: { access_token: 'test-user-token' } }, error: null }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

const none = { q: '', priority: 'all', status: 'all', action: 'all', from: '', to: '' };

describe('visit export', () => {
  it('sends only the active filters', () => {
    expect(exportQuery('board', none)).toBe('scope=board');
    expect(exportQuery('completed', { ...none, q: ' Amupolo ', priority: '2', from: '2026-10-01', to: '2026-10-26' }))
      .toBe('scope=completed&q=Amupolo&priority=2&from=2026-10-01&to=2026-10-26');
  });
  it('returns the server file name and row count with the session token', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('﻿Patient reference\r\n', { status: 200, headers: {
      'Content-Disposition': 'attachment; filename="patientflow-visits-2026-10-26.csv"', 'X-PatientFlow-Rows': '0' } }));
    vi.stubGlobal('fetch', fetch);
    const result = await apiDownload('/export/?scope=board');
    expect(result).toMatchObject({ filename: 'patientflow-visits-2026-10-26.csv', rows: 0 });
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer test-user-token');
  });
  it('shows the server reason when an export is refused or invalid', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: 'Only coordinators can export visits.' }), { status: 403 })));
    await expect(apiDownload('/export/?scope=board')).rejects.toMatchObject({ status: 403, message: 'Only coordinators can export visits.' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ non_field_errors: ['The start date must be on or before the end date.'] }), { status: 400 })));
    await expect(apiDownload('/export/?scope=board')).rejects.toMatchObject({ status: 400, message: 'The start date must be on or before the end date.' });
  });
});
