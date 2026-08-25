import '../shared.css';
import './options.css';

import {
  GROUP_LABELS,
  GROUP_ORDER,
  PROFILE_FIELDS,
  PROFILE_KEYS,
  normalizeProfile,
  type FieldGroup,
  type Profile,
  type ProfileFieldSpec,
  type ProfileKey,
} from '@/storage/schema';
import { clearProfile, loadProfile, saveProfile } from '@/storage/profile';
import { loadSettings, saveSettings } from '@/storage/settings';
import {
  hasAllSiteAccess,
  requestAllSiteAccess,
  revokeAllSiteAccess,
} from '@/storage/permissions';
import {
  addResume,
  deleteResume,
  formatBytes,
  listResumes,
  renameResume,
  setDefaultResume,
  type ResumeMeta,
} from '@/storage/resumes';

const SAVE_DEBOUNCE_MS = 400;

/** A field gets its own full row when a cramped column would make it unusable. */
function isWide(spec: ProfileFieldSpec): boolean {
  if (spec.control === 'textarea') return true;
  if (spec.label.length > 38) return true;
  return (spec.options ?? []).some((o) => o.length > 30);
}

function must<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  for (const child of children) node.append(child);
  return node;
}

// ── profile form ────────────────────────────────────────────────────────────

function buildControl(spec: ProfileFieldSpec, value: string): HTMLElement {
  const id = `field-${spec.key}`;

  if (spec.control === 'textarea') {
    return el('textarea', { id, name: spec.key, value, rows: 8 });
  }

  if (spec.control === 'select') {
    const select = el('select', { id, name: spec.key });
    select.append(el('option', { value: '', textContent: '— not answered —' }));
    for (const option of spec.options ?? []) {
      select.append(el('option', { value: option, textContent: option }));
    }
    // Tolerates a stored value that is no longer in the option list.
    if (value && !(spec.options ?? []).includes(value)) {
      select.append(el('option', { value, textContent: `${value} (custom)` }));
    }
    select.value = value;
    return select;
  }

  return el('input', {
    id,
    name: spec.key,
    type: spec.control,
    value,
    placeholder: spec.placeholder ?? '',
  });
}

function buildField(spec: ProfileFieldSpec, value: string): HTMLElement {
  const wrapper = el('div', { className: isWide(spec) ? 'field field-wide' : 'field' });
  wrapper.append(
    el('label', { htmlFor: `field-${spec.key}`, textContent: spec.label }),
    buildControl(spec, value),
  );
  if (spec.help) {
    wrapper.append(el('p', { className: 'muted small field-help', textContent: spec.help }));
  }
  return wrapper;
}

function buildGroup(group: FieldGroup, profile: Profile): HTMLElement {
  const fieldset = el('fieldset', { id: `group-${group}` });
  fieldset.append(el('legend', { textContent: GROUP_LABELS[group] }));

  const grid = el('div', { className: 'field-grid' });
  for (const spec of PROFILE_FIELDS) {
    if (spec.group !== group) continue;
    grid.append(buildField(spec, profile[spec.key as ProfileKey]));
  }
  fieldset.append(grid);
  return fieldset;
}

function buildNav(): void {
  const nav = must<HTMLElement>('group-nav');
  for (const group of GROUP_ORDER) {
    nav.append(el('a', { href: `#group-${group}`, textContent: GROUP_LABELS[group] }));
  }
}

// ── save plumbing ───────────────────────────────────────────────────────────

const status = {
  node: null as HTMLElement | null,
  timer: 0,
  show(text: string) {
    this.node ??= must<HTMLElement>('save-status');
    this.node.textContent = text;
    clearTimeout(this.timer);
    if (text) this.timer = window.setTimeout(() => this.show(''), 2000);
  },
};

function collectProfile(form: HTMLFormElement): Profile {
  const data = new FormData(form);
  const profile = {} as Profile;
  for (const spec of PROFILE_FIELDS) {
    const value = data.get(spec.key);
    profile[spec.key as ProfileKey] = typeof value === 'string' ? value : '';
  }
  return profile;
}

