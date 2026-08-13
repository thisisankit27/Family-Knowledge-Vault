import { Ionicons } from '@expo/vector-icons';
import { File as DeviceFile } from 'expo-file-system';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '../../../../src/components/Button';
import {
  AiConsentField,
  CategoryField,
  SubjectField,
  VisibilityField,
} from '../../../../src/components/DocumentFields';
import { FileSourcePicker } from '../../../../src/components/FileSourcePicker';
import { ProgressBar } from '../../../../src/components/ProgressBar';
import { TextField } from '../../../../src/components/TextField';
import { getSupabaseEnv } from '../../../../src/lib/env';
import { getSupabase } from '../../../../src/lib/supabase';
import { useFamily } from '../../../../src/providers/FamilyProvider';
import {
  MAX_DOCUMENT_TITLE_LENGTH,
  createSupabaseDocumentGateway,
  type AiProcessing,
  type DocumentCategory,
  type DocumentVisibility,
} from '../../../../src/services/document';
import {
  describeFilingResult,
  fileDocument,
  type FilingProgress,
} from '../../../../src/services/filing';
import { createSupabaseMemberGateway, listMembers, type Member } from '../../../../src/services/member';
import { canWriteRecords } from '../../../../src/services/role';
import {
  createSupabaseStorageGateway,
  formatBytes,
  type UploadCandidate,
} from '../../../../src/services/storage';
import { theme } from '../../../../src/theme';

/**
 * Filing a document, as one thing.
 *
 * **This replaces an inline form on the library screen**, and the move is what
 * the PR is for rather than incidental to it. That form asked for a title and a
 * shelf; everything else a document carries — who it is about, who can see it,
 * whether AI may read it, and the actual scan — could only be set afterwards, on
 * a different screen, which is not filing a document so much as starting one.
 *
 * Six fields and an attachment list cannot sit above a list without burying it,
 * so this is a modal route. That is also the convention the app already has:
 * `family/new.tsx` is exactly this shape, down to the intro paragraph.
 *
 * **The order of the fields is the order the questions occur to somebody**: what
 * is it, where does it go, whose is it, who may see it, may a machine read it, and
 * here it is. Visibility sits directly under the subject on purpose — they are the
 * two that get confused, and PR-13's escalation came from conflating them.
 *
 * Everything is held in local state until "File it". There is no draft record, no
 * autosave and nothing written on the way through: a half-filed document that
 * existed because somebody opened a form and changed their mind is worse than no
 * document, and it would show up in the library as one.
 */
