import { EmptyState } from '../../../src/components/EmptyState';
import { Screen } from '../../../src/components/Screen';
import { TAB_DOMAINS } from '../../../src/navigation/domains';

const domain = TAB_DOMAINS.find((entry) => entry.id === 'family')!;

export default function FamilyScreen() {
  return (
    <Screen title={domain.label} subtitle={domain.summary}>
      <EmptyState
        icon={domain.icon}
        title="No family yet"
        body="Create a family workspace, then invite the people in it. Every member becomes a profile that documents, memories and medical records attach to."
        arrivesIn={domain.arrivesIn}
      />
    </Screen>
  );
}
