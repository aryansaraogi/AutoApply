import '../shared.css';
import './tracker.css';

import {
  CLOSED_STAGES,
  STAGES,
  STAGE_LABELS,
  countByStage,
  deleteApplication,
  listApplications,
  setStage,
  toCsv,
  updateApplication,
  updateNotes,
  type ApplicationRecord,
  type Stage,
} from '@/storage/applications';

type SortKey = 'updated' | 'created' | 'company' | 'stage';

/**
 * Colours the stage dot: cool and neutral while nothing has happened, warming
 * as an application progresses, muted once it is closed.
 *
 * Each is chosen to stay distinct from the indigo accent, since a selected
 * filter chip paints the accent behind its own dot.
 */
const STAGE_COLOURS: Record<Stage, string> = {
  draft: '#94a3b8',
  applied: '#2563eb',
  screening: '#0891b2',
  interview: '#d97706',
  offer: '#16a34a',
  rejected: '#dc2626',
  withdrawn: '#64748b',
};

const NOTES_DEBOUNCE_MS = 500;

let records: ApplicationRecord[] = [];
let stageFilter: Stage | 'all' = 'all';
let search = '';
let sortKey: SortKey = 'updated';

function must<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
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

function debounce<T extends unknown[]>(fn: (...args: T) => void, ms: number) {
  let timer = 0;
  return (...args: T) => {
    clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), ms);
  };
}

// ── filtering and sorting ───────────────────────────────────────────────────

function visible(): ApplicationRecord[] {
  const needle = search.trim().toLowerCase();

  const filtered = records.filter((record) => {
    if (stageFilter !== 'all' && record.stage !== stageFilter) return false;
    if (!needle) return true;
    return [record.role, record.company, record.notes, record.host]
      .join(' ')
      .toLowerCase()
      .includes(needle);
  });

  return filtered.sort(comparator);
}

function comparator(a: ApplicationRecord, b: ApplicationRecord): number {
  switch (sortKey) {
    case 'created':
      return b.createdAt - a.createdAt;
    case 'company':
      return (a.company || a.host).localeCompare(b.company || b.host);
    case 'stage':
      return STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage) || b.updatedAt - a.updatedAt;
    case 'updated':
    default:
      return b.updatedAt - a.updatedAt;
  }
}

// ── rendering ───────────────────────────────────────────────────────────────

function renderStageFilter(): void {
  const nav = must<HTMLElement>('stage-filter');
  const counts = countByStage(records);

  const chip = (key: Stage | 'all', label: string, count: number) => {
    const button = el('button', { type: 'button', className: 'stage-chip' });
    button.setAttribute('aria-pressed', String(stageFilter === key));
    if (key !== 'all') {
      const dot = el('span', { className: 'stage-dot' });
      dot.style.background = STAGE_COLOURS[key];
      button.append(dot);
    }
    button.append(label, el('span', { className: 'count', textContent: String(count) }));
    button.addEventListener('click', () => {
      stageFilter = stageFilter === key ? 'all' : key;
      render();
    });
    return button;
  };

  nav.replaceChildren(
    chip('all', 'All', records.length),
    ...STAGES.map((stage) => chip(stage, STAGE_LABELS[stage], counts[stage])),
  );
}

function stageSelect(record: ApplicationRecord): HTMLSelectElement {
  const select = el('select', { ariaLabel: `Stage for ${record.role || record.company}` });
  for (const stage of STAGES) {
    select.append(el('option', { value: stage, textContent: STAGE_LABELS[stage] }));
  }
  select.value = record.stage;
  select.addEventListener('change', async () => {
    await setStage(record.id, select.value as Stage);
    await refresh();
  });
  return select;
}

/**
 * An editable cell.
 *
 * Company and role are extracted from pages that were never built to be read
 * that way, so they are sometimes wrong — a marketing headline, a URL fragment.
 * Rather than hiding that, every guessed field is directly correctable.
 *
 * Saves are debounced and deliberately do not re-render: redrawing the table
 * would tear focus out of the field mid-keystroke.
 */
function editableCell(options: {
  value: string;
  placeholder: string;
  label: string;
  className?: string;
  save: (value: string) => Promise<void>;
  commit: (value: string) => void;
}): HTMLInputElement {
  const input = el('input', {
    type: 'text',
    value: options.value,
    placeholder: options.placeholder,
    ariaLabel: options.label,
    className: options.className ?? '',
  });

  const persist = debounce((value: string) => {
    void options.save(value).then(() => options.commit(value));
  }, NOTES_DEBOUNCE_MS);

  input.addEventListener('input', () => persist(input.value));
  // Leaving the field should not lose an edit shorter than the debounce.
  input.addEventListener('blur', () => {
    void options.save(input.value).then(() => options.commit(input.value));
  });
  return input;
}

