import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';

// Browser routes mock Django; no real Auth/project/network records are used.
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const context = await browser.newContext();
  const sessions = new Map();
  const displayPayloads = [];
  let revoked = false;
  let slowA = false;
  let resolveA;
  let sockets = 0;
  const page = await context.newPage();
  page.on('websocket', socket => { if (new URL(socket.url()).hostname !== '127.0.0.1') sockets++; }); // Vite HMR is local tooling.
  await context.addInitScript(() => {
    const encode = value => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: 'synthetic-user', exp: Math.floor(Date.now()/1000)+3600 })}.synthetic`;
    localStorage.setItem('sb-isolated-test-auth-token', JSON.stringify({ access_token: token, refresh_token: 'synthetic-refresh', expires_at: Math.floor(Date.now()/1000)+3600, expires_in: 3600, token_type: 'bearer', user: { id: 'synthetic-user', email: 'test@example.invalid' } }));
  });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.hostname !== '127.0.0.1') return route.abort(); // All external traffic fails closed.
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const reply = (body, status=200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/necms/hospitals/') return reply([{ id: 'A', name: 'Synthetic Public A', facility_type: 'public' }, { id: 'B', name: 'Synthetic Private B', facility_type: 'private' }]);
    if (url.pathname === '/api/necms/contexts/') {
      const body = request.postDataJSON();
      const value = { id: `context-${sessions.size}`, hospital_id: body.hospital_id, purpose: body.purpose, expires_at: new Date(Date.now()+60000).toISOString() };
      sessions.set(value.id,value); return reply(value,201);
    }
    const selected = sessions.get(request.headers()['x-necms-context']);
    const hospital = url.pathname.split('/')[4];
    if (!selected || selected.hospital_id !== hospital || revoked) return reply({ detail: 'Membership revoked or context denied.' },403);
    if (url.pathname.endsWith('/display-board/')) {
      assert.equal(selected.purpose,'display');
      const rows=[{ display_label:'ED-synthetic',status:'waiting',next_action:'assessment',space_state:'Unassigned' }];
      displayPayloads.push(rows); return reply(rows);
    }
    if (url.pathname.endsWith('/board/')) {
      assert.equal(selected.purpose,'clinical');
      if (slowA && hospital==='A') await new Promise(resolve => { resolveA=resolve; });
      return reply({ role:'nurse',capabilities:['encounter.read','encounter.register','encounter.update_legacy'],resources:[],events:[],visits:[{
        id: `visit-${hospital}`,patient_id:`patient-${hospital}`,patient_ref:`TEST-${hospital}`,first_name:`Synthetic ${hospital}`,last_name:'Patient',date_of_birth:null,patient_version:1,names_need_review:false,
        complaint:'Fictional',priority:3,status:'waiting',next_action:'assessment',location:'Test',resource_id:null,assigned_to:'',notes:'',arrived_at:new Date().toISOString(),updated_at:new Date().toISOString(),version:1,
      }] });
    }
    return reply([]);
  });
  await page.goto('http://127.0.0.1:5175');
  await page.getByLabel('Selected hospital').selectOption('A');
  await expect(page.getByText('Synthetic A Patient',{exact:true})).toBeVisible();
  slowA=true;
  await page.getByRole('button',{name:'Refresh board',exact:true}).click();
  await expect.poll(() => Boolean(resolveA)).toBe(true);
  await page.getByLabel('Selected hospital').selectOption('B');
  await expect(page.getByText('Synthetic B Patient',{exact:true})).toBeVisible();
  resolveA();
  await expect(page.getByText('Synthetic A Patient',{exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Restricted shared display',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Emergency department display'})).toBeVisible();
  await expect(page.getByText('ED-synthetic',{exact:true})).toBeVisible();
  assert.deepEqual(Object.keys(displayPayloads[0][0]).sort(),['display_label','next_action','space_state','status']);
  await expect(page.getByText('Synthetic B Patient',{exact:true})).toHaveCount(0);
  revoked=true;
  await expect(page.getByRole('alert')).toContainText('Membership revoked',{timeout:10000});
  await expect(page.getByText('ED-synthetic',{exact:true})).toHaveCount(0);
  assert.equal(sockets,0,'Clinical websocket opened despite polling-only isolation');
  console.log('Hospital browser checks passed: authorised selector, stale A response after switching to B, restricted display payload, revocation clearing and no clinical websocket. Django/Auth are mocked; external traffic blocked.');
} finally { await browser.close(); }
