import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '../../../../../src/components/Button';
import {
  MemoryAiConsentField,
  MemoryDateField,
  MemorySubjectField,
  MemoryVisibilityField,
} from '../../../../../src/components/MemoryFields';
import { TextField } from '../../../../../src/components/TextField';
import { formatRelativeTime } from '../../../../../src/lib/relativeTime';
import { getSupabase } from '../../../../../src/lib/supabase';
import { useAuth } from '../../../../../src/providers/AuthProvider';
import { useFamily } from '../../../../../src/providers/FamilyProvider';
import {
  createSupabaseMemberGateway,
  listMembers,
  type Member,
} from '../../../../../src/services/member';
import {
  AI_PROCESSING_LABELS,
  VISIBILITY_LABELS,
  createSupabaseMemoryGateway,
  deleteMemory,
  describeMemoryAuthor,
  describeMemoryDate,
  describeMemorySubject,
  formatOccurredOnInput,
  getMemory,
  renameMemory,
  setMemoryAiProcessing,
  setMemoryArchived,
  setMemoryDate,
  setMemoryLocation,
  setMemoryMember,
  setMemoryStory,
  setMemoryVisibility,
  type FamilyMemory,
  type MemoryPrecision,
} from '../../../../../src/services/memory';
import { canWriteRecords } from '../../../../../src/services/role';
import { theme } from '../../../../../src/theme';

/**
 * One memory, and everything that can be done to it.
 *
 * **Two audiences, and the difference is the point.** Memories default to
 * `family`, so unlike documents the common case here is a reader who did not
 * write this. The author gets controls; everybody else gets the decisions, as
 * sentences. Never a disabled control — it asks a question, shows an answer, and
 * refuses the interaction it just invited (`docs/16`, found on a device in
 * PR-15a).
 *
 * Saving is per field, immediately, with no Save button and no dirty state —
 * except for the free-text fields, which commit on an explicit Save so that
 * writing a paragraph does not mean one write per keystroke.
 */