function debounce(fn: () => void, ms: number): () => void {
  let timer = 0;
  return () => {
    clearTimeout(timer);
    timer = window.setTimeout(fn, ms);
  };
}

// ── résumés ─────────────────────────────────────────────────────────────────

function resumeItem(resume: ResumeMeta, refresh: () => Promise<void>): HTMLElement {
  const item = el('li', { className: resume.isDefault ? 'resume-item is-default' : 'resume-item' });

  const label = el('input', {
    type: 'text',
    className: 'resume-label',
    value: resume.label,
    ariaLabel: `Name for ${resume.filename}`,
  });
  label.addEventListener(
    'change',
    () => void renameResume(resume.id, label.value).then(() => status.show('Saved')),
  );

  const actions = el('div', { className: 'resume-actions' });

  if (resume.isDefault) {
    actions.append(el('span', { className: 'pill ok', textContent: 'Default' }));
  } else {
    const makeDefault = el('button', { type: 'button', textContent: 'Use by default' });
    makeDefault.addEventListener('click', async () => {
      await setDefaultResume(resume.id);
      await refresh();
      status.show('Saved');
    });
    actions.append(makeDefault);
  }

  const remove = el('button', { type: 'button', className: 'danger', textContent: 'Remove' });
  remove.addEventListener('click', async () => {
    if (!confirm(`Remove "${resume.label}"?`)) return;
    await deleteResume(resume.id);
    await refresh();
    status.show('Removed');
  });
  actions.append(remove);

  const meta = el('p', {
    className: 'resume-meta',
    textContent: `${resume.filename} · ${formatBytes(resume.sizeBytes)} · added ${new Date(
      resume.addedAt,
    ).toLocaleDateString()}`,
  });

  item.append(label, actions, meta);
  return item;
}

async function wireResumes(): Promise<void> {
  const list = must<HTMLUListElement>('resume-list');
  const empty = must<HTMLElement>('resume-empty');
  const fileInput = must<HTMLInputElement>('resume-file');
  const addButton = must<HTMLButtonElement>('resume-add');
  const error = must<HTMLElement>('resume-error');

  const refresh = async () => {
    const resumes = await listResumes();
    list.replaceChildren(...resumes.map((resume) => resumeItem(resume, refresh)));
    empty.hidden = resumes.length > 0;
  };

  addButton.addEventListener('click', async () => {
    error.textContent = '';
    const file = fileInput.files?.[0];
    if (!file) {
      error.textContent = 'Choose a file first.';
      return;
    }

    addButton.disabled = true;
    try {
      await addResume(file);
      fileInput.value = '';
      await refresh();
      status.show('Résumé saved');
    } catch (failure) {
      error.textContent = failure instanceof Error ? failure.message : 'Could not save that file.';
    } finally {
      addButton.disabled = false;
    }
  });

  await refresh();
}

// ── settings section ────────────────────────────────────────────────────────

async function wireSettings(): Promise<void> {
  const settings = await loadSettings();

  const highlight = must<HTMLSelectElement>('opt-highlight');
  const track = must<HTMLSelectElement>('opt-track');

  highlight.value = settings.highlightFills ? 'on' : 'off';
  track.value = settings.trackSubmissions ? 'on' : 'off';

  await wireAllSites();

  highlight.addEventListener('change', async () => {
    await saveSettings({ highlightFills: highlight.value === 'on' });
    status.show('Saved');
  });
  track.addEventListener('change', async () => {
    await saveSettings({ trackSubmissions: track.value === 'on' });
    status.show('Saved');
  });
}

/**
 * The one-off grant covering every site.
 *
 * Not a stored setting — it reads and writes the browser's actual permission, so
 * it stays honest if the user revokes access from the browser's own controls.
 */
