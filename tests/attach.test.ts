/**
 * Résumé attachment.
 *
 * The decision of *which* upload to touch is the safety-critical half and is
 * pure, so it is covered here. Actually writing a FileList needs DataTransfer,
 * which jsdom does not implement — the real attach is verified in a browser by
 * `npm run drive`. What is asserted here is that a missing DataTransfer degrades
 * to a reported failure rather than an exception that would abort the fill.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { classifyFileField } from '@/core/attach';
import { fillFields } from '@/core/fill';
import { harvest } from '@/core/harvest';
import type { ResumePayload } from '@/core/attach';
import type { FieldReport } from '@/core/types';
import { emptyProfile } from '@/storage/schema';
import { mount } from './helpers';

const RESUME: ResumePayload = {
  filename: 'ada-lovelace.pdf',
  mimeType: 'application/pdf',
  bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]), // "%PDF"
};

function fileField(html: string) {
  mount(html);
  const field = harvest(document).find((f) => f.kind === 'file');
  if (!field) throw new Error('fixture produced no file field');
  return field;
}

async function fillWith(html: string, resume: ResumePayload | null): Promise<FieldReport> {
  mount(html);
  const result = await fillFields(
    harvest(document),
    emptyProfile(),
    { overwrite: false },
    undefined,
    resume,
  );
  const upload = result.reports.find((r) => r.kind === 'file');
  if (!upload) throw new Error('no file report');
  return upload;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('classifyFileField', () => {
  const cases: [string, string][] = [
    ['Resume', 'resume'],
    ['Resume/CV *', 'resume'],
    ['Upload your CV', 'resume'],
    ['Curriculum Vitae', 'resume'],
    ['Cover Letter', 'cover-letter'],
    ['Covering letter (optional)', 'cover-letter'],
    ['Portfolio', 'other'],
    ['Transcript', 'other'],
    ['Profile photo', 'other'],
    ['Work sample', 'other'],
  ];

  for (const [label, expected] of cases) {
    it(`treats "${label}" as ${expected}`, () => {
      const field = fileField(`<label for="f">${label}</label><input id="f" type="file" />`);
      expect(classifyFileField(field)).toBe(expected);
    });
  }

  it('reads the name attribute when there is no label', () => {
    const field = fileField(`<input id="f" type="file" name="candidate_resume" />`);
    expect(classifyFileField(field)).toBe('resume');
  });

  it('defers a combined résumé-and-cover-letter upload to the user', () => {
    // Ambiguous: pushing a résumé at a field that also wants a cover letter is
    // the kind of guess that puts the wrong document in front of an employer.
    const field = fileField(
      `<label for="f">Upload your resume and cover letter</label><input id="f" type="file" />`,
    );
    expect(classifyFileField(field)).toBe('cover-letter');
  });
});

describe('which uploads get touched', () => {
  it('skips a cover-letter upload even when a résumé is available', async () => {
    const report = await fillWith(
      `<label for="f">Cover Letter</label><input id="f" type="file" />`,
      RESUME,
    );
    expect(report.status).toBe('unsupported');
    expect(report.reason).toMatch(/cover letter/i);
  });

  it('skips an unrelated upload', async () => {
    const report = await fillWith(
      `<label for="f">Transcript</label><input id="f" type="file" />`,
      RESUME,
    );
    expect(report.status).toBe('unsupported');
    expect(report.reason).toMatch(/only attaches résumés/i);
  });

  it('reports a missing résumé as something the user still has to do', async () => {
    const report = await fillWith(`<label for="f">Resume</label><input id="f" type="file" />`, null);
    expect(report.status).toBe('no-value');
    expect(report.reason).toMatch(/no résumé saved/i);
  });
});

describe('respecting the form’s accept list', () => {
  it('refuses when the field does not take the stored file type', async () => {
    const report = await fillWith(
      `<label for="f">Resume</label><input id="f" type="file" accept=".doc,.docx" />`,
      RESUME,
    );
    expect(report.status).toBe('failed');
    expect(report.reason).toMatch(/only accepts/i);
  });

  it('proceeds when the extension is listed', async () => {
    const report = await fillWith(
      `<label for="f">Resume</label><input id="f" type="file" accept=".pdf,.docx" />`,
      RESUME,
    );
    // jsdom has no DataTransfer, so this cannot reach 'filled' here — the point
    // is that it got past the accept check rather than being refused for type.
    expect(report.reason ?? '').not.toMatch(/only accepts/i);
  });

  it('proceeds for a wildcard mime accept', async () => {
    const report = await fillWith(
      `<label for="f">Resume</label><input id="f" type="file" accept="application/*" />`,
      RESUME,
    );
    expect(report.reason ?? '').not.toMatch(/only accepts/i);
  });
});

describe('degrading without DataTransfer', () => {
  it('reports a failure instead of throwing when the FileList cannot be built', async () => {
    const report = await fillWith(
      `<label for="f">Resume</label><input id="f" type="file" />`,
      RESUME,
    );
    // The whole fill must survive; only this one field is marked failed.
    expect(report.status).toBe('failed');
    expect(report.reason).toBeTruthy();
  });

  it('does not abort the rest of the fill', async () => {
    mount(`
      <form>
        <label for="f">Resume</label><input id="f" type="file" />
        <label for="e">Email</label><input id="e" />
      </form>
    `);
    const result = await fillFields(
      harvest(document),
      { ...emptyProfile(), email: 'ada@example.com' },
      { overwrite: false },
      undefined,
      RESUME,
    );
    expect((document.getElementById('e') as HTMLInputElement).value).toBe('ada@example.com');
    expect(result.filled).toBe(1);
  });
});
