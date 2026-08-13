import { Ionicons } from '@expo/vector-icons';
import { File as DeviceFile } from 'expo-file-system';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '../../../../../src/components/Button';
import { ProgressBar } from '../../../../../src/components/ProgressBar';
import { LockedNotice } from '../../../../../src/components/LockedNotice';
import { TextField } from '../../../../../src/components/TextField';
import {
  AiConsentField,
  CategoryField,
  SubjectField,
  VisibilityField,
} from '../../../../../src/components/DocumentFields';
import { FileSourcePicker } from '../../../../../src/components/FileSourcePicker';
import { formatRelativeTime } from '../../../../../src/lib/relativeTime';
import { getSupabaseEnv } from '../../../../../src/lib/env';
import { getSupabase } from '../../../../../src/lib/supabase';
import { useAuth } from '../../../../../src/providers/AuthProvider';
import { useFamily } from '../../../../../src/providers/FamilyProvider';
import {
  AI_PROCESSING_LABELS,
  CATEGORY_LABELS,
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
  setDocumentVisibility,
  MAX_DOCUMENT_TITLE_LENGTH,
  VISIBILITY_LABELS,
  type FamilyDocument,
} from '../../../../../src/services/document';
import {
  describeAttachmentFailures,
  type FailedAttachment,
  type FilingProgress,
} from '../../../../../src/services/filing';
import { createSupabaseMemberGateway, listMembers, type Member } from '../../../../../src/services/member';
import {
  createSupabaseStorageGateway,
  formatBytes,
  listDocumentFiles,
  uploadDocumentFile,
  type DocumentFile,
  type UploadCandidate,
} from '../../../../../src/services/storage';
import { canWriteRecords } from '../../../../../src/services/role';
import { theme } from '../../../../../src/theme';

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
 * **`visibility` now has one too.** It was removed with 20260810090000 rather
 * than left offering a setting that would publish a document before sharing had
 * been designed; 20260813090000 designed it, so the control is back and the
 * model behind it is one sentence: reading widens, writing never does.
 *
 * That sentence is also why this screen changed shape. Until sharing existed,
 * every document you could open was one you had filed, so "may I edit this" was
 * safely a question about your *role*. It is not any more — see `canEdit` below.
 */
