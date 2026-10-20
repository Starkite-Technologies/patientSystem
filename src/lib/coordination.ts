import type { BoardData, Visit } from '../model';
export type QueueEncounter=Pick<Visit,'id'|'patient_ref'|'arrived_at'|'triage_state'|'clinical_urgency'|'urgency_source'|'latest_assessment_at'|'status'|'location'|'resource_id'|'assigned_to'|'priority'>;
export type WorkState='waiting'|'called'|'accepted'|'underway'|'deferred'|'completed'|'cancelled';
export interface WorkItem {id:string;encounter_id:string;service_id:string;kind:string;title:string;state:WorkState;eligible:boolean;assignee_id:string|null;team_id:string|null;created_at:string;queue_entered_at:string;acknowledged_at:string|null;completed_at:string|null;version:number}
export interface SequenceReview {id:string;encounter_id:string;work_item_id:string;event_id:string;review_state:string;explanation:string;reason_category_id:string|null;annotations:{id:string;explanation:string;recorded_at:string;actor_id:string}[]}
export interface WorkEvent {id:string;event:string;work_item_id:string;actor_id:string;recorded_at:string;occurred_at:string;previous_state:string|null;resulting_state:string;reason:string;late_entry_reason:string;sequence_status:string;details:Record<string,unknown>;queue_snapshot:{work_item_id:string;encounter_id:string;patient_ref:string;urgency:number|null;state:string;eligible:boolean;version:number;queue_entered_at:string}[]}
export interface CoordinationBundle extends BoardData {server_time:string;closed_encounters?:QueueEncounter[];work_items:WorkItem[];services:{id:string;name:string}[];teams:{id:string;name:string}[];staff:{id:string;name:string}[];reasons:{id:string;name:string}[];exceptions:SequenceReview[]}
export const reviewedUrgency=(v:QueueEncounter)=>v.urgency_source==='provisional_manual'&&v.latest_assessment_at&&v.clinical_urgency!=null?v.clinical_urgency:null;
export const terminal=(w:WorkItem)=>['completed','cancelled'].includes(w.state);
export const needsAcknowledgement=(w:WorkItem)=>['urgent_review','nursing_reassessment'].includes(w.kind)&&!w.acknowledged_at&&!terminal(w);
export function orderWork(a:WorkItem,b:WorkItem,encounters:Map<string,QueueEncounter>){
 const va=encounters.get(a.encounter_id),vb=encounters.get(b.encounter_id);
 const pa=va?reviewedUrgency(va):null,pb=vb?reviewedUrgency(vb):null;
 // Only within a visibly labelled lane. Unknown never receives a numerical rank.
 return (pa!==null&&pb!==null?pa-pb:0)||Date.parse(a.queue_entered_at)-Date.parse(b.queue_entered_at)||a.id.localeCompare(b.id);
}
export const eventCapabilities:Record<string,string>={call:'patient.call',call_cancel:'patient.call',accept:'service.accept',acknowledge:'escalation.acknowledge',start:'treatment.record',complete:'work.complete',reassign:'work.assign',defer:'queue.coordinate',resume:'queue.coordinate',cancel:'queue.coordinate',readiness:'queue.coordinate'};
export function allowedEvents(w:WorkItem){if(terminal(w))return[];const items=['reassign','readiness','cancel'];
 if(w.state==='waiting')items.push('call','accept','defer','start');
 if(w.state==='called')items.push('call_cancel','accept','defer','start');
 if(w.state==='accepted')items.push('defer','start','complete');
 if(w.state==='deferred')items.push('resume','start');
 if(w.state==='underway'){items.push('complete');if(!w.acknowledged_at)items.push('accept');}
 if(needsAcknowledgement(w)&&['waiting','called','deferred','underway'].includes(w.state))items.push('acknowledge');return items;
}
