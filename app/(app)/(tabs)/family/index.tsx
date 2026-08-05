import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '../../../../src/components/Button';
import { InviteCode } from '../../../../src/components/InviteCode';
import { Screen } from '../../../../src/components/Screen';
import { TextField } from '../../../../src/components/TextField';
import { getSupabase } from '../../../../src/lib/supabase';
import { TAB_DOMAINS } from '../../../../src/navigation/domains';
import { useAuth } from '../../../../src/providers/AuthProvider';
import { useFamily } from '../../../../src/providers/FamilyProvider';
import {
  createFamily,
  createSupabaseFamilyGateway,
  MAX_FAMILY_NAME_LENGTH,
  type Family,
} from '../../../../src/services/family';
import {
  createInvitation,
  createSupabaseInvitationGateway,
  listUsableInvitations,
  redeemInvitation,
  revokeInvitation,
  type Invitation,
} from '../../../../src/services/invitation';
import {
  createSupabaseMemberGateway,
  listMembers,
  type Member,
} from '../../../../src/services/member';
import {
  canEditPeople,
  canManageMembers,
  invitableRoles,
  ROLE_LABELS,
  type FamilyRole,
} from '../../../../src/services/role';
import { theme } from '../../../../src/theme';

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

  return family ? <FamilyHome family={family} /> : <NoFamily />;
}

/**
 * Two ways in, and they are not equal weight: most people arrive because
 * somebody sent them a code, so joining is offered first.
 */
function NoFamily() {
  return (
    <Screen title="Join or create" subtitle="Everything in the vault belongs to a family.">
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
      const result = await createFamily(createSupabaseFamilyGateway(getSupabase()), { name });
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

function FamilyHome({ family }: { family: Family }) {
  const { session } = useAuth();
  // From the access table, not from the member list below. Deriving it from
  // the list meant a family with no people rows stripped its owner of the
  // invite controls, with nothing on screen to explain why.
  const { role } = useFamily();
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Derived from the caller's own role, so an admin is never offered a choice
  // the database is going to refuse. The cap is enforced in create_invitation
  // regardless — this only decides what gets drawn.
  const offerable = invitableRoles(role);
  const [invitedRole, setInvitedRole] = useState<FamilyRole>('member');

  const load = useCallback(async () => {
    const supabase = getSupabase();
    setLoading(true);
    try {
      const [nextMembers, nextInvitations] = await Promise.all([
        listMembers(createSupabaseMemberGateway(supabase), family.id),
        listUsableInvitations(createSupabaseInvitationGateway(supabase), family.id),
      ]);
      setMembers(nextMembers);
      setInvitations(nextInvitations);
    } finally {
      setLoading(false);
    }
  }, [family.id]);

  // On focus rather than on mount: people join and codes get spent on another
  // device, and returning from the edit screen must show the new name.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function handleInvite() {
    setInviting(true);
    setError(null);
    try {
      const result = await createInvitation(createSupabaseInvitationGateway(getSupabase()), {
        familyId: family.id,
        role: invitedRole,
      });
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
      const result = await revokeInvitation(createSupabaseInvitationGateway(getSupabase()), id);
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
          {members.length === 1 ? '1 person' : `${members.length} people`}
        </Text>

        {loading ? (
          <ActivityIndicator color={theme.colors.primary} />
        ) : (
          members.map((member) => (
            <MemberRow
              key={member.id}
              member={member}
              isYou={member.userId === session?.user.id}
            />
          ))
        )}

        {/* Hidden rather than disabled for a guest. The database refuses this
            anyway, and a button that always fails is worse than no button —
            the same reason the More tab's unbuilt rows are not tappable. */}
        {canEditPeople(role) && (
          <Button
            label="Add someone"
            variant="quiet"
            onPress={() => router.push('/(app)/(tabs)/family/new')}
          />
        )}
      </View>

      {canManageMembers(role) && (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Invite someone</Text>

          <View style={styles.choices}>
            {offerable.map((option) => {
              const selected = option === invitedRole;
              return (
                <Pressable
                  key={option}
                  onPress={() => setInvitedRole(option)}
                  disabled={inviting}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`Invite as ${ROLE_LABELS[option]}`}
                  style={({ pressed }) => [
                    styles.choice,
                    selected && styles.choiceSelected,
                    pressed && styles.choicePressed,
                  ]}
                >
                  <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>
                    {ROLE_LABELS[option]}
                  </Text>
                </Pressable>
              );
            })}
          </View>

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

function MemberRow({ member, isYou }: { member: Member; isYou: boolean }) {
  // Account holders and relatives with no login are one list, not two. The
  // difference is a quiet subtitle — a person who never signs in is no less a
  // member of the family.
  //
  // Read from the label map rather than a ternary: the ternary this replaces
  // rendered every admin and every guest as "Member", and would have gone on
  // doing so silently for every role a later phase adds.
  const detail = member.role ? ROLE_LABELS[member.role] : 'No account';

  return (
    <Pressable
      onPress={() => router.push(`/(app)/(tabs)/family/${member.id}`)}
      accessibilityRole="button"
      accessibilityLabel={`Edit ${member.displayName}`}
      style={({ pressed }) => [styles.memberRow, pressed && styles.memberRowPressed]}
    >
      <View style={styles.avatar}>
        <Ionicons name="person-outline" size={18} color={theme.colors.primary} />
      </View>
      <View style={styles.memberText}>
        <Text style={styles.memberName} numberOfLines={1}>
          {member.displayName}
          {isYou ? ' (you)' : ''}
        </Text>
        <Text style={styles.memberDetail}>{detail}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
    </Pressable>
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
  choices: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  choice: {
    minHeight: theme.touchTarget,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  choiceSelected: {
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.primarySoft,
  },
  choiceText: {
    fontSize: theme.typography.body,
    color: theme.colors.text,
  },
  choiceTextSelected: {
    fontWeight: '700',
    color: theme.colors.primary,
  },
  choicePressed: {
    opacity: 0.7,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    minHeight: theme.touchTarget,
  },
  memberRowPressed: {
    opacity: 0.6,
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
  memberName: {
    fontSize: theme.typography.body,
    fontWeight: '600',
    color: theme.colors.text,
  },
  memberDetail: {
    fontSize: theme.typography.caption,
    color: theme.colors.textMuted,
  },
});
