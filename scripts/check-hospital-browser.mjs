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
  const resolveAllA = [];
  let holdB = false;
  let resolveB;
  let holdDisplay = false;
  let resolveDisplay;
  let failNextBoard = false;
  let rejectAuthentication = false;
  let delayedDenial = false;
  let deliveredDenials = 0;
  let sockets = 0;
  const page = await context.newPage();
  page.on('websocket', socket => { if (new URL(socket.url()).hostname !== '127.0.0.1') sockets++; }); // Vite HMR is local tooling.
  await context.addInitScript(({ ignoreAbort }) => {
    // Negative timing probes deliberately ignore cancellation: response epochs
    // must protect the view even when a transport completes after abort.
    if (ignoreAbort) {
      const fetch = window.fetch.bind(window);
      window.fetch = (input, options) => fetch(input, { ...options, signal: undefined });
    }
    const encode = value => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: 'synthetic-user', exp: Math.floor(Date.now()/1000)+3600 })}.synthetic`;
    localStorage.setItem('sb-isolated-test-auth-token', JSON.stringify({ access_token: token, refresh_token: 'synthetic-refresh', expires_at: Math.floor(Date.now()/1000)+3600, expires_in: 3600, token_type: 'bearer', user: { id: 'synthetic-user', email: 'test@example.invalid' } }));
  }, { ignoreAbort: ['NECMS_REVIEW_DISPLAY_RACE','NECMS_REVIEW_SLOW_DENIAL','NECMS_REVIEW_LOGOUT','NECMS_REVIEW_MULTIPLE_SWITCH'].some(name => process.env[name] === 'true') });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.hostname === 'isolated-test.supabase.invalid' && url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204 });
    if (url.hostname === 'isolated-test.supabase.invalid' && url.pathname === '/auth/v1/token') {
      const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
      const expiry = Math.floor(Date.now()/1000)+3600;
      return route.fulfill({ contentType:'application/json', body:JSON.stringify({ access_token:`${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:'synthetic-user',exp:expiry})}.synthetic`,refresh_token:'synthetic-refresh',token_type:'bearer',expires_in:3600,expires_at:expiry,user:{id:'synthetic-user',email:'test@example.invalid'} }) });
    }
    if (url.hostname !== '127.0.0.1') return route.abort(); // All external traffic fails closed.
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const reply = (body, status=200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }).catch(error => { if (!request.failure()) throw error; });
    if (url.pathname === '/api/necms/hospitals/') return reply([{ id: 'A', name: 'Synthetic Public A', facility_type: 'public' }, { id: 'B', name: 'Synthetic Private B', facility_type: 'private' }]);
    if (url.pathname === '/api/necms/contexts/') {
      const body = request.postDataJSON();
      const value = { id: `context-${sessions.size}`, hospital_id: body.hospital_id, purpose: body.purpose, expires_at: new Date(Date.now()+60000).toISOString() };
      sessions.set(value.id,value); return reply(value,201);
    }
    const selected = sessions.get(request.headers()['x-necms-context']);
    const hospital = url.pathname.split('/')[4];
    if (!selected || selected.hospital_id !== hospital || revoked) {
      if (delayedDenial && url.pathname.endsWith('/board/')) {
        await new Promise(resolve => setTimeout(resolve, 6000));
        deliveredDenials++;
      }
      return reply({ detail: 'Membership revoked or context denied.' },403);
    }
    if (url.pathname.endsWith('/display-board/')) {
      assert.equal(selected.purpose,'display');
      if (holdDisplay) { holdDisplay = false; await new Promise(resolve => { resolveDisplay = resolve; }); }
      const rows=[{ display_label:'ED-synthetic',status:'waiting',next_action:'assessment',space_state:'Unassigned' }];
      displayPayloads.push(rows); return reply(rows);
    }
    if (url.pathname.endsWith('/board/')) {
      assert.equal(selected.purpose,'clinical');
      if (rejectAuthentication) return reply({ detail: 'Synthetic authentication session expired.' }, 401);
      if (failNextBoard) { failNextBoard = false; return route.abort(); }
      if (slowA && hospital==='A') await new Promise(resolve => { resolveA=resolve; resolveAllA.push(resolve); });
      if (holdB && hospital==='B') { holdB=false; await new Promise(resolve => { resolveB=resolve; }); }
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
  if (process.env.NECMS_REVIEW_MULTIPLE_SWITCH === 'true') {
    await page.getByRole('button',{name:'Refresh board',exact:true}).click();
    await expect.poll(() => resolveAllA.length).toBeGreaterThanOrEqual(2);
  }
  await page.getByLabel('Selected hospital').selectOption('B');
  await expect(page.getByText('Synthetic B Patient',{exact:true})).toBeVisible();
  resolveAllA.forEach(resolve => resolve());
  await expect(page.getByText('Synthetic A Patient',{exact:true})).toHaveCount(0);
  if (process.env.NECMS_REVIEW_LOGOUT === 'true') {
    holdB=true;
    await page.getByRole('button',{name:'Refresh board',exact:true}).click();
    await expect.poll(() => Boolean(resolveB)).toBe(true);
    await page.getByRole('button',{name:'Sign out',exact:true}).click();
    await expect(page.getByLabel('Email',{exact:true})).toBeVisible();
    resolveB();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(page.getByText('Synthetic B Patient',{exact:true})).toHaveCount(0);
    await page.getByLabel('Email',{exact:true}).fill('test@example.invalid');
    await page.getByLabel('Password',{exact:true}).fill('synthetic-password');
    await page.getByRole('button',{name:'Sign in',exact:true}).click();
    await expect(page.getByLabel('Selected hospital')).toBeVisible();
    await expect(page.getByText('Synthetic B Patient',{exact:true})).toHaveCount(0);
    await page.getByLabel('Selected hospital').selectOption('B');
    await expect(page.getByText('Synthetic B Patient',{exact:true})).toBeVisible();
    console.log('Logout during loading and reauthentication without cached clinical restoration passed.');
  }
  if (process.env.NECMS_REVIEW_SLOW_DENIAL === 'true') {
    delayedDenial = true; revoked = true;
    await page.getByRole('button',{name:'Refresh board',exact:true}).click();
    await expect.poll(() => deliveredDenials, { timeout: 18000 }).toBeGreaterThanOrEqual(2);
    assert.equal(await page.getByText('Synthetic B Patient',{exact:true}).count(), 0,
      'Clinical rows remained visible after repeated delayed revocation denials');
    delayedDenial = false; revoked = false;
    await page.getByRole('button',{name:'Refresh board',exact:true}).click();
    await expect(page.getByText('Synthetic B Patient',{exact:true})).toBeVisible();
  }
  if (process.env.NECMS_REVIEW_CONNECTION === 'true') {
    failNextBoard = true;
    await page.getByRole('button',{name:'Refresh board',exact:true}).click();
    await expect(page.getByRole('alert')).toContainText('could not be reached');
    await expect(page.getByText('Synthetic B Patient',{exact:true})).toHaveCount(0);
    await page.getByRole('button',{name:'Retry',exact:true}).click();
    await expect(page.getByText('Synthetic B Patient',{exact:true})).toBeVisible();
    rejectAuthentication = true;
    await page.getByRole('button',{name:'Refresh board',exact:true}).click();
    await expect(page.getByRole('alert')).toContainText('session expired');
    await expect(page.getByText('Synthetic B Patient',{exact:true})).toHaveCount(0);
    rejectAuthentication = false;
    await page.getByRole('button',{name:'Retry',exact:true}).click();
    await expect(page.getByText('Synthetic B Patient',{exact:true})).toBeVisible();
    console.log('Simulated connection interruption, recovery and authentication rejection checks passed.');
  }
  await page.getByRole('button',{name:'Restricted shared display',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Emergency department display'})).toBeVisible();
  await expect(page.getByText('ED-synthetic',{exact:true})).toBeVisible();
  assert.deepEqual(Object.keys(displayPayloads[0][0]).sort(),['display_label','next_action','space_state','status']);
  await expect(page.getByText('Synthetic B Patient',{exact:true})).toHaveCount(0);
  if (process.env.NECMS_REVIEW_DISPLAY_RACE === 'true') {
    holdDisplay = true;
    await expect.poll(() => Boolean(resolveDisplay), { timeout: 10000 }).toBe(true);
    revoked = true;
    await expect(page.getByRole('alert')).toContainText('Membership revoked', { timeout: 10000 });
    await expect(page.getByText('ED-synthetic',{exact:true})).toHaveCount(0);
    const delayed = page.waitForResponse(response => response.url().endsWith('/display-board/') && response.status() === 200);
    resolveDisplay(); await (await delayed).finished();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.getByText('ED-synthetic',{exact:true}).count(), 0,
      'A delayed authorised display response restored rows after membership denial cleared them');
  }
  revoked=true;
  await expect(page.getByRole('alert')).toContainText('Membership revoked',{timeout:10000});
  await expect(page.getByText('ED-synthetic',{exact:true})).toHaveCount(0);
  assert.equal(sockets,0,'Clinical websocket opened despite polling-only isolation');
  console.log('Hospital browser checks passed: authorised selector, stale A response after switching to B, restricted display payload, revocation clearing and no clinical websocket. Django/Auth are mocked; external traffic blocked.');
} finally { await browser.close(); }
