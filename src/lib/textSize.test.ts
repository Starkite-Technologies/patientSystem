import { describe, expect, it } from 'vitest';
import { applyTextSize, readTextSize, saveTextSize } from './textSize';

const memory = () => { const items = new Map<string, string>(); return { items, getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v), removeItem: (k: string) => void items.delete(k) }; };

describe('text size preference', () => {
  it('defaults to Normal and remembers a choice on this device', () => {
    const storage = memory();
    expect(readTextSize(storage)).toBe('normal');
    saveTextSize('xl', storage);
    expect(readTextSize(storage)).toBe('xl');
  });
  it('starts existing users on the new Normal and clears the old setting', () => {
    const storage = memory(); storage.setItem('patientflow-text-size', 'xl');
    expect(readTextSize(storage)).toBe('normal');
    expect(storage.items.has('patientflow-text-size')).toBe(false);
  });
  it('ignores unknown values and blocked storage', () => {
    const storage = memory(); storage.setItem('patientflow-text-size-v2', 'huge');
    expect(readTextSize(storage)).toBe('normal');
    const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(readTextSize(blocked)).toBe('normal');
    expect(() => saveTextSize('large', blocked)).not.toThrow();
    expect(readTextSize(null)).toBe('normal');
  });
  it('applies the size to the document root', () => {
    const root = { dataset: {} as DOMStringMap };
    applyTextSize('large', root);
    expect(root.dataset.textSize).toBe('large');
  });
});
