import {chromium} from '@playwright/test';
import {installSyntheticFixture,A} from './synthetic-paged-fixture.mjs';
import {installClientDemoToolbar} from './client-demo-toolbar.mjs';
const browser=await chromium.launch({channel:'msedge',headless:false});
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),fixture=await installSyntheticFixture(context,{presentation:true});
 await installClientDemoToolbar(context);const page=await context.newPage();
 await page.goto('http://127.0.0.1:5177');await page.getByLabel('Selected hospital').selectOption(A);
 console.log('NECMS fictional client shift ready. Auth/API mocked. No database connection. Closing discards in-memory records.');
 await new Promise(resolve=>page.on('close',resolve));fixture.reset();
}finally{await browser.close();}
