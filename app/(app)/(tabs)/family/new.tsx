import { router } from 'expo-router';
import { ScrollView, StyleSheet, Text } from 'react-native';

import { MemberForm } from '../../../../src/components/MemberForm';
import { getSupabase } from '../../../../src/lib/supabase';
import { useFamily } from '../../../../src/providers/FamilyProvider';
import { addMember, createSupabaseMemberGateway } from '../../../../src/services/member';
import { theme } from '../../../../src/theme';

export default function AddMemberScreen() {
  const { family } = useFamily();

  if (!family) {
    // Only reachable by a deep link before a family exists.
    return null;
  }

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.intro}>
        Add anyone in the family — including relatives who will never use the
        app. Their documents, medical records and memories attach to them.
      </Text>

      <MemberForm
        submitLabel="Add to family"
        onSubmit={(input) =>
          addMember(createSupabaseMemberGateway(getSupabase()), family.id, input)
        }
        onSaved={() => router.back()}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: theme.spacing.lg,
    gap: theme.spacing.lg,
  },
  intro: {
    fontSize: theme.typography.body,
    lineHeight: 24,
    color: theme.colors.textMuted,
  },
});