export default function DocumentDetailScreen() {
  const { documentId, notice } = useLocalSearchParams<{
    documentId: string;
    /** Set by the filing form when a document was created but a file was not. */
    notice?: string;
  }>();
  const { family, role } = useFamily();
  const { session } = useAuth();
  const familyId = family?.id ?? null;

  const [document, setDocument] = useState<FamilyDocument | null>(null);
  /*
    Seeded from the route param and dismissible, rather than read straight from
    it. A param survives every re-render of this screen, so a banner driven
    directly by one could not be got rid of without navigating away — and the
    thing it is telling you to do is on this screen.
  */
  const [filingNotice, setFilingNotice] = useState<string | null>(notice ?? null);
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

  /*
    Authorship, not role — and this is the line that mattered most in PR-15a.

    It used to read `canWriteRecords(role)`, which was correct only while every
    document you could open was one you had filed. Sharing makes "someone else's
    document, in front of you" a reachable state for the first time, and a role
    check answers the wrong question about it: a member may write records in
    general and still have no business renaming this one.

    Nothing would have caught it. It typechecks, and 655 tests passed. The class
    of bug is the one PR-9b named — when a PR makes a previously impossible state
    reachable, every boolean that assumed two states is now wrong, and neither
    the compiler nor the suite will say so. It was found by grepping for the old
    assumption, which is the only thing that finds it.

    `can_write_records` stays in the conjunction rather than being replaced: it is
    what excludes a Guest, and an author whose role was reduced *after* filing
    should lose the controls. The UPDATE policy says exactly this, in the same
    two parts.

    A null `created_by` means the account was deleted, and then nobody is the
    author — matching the policy, where `created_by = auth.uid()` cannot match
    null either.
  */
  const isAuthor = document.createdBy !== null && document.createdBy === session?.user.id;
  const canEdit = isAuthor && canWriteRecords(role);

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      {/*
        What the filing form could not finish, said in the app's own voice and
        beside the control that fixes it. It replaced an `Alert.alert`, which drew
        Android's dialog over a screen this app styles deliberately, and offered a
        single button on something that was not a question.
      */}
      {filingNotice ? (
        <Pressable
          onPress={() => setFilingNotice(null)}
          style={styles.notice}
          accessibilityRole="button"
          accessibilityLabel={`${filingNotice}. Tap to dismiss.`}
        >
          <Ionicons name="alert-circle-outline" size={18} color={theme.colors.warning} />
          <Text style={styles.noticeText}>{filingNotice}</Text>
          <Ionicons name="close-outline" size={18} color={theme.colors.textMuted} />
        </Pressable>
      ) : null}

      <Title document={document} canEdit={canEdit} onSaved={load} />

      {/*
        The same four components the filing form renders, in the same order.

        **They used to be four different components on two screens**, which is
        how the filing form ended up without AI consent and this one without
        visibility. One owner per field means the two cannot describe the same
        setting differently again — see `src/components/DocumentFields.tsx`.

        What the two screens still own separately is *saving*, and that difference
        is real rather than leftover: a document that does not exist yet cannot be
        written to a field at a time, and one that does should not need a Save
        button to move it between shelves. So these write immediately, and the
        filing form holds its answers until "File it".
      */}
      <Field label="Belongs to">
        {canEdit ? (
          <SubjectField
            value={document.memberId}
            people={people}
            onChange={(next) =>
              void save(
                () =>
                  setDocumentMember(createSupabaseDocumentGateway(getSupabase()), document.id, next),
                load,
                setError,
              )
            }
          />
        ) : (
          <Text style={styles.value}>
            {describeDocumentSubject(document, new Map(people.map((p) => [p.id, p.displayName])))}
          </Text>
        )}
      </Field>

      <Field label="Filed under">
        {canEdit ? (
          <CategoryField
            value={document.category}
            // Not `clearable`: a filed document always has a shelf. The filing
            // form allows clearing because nothing has been filed yet there.
            onChange={(next) =>
              next &&
              void save(
                () =>
                  setDocumentCategory(
                    createSupabaseDocumentGateway(getSupabase()),
                    document.id,
                    next,
                  ),
                load,
                setError,
              )
            }
          />
        ) : (
          <Text style={styles.value}>{CATEGORY_LABELS[document.category]}</Text>
        )}
      </Field>

      {/*
        Directly under "Belongs to", which is the clearest possible statement
        that they are different questions — the one above is a label, this one is
        the access control, and the hint under each says so.
      */}
      <Field label="Who can see it">
        {canEdit ? (
          <VisibilityField
            value={document.visibility}
            onChange={(next) =>
              void save(
                () =>
                  setDocumentVisibility(
                    createSupabaseDocumentGateway(getSupabase()),
                    document.id,
                    next,
                  ),
                load,
                setError,
              )
            }
          />
        ) : (
          /*
            Shown read-only rather than hidden. Somebody reading a document that
            was shared with them is entitled to know it was shared — and a field
            that silently disappeared for non-authors would make the library feel
            as though it were hiding something when the truth is the opposite.
          */
          <Text style={styles.value}>{VISIBILITY_LABELS[document.visibility]}</Text>
        )}
      </Field>

      {/*
        No ternary here, unlike the three above: the component itself knows the
        two presentations, because "asked" and "told" are two renderings of one
        field rather than two fields. That is also what stopped it rendering a
        disabled checkbox to readers.
      */}
      <Field label="AI">
        <AiConsentField
          value={document.aiProcessing}
          readOnly={!canEdit}
          onChange={(next) =>
            void save(
              () =>
                setDocumentAiProcessing(
                  createSupabaseDocumentGateway(getSupabase()),
                  document.id,
                  next,
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

      <Field label="Files">
        <Attachments documentId={document.id} canEdit={canEdit} />
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
 * The files attached to a document, and the way to add one.
 *
 * A document can hold several — a passport is one document with two pages, and
 * PR-14's migration replaced `unique (document_id, kind, version)` with a
 * uniqueness on the object itself so that stops meaning "the front was
 * superseded by the back".
 *
 * Names and sizes are shown because a person choosing between two scans needs
 * to tell them apart. That is not the same as the *card* in the library
 * becoming "1 file, 2.4 MB" — `docs/10` §13 governs the list, not this.
 */
function Attachments({ documentId, canEdit }: { documentId: string; canEdit: boolean }) {
  const [files, setFiles] = useState<DocumentFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<FilingProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const gateway = () => createSupabaseStorageGateway(getSupabase(), { url: getSupabaseEnv().url });

  const load = useCallback(async () => {
    const result = await listDocumentFiles(gateway(), documentId);
    if (!result.ok) {
      setError(result.message);
    } else {
      setError(null);
      setFiles(result.files);
    }
    setLoading(false);
  }, [documentId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  /**
   * Upload a batch, one after another.
   *
   * **This screen was single-select for one release and it was the wrong call.**
   * The reason given was progress reporting — several concurrent uploads behind
   * one bar is a number nobody can act on — but that argues for uploading
   * sequentially, which this does, not for refusing the batch. And `filing.ts`
   * had already solved the reporting: an index and a total, so "2 of 3" reads as
   * three uploads rather than as a bar restarting.
   *
   * The deciding argument is consistency. Attaching a file is one action, and
   * having it behave differently depending on which screen you are standing on is
   * the same class of drift this PR exists to remove.
   *
   * Sequential rather than parallel, for the reason `filing.ts` gives: the free
   * tier does not reward hammering storage with concurrent uploads from a phone.
   * A failure stops the batch here — unlike filing, there is no record to protect
   * and the files already attached are already visible, so continuing past an
   * error would bury it under the ones that followed.
   */
  async function attachAll(candidates: UploadCandidate[]) {
    setError(null);
    const failed: FailedAttachment[] = [];
    let attached = 0;

    try {
      for (const [position, candidate] of candidates.entries()) {
        const result = await uploadDocumentFile(
          gateway(),
          documentId,
          candidate,
          async (uri) => new DeviceFile(uri).bytes(),
          (fraction) =>
            setProgress({ index: position + 1, total: candidates.length, fraction }),
        );

        if (result.ok) attached += 1;
        else failed.push({ originalFilename: candidate.originalFilename, message: result.message });
      }
    } finally {
      /*
        **Always reload, including after a failure — this is the bug this block
        was rewritten to fix.**

        It used to `return` from inside the loop the moment an upload failed,
        which skipped the reload. Turning airplane mode on mid-batch therefore
        left the files that *had* gone up invisible: they existed in storage and
        in `document_files`, and the screen showed neither. Reported as failing
        silently, which is exactly what it looked like.

        The list has to describe what is actually there, and it is least
        trustworthy at precisely the moment something went wrong.
      */
      setProgress(null);
      await load();
    }

    /*
      Collect and continue, rather than stopping at the first failure — the same
      semantics `filing.ts` uses, and now for the same reason. One unreadable
      photo out of three should not cost the other two, and having this screen
      and the filing form disagree about what "attach some files" means is the
      drift this PR exists to remove. The message is built by the same function
      too, minus the sentence about where to retry: you are already there.
    */
    setError(describeAttachmentFailures({ attached, failed }));
  }

  if (loading) return <ActivityIndicator color={theme.colors.primary} />;

  return (
    <>
      {/*
        A row is a link, not a control strip. Removing lives on the file's own
        screen, next to Share, the same way a document's actions live on the
        document screen rather than on its card — PR-13's reasoning, applied one
        level down: piling icons onto a list row is what makes an app feel like
        a file manager.
      */}
      {files.map((file) => (
        <Pressable
          key={file.id}
          onPress={() => router.push(`/(app)/(tabs)/documents/${documentId}/${file.id}`)}
          style={styles.fileRow}
          accessibilityRole="button"
          accessibilityLabel={`Open ${file.originalFilename ?? 'photo'}`}
        >
          <Ionicons
            name={file.mimeType === 'application/pdf' ? 'document-text-outline' : 'image-outline'}
            size={20}
            color={theme.colors.textMuted}
          />
          <View style={styles.fileText}>
            <Text style={styles.value}>{file.originalFilename ?? 'Photo'}</Text>
            <Text style={styles.hint}>
              {formatBytes(file.sizeBytes)} · {formatRelativeTime(file.createdAt)}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
        </Pressable>
      ))}

      {files.length === 0 && progress === null ? (
        <Text style={styles.hint}>Nothing attached yet.</Text>
      ) : null}

      {/*
        The chooser moved to `FileSourcePicker` when filing gained attachments:
        the same three sources are needed before a document exists, where there
        is nothing to upload to yet. It reports a candidate; who uploads it, and
        when, is the caller's business.

        It still carries PR-14a's device finding — an inline list rather than
        `Alert.alert`, because Android's dialog takes at most three buttons and
        silently dropped the cancel.
      */}
      {progress !== null ? (
        <ProgressBar
          fraction={progress.fraction}
          label={
            progress.total > 1
              ? `Uploading ${progress.index} of ${progress.total}`
              : 'Uploading'
          }
        />
      ) : (
        <FileSourcePicker
          label={files.length === 0 ? 'Add files' : 'Add more'}
          multiple
          onPicked={(picked) => void attachAll(picked)}
          onError={setError}
          disabled={!canEdit}
        />
      )}

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

const styles = StyleSheet.create({
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
    color: theme.colors.text,
    fontSize: theme.typography.caption,
  },
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
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingVertical: theme.spacing.sm,
    // The row is the whole hit target now that the remove button has gone.
    minHeight: theme.touchTarget,
  },
  fileText: {
    flex: 1,
  },
  error: {
    color: theme.colors.error,
    fontSize: theme.typography.caption,
    marginBottom: theme.spacing.sm,
  },
});
