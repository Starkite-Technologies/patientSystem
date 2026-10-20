export const presentationPages = [
 ['overview','Emergency Overview',['queue.read','encounter.read','patient.identity.read','resource.read']],
 ['arrival','Patient Arrival',['arrival.register']],
 ['triage','Awaiting Triage',['triage.read','encounter.read','patient.identity.read','resource.read']],
 ['coordination','Emergency Coordination',['queue.read','encounter.read','patient.identity.read','resource.read']],
 ['spaces','Treatment Spaces',['resource.read']],
 ['timeline','Clinical Timeline',['clinical.timeline.read','encounter.read','patient.identity.read','resource.read']],
 ['review','Operational Review',['exception.review','queue.read','encounter.read','patient.identity.read']],
 ['admin','Hospital Administration',['membership.manage']],
] as const;
export function authorisedPages(caps:readonly string[]){return presentationPages.filter(([, ,required])=>required.every(c=>caps.includes(c)));}
