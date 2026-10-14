import { describe, expect, it } from 'vitest';
import { ProtectedRequests } from './protectedRequests';

describe('protected response epochs', () => {
  it('processes a slow denial despite newer pending polls and rejects their stale success', () => {
    const gate = new ProtectedRequests(); gate.activate();
    const denied = gate.begin()!, pending = gate.begin()!;
    expect(gate.deny(denied)).toBe(true);
    expect(pending.controller.signal.aborted).toBe(true);
    expect(gate.accept(pending)).toBe(false); // Still safe if transport ignores abort.
    expect(gate.accept(gate.begin()!)).toBe(true); // Only a fresh authorised reply can restore data.
  });
  it('does not starve slow successful polls or overwrite a newer settled response', () => {
    const gate = new ProtectedRequests(); gate.activate();
    const first = gate.begin()!, second = gate.begin()!;
    expect(gate.accept(first)).toBe(true);
    expect(gate.accept(second)).toBe(true);
    expect(gate.accept(first)).toBe(false);
  });
  it('allows a completed write to request a fresh read after a newer poll settles', () => {
    const gate = new ProtectedRequests(); gate.activate();
    const mutation = gate.begin()!, poll = gate.begin()!;
    expect(gate.accept(poll)).toBe(true);
    expect(gate.current(mutation)).toBe(true);
    gate.deny(poll);
    expect(gate.current(mutation)).toBe(false);
  });
  it('rejects delayed display success after a newer denial', () => {
    const gate = new ProtectedRequests(); gate.activate();
    const success = gate.begin()!, denial = gate.begin()!;
    expect(gate.deny(denial)).toBe(true);
    expect(gate.accept(success)).toBe(false);
    expect(gate.deny(success)).toBe(false);
  });
  it('invalidates multiple pending requests on hospital switch, logout and reauthentication', () => {
    const gate = new ProtectedRequests(); gate.activate();
    const first = gate.begin()!, second = gate.begin()!;
    gate.close(); expect(gate.begin()).toBeNull();
    expect(first.controller.signal.aborted).toBe(true); expect(second.controller.signal.aborted).toBe(true);
    gate.activate(); expect(gate.accept(first)).toBe(false); expect(gate.deny(second)).toBe(false);
    expect(gate.accept(gate.begin()!)).toBe(true);
  });
  it('handles repeated permission failures without accepting previous data', () => {
    const gate = new ProtectedRequests(); gate.activate();
    const old = gate.begin()!; expect(gate.deny(old)).toBe(true);
    const next = gate.begin()!; expect(gate.deny(next)).toBe(true);
    expect(gate.accept(old)).toBe(false); expect(gate.accept(next)).toBe(false);
  });
});
