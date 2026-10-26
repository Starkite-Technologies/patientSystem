import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {publicKeyAllowed} from './keySafety';

const configuredUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
// 'same-origin': a self-hosted gateway's /auth/v1 is proxied under this page's origin.
const url = configuredUrl === 'same-origin' ? window.location.origin : configuredUrl;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
export let configurationError: string | null = Boolean(url) !== Boolean(key) ? 'Set both Supabase environment variables and restart the app.' : null;
export let supabase: SupabaseClient | null = null;
if (url && key) {
  try {
    if (!publicKeyAllowed(key)) throw new Error('Use a publishable or legacy anonymous key in frontend configuration.');
    supabase = createClient(url, key);
  } catch {
    configurationError = 'Check your Supabase project URL and publishable key, then restart the app. Secret keys must not be used in frontend configuration.';
  }
}
