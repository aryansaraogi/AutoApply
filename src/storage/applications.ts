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
}

export interface FillEvent {
  company: string;
  role: string;
  url: string;
  fieldsFilled: number;
  fieldsSkipped: number;
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
export async function recordFill(event: FillEvent): Promise<string> {
  const records = await listApplications();
  const now = Date.now();
  const existing = records.find((r) => r.url === event.url && now - r.createdAt < DEDUPE_WINDOW_MS);

  if (existing) {
    existing.updatedAt = now;
    existing.fieldsFilled = event.fieldsFilled;
    existing.fieldsSkipped = event.fieldsSkipped;
    // Company/role can improve on a second pass once a SPA has finished rendering.
    if (event.company) existing.company = event.company;
    if (event.role) existing.role = event.role;
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
  };
  await write([record, ...records]);
  return record.id;
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
export async function markSubmitted(id: string): Promise<void> {
  const records = await listApplications();
  const record = records.find((r) => r.id === id);
  if (!record || record.stage !== 'draft') return;
  record.stage = 'applied';
  record.stageChangedAt = Date.now();
  record.updatedAt = Date.now();
  await write(records);
}

export async function setStage(id: string, stage: Stage): Promise<void> {
  const records = await listApplications();
  const record = records.find((r) => r.id === id);
  if (!record || record.stage === stage) return;
  record.stage = stage;
  record.stageChangedAt = Date.now();
  record.updatedAt = Date.now();
  await write(records);
}

/**
 * Corrects the company or role.
 *
 * Extraction is a guess against pages that were never built to be read this
 * way, so the user gets the final say. An empty string is a legitimate value —
 * it clears a wrong guess.
 */
export async function updateApplication(
  id: string,
  patch: { company?: string; role?: string },
): Promise<void> {
  const records = await listApplications();
  const record = records.find((r) => r.id === id);
  if (!record) return;
  if (patch.company !== undefined) record.company = patch.company.trim();
  if (patch.role !== undefined) record.role = patch.role.trim();
  record.updatedAt = Date.now();
  await write(records);
}

export async function updateNotes(id: string, notes: string): Promise<void> {
  const records = await listApplications();
  const record = records.find((r) => r.id === id);
  if (!record) return;
  record.notes = notes;
  record.updatedAt = Date.now();
  await write(records);
}

export async function deleteApplication(id: string): Promise<void> {
  const records = await listApplications();
  await write(records.filter((r) => r.id !== id));
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
  };
}

function normalizeStage(stage: unknown, legacyStatus: unknown): Stage {
  if (typeof stage === 'string' && (STAGES as readonly string[]).includes(stage)) {
    return stage as Stage;
  }
  if (legacyStatus === 'submitted') return 'applied';
  return 'draft';
}
