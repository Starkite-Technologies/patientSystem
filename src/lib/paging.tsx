import {createContext,useContext,useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import type {HospitalContext} from '../model';
import {apiRequest,ApiError} from './api';
import {ProtectedRequests} from './protectedRequests';

export interface Page<T>{items:T[];total:number;next_cursor:string|null;revision:string;server_time:string;capabilities:string[];summary?:Record<string,unknown>}
export interface ReadScope{context:HospitalContext;requests:ProtectedRequests;onAccessDenied:(message:string)=>void}
export const ReadContext=createContext<ReadScope|null>(null);
export function useReadScope(){const scope=useContext(ReadContext);if(!scope)throw new Error('Read scope required');return scope;}
export function usePage<T>(scope:ReadScope,kind:string,filters:Record<string,unknown>={},poll=0,enabled=true){
 const [data,setData]=useState<Page<T>|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [cursor,setCursor]=useState<string|null>(null),[previous,setPrevious]=useState<(string|null)[]>([]),[reload,setReload]=useState(0);
 const signature=JSON.stringify(filters),gate=useMemo(()=>new ProtectedRequests(),[]),pending=useRef(false),sequence=useRef(0);
 const identity=scope.context.id+'|'+kind+'|'+signature;
 const [dataIdentity,setDataIdentity]=useState('');
 const [confirmedAt,setConfirmedAt]=useState<number|null>(null);
 const [loading,setLoading]=useState(false);
 // Scope/filter changes clear protected data and paging before starting a read.
 useEffect(()=>{setCursor(null);setPrevious([]);setData(null);setError('');setNotice('');},[scope.context.id,signature,kind,enabled]);
 useEffect(()=>{
  gate.activate();pending.current=false;const generation=++sequence.current;
  async function fetchPage(){
   if(!enabled||pending.current)return;const local=gate.begin(),parent=scope.requests.begin();
   if(!local||!parent){if(local)gate.finish(local);if(parent)scope.requests.finish(parent);return;}
   pending.current=true;setLoading(true);
   try{
    const query=new URLSearchParams({size:'25'});for(const [k,v] of Object.entries(filters))if(v!==''&&v!=null)query.set(k,String(v));if(cursor)query.set('cursor',cursor);
    const value=await apiRequest<Page<T>>(`/necms/hospitals/${scope.context.hospital_id}/read/${kind}/?${query}`,'GET',undefined,scope.context.id,AbortSignal.any([local.controller.signal,parent.controller.signal]));
    if(gate.accept(local)&&scope.requests.current(parent)){setDataIdentity(identity);setData(value);setConfirmedAt(performance.now());setError('');}
   }catch(failure){
    if(!gate.current(local)||!scope.requests.current(parent))return;
    const message=failure instanceof Error?failure.message:'Read unavailable';
    if(failure instanceof ApiError&&[401,403].includes(failure.status)){gate.deny(local);setData(null);if(scope.requests.deny(parent))scope.onAccessDenied(message);}
    else if(failure instanceof ApiError&&failure.status===409){setData(null);setNotice('Records changed or the read expired. Refreshing from the first page.');setPrevious([]);if(cursor)setCursor(null);else setError('Records changed during the read. Retry to obtain a consistent page.');}
    else setError(message);
   }finally{gate.finish(local);scope.requests.finish(parent);if(generation===sequence.current){pending.current=false;setLoading(false);}}
  }
  const initial=setTimeout(()=>void fetchPage(),0),timer=poll?setInterval(()=>void fetchPage(),poll):undefined;
  return()=>{gate.close();sequence.current++;clearTimeout(initial);if(timer)clearInterval(timer);};
 },[scope.context.id,kind,signature,cursor,reload,poll,enabled]);
 return {data:dataIdentity===identity?data:null,confirmedAt:dataIdentity===identity?confirmedAt:null,error,notice,loading,index:previous.length,
  refresh:()=>{setCursor(null);setPrevious([]);setReload(n=>n+1);},
  next:()=>{if(data?.next_cursor){setData(null);setPrevious(p=>[...p,cursor]);setCursor(data.next_cursor);}},
  back:()=>{if(previous.length){setData(null);setCursor(previous.at(-1)??null);setPrevious(p=>p.slice(0,-1));}}};
}
export function PageNav({page,label}:{page:ReturnType<typeof usePage>;label:string}){return <div className="page-navigation" aria-label={`${label} pagination`}>
 <span>{page.data?`${page.data.total} matching records; page ${page.index+1}`:'Loading page...'} — other records may be outside this page.</span>
 <button type="button" className="secondary" disabled={!page.index||page.loading} onClick={page.back}>Previous {label}</button>
 <button type="button" className="secondary" disabled={!page.data?.next_cursor||page.loading} onClick={page.next}>Next {label}</button>
 <button type="button" className="secondary" onClick={page.refresh}>Refresh {label}</button>
 {page.notice&&<p role="status">{page.notice}</p>}{page.error&&<p role="alert">{page.error} Last confirmed data may be stale.</p>}</div>;}
export function RemoteSelect({kind,label,name,value,initialValue='',onChange,required=false}:{kind:string;label:string;name?:string;value?:string;initialValue?:string;onChange?:(value:string)=>void;required?:boolean}){
 const scope=useReadScope(),[query,setQuery]=useState(''),[applied,setApplied]=useState(''),[choice,setChoice]=useState(initialValue);
 const [choiceLabel,setChoiceLabel]=useState(initialValue?'Current assignment':'Selected record');
 const page=usePage<{id:string;patient_id?:string;patient_ref?:string;name?:string;first_name?:string;last_name?:string;occupied?:boolean}>(scope,kind,{q:applied});
 const selected=value??choice;
 return <div className="remote-select"><label>Search {label}<input value={query} maxLength={100} onChange={e=>setQuery(e.target.value)}/></label><button className="secondary" type="button" onClick={()=>setApplied(query)}>Find {label}</button>
 <label>{label}<select aria-label={label} name={name} required={required} value={selected} onChange={e=>{setChoice(e.target.value);setChoiceLabel(e.target.selectedOptions[0]?.text??'Selected record');onChange?.(e.target.value);}}><option value="">Select / unassigned</option>{selected&&!page.data?.items.some(r=>(r.patient_id??r.id)===selected)&&<option value={selected}>{choiceLabel} (outside this lookup page)</option>}{page.data?.items.map(r=><option key={r.patient_id??r.id} value={r.patient_id??r.id} disabled={kind==='resources'&&r.occupied&&selected!==r.id}>{r.name??`${r.patient_ref??''} ${r.first_name??''} ${r.last_name??''}`}{r.occupied?' (Occupied)':''}</option>)}</select></label><PageNav page={page} label={label}/></div>;
}
export function HistoryPage<T>({kind,filters,label,render}:{kind:string;filters:Record<string,unknown>;label:string;render:(row:T)=>ReactNode}){
 const scope=useReadScope(),page=usePage<T>(scope,kind,filters);
 return <section><h3>{label}</h3><PageNav page={page} label={label}/>{page.data?.items.map((row,index)=><div key={(row as {id?:string}).id??index}>{render(row)}</div>)}</section>;
}
