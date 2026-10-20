import { useContext, useEffect, useRef, useState } from 'react';
import { active, actions, statuses, fullName, triageLabel, type BoardData, type HospitalContext, type Visit } from './model';
import { apiRequest, ApiError } from './lib/api';
import type { ProtectedRequests } from './lib/protectedRequests';
import { validateVital, vitalUnits, type Vital, type VitalKind } from './lib/clinical';
import './clinical.css';
import {ReadContext,RemoteSelect,usePage,PageNav} from './lib/paging';

type Assessment = { id: string; kind: string; assessed_at: string; complaint: string; manual_priority: number; observations: Record<string,string>; notes: string; vitals: Vital[]; review: { decision: string; reviewed_at: string; reason: string } | null };
type TimelineEvent = { id: string; action: string; created_at: string; category: string; actor_id: string; actor?: string; details?: Record<string,unknown> };
const labels: Record<VitalKind,string> = { heart_rate:'Heart rate', respiratory_rate:'Respiratory rate', blood_pressure:'Blood pressure', temperature:'Temperature', oxygen_saturation:'Oxygen saturation', consciousness:'Consciousness description', pain:'Pain (numeric 0–10 recording format)' };
export function ClinicalWorkspace({ context, data, requests, onRefresh, onAccessDenied, mode="all" }:  { mode?: "all"|"arrival"|"timeline"; context: HospitalContext; data: BoardData; requests: ProtectedRequests; onRefresh: () => Promise<void>; onAccessDenied: (message: string) => void }) {
  const readScope=useContext(ReadContext);
  const caps = data.capabilities ?? [];
  const capabilityKey = [...caps].sort().join('|');
  const can = (cap: string) => caps.includes(cap);
  const [departments, setDepartments] = useState<{id:string;name:string}[]>([]);
  const [selected, setSelected] = useState('');
  const [history, setHistory] = useState<Assessment[]>([]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [arrivalOpen, setArrivalOpen] = useState(mode==="arrival");
  const arrivalKey = useRef(crypto.randomUUID());
  const assessmentKey = useRef(crypto.randomUUID());
  const generation = useRef(0);
  const alive = useRef(false);
  const pending = useRef(new Set<AbortController>());
  const patient = data.visits.find(v => v.id === selected);
  useEffect(()=>{if(readScope&&selected&&!patient)setSelected('');},[selected,patient?.id]);
  const scope=readScope??{context,requests,onAccessDenied};
  const assessmentPage=usePage<Assessment>(scope,'assessments',{encounter:selected},0,Boolean(readScope&&selected&&can('triage.read')));
  const timelinePage=usePage<TimelineEvent>(scope,'timeline',{encounter:selected},0,Boolean(readScope&&selected&&can('clinical.timeline.read')));
  useEffect(()=>{if(readScope)setHistory(assessmentPage.data?.items??[]);},[assessmentPage.data]);
  useEffect(()=>{if(readScope)setTimeline(timelinePage.data?.items??[]);},[timelinePage.data]);
  async function call<T>(path: string, method='GET', body?: unknown): Promise<T | undefined> {
    const ticket = requests.begin(); if (!ticket) return;
    const epoch = generation.current; pending.current.add(ticket.controller);
    try {
      const result = await apiRequest<T>(`/necms/hospitals/${context.hospital_id}/${path}`,method,body,context.id,ticket.controller.signal);
      if (alive.current && epoch === generation.current && requests.current(ticket)) return result;
    } catch (failure) {
      if (!alive.current) return;
      const message = failure instanceof Error ? failure.message : 'Operation failed.';
      if (failure instanceof ApiError && [401,403].includes(failure.status)) { if (requests.deny(ticket)) onAccessDenied(message); }
      else if (epoch === generation.current && requests.current(ticket)) setError(message);
    } finally { pending.current.delete(ticket.controller); requests.finish(ticket); }
  }
  useEffect(() => { alive.current = true; return () => { alive.current=false; generation.current++; pending.current.forEach(controller => controller.abort()); }; }, []);
  useEffect(() => {
    generation.current++; pending.current.forEach(controller => controller.abort()); setHistory([]); setTimeline([]); setError(''); assessmentKey.current=crypto.randomUUID();
    if (!selected) return;
    if(readScope){assessmentPage.refresh();timelinePage.refresh();return;}
    if (can('triage.read')) void call<Assessment[]>(`visits/${selected}/assessments/`).then(value => { if(value) setHistory(value); });
    if (can('clinical.timeline.read')) void call<TimelineEvent[]>(`visits/${selected}/timeline/`).then(value => { if(value) setTimeline(value); });
  }, [selected, patient?.version, patient?.patient_version, capabilityKey]);
  useEffect(() => { setNotice(''); }, [selected]);
  useEffect(() => { setDepartments([]); if (!readScope&&can('arrival.register')) void call<typeof departments>('arrivals/').then(value => { if(value) setDepartments(value); }); }, [context.id, selected, capabilityKey, patient?.version, patient?.patient_version]);
  async function mutate(path: string, body: unknown, message: string) {
    setBusy(true); setError(''); setNotice('');
    const value = await call<Record<string,unknown>>(path,'POST',body);
    if (value) { setNotice(message); await onRefresh(); }
    if (alive.current) setBusy(false);
    return Boolean(value);
  }
  const visibleHistory=readScope?(assessmentPage.data?.items??[]):history;
  const visibleTimeline=readScope?(timelinePage.data?.items??[]):timeline;
  const awaiting = data.visits.filter(v => active(v) && v.triage_state !== 'completed_provisional');
  return <section className="clinical-panel" aria-label="Emergency arrival and clinical assessment">
    <div className="panel-heading"><div><h2>Emergency arrival & clinical assessment</h2><p>Provisional foundation — no approved scoring algorithm. Provide urgent care without waiting for this form.</p></div>
      {can('arrival.register') && <button className="primary" onClick={() => setArrivalOpen(!arrivalOpen)}>Rapid Emergency Arrival</button>}</div>
    {error && <p role="alert" className="error">{error}</p>}{notice && <p role="status">{notice}</p>}
    {arrivalOpen && can('arrival.register') && <form aria-label="Rapid Emergency Arrival" onSubmit={async event => {
      event.preventDefault(); const form=event.currentTarget; const fields=new FormData(form);
      const ok=await mutate('arrivals/',{ request_id:arrivalKey.current,department_id:fields.get('department'),source:fields.get('source'),referring_facility:fields.get('referring')||'',first_name:fields.get('first')||null,last_name:fields.get('last')||null,date_of_birth:fields.get('dob')||null,immediate_care:fields.has('immediate') },'Physical arrival recorded. Not Yet Triaged.');
      if(ok) { arrivalKey.current=crypto.randomUUID(); form.reset(); setArrivalOpen(false); }
    }}><fieldset disabled={busy}><legend>Minimum arrival details</legend><div className="clinical-grid">
      {readScope?<RemoteSelect kind="departments" label="Department" name="department" required/>:<label>Department<select name="department" aria-label="Department" required><option value="">Choose department</option>{departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>}
      <label>Arrival source<select name="source" aria-label="Arrival source" required>{['walk-in','ambulance','referral','other'].map(source=><option key={source}>{source}</option>)}</select></label>
      <label>Referring facility (optional)<input name="referring" maxLength={200}/></label>
      <label>First name (if known)<input name="first" maxLength={160}/></label><label>Last name (if known)<input name="last" maxLength={160}/></label><label>Date of birth (if known)<input name="dob" type="date"/></label>
    </div><label className="clinical-check"><input name="immediate" type="checkbox"/>Immediate care already underway (record staff report)</label>
    {!readScope&&!departments.length && <p role="status">No authorised active department is available. Ask the hospital administrator to provision it.</p>}
    <button className="primary" disabled={!readScope&&!departments.length}>{busy?'Recording…':'Record physical arrival'}</button></fieldset></form>}
    {mode!=="arrival"&&<><div className="clinical-grid"><section><h3>Awaiting Triage ({awaiting.length}{readScope?' on current patient page':''})</h3><p>Includes legacy encounters without structured assessment and assessments awaiting review.</p>
      <ul>{awaiting.map(v=><li key={v.id}><button className="secondary" disabled={busy} onClick={()=>setSelected(v.id)}>{fullName(v)} · {v.temporary_identifier ?? v.patient_ref}</button> <span>{triageLabel(v)}</span>{v.status==='in_treatment' && <strong> · Care underway</strong>}</li>)}</ul></section>
      <label>Clinical encounter (current patient page)<select aria-describedby="clinical-page-hint" aria-label="Clinical encounter" value={selected} disabled={busy} onChange={event=>setSelected(event.target.value)}><option value="">Choose encounter</option>{data.visits.filter(v=>mode==='timeline'||active(v)).map(v=><option key={v.id} value={v.id}>{fullName(v)} · {v.patient_ref}</option>)}</select></label></div>
    <p id="clinical-page-hint">This selector contains the current patient page. Use server search and patient navigation to find other encounters.</p>
    {patient && <div key={patient.id}>
      <h3>{fullName(patient)} — {patient.temporary_identifier ?? patient.patient_ref}</h3><p>{triageLabel(patient)} · {patient.identity_status==='provisional'?'Provisional identity':'Recorded identity'}</p>
      {mode!=='timeline' && can('encounter.update_legacy') && <form key={`care:${patient.version}`} aria-label="Care before completed triage" onSubmit={event=>{
        event.preventDefault();const fields=new FormData(event.currentTarget);
        void mutate(`visits/${patient.id}/care/`,{version:patient.version,status:fields.get('care_status'),next_action:fields.get('care_action'),resource_id:fields.get('care_resource')||null,assigned_to:fields.get('care_clinician')||'',location:fields.get('care_location')||''},'Care coordination updated without requiring demographics or triage.');
      }}><fieldset disabled={busy}><legend>Care coordination — no completed registration or triage required</legend><div className="clinical-grid">
        <label>Current care status<select aria-label="Current care status" name="care_status" defaultValue={patient.status}>{Object.entries(statuses).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
        <label>Care next service<select name="care_action" defaultValue={patient.next_action}>{Object.entries(actions).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
        {readScope?<RemoteSelect kind="resources" label="Care treatment space" name="care_resource" initialValue={patient.resource_id??''}/>:<label>Care treatment space<select name="care_resource" defaultValue={patient.resource_id??''}><option value="">No assigned space</option>{data.resources.map(resource=><option key={resource.id} value={resource.id} disabled={resource.state!=='available'||resource.occupied||data.visits.some(v=>v.id!==patient.id&&active(v)&&v.resource_id===resource.id)}>{resource.name}</option>)}</select></label>}
        <label>Care responsible clinician<input name="care_clinician" maxLength={120} defaultValue={patient.assigned_to}/></label><label>Care location<input name="care_location" maxLength={120} defaultValue={patient.location}/></label>
      </div><button className="secondary">Update care coordination</button></fieldset></form>}
      {mode!=='timeline' && patient.identity_status==='provisional' && can('identity.reconcile') && <Reconcile patient={patient} busy={busy} save={body=>mutate(`patients/${patient.patient_id}/reconcile/`,body,'Identity reconciled; identifiers/history preserved.')}/>}
      {mode!=='timeline' && (can('triage.create') || can('triage.reassess')) && <AssessmentForm key={`${patient.id}:${visibleHistory.length}`} patient={patient} busy={busy} hasInitial={visibleHistory.length>0} allowed={(!readScope||!can('triage.read')||Boolean(assessmentPage.data))&&(visibleHistory.length?can('triage.reassess'):can('triage.create'))} save={async body=>{
        const ok=await mutate(`visits/${patient.id}/assessments/`,{...body,request_id:assessmentKey.current},'Assessment recorded; independent review required.'); if(ok) assessmentKey.current=crypto.randomUUID(); return ok;
      }}/>}
      {can('triage.read') && <section><h3>Assessment history</h3>{readScope&&<PageNav page={assessmentPage} label="assessments"/>}{visibleHistory.map((a,index)=><article className="clinical-history" key={a.id}><h4>{a.kind} · {new Date(a.assessed_at).toLocaleString()}</h4><p>P{a.manual_priority} — provisional/manual, unvalidated · {a.review?`Review: ${a.review.decision}`:'Recorded — awaiting review'}</p><p>{a.complaint}</p>
        <dl>{Object.entries(a.observations).map(([label,value])=><div key={label}><dt>{label.replaceAll('_',' ')}</dt><dd>{value}</dd></div>)}</dl>
        <div className="clinical-observations"><table><caption>Recorded vital observations</caption><thead><tr><th>Observation</th><th>Measurement</th><th>Observed at</th></tr></thead><tbody>{a.vitals.map(v=><tr key={v.kind}><td>{labels[v.kind]}</td><td>{v.measurement_status==='measured'?`${v.kind==='blood_pressure'?`${v.systolic}/${v.diastolic}`:v.kind==='consciousness'?v.text_value:v.value} ${v.unit}`:v.measurement_status.replaceAll('_',' ')}</td><td>{v.observed_at?new Date(v.observed_at).toLocaleString():'Not provided'}</td></tr>)}</tbody></table></div>{a.notes&&<p>Supporting notes: {a.notes}</p>}
        {mode!=='timeline' && !a.review && (readScope?assessmentPage.index===0&&index===0:index===visibleHistory.length-1) && can('triage.review') && <form onSubmit={event=>{event.preventDefault();const fields=new FormData(event.currentTarget);void mutate(`assessments/${a.id}/review/`,{version:patient.version,decision:fields.get('decision'),reason:fields.get('reason')},'Assessment review recorded.');}}><fieldset disabled={busy}><legend>Independent review (does not approve a clinical protocol)</legend><label>Review decision<select name="decision"><option value="accepted">Accept as provisional</option><option value="rejected">Reject — assessment required</option></select></label><label>Review rationale<input name="reason" required maxLength={500}/></label><button className="primary">Record review</button></fieldset></form>}</article>)}</section>}
      {can('clinical.timeline.read') && <section><h3>Patient Clinical Timeline</h3>{readScope&&<PageNav page={timelinePage} label="clinical events"/>}<ol>{visibleTimeline.map(item=><li key={item.id}><time>{new Date(item.created_at).toLocaleString()}</time> · {item.category} · {item.action.replaceAll('_',' ')} · Recorded by {item.actor??item.actor_id}{item.details && <small> {Object.entries(item.details).map(([key,value])=>`${key.replaceAll('_',' ')}: ${String(value)}`).join(' · ')}</small>}</li>)}</ol></section>}
    </div>}</>}
  </section>;
}
function Reconcile({patient,busy,save}:{patient:Visit;busy:boolean;save:(body:unknown)=>Promise<boolean>}) {
 return <form onSubmit={event=>{event.preventDefault();const fields=new FormData(event.currentTarget);void save({version:patient.patient_version,first_name:fields.get('first'),last_name:fields.get('last'),date_of_birth:fields.get('dob')||null,reason:fields.get('reason')});}}><fieldset disabled={busy}><legend>Complete provisional identity — no merge</legend><div className="clinical-grid"><label>Confirmed first name<input name="first" required maxLength={160}/></label><label>Confirmed last name<input name="last" required maxLength={160}/></label><label>Confirmed DOB (if known)<input name="dob" type="date"/></label><label>Identity reconciliation reason<input name="reason" required maxLength={500}/></label></div><button className="secondary">Reconcile identity</button></fieldset></form>;
}
function AssessmentForm({patient,busy,hasInitial,allowed,save}:{patient:Visit;busy:boolean;hasInitial:boolean;allowed:boolean;save:(body:Record<string,unknown>)=>Promise<boolean>}) {
 const [error,setError]=useState('');
 const [states,setStates]=useState<Record<string,string>>({});
 return <form aria-label="Clinical assessment" onSubmit={async event=>{
  event.preventDefault();const fields=new FormData(event.currentTarget);setError('');
  try {
    const vitals=Object.entries(vitalUnits).map(([key,unit])=>{
      const kind=key as VitalKind; const state=(fields.get(`${key}-status`)||'not_measured') as Vital['measurement_status'];
      const number=(name:string)=>{const value=fields.get(name);return value===null||value===''?null:Number(value);};
      const observation:Vital={kind,unit,measurement_status:state};
      if(state==='measured') {if(kind==='blood_pressure'){observation.systolic=number(`${key}-systolic`);observation.diastolic=number(`${key}-diastolic`);}else if(kind==='consciousness')observation.text_value=String(fields.get(`${key}-text`)||'');else observation.value=number(`${key}-value`);}
      const observed=fields.get(`${key}-observed`);if(observed)observation.observed_at=new Date(String(observed)).toISOString();
      validateVital(observation);return observation;
    });
    await save({version:patient.version,kind:hasInitial?'reassessment':'initial',complaint:fields.get('complaint'),manual_priority:Number(fields.get('priority')),observations:{general:String(fields.get('observations')||'')},notes:fields.get('notes')||'',vitals});
  }catch(failure){setError(failure instanceof Error?failure.message:'Check observations.');}
 }}><fieldset disabled={busy||!allowed}><legend>{hasInitial?'Record reassessment':'Initial clinical assessment'}</legend><p>Manual provisional urgency only. P1–P5 are legacy/unvalidated labels, not SATS. Observations do not calculate urgency.</p>
   <label>Assessment complaint<input name="complaint" required maxLength={300} defaultValue={patient.complaint??''}/></label><label>Clinical observations<textarea name="observations" maxLength={1000}/></label>
   <label>Provisional manual priority<select aria-label="Provisional manual priority" name="priority" required defaultValue=""><option value="" disabled>Clinician must select</option>{[1,2,3,4,5].map(p=><option key={p} value={p}>P{p} — legacy/unvalidated</option>)}</select></label>
   <div className="clinical-grid">{Object.entries(vitalUnits).map(([kind,unit])=><fieldset key={kind}><legend>{labels[kind as VitalKind]} ({unit})</legend><label>Measurement status<select name={`${kind}-status`} aria-label={`${labels[kind as VitalKind]} status`} value={states[kind]??'not_measured'} onChange={event=>setStates({...states,[kind]:event.target.value})}>{['not_measured','measured','unknown','unavailable'].map(state=><option key={state} value={state}>{state.replaceAll('_',' ')}</option>)}</select></label>
    {states[kind]==='measured' && (kind==='blood_pressure'?<><label>Systolic<input name={`${kind}-systolic`} type="number" step="any" required/></label><label>Diastolic<input name={`${kind}-diastolic`} type="number" step="any" required/></label></>:kind==='consciousness'?<label>Observed description<input name={`${kind}-text`} required maxLength={160}/></label>:<label>Measured value<input name={`${kind}-value`} aria-label={`${labels[kind as VitalKind]} value`} type="number" step="any" required/></label>)}
    <label>Observed at (optional; defaults to server receipt)<input name={`${kind}-observed`} type="datetime-local"/></label></fieldset>)}</div>
   <label>Supporting notes<textarea name="notes" maxLength={2000}/></label>{error&&<p role="alert">{error}</p>}<button className="primary">Record {hasInitial?'reassessment':'assessment'}</button>
 </fieldset></form>;
}
