import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
// Contract/UI checks only: real React in Edge; all Auth/Django responses mocked.
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
 const context=await browser.newContext({viewport:{width:1280,height:1000}}),page=await context.newPage();
 const sessions=new Map(),arrivals=new Map();let visits=[],assessments=[],events=[],failArrival=true,held=false,release,clinicalRequests=0;
 const baseCaps=['encounter.read','encounter.register','encounter.update_legacy','patient.identity.read','resource.read'];
 let caps=[...baseCaps,'arrival.register','identity.reconcile','triage.read','triage.create','triage.reassess','clinical.timeline.read'];
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await context.addInitScript(()=>{
  const encode=value=>btoa(JSON.stringify(value)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  localStorage.setItem('sb-isolated-test-auth-token',JSON.stringify({access_token:`${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:'synthetic-user',exp:Math.floor(Date.now()/1000)+3600})}.synthetic`,refresh_token:'synthetic-refresh',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user:{id:'synthetic-user',email:'clinical@example.invalid'}}));
 });
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.hostname==='isolated-test.supabase.invalid'&&url.pathname==='/auth/v1/logout')return route.fulfill({status:204});
  if(url.hostname!=='127.0.0.1')return route.abort();
  if(!url.pathname.startsWith('/api/'))return route.continue();
  const reply=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)}).catch(error=>{if(!req.failure())throw error;});
  if(url.pathname==='/api/necms/hospitals/')return reply([{id:'A',name:'Synthetic Public A',facility_type:'public'},{id:'B',name:'Synthetic Private B',facility_type:'private'}]);
  if(url.pathname==='/api/necms/contexts/'){const input=req.postDataJSON(),c={id:`ctx-${sessions.size}`,hospital_id:input.hospital_id,purpose:input.purpose,expires_at:'2099-01-01T00:00:00Z'};sessions.set(c.id,c);return reply(c,201);}
  const c=sessions.get(req.headers()['x-necms-context']);if(!c||c.hospital_id!==url.pathname.split('/')[4])return reply({detail:'Context denied'},403);
  if(url.pathname.endsWith('/board/'))return reply({role:'nurse',capabilities:caps,visits:c.hospital_id==='A'?visits:[],resources:[{id:'synthetic-space',name:'Synthetic resus space',kind:'Resuscitation',state:'available'}],events:[]});
  if(url.pathname.endsWith('/arrivals/')){
   if(req.method()==='GET')return reply([{id:'synthetic-department',name:'Synthetic emergency department'}]);
   const input=req.postDataJSON();assert.equal(input.first_name,null);assert.equal(input.last_name,null);assert.equal(input.date_of_birth,null);assert.equal(input.immediate_care,true);assert.ok(!('arrived_at'in input));
   if(!arrivals.has(input.request_id)){
    visits.push({id:'visit-arrival',patient_id:'patient-arrival',patient_ref:'PF-SYNTHETIC',temporary_identifier:'TMP-synthetic',identity_status:'provisional',first_name:null,last_name:null,date_of_birth:null,patient_version:1,names_need_review:false,complaint:null,priority:null,clinical_urgency:null,triage_state:'not_yet_triaged',urgency_source:'not_assessed',status:'in_treatment',next_action:'assessment',location:'',resource_id:null,assigned_to:'',notes:'',arrived_at:'2026-10-15T08:00:00Z',updated_at:'2026-10-15T08:00:00Z',version:1});arrivals.set(input.request_id,{id:'arrival-synthetic',encounter_id:'visit-arrival'});
    events.push({id:'arrival',action:'physical_arrival',category:'administrative',created_at:'2026-10-15T08:00:00Z',actor_id:'synthetic-user'});
   }
   if(failArrival){failArrival=false;return route.abort();}
   if(held){await new Promise(resolve=>{release=resolve;});}
   return reply(arrivals.get(input.request_id),201);
  }
  if(url.pathname.endsWith('/assessments/')){
   if(req.method()==='GET')return reply(assessments);
   clinicalRequests++;const input=req.postDataJSON();assert.equal(input.manual_priority,2);assert.equal(input.vitals.length,7);assert.equal(input.vitals.find(v=>v.kind==='heart_rate').measurement_status,'unknown');assert.ok(!('value'in input.vitals.find(v=>v.kind==='heart_rate')));
   assessments.push({...input,id:'assessment-synthetic',assessed_at:'2026-10-15T08:02:00Z',review:null});visits[0]={...visits[0],version:visits[0].version+1,triage_state:'awaiting_review'};
   events.push({id:'assessment',action:'initial_assessment_recorded',category:'clinical',created_at:'2026-10-15T08:02:00Z',actor_id:'synthetic-user'});return reply({id:'assessment-synthetic'},201);
  }
  if(url.pathname.endsWith('/timeline/'))return reply(events);
  if(url.pathname.endsWith('/care/')){const body=req.postDataJSON();assert.ok(!('priority'in body));assert.equal(body.resource_id,'synthetic-space');visits[0]={...visits[0],resource_id:body.resource_id,location:'Synthetic resus space',version:visits[0].version+1};return reply({status:'updated'});}
  if(url.pathname.endsWith('/reconcile/')){const body=req.postDataJSON();assert.equal(body.version,1);assert.ok(body.reason);visits[0]={...visits[0],identity_status:'confirmed',first_name:body.first_name,last_name:body.last_name,patient_version:2};return reply({status:'reconciled'});}
  return reply([]);
 });
 await page.goto('http://127.0.0.1:5175');await page.getByLabel('Selected hospital').selectOption('A');
 await page.getByRole('button',{name:'Rapid Emergency Arrival',exact:true}).focus();await page.keyboard.press('Enter');
 const arrival=page.getByRole('form',{name:'Rapid Emergency Arrival'});await expect(arrival).toBeVisible();await expect(arrival.getByRole('combobox').first()).toContainText('Synthetic emergency department');await arrival.getByLabel('Department',{exact:true}).selectOption('synthetic-department');await arrival.getByLabel('Arrival source').selectOption('ambulance');await arrival.getByLabel('Immediate care already underway (record staff report)').check();
 await arrival.getByRole('button',{name:'Record physical arrival',exact:true}).click();await expect(page.getByRole('alert')).toContainText('could not be reached');
 await arrival.getByRole('button',{name:'Record physical arrival',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Physical arrival recorded'})).toBeVisible();assert.equal(arrivals.size,1);
 await expect(page.getByText('Provisional identity · TMP-synthetic',{exact:true})).toBeVisible();await expect(page.getByText('Not Yet Triaged',{exact:true}).first()).toBeVisible();await expect(page.getByText('Care underway',{exact:false})).toBeVisible();
 await page.getByLabel('Clinical encounter').selectOption('visit-arrival');await expect(page.getByRole('heading',{name:'Patient Clinical Timeline'})).toBeVisible();
 const care=page.getByRole('form',{name:'Care before completed triage'});await care.getByLabel('Care treatment space').selectOption('synthetic-space');await care.getByRole('button',{name:'Update care coordination'}).click();await expect(page.getByRole('status').filter({hasText:'Care coordination updated'})).toBeVisible();assert.equal(visits[0].priority,null);assert.equal(visits[0].triage_state,'not_yet_triaged');
 await page.setViewportSize({width:390,height:844});const panel=await page.locator('.clinical-panel').boundingBox();assert.ok(panel&&panel.x>=0&&panel.x+panel.width<=391,'Clinical panel overflows mobile viewport');await page.setViewportSize({width:1280,height:1000});
 const form=page.getByRole('form',{name:'Clinical assessment'});await form.getByLabel('Assessment complaint').fill('Synthetic complaint');await form.getByLabel('Provisional manual priority').selectOption('2');await form.getByLabel('Heart rate status',{exact:true}).selectOption('unknown');await form.getByLabel('Oxygen saturation status',{exact:true}).selectOption('measured');await form.getByLabel('Oxygen saturation value',{exact:true}).fill('101');
 await form.getByRole('button',{name:'Record assessment',exact:true}).click();await expect(form.getByRole('alert')).toContainText('Invalid measurement');assert.equal(clinicalRequests,0);
 await form.getByLabel('Oxygen saturation value',{exact:true}).fill('98');await form.getByRole('button',{name:'Record assessment',exact:true}).click();await expect(page.locator('.clinical-history')).toHaveCount(1);await expect(page.locator('.clinical-history')).toContainText('Recorded — awaiting review');assert.equal(clinicalRequests,1);await expect(page.getByRole('button',{name:'Record review',exact:true})).toHaveCount(0);
 await page.getByLabel('Confirmed first name').fill('Synthetic');await page.getByLabel('Confirmed last name').fill('Completed');await page.getByLabel('Identity reconciliation reason').fill('Synthetic identity verified');await page.getByRole('button',{name:'Reconcile identity',exact:true}).click();await expect(page.getByRole('heading',{name:/Synthetic Completed/})).toBeVisible();
 await page.getByLabel('Selected hospital').selectOption('B');await expect(page.getByText('PF-SYNTHETIC',{exact:false})).toHaveCount(0);await expect(page.getByText('initial assessment recorded',{exact:false})).toHaveCount(0);
 caps=baseCaps;await page.getByLabel('Selected hospital').selectOption('A');await expect(page.getByRole('button',{name:'Rapid Emergency Arrival',exact:true})).toHaveCount(0);await expect(page.getByRole('form',{name:'Clinical assessment'})).toHaveCount(0);
 caps=[...baseCaps,'arrival.register'];await page.getByRole('button',{name:'Renew access',exact:true}).click();await page.getByRole('button',{name:'Rapid Emergency Arrival',exact:true}).click();
 const late=page.getByRole('form',{name:'Rapid Emergency Arrival'});await late.getByLabel('Department',{exact:true}).selectOption('synthetic-department');await late.getByLabel('Immediate care already underway (record staff report)').check();held=true;
 await late.getByRole('button',{name:'Record physical arrival',exact:true}).click();await expect.poll(()=>Boolean(release)).toBe(true);await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page.getByLabel('Email',{exact:true})).toBeVisible();release();await expect(page.getByRole('heading',{name:'Patient Clinical Timeline'})).toHaveCount(0);
 assert.deepEqual(errors,[]);console.log('Clinical browser checks passed: unknown/immediate-care arrival, transport retry/idempotency contract, awaiting triage, vital validation, assessment creation, explicit reconciliation, timeline, capability restrictions, hospital clearing and logout with pending arrival. Auth/Django mocked; external traffic blocked.');
}finally{await browser.close();}