export default function FileDocumentScreen() {
  const { family, role } = useFamily();

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<DocumentCategory | null>(null);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<DocumentVisibility>('private');
  const [aiProcessing, setAiProcessing] = useState<AiProcessing>('denied');
  const [candidates, setCandidates] = useState<UploadCandidate[]>([]);

  const [people, setPeople] = useState<Member[]>([]);
  const [progress, setProgress] = useState<FilingProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const familyId = family?.id ?? null;

  const load = useCallback(async () => {
    if (!familyId) return;
    setPeople(await listMembers(createSupabaseMemberGateway(getSupabase()), familyId));
  }, [familyId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleFile() {
    if (!familyId) return;
    if (!category) {
      setError('Choose where this belongs.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const outcome = await fileDocument(
        {
          documents: createSupabaseDocumentGateway(getSupabase()),
          storage: createSupabaseStorageGateway(getSupabase(), { url: getSupabaseEnv().url }),
        },
        { familyId, title, category, memberId, visibility, aiProcessing },
        candidates,
        async (uri) => new DeviceFile(uri).bytes(),
        setProgress,
      );

      if (!outcome.ok) {
        // The document was not created, so nothing was uploaded and the form is
        // still the right place to be. Everything typed is still here.
        setError(outcome.message);
        return;
      }

      /*
        The document exists. If a file did not, say so **on the document**, not in
        a system dialog on the way there.

        This was an `Alert.alert` and it was wrong twice over. Android draws its
        own dialog, so a screen the app had styled carefully was interrupted by
        something that looked nothing like it — and a modal whose only button is
        "Open the document" is a confirmation prompt with nothing to confirm. The
        alerts this app already uses are all destructive confirmations, where a
        system dialog is the right and expected thing; this is a result.

        Carried as a route param so the notice arrives with the screen rather than
        before it, and lands next to the "Add files" control that fixes it.
      */
      replaceWithDocument(outcome.document.id, describeFilingResult(outcome));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  /*
    `replace`, not `push`: this modal has done its job, and leaving it underneath
    would mean the back gesture from the document returns to a filled-in form for
    a document that already exists.
  */
  function replaceWithDocument(documentId: string, notice?: string | null) {
    router.replace({
      pathname: '/(app)/(tabs)/documents/[documentId]',
      params: notice ? { documentId, notice } : { documentId },
    });
  }

  if (!family) {
    // Only reachable by a deep link before a family exists.
    return null;
  }

  if (!canWriteRecords(role)) {
    // Hidden everywhere it can be reached from, but a screen has its own address
    // and the guard belongs on the screen too. The database refuses regardless.
    return (
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.intro}>Guests cannot file documents.</Text>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.intro}>
        Everything about a document is set here — what it is, whose it is, who can
        see it, and the scan itself. All of it stays editable afterwards.
      </Text>

      <TextField
        label="What is it?"
        value={title}
        onChangeText={setTitle}
        placeholder="Dad's Passport"
        maxLength={MAX_DOCUMENT_TITLE_LENGTH}
        editable={!busy}
      />

      <Field label="Filed under">
        <CategoryField value={category} onChange={setCategory} clearable disabled={busy} />
      </Field>

      <Field label="Belongs to">
        <SubjectField
          value={memberId}
          people={people}
          onChange={setMemberId}
          disabled={busy}
        />
      </Field>

      <Field label="Who can see it">
        <VisibilityField value={visibility} onChange={setVisibility} disabled={busy} />
      </Field>

      <Field label="AI">
        <AiConsentField value={aiProcessing} onChange={setAiProcessing} />
      </Field>

      <Field label="Files">
        {/*
          Chosen now, uploaded after the document exists — the storage path
          embeds its id, so bytes cannot move first. Listed rather than counted
          so somebody who picked the wrong photo can see which one it was.
        */}
        {candidates.map((candidate, index) => (
          <View key={`${candidate.uri}-${index}`} style={styles.candidate}>
            <Ionicons
              name={
                candidate.mimeType === 'application/pdf'
                  ? 'document-text-outline'
                  : 'image-outline'
              }
              size={20}
              color={theme.colors.textMuted}
            />
            <View style={styles.candidateText}>
              <Text style={styles.value}>{candidate.originalFilename ?? 'Photo'}</Text>
              <Text style={styles.hint}>{formatBytes(candidate.sizeBytes)}</Text>
            </View>
            {busy ? null : (
              <Pressable
                onPress={() =>
                  setCandidates(candidates.filter((_, position) => position !== index))
                }
                accessibilityRole="button"
                accessibilityLabel={`Remove ${candidate.originalFilename ?? 'photo'}`}
              >
                <Ionicons name="close-outline" size={20} color={theme.colors.textMuted} />
              </Pressable>
            )}
          </View>
        ))}

        {candidates.length === 0 ? (
          <Text style={styles.hint}>Nothing attached yet. A document can be filed without one.</Text>
        ) : null}

        <FileSourcePicker
          label={candidates.length === 0 ? 'Add files' : 'Add more'}
          // Several at once here, unlike the detail screen: a passport is one
          // document with two pages, and picking them one at a time is three
          // trips through the chooser for something a person thinks of as one
          // action. Safe here precisely because nothing uploads yet — the
          // candidates just join a list.
          multiple
          onPicked={(picked) => {
            setError(null);
            setCandidates((current) => [...current, ...picked]);
          }}
          onError={setError}
          disabled={busy}
        />
      </Field>

      {/*
        Real byte progress for the file being uploaded, plus which one it is. The
        count matters: a single bar restarting three times looks like a failure
        loop rather than three uploads.
      */}
      {progress ? (
        <ProgressBar
          fraction={progress.fraction}
          label={
            progress.total > 1
              ? `Uploading ${progress.index} of ${progress.total}`
              : 'Uploading'
          }
        />
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Button label="File it" onPress={handleFile} busy={busy} disabled={busy} />
    </ScrollView>
  );
}

/** The same label-over-content row the detail screen uses, so the two read alike. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.xxl,
    gap: theme.spacing.lg,
  },
  intro: {
    fontSize: theme.typography.body,
    lineHeight: 24,
    color: theme.colors.textMuted,
  },
  field: {
    gap: theme.spacing.xs,
  },
  label: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.caption,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
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
  candidate: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingVertical: theme.spacing.sm,
  },
  candidateText: {
    flex: 1,
  },
  error: {
    color: theme.colors.error,
    fontSize: theme.typography.caption,
  },
});
