import { formatRelativeTime } from './relativeTime';

const NOW = new Date('2026-08-07T12:00:00.000Z');

function ago(ms: number): string {
  return new Date(NOW.getTime() - ms).toISOString();
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('formatRelativeTime', () => {
  it.each([
    [0, 'just now'],
    [30 * SECOND, 'just now'],
    [MINUTE, 'a minute ago'],
    [2 * MINUTE, '2 minutes ago'],
    [59 * MINUTE, '59 minutes ago'],
    [HOUR, 'an hour ago'],
    [5 * HOUR, '5 hours ago'],
    [23 * HOUR, '23 hours ago'],
    [DAY, 'yesterday'],
    [3 * DAY, '3 days ago'],
    [6 * DAY, '6 days ago'],
  ])('renders %p ms ago as %p', (elapsed, expected) => {
    expect(formatRelativeTime(ago(elapsed), NOW)).toBe(expected);
  });

  it('switches to a date once relative time stops helping', () => {
    // "23 days ago" makes a reader do arithmetic that a date does for them.
    const result = formatRelativeTime(ago(30 * DAY), NOW);
    expect(result).not.toMatch(/ago/);
    expect(result).toMatch(/2026/);
  });

  it('treats a future timestamp as just now', () => {
    // Clock skew between a device and the server routinely puts a fresh row a
    // few seconds ahead. "In 4 seconds" is worse than a small lie.
    expect(formatRelativeTime(new Date(NOW.getTime() + 4 * SECOND).toISOString(), NOW)).toBe(
      'just now',
    );
  });

  it('returns an empty string for an unparseable timestamp', () => {
    // Should cost a caption, not a screen.
    expect(formatRelativeTime('not a date', NOW)).toBe('');
    expect(formatRelativeTime('', NOW)).toBe('');
  });

  it('never says "1 minutes" or "1 hours"', () => {
    expect(formatRelativeTime(ago(MINUTE), NOW)).not.toMatch(/\b1 /);
    expect(formatRelativeTime(ago(HOUR), NOW)).not.toMatch(/\b1 /);
  });
});
