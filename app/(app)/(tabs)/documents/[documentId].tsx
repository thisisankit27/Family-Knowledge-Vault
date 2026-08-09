import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '../../../../src/components/Button';
import { LockedNotice } from '../../../../src/components/LockedNotice';
import { TextField } from '../../../../src/components/TextField';
import { formatRelativeTime } from '../../../../src/lib/relativeTime';
import { getSupabase } from '../../../../src/lib/supabase';
import { useAuth } from '../../../../src/providers/AuthProvider';
import { useFamily } from '../../../../src/providers/FamilyProvider';
import {
  CATEGORY_HINTS,
  CATEGORY_LABELS,
  DOCUMENT_CATEGORIES,
  createSupabaseDocumentGateway,
  deleteDocument,
  describeDocumentAuthor,
  describeDocumentSubject,
  getDocument,
  renameDocument,
  setDocumentAiProcessing,
  setDocumentArchived,
  setDocumentCategory,
  setDocumentMember,
  MAX_DOCUMENT_TITLE_LENGTH,
  type DocumentCategory,
  type FamilyDocument,
} from '../../../../src/services/document';
import { createSupabaseMemberGateway, listMembers, type Member } from '../../../../src/services/member';
import { canWriteRecords } from '../../../../src/services/role';
import { theme } from '../../../../src/theme';

/**
 * One document, and everything that can be done to it without a file.
 *
 * This screen exists because PR-13 was originally "Viewer — open a document",
 * scheduled *before* upload, so there was nothing to open. FR-014's six actions
 * split cleanly: Preview and Download need bytes, while Rename, Move, Archive
 * and Delete need only the record. Those four live here; the first two join in
 * PR-14 and will slot into this screen rather than needing a new one.
 *
 * It is also where `category` and `ai_processing` finally get controls, both
 * having shipped as columns with policies, tests and no way to change them.
 *
 * `visibility` deliberately has no control. Every document is private and only
 * its author can read it, so there is nothing to choose; the toggle that used
 * to be here was removed with 20260810090000 rather than left offering a
 * setting that would publish a document before sharing has been designed.
 * PR-15 brings it back with a model behind it.
 */
