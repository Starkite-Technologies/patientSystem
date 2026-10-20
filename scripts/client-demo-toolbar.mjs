export async function installClientDemoToolbar(context){
 await context.addInitScript(()=>document.addEventListener('DOMContentLoaded',()=>{
  const panel=document.createElement('section');panel.className='presentation-toolbar';panel.setAttribute('aria-label','Fictional demonstration controls');
  const note=document.createElement('p');note.textContent='SIMULATED AUTH / API · Fictional shift only. No hosted service or real patient data.';
  const label=document.createElement('label');label.textContent='Fictional role';const select=document.createElement('select');select.setAttribute('aria-label','Fictional role');
  for(const value of ['facilitator','reception','nurse','doctor','coordinator','administrator']){const option=document.createElement('option');option.value=value;option.textContent=value==='facilitator'?'Facilitator (broad synthetic grants)':value;select.append(option);}
  fetch('/__synthetic_demo_role__').then(r=>r.json()).then(r=>{select.value=r.synthetic_role;});
  select.onchange=async()=>{await fetch('/__synthetic_demo_role__?role='+encodeURIComponent(select.value));location.reload();};label.append(select);
  const reset=document.createElement('button');reset.textContent='Reset fictional shift';reset.onclick=async()=>{await fetch('/__synthetic_demo_reset__');location.reload();};
  const actor=document.createElement('button');actor.textContent='Switch fictional assessor / reviewer';actor.onclick=async()=>{const r=await (await fetch('/__synthetic_demo_actor__')).json();note.textContent='SIMULATED AUTH / API · Current actor: '+r.synthetic_actor+'. No hosted service.';};
  panel.append(note,label,actor,reset);document.body.prepend(panel);
 }));
}
