// Per-device preferences other than text size. Storage can be blocked, so every read has a safe default.
export type StartView = 'board' | 'theatre';
const START_KEY = 'patientflow-start-view';
type Store = Pick<Storage, 'getItem' | 'setItem'>;
function deviceStorage(): Store | null {
  try { return window.localStorage; } catch { return null; }
}
export function readStartView(storage: Store | null = deviceStorage()): StartView {
  try { return storage?.getItem(START_KEY) === 'theatre' ? 'theatre' : 'board'; } catch { return 'board'; }
}
export function saveStartView(view: StartView, storage: Store | null = deviceStorage()) {
  try { storage?.setItem(START_KEY, view); } catch { /* applies for this visit only */ }
}
