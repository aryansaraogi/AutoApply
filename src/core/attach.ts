/**
 * Attaching a stored résumé to a form's file input.
 *
 * A file input's `files` property is normally read-only to script, but it
 * accepts a FileList built through DataTransfer — the same object drag-and-drop
 * uses. That is the one supported way to put a file on a form without a user
 * picking it, and it is what makes the last manual step of an application go
 * away.
 *
 * The attach is still deliberately narrow: only inputs the label identifies as a
 * résumé are touched. A transcript, a portfolio, or a photo upload is left alone.
 */

import { canonicalize, normalizeAttribute } from './normalize';
import type { ApplyOutcome } from './setValue';
import type { FieldDescriptor } from './types';

export type FileFieldKind = 'resume' | 'cover-letter' | 'other';

const RESUME_PATTERNS = [/\bresume\b/, /\bcv\b/, /\bcurriculum\b/];
const COVER_LETTER_PATTERNS = [/\bcover letter\b/, /\bcovering letter\b/];

/**
 * Works out what a file input is asking for.
 *
 * Cover letter is checked first: "Upload your resume and cover letter" is one
 * field on some forms, and the safe reading of an ambiguous upload is to leave
 * it to the user rather than push a résumé at it.
 */
export function classifyFileField(field: FieldDescriptor): FileFieldKind {
  const haystack = `${field.normalizedLabel} ${normalizeAttribute(
    `${field.name} ${field.domId}`,
  )} ${canonicalize(field.placeholder)}`;

  if (COVER_LETTER_PATTERNS.some((pattern) => pattern.test(haystack))) return 'cover-letter';
  if (RESUME_PATTERNS.some((pattern) => pattern.test(haystack))) return 'resume';
  return 'other';
}

export interface ResumePayload {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
}

export function attachFile(field: FieldDescriptor, payload: ResumePayload): ApplyOutcome {
  const input = field.element;
  if (!(input instanceof HTMLInputElement) || input.type !== 'file') {
    return { ok: false, reason: 'Not a file input.' };
  }

  // A form may restrict what it takes; pushing a .docx at a PDF-only field would
  // fail validation on submit, which the user would not discover until then.
  const rejection = acceptRejection(input.accept, payload);
  if (rejection) return { ok: false, reason: rejection };

  let list: FileList;
  try {
    const transfer = new DataTransfer();
    // The Uint8Array is copied into a fresh buffer: passing a view backed by a
    // larger ArrayBuffer would attach the whole buffer, not just this file.
    const blob = new Blob([payload.bytes.slice()], { type: payload.mimeType });
    transfer.items.add(new File([blob], payload.filename, { type: payload.mimeType }));
    list = transfer.files;
  } catch {
    return { ok: false, reason: 'This browser would not let AutoApply build the file.' };
  }

  try {
    input.files = list;
  } catch {
    return { ok: false, reason: 'The form would not accept an attached file — upload it yourself.' };
  }

  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));

  return input.files?.length === 1
    ? { ok: true }
    : { ok: false, reason: 'The form cleared the attachment — upload it yourself.' };
}

/**
 * Checks the file against the input's `accept` list. Returns a reason string
 * when it would be rejected, or null when it is fine (or unconstrained).
 */
function acceptRejection(accept: string, payload: ResumePayload): string | null {
  const tokens = accept
    .split(',')
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
  if (tokens.length === 0) return null;

  const extension = payload.filename.slice(payload.filename.lastIndexOf('.')).toLowerCase();
  const mime = payload.mimeType.toLowerCase();

  const permitted = tokens.some((token) => {
    if (token === '*/*') return true;
    if (token.startsWith('.')) return token === extension;
    if (token.endsWith('/*')) return mime.startsWith(token.slice(0, -1));
    return token === mime;
  });

  return permitted
    ? null
    : `This field only accepts ${accept} — your ${extension} résumé does not match.`;
}
