import {describe,it,expect} from 'vitest';
import {visitPermissions} from './visitPermissions';
import type {BoardData} from '../model';
const board=(capabilities:string[])=>({role:'viewer',capabilities,visits:[],resources:[],events:[]}) as BoardData;
describe('independent registration and update affordances',()=>{
 it('registration alone never enables update',()=>expect(visitPermissions(board(['encounter.register']),true)).toEqual({register:true,update:false}));
 it('update alone never enables registration',()=>expect(visitPermissions(board(['encounter.update_legacy']),true)).toEqual({register:false,update:true}));
 it('does not substitute global nurse role for hospital permissions',()=>expect(visitPermissions({...board([]),role:'nurse'},true)).toEqual({register:false,update:false}));
 it('preserves the legacy nurse demo',()=>expect(visitPermissions({...board([]),role:'nurse'},false)).toEqual({register:true,update:true}));
});
