/**
 * Memories business logic.
 *
 * Same shape as every other service — rules here, UI-free, gateway injected —
 * so validation and error wording are tested without a network or a device.
 *
 * This service does **no permission work**. `can_see_record` decides what comes
 * back and `can_write_records` decides what goes in, both in Postgres. A filter
 * written here would be a second permission model the RLS suite does not test,
 * and the first place the two disagreed would be a leak.
 *
 * The model those policies enforce (20260817090000): **a memory is written by
 * one person and, by default, belongs to the whole family to read.** Reading
 * widens with `visibility`; writing never does. Not the family Owner, not the
 * person it is about — the author alone may change it.
 *
 * Two things differ from documents, and both are decisions rather than drift:
 *
 *   * `visibility` defaults to **`family`**. A document is the most sensitive
 *     thing this product holds; a memory exists to be shared (docs/18 §4.1).
 *   * A memory has a **date it happened**, which is not the date it was written
 *     down, and which a family often only half-remembers. See `MEMORY_PRECISIONS`.
 *
 * What it owns is the vocabulary the UI speaks: a memory has a *title*, a
 * *story* and a *time*, never a filename. `docs/10` §2 — "users should never
 * feel like they are managing files" — is a product constraint, and this is the
 * layer that keeps it true.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { GatewayResult } from './family';

export const MAX_MEMORY_TITLE_LENGTH = 120;
export const MAX_STORY_LENGTH = 10000;
export const MAX_LOCATION_LENGTH = 120;

/**
 * Whether AI may read this memory.
 *
 * A consent flag, not an encryption tier — the two were deliberately separated
 * in `docs/17` §6. This is a promise kept by code; it is not a guarantee the
 * server cannot read the words, and no copy in the UI may imply otherwise.
 */
export const AI_PROCESSING_MODES = ['allowed', 'denied'] as const;
export type AiProcessing = (typeof AI_PROCESSING_MODES)[number];

/** The consent decision stated as a fact, for a reader who did not make it. */
export const AI_PROCESSING_LABELS: Record<AiProcessing, string> = {
  allowed: 'AI may read this',
  denied: 'AI may not read this',
};

/**
 * Mirrors `memories.visibility`. Who may *read* a memory.
 *
 * Order is `family` first, and it is the reverse of `DOCUMENT_VISIBILITIES` for
 * a reason worth stating rather than inheriting. `ChipGroup` renders this list
 * in order, so the first entry is the one a person reads first, and it should be
 * the one the column actually defaults to. Documents lead with the narrower
 * option because broadening a passport should look deliberate; memories lead
 * with the wider one because a family album nobody can see is not a feature.
 *
 * (The default itself lives in the column, not here.)
 *
 * **This decides reading only.** Editing, archiving and deleting are the
 * author's alone at every value, enforced by separate policies keyed on
 * `created_by`. A single column deciding both is what produced the escalation
 * `20260810090000` closed — see `setMemoryMember`.
 */
export const MEMORY_VISIBILITIES = ['family', 'private'] as const;
export type MemoryVisibility = (typeof MEMORY_VISIBILITIES)[number];

export const VISIBILITY_LABELS: Record<MemoryVisibility, string> = {
  family: 'Everyone in the family',
  private: 'Only me',
};

/**
 * What each choice actually means, in one sentence.
 *
 * `private` says "not even an owner" out loud, and that is deliberate: `docs/15`
 * §8.4 decided no role reads a private record, and a UI that said "private"
 * while an admin could read the row would be exactly the claim the landing
 * page's honesty standard forbids.
 */
export const VISIBILITY_HINTS: Record<MemoryVisibility, string> = {
  family: 'Anyone with access to this family can open it. Guests cannot.',
  private: 'Nobody else can open this — not even an owner.',
};

export function isMemoryVisibility(value: unknown): value is MemoryVisibility {
  return typeof value === 'string' && (MEMORY_VISIBILITIES as readonly string[]).includes(value);
}

