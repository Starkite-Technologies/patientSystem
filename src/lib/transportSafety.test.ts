import { describe, expect, it } from 'vitest';
import { securePageAllowed } from './transportSafety';

describe('staff credential transport', () => {
  it('allows HTTPS and loopback development', () => {
    expect(securePageAllowed('https:', 'patientflow.starkitetechnologies.com')).toBe(true);
    for (const host of ['localhost', '127.0.0.1', '[::1]']) expect(securePageAllowed('http:', host)).toBe(true);
  });
  it('blocks public HTTP and deceptive loopback names', () => {
    for (const host of ['patientflow.starkitetechnologies.com', 'localhost.example.com', '192.168.1.10']) {
      expect(securePageAllowed('http:', host)).toBe(false);
    }
    expect(securePageAllowed('file:', '')).toBe(false);
  });
});
