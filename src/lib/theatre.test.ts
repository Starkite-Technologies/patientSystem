import { describe, expect, it, vi } from 'vitest';
vi.mock('./supabase', () => ({ supabase: null }));
import { compareTheatre, deadlineState, deadlineText, needsDelayReason, priorityWarning, theatreOccupancy, theatrePermissions, type PriorityCode, type TheatreBooking } from './theatre';

const t0 = Date.parse('2026-10-31T08:00:00Z');
const minutes = (m: number) => t0 + m * 60000;
const booking = (over: Partial<TheatreBooking> = {}): TheatreBooking => ({
  id: 'a', booking_ref: 'TB-000001', patient_id: 'p', visit_id: null, patient_ref: 'PF-000001', first_name: 'Fictional', last_name: 'Person',
  date_of_birth: null, mrn: '', sex: 'unknown', location: 'Ward 3', specialty: 'Urology', responsible_consultant: 'Dr Test', booked_by_name: 'Reg',
  diagnosis: 'x', proposed_operation: 'y', indication: 'z', delay_consequence: 'pain', priority_code: 'P3', ncepod: 'urgent', priority_label: 'Within 6 hours',
  target_minutes: 360, priority_order: 3, clinically_approved: false, decision_at: new Date(t0).toISOString(), booked_at: new Date(t0).toISOString(),
  deadline_at: new Date(minutes(360)).toISOString(), estimated_minutes: 60, haemodynamically_unstable: false, septic_shock: false, organ_support: false,
  anaesthetic_concern: false, ready_for_theatre: false, details_complete: true, status: 'booked', theatre_id: null, theatre_name: null, planned_start: null,
  anaesthesia_start_at: null, incision_at: null, completed_at: null, delay_category: null, delay_note: '', cancelled_reason: '', cancel_authorised_by: '',
  updated_at: new Date(t0).toISOString(), version: 1, ...over,
});

describe('theatre deadline status', () => {
  it('moves from on target to past deadline as the target is used', () => {
    expect(deadlineState(booking(), minutes(60))).toBe('within');
    expect(deadlineState(booking(), minutes(250))).toBe('approaching');
    expect(deadlineState(booking(), minutes(310))).toBe('imminent');
    expect(deadlineState(booking(), minutes(361))).toBe('exceeded');
    expect(deadlineText(booking(), minutes(400))).toBe('Past deadline · +40m');
    expect(deadlineText(booking(), minutes(60))).toBe('On target · 5h 0m left');
  });
  it('treats immediate cases as immediate and stops the clock once in theatre', () => {
    expect(deadlineState(booking({ ncepod: 'immediate' }), minutes(1))).toBe('immediate');
    expect(deadlineState(booking({ status: 'anaesthesia' }), minutes(999))).toBeNull();
    expect(deadlineText(booking({ status: 'operating' }), minutes(999))).toBe('Surgery started');
  });
  it('asks for a delay reason only when a waiting case is past its deadline', () => {
    expect(needsDelayReason(booking(), minutes(361))).toBe(true);
    expect(needsDelayReason(booking({ delay_category: 'theatre_capacity' }), minutes(361))).toBe(false);
    expect(needsDelayReason(booking({ status: 'anaesthesia' }), minutes(361))).toBe(false);
  });
});

describe('theatre list order', () => {
  it('puts more urgent codes first even when a less urgent deadline is closer', () => {
    const urgent = booking({ id: 'urgent', priority_order: 1, deadline_at: new Date(minutes(600)).toISOString() });
    const lessUrgentButClose = booking({ id: 'close', priority_order: 5, deadline_at: new Date(minutes(5)).toISOString() });
    const closed = booking({ id: 'done', priority_order: 0, status: 'completed' });
    expect([lessUrgentButClose, closed, urgent].sort(compareTheatre).map(b => b.id)).toEqual(['urgent', 'close', 'done']);
  });
  it('orders the same code by earliest deadline', () => {
    const later = booking({ id: 'later', deadline_at: new Date(minutes(400)).toISOString() });
    const sooner = booking({ id: 'sooner', deadline_at: new Date(minutes(100)).toISOString() });
    expect([later, sooner].sort(compareTheatre)[0].id).toBe('sooner');
  });
});

describe('theatre rules in the interface', () => {
  it('matches the database permissions', () => {
    expect(theatrePermissions('clinician')).toMatchObject({ book: true, changePriority: false, cancel: false });
    expect(theatrePermissions('surgeon')).toMatchObject({ book: true, changePriority: true, cancel: true, export: true });
    expect(theatrePermissions('coordinator')).toMatchObject({ book: false, assignTheatre: true, clinical: false, cancel: true });
    expect(theatrePermissions('nurse')).toMatchObject({ readiness: true, times: true, delay: false });
    expect(theatrePermissions('viewer')).toMatchObject({ book: false, times: false, readiness: false });
  });
  it('flags a critical patient booked with a low code without changing it', () => {
    const p5: PriorityCode = { code: 'P5', ncepod: 'expedited', label: 'Within 24 hours', target_minutes: 1440, example: '', sort_order: 5, clinically_approved: false };
    expect(priorityWarning(p5, { septic_shock: true })).toContain('septic shock but booked P5');
    expect(priorityWarning(p5, { septic_shock: false })).toBe('');
  });
  it('estimates when a theatre is free', () => {
    const inTheatre = booking({ theatre_id: 'th1', status: 'operating', anaesthesia_start_at: new Date(t0).toISOString(), estimated_minutes: 90 });
    const { current, expectedFree } = theatreOccupancy({ id: 'th1', name: 'Theatre 01', state: 'available' }, [inTheatre]);
    expect(current?.id).toBe('a');
    expect(expectedFree).toBe(minutes(90));
  });
});
