/**
 * "2 hours ago", for timestamps a person is scanning rather than reading.
 *
 * Written rather than pulled in: the only date formatting in the codebase
 * before this was one `toLocaleDateString` call, and a date library is a
 * dependency and a bundle cost for one function. `Intl.RelativeTimeFormat`
 * would give the wording for free but not the unit choice, which is the part
 * that actually needs deciding.
 *
 * Lives in `src/lib/` rather than beside the activity feed because Phase 3's
 * "last updated two months ago" on a document card needs exactly this.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/**
 * Beyond a week, relative time stops helping — "23 days ago" makes a reader do
 * arithmetic that a date does for them.
 */
function absolute(when: Date): string {
  return when.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const when = new Date(iso);
  // An unparseable timestamp should cost a caption, not a screen.
  if (Number.isNaN(when.getTime())) return '';

  const elapsed = now.getTime() - when.getTime();

  // Clock skew between a device and the server routinely puts a fresh row a
  // few seconds in the future. "In 4 seconds" is worse than a small lie.
  if (elapsed < MINUTE) return 'just now';

  if (elapsed < HOUR) {
    const minutes = Math.floor(elapsed / MINUTE);
    return minutes === 1 ? 'a minute ago' : `${minutes} minutes ago`;
  }

  if (elapsed < DAY) {
    const hours = Math.floor(elapsed / HOUR);
    return hours === 1 ? 'an hour ago' : `${hours} hours ago`;
  }

  if (elapsed < WEEK) {
    const days = Math.floor(elapsed / DAY);
    return days === 1 ? 'yesterday' : `${days} days ago`;
  }

  return absolute(when);
}
