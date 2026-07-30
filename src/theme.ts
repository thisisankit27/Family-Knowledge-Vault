/**
 * Design tokens derived from `docs/10-ui-ux-design.md`.
 *
 * The brief calls for warm, calm, and timeless rather than technical — warm
 * neutrals and soft earth tones, generous spacing, and high-contrast text
 * that stays readable for older family members.
 *
 * Intentionally minimal for PR-1; PR-4 (App Shell) expands this into the
 * full theme the navigation and screens consume.
 */
export const theme = {
  colors: {
    background: '#FAF6F0',
    surface: '#FFFFFF',
    text: '#2E2A25',
    textMuted: '#7A7069',
    primary: '#B5743F',
    success: '#4F7A52',
    error: '#A5504A',
    border: '#E8DFD3',
  },
  spacing: {
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
  },
  radius: {
    md: 12,
    lg: 20,
  },
  typography: {
    title: 30,
    body: 16,
    caption: 13,
  },
} as const;
