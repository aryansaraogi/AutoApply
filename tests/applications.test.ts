/**
 * The job tracker's data layer.
 *
 * The migration matters most: records written before stages existed carry
 * `status: 'filled' | 'submitted'`, and a user upgrading must not lose their
 * history or find it reset to draft.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  countByStage,
  deleteApplication,
  listApplications,
  markSubmitted,
  recordFill,
  setStage,
  toCsv,
  updateApplication,
  updateNotes,
} from '@/storage/applications';

/** Minimal in-memory stand-in for chrome.storage.local. */
function installStorage(seed: Record<string, unknown> = {}): Record<string, unknown> {
  const store: Record<string, unknown> = { ...seed };

  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: store[key] }),
        set: async (items: Record<string, unknown>) => void Object.assign(store, items),
        remove: async (key: string) => void delete store[key],
      },
    },
  });

  if (!globalThis.crypto?.randomUUID) {
    vi.stubGlobal('crypto', { randomUUID: () => `id-${Math.random().toString(36).slice(2)}` });
  }
  return store;
}

const FILL = {
  company: 'Northwind Labs',
  role: 'Platform Engineer',
  url: 'https://boards.greenhouse.io/northwind/jobs/1',
  fieldsFilled: 18,
  fieldsSkipped: 4,
};

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('recording a fill', () => {
  it('creates a draft record', async () => {
    installStorage();
    await recordFill(FILL);

    const [record] = await listApplications();
    expect(record?.stage).toBe('draft');
    expect(record?.company).toBe('Northwind Labs');
    expect(record?.host).toBe('boards.greenhouse.io');
    expect(record?.fieldsFilled).toBe(18);
  });

  it('updates the existing record when the same posting is filled again', async () => {
    installStorage();
    const first = await recordFill(FILL);
    const second = await recordFill({ ...FILL, fieldsFilled: 20 });

    expect(second).toBe(first);
    const records = await listApplications();
    expect(records).toHaveLength(1);
    expect(records[0]?.fieldsFilled).toBe(20);
  });

  it('keeps separate records for different postings', async () => {
    installStorage();
    await recordFill(FILL);
    await recordFill({ ...FILL, url: 'https://jobs.lever.co/acme/2', company: 'Acme' });
    expect(await listApplications()).toHaveLength(2);
  });
});

describe('stage transitions', () => {
  it('advances a draft to applied on a detected submit', async () => {
    installStorage();
    const id = await recordFill(FILL);
    await markSubmitted(id);
    expect((await listApplications())[0]?.stage).toBe('applied');
  });

  it('never drags a later stage backwards', async () => {
    installStorage();
    const id = await recordFill(FILL);
    await setStage(id, 'interview');

    // A second submit event on the same page must not undo the user's progress.
    await markSubmitted(id);

    expect((await listApplications())[0]?.stage).toBe('interview');
  });

  it('lets the user set any stage', async () => {
    installStorage();
    const id = await recordFill(FILL);
    await setStage(id, 'offer');
    expect((await listApplications())[0]?.stage).toBe('offer');
  });

  it('stamps when the stage changed', async () => {
    installStorage();
    const id = await recordFill(FILL);
    const before = (await listApplications())[0]?.stageChangedAt ?? 0;
    await new Promise((r) => setTimeout(r, 5));
    await setStage(id, 'screening');
    expect((await listApplications())[0]?.stageChangedAt).toBeGreaterThan(before);
  });
});

describe('notes and deletion', () => {
  it('stores a note against a record', async () => {
    installStorage();
    const id = await recordFill(FILL);
    await updateNotes(id, 'Referred by Grace');
    expect((await listApplications())[0]?.notes).toBe('Referred by Grace');
  });

  it('deletes a record', async () => {
    installStorage();
    const id = await recordFill(FILL);
    await deleteApplication(id);
    expect(await listApplications()).toHaveLength(0);
  });
});

/**
 * Every mutator reads the whole log and writes the whole log back, so two of
 * them in flight at once used to overwrite each other: blurring a tracker row's
 * role, company and notes in the same task kept only the last one. The symptom
 * was a correction that silently reverted, which is the worst possible failure
 * for a field whose entire purpose is fixing a bad guess.
 */
