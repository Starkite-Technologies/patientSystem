// Interactive browser-only fictional demo. Start scripts/start-paged-test.mjs first.
// All Auth/API traffic is intercepted. There is no database reset or hosted client.
import {chromium} from '@playwright/test';
import {installSyntheticFixture,A} from './synthetic-paged-fixture.mjs';
const browser=await chromium.launch({channel:'msedge',headless:false});
try{
 const context=await browser.newContext(),fixture=await installSyntheticFixture(context),page=await context.newPage();
 await context.addInitScript(()=>document.addEventListener('DOMContentLoaded',()=>{
  const panel=document.createElement('div');panel.setAttribute('role','note');panel.style.cssText='position:fixed;bottom:12px;right:12px;padding:12px;background:#fff;border:2px solid #12685b;z-index:9999';
  const label=document.createElement('p');label.textContent='Fictional browser simulation. Auth/API are mocked; no live clinical data.';
  const reset=document.createElement('button');reset.textContent='Reset fictional browser demonstration';reset.onclick=async()=>{await fetch('/__synthetic_demo_reset__');location.reload();};
  const actor=document.createElement('button');actor.textContent='Switch fictional assessor / reviewer';actor.onclick=async()=>{const response=await fetch('/__synthetic_demo_actor__');const result=await response.json();label.textContent='Mock Auth/API — current fictional actor: '+result.synthetic_actor;};panel.append(label,reset,actor);document.body.append(panel);
 }));
 await page.goto('http://127.0.0.1:5176');await page.getByLabel('Selected hospital').selectOption(A);
 await page.getByRole('button',{name:'Emergency coordination',exact:true}).click();

 console.log('Synthetic browser demo ready. Closing this browser discards its fictional state. Reset touches only the in-memory fixture.');
 await new Promise(resolve=>page.on('close',resolve));fixture.reset();
}finally{await browser.close();}
