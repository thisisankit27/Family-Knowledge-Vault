import { EmptyState } from '../../../src/components/EmptyState';
import { Screen } from '../../../src/components/Screen';
import { TAB_DOMAINS } from '../../../src/navigation/domains';

const domain = TAB_DOMAINS.find((entry) => entry.id === 'memories')!;

export default function MemoriesScreen() {
  return (
    <Screen title={domain.label} subtitle={domain.summary}>
      <EmptyState
        icon={domain.icon}
        title="No memories yet"
        body="Photographs, videos, voice recordings and written stories, arranged along the timeline of your family's life."
        arrivesIn={domain.arrivesIn}
      />
    </Screen>
  );
}
