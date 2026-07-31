import 'react-native-url-polyfill/auto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';

import { getSupabaseEnv } from './env';
import { createChunkedSecureStore } from './secureStore';

let client: SupabaseClient | undefined;

/**
 * Shared Supabase client, created on first use.
 *
 * Lazy for the same reason `getSupabaseEnv` is: constructing at module scope
 * would make merely importing this file fail wherever env vars are absent.
 */
export function getSupabase(): SupabaseClient {
  if (!client) {
    const { url, key } = getSupabaseEnv();
    client = createClient(url, key, {
      auth: {
        // Tokens live in the device keychain (iOS) / EncryptedSharedPreferences
        // (Android) rather than AsyncStorage, which is plain unencrypted disk.
        storage: createChunkedSecureStore(SecureStore),
        persistSession: true,
        autoRefreshToken: true,
        // React Native has no URL bar to read a callback out of. Deep-link
        // handling arrives with password reset in PR-3b.
        detectSessionInUrl: false,
      },
    });
  }
  return client;
}
