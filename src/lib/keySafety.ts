// Configuration screening only; this does not authenticate JWTs.
export function publicKeyAllowed(key: string): boolean {
  if (key.startsWith('sb_secret_')) return false;
  if (!key.startsWith('eyJ')) return true;
  try {
    const parts=key.split('.');
    if(parts.length!==3) return false;
    const payload=JSON.parse(atob(parts[1].replace(/-/g,'+').replace(/_/g,'/')));
    return payload.role==='anon';
  } catch { return false; }
}
