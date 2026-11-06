// Theatre list, Settings and footer in a real browser with a fictional session and mocked Django responses.
// Start the isolated UI first: node scripts/start-export-test.mjs   (port 5178; all external requests are blocked)
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const base = process.env.PREVIEW_URL ?? 'http://127.0.0.1:5178';
await mkdir('test-results/theatre', { recursive: true });
const now = Date.now();
const iso = minutes => new Date(now + minutes * 60000).toISOString();
const codes = [['P0', 'immediate', 'Immediate', 15], ['P1', 'urgent', 'Within 1 hour', 60], ['P2', 'urgent', 'Within 2 hours', 120], ['P3', 'urgent', 'Within 6 hours', 360],
  ['P4', 'urgent', 'Within 12 hours', 720], ['P5', 'expedited', 'Within 24 hours', 1440], ['P6', 'expedited', 'Within 72 hours', 4320]]
  .map(([code, ncepod, label, target_minutes], i) => ({ code, ncepod, label, target_minutes, example: `Fictional example ${code}`, sort_order: i, clinically_approved: false }));
const theatres = [{ id: 't1', name: 'Theatre 01', state: 'available' }, { id: 't2', name: 'Theatre 02', state: 'cleaning' }];
function booking(id, code, decidedMinutesAgo, over = {}) {
  const c = codes.find(x => x.code === code);
  return { id, booking_ref: `TB-00000${id}`, patient_id: `p${id}`, visit_id: null, patient_ref: `PF-00000${id}`, first_name: 'Fictional', last_name: `Patient ${id}`,
    date_of_birth: '1980-01-01', mrn: '', sex: 'unknown', location: 'Ward 3', specialty: 'General Surgery', responsible_consultant: 'Dr Fictional Consultant',
    booked_by_name: 'Fictional Registrar', diagnosis: 'Fictional diagnosis', proposed_operation: `Fictional operation ${id}`, indication: 'Fictional', delay_consequence: 'sepsis',
    priority_code: code, ncepod: c.ncepod, priority_label: c.label, target_minutes: c.target_minutes, priority_order: c.sort_order, clinically_approved: false,
    decision_at: iso(-decidedMinutesAgo), booked_at: iso(-decidedMinutesAgo + 2), deadline_at: iso(-decidedMinutesAgo + c.target_minutes), estimated_minutes: 90,
    haemodynamically_unstable: false, septic_shock: false, organ_support: false, anaesthetic_concern: false, ready_for_theatre: false, details_complete: true,
    status: 'booked', theatre_id: null, theatre_name: null, planned_start: null, anaesthesia_start_at: null, incision_at: null, completed_at: null,
    delay_category: null, delay_note: '', cancelled_reason: '', cancel_authorised_by: '', updated_at: iso(-5), version: 1, ...over };
}
const bookings = [
  booking('3', 'P3', 30),
  booking('2', 'P1', 70, { septic_shock: true }),
  booking('1', 'P0', 5, { details_complete: false }),
  booking('4', 'P2', 50, { status: 'operating', theatre_id: 't1', theatre_name: 'Theatre 01', anaesthesia_start_at: iso(-40), incision_at: iso(-30) }),
  booking('5', 'P5', 300, { status: 'completed', completed_at: iso(-60) }),
];
const visits = [{ id: 'v1', patient_id: 'pv1', patient_ref: 'PF-000099', first_name: 'Fictional', last_name: 'Ward Patient', date_of_birth: '1975-05-05', patient_version: 1,
  names_need_review: false, complaint: 'Fictional', priority: 2, status: 'waiting', next_action: 'surgery', location: 'Resus', resource_id: null, assigned_to: '', notes: '',
  arrived_at: iso(-60), updated_at: iso(-10), version: 1 }];

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const failures = [];
try {
  for (const role of ['surgeon', 'nurse', 'viewer']) {
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    await context.addInitScript(() => {
      const encode = value => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
      const exp = Math.floor(Date.now() / 1000) + 3600;
      localStorage.setItem('sb-isolated-test-auth-token', JSON.stringify({ access_token: `${encode({ alg: 'HS256' })}.${encode({ sub: 'synthetic-user', exp })}.synthetic`, refresh_token: 'synthetic-refresh', expires_at: exp, token_type: 'bearer', user: { id: 'synthetic-user', email: 'theatre@example.invalid' } }));
    });
    const sent = [];
    await context.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      if (url.hostname !== '127.0.0.1') return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.continue();
      const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (url.pathname === '/api/board/') return json({ role, resources: [], visits, events: [] });
      if (url.pathname === '/api/theatre/') return json({ role, codes, bookings, theatres, staff: [{ name: 'Dr Fictional Consultant', role: 'surgeon' }] });
      if (url.pathname.endsWith('/history/')) return json({ changes: [] });
      if (url.pathname.startsWith('/api/theatre/bookings/')) { sent.push({ method: request.method(), path: url.pathname, body: request.postDataJSON() }); return json({ id: 'new' }, request.method() === 'POST' && url.pathname === '/api/theatre/bookings/' ? 201 : 200); }
      return json({ detail: 'Unexpected test request' }, 404);
    });
    const page = await context.newPage();
    await page.goto(base);
    await page.getByRole('button', { name: 'Theatre list' }).click();
    await expect(page.getByRole('heading', { name: 'Emergency theatre list', exact: true })).toBeVisible();
    await expect(page.getByText('Not yet clinically approved.')).toBeVisible();
    // Order: P0 first, then P1, then the case in theatre (P2), then P3.
    const refs = await page.locator('.theatre-table tbody tr td.cell-patient small:first-of-type').allTextContents();
    assert.deepEqual(refs.map(r => r.split(' · ')[0]), ['TB-000001', 'TB-000002', 'TB-000004', 'TB-000003'], `order for ${role}`);
    await expect(page.locator('.theatre-table tbody tr').nth(0)).toContainText('Immediate · waiting');
    await expect(page.locator('.theatre-table tbody tr').nth(1)).toContainText('Past deadline');
    await expect(page.locator('.theatre-table tbody tr').nth(1)).toContainText('Septic shock');
    await expect(page.getByText('Completed and cancelled in the last 24 hours')).toBeVisible();
    const canBook = role === 'surgeon';
    await expect(page.getByRole('button', { name: 'Book case' })).toHaveCount(canBook ? 1 : 0);
    await expect(page.getByRole('button', { name: 'Export' })).toHaveCount(role === 'surgeon' ? 1 : 0);

    if (role === 'surgeon') {
      await page.getByRole('button', { name: 'Book case' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel('First name').fill('Fictional');
      await dialog.getByLabel('Last name').fill('New');
      await dialog.getByLabel('Ward / location').fill('Ward 7');
      await dialog.getByLabel('Proposed operation').fill('Fictional appendicectomy');
      await dialog.getByLabel('Surgical specialty').selectOption('General Surgery');
      await dialog.getByLabel('Responsible consultant').fill('Dr Fictional Consultant');
      await dialog.getByLabel('Diagnosis').fill('Fictional appendicitis');
      await dialog.getByLabel('Indication / brief summary').fill('Fictional indication');
      await dialog.getByLabel('Estimated duration').selectOption('60');
      await dialog.getByLabel('Priority code').selectOption('P5');
      await dialog.getByLabel('Likely consequence if delayed beyond the target').selectOption('sepsis');
      for (const label of ['Haemodynamically unstable', 'Vasopressors / organ support', 'Major anaesthetic concern']) await dialog.getByLabel(label).selectOption('no');
      await dialog.getByLabel('Septic shock').selectOption('yes');
      await expect(dialog.getByText('septic shock but booked P5')).toBeVisible();
      await page.screenshot({ path: 'test-results/theatre/booking-dialog.png' });
      await dialog.getByRole('button', { name: 'Book case' }).click();
      await expect(page.getByText('Theatre case booked.')).toBeVisible();
      const booked = sent.find(s => s.path === '/api/theatre/bookings/');
      assert.equal(booked.body.input.priority_code, 'P5', 'the warning never changes the code');
      assert.equal(booked.body.input.septic_shock, true);
      assert.equal(booked.body.input.rapid, false);

      await page.getByRole('button', { name: 'Rapid P0' }).click();
      const rapid = page.getByRole('dialog');
      await expect(rapid.getByText('Also start the hospital')).toBeVisible();
      await rapid.getByLabel('Patient').selectOption('v1');
      await rapid.getByLabel('Ward / location').fill('Resus');
      await rapid.getByLabel('Proposed operation').fill('Fictional laparotomy');
      await rapid.getByRole('button', { name: 'Book immediate case' }).click();
      await expect(page.getByText('Immediate case booked.')).toBeVisible();
      const rapidBody = sent.filter(s => s.path === '/api/theatre/bookings/')[1].body.input;
      assert.equal(rapidBody.rapid, true); assert.equal(rapidBody.patient_id, 'pv1'); assert.equal(rapidBody.visit_id, 'v1');

      await page.getByRole('button', { name: 'Open TB-000002' }).click();
      const caseDialog = page.getByRole('dialog');
      await expect(caseDialog.getByText('This case is past its deadline.')).toBeVisible();
      const change = caseDialog.getByRole('button', { name: 'Change priority' });
      await caseDialog.getByLabel('New priority code').selectOption('P0');
      await expect(change).toBeDisabled();
      await caseDialog.getByLabel('Clinical reason').fill('Fictional deterioration');
      await page.screenshot({ path: 'test-results/theatre/case-dialog.png' });
      await change.click();
      await expect(page.getByText('Priority changed.')).toBeVisible();
      const priority = sent.find(s => s.path.endsWith('/priority/'));
      assert.deepEqual(priority.body, { version: 1, code: 'P0', reason: 'Fictional deterioration' });
      await caseDialog.getByRole('button', { name: 'Close' }).last().click();
    }
    if (role === 'nurse') {
      await page.getByRole('button', { name: 'Open TB-000003' }).click();
      const caseDialog = page.getByRole('dialog');
      await expect(caseDialog.getByLabel('Theatre', { exact: true })).toBeDisabled();
      await expect(caseDialog.getByLabel('Ready for theatre')).toBeEnabled();
      await expect(caseDialog.getByRole('button', { name: 'Change priority' })).toHaveCount(0);
      await caseDialog.getByLabel('Ready for theatre').selectOption('yes');
      await caseDialog.getByRole('button', { name: 'Save changes' }).click();
      await expect(page.getByText('Theatre case updated.')).toBeVisible();
      assert.deepEqual(sent.find(s => s.method === 'PATCH').body, { version: 1, input: { ready_for_theatre: true } }, 'nurse sends readiness only');
    }

    // Settings and footer.
    await page.getByRole('button', { name: 'Settings' }).first().click();
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
    await page.getByRole('group', { name: 'First screen' }).getByRole('button', { name: 'Theatre list' }).click();
    assert.equal(await page.evaluate(() => localStorage.getItem('patientflow-start-view')), 'theatre');
    await page.getByRole('group', { name: 'Text size', exact: true }).getByRole('button', { name: 'Extra large', exact: true }).click();
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize), '18px');
    await expect(page.locator('.settings-table tbody tr')).toHaveCount(7);
    await expect(page.locator('.app-footer')).toContainText('Developed by Starkite Technologies (Pty) Ltd');
    await expect(page.locator('.app-footer')).toContainText('info@starkite.tech');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Emergency theatre list', exact: true })).toBeVisible();
    await page.evaluate(() => { localStorage.removeItem('patientflow-start-view'); localStorage.removeItem('patientflow-text-size-v2'); });

    // Layout: no sideways scrolling on any screen at any text size (viewer pass only, to keep it quick).
    if (role === 'viewer') {
      for (const [w, h] of [[375, 812], [768, 1024], [1024, 768], [1366, 800], [1920, 1080]]) {
        await page.setViewportSize({ width: w, height: h });
        for (const size of ['normal', 'large', 'xl']) {
          for (const view of ['Theatre list', 'Settings']) {
            await page.evaluate(s => { document.documentElement.dataset.textSize = s; }, size);
            await page.getByRole('button', { name: view }).first().click();
            await page.waitForTimeout(150);
            if (view === 'Settings') await page.getByRole('heading', { name: 'Your account' }).waitFor();
            const overflow = await page.evaluate(() => {
              const page = document.documentElement.scrollWidth - document.documentElement.clientWidth;
              const ts = document.querySelector('.table-scroll');
              return { page, board: ts ? ts.scrollWidth - ts.clientWidth : 0 };
            });
            if (overflow.page > 0 || overflow.board > 0) failures.push(`${view} ${w}px ${size}: page +${overflow.page}px, list +${overflow.board}px`);
            if (size === 'normal' && view === 'Theatre list' && [375, 1366].includes(w)) await page.screenshot({ path: `test-results/theatre/theatre-${w}.png`, fullPage: w === 375 });
            if (size === 'normal' && view === 'Settings' && w === 375) await page.screenshot({ path: 'test-results/theatre/settings-375.png', fullPage: true });
          }
        }
      }
    }
    await context.close();
  }
} finally { await browser.close(); }
if (failures.length) { console.error('Overflow:\n' + failures.join('\n')); process.exit(1); }
console.log('Theatre browser checks passed: order, deadlines, roles, booking, rapid P0, priority change, nurse readiness, settings, footer, and layout at 375-1920px in three text sizes.');
