import { describe, expect, it } from 'vitest';
import { ageAtDate, hospitalDate, canEditVisits, canManageResources, compareVisits, fullName, queuePosition, validateInput, waitLabel, type Visit } from './model';

describe('date of birth and derived age', () => {
  it('changes age on the birthday, not on January 1', () => {
    expect(ageAtDate('2000-10-14', '2026-10-13')).toBe(25);
    expect(ageAtDate('2000-10-14', '2026-10-14')).toBe(26);
    expect(ageAtDate('2026-10-14', '2026-10-14')).toBe(0);
  });
  it('handles leap days and unknown DOB without guessing', () => {
    expect(ageAtDate('2000-02-29', '2025-02-28')).toBe(24);
    expect(ageAtDate('2000-02-29', '2025-03-01')).toBe(25);
    expect(ageAtDate(null)).toBeNull();
    expect(ageAtDate('2001-02-29')).toBeNull();
    expect(ageAtDate('2026-10-15', '2026-10-14')).toBeNull();
  });
  it('uses the hospital date at the midnight timezone boundary', () => {
    expect(hospitalDate('2026-10-13T22:30:00Z')).toBe('2026-10-14');
  });
  it('rejects future birth dates', () => {
    expect(() => validateInput({ ...make('a', 3), date_of_birth: '2999-01-01' })).toThrow();
  });
});

describe('clinical role permissions', () => {
  it('gives nurses coordination controls alongside coordinators', () => {
    expect(canManageResources('nurse')).toBe(true);
    expect(canManageResources('coordinator')).toBe(true);
    expect(canManageResources('surgeon')).toBe(false);
    expect(canManageResources('clinician')).toBe(false);
    expect(canManageResources('viewer')).toBe(false);
  });
  it('allows nurses and surgeons to edit patients while viewers remain read only', () => {
    expect(canEditVisits('nurse')).toBe(true);
    expect(canEditVisits('surgeon')).toBe(true);
    expect(canEditVisits('clinician')).toBe(true);
    expect(canEditVisits('coordinator')).toBe(true);
    expect(canEditVisits('viewer')).toBe(false);
  });
});

const make = (id: string, priority: number, action: Visit['next_action'] = 'assessment', status: Visit['status'] = 'waiting', arrived = '2026-10-13T10:00:00Z'): Visit => ({
  id, priority, next_action: action, status, arrived_at: arrived, updated_at: arrived, version: 1,
  first_name: 'Fictional', last_name: 'Patient', patient_id: id, patient_version: 1, names_need_review: false, patient_ref: id, date_of_birth: null, complaint: 'Demo', location: '', assigned_to: '', resource_id: null, notes: '',
});
describe('service queues', () => {
  it('puts urgency before arrival and breaks equal priorities by arrival', () => {
    const visits = [make('low', 4), make('high-new', 2, 'assessment', 'ready', '2026-10-13T10:20:00Z'), make('high-old', 2)];
    expect([...visits].sort(compareVisits).map(v => v.id)).toEqual(['high-old', 'high-new', 'low']);
    expect(queuePosition(visits[0], visits)).toBe(3);
  });
  it('counts only waiting or ready patients in the same service', () => {
    const visits = [make('a', 3), make('surgery', 1, 'surgery'), make('treated', 1, 'assessment', 'in_treatment'), make('results', 1, 'assessment', 'awaiting_results'), make('done', 1, 'assessment', 'discharged')];
    expect(queuePosition(visits[0], visits)).toBe(1);
    expect(queuePosition(visits[2], visits)).toBeNull();
    expect(queuePosition(make('none', 1, 'none'), visits)).toBeNull();
  });
  it('reorders when urgency changes', () => {
    const visits = [make('a', 3), make('b', 2)];
    expect(queuePosition(visits[0], visits)).toBe(2);
    visits[0].priority = 1;
    expect(queuePosition(visits[0], visits)).toBe(1);
  });
});
describe('registration validation', () => {
  it('allows new patients without a manually entered reference', () => {
    expect(() => validateInput({ ...make('a', 3), patient_ref: '' })).not.toThrow();
  });
  it('rejects blank identifying fields and invalid dates or priorities', () => {
    expect(() => validateInput({ ...make('a', 3), first_name: ' ' })).toThrow();
    expect(() => validateInput({ ...make('a', 3), last_name: ' ' })).toThrow();
    expect(() => validateInput({ ...make('a', 0) })).toThrow();
    expect(() => validateInput({ ...make('a', 3), date_of_birth: '2000-02-30' })).toThrow();
    expect(() => validateInput({ ...make('a', 3), date_of_birth: null })).not.toThrow();
  });
  it('preserves multi-part names, punctuation, and Unicode when displaying names', () => {
    const person = { first_name: 'María José', last_name: "van der Berg-O’Neill" };
    expect(fullName(person)).toBe('María José van der Berg-O’Neill');
    expect(() => validateInput({ ...make('a', 3), ...person })).not.toThrow();
  });
  it('formats elapsed time without negative waits', () => {
    expect(waitLabel('2026-10-13T10:00:00Z', Date.parse('2026-10-13T11:35:00Z'))).toBe('1h 35m');
    expect(waitLabel('2026-10-13T10:00:00Z', Date.parse('2026-10-13T09:00:00Z'))).toBe('0m');
  });
});
