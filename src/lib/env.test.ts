import { MissingEnvError, resolveSupabaseEnv } from './env';

describe('resolveSupabaseEnv', () => {
  const url = 'https://example.supabase.co';

  it('prefers the publishable key over the legacy anon key', () => {
    const result = resolveSupabaseEnv({
      EXPO_PUBLIC_SUPABASE_URL: url,
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc',
      EXPO_PUBLIC_SUPABASE_ANON_KEY: 'legacy_anon_jwt',
    });

    expect(result).toEqual({ url, key: 'sb_publishable_abc' });
  });

  it('falls back to the legacy anon key when no publishable key is set', () => {
    const result = resolveSupabaseEnv({
      EXPO_PUBLIC_SUPABASE_URL: url,
      EXPO_PUBLIC_SUPABASE_ANON_KEY: 'legacy_anon_jwt',
    });

    expect(result).toEqual({ url, key: 'legacy_anon_jwt' });
  });

  it('trims surrounding whitespace from values', () => {
    const result = resolveSupabaseEnv({
      EXPO_PUBLIC_SUPABASE_URL: `  ${url}  `,
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: '  sb_publishable_abc  ',
    });

    expect(result).toEqual({ url, key: 'sb_publishable_abc' });
  });

  it('treats a whitespace-only key as missing', () => {
    expect(() =>
      resolveSupabaseEnv({
        EXPO_PUBLIC_SUPABASE_URL: url,
        EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: '   ',
      }),
    ).toThrow(MissingEnvError);
  });

  it('throws when the URL is missing', () => {
    expect(() =>
      resolveSupabaseEnv({
        EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc',
      }),
    ).toThrow(/EXPO_PUBLIC_SUPABASE_URL/);
  });

  it('throws when every key variant is missing', () => {
    expect(() =>
      resolveSupabaseEnv({ EXPO_PUBLIC_SUPABASE_URL: url }),
    ).toThrow(/PUBLISHABLE_KEY/);
  });

  it('names every missing variable in a single error', () => {
    expect(() => resolveSupabaseEnv({})).toThrow(
      /EXPO_PUBLIC_SUPABASE_URL[\s\S]*PUBLISHABLE_KEY/,
    );
  });
});
