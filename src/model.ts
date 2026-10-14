export const priorities = ['P1 · Highest', 'P2 · High', 'P3 · Moderate', 'P4 · Lower', 'P5 · Lowest'];
export const statuses = {
  waiting: 'Waiting', ready: 'Ready', in_treatment: 'In treatment',
  awaiting_results: 'Awaiting results', observation: 'Observation',
  discharged: 'Discharged', transferred: 'Transferred',
} as const;
export const actions = {
  assessment: 'Clinical assessment', imaging: 'Imaging', laboratory: 'Laboratory',
  treatment: 'Treatment', surgery: 'Surgery', admission: 'Ward admission', none: 'No pending action',
} as const;
export type Status = keyof typeof statuses;
export type Action = keyof typeof actions;
export type Role = 'clinician' | 'coordinator' | 'viewer' | 'nurse' | 'surgeon';
export const canEditVisits = (role: Role) => ['clinician', 'coordinator', 'nurse', 'surgeon'].includes(role);
export const canManageResources = (role: Role) => ['nurse', 'coordinator'].includes(role);
export interface Visit {
  id: string; patient_ref: string; first_name: string; last_name: string; patient_id: string; patient_version: number; names_need_review: boolean; date_of_birth: string | null;
  complaint: string; priority: number; status: Status; next_action: Action;
  location: string; resource_id: string | null; assigned_to: string;
  notes: string; arrived_at: string; updated_at: string; version: number;
}
export type VisitInput = Omit<Visit, 'id' | 'arrived_at' | 'updated_at' | 'version' | 'patient_id' | 'patient_version' | 'names_need_review'>;
export interface Resource { id: string; name: string; kind: string; state: 'available' | 'cleaning' | 'unavailable' }
export interface AuditEvent { id: string; visit_id: string; actor: string; action: string; created_at: string; summary: string }
export type PatientOption = Pick<Visit, 'patient_id' | 'patient_ref' | 'first_name' | 'last_name' | 'date_of_birth'>;
export interface BoardData { visits: Visit[]; resources: Resource[]; events: AuditEvent[]; role: Role; capabilities?: string[]; patients?: PatientOption[] }
export interface HospitalContext { id: string; hospital_id: string; purpose: 'clinical' | 'display'; expires_at: string }
export interface Hospital { id: string; name: string; facility_type: 'public' | 'private' | 'other' }
export const fullName = (person: { first_name: string; last_name: string }) => [person.first_name, person.last_name].filter(Boolean).join(' ');
export const active = (visit: Visit) => !['discharged', 'transferred'].includes(visit.status);
export const compareVisits = (a: Visit, b: Visit) => a.priority - b.priority || Date.parse(a.arrived_at) - Date.parse(b.arrived_at) || a.id.localeCompare(b.id);
export function queuePosition(visit: Visit, visits: Visit[]) {
  if (!active(visit) || !['waiting', 'ready'].includes(visit.status) || visit.next_action === 'none') return null;
  const queue = visits.filter(v => active(v) && ['waiting', 'ready'].includes(v.status) && v.next_action === visit.next_action).sort(compareVisits);
  const index = queue.findIndex(v => v.id === visit.id);
  return index < 0 ? null : index + 1;
}
export function waitLabel(arrival: string, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - Date.parse(arrival)) / 60000));
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
export function validateInput(input: VisitInput) {
  if (!input.first_name.trim() || !input.last_name.trim() || !input.complaint.trim()) throw new Error('First name, last name, and presenting complaint are required.');
  if (!Number.isInteger(input.priority) || input.priority < 1 || input.priority > 5) throw new Error('Choose a priority from P1 to P5.');
  if (input.date_of_birth !== null && (!validBirthDate(input.date_of_birth) || input.date_of_birth > hospitalDate())) throw new Error('Enter a valid date of birth that is not in the future.');
}

export function hospitalDate(timestamp: string | number = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(timestamp));
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function validBirthDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.slice(0,4) === '0000') return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,10) === value;
}
export function ageAtDate(birthDate: string | null, date = hospitalDate()): number | null {
  if (!birthDate || !validBirthDate(birthDate) || birthDate > date) return null;
  const [year, month, day] = date.split('-').map(Number);
  const [birthYear, birthMonth, birthDay] = birthDate.split('-').map(Number);
  return year - birthYear - (month < birthMonth || (month === birthMonth && day < birthDay) ? 1 : 0);
}
