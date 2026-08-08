import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '../../../src/components/Button';
import { EmptyState } from '../../../src/components/EmptyState';
import { LockedNotice } from '../../../src/components/LockedNotice';
import { Screen } from '../../../src/components/Screen';
import { TextField } from '../../../src/components/TextField';
import { formatRelativeTime } from '../../../src/lib/relativeTime';
import { getSupabase } from '../../../src/lib/supabase';
import { TAB_DOMAINS } from '../../../src/navigation/domains';
import { useFamily } from '../../../src/providers/FamilyProvider';
import {
  createDocument,
  createSupabaseDocumentGateway,
  deleteDocument,
  describeDocumentSubject,
  listDocuments,
  partitionDocuments,
  setDocumentArchived,
  MAX_DOCUMENT_TITLE_LENGTH,
  type FamilyDocument,
} from '../../../src/services/document';
import { createSupabaseMemberGateway, listMembers, type Member } from '../../../src/services/member';
import { canReadRecords, canWriteRecords } from '../../../src/services/role';
import { theme } from '../../../src/theme';

const domain = TAB_DOMAINS.find((entry) => entry.id === 'documents')!;

export default function DocumentsScreen() {
  const { family, role, loading } = useFamily();

  if (loading) {
    return (
      <Screen title={domain.label} subtitle={domain.summary}>
        <ActivityIndicator color={theme.colors.primary} />
      </Screen>
    );
  }

  if (!family) {
    return (
      <Screen title={domain.label} subtitle={domain.summary}>
        <EmptyState
          icon={domain.icon}
          title="No family yet"
          body="Documents belong to a family. Create or join one first, and this is where its papers will live."
        />
      </Screen>
    );
  }

  // Asked before the query, not after it. RLS *filters* rather than errors, so
  // a Guest's read succeeds and returns nothing — the same answer a family with
  // no documents gives. The role is the only thing that can tell them apart.
  if (!canReadRecords(role)) {
    return (
      <Screen title={domain.label} subtitle={domain.summary}>
        <LockedNotice body="Documents are not shared with guests. Ask an owner or admin if you need access to something here." />
      </Screen>
    );
  }

  return <DocumentLibrary familyId={family.id} canFile={canWriteRecords(role)} />;
}

function DocumentLibrary({ familyId, canFile }: { familyId: string; canFile: boolean }) {
  const [documents, setDocuments] = useState<FamilyDocument[]>([]);
  const [people, setPeople] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const load = useCallback(async () => {
    const client = getSupabase();

    const result = await listDocuments(createSupabaseDocumentGateway(client), familyId);
    if (!result.ok) {
      // Not the Guest case — that is handled by the role check above, because a
      // filtered read is not a failed one. This branch is a real failure: a
      // missing grant, an expired session, or no network.
      setError(result.message);
      setDocuments([]);
    } else {
      setError(null);
      setDocuments(result.documents);
    }

    // Returns [] on failure rather than throwing — a Guest cannot read this
    // either, and a document list with unnamed subjects is still worth showing.
    setPeople(await listMembers(createSupabaseMemberGateway(client), familyId));

    setLoading(false);
  }, [familyId]);

  // Refetch on focus rather than on mount: filing a document and coming back
  // should show it, and there is no realtime subscription in this phase.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const peopleById = new Map(people.map((person) => [person.id, person.displayName]));
  const { active, archived } = partitionDocuments(documents);

  if (loading) {
    return (
      <Screen title={domain.label} subtitle={domain.summary}>
        <ActivityIndicator color={theme.colors.primary} />
      </Screen>
    );
  }

  return (
    <Screen title={domain.label} subtitle={domain.summary}>
      {canFile ? <FileDocument familyId={familyId} onFiled={load} /> : null}

      {error ? (
        <View style={styles.notice}>
          <Ionicons name="alert-circle-outline" size={18} color={theme.colors.error} />
          <Text style={styles.noticeText}>{error}</Text>
        </View>
      ) : null}

      {!error && active.length === 0 ? (
        <EmptyState
          icon={domain.icon}
          title="Nothing filed yet"
          body="Passports, policies, deeds, certificates and warranties — filed by what they mean rather than where they happened to be saved."
        />
      ) : null}

      {active.map((document) => (
        <DocumentCard
          key={document.id}
          document={document}
          peopleById={peopleById}
          onArchive={canFile ? () => void archiveThen(document, true, load) : undefined}
        />
      ))}

      {archived.length > 0 ? (
        <>
          <Pressable
            onPress={() => setShowArchived((shown) => !shown)}
            style={styles.archiveToggle}
            accessibilityRole="button"
          >
            <Text style={styles.archiveToggleText}>
              {showArchived ? 'Hide' : 'Show'} archived ({archived.length})
            </Text>
            <Ionicons
              name={showArchived ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={theme.colors.textMuted}
            />
          </Pressable>

          {showArchived
            ? archived.map((document) => (
                <DocumentCard
                  key={document.id}
                  document={document}
                  peopleById={peopleById}
                  onRestore={canFile ? () => void archiveThen(document, false, load) : undefined}
                  onDelete={canFile ? () => confirmDelete(document, load) : undefined}
                />
              ))
            : null}
        </>
      ) : null}
    </Screen>
  );
}

async function archiveThen(
  document: FamilyDocument,
  archived: boolean,
  reload: () => Promise<void>,
): Promise<void> {
  await setDocumentArchived(
    createSupabaseDocumentGateway(getSupabase()),
    document.id,
    archived,
  );
  await reload();
}

/**
 * Delete is offered on archived documents only, and behind a confirmation.
 *
 * Two steps rather than one because this is a hard delete — `deleted_at`
 * exists on the row but nothing sets it, since soft delete without a restore
 * screen would be a column nobody can reach. Archiving first means the
 * destructive action is never one mis-tap away from a document in daily use,
 * and the copy says "cannot be undone" because it cannot.
 */
function confirmDelete(document: FamilyDocument, reload: () => Promise<void>): void {
  Alert.alert(
    `Delete ${document.title}?`,
    'This cannot be undone.',
    [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            await deleteDocument(createSupabaseDocumentGateway(getSupabase()), document.id);
            await reload();
          })();
        },
      },
    ],
  );
}

