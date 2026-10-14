import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
export let configurationError: string | null = Boolean(url) !== Boolean(key) ? 'Set both Supabase environment variables and restart the app.' : null;
export let supabase: SupabaseClient | null = null;
if (url && key) {
  try {
    if (key.startsWith('sb_secret_')) throw new Error('Use the publishable key, not a secret key, in frontend configuration.');
    supabase = createClient(url, key);
  } catch {
    configurationError = 'Check your Supabase project URL and publishable key, then restart the app. Secret keys must not be used in frontend configuration.';
  }
}
