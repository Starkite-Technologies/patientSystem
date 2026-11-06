export const textSizes = [
  { id: 'normal', label: 'Normal' },
  { id: 'large', label: 'Large' },
  { id: 'xl', label: 'Extra large' },
] as const;
export type TextSize = typeof textSizes[number]['id'];
// v2: sizes changed to 15/16/18px; choices saved under the old key are ignored so everyone starts on Normal.
const KEY = 'patientflow-text-size-v2';
const OLD_KEYS = ['patientflow-text-size'];
type Store = Pick<Storage, 'getItem' | 'setItem'> & Partial<Pick<Storage, 'removeItem'>>;

// Per-device preference. Storage can be blocked (private windows), so failures fall back to Normal.
function deviceStorage(): Store | null {
  try { return window.localStorage; } catch { return null; }
}
export function readTextSize(storage: Store | null = deviceStorage()): TextSize {
  try {
    for (const old of OLD_KEYS) storage?.removeItem?.(old);
    const saved = storage?.getItem(KEY);
    return textSizes.find(size => size.id === saved)?.id ?? 'normal';
  } catch { return 'normal'; }
}
export function saveTextSize(size: TextSize, storage: Store | null = deviceStorage()) {
  try { storage?.setItem(KEY, size); } catch { /* the choice still applies for this visit */ }
}
export function applyTextSize(size: TextSize, root: { dataset: DOMStringMap } = document.documentElement) {
  root.dataset.textSize = size;
}
