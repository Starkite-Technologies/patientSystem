import {useState} from 'react';
import type {PatientOption} from './model';
import {usePage,useReadScope,PageNav} from './lib/paging';
export function PatientPicker({onSelect}:{onSelect:(person:PatientOption|null)=>void}){
 const scope=useReadScope(),[query,setQuery]=useState(''),[search,setSearch]=useState('');
 const page=usePage<PatientOption&{identity_status:string;temporary_identifier:string|null}>(scope,'patients',{q:search},0,Boolean(search));
 return <section className="full-width"><h3>Existing hospital patient search</h3><p>Choose explicitly after confirming identity. Similar records are ambiguous; no automatic merge occurs. Provisional identities require the reconciliation workflow.</p><label>Search existing patients<input value={query} maxLength={100} onChange={e=>setQuery(e.target.value)}/></label><button type="button" className="secondary" onClick={()=>setSearch(query)}>Find patients</button><button type="button" className="secondary" onClick={()=>{setSearch('');onSelect(null);}}>Use new patient</button>
 {search&&<><PageNav page={page} label="patients"/>{page.data?.items.map(p=><p key={p.patient_id}>{p.patient_ref} · {p.first_name} {p.last_name} · {p.date_of_birth??'DOB unknown'} · {p.identity_status}<button type="button" className="secondary" disabled={p.identity_status==='provisional'} onClick={()=>onSelect(p)}>Confirm {p.patient_ref}</button></p>)}</>}</section>;
}
