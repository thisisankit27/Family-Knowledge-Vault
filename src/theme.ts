/**
 * Design tokens derived from `docs/10-ui-ux-design.md`.
 *
 * The brief calls for warm, calm, and timeless rather than technical — warm
 * neutrals and soft earth tones, generous spacing, and high-contrast text that
 * stays readable for older family members (§7, §8).
 *
 * Light only for now. `app.json` sets `userInterfaceStyle: "light"` to match;
 * a dark palette doubles every colour decision and belongs in a polish PR once
 * the screens it has to cover actually exist.
 */
export const theme = {
  colors: {
    background: '#FAF6F0',
    surface: '#FFFFFF',
    /** A surface that needs to read as recessed rather than raised. */
    surfaceSunken: '#F3EDE4',
    text: '#2E2A25',
    textMuted: '#7A7069',
    primary: '#B5743F',
    /** Primary at low opacity, pre-mixed — used behind active icons. */
    primarySoft: '#F5E9DC',
    success: '#4F7A52',
    /** "Warm amber", §7. Not yet used; here so the first warning matches. */
    warning: '#C08A2E',
    error: '#A5504A',
    /** "Calm blue", §7 — informational, never alarming. */
    info: '#4A6E8A',
    border: '#E8DFD3',
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
    xxl: 48,
  },
  radius: {
    sm: 8,
    md: 12,
    lg: 20,
    /** Pills and avatars. */
    full: 999,
  },
  typography: {
    display: 34,
    title: 30,
    heading: 22,
    subheading: 18,
    body: 16,
    caption: 13,
  },
  /**
   * Minimum touch target. §18 asks for one-handed use and comfortable targets;
   * both platforms' accessibility guidance lands at roughly this size.
   */
  touchTarget: 48,
} as const;