function row(record: ApplicationRecord): HTMLTableRowElement {
  const tr = el('tr', {
    className: CLOSED_STAGES.includes(record.stage) ? 'closed' : '',
  });

  const roleCell = el('td', { className: 'col-role' });
  roleCell.append(
    editableCell({
      value: record.role,
      placeholder: 'Add a role…',
      label: `Role at ${record.company || record.host}`,
      className: 'cell-strong',
      save: (value) => updateApplication(record.id, { role: value }),
      commit: (value) => {
        record.role = value;
      },
    }),
  );

  const companyCell = el('td', { className: 'col-company' });
  companyCell.append(
    editableCell({
      value: record.company,
      // The host is a hint, not a value: showing it as placeholder text keeps
      // the field genuinely empty so a guess is never silently adopted.
      placeholder: record.host || 'Add a company…',
      label: `Company for ${record.role || record.host}`,
      save: (value) => updateApplication(record.id, { company: value }),
      commit: (value) => {
        record.company = value;
      },
    }),
  );

  const stageCell = el('td', { className: 'col-stage' });
  stageCell.append(stageSelect(record));

  const appliedCell = el('td', {
    className: 'col-applied',
    title: new Date(record.createdAt).toLocaleString(),
    textContent: formatDate(record.createdAt),
  });

  const notesCell = el('td', { className: 'col-notes' });
  notesCell.append(
    editableCell({
      value: record.notes,
      placeholder: 'Add a note…',
      label: `Notes for ${record.role || record.company}`,
      save: (value) => updateNotes(record.id, value),
      commit: (value) => {
        record.notes = value;
      },
    }),
  );

  const actionsCell = el('td', { className: 'col-actions' });
  actionsCell.append(
    el('a', {
      className: 'open-link',
      href: record.url,
      target: '_blank',
      rel: 'noreferrer',
      textContent: 'Open',
      title: record.url,
    }),
  );
  const remove = el('button', {
    type: 'button',
    className: 'icon-button',
    textContent: 'Delete',
  });
  remove.addEventListener('click', async () => {
    const what = record.role || record.company || 'this application';
    if (!confirm(`Delete ${what} from your tracker?`)) return;
    await deleteApplication(record.id);
    await refresh();
  });
  actionsCell.append(remove);

  tr.append(roleCell, companyCell, stageCell, appliedCell, notesCell, actionsCell);
  return tr;
}

function render(): void {
  renderStageFilter();

  const shown = visible();
  must<HTMLTableSectionElement>('rows').replaceChildren(...shown.map(row));

  const counts = countByStage(records);
  const live = records.length - counts.rejected - counts.withdrawn;
  must<HTMLElement>('summary').textContent =
    records.length === 0
      ? 'Nothing tracked yet.'
      : `${records.length} application${records.length === 1 ? '' : 's'} · ${live} still open`;

  const empty = must<HTMLElement>('empty');
  const grid = must<HTMLElement>('grid');
  const nothingToShow = shown.length === 0;
  grid.hidden = nothingToShow;
  empty.hidden = !nothingToShow;
  empty.textContent =
    records.length === 0
      ? 'Fill an application and it will appear here automatically.'
      : 'No applications match those filters.';
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

async function refresh(): Promise<void> {
  records = await listApplications();
  render();
}

// ── boot ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  must<HTMLInputElement>('search').addEventListener(
    'input',
    debounce(function (this: void) {
      search = must<HTMLInputElement>('search').value;
      render();
    }, 150),
  );

  must<HTMLSelectElement>('sort').addEventListener('change', () => {
    sortKey = must<HTMLSelectElement>('sort').value as SortKey;
    render();
  });

  must<HTMLButtonElement>('open-options').addEventListener('click', () =>
    chrome.runtime.openOptionsPage(),
  );

  must<HTMLButtonElement>('export-csv').addEventListener('click', () => {
    if (records.length === 0) return;
    const blob = new Blob([toCsv(visible())], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = el('a', { href: url, download: `autoapply-${new Date().toISOString().slice(0, 10)}.csv` });
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  });

  // A fill happening in another tab should show up here without a reload.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.applications) void refresh();
  });

  await refresh();
}

void main();
