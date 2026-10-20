import {lazy,Suspense,useState} from 'react';
import type {BoardData,Resource,Visit} from './model';
import {HospitalStaff} from './HospitalWorkspace';
import {ReadContext,HistoryPage,PageNav,usePage,type ReadScope} from './lib/paging';
import {authorisedPages} from './lib/presentation';
import './presentation.css';
const Clinical=lazy(()=>import('./ClinicalWorkspace').then(m=>({default:m.ClinicalWorkspace})));
const Coordination=lazy(()=>import('./PagedCoordinationBoard').then(m=>({default:m.PagedCoordinationBoard})));
type Props=ReadScope&{data:BoardData;onRefresh:()=>Promise<void>;onLogout:()=>Promise<void>;error:string};
export function ClientPresentation(props:Props){
 const pages=authorisedPages(props.data.capabilities??[]),[choice,setChoice]=useState('overview'),[encounter,setEncounter]=useState('');
 const current=pages.find(p=>p[0]===choice)??pages[0];
 function go(page:string,id=''){setEncounter(id);setChoice(page);}
 return <ReadContext.Provider value={props}><div className="client-presentation">
 <aside className="presentation-nav"><div className="presentation-brand">NECMS<small>Emergency care coordination</small></div><p>FICTIONAL HOSPITAL SHIFT</p><nav aria-label="Demonstration workspace">{pages.map(([key,label])=><button key={key} aria-current={current?.[0]===key?'page':undefined} onClick={()=>go(key)}>{label}</button>)}</nav><button className="secondary" onClick={()=>void props.onLogout()}>Sign out</button></aside>
 <main className="presentation-main"><header><p className="eyebrow">STARKITE TECHNOLOGIES · LOCAL SOFTWARE WALKTHROUGH</p><h1>{current?.[1]??'No authorised workspace'}</h1><p>Fictional records. Simulated accounts and services. Clinical decisions remain with qualified staff.</p></header>
 {props.error&&<p className="error" role="alert">{props.error}</p>}
 <aside className="presentation-safety" role="note">Different treatment orders can be clinically appropriate because of patient needs and available resources. This system records circumstances; it does not judge staff decisions or prevent urgent care. Provisional P1–P5 labels are illustrative and unvalidated.</aside>
 <Suspense fallback={<p role="status">Loading authorised workspace…</p>}>
 {current&&['overview','coordination'].includes(current[0])&&<Coordination key={current[0]+encounter} {...props} initialFilters={encounter?{encounter,closed:true}:{}}/>}
 {current&&['arrival','triage','timeline'].includes(current[0])&&<ClinicalPane key={current[0]} {...props} mode={current[0]==='arrival'?'arrival':current[0]==='timeline'?'timeline':'all'}/>}
 {current?.[0]==='spaces'&&<HistoryPage<Resource> kind="resources" filters={{}} label="Treatment spaces" render={r=><article className="resource-card"><h2>{r.name}</h2><p>{r.kind} · {r.occupied?'Occupied':r.state}</p><p>Assign or release through the clinical care controls; availability alone does not establish clinical suitability.</p></article>}/>}
 {current?.[0]==='review'&&<HistoryPage<{id:string;encounter_id:string;patient_ref?:string;review_state:string;explanation:string;annotation_count:number}> kind="exceptions" filters={{}} label="Operational reviews" render={r=><article className="presentation-review"><h2>{r.patient_ref??'Encounter review'}</h2><p>{r.review_state.replaceAll('_',' ')} · {r.explanation||'No initial explanation recorded'}</p><p>Original recording-time evidence is preserved. An explanation is not a finding of clinical correctness.</p><button className="secondary" onClick={()=>go('coordination',r.encounter_id)}>Open evidence and acknowledgement</button></article>}/>}
 {current?.[0]==='admin'&&<><p>Hospital-specific membership management. Clinical authority and hospital-approved role assignments are separate decisions.</p><HospitalStaff {...props}/></>}
 </Suspense></main></div></ReadContext.Provider>;
}
function ClinicalPane(props:Props&{mode:'arrival'|'timeline'|'all'}){
 const [query,setQuery]=useState(''),[q,setQ]=useState(''),[closed,setClosed]=useState(false);
 const enabled=props.mode!=='arrival',page=usePage<Visit>(props,'encounters',{q,closed},5000,enabled);
 const data={...props.data,visits:enabled?(page.data?.items??[]):[],resources:[]};
 return <><p>{props.mode==='arrival'?'Minimum intake supports known or unidentified patients without waiting for triage.':'Search the authorised encounter list. Selection alone does not change a patient record.'}</p>
 {enabled&&<><form onSubmit={e=>{e.preventDefault();setQ(query);}}><label>Find clinical encounter<input aria-label="Find clinical encounter" value={query} maxLength={100} onChange={e=>setQuery(e.target.value)}/></label><label><input type="checkbox" checked={closed} onChange={e=>setClosed(e.target.checked)}/>Completed encounters</label><button className="secondary">Search encounters</button></form><PageNav page={page} label="clinical encounters"/></>}
 <ReadContext.Provider value={enabled?props:null}><Clinical context={props.context} data={data} requests={props.requests} onAccessDenied={props.onAccessDenied} onRefresh={async()=>{page.refresh();await props.onRefresh();}} mode={props.mode}/></ReadContext.Provider></>;
}
