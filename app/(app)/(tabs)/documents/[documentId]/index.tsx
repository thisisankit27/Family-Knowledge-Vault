import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { File as DeviceFile } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '../../../../../src/components/Button';
import { ProgressBar } from '../../../../../src/components/ProgressBar';
import { LockedNotice } from '../../../../../src/components/LockedNotice';
import { TextField } from '../../../../../src/components/TextField';
import { VisibilityPicker } from '../../../../../src/components/VisibilityPicker';
import { formatRelativeTime } from '../../../../../src/lib/relativeTime';
import { getSupabaseEnv } from '../../../../../src/lib/env';
import { getSupabase } from '../../../../../src/lib/supabase';
import { useAuth } from '../../../../../src/providers/AuthProvider';
import { useFamily } from '../../../../../src/providers/FamilyProvider';
import {
  AI_PROCESSING_LABELS,
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
  setDocumentVisibility,
  MAX_DOCUMENT_TITLE_LENGTH,
  VISIBILITY_LABELS,
  type DocumentCategory,
  type FamilyDocument,
} from '../../../../../src/services/document';
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
  const { documentId } = useLocalSearchParams<{ documentId: string }>();
  const { family, role } = useFamily();
  const { session } = useAuth();
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

      {/*
        Directly under "Belongs to" and "Filed under", and directly above the
        consent toggle, because all four are the same kind of thing: what this
        document *is* and who it is for. Sitting it next to "Belongs to" is also
        the clearest possible statement that they are different questions — the
        one above is a label, this one is the access control, and the hint under
        each says so.
      */}
      <Field label="Who can see it">
        {canEdit ? (
          <VisibilityPicker
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
            was shared with them is entitled to know it was shared — and the
            alternative, a field that silently disappears for non-authors, would
            make the library feel as though it were hiding something when the
            truth is the opposite.
          */
          <Text style={styles.value}>{VISIBILITY_LABELS[document.visibility]}</Text>
        )}
      </Field>

      <Field label="AI">
        {canEdit ? (
          <Toggle
            on={document.aiProcessing === 'allowed'}
            label="Let AI read this"
            // Deliberately not "AI cannot see this". The server can read the
            // bytes; this is a promise kept by code. The control that would be a
            // guarantee is Phase 11's encryption, and it is a different thing.
            hint="Used later to search and organise. Nothing reads it yet."
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
        ) : (
          /*
            **A reader gets the decision, not the control.**

            This field used to render the `Toggle` with `disabled={!canEdit}` for
            everybody, which was unreachable code written when only the author
            could open this screen. Sharing made it reachable and it was the only
            field on the screen presenting itself that way — the other four all
            fall back to a statement.

            A disabled checkbox is worse than either option it sits between. It
            asks a question, shows an answer, and then refuses the interaction it
            just invited; a reader cannot tell whether it is broken, still
            loading, or simply not theirs. The author's decision is a *fact about
            the document*, and facts are sentences.

            Same class of defect as the ten `canWriteRecords(role)` call sites
            this PR corrected: a branch that was dead while every reader was also
            the author, and wrong the moment that stopped being true. Worth
            re-checking whenever a phase makes a new kind of reader possible.
          */
          <>
            <Text style={styles.value}>{AI_PROCESSING_LABELS[document.aiProcessing]}</Text>
            <Text style={styles.hint}>
              {/* Whose choice it was matters here — it is not the reader's, and
                  saying so is what stops the line reading like a setting they
                  have failed to find. */}
              Chosen by whoever filed it. Nothing reads it yet.
            </Text>
          </>
        )}
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

/**
 * Turns whichever picker the user chose into one shape the service understands.
 *
 * **Both pickers report `mimeType` and size as optional**, which is easy to miss
 * and awkward to discover on a device — an Android gallery will hand back a HEIC
 * with no MIME type at all. The size comes from the file itself rather than the
 * picker's guess, since it is the number the 10MB check depends on.
 *
 * A missing MIME type is refused rather than guessed. Inferring it from the
 * filename would put user input back into a decision the path contract works
 * hard to keep it out of.
 */
