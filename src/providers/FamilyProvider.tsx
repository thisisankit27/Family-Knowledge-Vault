/**
 * Owns "which family am I looking at?" for the signed-in app.
 *
 * Same shape as [AuthProvider]: one place holds the answer, screens read it.
 * Loading families per-screen would let the Dashboard and the Family tab
 * disagree, and would re-query on every tab switch.
 *
 * The schema allows a person to belong to several families, and PR-6's
 * invitations make that reachable in practice. There is no switcher UI yet, so
 * this picks the first membership. That is a deliberate gap, not an
 * assumption baked into the data model — see `.claude/current-session.md`.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { getSupabase } from '../lib/supabase';
import {
  createSupabaseFamilyGateway,
  getMyRole,
  listMyFamilies,
  type Family,
  type FamilyRole,
} from '../services/family';
import { useAuth } from './AuthProvider';

interface FamilyContextValue {
  family: Family | null;
  /**
   * The caller's role, read from the access table rather than inferred from
   * the member list — a family with access rows but no people once made every
   * owner look like a stranger, and their controls vanished silently.
   */
  role: FamilyRole | null;
  /** True while the first load for the current session is in flight. */
  loading: boolean;
  /** Call after creating a family so every screen sees it at once. */
  refresh: () => Promise<void>;
}

const FamilyContext = createContext<FamilyContextValue | undefined>(undefined);

export function FamilyProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;

  const [family, setFamily] = useState<Family | null>(null);
  const [role, setRole] = useState<FamilyRole | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!userId) {
      setFamily(null);
      setRole(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const gateway = createSupabaseFamilyGateway(getSupabase());
      const families = await listMyFamilies(gateway);
      const current = families[0] ?? null;
      setFamily(current);
      setRole(current ? await getMyRole(gateway, current.id, userId) : null);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    let active = true;

    void (async () => {
      await refresh();
      if (!active) return;
    })();

    return () => {
      active = false;
    };
    // Keyed on the user, so signing out clears the family and signing in as
    // somebody else loads theirs rather than showing the previous account's.
  }, [refresh]);

  const value = useMemo(
    () => ({ family, role, loading, refresh }),
    [family, role, loading, refresh],
  );

  return <FamilyContext.Provider value={value}>{children}</FamilyContext.Provider>;
}

export function useFamily(): FamilyContextValue {
  const context = useContext(FamilyContext);
  if (!context) {
    throw new Error('useFamily must be used inside a FamilyProvider');
  }
  return context;
}