export default function DocumentDetailScreen() {
  const { documentId } = useLocalSearchParams<{ documentId: string }>();
  const { family, role } = useFamily();
  const { session } = useAuth();
  const canEdit = canWriteRecords(role);
  const familyId = family?.id ?? null;

  const [document, setDocument] = useState<FamilyDocument | null>(null);
  const [people, setPeople] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const client = getSupabase();
    const result = await getDocument(createSupabaseDocumentGateway(client), documentId);

    if (!result.ok) {
      setError(result.message);
      setDocument(null);
    } else {
      setError(null);
      setDocument(result.document);
      // The subject's name comes from the family's member list, not from the
      // document — a row stores an id, so the name is always the current one.
      if (familyId) {
        setPeople(await listMembers(createSupabaseMemberGateway(client), familyId));
      }
    }

    setLoading(false);
  }, [documentId, familyId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (loading) {
    return (
      <View style={styles.centred}>
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    );
  }

  if (error || !document) {
    return (
      <ScrollView contentContainerStyle={styles.screen}>
        <LockedNotice body={error ?? 'That document is no longer available.'} />
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Title document={document} canEdit={canEdit} onSaved={load} />

      <Field label="Belongs to">
        {canEdit ? (
          <SubjectPicker document={document} people={people} onSaved={load} />
        ) : (
          <Text style={styles.value}>
            {describeDocumentSubject(document, new Map(people.map((p) => [p.id, p.displayName])))}
          </Text>
        )}
      </Field>

      <Field label="Filed under">
        {canEdit ? (
          <CategoryPicker document={document} onSaved={load} />
        ) : (
          <Text style={styles.value}>{CATEGORY_LABELS[document.category]}</Text>
        )}
      </Field>

      <Field label="AI">
        <Toggle
          on={document.aiProcessing === 'allowed'}
          label="Let AI read this"
          // Deliberately not "AI cannot see this". The server can read the
          // bytes; this is a promise kept by code. The control that would be a
          // guarantee is Phase 11's encryption, and it is a different thing.
          hint="Used later to search and organise. Nothing reads it yet."
          disabled={!canEdit}
          onToggle={(next) =>
            void save(
              () =>
                setDocumentAiProcessing(
                  createSupabaseDocumentGateway(getSupabase()),
                  document.id,
                  next ? 'allowed' : 'denied',
                ),
              load,
              setError,
            )
          }
        />
      </Field>

      <Field label="Filed by">
        {/*
          Two different people, and the reason this line exists: `created_by` is
          who filed it, `member_id` is whose it is. With four passports in a
          house, "About" is what makes the library usable and this is provenance.
        */}
        <Text style={styles.value}>
          {describeDocumentAuthor(document, people, session?.user.id ?? null)} ·{' '}
          {formatRelativeTime(document.createdAt)}
        </Text>
      </Field>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {canEdit ? (
        <View style={styles.actions}>
          <Button
            label={document.archivedAt ? 'Restore' : 'Archive'}
            variant="quiet"
            onPress={() =>
              void save(
                () =>
                  setDocumentArchived(
                    createSupabaseDocumentGateway(getSupabase()),
                    document.id,
                    !document.archivedAt,
                  ),
                load,
                setError,
              )
            }
          />

          {/*
            Delete stays behind archiving, as it was on the card: it is a hard
            delete, `deleted_at` is set by nothing, and the copy says so.
          */}
          {document.archivedAt ? (
            <Pressable onPress={() => confirmDelete(document)} accessibilityRole="button">
              <Text style={styles.delete}>Delete permanently</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </ScrollView>
  );
}

/** Runs a service call, surfaces its message, and reloads on success. */
async function save(
  action: () => Promise<{ ok: true } | { ok: false; message: string }>,
  reload: () => Promise<void>,
  onError: (message: string | null) => void,
): Promise<void> {
  const result = await action();
  if (!result.ok) {
    onError(result.message);
    return;
  }
  onError(null);
  await reload();
}

function confirmDelete(document: FamilyDocument): void {
  Alert.alert(`Delete ${document.title}?`, 'This cannot be undone.', [
    { text: 'Keep it', style: 'cancel' },
    {
      text: 'Delete',
      style: 'destructive',
      onPress: () => {
        void (async () => {
          const result = await deleteDocument(
            createSupabaseDocumentGateway(getSupabase()),
            document.id,
          );
          // Back to the library either way — the document is gone, and there is
          // nothing left on this screen to look at.
          if (result.ok) router.back();
        })();
      },
    },
  ]);
}

/**
 * The title, editable in place.
 *
 * A separate mode rather than a live-saving field: renaming is deliberate, and
 * a text input that writes on every keystroke would produce a row of activity
 * entries for one edit.
 */
function Title({
  document,
  canEdit,
  onSaved,
}: {
  document: FamilyDocument;
  canEdit: boolean;
  onSaved: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(document.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!editing) {
    return (
      <View style={styles.titleRow}>
        <Text style={styles.title}>{document.title}</Text>
        {canEdit ? (
          <Pressable
            onPress={() => {
              setDraft(document.title);
              setEditing(true);
            }}
            accessibilityRole="button"
            accessibilityLabel="Rename"
          >
            <Ionicons name="pencil-outline" size={20} color={theme.colors.textMuted} />
          </Pressable>
        ) : null}
      </View>
    );
  }

  async function handleSave() {
    setBusy(true);
    try {
      const result = await renameDocument(
        createSupabaseDocumentGateway(getSupabase()),
        document.id,
        draft,
      );
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setError(null);
      setEditing(false);
      await onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.titleEdit}>
      <TextField
        label="Name"
        value={draft}
        onChangeText={setDraft}
        maxLength={MAX_DOCUMENT_TITLE_LENGTH}
        editable={!busy}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.titleButtons}>
        <Button label="Save" onPress={handleSave} busy={busy} disabled={busy} />
        <Button
          label="Cancel"
          variant="quiet"
          onPress={() => {
            setError(null);
            setEditing(false);
          }}
        />
      </View>
    </View>
  );
}

/**
 * Whose document this is.
 *
 * "The whole family" is offered first and is a real answer, not an escape
 * hatch: a deed or a utility connection belongs to no one person, and forcing
 * it onto somebody would be worse than leaving it unattributed.
 */
function SubjectPicker({
  document,
  people,
  onSaved,
}: {
  document: FamilyDocument;
  people: Member[];
  onSaved: () => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);

  async function choose(memberId: string | null) {
    if (memberId === document.memberId) return;
    const result = await setDocumentMember(
      createSupabaseDocumentGateway(getSupabase()),
      document.id,
      memberId,
    );
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setError(null);
    await onSaved();
  }

  return (
    <>
      <View style={styles.picker}>
        <Pressable
          onPress={() => void choose(null)}
          style={[styles.chip, document.memberId === null ? styles.chipActive : null]}
          accessibilityRole="button"
          accessibilityState={{ selected: document.memberId === null }}
        >
          <Text
            style={[
              styles.chipText,
              document.memberId === null ? styles.chipTextActive : null,
            ]}
          >
            The whole family
          </Text>
        </Pressable>

        {people.map((person) => {
          const active = person.id === document.memberId;
          return (
            <Pressable
              key={person.id}
              onPress={() => void choose(person.id)}
              style={[styles.chip, active ? styles.chipActive : null]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.chipText, active ? styles.chipTextActive : null]}>
                {person.displayName}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/*
        This sentence is the fix for the confusion that caused the bug. Until
        20260810090000 this field granted read *and* write to whoever it named;
        saying plainly that it no longer does is cheaper than letting the next
        person rediscover it the way this one was discovered.
      */}
      <Text style={styles.hint}>
        Just a label. It does not change who can open this — only you can.
      </Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </>
  );
}

function CategoryPicker({
  document,
  onSaved,
}: {
  document: FamilyDocument;
  onSaved: () => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);

  async function choose(category: DocumentCategory) {
    if (category === document.category) return;
    const result = await setDocumentCategory(
      createSupabaseDocumentGateway(getSupabase()),
      document.id,
      category,
    );
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setError(null);
    await onSaved();
  }

  return (
    <>
      <View style={styles.picker}>
        {DOCUMENT_CATEGORIES.map((option) => {
          const active = option === document.category;
          return (
            <Pressable
              key={option}
              onPress={() => void choose(option)}
              style={[styles.chip, active ? styles.chipActive : null]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.chipText, active ? styles.chipTextActive : null]}>
                {CATEGORY_LABELS[option]}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.hint}>{CATEGORY_HINTS[document.category]}</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

function Toggle({
  on,
  label,
  hint,
  disabled,
  onToggle,
}: {
  on: boolean;
  label: string;
  hint: string;
  disabled?: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <Pressable
      onPress={() => !disabled && onToggle(!on)}
      style={styles.toggle}
      accessibilityRole="switch"
      accessibilityState={{ checked: on, disabled }}
    >
      <Ionicons
        name={on ? 'checkbox' : 'square-outline'}
        size={22}
        color={on ? theme.colors.primary : theme.colors.textMuted}
      />
      <View style={styles.toggleText}>
        <Text style={styles.value}>{label}</Text>
        <Text style={styles.hint}>{hint}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.xxl,
  },
  centred: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    marginBottom: theme.spacing.lg,
  },
  title: {
    flex: 1,
    color: theme.colors.text,
    fontSize: theme.typography.heading,
    fontWeight: '600',
  },
  titleEdit: {
    marginBottom: theme.spacing.lg,
  },
  titleButtons: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  field: {
    marginBottom: theme.spacing.lg,
  },
  label: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.caption,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: theme.spacing.sm,
  },
  value: {
    color: theme.colors.text,
    fontSize: theme.typography.body,
  },
  hint: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.caption,
    marginTop: 2,
  },
  picker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
  },
  chip: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  chipActive: {
    backgroundColor: theme.colors.primarySoft,
    borderColor: theme.colors.primary,
  },
  chipText: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.caption,
  },
  chipTextActive: {
    color: theme.colors.primary,
    fontWeight: '600',
  },
  toggle: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.sm,
  },
  toggleText: {
    flex: 1,
  },
  actions: {
    gap: theme.spacing.md,
    marginTop: theme.spacing.md,
  },
  delete: {
    color: theme.colors.error,
    fontSize: theme.typography.body,
    textAlign: 'center',
    paddingVertical: theme.spacing.sm,
  },
  error: {
    color: theme.colors.error,
    fontSize: theme.typography.caption,
    marginBottom: theme.spacing.sm,
  },
});