/**
 * How much of `occurred_on` is real.
 *
 * Families do not remember days, they remember "summer 1998". Storing
 * `1998-07-01` and rendering it as *1 July 1998* would invent a precision
 * nobody claimed, so the date is stored whole and this says how much of it to
 * believe.
 *
 * A fourth state — not knowing at all — is `occurredOn === null` rather than a
 * fourth value here, because it is the absence of a date rather than a coarser
 * one. `DATE_CHOICES` below is what the UI offers, and it has four entries.
 */
export const MEMORY_PRECISIONS = ['day', 'month', 'year'] as const;
export type MemoryPrecision = (typeof MEMORY_PRECISIONS)[number];

export function isMemoryPrecision(value: unknown): value is MemoryPrecision {
  return typeof value === 'string' && (MEMORY_PRECISIONS as readonly string[]).includes(value);
}

/** What the person picking a precision is choosing between. */
export const PRECISION_LABELS: Record<MemoryPrecision, string> = {
  day: 'A day',
  month: 'A month',
  year: 'A year',
};

/** The shape the text field expects for each precision. */
export const PRECISION_PLACEHOLDERS: Record<MemoryPrecision, string> = {
  day: 'YYYY-MM-DD',
  month: 'YYYY-MM',
  year: 'YYYY',
};

/** The label for "I don't remember", which is `occurredOn === null`. */
export const UNKNOWN_DATE_LABEL = "I don't remember";

/** How an unknown date reads wherever a date would go. */
export const UNKNOWN_DATE_TEXT = 'Date unknown';

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export interface FamilyMemory {
  id: string;
  title: string;
  story: string | null;
  /** ISO `YYYY-MM-DD`, or null when nobody remembers. */
  occurredOn: string | null;
  occurredPrecision: MemoryPrecision;
  location: string | null;
  memberId: string | null;
  visibility: MemoryVisibility;
  archivedAt: string | null;
  aiProcessing: AiProcessing;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateMemoryInput {
  familyId: string;
  title: string;
  story?: string | null;
  occurredOn?: string | null;
  occurredPrecision?: MemoryPrecision;
  location?: string | null;
  /** Who it is about. A label only — see `setMemoryMember`. */
  memberId?: string | null;
  aiProcessing?: AiProcessing;
  /**
   * Who may read it. Optional, and when omitted the column's own default
   * (`family`) applies rather than a default chosen here.
   *
   * Deliberately not defaulted in this interface, for the reason documents give:
   * two copies of the rule — one in Postgres, one in TypeScript — can disagree,
   * and the one that would win is the one nobody was looking at.
   */
  visibility?: MemoryVisibility;
}

export interface MemoryGateway {
  listMemories(familyId: string): Promise<GatewayResult<FamilyMemory[]>>;
  createMemory(input: CreateMemoryInput): Promise<GatewayResult<FamilyMemory>>;
  getMemory(memoryId: string): Promise<GatewayResult<FamilyMemory>>;
  setTitle(memoryId: string, title: string): Promise<{ error: { message: string } | null }>;
  setStory(memoryId: string, story: string | null): Promise<{ error: { message: string } | null }>;
  setOccurredOn(
    memoryId: string,
    occurredOn: string | null,
    precision: MemoryPrecision,
  ): Promise<{ error: { message: string } | null }>;
  setLocation(
    memoryId: string,
    location: string | null,
  ): Promise<{ error: { message: string } | null }>;
  setMember(memoryId: string, memberId: string | null): Promise<{ error: { message: string } | null }>;
  setVisibility(
    memoryId: string,
    visibility: MemoryVisibility,
  ): Promise<{ error: { message: string } | null }>;
  setAiProcessing(
    memoryId: string,
    aiProcessing: AiProcessing,
  ): Promise<{ error: { message: string } | null }>;
  archiveMemory(memoryId: string, archived: boolean): Promise<{ error: { message: string } | null }>;
  deleteMemory(memoryId: string): Promise<{ error: { message: string } | null }>;
  listPeople(memoryId: string): Promise<GatewayResult<string[]>>;
  linkPerson(input: {
    memoryId: string;
    memberId: string;
    familyId: string;
  }): Promise<{ error: { message: string } | null }>;
  unlinkPerson(memoryId: string, memberId: string): Promise<{ error: { message: string } | null }>;
}

export type MemoryOutcome = { ok: true; memory: FamilyMemory } | { ok: false; message: string };

export function validateMemoryTitle(raw: string): { message: string } | null {
  const title = raw.trim();

  if (title.length === 0) return { message: 'Give this memory a name.' };
  if (title.length > MAX_MEMORY_TITLE_LENGTH) {
    return { message: `Keep it under ${MAX_MEMORY_TITLE_LENGTH} characters.` };
  }
  return null;
}

export function validateStory(raw: string): { message: string } | null {
  if (raw.length > MAX_STORY_LENGTH) {
    return { message: `That is longer than ${MAX_STORY_LENGTH} characters.` };
  }
  return null;
}

export function validateLocation(raw: string): { message: string } | null {
  if (raw.trim().length > MAX_LOCATION_LENGTH) {
    return { message: `Keep it under ${MAX_LOCATION_LENGTH} characters.` };
  }
  return null;
}

/**
 * Turn what somebody typed into a date the column can hold, at the precision
 * they claimed.
 *
 * The normalisation is the point. A `'year'` memory stores `1998-01-01`, so
 * `occurred_on` always sorts correctly whatever precision it carries, and
 * `describeMemoryDate` renders only the part that was claimed. Storing three
 * nullable date parts instead would sort badly and would let a month exist
 * without a year.
 *
 * Returns `{ occurredOn: null }` for empty input — not knowing when something
 * happened is a valid answer, and the commonest one for an old photograph.
 */
export function parseOccurredOn(
  raw: string,
  precision: MemoryPrecision,
): { occurredOn: string | null } | { message: string } {
  const value = raw.trim();
  if (value.length === 0) return { occurredOn: null };

  const patterns: Record<MemoryPrecision, RegExp> = {
    day: /^(\d{4})-(\d{2})-(\d{2})$/,
    month: /^(\d{4})-(\d{2})$/,
    year: /^(\d{4})$/,
  };

  const match = patterns[precision].exec(value);
  if (!match) {
    return { message: `Use ${PRECISION_PLACEHOLDERS[precision]}.` };
  }

  const year = Number(match[1]);
  const month = precision === 'year' ? 1 : Number(match[2]);
  const day = precision === 'day' ? Number(match[3]) : 1;

  if (year < 1800) return { message: 'That year is too far back.' };
  if (month < 1 || month > 12) return { message: 'That is not a month.' };

  // Round-tripping through Date catches 31 February, which the regex cannot.
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return { message: 'That is not a real date.' };
  }

  const pad = (n: number) => String(n).padStart(2, '0');
  return { occurredOn: `${year}-${pad(month)}-${pad(day)}` };
}