function DocumentCard({
  document,
  peopleById,
  onArchive,
  onRestore,
  onDelete,
}: {
  document: FamilyDocument;
  peopleById: Map<string, string>;
  onArchive?: () => void;
  onRestore?: () => void;
  onDelete?: () => void;
}) {
  return (
    <View style={[styles.card, document.archivedAt ? styles.cardArchived : null]}>
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle}>{document.title}</Text>

        {/*
          Subject and age, never a filename or a byte count. docs/10 §13:
          "context is more valuable than filenames". There are no files at all
          until PR-14, and even then this line should not become "1 file, 2.4MB".
        */}
        <Text style={styles.cardMeta}>
          {describeDocumentSubject(document, peopleById)} · {formatRelativeTime(document.createdAt)}
        </Text>

        <View style={styles.badges}>
          {document.visibility === 'private' ? (
            <View style={styles.badge}>
              <Ionicons name="eye-off-outline" size={12} color={theme.colors.textMuted} />
              <Text style={styles.badgeText}>Private</Text>
            </View>
          ) : null}
          {document.aiProcessing === 'allowed' ? (
            <View style={styles.badge}>
              <Ionicons name="sparkles-outline" size={12} color={theme.colors.textMuted} />
              <Text style={styles.badgeText}>AI may read</Text>
            </View>
          ) : null}
        </View>
      </View>

      {onArchive ? (
        <Pressable onPress={onArchive} accessibilityRole="button" accessibilityLabel="Archive">
          <Ionicons name="archive-outline" size={20} color={theme.colors.textMuted} />
        </Pressable>
      ) : null}
      {onRestore ? (
        <Pressable onPress={onRestore} accessibilityRole="button" accessibilityLabel="Restore">
          <Ionicons name="arrow-undo-outline" size={20} color={theme.colors.textMuted} />
        </Pressable>
      ) : null}
      {onDelete ? (
        <Pressable onPress={onDelete} accessibilityRole="button" accessibilityLabel="Delete">
          <Ionicons name="trash-outline" size={20} color={theme.colors.error} />
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * Filing a document with no file attached is the honest shape of this PR.
 *
 * A record can exist before its scan does — a passport you know the number of
 * but have not photographed yet is still worth recording — so this is not a
 * placeholder for upload so much as the thing upload will later attach to.
 */
function FileDocument({ familyId, onFiled }: { familyId: string; onFiled: () => Promise<void> }) {
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile() {
    setBusy(true);
    setError(null);
    try {
      const result = await createDocument(createSupabaseDocumentGateway(getSupabase()), {
        familyId,
        title,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setTitle('');
      await onFiled();
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.form}>
      <TextField
        label="File a document"
        value={title}
        onChangeText={setTitle}
        placeholder="Dad's Passport"
        maxLength={MAX_DOCUMENT_TITLE_LENGTH}
        editable={!busy}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button label="File it" onPress={handleFile} busy={busy} disabled={busy} />
    </View>
  );
}

const styles = StyleSheet.create({
  form: {
    marginBottom: theme.spacing.lg,
  },
  error: {
    color: theme.colors.error,
    fontSize: theme.typography.caption,
    marginBottom: theme.spacing.sm,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    backgroundColor: theme.colors.surfaceSunken,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
  },
  noticeText: {
    flex: 1,
    color: theme.colors.textMuted,
    fontSize: theme.typography.caption,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
  cardArchived: {
    backgroundColor: theme.colors.surfaceSunken,
  },
  cardBody: {
    flex: 1,
    gap: 2,
  },
  cardTitle: {
    color: theme.colors.text,
    fontSize: theme.typography.body,
    fontWeight: '600',
  },
  cardMeta: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.caption,
  },
  badges: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.xs,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  badgeText: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.caption,
  },
  archiveToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.xs,
    paddingVertical: theme.spacing.md,
  },
  archiveToggleText: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.caption,
  },
});
