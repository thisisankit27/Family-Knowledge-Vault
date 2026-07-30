/**
 * Environment configuration.
 *
 * Expo inlines `process.env.EXPO_PUBLIC_*` values into the bundle at build
 * time, so these must be referenced as full static property accesses rather
 * than destructured or accessed dynamically.
 *
 * Only publishable/anon-level keys belong here. The Supabase `secret` /
 * `service_role` key bypasses Row-Level Security and must never ship in a
 * client bundle.
 */

export type SupabaseEnv = {
  url: string;
  key: string;
};

export class MissingEnvError extends Error {
  constructor(names: string[]) {
    super(
      `Missing required environment variable(s): ${names.join(', ')}. ` +
        'Copy .env.example to .env and fill in your Supabase project values.',
    );
    this.name = 'MissingEnvError';
  }
}

/**
 * Resolves the Supabase credentials the client should use.
 *
 * Prefers the newer publishable key and falls back to the legacy anon key,
 * since Supabase is mid-transition between the two formats and either is
 * safe to expose client-side (both rely on RLS for access control).
 */
export function resolveSupabaseEnv(
  source: Record<string, string | undefined>,
): SupabaseEnv {
  const url = source.EXPO_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = source.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  const anonKey = source.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();

  const key = publishableKey || anonKey;

  const missing: string[] = [];
  if (!url) missing.push('EXPO_PUBLIC_SUPABASE_URL');
  if (!key) {
    missing.push(
      'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or EXPO_PUBLIC_SUPABASE_ANON_KEY)',
    );
  }

  if (missing.length > 0 || !url || !key) {
    throw new MissingEnvError(missing);
  }

  return { url, key };
}

let cached: SupabaseEnv | undefined;

/**
 * Reads the app's real environment, memoised after first success.
 *
 * Deliberately lazy: resolving at module scope would throw during import in
 * any environment without a populated `.env` — including CI and the test
 * suite — before a single line of consuming code ran.
 */
export function getSupabaseEnv(): SupabaseEnv {
  if (!cached) {
    cached = resolveSupabaseEnv({
      EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
        process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    });
  }
  return cached;
}
