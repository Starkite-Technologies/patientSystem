import {describe,it,expect} from 'vitest';
import {reviewedUrgency,orderWork,allowedEvents,needsAcknowledgement,type QueueEncounter,type WorkItem} from './coordination';
const encounter=(id:string,p:number|null,source='provisional_manual',time:string|null='2026-10-15T00:00:00Z')=>({id,clinical_urgency:p,urgency_source:source,latest_assessment_at:time,triage_state:'awaiting_review'}) as QueueEncounter;
const work=(id:string,encounter_id=id,entered='2026-10-15T00:00:00Z')=>({id,encounter_id,state:'waiting',queue_entered_at:entered,acknowledged_at:null,kind:'initial_review',version:1}) as WorkItem;
describe('provisional coordination, not clinical scheduling',()=>{
 it('never turns legacy or untriaged values into reviewed urgency',()=>{expect(reviewedUrgency(encounter('a',1,'legacy_unvalidated'))).toBeNull();expect(reviewedUrgency(encounter('b',1,'provisional_manual',null))).toBeNull();});
 it('keeps the prior reviewed value visible during a pending reassessment',()=>expect(reviewedUrgency(encounter('a',2))).toBe(2));
 it('orders reviewed manual priority before queue entry',()=>{const m=new Map([['a',encounter('a',4)],['b',encounter('b',1)]]);expect([work('a'),work('b','b','2026-10-15T01:00:00Z')].sort((a,b)=>orderWork(a,b,m)).map(w=>w.id)).toEqual(['b','a']);});
 it('orders the unknown lane by queue-entry timestamp and stable identifier',()=>{const m=new Map([['a',encounter('a',null)],['b',encounter('b',null)]]);expect(orderWork(work('a'),work('b'),m)).toBeLessThan(0);expect(orderWork(work('a','a','2026-10-15T02:00:00Z'),work('b'),m)).toBeGreaterThan(0);});
 it('never automatically requires call or acceptance before recording care',()=>{expect(allowedEvents(work('a'))).toContain('start');expect(allowedEvents(work('a'))).not.toContain('complete');});
 it('prevents terminal transitions and distinguishes call cancellation',()=>{expect(allowedEvents({...work('a'),state:'completed'})).toEqual([]);expect(allowedEvents({...work('a'),state:'called'})).toContain('call_cancel');});
 it('unacknowledged urgent requests do not mean completed care',()=>{const w={...work('a'),kind:'urgent_review',state:'underway'} as WorkItem;expect(needsAcknowledgement(w)).toBe(true);expect(allowedEvents(w)).toContain('acknowledge');expect(needsAcknowledgement({...w,acknowledged_at:'2026-10-15T01:00:00Z'})).toBe(false);});
 it('exposes distinct deferral/readiness/ownership actions',()=>{expect(allowedEvents({...work('a'),state:'deferred'})).toContain('resume');expect(allowedEvents(work('a'))).toEqual(expect.arrayContaining(['reassign','readiness','cancel']));});
});