/**
 * When it happened, said the way the person who recorded it said it.
 *
 * The whole reason `occurred_precision` exists. A memory dated 1998 renders as
 * "1998" and never as "1 January 1998", because the second is a fact nobody
 * claimed and this product's landing page carries an honesty standard.
 */
export function describeMemoryDate(memory: {
  occurredOn: string | null;
  occurredPrecision: MemoryPrecision;
}): string {
  if (!memory.occurredOn) return UNKNOWN_DATE_TEXT;

  const [year, month, day] = memory.occurredOn.split('-');
  const monthName = MONTH_NAMES[Number(month) - 1] ?? '';

  if (memory.occurredPrecision === 'year') return year;
  if (memory.occurredPrecision === 'month') return `${monthName} ${year}`;
  return `${Number(day)} ${monthName} ${year}`;
}

/**
 * The stored date back in the shape its precision is typed in, so opening the
 * editor shows what was entered rather than the normalised form.
 */
export function formatOccurredOnInput(memory: {
  occurredOn: string | null;
  occurredPrecision: MemoryPrecision;
}): string {
  if (!memory.occurredOn) return '';
  const [year, month] = memory.occurredOn.split('-');

  if (memory.occurredPrecision === 'year') return year;
  if (memory.occurredPrecision === 'month') return `${year}-${month}`;
  return memory.occurredOn;
}

/**
 * Postgres speaks to developers. This speaks to whoever is holding the phone.
 *
 * The row-level-security branch matters here for the same reason it did on
 * documents: a Guest can reach the memories tab and read nothing, because
 * `can_read_records` excludes them. "You do not have permission to do that" is
 * the honest answer and must not be softened into "no memories yet" — telling
 * somebody a shelf is empty when it is merely locked is the kind of claim this
 * project has committed not to make.
 */