export default function MemoryScreen() {
  const { memoryId } = useLocalSearchParams<{ memoryId: string }>();
  const { family, role } = useFamily();
  const { session } = useAuth();

  const [memory, setMemory] = useState<FamilyMemory | null>(null);
  const [people, setPeople] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const familyId = family?.id ?? null;

  const load = useCallback(async () => {
    const client = getSupabase();
    const outcome = await getMemory(createSupabaseMemoryGateway(client), memoryId);

    if (!outcome.ok) {
      setError(outcome.message);
      setMemory(null);
    } else {
      setError(null);
      setMemory(outcome.memory);
      // The family comes from context rather than the row: `FamilyMemory` does
      // not carry `family_id`, for the same reason `FamilyDocument` does not —
      // a screen that can reach a memory is already inside the family that owns
      // it, and putting the tenant on every record type invites a caller to
      // trust it instead of the policy.
      if (familyId) {
        setPeople(await listMembers(createSupabaseMemberGateway(client), familyId));
      }
    }

    setLoading(false);
  }, [memoryId, familyId]);

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

  if (!memory) {
    return (
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.error}>{error ?? 'That memory is no longer available.'}</Text>
      </ScrollView>
    );
  }

  // Was `canWriteRecords(role)` alone on the documents screen, and that was
  // wrong the moment sharing made "somebody else's record in front of you" a
  // reachable state. Memories start in that state, so the authorship half is
  // load-bearing from the first render rather than after a later PR.
  const isAuthor = memory.createdBy !== null && memory.createdBy === session?.user.id;
  const canEdit = isAuthor && canWriteRecords(role);

  const peopleById = new Map(people.map((person) => [person.id, person.displayName]));

  const confirmDelete = () => {
    Alert.alert(
      'Delete this memory?',
      'This cannot be undone. The story and everything recorded with it will be gone.',
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              const outcome = await deleteMemory(
                createSupabaseMemoryGateway(getSupabase()),
                memory.id,
              );
              if (!outcome.ok) {
                setError(outcome.message);
                return;
              }
              router.back();
            })();
          },
        },
      ],
    );
  };

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <EditableText
        label="What happened"
        value={memory.title}
        canEdit={canEdit}
        multiline={false}
        emptyText=""
        onSave={(next) =>
          renameMemory(createSupabaseMemoryGateway(getSupabase()), memory.id, next)
        }
        reload={load}
        onError={setError}
        render={(value) => <Text style={styles.title}>{value}</Text>}
      />

      <Text style={styles.provenance}>
        Kept by {describeMemoryAuthor(memory, people, session?.user.id ?? null)} ·{' '}
        {formatRelativeTime(memory.createdAt)}
      </Text>

      <EditableText
        label="The story"
        value={memory.story ?? ''}
        canEdit={canEdit}
        multiline
        emptyText="No story written yet."
        onSave={(next) =>
          setMemoryStory(createSupabaseMemoryGateway(getSupabase()), memory.id, next)
        }
        reload={load}
        onError={setError}
        render={(value) => <Text style={styles.story}>{value}</Text>}
      />

      <Field label="When">
        {canEdit ? (
          <DateEditor memory={memory} reload={load} onError={setError} />
        ) : (
          <Text style={styles.value}>{describeMemoryDate(memory)}</Text>
        )}
      </Field>

      <EditableText
        label="Where"
        value={memory.location ?? ''}
        canEdit={canEdit}
        multiline={false}
        emptyText="Not recorded."
        onSave={(next) =>
          setMemoryLocation(createSupabaseMemoryGateway(getSupabase()), memory.id, next)
        }
        reload={load}
        onError={setError}
        render={(value) => <Text style={styles.value}>{value}</Text>}
      />

      <Field label="Who it is about">
        {canEdit ? (
          <MemorySubjectField
            value={memory.memberId}
            people={people}
            onChange={(next) =>
              void save(
                () => setMemoryMember(createSupabaseMemoryGateway(getSupabase()), memory.id, next),
                load,
                setError,
              )
            }
          />
        ) : (
          <Text style={styles.value}>{describeMemorySubject(memory, peopleById)}</Text>
        )}
      </Field>

      <Field label="Who can see it">
        {canEdit ? (
          <MemoryVisibilityField
            value={memory.visibility}
            onChange={(next) =>
              void save(
                () =>
                  setMemoryVisibility(createSupabaseMemoryGateway(getSupabase()), memory.id, next),
                load,
                setError,
              )
            }
          />
        ) : (
          // A reader is told, not asked. Naming the author's choice is more
          // useful than a greyed-out control they cannot move.
          <Text style={styles.value}>{VISIBILITY_LABELS[memory.visibility]}</Text>
        )}
      </Field>

      <Field label="AI">
        <MemoryAiConsentField
          value={memory.aiProcessing}
          onChange={(next) =>
            void save(
              () =>
                setMemoryAiProcessing(createSupabaseMemoryGateway(getSupabase()), memory.id, next),
              load,
              setError,
            )
          }
          readOnly={!canEdit}
        />
      </Field>

      {canEdit ? (
        <View style={styles.actions}>
          <Pressable
            onPress={() =>
              void save(
                () =>
                  setMemoryArchived(
                    createSupabaseMemoryGateway(getSupabase()),
                    memory.id,
                    !memory.archivedAt,
                  ),
                load,
                setError,
              )
            }
            style={styles.action}
            accessibilityRole="button"
          >
            <Ionicons name="archive-outline" size={18} color={theme.colors.textMuted} />
            <Text style={styles.actionText}>
              {memory.archivedAt ? 'Bring it back' : 'Archive it'}
            </Text>
          </Pressable>

          <Pressable onPress={confirmDelete} style={styles.action} accessibilityRole="button">
            <Ionicons name="trash-outline" size={18} color={theme.colors.error} />
            <Text style={[styles.actionText, styles.actionDanger]}>Delete</Text>
          </Pressable>
        </View>
      ) : null}
    </ScrollView>
  );
}

/**
 * Run a save, surface the failure, and reload either way.
 *
 * The reload is unconditional on success and the error is cleared before it,
 * which is what keeps the screen honest when two fields are changed quickly.
 */
async function save(
  action: () => Promise<{ ok: true } | { ok: false; message: string }>,
  reload: () => Promise<void>,
  onError: (message: string | null) => void,
): Promise<void> {
  const outcome = await action();
  if (!outcome.ok) {
    onError(outcome.message);
    return;
  }
  onError(null);
  await reload();
}

/**
 * A block of text that becomes a field when its owner taps it.
 *
 * Not live-saving, deliberately: a story is written a sentence at a time, and
 * one write per keystroke would put a hundred rows through the update policy and
 * — once Phase 7 adds a feed — a hundred entries in it.
 */