function toCandidate(asset: {
  uri: string;
  mimeType?: string | null;
  name?: string | null;
}): UploadCandidate | { error: string } {
  if (!asset.mimeType) {
    return { error: 'That file did not say what kind it is. Try a photo or a PDF.' };
  }

  let sizeBytes: number | null = null;
  try {
    sizeBytes = new DeviceFile(asset.uri).size;
  } catch {
    sizeBytes = null;
  }

  if (sizeBytes === null || sizeBytes <= 0) {
    return { error: 'That file could not be read from your device.' };
  }

  return {
    uri: asset.uri,
    mimeType: asset.mimeType,
    sizeBytes,
    originalFilename: asset.name ?? null,
  };
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
  const [progress, setProgress] = useState<number | null>(null);
  const [choosing, setChoosing] = useState(false);
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

  async function attach(candidate: UploadCandidate) {
    setError(null);
    setProgress(0);
    try {
      const result = await uploadDocumentFile(
        gateway(),
        documentId,
        candidate,
        async (uri) => new DeviceFile(uri).bytes(),
        setProgress,
      );
      if (!result.ok) {
        setError(result.message);
        return;
      }
      await load();
    } finally {
      setProgress(null);
    }
  }

  async function pickFrom(source: 'camera' | 'library' | 'files') {
    if (source === 'files') {
      const picked = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
      if (picked.canceled || !picked.assets[0]) return;
      const candidate = toCandidate(picked.assets[0]);
      if ('error' in candidate) return setError(candidate.error);
      return attach(candidate);
    }

    // Permission is requested at the moment it is needed rather than on mount:
    // a prompt that appears before the user has asked for anything reads as the
    // app taking, not the user giving.
    const permission =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError(
        source === 'camera'
          ? 'Camera access is off. Turn it on in Settings to photograph a document.'
          : 'Photo access is off. Turn it on in Settings to choose a photo.',
      );
      return;
    }

    const picked =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'] })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'] });

    if (picked.canceled || !picked.assets[0]) return;
    const asset = picked.assets[0];
    const candidate = toCandidate({
      uri: asset.uri,
      mimeType: asset.mimeType,
      name: asset.fileName,
    });
    if ('error' in candidate) return setError(candidate.error);
    return attach(candidate);
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
        An inline chooser rather than Alert.alert, and not for taste: **Android's
        dialog takes at most three buttons.** Four — camera, library, files,
        cancel — silently dropped the cancel, leaving no way out of the sheet
        except the hardware back button. Found on a device.

        Inline also means the three sources are visible before committing to
        anything, which is the more discoverable arrangement anyway.
      */}
      {progress !== null ? (
        <ProgressBar fraction={progress} label="Uploading" />
      ) : !canEdit ? null : choosing ? (
        <View style={styles.sourceList}>
          {(
            [
              ['camera', 'camera-outline', 'Take a photo'],
              ['library', 'images-outline', 'Choose a photo'],
              ['files', 'document-outline', 'Choose a file'],
            ] as const
          ).map(([source, icon, label]) => (
            <Pressable
              key={source}
              onPress={() => {
                setChoosing(false);
                void pickFrom(source);
              }}
              style={styles.addFile}
              accessibilityRole="button"
            >
              <Ionicons name={icon} size={18} color={theme.colors.primary} />
              <Text style={styles.addFileText}>{label}</Text>
            </Pressable>
          ))}
          <Pressable
            onPress={() => setChoosing(false)}
            style={styles.addFile}
            accessibilityRole="button"
          >
            <Ionicons name="close-outline" size={18} color={theme.colors.textMuted} />
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable
          onPress={() => {
            setError(null);
            setChoosing(true);
          }}
          style={styles.addFile}
          accessibilityRole="button"
        >
          <Ionicons name="add-circle-outline" size={18} color={theme.colors.primary} />
          <Text style={styles.addFileText}>Add a file</Text>
        </Pressable>
      )}

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

/**
 * A checkbox, and only ever for somebody who may change what it shows.
 *
 * **It had a `disabled` prop and no longer does.** That prop existed for the
 * non-author case, produced a checkbox a reader could see and not use, and is
 * the thing this PR was asked to remove: a disabled control invites an
 * interaction and then refuses it, so a reader cannot tell it apart from one
 * that is broken or still loading. The read-only presentation of a setting is a
 * sentence, which the caller renders instead.
 *
 * Deleted rather than left unused, for the reason this project keeps arriving at
 * from the other direction — an unreachable branch is where the next defect
 * hides, and `disabled` here would be a standing invitation to re-introduce the
 * exact problem.
 */
function Toggle({
  on,
  label,
  hint,
  onToggle,
}: {
  on: boolean;
  label: string;
  hint: string;
  onToggle: (next: boolean) => void;
}) {
  return (
    <Pressable
      onPress={() => onToggle(!on)}
      style={styles.toggle}
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
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
  addFile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    paddingVertical: theme.spacing.sm,
  },
  addFileText: {
    color: theme.colors.primary,
    fontSize: theme.typography.body,
  },
  cancelText: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.body,
  },
  sourceList: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    marginTop: theme.spacing.sm,
    paddingTop: theme.spacing.xs,
  },
  error: {
    color: theme.colors.error,
    fontSize: theme.typography.caption,
    marginBottom: theme.spacing.sm,
  },
});