export function describeMemoryError(message: string): string {
  const normalised = message.toLowerCase();

  if (normalised.includes('row-level security') || normalised.includes('permission denied')) {
    return 'You do not have permission to do that.';
  }
  if (normalised.includes('not authenticated')) {
    return 'Your session has expired. Sign in again.';
  }
  if (normalised.includes('memories_title_check')) {
    return `Use between 1 and ${MAX_MEMORY_TITLE_LENGTH} characters.`;
  }
  if (normalised.includes('memories_story_check')) {
    return `That is longer than ${MAX_STORY_LENGTH} characters.`;
  }
  if (normalised.includes('memories_location_check')) {
    return `Keep the place under ${MAX_LOCATION_LENGTH} characters.`;
  }
  if (normalised.includes('memories_occurred_precision_check')) {
    return 'That is not a date precision.';
  }
  if (normalised.includes('memories_visibility_check')) {
    return 'That visibility setting is not recognised.';
  }
  if (normalised.includes('memories_ai_processing_check')) {
    return 'That privacy setting is not recognised.';
  }
  if (normalised.includes('memory_members_pkey') || normalised.includes('duplicate key')) {
    return 'That person is already named on this memory.';
  }
  if (normalised.includes('memory_members_member_id_family_id_fkey')) {
    return 'That person is no longer in this family.';
  }
  if (normalised.includes('memories_member_id_family_id_fkey')) {
    // The subject left the family between opening the form and submitting it.
    // Naming the person would be a guess; naming the cause is not.
    return 'That person is no longer in this family.';
  }
  if (normalised.includes('invalid input syntax for type date')) {
    return 'That is not a real date.';
  }
  if (normalised.includes('network') || normalised.includes('fetch')) {
    return 'Cannot reach the server. Check your connection and try again.';
  }
  return message;
}

/**
 * Live memories for a family, most recent first by when they happened.
 *
 * Archived rows are included: they are still visible to the policy, and hiding
 * them here would make "archive" indistinguishable from "delete" to every
 * caller. Splitting the list is the screen's job — see `partitionMemories`.
 *
 * An empty list and a refused read are different answers and are returned
 * differently, so the UI can tell "nothing kept yet" from "not allowed".
 */
export async function listMemories(
  gateway: MemoryGateway,
  familyId: string,
): Promise<{ ok: true; memories: FamilyMemory[] } | { ok: false; message: string }> {
  const { data, error } = await gateway.listMemories(familyId);
  if (error) return { ok: false, message: describeMemoryError(error.message) };
  return { ok: true, memories: data ?? [] };
}

export async function createMemory(
  gateway: MemoryGateway,
  input: CreateMemoryInput,
): Promise<MemoryOutcome> {
  const invalid = validateMemoryTitle(input.title);
  if (invalid) return { ok: false, message: invalid.message };

  if (input.story) {
    const badStory = validateStory(input.story);
    if (badStory) return { ok: false, message: badStory.message };
  }

  if (input.location) {
    const badPlace = validateLocation(input.location);
    if (badPlace) return { ok: false, message: badPlace.message };
  }

  // An unrecognised visibility makes `can_see_record` fail closed, so the
  // memory would be kept and then invisible to the person who kept it.
  if (input.visibility !== undefined && !isMemoryVisibility(input.visibility)) {
    return { ok: false, message: 'That visibility setting is not recognised.' };
  }

  if (input.occurredPrecision !== undefined && !isMemoryPrecision(input.occurredPrecision)) {
    return { ok: false, message: 'That is not a date precision.' };
  }

  const { data, error } = await gateway.createMemory({
    ...input,
    title: input.title.trim(),
    story: input.story?.trim() || null,
    location: input.location?.trim() || null,
  });

  if (error) return { ok: false, message: describeMemoryError(error.message) };
  if (!data) {
    // The insert succeeded and the SELECT policy declined to return the row.
    // Reporting success would leave the list showing nothing and the person
    // writing the same memory twice.
    return { ok: false, message: 'The memory was not saved. Please try again.' };
  }

  return { ok: true, memory: data };
}