function EditableText({
  label,
  value,
  canEdit,
  multiline,
  emptyText,
  onSave,
  reload,
  onError,
  render,
}: {
  label: string;
  value: string;
  canEdit: boolean;
  multiline: boolean;
  emptyText: string;
  onSave: (next: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  reload: () => Promise<void>;
  onError: (message: string | null) => void;
  render: (value: string) => ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);

  if (editing) {
    return (
      <Field label={label}>
        <TextField
          label={label}
          value={draft}
          onChangeText={setDraft}
          multiline={multiline}
          numberOfLines={multiline ? 6 : 1}
          style={multiline ? styles.storyInput : undefined}
          textAlignVertical={multiline ? 'top' : 'center'}
          editable={!busy}
          autoFocus
        />
        <View style={styles.editActions}>
          <Button
            label="Save"
            busy={busy}
            onPress={() => {
              void (async () => {
                setBusy(true);
                const outcome = await onSave(draft);
                setBusy(false);
                if (!outcome.ok) {
                  onError(outcome.message);
                  return;
                }
                onError(null);
                setEditing(false);
                await reload();
              })();
            }}
          />
          <Button
            label="Cancel"
            variant="quiet"
            onPress={() => {
              setDraft(value);
              setEditing(false);
            }}
          />
        </View>
      </Field>
    );
  }

  return (
    <Field label={label}>
      <Pressable
        onPress={() => {
          if (!canEdit) return;
          setDraft(value);
          setEditing(true);
        }}
        accessibilityRole={canEdit ? 'button' : undefined}
        accessibilityHint={canEdit ? `Edit ${label.toLowerCase()}` : undefined}
      >
        {value ? render(value) : <Text style={styles.empty}>{emptyText}</Text>}
      </Pressable>
    </Field>
  );
}

/**
 * The date and its precision, changed together and saved together.
 *
 * They are one fact: a row claiming day precision over a date carrying only a
 * year would be a lie the schema permits, so `setMemoryDate` writes both in one
 * statement and this commits both at once.
 */
function DateEditor({
  memory,
  reload,
  onError,
}: {
  memory: FamilyMemory;
  reload: () => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const [text, setText] = useState(formatOccurredOnInput(memory));
  const [precision, setPrecision] = useState<MemoryPrecision | null>(
    memory.occurredOn ? memory.occurredPrecision : null,
  );
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const dirty =
    text !== formatOccurredOnInput(memory) ||
    precision !== (memory.occurredOn ? memory.occurredPrecision : null);

  return (
    <>
      <MemoryDateField
        text={text}
        precision={precision}
        onChange={(next) => {
          setText(next.text);
          setPrecision(next.precision);
          setFieldError(undefined);
        }}
        error={fieldError}
        disabled={busy}
      />

      {dirty ? (
        <Button
          label="Save the date"
          busy={busy}
          onPress={() => {
            void (async () => {
              setBusy(true);
              const outcome = await setMemoryDate(
                createSupabaseMemoryGateway(getSupabase()),
                memory.id,
                // An unknown date clears the column; the precision the row keeps
                // is irrelevant while `occurred_on` is null, so the last one
                // chosen is as good as any.
                precision ? text : '',
                precision ?? memory.occurredPrecision,
              );
              setBusy(false);
              if (!outcome.ok) {
                setFieldError(outcome.message);
                return;
              }
              onError(null);
              await reload();
            })();
          }}
        />
      ) : null}
    </>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  centre: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.background,
  },
  content: {
    padding: theme.spacing.lg,
    gap: theme.spacing.lg,
    paddingBottom: theme.spacing.xxl,
  },
  title: {
    color: theme.colors.text,
    fontSize: theme.typography.title,
    fontWeight: '700',
  },
  provenance: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.caption,
    marginTop: -theme.spacing.md,
  },
  story: {
    color: theme.colors.text,
    fontSize: theme.typography.body,
    lineHeight: 24,
  },
  storyInput: {
    minHeight: 140,
  },
  value: {
    color: theme.colors.text,
    fontSize: theme.typography.body,
  },
  empty: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.body,
    fontStyle: 'italic',
  },
  error: {
    color: theme.colors.error,
    fontSize: theme.typography.caption,
  },
  field: {
    gap: theme.spacing.sm,
  },
  fieldLabel: {
    fontSize: theme.typography.caption,
    textTransform: 'uppercase',
    letterSpacing: 1,
    color: theme.colors.textMuted,
  },
  editActions: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    gap: theme.spacing.lg,
    marginTop: theme.spacing.md,
    paddingTop: theme.spacing.md,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    paddingVertical: theme.spacing.sm,
  },
  actionText: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.body,
  },
  actionDanger: {
    color: theme.colors.error,
  },
});
