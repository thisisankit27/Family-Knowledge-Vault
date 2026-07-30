import 'react-native-url-polyfill/auto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { getSupabaseEnv } from './env';

let client: SupabaseClient | undefined;

/**
 * Shared Supabase client, created on first use.
 *
 * Lazy for the same reason `getSupabaseEnv` is: constructing at module scope
 * would make merely importing this file fail wherever env vars are absent.
 *
 * Session persistence is deliberately left at its default — PR-3
 * (Authentication) wires this up to Expo SecureStore so auth tokens live in
 * the device keychain rather than plain AsyncStorage.
 */
export function getSupabase(): SupabaseClient {
  if (!client) {
    const { url, key } = getSupabaseEnv();
    client = createClient(url, key, {
      auth: {
        // No deep-link callback handling yet; revisit in PR-3.
        detectSessionInUrl: false,
      },
    });
  }
  return client;
}
