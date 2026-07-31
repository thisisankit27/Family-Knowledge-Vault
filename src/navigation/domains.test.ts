import {
  IA_PRIMARY_DOMAIN_IDS,
  MAX_TAB_BAR_SLOTS,
  MORE_DOMAINS,
  TAB_BAR_SLOTS,
  TAB_DOMAINS,
  type Domain,
} from './domains';

const allDomains: Domain[] = [...TAB_DOMAINS, ...MORE_DOMAINS];
const allIds = allDomains.map((domain) => domain.id);

describe('the navigation covers the information architecture', () => {
  it('reaches every primary domain the IA defines', () => {
    // The failure this guards: a future PR adds a tab, forgets to remove the
    // domain from More (or vice versa), and a corner of the product becomes
    // unreachable with nothing to notice it.
    expect([...allIds].sort()).toEqual([...IA_PRIMARY_DOMAIN_IDS].sort());
  });

  it('reaches each domain exactly once', () => {
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it('invents no domain the IA does not define', () => {
    const known = new Set<string>(IA_PRIMARY_DOMAIN_IDS);
    for (const id of allIds) {
      expect(known.has(id)).toBe(true);
    }
  });
});

describe('the tab bar stays usable on a phone', () => {
  it(`carries no more than ${MAX_TAB_BAR_SLOTS} slots including More`, () => {
    expect(TAB_BAR_SLOTS).toBeLessThanOrEqual(MAX_TAB_BAR_SLOTS);
  });

  it('opens on the dashboard', () => {
    // Expo Router maps the first tab to index.tsx; if this stops being
    // dashboard, the route file has to move with it.
    expect(TAB_DOMAINS[0].id).toBe('dashboard');
  });
});

describe('every domain is presentable', () => {
  it.each(allDomains.map((domain) => [domain.id, domain] as const))(
    '%s has a label, icon, summary and a stated arrival',
    (_id, domain) => {
      expect(domain.label.trim().length).toBeGreaterThan(0);
      expect(domain.icon.trim().length).toBeGreaterThan(0);
      expect(domain.summary.trim().length).toBeGreaterThan(0);
      // The More list tells people when an empty section becomes real. An
      // empty string here would render a dangling label.
      expect(domain.arrivesIn.trim().length).toBeGreaterThan(0);
    },
  );

  it('keeps tab labels short enough not to truncate', () => {
    for (const domain of TAB_DOMAINS) {
      expect(domain.label.length).toBeLessThanOrEqual(10);
    }
  });
});
