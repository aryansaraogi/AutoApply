import '../shared.css';
import './options.css';

import {
  GROUP_LABELS,
  GROUP_ORDER,
  PROFILE_FIELDS,
  PROFILE_KEYS,
  USABLE_FIELD_COUNT,
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
  MAX_FILE_BYTES,
  addResume,
  deleteResume,
  formatBytes,
  isAcceptedFile,
  listResumes,
  renameResume,
  setDefaultResume,
  type ResumeMeta,
} from '@/storage/resumes';
import { debounce, el, must } from '../dom';

const SAVE_DEBOUNCE_MS = 400;

/** A field gets its own full row when a cramped column would make it unusable. */
function isWide(spec: ProfileFieldSpec): boolean {
  if (spec.control === 'textarea') return true;
  if (spec.label.length > 38) return true;
  return (spec.options ?? []).some((o) => o.length > 30);
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
  nav.replaceChildren(
    ...GROUP_ORDER.map((group) => {
      const link = el('a', { href: `#group-${group}` });
      link.dataset.group = group;
      link.append(
        el('span', { textContent: GROUP_LABELS[group] }),
        el('span', { className: 'nav-count' }),
      );
      return link;
    }),
  );
}

// ── completeness ────────────────────────────────────────────────────────────

/**
 * Recounts filled fields from the live form and updates the header meter and the
 * per-group counts in the nav.
 *
 * Read from the DOM rather than from storage so the numbers move as you type,
 * rather than lagging a debounced save behind you.
 */
function refreshCompleteness(): void {
  const form = must<HTMLFormElement>('profile-form');

  let filled = 0;
  const perGroup = new Map<FieldGroup, { filled: number; total: number }>();

  for (const spec of PROFILE_FIELDS) {
    const control = form.elements.namedItem(spec.key);
    const value =
      control instanceof HTMLInputElement ||
      control instanceof HTMLSelectElement ||
      control instanceof HTMLTextAreaElement
        ? control.value.trim()
        : '';

    const group = perGroup.get(spec.group) ?? { filled: 0, total: 0 };
    group.total++;
    if (value !== '') {
      group.filled++;
      filled++;
    }
    perGroup.set(spec.group, group);
  }

  const total = PROFILE_KEYS.length;
  must<HTMLElement>('completeness-count').textContent = `${filled} of ${total} fields`;

  const meter = must<HTMLElement>('completeness-meter');
  meter.style.width = `${Math.round((filled / total) * 100)}%`;
  meter.className =
    `meter-fill ${filled === total ? 'done' : filled < USABLE_FIELD_COUNT ? 'low' : ''}`.trim();

  for (const link of must<HTMLElement>('group-nav').querySelectorAll<HTMLAnchorElement>('a')) {
    const group = link.dataset.group as FieldGroup | undefined;
    const counts = group ? perGroup.get(group) : undefined;
    if (!counts) continue;
    const count = link.querySelector('.nav-count');
    if (count) count.textContent = `${counts.filled}/${counts.total}`;
    link.classList.toggle('complete', counts.filled === counts.total);
  }
}

/** Where on screen a section counts as "the one being read" — just below the
 *  sticky header, rather than at the very top of the viewport. */
const READING_LINE_PX = 140;

/**
 * Marks the section you are currently reading in the nav.
 *
 * A throttled scroll handler rather than an IntersectionObserver: with eight
 * sections the work is eight getBoundingClientRect calls, and the "which one is
 * active" rule stays a single readable comparison instead of a set of
 * intersection states that have to be reconciled in callback order.
 */