/**
 * One memory, or a clear reason why not.
 *
 * `null` data with no error is the interesting case: the row exists and
 * `can_see_record` declined to return it. That is not an error — it is what
 * privacy looks like from outside — so it gets its own message.
 */
export async function getMemory(
  gateway: MemoryGateway,
  memoryId: string,
): Promise<MemoryOutcome> {
  const { data, error } = await gateway.getMemory(memoryId);
  if (error) return { ok: false, message: describeMemoryError(error.message) };
  if (!data) return { ok: false, message: 'That memory is no longer available.' };
  return { ok: true, memory: data };
}

export async function renameMemory(
  gateway: MemoryGateway,
  memoryId: string,
  title: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const invalid = validateMemoryTitle(title);
  if (invalid) return { ok: false, message: invalid.message };

  const { error } = await gateway.setTitle(memoryId, title.trim());
  if (error) return { ok: false, message: describeMemoryError(error.message) };
  return { ok: true };
}

export async function setMemoryStory(
  gateway: MemoryGateway,
  memoryId: string,
  story: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const invalid = validateStory(story);
  if (invalid) return { ok: false, message: invalid.message };

  // Empty becomes null rather than an empty string, so "no story" is one value
  // in the column instead of two that every reader has to handle.
  const { error } = await gateway.setStory(memoryId, story.trim() || null);
  if (error) return { ok: false, message: describeMemoryError(error.message) };
  return { ok: true };
}

/**
 * Say when it happened, and how much of that is actually known.
 *
 * The precision travels with the date because they are one fact. Setting them
 * separately would allow a moment where the row claims day precision over a
 * date that only carries a year.
 */
export async function setMemoryDate(
  gateway: MemoryGateway,
  memoryId: string,
  raw: string,
  precision: MemoryPrecision,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!isMemoryPrecision(precision)) {
    return { ok: false, message: 'That is not a date precision.' };
  }

  const parsed = parseOccurredOn(raw, precision);
  if ('message' in parsed) return { ok: false, message: parsed.message };

  const { error } = await gateway.setOccurredOn(memoryId, parsed.occurredOn, precision);
  if (error) return { ok: false, message: describeMemoryError(error.message) };
  return { ok: true };
}

export async function setMemoryLocation(
  gateway: MemoryGateway,
  memoryId: string,
  location: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const invalid = validateLocation(location);
  if (invalid) return { ok: false, message: invalid.message };

  const { error } = await gateway.setLocation(memoryId, location.trim() || null);
  if (error) return { ok: false, message: describeMemoryError(error.message) };
  return { ok: true };
}

/**
 * Say who a memory is *about*.
 *
 * Distinct from who wrote it, which is `created_by` and is not editable.
 * `null` means the whole family — a holiday belongs to everyone who was there.
 *
 * **It grants nothing.** `can_see_record` has a branch that would give a private
 * record to its subject, and `20260810090000` proved what happens when a record
 * table uses it: naming somebody handed them read *and* write access to
 * something they had not created. The memories policies pass `null` in the
 * subject position (docs/18 §3.4), so this column is inert to permissions and is
 * only a label.
 *
 * "Who is this about" and "who may open this" are different questions, and one
 * column answering both is a privilege escalation waiting to be noticed.
 */
export async function setMemoryMember(
  gateway: MemoryGateway,
  memoryId: string,
  memberId: string | null,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await gateway.setMember(memoryId, memberId);
  if (error) return { ok: false, message: describeMemoryError(error.message) };
  return { ok: true };
}

/**
 * Say who may *open* a memory.
 *
 * The other half of the pair above. Two values only; specific-person sharing is
 * not here and is not missing — `docs/15` §10 puts per-record ACLs in Phase 10.
 *
 * **Only the author can call this successfully.** Not enforced here — the UPDATE
 * policy is keyed to `created_by`, so a reader's attempt matches no row and
 * changes nothing. A check in this function would be a second permission model.
 */
export async function setMemoryVisibility(
  gateway: MemoryGateway,
  memoryId: string,
  visibility: MemoryVisibility,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!isMemoryVisibility(visibility)) {
    return { ok: false, message: 'That visibility setting is not recognised.' };
  }

  const { error } = await gateway.setVisibility(memoryId, visibility);
  if (error) return { ok: false, message: describeMemoryError(error.message) };
  return { ok: true };
}

