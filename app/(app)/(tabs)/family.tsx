import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Button } from '../../../src/components/Button';
import { InviteCode } from '../../../src/components/InviteCode';
import { Screen } from '../../../src/components/Screen';
import { TextField } from '../../../src/components/TextField';
import { getSupabase } from '../../../src/lib/supabase';
import { TAB_DOMAINS } from '../../../src/navigation/domains';
import { useAuth } from '../../../src/providers/AuthProvider';
import { useFamily } from '../../../src/providers/FamilyProvider';
import {
  createFamily,
  createSupabaseFamilyGateway,
  MAX_FAMILY_NAME_LENGTH,
  type Family,
} from '../../../src/services/family';
import {
  createInvitation,
  createSupabaseInvitationGateway,
  listMembers,
  listUsableInvitations,
  redeemInvitation,
  revokeInvitation,
  type FamilyMember,
  type Invitation,
} from '../../../src/services/invitation';
import { theme } from '../../../src/theme';

const domain = TAB_DOMAINS.find((entry) => entry.id === 'family')!;

export default function FamilyScreen() {
  const { family, loading } = useFamily();

  if (loading) {
    return (
      <Screen title={domain.label} subtitle={domain.summary}>
        <ActivityIndicator color={theme.colors.primary} />
      </Screen>
    );
  }

  return family ? <FamilyProfile family={family} /> : <NoFamily />;
}

/**
 * Two ways in, and they are not equal weight: most people arrive because
 * somebody sent them a code, so joining is offered first and creating is the
 * quieter option beneath it.
 */
function NoFamily() {
  return (
    <Screen
      title="Join or create"
      subtitle="Everything in the vault belongs to a family."
    >
      <JoinFamily />
      <View style={styles.divider} />
      <CreateFamily />
    </Screen>
  );
}

function JoinFamily() {
  const { refresh } = useFamily();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleJoin() {
    setBusy(true);
    setError(null);
    try {
      const result = await redeemInvitation(
        createSupabaseInvitationGateway(getSupabase()),
        code,
      );
      if (!result.ok) {
        setError(result.message);
        return;
      }
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.cardLabel}>Have a code?</Text>
      <TextField
        label="Invitation code"
        value={code}
        onChangeText={setCode}
        placeholder="ABCD 2345"
        error={error ?? undefined}
        autoCapitalize="characters"
        autoCorrect={false}
        editable={!busy}
        onSubmitEditing={handleJoin}
        returnKeyType="go"
      />
      <Button label="Join family" onPress={handleJoin} busy={busy} />
    </View>
  );
}

