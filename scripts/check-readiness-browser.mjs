import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
// Real React/Edge, synthetic Auth/Django; external traffic is denied.
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const context=await browser.newContext(),page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let caps=['encounter.read','patient.identity.read','resource.read','encounter.register','membership.manage'],hold=false,deny=false,release,held=0;const contexts=new Map();
 await context.addInitScript(()=>{
  const fetch=window.fetch.bind(window);window.fetch=(input,options)=>fetch(input,{...options,signal:undefined});
  const encode=value=>btoa(JSON.stringify(value)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  localStorage.setItem('sb-isolated-test-auth-token',JSON.stringify({access_token:`${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:'synthetic-user',exp:Math.floor(Date.now()/1000)+3600})}.synthetic`,refresh_token:'synthetic',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user:{id:'synthetic-user',email:'synthetic@example.invalid'}}));
 });
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.hostname==='isolated-test.supabase.invalid'&&url.pathname==='/auth/v1/logout')return route.fulfill({status:204});
  if(url.hostname!=='127.0.0.1')return route.abort();
  if(!url.pathname.startsWith('/api/'))return route.continue();
  const reply=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)}).catch(e=>{if(!req.failure())throw e;});
  if(url.pathname==='/api/necms/hospitals/')return reply([{id:'A',name:'Synthetic A',facility_type:'public'},{id:'B',name:'Synthetic B',facility_type:'private'}]);
  if(url.pathname==='/api/necms/contexts/'){const c={...req.postDataJSON(),id:`ctx-${contexts.size}`,expires_at:'2099-01-01T00:00:00Z'};contexts.set(c.id,c);return reply(c,201);}
  const ctx=contexts.get(req.headers()['x-necms-context']);if(!ctx||ctx.hospital_id!==url.pathname.split('/')[4])return reply({detail:'Context denied'},403);
  if(url.pathname.endsWith('/staff/')){
   if(deny)return reply({detail:'Synthetic staff access revoked'},403);
   const data={roles:[{id:'role',code:'synthetic'}],memberships:[{id:'member',user_id:'SYNTHETIC-STAFF-PRIVATE',role_id:'role',active:true}]};
   if(hold){held++;await new Promise(resolve=>{release=resolve;});}return reply(data);
  }
  if(url.pathname.endsWith('/board/'))return reply({role:'viewer',capabilities:caps,resources:[],events:[],visits:ctx.hospital_id==='A'?[{id:'v',patient_id:'p',patient_ref:'SYN-EXISTING',first_name:'Synthetic',last_name:'Existing',date_of_birth:null,complaint:'Synthetic fixture',priority:3,status:'waiting',next_action:'assessment',location:'',resource_id:null,assigned_to:'',notes:'',arrived_at:'2026-10-15T00:00:00Z',updated_at:'2026-10-15T00:00:00Z',version:1,patient_version:1}]:[]});
  return reply([]);
 });
 await page.goto('http://127.0.0.1:5175');await expect(page.getByText('Synthetic demonstration: no real patients. Clinical protocols are not approved.',{exact:true})).toBeVisible();await page.getByLabel('Selected hospital').selectOption('A');
 await expect(page.getByRole('button',{name:'Register patient',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'View Synthetic Existing',exact:true}).click();await expect(page.getByRole('button',{name:'Save changes',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'Close',exact:true}).click();
 await page.getByRole('button',{name:'Register patient',exact:true}).click();await expect(page.getByLabel('First name',{exact:true})).toBeEnabled();await page.getByRole('button',{name:'Close',exact:true}).click();
 caps=['encounter.read','patient.identity.read','resource.read','encounter.update_legacy','membership.manage'];await page.getByRole('button',{name:'Refresh board',exact:true}).click();
 await expect(page.getByRole('button',{name:'Register patient',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'View Synthetic Existing',exact:true}).click();await expect(page.getByRole('button',{name:'Save changes',exact:true})).toBeVisible();await page.getByRole('button',{name:'Close',exact:true}).click();
 await expect(page.getByText(/SYNTHETIC-STAFF-PRIVATE/)).toBeVisible();hold=true;
 await expect.poll(()=>held,{timeout:10000}).toBeGreaterThan(0);deny=true;await expect(page.getByRole('alert')).toContainText('Synthetic staff access revoked',{timeout:10000});
 await expect(page.getByText(/SYNTHETIC-STAFF-PRIVATE/)).toHaveCount(0);release();hold=false;await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await expect(page.getByText(/SYNTHETIC-STAFF-PRIVATE/)).toHaveCount(0);
 deny=false;await page.getByLabel('Selected hospital').selectOption('B');await expect(page.getByText('Synthetic Existing',{exact:true})).toHaveCount(0);await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page.getByLabel('Email',{exact:true})).toBeVisible();
 assert.deepEqual(errors,[]);console.log('3C browser regressions passed: register-only versus update-only controls, read-only existing record, staff denial clears parent and staff records, delayed staff success cannot restore data, hospital switching and logout. Upstreams mocked; abort intentionally ignored.');
}finally{await browser.close();}