export async function setMemoryAiProcessing(
  gateway: MemoryGateway,
  memoryId: string,
  aiProcessing: AiProcessing,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!AI_PROCESSING_MODES.includes(aiProcessing)) {
    return { ok: false, message: 'That privacy setting is not recognised.' };
  }

  const { error } = await gateway.setAiProcessing(memoryId, aiProcessing);
  if (error) return { ok: false, message: describeMemoryError(error.message) };
  return { ok: true };
}

/**
 * Archive is reversible; delete is not. Separate columns for that reason
 * (`docs/16` §6.3), and separate functions here so no caller can reach the
 * irreversible one by passing a flag.
 */
export async function setMemoryArchived(
  gateway: MemoryGateway,
  memoryId: string,
  archived: boolean,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await gateway.archiveMemory(memoryId, archived);
  if (error) return { ok: false, message: describeMemoryError(error.message) };
  return { ok: true };
}

export async function deleteMemory(
  gateway: MemoryGateway,
  memoryId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await gateway.deleteMemory(memoryId);
  if (error) return { ok: false, message: describeMemoryError(error.message) };
  return { ok: true };
}

/**
 * Who else was there.
 *
 * `memory_members` shipped in PR-17 with policies and RLS tests and **no way to
 * reach it** — the sixth time this project would have closed a phase with a
 * capability only its tests could exercise, and the reason PR-20 gives it an
 * interface rather than letting Phase 4 end that way.
 *
 * **These links grant nothing, and that is the whole point of the table.**
 * `memories.member_id` is the *subject* — one person, the one the memory is
 * chiefly about — and neither it nor these links appear in any permission
 * decision, because every memories policy passes `null` in `can_see_record`'s
 * subject position (`docs/18` §3.4). Naming somebody here is a label for
 * finding the memory later, not a share.
 *
 * If a link ever granted read, any member could insert a row naming themselves
 * against a private memory and read it — a privilege escalation needing no
 * interface at all, which is precisely why the table's header comment says so
 * and why the RLS suite has a test called *"does not let a link make a private
 * memory readable"*.
 */
export async function listMemoryPeople(
  gateway: MemoryGateway,
  memoryId: string,
): Promise<{ ok: true; memberIds: string[] } | { ok: false; message: string }> {
  const { data, error } = await gateway.listPeople(memoryId);
  if (error) return { ok: false, message: describeMemoryError(error.message) };
  return { ok: true, memberIds: data ?? [] };
}

export async function linkMemoryPerson(
  gateway: MemoryGateway,
  input: { memoryId: string; memberId: string; familyId: string },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await gateway.linkPerson(input);
  if (error) return { ok: false, message: describeMemoryError(error.message) };
  return { ok: true };
}

export async function unlinkMemoryPerson(
  gateway: MemoryGateway,
  memoryId: string,
  memberId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await gateway.unlinkPerson(memoryId, memberId);
  if (error) return { ok: false, message: describeMemoryError(error.message) };
  return { ok: true };
}

/**
 * Who was there, in the words the family uses.
 *
 * Deliberately excludes the subject: the screen shows "Who it is about"
 * separately, and repeating that person in "Who else was there" would make one
 * fact look like two.
 */
export function describeMemoryPeople(
  memberIds: string[],
  peopleById: Map<string, string>,
): string {
  if (memberIds.length === 0) return 'Nobody else named';
  return memberIds.map((id) => peopleById.get(id) ?? 'Someone in this family').join(', ');
}

/** Active and archived, in one pass, order preserved. */
export function partitionMemories(memories: FamilyMemory[]): {
  active: FamilyMemory[];
  archived: FamilyMemory[];
} {
  const active: FamilyMemory[] = [];
  const archived: FamilyMemory[] = [];

  for (const memory of memories) {
    (memory.archivedAt ? archived : active).push(memory);
  }

  return { active, archived };
}

