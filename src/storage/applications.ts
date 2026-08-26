/**
 * The application log — and the job tracker built on it.
 *
 * A record starts life automatically when AutoApply fills a form, then becomes
 * the user's to manage: they move it along the pipeline and keep notes on it.
 * Those two roles are why `stage` is a single user-owned field rather than a
 * pair of automatic and manual statuses — the extension only ever *advances a
 * draft to applied*, and never overwrites a stage the user has set.
 */

const LOG_KEY = 'applications';

/** Keep storage bounded. chrome.storage.local is generous but not infinite. */
const MAX_RECORDS = 1000;

/** Re-filling the same posting within this window updates the existing record
 *  instead of appending a duplicate. Users routinely fill, fix something, and
 *  fill again — that is one application, not three. */
const DEDUPE_WINDOW_MS = 12 * 60 * 60 * 1000;

export type Stage =
  /** Form filled, not yet sent. */
  | 'draft'
  | 'applied'
  | 'screening'
  | 'interview'
  | 'offer'
  | 'rejected'
  | 'withdrawn';

export const STAGES: readonly Stage[] = [
  'draft',
  'applied',
  'screening',
  'interview',
  'offer',
  'rejected',
  'withdrawn',
];

export const STAGE_LABELS: Record<Stage, string> = {
  draft: 'Draft',
  applied: 'Applied',
  screening: 'Screening',
  interview: 'Interview',
  offer: 'Offer',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
};

/** Stages that mean the application is over, for filtering and de-emphasis. */
export const CLOSED_STAGES: readonly Stage[] = ['rejected', 'withdrawn'];

export interface ApplicationRecord {
  id: string;
  company: string;
  role: string;
  url: string;
  host: string;
  createdAt: number;
  updatedAt: number;
  stage: Stage;
  /** When the stage last changed — "sitting in screening for 3 weeks". */
  stageChangedAt: number;
  fieldsFilled: number;
  fieldsSkipped: number;
  notes: string;
  /**
   * Set once the user corrects the company or role by hand. Re-filling the same
   * posting refreshes a record for twelve hours, and without this the extension's
   * own guess would overwrite the correction the user made precisely because the
   * guess was wrong.
   */
  editedByUser: boolean;
}

export interface FillEvent {
  company: string;
  role: string;
  url: string;
  fieldsFilled: number;
  fieldsSkipped: number;
}

/**
 * Serialises the read-modify-write cycles below.
 *
 * Every mutator here reads the whole log, changes one field, and writes the
 * whole log back. Two of those in flight at once both start from the same
 * snapshot, so the later write carries a stale copy of the other's field and
 * silently reverts it. Blurring a tracker row's role, company and notes in the
 * same task loses the first two every time. Chaining the mutations onto one
 * promise makes each of them read what the previous one wrote.
 *
 * This covers the collisions that happen in practice, because every tracker
 * edit runs in the tracker page. Two extension contexts writing at the same
 * instant — a fill recording a record while the tracker is open — would still
 * race, and chrome.storage offers no compare-and-swap to prevent it; they touch
 * different records, so the window is narrow and the cost is a stale field
 * rather than a lost row.
 */
let mutations: Promise<unknown> = Promise.resolve();

