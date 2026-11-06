import { apiRequest } from './api';
import { formatMinutes, type Role } from '../model';

// Emergency theatre list (docs/architecture/THEATRE_LIST_DESIGN.md). Clinical urgency (priority code) and
// deadline status are separate: the code is chosen by a clinician; the deadline colour is computed from time.
export type Ncepod = 'immediate' | 'urgent' | 'expedited';
export interface PriorityCode { code: string; ncepod: Ncepod; label: string; target_minutes: number; example: string; sort_order: number; clinically_approved: boolean }
export type TheatreStatus = 'booked' | 'anaesthesia' | 'operating' | 'completed' | 'cancelled';
export interface TheatreBooking {
  id: string; booking_ref: string; patient_id: string; visit_id: string | null; patient_ref: string;
  first_name: string | null; last_name: string | null; date_of_birth: string | null; mrn: string; sex: 'female' | 'male' | 'other' | 'unknown';
  location: string; specialty: string; responsible_consultant: string; booked_by_name: string;
  diagnosis: string; proposed_operation: string; indication: string; delay_consequence: string;
  priority_code: string; ncepod: Ncepod; priority_label: string; target_minutes: number; priority_order: number; clinically_approved: boolean;
  decision_at: string; booked_at: string; deadline_at: string; estimated_minutes: number | null;
  haemodynamically_unstable: boolean | null; septic_shock: boolean | null; organ_support: boolean | null; anaesthetic_concern: boolean | null;
  ready_for_theatre: boolean; details_complete: boolean; status: TheatreStatus;
  theatre_id: string | null; theatre_name: string | null; planned_start: string | null;
  anaesthesia_start_at: string | null; incision_at: string | null; completed_at: string | null;
  delay_category: string | null; delay_note: string; cancelled_reason: string; cancel_authorised_by: string;
  updated_at: string; version: number;
}
export interface Theatre { id: string; name: string; state: 'available' | 'cleaning' | 'unavailable' }
export interface TheatreData { role: Role; codes: PriorityCode[]; bookings: TheatreBooking[]; theatres: Theatre[]; staff: { name: string; role: string }[] }
export interface PriorityChange { from_code: string; to_code: string; changed_by_name: string; changed_at: string; reason: string }

export const ncepodLabels: Record<Ncepod, string> = { immediate: 'Immediate', urgent: 'Urgent', expedited: 'Expedited' };
export const theatreStatusLabels: Record<TheatreStatus, string> = {
  booked: 'Awaiting theatre', anaesthesia: 'Anaesthesia started', operating: 'Surgery started', completed: 'Completed', cancelled: 'Cancelled',
};
export const specialties = ['General Surgery', 'Orthopaedics', 'Obstetrics and Gynaecology', 'Neurosurgery', 'Urology', 'ENT',
  'Maxillofacial Surgery', 'Vascular Surgery', 'Paediatric Surgery', 'Cardiothoracic Surgery', 'Plastic Surgery'] as const;
export const consequences: Record<string, string> = {
  death: 'Death or haemodynamic collapse', limb_organ: 'Loss of limb or organ', sepsis: 'Progression of sepsis',
  bowel: 'Bowel ischaemia or perforation', neurological: 'Neurological deterioration', pain: 'Uncontrolled pain', other: 'Other (explain in indication)',
};
export const delayCategories: Record<string, string> = {
  theatre_capacity: 'Theatre capacity', anaesthetist: 'Anaesthetist unavailable', surgeon: 'Surgeon unavailable',
  patient_optimisation: 'Patient optimisation / resuscitation', investigations: 'Awaiting imaging or results', blood_bank: 'Blood products unavailable',
  equipment: 'Equipment unavailable', critical_care_bed: 'ICU/HCU bed unavailable', transport: 'Transfer delay',
  competing_emergency: 'Higher-priority case', administrative: 'Booking or communication failure', other: 'Other',
};
export const durations = [30, 60, 90, 120, 180, 240, 360];

// Deadline colour thresholds (share of the target used). Placeholders until clinically approved.
export const deadlineThresholds = { approaching: 0.67, imminent: 0.83 };
export type DeadlineState = 'within' | 'approaching' | 'imminent' | 'exceeded' | 'immediate';
export const deadlineLabels: Record<DeadlineState, string> = {
  within: 'On target', approaching: 'Approaching', imminent: 'Deadline imminent', exceeded: 'Past deadline', immediate: 'Immediate',
};

export const isOpen = (b: Pick<TheatreBooking, 'status'>) => ['booked', 'anaesthesia', 'operating'].includes(b.status);
export const minutesWaiting = (b: Pick<TheatreBooking, 'decision_at'>, now: number) => Math.max(0, Math.floor((now - Date.parse(b.decision_at)) / 60000));
export const minutesRemaining = (b: Pick<TheatreBooking, 'deadline_at'>, now: number) => Math.floor((Date.parse(b.deadline_at) - now) / 60000);

