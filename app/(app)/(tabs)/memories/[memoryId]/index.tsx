import { Ionicons } from '@expo/vector-icons';
import { File as DeviceFile } from 'expo-file-system';
import { Link, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Button } from '../../../../../src/components/Button';
import { FileSourcePicker } from '../../../../../src/components/FileSourcePicker';
import { ProgressBar } from '../../../../../src/components/ProgressBar';
import { VoicePlayer, VoiceRecorder } from '../../../../../src/components/VoiceNote';
import {
  MemoryAiConsentField,
  MemoryDateField,
  MemoryPeopleField,
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
  linkMemoryPerson,
  listMemoryPeople,
  unlinkMemoryPerson,
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
import {
  addMemoryToAlbum,
  albumsContaining,
  createSupabaseAlbumGateway,
  listAlbumEntries,
  listAlbums,
  removeMemoryFromAlbum,
  type Album,
} from '../../../../../src/services/album';
import { canWriteRecords } from '../../../../../src/services/role';
import {
  MEMORY_FILES,
  createSupabaseStorageGateway,
  fileUrl,
  isAudio,
  isPreviewable,
  listRecordFiles,
  removeRecordFile,
  uploadRecordFile,
  type RecordFile,
  type UploadCandidate,
} from '../../../../../src/services/storage';
import { getSupabaseEnv } from '../../../../../src/lib/env';
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
  const [namedPeople, setNamedPeople] = useState<Set<string>>(new Set());
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

      const named = await listMemoryPeople(createSupabaseMemoryGateway(client), memoryId);
      // A refused read here is not worth blanking the screen for: the memory
      // loaded, and "nobody else named" is the honest fallback.
      setNamedPeople(new Set(named.ok ? named.memberIds : []));
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

      <Attachments memoryId={memory.id} canEdit={canEdit} />

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

      <Field label="Who else was there">
        <MemoryPeopleField
          value={namedPeople}
          people={people}
          subjectId={memory.memberId}
          readOnly={!canEdit}
          onToggle={(memberId, next) =>
            void save(
              () =>
                next
                  ? linkMemoryPerson(createSupabaseMemoryGateway(getSupabase()), {
                      memoryId: memory.id,
                      memberId,
                      familyId: familyId!,
                    })
                  : unlinkMemoryPerson(createSupabaseMemoryGateway(getSupabase()), memory.id, memberId),
              load,
              setError,
            )
          }
        />
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

      {familyId ? (
        <Field label="Albums">
          <AlbumMembership memoryId={memory.id} familyId={familyId} onError={setError} />
        </Field>
      ) : null}

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

/**
 * What was kept with a memory: photographs to look at, and voice notes to hear.
 *
 * Owns its own state and its own load, exactly as the documents screen's
 * attachment list does — the parent screen is about the record, and a failed
 * upload must not blank the story somebody is reading.
 *
 * **One list in the database, two presentations here.** Both are `memory_files`
 * rows governed by the same policies; they are separated in the UI because a
 * photograph is a thing you look at and a recording is a thing you play, and a
 * grid of grey rectangles with play buttons would serve neither. `mime_type`
 * decides which, via `isPreviewable` and `isAudio`.
 */
function Attachments({ memoryId, canEdit }: { memoryId: string; canEdit: boolean }) {
  const [files, setFiles] = useState<RecordFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<{ index: number; total: number; fraction: number } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const gateway = useCallback(
    () => createSupabaseStorageGateway(getSupabase(), { url: getSupabaseEnv().url }, MEMORY_FILES),
    [],
  );

  const load = useCallback(async () => {
    const result = await listRecordFiles(gateway(), memoryId);
    if (!result.ok) {
      setError(result.message);
      setFiles([]);
    } else {
      setError(null);
      setFiles(result.files);
    }
    setLoading(false);
  }, [gateway, memoryId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  /**
   * Upload a batch one at a time, keeping whatever worked.
   *
   * Sequential rather than concurrent because there is one progress bar and it
   * has to mean something (NFR-007). The reload is in `finally` — PR-15b's
   * fourth bug was an early return on failure that skipped it, hiding the files
   * that had uploaded successfully. **The list is least trustworthy at exactly
   * the moment something went wrong.**
   */
  async function attachAll(candidates: UploadCandidate[]) {
    setError(null);
    const failed: string[] = [];

    try {
      for (const [index, candidate] of candidates.entries()) {
        setProgress({ index: index + 1, total: candidates.length, fraction: 0 });

        const outcome = await uploadRecordFile(
          gateway(),
          memoryId,
          candidate,
          async (uri) => new DeviceFile(uri).bytes(),
          (fraction) => setProgress({ index: index + 1, total: candidates.length, fraction }),
        );

        if (!outcome.ok) failed.push(outcome.message);
      }
    } finally {
      setProgress(null);
      await load();
    }

    if (failed.length > 0) {
      setError(
        failed.length === 1
          ? failed[0]
          : `${failed.length} of ${candidates.length} photos could not be added.`,
      );
    }
  }

  const photos = files.filter((file) => isPreviewable(file.mimeType));
  const voiceNotes = files.filter((file) => isAudio(file.mimeType));

  return (
    <Field label={describeAttachments(photos.length, voiceNotes.length)}>
      {loading ? <ActivityIndicator color={theme.colors.primary} /> : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {progress ? (
        <ProgressBar
          fraction={progress.fraction}
          label={
            progress.total === 1
              ? 'Adding your photo'
              : `Adding photo ${progress.index} of ${progress.total}`
          }
        />
      ) : null}

      {!loading && files.length === 0 && !progress ? (
        <Text style={styles.empty}>
          {canEdit ? 'Nothing added yet.' : 'Nothing was added to this memory.'}
        </Text>
      ) : null}

      {photos.length > 0 ? (
        <View style={styles.grid}>
          {photos.map((file) => (
            <Thumbnail key={file.id} memoryId={memoryId} file={file} />
          ))}
        </View>
      ) : null}

      {voiceNotes.length > 0 ? (
        <View style={styles.voiceList}>
          {voiceNotes.map((file) => (
            <VoiceNoteRow key={file.id} file={file} canEdit={canEdit} onChanged={load} onError={setError} />
          ))}
        </View>
      ) : null}

      {canEdit ? (
        <>
          <FileSourcePicker
            label="Add photos"
            multiple
            imagesOnly
            // Compressed on the way in. docs/18 §9 makes this a requirement: at
            // 10MB a file against a ~1GB tier, uncompressed phone photographs are
            // about a hundred pictures for every family that will ever exist.
            quality={0.7}
            onPicked={(candidates) => void attachAll(candidates)}
            onError={setError}
            disabled={progress !== null}
          />
          {/*
            The recorder reports a candidate and uploads nothing, the same
            contract FileSourcePicker has — so both arrive at `attachAll` and
            there is one upload path rather than two.
          */}
          <VoiceRecorder
            onRecorded={(candidate) => void attachAll([candidate])}
            onError={setError}
            disabled={progress !== null}
          />
        </>
      ) : null}
    </Field>
  );
}

/** "3 photos and 1 voice note", or whichever half exists. */
function describeAttachments(photos: number, voiceNotes: number): string {
  const parts: string[] = [];
  if (photos > 0) parts.push(photos === 1 ? '1 photo' : `${photos} photos`);
  if (voiceNotes > 0) {
    parts.push(voiceNotes === 1 ? '1 voice note' : `${voiceNotes} voice notes`);
  }
  return parts.length === 0 ? 'Photos and voice notes' : parts.join(' and ');
}

/**
 * One voice note: a player, and a way for its author to remove it.
 *
 * Mints its own URL on mount and hands it to the player, which is given a URL
 * and never learns that one can expire (`docs/17` §10.1). A voice note is
 * usually short enough to outlast the 300-second TTL comfortably; a listener who
 * leaves the screen open long enough for it to lapse gets a re-mint on the next
 * load rather than a silent failure.
 */
function VoiceNoteRow({
  file,
  canEdit,
  onChanged,
  onError,
}: {
  file: RecordFile;
  canEdit: boolean;
  onChanged: () => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const gateway = createSupabaseStorageGateway(
        getSupabase(),
        { url: getSupabaseEnv().url },
        MEMORY_FILES,
      );
      const minted = await fileUrl(gateway, file);
      if (minted.ok) setUrl(minted.url);
      else onError(minted.message);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id]);

  function confirmRemove() {
    Alert.alert('Remove this voice note?', 'The memory stays; only the recording goes.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            const gateway = createSupabaseStorageGateway(
              getSupabase(),
              { url: getSupabaseEnv().url },
              MEMORY_FILES,
            );
            const outcome = await removeRecordFile(gateway, file);
            if (!outcome.ok) {
              onError(outcome.message);
              return;
            }
            onError(null);
            await onChanged();
          })();
        },
      },
    ]);
  }

  return (
    <View style={styles.voiceRow}>
      <View style={styles.voicePlayer}>
        <VoicePlayer url={url} durationSeconds={file.durationSeconds} />
      </View>
      {canEdit ? (
        <Pressable
          onPress={confirmRemove}
          style={styles.voiceRemove}
          accessibilityRole="button"
          accessibilityLabel="Remove this voice note"
        >
          <Ionicons name="trash-outline" size={18} color={theme.colors.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * One photograph in the grid, which mints its own URL and never keeps it.
 *
 * `docs/17` §10.1: never store a URL, and never let its expiry reach a
 * component. This asks for one when it mounts and re-asks once if the image
 * fails to load, which is what a 300-second TTL looks like from the UI. The
 * retry is bounded — a second failure is a real failure, and a component that
 * re-mints forever would hammer storage behind a broken thumbnail.
 */
function Thumbnail({ memoryId, file }: { memoryId: string; file: RecordFile }) {
  const [url, setUrl] = useState<string | null>(null);
  const [retried, setRetried] = useState(false);
  const [broken, setBroken] = useState(false);

  const mint = useCallback(async () => {
    const gateway = createSupabaseStorageGateway(
      getSupabase(),
      { url: getSupabaseEnv().url },
      MEMORY_FILES,
    );
    const minted = await fileUrl(gateway, file);
    if (minted.ok) setUrl(minted.url);
    else setBroken(true);
  }, [file]);

  useEffect(() => {
    void mint();
  }, [mint]);

  if (broken) {
    return (
      <View style={[styles.thumb, styles.thumbBroken]}>
        <Ionicons name="image-outline" size={20} color={theme.colors.textMuted} />
      </View>
    );
  }

  return (
    <Link
      href={{
        pathname: '/(app)/(tabs)/memories/[memoryId]/[fileId]',
        params: { memoryId, fileId: file.id },
      }}
      asChild
    >
      <Pressable style={styles.thumb} accessibilityRole="button" accessibilityLabel="Open photo">
        {url ? (
          <Image
            source={{ uri: url }}
            style={styles.thumbImage}
            resizeMode="cover"
            onError={() => {
              if (retried) {
                setBroken(true);
                return;
              }
              setRetried(true);
              void mint();
            }}
          />
        ) : (
          <ActivityIndicator color={theme.colors.primary} />
        )}
      </Pressable>
    </Link>
  );
}

/**
 * Which of *your* albums this memory is in.
 *
 * Only albums you authored are offered, because only their author may add to
 * them — the `album_memories` INSERT policy requires it. Listing somebody
 * else's album with a checkbox that always fails would be a control that asks a
 * question it will not accept an answer to, which is the disabled-checkbox
 * defect PR-15a paid for, wearing a different hat.
 *
 * Adding a memory to an album **changes nothing about who can read the memory**.
 * The album is a way of looking at memories; every reader still resolves each
 * memory through its own policy, and a private memory in a family album stays
 * invisible to everyone but its author.
 */
function AlbumMembership({
  memoryId,
  familyId,
  onError,
}: {
  memoryId: string;
  familyId: string;
  onError: (message: string | null) => void;
}) {
  const { session } = useAuth();
  const [albums, setAlbums] = useState<Album[]>([]);
  const [inAlbums, setInAlbums] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const gateway = createSupabaseAlbumGateway(getSupabase());
    const [listed, entries] = await Promise.all([
      listAlbums(gateway, familyId),
      listAlbumEntries(gateway, familyId),
    ]);

    setAlbums(listed.ok ? listed.albums : []);
    setInAlbums(entries.ok ? albumsContaining(entries.entries, memoryId) : new Set());
    setLoading(false);
  }, [familyId, memoryId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const mine = albums.filter((album) => album.createdBy === session?.user.id);

  if (loading) return <ActivityIndicator color={theme.colors.primary} />;

  if (mine.length === 0) {
    return (
      <Text style={styles.empty}>
        You have no albums yet. Make one from the Albums screen and this memory can go in it.
      </Text>
    );
  }

  async function toggle(albumId: string, next: boolean) {
    setBusy(true);
    const gateway = createSupabaseAlbumGateway(getSupabase());
    const outcome = next
      ? await addMemoryToAlbum(gateway, { albumId, memoryId, familyId })
      : await removeMemoryFromAlbum(gateway, albumId, memoryId);
    setBusy(false);

    if (!outcome.ok) {
      onError(outcome.message);
      return;
    }
    onError(null);
    await load();
  }

  return (
    <View style={styles.albumChips}>
      {mine.map((album) => {
        const active = inAlbums.has(album.id);
        return (
          <Pressable
            key={album.id}
            onPress={() => void toggle(album.id, !active)}
            disabled={busy}
            style={[styles.albumChip, active ? styles.albumChipActive : null]}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: active, disabled: busy }}
            accessibilityLabel={album.title}
          >
            {active ? <Ionicons name="checkmark" size={14} color={theme.colors.primary} /> : null}
            <Text style={[styles.albumChipText, active ? styles.albumChipTextActive : null]}>
              {album.title}
            </Text>
          </Pressable>
        );
      })}
    </View>
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
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  thumb: {
    width: 104,
    height: 104,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceSunken,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  thumbBroken: {
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  thumbImage: {
    width: '100%',
    height: '100%',
  },
  voiceList: {
    gap: theme.spacing.sm,
  },
  voiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  voicePlayer: {
    flex: 1,
  },
  voiceRemove: {
    width: theme.touchTarget,
    height: theme.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  albumChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  albumChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  albumChipActive: {
    backgroundColor: theme.colors.primarySoft,
    borderColor: theme.colors.primary,
  },
  albumChipText: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.caption,
  },
  albumChipTextActive: {
    color: theme.colors.primary,
    fontWeight: '600',
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
