import { getSupabaseEnv } from '../lib/env';

export type ConnectionStatus =
  | { ok: true; latencyMs: number }
  | { ok: false; reason: string };

export type ConnectionCheckDeps = {
  url: string;
  key: string;
  fetchFn: typeof fetch;
  now: () => number;
  timeoutMs?: number;
};

/**
 * Verifies the app can actually reach its Supabase project.
 *
 * Uses the GoTrue health endpoint, which returns 200 with a valid `apikey`
 * and 401 without one — so a success proves network, project, and
 * credentials together. It needs no tables to exist, which matters because
 * the schema doesn't arrive until PR-5.
 *
 * Note the PostgREST root (`/rest/v1/`) is *not* usable for this: newer
 * Supabase projects restrict that OpenAPI spec endpoint and return 401 even
 * for valid keys. Only `apikey` is sent — `Authorization: Bearer` carries a
 * signed-in user's JWT, which publishable keys are not.
 */
export async function checkSupabaseConnection(
  deps: ConnectionCheckDeps,
): Promise<ConnectionStatus> {
  const { url, key, fetchFn, now, timeoutMs = 8000 } = deps;

  const startedAt = now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchFn(`${url}/auth/v1/health`, {
      method: 'GET',
      headers: { apikey: key },
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        ok: false,
        reason: `Supabase responded with HTTP ${response.status}`,
      };
    }

    return { ok: true, latencyMs: now() - startedAt };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, reason: `Timed out after ${timeoutMs}ms` };
    }
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'Unknown network error',
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Production-wired variant used by the app shell. */
export function checkConnection(): Promise<ConnectionStatus> {
  const { url, key } = getSupabaseEnv();
  return checkSupabaseConnection({
    url,
    key,
    fetchFn: fetch,
    now: () => Date.now(),
  });
}
