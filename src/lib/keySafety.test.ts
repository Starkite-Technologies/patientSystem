import {describe,it,expect} from 'vitest';
import {publicKeyAllowed} from './keySafety';
const jwt=(role:string)=>'eyJhbGciOiJub25lIn0.'+btoa(JSON.stringify({role}))+'.synthetic';
describe('public configuration key screening',()=>{
 it('accepts publishable and legacy anonymous configuration',()=>{expect(publicKeyAllowed('sb_publishable_synthetic')).toBe(true);expect(publicKeyAllowed(jwt('anon'))).toBe(true);});
 it('rejects modern secrets',()=>expect(publicKeyAllowed('sb_secret_synthetic')).toBe(false));
 it('rejects privileged legacy roles',()=>{for(const role of ['service_role','authenticated','postgres'])expect(publicKeyAllowed(jwt(role))).toBe(false);});
 it('fails closed on malformed JWT configuration',()=>{expect(publicKeyAllowed('eyJinvalid')).toBe(false);expect(publicKeyAllowed('eyJ.a.bad')).toBe(false);});
});
