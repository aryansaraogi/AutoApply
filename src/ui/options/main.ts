import '../shared.css';
import './options.css';

import {
  GROUP_LABELS,
  GROUP_ORDER,
  PROFILE_FIELDS,
  type FieldGroup,
  type Profile,
  type ProfileFieldSpec,
  type ProfileKey,
} from '@/storage/schema';
import { clearProfile, loadProfile, saveProfile } from '@/storage/profile';
import { loadApiKey, loadSettings, saveApiKey, saveSettings } from '@/storage/settings';
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
  const [settings, apiKey] = await Promise.all([loadSettings(), loadApiKey()]);

  const enabled = must<HTMLSelectElement>('ai-enabled');
  const model = must<HTMLInputElement>('ai-model');
  const key = must<HTMLInputElement>('ai-key');
  const keyState = must<HTMLElement>('ai-key-state');
  const highlight = must<HTMLSelectElement>('opt-highlight');
  const track = must<HTMLSelectElement>('opt-track');

  enabled.value = settings.aiEnabled ? 'on' : 'off';
  model.value = settings.aiModel;
  highlight.value = settings.highlightFills ? 'on' : 'off';
  track.value = settings.trackSubmissions ? 'on' : 'off';

  // The key itself is never rendered back into the input — only whether one exists.
  const renderKeyState = (present: boolean) => {
    key.placeholder = present ? '•••••••••• (saved)' : 'sk-ant-…';
    keyState.textContent = present
      ? 'A key is saved. Type a new one to replace it, or clear the box and blur to remove it.'
      : 'No key saved. AI assist stays inactive without one.';
  };
  renderKeyState(apiKey !== '');

  enabled.addEventListener('change', async () => {
    await saveSettings({ aiEnabled: enabled.value === 'on' });
    status.show('Saved');
  });
  model.addEventListener(
    'input',
    debounce(async () => {
      await saveSettings({ aiModel: model.value.trim() });
      status.show('Saved');
    }, SAVE_DEBOUNCE_MS),
  );
  key.addEventListener('change', async () => {
    await saveApiKey(key.value);
    renderKeyState(key.value.trim() !== '');
    key.value = '';
    status.show('Saved');
  });
  highlight.addEventListener('change', async () => {
    await saveSettings({ highlightFills: highlight.value === 'on' });
    status.show('Saved');
  });
  track.addEventListener('change', async () => {
    await saveSettings({ trackSubmissions: track.value === 'on' });
    status.show('Saved');
  });
}

// ── boot ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const form = must<HTMLFormElement>('profile-form');
  const profile = await loadProfile();

  buildNav();
  for (const group of GROUP_ORDER) form.append(buildGroup(group, profile));

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
    form.replaceChildren();
    const cleared = await loadProfile();
    for (const group of GROUP_ORDER) form.append(buildGroup(group, cleared));
    status.show('Profile cleared');
  });

  await wireResumes();
  await wireSettings();
}

void main();