/**
 * Group memories under the year they happened, most recent first, with the
 * undated ones last under their own heading.
 *
 * This is the whole of Phase 4's "chronological" requirement (FR-024). It is a
 * pure function over a list the screen already holds — not a timeline entity,
 * not a view, and not a second query. The Timeline *domain* is Phase 7 and is a
 * different thing: it spans every domain that has dated rows, and building a
 * narrower version of it here would mean building it twice (docs/18 §3.2).
 */
export function groupByYear(
  memories: FamilyMemory[],
): { year: string; memories: FamilyMemory[] }[] {
  const groups = new Map<string, FamilyMemory[]>();

  for (const memory of memories) {
    const year = memory.occurredOn ? memory.occurredOn.slice(0, 4) : UNKNOWN_DATE_TEXT;
    const bucket = groups.get(year);
    if (bucket) bucket.push(memory);
    else groups.set(year, [memory]);
  }

  return [...groups.entries()]
    .map(([year, entries]) => ({ year, memories: entries }))
    .sort((a, b) => {
      // Undated last, whatever it is called, rather than sorting as a word.
      if (a.year === UNKNOWN_DATE_TEXT) return 1;
      if (b.year === UNKNOWN_DATE_TEXT) return -1;
      return b.year.localeCompare(a.year);
    });
}

/**
 * The line under a memory's title: when, and where if it is known.
 *
 * Deliberately says nothing about photographs. There are none in PR-17, and
 * once PR-18 adds them the answer still should not be "3 files, 6.1 MB" —
 * `docs/10` §13 asks for context rather than an inventory.
 */
export function describeMemoryMoment(memory: FamilyMemory): string {
  const when = describeMemoryDate(memory);
  return memory.location ? `${when} · ${memory.location}` : when;
}

/** Who a memory is about, in the words the family uses. */
export function describeMemorySubject(
  memory: FamilyMemory,
  peopleById: Map<string, string>,
): string {
  if (!memory.memberId) return 'The whole family';
  return peopleById.get(memory.memberId) ?? 'Someone in this family';
}

/**
 * Who kept this memory, from the reader's point of view.
 *
 * "You" when it is you. Degrades to "Someone" rather than an id: the account may
 * simply have been deleted, and the memory is still theirs to have written.
 */
export function describeMemoryAuthor(
  memory: FamilyMemory,
  people: { userId: string | null; displayName: string }[],
  viewerUserId: string | null,
): string {
  if (!memory.createdBy) return 'Someone';
  if (memory.createdBy === viewerUserId) return 'You';

  const person = people.find((candidate) => candidate.userId === memory.createdBy);
  return person?.displayName ?? 'Someone';
}

