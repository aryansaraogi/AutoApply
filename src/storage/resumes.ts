/**
 * Résumé file storage.
 *
 * Bytes are kept under a key of their own, separate from the metadata list, so
 * that rendering the résumé picker or the tracker does not pull several
 * megabytes of base64 through chrome.storage for no reason. Only the fill pass
 * ever reads a file body, and only the one it is about to attach.
 */

const INDEX_KEY = 'resumes';
const BODY_PREFIX = 'resume:';

/** chrome.storage.local is byte-limited; refuse anything absurd up front. */
export const MAX_FILE_BYTES = 8 * 1024 * 1024;

export const ACCEPTED_EXTENSIONS = ['.pdf', '.docx', '.doc', '.rtf', '.txt'] as const;

/** Maps an extension to the MIME type a form expects, since a File built from
 *  stored bytes has whatever type we give it — and some ATS validate on it. */
const MIME_BY_EXTENSION: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.rtf': 'application/rtf',
  '.txt': 'text/plain',
};

export interface ResumeMeta {
  id: string;
  /** What the user calls it — "Backend roles", "2026 general". */
  label: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  addedAt: number;
  /** The one attached when nothing more specific applies. */
  isDefault: boolean;
}

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? '' : filename.slice(dot).toLowerCase();
}

export function isAcceptedFile(filename: string): boolean {
  return (ACCEPTED_EXTENSIONS as readonly string[]).includes(extensionOf(filename));
}

export function mimeFor(filename: string, fallback = 'application/octet-stream'): string {
  return MIME_BY_EXTENSION[extensionOf(filename)] ?? fallback;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── index ───────────────────────────────────────────────────────────────────

export async function listResumes(): Promise<ResumeMeta[]> {
  const stored = await chrome.storage.local.get(INDEX_KEY);
  const raw = stored[INDEX_KEY];
  if (!Array.isArray(raw)) return [];
  return raw.filter(isMeta).sort((a, b) => b.addedAt - a.addedAt);
}

export async function defaultResume(): Promise<ResumeMeta | null> {
  const all = await listResumes();
  return all.find((r) => r.isDefault) ?? all[0] ?? null;
}

export async function getResumeBytes(id: string): Promise<Uint8Array | null> {
  const stored = await chrome.storage.local.get(BODY_PREFIX + id);
  const base64 = stored[BODY_PREFIX + id];
  return typeof base64 === 'string' ? base64ToBytes(base64) : null;
}

/**
 * Stores a file and returns its metadata. The first résumé added becomes the
 * default, so a user who only ever adds one never has to think about it.
 */
export async function addResume(file: File, label?: string): Promise<ResumeMeta> {
  if (!isAcceptedFile(file.name)) {
    throw new Error(`${extensionOf(file.name) || 'That file type'} is not supported.`);
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`That file is ${formatBytes(file.size)}; the limit is ${formatBytes(MAX_FILE_BYTES)}.`);
  }

  const existing = await listResumes();
  const meta: ResumeMeta = {
    id: crypto.randomUUID(),
    label: (label ?? '').trim() || file.name.replace(/\.[^.]+$/, ''),
    filename: file.name,
    mimeType: file.type || mimeFor(file.name),
    sizeBytes: file.size,
    addedAt: Date.now(),
    isDefault: existing.length === 0,
  };

  await chrome.storage.local.set({
    [BODY_PREFIX + meta.id]: await fileToBase64(file),
    [INDEX_KEY]: [meta, ...existing],
  });
  return meta;
}

export async function renameResume(id: string, label: string): Promise<void> {
  const all = await listResumes();
  const target = all.find((r) => r.id === id);
  if (!target) return;
  target.label = label.trim() || target.filename;
  await chrome.storage.local.set({ [INDEX_KEY]: all });
}

export async function setDefaultResume(id: string): Promise<void> {
  const all = await listResumes();
  for (const resume of all) resume.isDefault = resume.id === id;
  await chrome.storage.local.set({ [INDEX_KEY]: all });
}

export async function deleteResume(id: string): Promise<void> {
  const all = await listResumes();
  const remaining = all.filter((r) => r.id !== id);

  // Never leave the set without a default, or the fill pass would silently
  // start skipping uploads.
  if (remaining.length > 0 && !remaining.some((r) => r.isDefault)) {
    (remaining[0] as ResumeMeta).isDefault = true;
  }

  await chrome.storage.local.remove(BODY_PREFIX + id);
  await chrome.storage.local.set({ [INDEX_KEY]: remaining });
}

// ── binary helpers ──────────────────────────────────────────────────────────

/** Chunked so a multi-megabyte file does not blow the argument limit of apply(). */
export async function fileToBase64(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const CHUNK = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function isMeta(value: unknown): value is ResumeMeta {
  if (!value || typeof value !== 'object') return false;
  const meta = value as Partial<ResumeMeta>;
  return typeof meta.id === 'string' && typeof meta.filename === 'string';
}
