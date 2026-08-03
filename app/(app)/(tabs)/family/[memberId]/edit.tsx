import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { MemberForm } from '../../../../../src/components/MemberForm';
import { getSupabase } from '../../../../../src/lib/supabase';
import { useFamily } from '../../../../../src/providers/FamilyProvider';
import {
  createSupabaseMemberGateway,
  listMembers,
  updateMember,
  type Member,
} from '../../../../../src/services/member';
import { theme } from '../../../../../src/theme';

export default function EditMemberScreen() {
  const { memberId } = useLocalSearchParams<{ memberId: string }>();
  const { family } = useFamily();
  const [member, setMember] = useState<Member | null>(null);
  const [loading, setLoading] = useState(true);

  // Read from the list rather than a fetch-by-id: `list_family_members` is
  // already the one guarded way to read people, and adding a second function
  // would mean a second thing to keep in step with the permission model.
  const load = useCallback(async () => {
    if (!family) return;
    setLoading(true);
    try {
      const people = await listMembers(createSupabaseMemberGateway(getSupabase()), family.id);
      setMember(people.find((person) => person.id === memberId) ?? null);
    } finally {
      setLoading(false);
    }
  }, [family, memberId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (loading) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    );
  }

  if (!member) {
    return (
      <View style={styles.centre}>
        <Text style={styles.missing}>That person is no longer in this family.</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <MemberForm
        initial={{
          displayName: member.displayName,
          dateOfBirth: member.dateOfBirth,
          bloodGroup: member.bloodGroup,
        }}
        submitLabel="Save changes"
        onSubmit={(input) =>
          updateMember(createSupabaseMemberGateway(getSupabase()), member.id, input)
        }
        onSaved={() => router.back()}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centre: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.lg,
  },
  missing: {
    fontSize: theme.typography.body,
    color: theme.colors.textMuted,
    textAlign: 'center',
  },
  content: {
    padding: theme.spacing.lg,
    gap: theme.spacing.lg,
  },
});
