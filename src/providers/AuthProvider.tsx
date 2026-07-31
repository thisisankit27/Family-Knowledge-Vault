/**
 * Owns "is anyone signed in?" for the whole app.
 *
 * One source of truth, because routing depends on it: `app/_layout.tsx` chooses
 * between the auth stack and the app stack from this state. Screens read it;
 * they never each ask Supabase separately, which would let two parts of the UI
 * disagree about whether the person is signed in.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';
import type { Session, SupabaseClient } from '@supabase/supabase-js';

import { getSupabase } from '../lib/supabase';
import { getSession } from '../services/auth';

interface AuthContextValue {
  session: Session | null;
  /** True until the stored session has been read — see the note in the layout. */
  initialising: boolean;
  /** Set when the Supabase client itself could not be constructed. */
  configError: string | null;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [initialising, setInitialising] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);

  useEffect(() => {
    let client: SupabaseClient;
    try {
      client = getSupabase();
    } catch (error) {
      // Missing env vars. Surfacing this beats an unexplained blank screen —
      // it is the exact failure PR-1's lazy env resolution was built to make
      // catchable rather than fatal at import time.
      setConfigError(error instanceof Error ? error.message : 'Unknown configuration error');
      setInitialising(false);
      return;
    }

    let active = true;

    void getSession(client.auth).then((restored) => {
      if (!active) return;
      setSession(restored);
      setInitialising(false);
    });

    const { data: subscription } = client.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });

    // Supabase refreshes tokens on a timer, which the OS suspends in the
    // background. Without this, a session can be expired on resume and the
    // first request after reopening the app fails.
    const appState = AppState.addEventListener('change', (status) => {
      if (status === 'active') client.auth.startAutoRefresh();
      else client.auth.stopAutoRefresh();
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
      appState.remove();
    };
  }, []);

  const value = useMemo(
    () => ({ session, initialising, configError }),
    [session, initialising, configError],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside an AuthProvider');
  }
  return context;
}