function CreateFamily() {
  const { refresh } = useFamily();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setBusy(true);
    setError(null);
    try {
      // No creator passed: the database reads it from the session, so this
      // screen cannot create a family in anyone else's name even if it tried.
      const result = await createFamily(createSupabaseFamilyGateway(getSupabase()), {
        name,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.cardLabel}>Starting fresh?</Text>
      <TextField
        label="Family name"
        value={name}
        onChangeText={setName}
        placeholder="The Srivastavas"
        error={error ?? undefined}
        maxLength={MAX_FAMILY_NAME_LENGTH}
        editable={!busy}
        autoCapitalize="words"
        onSubmitEditing={handleCreate}
        returnKeyType="go"
      />
      <Button label="Create family" onPress={handleCreate} busy={busy} variant="quiet" />
      <Text style={styles.footnote}>You'll be its owner.</Text>
    </View>
  );
}

function FamilyProfile({ family }: { family: Family }) {
  const { session } = useAuth();
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const gateway = createSupabaseInvitationGateway(getSupabase());
    setLoading(true);
    try {
      const [nextMembers, nextInvitations] = await Promise.all([
        listMembers(gateway, family.id),
        listUsableInvitations(gateway, family.id),
      ]);
      setMembers(nextMembers);
      setInvitations(nextInvitations);
    } finally {
      setLoading(false);
    }
  }, [family.id]);

  // Refetched on focus, not just on mount. Somebody joining or spending a code
  // happens on another device, so this screen is stale the moment it is left —
  // and a used code lingering on screen looks like it still works.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const isOwner = members.some(
    (member) => member.userId === session?.user.id && member.role === 'owner',
  );

  async function handleInvite() {
    setInviting(true);
    setError(null);
    try {
      const result = await createInvitation(
        createSupabaseInvitationGateway(getSupabase()),
        { familyId: family.id },
      );
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setInvitations((current) => [result.invitation, ...current]);
    } finally {
      setInviting(false);
    }
  }

  async function handleRevoke(id: string) {
    setRevokingId(id);
    setError(null);
    try {
      const result = await revokeInvitation(
        createSupabaseInvitationGateway(getSupabase()),
        id,
      );
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setInvitations((current) => current.filter((invitation) => invitation.id !== id));
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <Screen title={family.name} subtitle={domain.summary}>
      <View style={styles.card}>
        <Text style={styles.cardLabel}>
          {members.length === 1 ? '1 member' : `${members.length} members`}
        </Text>
        {loading ? (
          <ActivityIndicator color={theme.colors.primary} />
        ) : (
          members.map((member) => (
            <MemberRow
              key={member.userId}
              member={member}
              isYou={member.userId === session?.user.id}
            />
          ))
        )}
      </View>

      {isOwner && (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Invite someone</Text>

          {invitations.length === 0 ? (
            <Text style={styles.body}>
              Create a code and share it however you like. Each one works once
              and expires after a week.
            </Text>
          ) : (
            invitations.map((invitation) => (
              <InviteCode
                key={invitation.id}
                code={invitation.code}
                expiresAt={invitation.expiresAt}
                role={invitation.role}
                onRevoke={() => void handleRevoke(invitation.id)}
                revoking={revokingId === invitation.id}
              />
            ))
          )}

          {!!error && (
            <Text style={styles.error} accessibilityRole="alert">
              {error}
            </Text>
          )}

          <Button
            label={invitations.length === 0 ? 'Create an invite code' : 'Create another'}
            onPress={handleInvite}
            busy={inviting}
            variant={invitations.length === 0 ? 'primary' : 'quiet'}
          />
        </View>
      )}
    </Screen>
  );
}

function MemberRow({ member, isYou }: { member: FamilyMember; isYou: boolean }) {
  return (
    <View style={styles.memberRow}>
      <View style={styles.avatar}>
        <Ionicons name="person-outline" size={18} color={theme.colors.primary} />
      </View>
      <View style={styles.memberText}>
        <Text style={styles.memberEmail} numberOfLines={1}>
          {member.email}
          {isYou ? ' (you)' : ''}
        </Text>
        <Text style={styles.memberRole}>
          {member.role === 'owner' ? 'Owner' : 'Member'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  cardLabel: {
    fontSize: theme.typography.caption,
    textTransform: 'uppercase',
    letterSpacing: 1,
    color: theme.colors.textMuted,
  },
  divider: {
    height: 1,
    backgroundColor: theme.colors.border,
    marginVertical: theme.spacing.xs,
  },
  body: {
    fontSize: theme.typography.body,
    lineHeight: 24,
    color: theme.colors.textMuted,
  },
  error: {
    fontSize: theme.typography.body,
    color: theme.colors.error,
  },
  footnote: {
    fontSize: theme.typography.caption,
    color: theme.colors.textMuted,
    textAlign: 'center',
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    minHeight: theme.touchTarget,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberText: {
    flex: 1,
    gap: 2,
  },
  memberEmail: {
    fontSize: theme.typography.body,
    fontWeight: '600',
    color: theme.colors.text,
  },
  memberRole: {
    fontSize: theme.typography.caption,
    color: theme.colors.textMuted,
  },
});