function serialise<T>(work: () => Promise<T>): Promise<T> {
  const run = mutations.then(work, work);
  // Swallow here only so one failed mutation cannot break the chain for the
  // next; the caller still sees its own rejection through `run`.
  mutations = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function listApplications(): Promise<ApplicationRecord[]> {
  const stored = await chrome.storage.local.get(LOG_KEY);
  const raw = stored[LOG_KEY];
  if (!Array.isArray(raw)) return [];
  return raw
    .map(migrate)
    .filter((record): record is ApplicationRecord => record !== null)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Records a fill, or refreshes the recent record for the same URL. Returns the
 *  record id so the content script can later advance it to "applied". */
export function recordFill(event: FillEvent): Promise<string> {
  return serialise(async () => {
    const records = await listApplications();
    const now = Date.now();
    const existing = records.find(
      (r) => r.url === event.url && now - r.createdAt < DEDUPE_WINDOW_MS,
    );

    if (existing) {
      existing.updatedAt = now;
      existing.fieldsFilled = event.fieldsFilled;
      existing.fieldsSkipped = event.fieldsSkipped;
      // Company/role can improve on a second pass once a SPA has finished
      // rendering — but never overwrite a correction the user typed themselves.
      if (event.company && !existing.editedByUser) existing.company = event.company;
      if (event.role && !existing.editedByUser) existing.role = event.role;
      await write(records);
      return existing.id;
    }

    const record: ApplicationRecord = {
      id: crypto.randomUUID(),
      company: event.company,
      role: event.role,
      url: event.url,
      host: safeHost(event.url),
      createdAt: now,
      updatedAt: now,
      stage: 'draft',
      stageChangedAt: now,
      fieldsFilled: event.fieldsFilled,
      fieldsSkipped: event.fieldsSkipped,
      notes: '',
      editedByUser: false,
    };
    await write([record, ...records]);
    return record.id;
  });
}

/**
 * Advances a draft to "applied" after a detected submit.
 *
 * Best-effort and deliberately one-way: it fires on a form submit event or a
 * click on a submit-looking button, so a single-page app that posts via fetch
 * will leave the record in draft. It never moves a record the user has already
 * moved themselves — an interview does not get demoted back to applied because
 * the page happened to fire another submit.
 */
export function markSubmitted(id: string): Promise<void> {
  return serialise(async () => {
    const records = await listApplications();
    const record = records.find((r) => r.id === id);
    if (!record || record.stage !== 'draft') return;
    record.stage = 'applied';
    record.stageChangedAt = Date.now();
    record.updatedAt = Date.now();
    await write(records);
  });
}

export function setStage(id: string, stage: Stage): Promise<void> {
  return serialise(async () => {
    const records = await listApplications();
    const record = records.find((r) => r.id === id);
    if (!record || record.stage === stage) return;
    record.stage = stage;
    record.stageChangedAt = Date.now();
    record.updatedAt = Date.now();
    await write(records);
  });
}

/**
 * Corrects the company or role.
 *
 * Extraction is a guess against pages that were never built to be read this
 * way, so the user gets the final say. An empty string is a legitimate value —
 * it clears a wrong guess.
 */
export function updateApplication(
  id: string,
  patch: { company?: string; role?: string },
): Promise<void> {
  return serialise(async () => {
    const records = await listApplications();
    const record = records.find((r) => r.id === id);
    if (!record) return;
    if (patch.company !== undefined) record.company = patch.company.trim();
    if (patch.role !== undefined) record.role = patch.role.trim();
    record.editedByUser = true;
    record.updatedAt = Date.now();
    await write(records);
  });
}

export function updateNotes(id: string, notes: string): Promise<void> {
  return serialise(async () => {
    const records = await listApplications();
    const record = records.find((r) => r.id === id);
    if (!record) return;
    record.notes = notes;
    record.updatedAt = Date.now();
    await write(records);
  });
}

export function deleteApplication(id: string): Promise<void> {
  return serialise(async () => {
    const records = await listApplications();
    await write(records.filter((r) => r.id !== id));
  });
}

export async function clearApplications(): Promise<void> {
  await chrome.storage.local.remove(LOG_KEY);
}

export function countByStage(records: readonly ApplicationRecord[]): Record<Stage, number> {
  const counts = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<Stage, number>;
  for (const record of records) counts[record.stage]++;
  return counts;
}

export function toCsv(records: readonly ApplicationRecord[]): string {
  const header = [
    'Applied',
    'Company',
    'Role',
    'Stage',
    'Stage changed',
    'Fields filled',
    'Fields skipped',
    'URL',
    'Notes',
  ];
  const rows = records.map((r) => [
    new Date(r.createdAt).toISOString(),
    r.company,
    r.role,
    STAGE_LABELS[r.stage],
    new Date(r.stageChangedAt).toISOString(),
    String(r.fieldsFilled),
    String(r.fieldsSkipped),
    r.url,
    r.notes,
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}

function csvCell(value: string): string {
  // A leading =, +, - or @ makes spreadsheet apps treat the cell as a formula.
  const guarded = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${guarded.replace(/"/g, '""')}"`;
}

async function write(records: ApplicationRecord[]): Promise<void> {
  const trimmed = [...records].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_RECORDS);
  await chrome.storage.local.set({ [LOG_KEY]: trimmed });
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

/**
 * Brings a stored record up to the current shape.
 *
 * Records written before the tracker existed carry `status: 'filled' | 'submitted'`
 * rather than a pipeline stage. Mapping them here rather than in a one-off
 * upgrade step means a record written by an older version — or restored from an
 * export — is always readable.
 */
function migrate(value: unknown): ApplicationRecord | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<ApplicationRecord> & { status?: string };
  if (typeof raw.id !== 'string' || typeof raw.url !== 'string') return null;

  const createdAt = typeof raw.createdAt === 'number' ? raw.createdAt : Date.now();
  const stage = normalizeStage(raw.stage, raw.status);

  return {
    id: raw.id,
    company: raw.company ?? '',
    role: raw.role ?? '',
    url: raw.url,
    host: raw.host ?? safeHost(raw.url),
    createdAt,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : createdAt,
    stage,
    stageChangedAt:
      typeof raw.stageChangedAt === 'number' ? raw.stageChangedAt : (raw.updatedAt ?? createdAt),
    fieldsFilled: typeof raw.fieldsFilled === 'number' ? raw.fieldsFilled : 0,
    fieldsSkipped: typeof raw.fieldsSkipped === 'number' ? raw.fieldsSkipped : 0,
    notes: typeof raw.notes === 'string' ? raw.notes : '',
    // Records written before corrections were tracked default to untouched: the
    // stored company and role are whatever extraction produced.
    editedByUser: raw.editedByUser === true,
  };
}

function normalizeStage(stage: unknown, legacyStatus: unknown): Stage {
  if (typeof stage === 'string' && (STAGES as readonly string[]).includes(stage)) {
    return stage as Stage;
  }
  if (legacyStatus === 'submitted') return 'applied';
  return 'draft';
}
