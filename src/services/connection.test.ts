import { checkSupabaseConnection } from './connection';

const url = 'https://example.supabase.co';
const key = 'sb_publishable_abc';

function makeDeps(
  fetchFn: typeof fetch,
  times: number[] = [1000, 1120],
): Parameters<typeof checkSupabaseConnection>[0] {
  const clock = [...times];
  return {
    url,
    key,
    fetchFn,
    now: () => clock.shift() ?? 0,
  };
}

describe('checkSupabaseConnection', () => {
  it('reports success and measured latency on a 200 response', async () => {
    const fetchFn = jest.fn().mockResolvedValue({ ok: true, status: 200 });

    const result = await checkSupabaseConnection(makeDeps(fetchFn as never));

    expect(result).toEqual({ ok: true, latencyMs: 120 });
  });

  it('probes the auth health endpoint with the apikey header only', async () => {
    const fetchFn = jest.fn().mockResolvedValue({ ok: true, status: 200 });

    await checkSupabaseConnection(makeDeps(fetchFn as never));

    expect(fetchFn).toHaveBeenCalledWith(
      `${url}/auth/v1/health`,
      expect.objectContaining({ method: 'GET', headers: { apikey: key } }),
    );
  });

  // Regression guard: the PostgREST root 401s on newer projects even with a
  // valid key, and sending the key as a Bearer token is not how publishable
  // keys authenticate. Both cost us a live 401 during PR-1.
  it('does not probe the PostgREST root or send a bearer token', async () => {
    const fetchFn = jest.fn().mockResolvedValue({ ok: true, status: 200 });

    await checkSupabaseConnection(makeDeps(fetchFn as never));

    const [calledUrl, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).not.toContain('/rest/v1/');
    expect(init.headers).not.toHaveProperty('Authorization');
  });

  it('reports failure when Supabase rejects the credentials', async () => {
    const fetchFn = jest.fn().mockResolvedValue({ ok: false, status: 401 });

    const result = await checkSupabaseConnection(makeDeps(fetchFn as never));

    expect(result).toEqual({ ok: false, reason: 'Supabase responded with HTTP 401' });
  });

  it('surfaces network errors as a readable reason', async () => {
    const fetchFn = jest.fn().mockRejectedValue(new Error('Network request failed'));

    const result = await checkSupabaseConnection(makeDeps(fetchFn as never));

    expect(result).toEqual({ ok: false, reason: 'Network request failed' });
  });

  it('reports a timeout when the request is aborted', async () => {
    const abortError = new Error('Aborted');
    abortError.name = 'AbortError';
    const fetchFn = jest.fn().mockRejectedValue(abortError);

    const result = await checkSupabaseConnection({
      ...makeDeps(fetchFn as never),
      timeoutMs: 5000,
    });

    expect(result).toEqual({ ok: false, reason: 'Timed out after 5000ms' });
  });

  it('handles non-Error rejections without crashing', async () => {
    const fetchFn = jest.fn().mockRejectedValue('something odd');

    const result = await checkSupabaseConnection(makeDeps(fetchFn as never));

    expect(result).toEqual({ ok: false, reason: 'Unknown network error' });
  });
});
