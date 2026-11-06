import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  for (const role of ['coordinator', 'surgeon', 'nurse', 'viewer']) {
    const context = await browser.newContext({ acceptDownloads: true });
    await context.addInitScript(() => {
      const encode = value => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
      const exp = Math.floor(Date.now() / 1000) + 3600;
      localStorage.setItem('sb-isolated-test-auth-token', JSON.stringify({ access_token: `${encode({ alg: 'HS256' })}.${encode({ sub: 'synthetic-user', exp })}.synthetic`, refresh_token: 'synthetic-refresh', expires_at: exp, token_type: 'bearer', user: { id: 'synthetic-user', email: 'export@example.invalid' } }));
    });
    let exported = false, refuse = false;
    const queries = [];
    await context.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      if (url.hostname !== '127.0.0.1') return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.continue();
      const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (url.pathname === '/api/board/') return json({ role, resources: [], visits: [], events: exported ? [{ id: 'synthetic-event', actor: 'Fictional Coordinator', action: 'exported', summary: 'Exported 0 current board visits to CSV', created_at: new Date().toISOString() }] : [] });
      if (url.pathname === '/api/export/') {
        assert.ok(request.headers().authorization?.startsWith('Bearer '));
        queries.push(url.searchParams);
        if (refuse) return json({ detail: 'Audit recording unavailable; export refused.' }, 503);
        exported = true;
        return route.fulfill({ contentType: 'text/csv; charset=utf-8', headers: { 'Content-Disposition': 'attachment; filename="fictional-export.csv"', 'X-PatientFlow-Rows': '0' }, body: '\ufeffPatient reference\r\n' });
      }
      return json({ detail: 'Unexpected test request' }, 404);
    });
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:5178');
    await expect(page.getByRole('heading', { name: 'Patient board', exact: true })).toBeVisible();
    const button = page.getByRole('button', { name: 'Export', exact: true });
    if (role !== 'coordinator') {
      await expect(button).toHaveCount(0);
      await context.close(); continue;
    }
    await button.click();
    await page.getByLabel('Arrived from', { exact: true }).fill('2026-10-01');
    await page.getByLabel('Arrived to', { exact: true }).fill('2026-10-26');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download CSV', exact: true }).click();
    assert.equal((await download).suggestedFilename(), 'fictional-export.csv');
    assert.equal(queries[0].get('scope'), 'board');
    assert.equal(queries[0].get('from'), '2026-10-01');
    await expect(page.getByRole('status')).toContainText('Recorded in the Activity log.');
    await page.getByRole('button', { name: 'Activity log', exact: true }).click();
    await expect(page.getByText('Exported 0 current board visits to CSV', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Completed visits', exact: true }).click();
    await button.click();
    refuse = true;
    let downloads = 0;
    page.on('download', () => downloads++);
    await page.getByRole('button', { name: 'Download CSV', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('Audit recording unavailable; export refused.');
    assert.equal(queries[1].get('scope'), 'completed');
    assert.equal(downloads, 0);
    await context.close();
  }
  console.log('Export browser checks passed: coordinator download, dates, activity refresh, completed scope, audit-failure refusal and hidden controls for other roles. Auth/API mocked; external requests blocked.');
} finally { await browser.close(); }