// Only cases still waiting for theatre have a deadline state; once anaesthesia starts the clock has stopped.
export function deadlineState(b: Pick<TheatreBooking, 'status' | 'ncepod' | 'decision_at' | 'deadline_at'>, now: number): DeadlineState | null {
  if (b.status !== 'booked') return null;
  if (b.ncepod === 'immediate') return 'immediate';
  const start = Date.parse(b.decision_at), end = Date.parse(b.deadline_at);
  const used = (now - start) / Math.max(1, end - start);
  return used >= 1 ? 'exceeded' : used >= deadlineThresholds.imminent ? 'imminent' : used >= deadlineThresholds.approaching ? 'approaching' : 'within';
}
export function deadlineText(b: TheatreBooking, now: number) {
  const state = deadlineState(b, now);
  if (!state) return theatreStatusLabels[b.status];
  const remaining = minutesRemaining(b, now);
  if (state === 'immediate') return `Immediate · waiting ${formatMinutes(minutesWaiting(b, now))}`;
  if (state === 'exceeded') return `Past deadline · +${formatMinutes(-remaining)}`;
  return `${deadlineLabels[state]} · ${formatMinutes(remaining)} left`;
}
export const needsDelayReason = (b: TheatreBooking, now: number) => b.status === 'booked' && now > Date.parse(b.deadline_at) && !b.delay_category;

// Open cases first; then urgency code; then earliest deadline. A closer deadline never lifts a less urgent code.
export const compareTheatre = (a: TheatreBooking, b: TheatreBooking) =>
  Number(isOpen(b)) - Number(isOpen(a)) || a.priority_order - b.priority_order
  || Date.parse(a.deadline_at) - Date.parse(b.deadline_at) || Date.parse(a.booked_at) - Date.parse(b.booked_at) || a.id.localeCompare(b.id);

// Mirrors the database rules (UI affordances only; the database decides).
export function theatrePermissions(role: Role) {
  const is = (...roles: Role[]) => roles.includes(role);
  return {
    book: is('clinician', 'surgeon', 'anaesthetist'),
    changePriority: is('surgeon', 'anaesthetist'),
    clinical: is('clinician', 'surgeon', 'anaesthetist'),
    readiness: is('clinician', 'surgeon', 'anaesthetist', 'coordinator', 'nurse'),
    assignTheatre: is('coordinator', 'surgeon', 'anaesthetist'),
    delay: is('clinician', 'surgeon', 'anaesthetist', 'coordinator'),
    times: is('clinician', 'surgeon', 'anaesthetist', 'coordinator', 'nurse'),
    cancel: is('surgeon', 'coordinator'),
    export: is('coordinator', 'surgeon', 'anaesthetist'),
  };
}

// Flags a mismatch between the patient's condition and a low urgency code. It never changes the code.
export function priorityWarning(code: PriorityCode | undefined, flags: { haemodynamically_unstable?: boolean | null; septic_shock?: boolean | null; organ_support?: boolean | null }) {
  if (!code || code.ncepod === 'immediate') return '';
  const critical = [flags.haemodynamically_unstable && 'haemodynamically unstable', flags.septic_shock && 'septic shock', flags.organ_support && 'on organ support'].filter(Boolean);
  return critical.length && code.sort_order >= 3 ? `Patient is ${critical.join(', ')} but booked ${code.code} (${code.label}). Check the priority.` : '';
}

export function theatreOccupancy(theatre: Theatre, bookings: TheatreBooking[]) {
  const current = bookings.find(b => b.theatre_id === theatre.id && ['anaesthesia', 'operating'].includes(b.status)) ?? null;
  const started = current ? Date.parse(current.anaesthesia_start_at ?? current.incision_at ?? current.updated_at) : null;
  const expectedFree = current && started !== null && current.estimated_minutes ? started + current.estimated_minutes * 60000 : null;
  const next = bookings.filter(b => b.theatre_id === theatre.id && b.status === 'booked').sort(compareTheatre)[0] ?? null;
  return { current, expectedFree, next };
}

// datetime-local <-> ISO in the device's time zone.
export const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};
export const fromLocalInput = (value: string) => value ? new Date(value).toISOString() : null;

export const loadTheatre = (signal?: AbortSignal) => apiRequest<TheatreData>('/theatre/', 'GET', undefined, undefined, signal);
export const bookTheatreCase = (input: Record<string, unknown>) => apiRequest<{ id: string }>('/theatre/bookings/', 'POST', { input });
export const updateTheatreCase = (b: TheatreBooking, input: Record<string, unknown>) => apiRequest(`/theatre/bookings/${b.id}/`, 'PATCH', { version: b.version, input });
export const changeTheatrePriority = (b: TheatreBooking, code: string, reason: string) => apiRequest(`/theatre/bookings/${b.id}/priority/`, 'POST', { version: b.version, code, reason });
export const recordTheatreTime = (b: TheatreBooking, event: 'anaesthesia' | 'incision' | 'completed') => apiRequest(`/theatre/bookings/${b.id}/times/`, 'POST', { version: b.version, event });
export const cancelTheatreCase = (b: TheatreBooking, reason: string, authorised_by: string) => apiRequest(`/theatre/bookings/${b.id}/cancel/`, 'POST', { version: b.version, reason, authorised_by });
export const loadPriorityHistory = (b: TheatreBooking) => apiRequest<{ changes: PriorityChange[] }>(`/theatre/bookings/${b.id}/history/`);
