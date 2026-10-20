import { describe, it, expect } from 'vitest';
import { validateVital } from './clinical';
import { fullName, compareVisits, queuePosition, triageLabel, type Visit } from '../model';
const pending = { id:'synthetic',first_name:null,last_name:null,priority:null,clinical_urgency:null,triage_state:'not_yet_triaged',status:'waiting',next_action:'assessment',arrived_at:'2026-10-15T00:00:00Z' } as Visit;
describe('clinical foundations without invented assessment',()=>{
 it('labels unknown identity without inventing names',()=>{expect(fullName(pending)).toBe('Identity not yet recorded');expect(pending.first_name).toBeNull();});
 it('keeps untriaged arrivals out of numbered priority queues',()=>{expect(triageLabel(pending)).toBe('Not Yet Triaged');expect(queuePosition(pending,[pending])).toBeNull();expect(compareVisits(pending,{...pending,id:'reviewed',clinical_urgency:2})).toBeGreaterThan(0);});
 it('preserves explicit unknown measurements instead of zero',()=>{expect(()=>validateVital({kind:'heart_rate',measurement_status:'unknown',unit:'bpm'})).not.toThrow();expect(()=>validateVital({kind:'heart_rate',measurement_status:'unknown',unit:'bpm',value:0})).toThrow();});
 it('rejects impossible percentage, absolute temperature and nonfinite values',()=>{for(const value of [-1,101,Infinity,NaN]) expect(()=>validateVital({kind:'oxygen_saturation',measurement_status:'measured',unit:'%',value})).toThrow();expect(()=>validateVital({kind:'temperature',measurement_status:'measured',unit:'C',value:-273.15})).toThrow();});
 it('validates recording format without normal ranges or priority calculation',()=>{expect(()=>validateVital({kind:'heart_rate',measurement_status:'measured',unit:'bpm',value:0})).not.toThrow();expect(()=>validateVital({kind:'blood_pressure',measurement_status:'measured',unit:'mmHg',systolic:40,diastolic:80})).toThrow();expect(()=>validateVital({kind:'consciousness',measurement_status:'measured',unit:'text',text_value:'Synthetic observation'})).not.toThrow();});
 it('keeps legacy priority separate from provisional manually reviewed urgency',()=>{const v={...pending,priority:4,clinical_urgency:2,triage_state:'completed_provisional'} as Visit;expect(v.priority).toBe(4);expect(queuePosition(v,[v])).toBe(1);expect(triageLabel(v)).toContain('provisional');});
});
