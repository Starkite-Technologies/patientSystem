import { supabase } from './supabase';
import { apiRequest } from './api';
import { active, validateInput, type BoardData, type HospitalContext, type Resource, type Visit, type VisitInput } from '../model';

export const necmsEnabled = import.meta.env.VITE_NECMS_ENABLED === 'true';
export function hospitalPath(path: string, context?: HospitalContext) {
  if (!necmsEnabled) return path;
  if (!context || context.purpose !== 'clinical') throw new Error('Select an authorised clinical hospital context.');
  return `/necms/hospitals/${context.hospital_id}${path}`;
}

const STORAGE_KEY = 'patientflow-fictional-demo-v3';
const now = Date.now();
const resources: Resource[] = [
  { id: 'bay-1', name: 'Resus 01', kind: 'Resuscitation', state: 'available' },
  { id: 'bay-2', name: 'Treatment 02', kind: 'Treatment bay', state: 'available' },
  { id: 'bay-3', name: 'Treatment 03', kind: 'Treatment bay', state: 'available' },
  { id: 'bay-4', name: 'Treatment 04', kind: 'Treatment bay', state: 'cleaning' },
  { id: 'theatre-1', name: 'Theatre 01', kind: 'Operating room', state: 'available' },
];
function sample(id: string, name: string, date_of_birth: string, complaint: string, priority: number, status: Visit['status'], next_action: Visit['next_action'], minutes: number, location: string, assigned_to: string, resource_id: string | null = null): Visit {
  return { id, patient_ref: `DEMO-${id.padStart(3, '0')}`, first_name: name.split(' ')[0], last_name: name.split(' ').slice(1).join(' '), patient_id: `patient-${id}`, patient_version: 1, names_need_review: false, date_of_birth, complaint, priority, status, next_action, location, resource_id, assigned_to, notes: 'Fictional patient for workflow demonstration.', arrived_at: new Date(now - minutes * 60000).toISOString(), updated_at: new Date(now).toISOString(), version: 1 };
}
const initial: BoardData = { role: 'nurse', resources, events: [], visits: [
  sample('1', 'Alex Morgan', '1984-02-18', 'Emergency assessment', 1, 'in_treatment', 'treatment', 18, 'Resus 01', 'Dr M. Dlamini', 'bay-1'),
  sample('2', 'Sam Taylor', '1959-03-12', 'Shortness of breath', 2, 'waiting', 'assessment', 24, 'Waiting area', 'Unassigned'),
  sample('3', 'Jordan Lee', '1997-06-22', 'Ankle injury', 3, 'ready', 'imaging', 46, 'Treatment 02', 'Dr L. Patel', 'bay-2'),
  sample('4', 'Casey Adams', '1972-01-09', 'Abdominal pain', 2, 'awaiting_results', 'laboratory', 63, 'Treatment 03', 'Dr M. Dlamini', 'bay-3'),
  sample('5', 'Riley Brown', '1991-04-17', 'Wound assessment', 4, 'waiting', 'assessment', 38, 'Waiting area', 'Unassigned'),
  sample('6', 'Jamie Wilson', '1955-08-10', 'Awaiting surgical team', 2, 'ready', 'surgery', 52, 'Observation area', 'Dr N. Nkosi'),
  sample('7', 'Avery Smith', '2004-05-25', 'Minor injury', 5, 'waiting', 'treatment', 31, 'Waiting area', 'Unassigned'),
  sample('8', 'Robin Jones', '1980-07-13', 'Post-treatment review', 3, 'observation', 'assessment', 85, 'Observation area', 'Dr L. Patel'),
] };
function demoData(): BoardData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
    const previous = localStorage.getItem('patientflow-fictional-demo-v2');
    if (previous) {
      const saved = JSON.parse(previous);
      saved.visits = saved.visits.map(({ age: _recordedAge, ...visit }: Visit & { age?: number | null }) => ({ ...visit, date_of_birth: null }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
      return saved;
    }
    const legacy = localStorage.getItem('patientflow-fictional-demo-v1');
    if (legacy) {
      const saved = JSON.parse(legacy);
      saved.visits = saved.visits.map(({ patient_name, age: _recordedAge, ...visit }: Visit & { patient_name: string; age?: number | null }) => ({
        ...visit, first_name: patient_name.trim().split(/\s+/)[0], last_name: patient_name.trim().split(/\s+/).slice(1).join(' '),
        patient_id: `legacy-${visit.patient_ref.toLowerCase()}`, patient_version: 1, names_need_review: true, date_of_birth: null,
      }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
      return saved;
    }
  } catch { /* Fall back to a fresh demo. */ }
  return structuredClone(initial);
}
function persist(data: BoardData) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  window.dispatchEvent(new Event('patientflow-change'));
}
export function resetDemo() { persist(structuredClone(initial)); }
export async function loadBoard(context?: HospitalContext, signal?: AbortSignal): Promise<BoardData> {
  if (!supabase) return demoData();
  return apiRequest<BoardData>(hospitalPath('/board/', context), 'GET', undefined, context?.id, signal);
}
export async function saveVisit(input: VisitInput, existing?: Visit, context?: HospitalContext, requestId?: string, signal?: AbortSignal) {
  validateInput(input);
  if (supabase) {
    await apiRequest(hospitalPath(existing ? `/visits/${existing.id}/` : '/visits/', context), existing ? 'PATCH' : 'POST', { input, ...(context && requestId ? { request_id: requestId } : {}), ...(existing ? { version: existing.version, patient_version: existing.patient_version } : {}) }, context?.id, signal);
    return;
  }
  const data = demoData();
  if (!existing && !input.patient_ref.trim()) {
    const numbers = data.visits.map(v => /^DEMO-PF-(\d+)$/.exec(v.patient_ref)?.[1]).filter(Boolean).map(Number);
    input = { ...input, patient_ref: `DEMO-PF-${String(Math.max(0, ...numbers) + 1).padStart(6, '0')}` };
  }
  if (existing && data.visits.find(v => v.id === existing.id)?.patient_version !== existing.patient_version) throw new Error('Patient details were updated elsewhere. Close and reopen the record.');
  if (existing && existing.patient_ref.toLowerCase() !== input.patient_ref.trim().toLowerCase()) throw new Error('The patient reference cannot be changed on an existing visit.');
  if (existing && data.visits.find(v => v.id === existing.id)?.version !== existing.version) throw new Error('This patient was updated elsewhere. Close and reopen the record.');
  const timestamp = new Date().toISOString();
  const visit: Visit = { ...input, id: existing?.id ?? crypto.randomUUID(), arrived_at: existing?.arrived_at ?? timestamp, updated_at: timestamp, version: (existing?.version ?? 0) + 1, patient_id: existing?.patient_id ?? crypto.randomUUID(), patient_version: existing?.patient_version ?? 1, names_need_review: false };
  visit.patient_ref = visit.patient_ref.trim();
  visit.first_name = visit.first_name.trim();
  visit.last_name = visit.last_name.trim();
  visit.complaint = visit.complaint.trim();
  if (active(visit) && data.visits.some(v => v.id !== visit.id && active(v) && v.patient_ref.trim().toLowerCase() === visit.patient_ref.toLowerCase())) throw new Error('This patient reference already has an active visit.');
  if (!active(visit)) visit.resource_id = null;
  if (visit.resource_id) {
    const resource = data.resources.find(r => r.id === visit.resource_id);
    if (!resource || resource.state !== 'available') throw new Error('This space is not available.');
    if (data.visits.some(v => v.id !== visit.id && active(v) && v.resource_id === visit.resource_id)) throw new Error('This space is already assigned to another patient.');
    visit.location = resource.name;
  }
  const person = data.visits.find(v => v.patient_ref.toLowerCase() === visit.patient_ref.toLowerCase());
  if (!existing && person) {
    if (person.first_name !== visit.first_name || person.last_name !== visit.last_name || person.date_of_birth !== visit.date_of_birth) throw new Error('This patient reference has different identity details. Review the existing patient record before registering another visit.');
    visit.patient_id = person.patient_id; visit.patient_version = person.patient_version;
  }
  if (existing && (visit.first_name !== existing.first_name || visit.last_name !== existing.last_name || visit.date_of_birth !== existing.date_of_birth || existing.names_need_review)) {
    visit.patient_version++;
    data.visits = data.visits.map(v => v.patient_id === existing.patient_id ? { ...v, first_name: visit.first_name, last_name: visit.last_name, date_of_birth: visit.date_of_birth, patient_version: visit.patient_version, names_need_review: false } : v);
  }
  data.visits = existing ? data.visits.map(v => v.id === visit.id ? visit : v) : [...data.visits, visit];
  data.events.unshift({ id: crypto.randomUUID(), visit_id: visit.id, actor: `Demo ${data.role}`, action: existing ? 'updated' : 'registered', created_at: timestamp, summary: `${visit.patient_ref} · ${existing ? 'Record updated' : 'Patient registered'} · P${visit.priority} · ${visit.status.replaceAll('_', ' ')}` });
  persist(data);
}

export async function setResourceState(resource: Resource, state: Resource['state'], context?: HospitalContext, signal?: AbortSignal) {
  if (supabase) {
    await apiRequest(hospitalPath(`/resources/${resource.id}/`, context), 'PATCH', { state }, context?.id, signal);
    return;
  }
  const data = demoData();
  if (data.visits.some(v => active(v) && v.resource_id === resource.id)) throw new Error('Release the assigned patient before changing this space.');
  data.resources = data.resources.map(r => r.id === resource.id ? { ...r, state } : r);
  data.events.unshift({ id: crypto.randomUUID(), visit_id: '', actor: `Demo ${data.role}`, action: 'resource_updated', created_at: new Date().toISOString(), summary: `${resource.name} · ${state}` });
  persist(data);
}