describe('concurrent edits to one record', () => {
  it('keeps all three when role, company and notes are saved at once', async () => {
    installStorage();
    const id = await recordFill(FILL);

    await Promise.all([
      updateApplication(id, { role: 'Staff Engineer' }),
      updateApplication(id, { company: 'Acme' }),
      updateNotes(id, 'phone screen booked'),
    ]);

    const [record] = await listApplications();
    expect(record?.role).toBe('Staff Engineer');
    expect(record?.company).toBe('Acme');
    expect(record?.notes).toBe('phone screen booked');
  });

  it('does not lose a stage change made while a note is saving', async () => {
    installStorage();
    const id = await recordFill(FILL);

    await Promise.all([updateNotes(id, 'left a voicemail'), setStage(id, 'interview')]);

    const [record] = await listApplications();
    expect(record?.stage).toBe('interview');
    expect(record?.notes).toBe('left a voicemail');
  });

  it('still applies a deletion queued behind an edit', async () => {
    installStorage();
    const id = await recordFill(FILL);

    await Promise.all([updateApplication(id, { role: 'Staff Engineer' }), deleteApplication(id)]);

    expect(await listApplications()).toHaveLength(0);
  });
});

describe('a correction the user typed', () => {
  it('survives the same posting being filled again', async () => {
    installStorage();
    const id = await recordFill(FILL);
    await updateApplication(id, { role: 'Staff Engineer', company: 'Acme' });

    // Within the dedupe window, so this refreshes the record rather than adding
    // one — and would otherwise put the extension's own guess back.
    await recordFill(FILL);

    const [record] = await listApplications();
    expect(record?.role).toBe('Staff Engineer');
    expect(record?.company).toBe('Acme');
    // The counts are the extension's to update, and still should be.
    expect(record?.fieldsFilled).toBe(18);
  });

  it('leaves an untouched record free to improve on a second pass', async () => {
    installStorage();
    await recordFill({ ...FILL, company: '', role: '' });
    await recordFill(FILL);

    const [record] = await listApplications();
    expect(record?.role).toBe('Platform Engineer');
    expect(record?.company).toBe('Northwind Labs');
  });

  it('can clear a wrong guess to an empty string', async () => {
    installStorage();
    const id = await recordFill(FILL);
    await updateApplication(id, { company: '' });
    await recordFill(FILL);

    expect((await listApplications())[0]?.company).toBe('');
  });
});

describe('migrating records from before stages existed', () => {
  it('maps a submitted record to applied', async () => {
    installStorage({
      applications: [
        {
          id: 'old-1',
          company: 'Acme',
          role: 'Engineer',
          url: 'https://jobs.lever.co/acme/1',
          host: 'jobs.lever.co',
          createdAt: 1_700_000_000_000,
          updatedAt: 1_700_000_100_000,
          status: 'submitted',
          fieldsFilled: 12,
          fieldsSkipped: 3,
          notes: 'keep me',
        },
      ],
    });

    const [record] = await listApplications();
    expect(record?.stage).toBe('applied');
    expect(record?.notes).toBe('keep me');
    expect(record?.fieldsFilled).toBe(12);
    expect(record?.stageChangedAt).toBe(1_700_000_100_000);
  });

  it('maps a filled record to draft', async () => {
    installStorage({
      applications: [
        {
          id: 'old-2',
          url: 'https://jobs.lever.co/acme/2',
          createdAt: 1_700_000_000_000,
          status: 'filled',
        },
      ],
    });
    expect((await listApplications())[0]?.stage).toBe('draft');
  });

  it('fills in fields the old record never had', async () => {
    installStorage({
      applications: [{ id: 'old-3', url: 'https://x.test/j', createdAt: 1_700_000_000_000 }],
    });
    const [record] = await listApplications();
    expect(record?.notes).toBe('');
    expect(record?.company).toBe('');
    expect(record?.host).toBe('x.test');
  });

  it('discards entries that are not records at all', async () => {
    installStorage({ applications: [null, 42, { nope: true }, 'text'] });
    expect(await listApplications()).toHaveLength(0);
  });
});

describe('reporting', () => {
  it('counts records by stage', async () => {
    installStorage();
    const a = await recordFill(FILL);
    const b = await recordFill({ ...FILL, url: 'https://x.test/2' });
    await setStage(b, 'rejected');

    const counts = countByStage(await listApplications());
    expect(counts.draft).toBe(1);
    expect(counts.rejected).toBe(1);
    expect(counts.offer).toBe(0);
    expect(a).toBeTruthy();
  });

  it('exports CSV with a header and one row per record', async () => {
    installStorage();
    const id = await recordFill(FILL);
    await updateNotes(id, 'Said "hello", then left');

    const csv = toCsv(await listApplications());
    const [header, ...rows] = csv.split('\r\n');
    expect(header).toContain('Stage');
    expect(rows).toHaveLength(1);
    // Embedded quotes must be doubled, or the row breaks in a spreadsheet.
    expect(rows[0]).toContain('""hello""');
  });

  it('neutralises a note that a spreadsheet would treat as a formula', async () => {
    installStorage();
    const id = await recordFill(FILL);
    await updateNotes(id, '=HYPERLINK("http://evil.test")');

    const csv = toCsv(await listApplications());
    expect(csv).toContain(`"'=HYPERLINK`);
  });
});
