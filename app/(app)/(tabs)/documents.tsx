import { EmptyState } from '../../../src/components/EmptyState';
import { Screen } from '../../../src/components/Screen';
import { TAB_DOMAINS } from '../../../src/navigation/domains';

const domain = TAB_DOMAINS.find((entry) => entry.id === 'documents')!;

export default function DocumentsScreen() {
  return (
    <Screen title={domain.label} subtitle={domain.summary}>
      <EmptyState
        icon={domain.icon}
        title="Nothing filed yet"
        body="Passports, policies, deeds, certificates and warranties — filed by what they mean rather than where they happened to be saved."
        arrivesIn={domain.arrivesIn}
      />
    </Screen>
  );
}