function watchSections(): void {
  const nav = must<HTMLElement>('group-nav');
  const links = [...nav.querySelectorAll<HTMLAnchorElement>('a')];
  const sections = GROUP_ORDER.map((group) => document.getElementById(`group-${group}`)).filter(
    (node): node is HTMLElement => node !== null,
  );
  if (sections.length === 0) return;

  let blocked = false;

  const update = () => {
    // The last section whose top has passed the reading line — i.e. the one the
    // reading line is currently inside. Before the first section has scrolled up
    // that far, the first section is still the answer.
    let active = sections[0] as HTMLElement;
    for (const section of sections) {
      if (section.getBoundingClientRect().top <= READING_LINE_PX) active = section;
    }

    // At the very bottom the last section may be too short to reach the line;
    // whatever is at the end of the page is what is on screen.
    const atBottom =
      window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
    if (atBottom) active = sections[sections.length - 1] as HTMLElement;

    for (const link of links) link.classList.toggle('active', link.hash === `#${active.id}`);
  };

  // Leading edge, so the highlight moves the instant you start scrolling, then
  // at most once per interval after that. Deliberately not requestAnimationFrame:
  // it does not fire in a background or occluded tab, and a nav highlight frozen
  // on whatever was on screen when the tab lost focus is worse than one updated
  // a few milliseconds off a frame boundary.
  const THROTTLE_MS = 100;
  const onScroll = () => {
    if (blocked) return;
    blocked = true;
    update();
    setTimeout(() => {
      blocked = false;
      update();
    }, THROTTLE_MS);
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  update();
}

// ── save plumbing ───────────────────────────────────────────────────────────

const status = {
  node: null as HTMLElement | null,
  timer: 0,
  show(text: string) {
    this.node ??= must<HTMLElement>('save-status');
    this.node.textContent = text;
    this.node.classList.toggle('visible', text !== '');
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
  const drop = must<HTMLLabelElement>('resume-drop');
  const filename = must<HTMLElement>('resume-filename');

  const IDLE_TEXT = 'Choose a résumé, or drop one here';

  const refresh = async () => {
    const resumes = await listResumes();
    list.replaceChildren(...resumes.map((resume) => resumeItem(resume, refresh)));
    empty.hidden = resumes.length > 0;
  };

  /** Reflects the chosen file in the drop zone and enables the add button. */
  const showChoice = () => {
    const file = fileInput.files?.[0];
    error.textContent = '';
    if (!file) {
      filename.textContent = IDLE_TEXT;
      addButton.disabled = true;
      return;
    }
    filename.textContent = `${file.name} · ${formatBytes(file.size)}`;
    // Say why up front rather than after a click that was always going to fail.
    if (!isAcceptedFile(file.name)) {
      error.textContent = 'That file type is not supported.';
      addButton.disabled = true;
    } else if (file.size > MAX_FILE_BYTES) {
      error.textContent = `That file is ${formatBytes(file.size)}; the limit is ${formatBytes(MAX_FILE_BYTES)}.`;
      addButton.disabled = true;
    } else {
      addButton.disabled = false;
    }
  };

  fileInput.addEventListener('change', showChoice);

  // Dropping onto the zone assigns the file to the real input, so there is only
  // one path from here on and the button flow is identical either way.
  drop.addEventListener('dragover', (event) => {
    event.preventDefault();
    drop.classList.add('dragging');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('dragging'));
  drop.addEventListener('drop', (event) => {
    event.preventDefault();
    drop.classList.remove('dragging');
    const dropped = event.dataTransfer?.files;
    if (!dropped || dropped.length === 0) return;
    fileInput.files = dropped;
    showChoice();
  });

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
      showChoice();
      await refresh();
      status.show('Résumé saved');
    } catch (failure) {
      error.textContent = failure instanceof Error ? failure.message : 'Could not save that file.';
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
    refreshCompleteness();
  };

  const persist = debounce(async () => {
    // collectProfile serialises whatever the form holds right now, so a save
    // queued before a rebuild -- an import, a clear -- could land while the form
    // is empty and write 39 blank strings over a real profile, with no error and
    // nothing on screen to show it happened. A form with no fields in it is
    // never something the user meant to save.
    if (form.querySelectorAll('[name]').length === 0) return;
    await saveProfile(collectProfile(form));
    status.show('Saved');
  }, SAVE_DEBOUNCE_MS);

  const onEdit = () => {
    // The meter tracks typing directly; only the write to storage is debounced.
    refreshCompleteness();
    persist();
  };

  form.addEventListener('input', onEdit);
  form.addEventListener('change', onEdit);
  form.addEventListener('submit', (event) => event.preventDefault());

  must<HTMLButtonElement>('clear-profile').addEventListener('click', async () => {
    if (!confirm('Clear every profile field? Your application history is kept.')) return;
    await clearProfile();
    await rerender();
    status.show('Profile cleared');
  });

  refreshCompleteness();
  watchSections();

  wireBackup(rerender);
  await wireResumes();
  await wireSettings();
}

void main();