interface MemoryRow {
  id: string;
  title: string;
  story: string | null;
  occurred_on: string | null;
  occurred_precision: MemoryPrecision;
  location: string | null;
  member_id: string | null;
  visibility: MemoryVisibility;
  archived_at: string | null;
  ai_processing: AiProcessing;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

function toMemory(row: MemoryRow): FamilyMemory {
  return {
    id: row.id,
    title: row.title,
    story: row.story,
    occurredOn: row.occurred_on,
    occurredPrecision: row.occurred_precision,
    location: row.location,
    memberId: row.member_id,
    visibility: row.visibility,
    archivedAt: row.archived_at,
    aiProcessing: row.ai_processing,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const MEMORY_COLUMNS =
  'id, title, story, occurred_on, occurred_precision, location, member_id, visibility, archived_at, ai_processing, created_by, created_at, updated_at';

/** The only place that knows how memories are stored. */
export function createSupabaseMemoryGateway(client: SupabaseClient): MemoryGateway {
  return {
    async listMemories(familyId) {
      // Ordered by when it happened, not when it was written — the index
      // `memories_family_idx` is built for exactly this. Undated memories sort
      // last, which is what the screen renders under its own heading.
      const { data, error } = await client
        .from('memories')
        .select(MEMORY_COLUMNS)
        .eq('family_id', familyId)
        .order('occurred_on', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .returns<MemoryRow[]>();

      return { data: data ? data.map(toMemory) : null, error };
    },

    async createMemory({
      familyId,
      title,
      story,
      occurredOn,
      occurredPrecision,
      location,
      memberId,
      aiProcessing,
      visibility,
    }) {
      // `created_by` is sent explicitly because the INSERT policy requires it to
      // equal auth.uid() — the database will not infer it, and a default would
      // let a client keep a memory in somebody else's name.
      const { data: session } = await client.auth.getUser();

      const { data, error } = await client
        .from('memories')
        .insert({
          family_id: familyId,
          title,
          story: story ?? null,
          occurred_on: occurredOn ?? null,
          occurred_precision: occurredPrecision ?? 'day',
          location: location ?? null,
          member_id: memberId ?? null,
          ai_processing: aiProcessing ?? 'denied',
          // Omitted rather than defaulted when the caller says nothing, so the
          // column's `family` default is what applies. Sending it explicitly
          // would work today and would quietly become the authority the day the
          // column's default changed.
          ...(visibility ? { visibility } : {}),
          created_by: session.user?.id ?? null,
        })
        .select(MEMORY_COLUMNS)
        .maybeSingle<MemoryRow>();

      return { data: data ? toMemory(data) : null, error };
    },

    async getMemory(memoryId) {
      // `maybeSingle`, not `single`: a row the policy hides is a legitimate
      // answer, and `single` would turn it into an error the caller cannot
      // distinguish from a real one.
      const { data, error } = await client
        .from('memories')
        .select(MEMORY_COLUMNS)
        .eq('id', memoryId)
        .maybeSingle<MemoryRow>();

      return { data: data ? toMemory(data) : null, error };
    },

    async setTitle(memoryId, title) {
      const { error } = await client.from('memories').update({ title }).eq('id', memoryId);
      return { error };
    },

    async setStory(memoryId, story) {
      const { error } = await client.from('memories').update({ story }).eq('id', memoryId);
      return { error };
    },

    // Date and precision are written together, in one statement, because they
    // are one fact — see `setMemoryDate`.
    async setOccurredOn(memoryId, occurredOn, precision) {
      const { error } = await client
        .from('memories')
        .update({ occurred_on: occurredOn, occurred_precision: precision })
        .eq('id', memoryId);

      return { error };
    },

    async setLocation(memoryId, location) {
      const { error } = await client.from('memories').update({ location }).eq('id', memoryId);
      return { error };
    },

    async setMember(memoryId, memberId) {
      const { error } = await client
        .from('memories')
        .update({ member_id: memberId })
        .eq('id', memoryId);

      return { error };
    },

    // No `.eq('created_by', …)` guard. The UPDATE policy already keys on it, and
    // adding the same condition here would mean two places decide who may share
    // a memory — with only one of them tested by the RLS suite.
    async setVisibility(memoryId, visibility) {
      const { error } = await client.from('memories').update({ visibility }).eq('id', memoryId);
      return { error };
    },

    async setAiProcessing(memoryId, aiProcessing) {
      const { error } = await client
        .from('memories')
        .update({ ai_processing: aiProcessing })
        .eq('id', memoryId);

      return { error };
    },

    async archiveMemory(memoryId, archived) {
      const { error } = await client
        .from('memories')
        .update({ archived_at: archived ? new Date().toISOString() : null })
        .eq('id', memoryId);

      return { error };
    },

    // A hard delete. `memories.deleted_at` exists and the SELECT policy already
    // filters on it, but nothing sets it: soft delete needs a restore interface
    // to mean anything, and shipping the column without one would be a
    // capability with no way to reach it — the mistake this project has made
    // five times. Same standing gap as `documents`.
    async deleteMemory(memoryId) {
      const { error } = await client.from('memories').delete().eq('id', memoryId);
      return { error };
    },

    async listPeople(memoryId) {
      const { data, error } = await client
        .from('memory_members')
        .select('member_id')
        .eq('memory_id', memoryId)
        .returns<{ member_id: string }[]>();

      return { data: data ? data.map((row) => row.member_id) : null, error };
    },

    async linkPerson({ memoryId, memberId, familyId }) {
      const { error } = await client
        .from('memory_members')
        .insert({ memory_id: memoryId, member_id: memberId, family_id: familyId });

      return { error };
    },

    async unlinkPerson(memoryId, memberId) {
      const { error } = await client
        .from('memory_members')
        .delete()
        .eq('memory_id', memoryId)
        .eq('member_id', memberId);

      return { error };
    },
  };
}
