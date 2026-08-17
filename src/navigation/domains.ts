/**
 * The navigation domain registry.
 *
 * `docs/06-information-architecture.md` §3 names twelve primary domains and
 * says "every screen belongs to exactly one domain". A phone tab bar holds
 * about five items before targets get too small for the accessibility goal in
 * NFR-018, so the twelve are split: four earn a permanent tab, the rest live
 * behind More.
 *
 * The split lives here as data rather than being scattered across screen files,
 * for one reason: it can then be checked. `domains.test.ts` asserts that every
 * domain the IA defines is reachable exactly once — so a future PR that adds a
 * tab, renames a domain, or quietly drops one fails a test instead of shipping
 * an unreachable corner of the product.
 *
 * IA §12 requires new domains (Pets, Insurance, Estate Planning…) to integrate
 * "without restructuring". Adding one here means appending to MORE_DOMAINS.
 */

/** Icon names are Ionicons, via @expo/vector-icons. */
export type IconName =
  | 'home-outline'
  | 'people-outline'
  | 'document-text-outline'
  | 'images-outline'
  | 'ellipsis-horizontal'
  | 'medkit-outline'
  | 'time-outline'
  | 'restaurant-outline'
  | 'cube-outline'
  | 'calendar-outline'
  | 'sparkles-outline'
  | 'notifications-outline'
  | 'settings-outline';

export interface Domain {
  id: string;
  label: string;
  icon: IconName;
  /** What this domain is for, in one line — shown in the More list. */
  summary: string;
  /** Where it gets built, so the More list is honest about what is empty. */
  arrivesIn: string;
}

/**
 * Transcribed from `docs/06-information-architecture.md` §3, in document order.
 * This is the contract the tests check the navigation against — edit it only
 * when the IA document itself changes.
 */
export const IA_PRIMARY_DOMAIN_IDS = [
  'dashboard',
  'family',
  'documents',
  'medical',
  'memories',
  'timeline',
  'recipes',
  'inventory',
  'calendar',
  'assistant',
  'notifications',
  'settings',
] as const;

/** The four domains that earn a permanent tab, plus Dashboard as home. */
export const TAB_DOMAINS: Domain[] = [
  {
    id: 'dashboard',
    // "Home" rather than the IA's "Dashboard": the label sits under a 24px
    // icon, and it is where you land, not a report you open.
    label: 'Home',
    icon: 'home-outline',
    summary: "What's happening in your family's world today",
    // Shipped. `arrivesIn` is required on every domain and has no "already
    // here" value, so the string carries it — the alternative is a type change
    // that four call sites and a test would follow.
    arrivesIn: 'Shipped',
  },
  {
    id: 'family',
    label: 'Family',
    icon: 'people-outline',
    summary: 'Everyone in your family, and how they connect',
    arrivesIn: 'Shipped',
  },
  {
    id: 'documents',
    label: 'Documents',
    icon: 'document-text-outline',
    summary: 'Identity, property, finance, education, legal',
    // Shipped when Phase 3 closed. Stale as 'Phase 3' until PR-17 noticed it.
    arrivesIn: 'Shipped',
  },
  {
    id: 'memories',
    label: 'Memories',
    icon: 'images-outline',
    summary: 'Photos, videos, voice notes, and written stories',
    // PR-17 shipped memories themselves; photographs, voice and albums are
    // PR-18 to PR-20. Still 'Phase 4' because the phase is where it *gets
    // built*, and the phase is not finished. Becomes 'Shipped' at PR-20.
    arrivesIn: 'Phase 4',
  },
];

/** Everything else, reachable through the More tab. */
export const MORE_DOMAINS: Domain[] = [
  {
    id: 'medical',
    label: 'Medical',
    icon: 'medkit-outline',
    summary: 'Reports, prescriptions, vaccinations, doctors',
    arrivesIn: 'Phase 5',
  },
  {
    id: 'timeline',
    label: 'Timeline',
    icon: 'time-outline',
    summary: "Your family's life, in order",
    arrivesIn: 'Phase 7',
  },
  {
    id: 'recipes',
    label: 'Recipes',
    icon: 'restaurant-outline',
    summary: 'The dishes that belong to your family',
    arrivesIn: 'Phase 6',
  },
  {
    id: 'inventory',
    label: 'Inventory',
    icon: 'cube-outline',
    summary: 'What you own, and what is still under warranty',
    arrivesIn: 'Phase 6',
  },
  {
    id: 'calendar',
    label: 'Calendar',
    icon: 'calendar-outline',
    summary: 'Birthdays, anniversaries, appointments, renewals',
    arrivesIn: 'Phase 7',
  },
  {
    id: 'assistant',
    label: 'AI Assistant',
    icon: 'sparkles-outline',
    summary: 'Ask about your family in plain language',
    arrivesIn: 'Phase 9',
  },
  {
    id: 'notifications',
    label: 'Notifications',
    icon: 'notifications-outline',
    summary: 'Reminders and what changed while you were away',
    arrivesIn: 'Phase 7',
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: 'settings-outline',
    summary: 'Your account, your family, and your privacy',
    arrivesIn: 'Phase 10',
  },
];

/**
 * The tab bar also carries a More entry. It is navigation, not an IA domain,
 * which is why it is not in either list above — and why the tests count it
 * separately when checking the bar has not outgrown a phone.
 */
export const TAB_BAR_SLOTS = TAB_DOMAINS.length + 1;

/**
 * Above this, labels truncate and targets shrink past comfortable one-handed
 * use (`docs/10-ui-ux-design.md` §18).
 */
export const MAX_TAB_BAR_SLOTS = 5;