async function wireAllSites(): Promise<void> {
  const select = must<HTMLSelectElement>('opt-allsites');
  const help = must<HTMLElement>('allsites-help');

  const render = (granted: boolean) => {
    select.value = granted ? 'on' : 'off';
    help.textContent = granted
      ? 'AutoApply can read and fill any page you open. Switch back to stop that ' +
        'immediately — nothing is kept.'
      : 'On other sites you will be asked each time, and Chrome hides the address until ' +
        'you agree, so it cannot ask for one site by name.';
  };

  render(await hasAllSiteAccess());

  select.addEventListener('change', async () => {
    // Both calls need the click that triggered this event, so neither may be
    // awaited behind anything else first.
    const wanted = select.value === 'on';
    const ok = wanted ? await requestAllSiteAccess() : await revokeAllSiteAccess();
    if (ok) status.show(wanted ? 'Access granted' : 'Access removed');
    render(await hasAllSiteAccess());
  });

  // Keep in step with changes made from the browser's own extension controls.
  chrome.permissions.onAdded.addListener(() => void hasAllSiteAccess().then(render));
  chrome.permissions.onRemoved.addListener(() => void hasAllSiteAccess().then(render));
}

// ── backup ──────────────────────────────────────────────────────────────────

/**
 * Export and import the profile as JSON.
 *
 * Profiles live in per-browser storage, so a second machine — or a fresh
 * unpacked install — starts empty, and retyping forty fields is the single most
 * tedious thing about this extension. Résumé bytes are left out: they would
 * dwarf the rest of the file, and re-adding one is a single click.
 *
 * @param rerender Redraws the form from storage after an import.
 */
function wireBackup(rerender: () => Promise<void>): void {
  const statusLine = must<HTMLElement>('backup-status');
  const picker = must<HTMLInputElement>('import-file');

  const say = (text: string, tone: '' | 'ok' | 'error' = '') => {
    statusLine.className = `small backup-status ${tone}`.trim();
    statusLine.textContent = text;
  };

  must<HTMLButtonElement>('export-profile').addEventListener('click', async () => {
    const profile = await loadProfile();
    const filled = PROFILE_KEYS.filter((key) => profile[key].trim() !== '').length;

    const blob = new Blob([JSON.stringify(profile, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = el('a', {
      href: url,
      download: `autoapply-profile-${new Date().toISOString().slice(0, 10)}.json`,
    });
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);

    say(`Exported ${filled} filled field${filled === 1 ? '' : 's'}.`, 'ok');
  });

  must<HTMLButtonElement>('import-profile').addEventListener('click', () => picker.click());

  picker.addEventListener('change', async () => {
    const file = picker.files?.[0];
    // Reset immediately so choosing the same file twice still fires a change.
    picker.value = '';
    if (!file) return;

    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        say('That file does not look like a profile export.', 'error');
        return;
      }

      // normalizeProfile drops unknown keys and coerces types, so a hand-edited
      // or stale export cannot put junk into the fill engine.
      const incoming = normalizeProfile(parsed);
      const filled = PROFILE_KEYS.filter((key) => incoming[key].trim() !== '').length;
      if (filled === 0) {
        say('That file has no recognisable profile fields in it.', 'error');
        return;
      }

      if (!confirm(`Replace your profile with ${filled} field(s) from this file?`)) return;

      await saveProfile(incoming);
      await rerender();
      say(`Imported ${filled} field${filled === 1 ? '' : 's'}.`, 'ok');
    } catch {
      say('Could not read that file — it is not valid JSON.', 'error');
    }
  });
}

// ── boot ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const form = must<HTMLFormElement>('profile-form');
  const profile = await loadProfile();

  buildNav();
  for (const group of GROUP_ORDER) form.append(buildGroup(group, profile));

  const rerender = async (): Promise<void> => {
    const current = await loadProfile();
    form.replaceChildren();
    for (const group of GROUP_ORDER) form.append(buildGroup(group, current));
  };

  const persist = debounce(async () => {
    await saveProfile(collectProfile(form));
    status.show('Saved');
  }, SAVE_DEBOUNCE_MS);

  form.addEventListener('input', persist);
  form.addEventListener('change', persist);
  form.addEventListener('submit', (event) => event.preventDefault());

  must<HTMLButtonElement>('clear-profile').addEventListener('click', async () => {
    if (!confirm('Clear every profile field? Your application history is kept.')) return;
    await clearProfile();
    await rerender();
    status.show('Profile cleared');
  });

  wireBackup(rerender);
  await wireResumes();
  await wireSettings();
}

void main();
