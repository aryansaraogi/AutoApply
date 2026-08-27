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
import { debounce, el, must } from '../dom';
import {
  STALE_AFTER_DAYS,
  daysSince,
  formatDate,
  formatExact,
  formatStageAge,
} from '../format';
import { stageDot } from '../stages';

type SortKey = 'updated' | 'created' | 'stalest' | 'company' | 'stage';

const NOTES_DEBOUNCE_MS = 500;

let records: ApplicationRecord[] = [];
let stageFilter: Stage | 'all' = 'all';
let search = '';
let sortKey: SortKey = 'updated';

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
    case 'stalest':
      // Closed applications are not stale, they are finished — they sort last
      // however long ago they closed.
      return (
        Number(isClosed(a)) - Number(isClosed(b)) || a.stageChangedAt - b.stageChangedAt
      );
    case 'company':
      return (a.company || a.host).localeCompare(b.company || b.host);
    case 'stage':
      return STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage) || b.updatedAt - a.updatedAt;
    case 'updated':
    default:
      return b.updatedAt - a.updatedAt;
  }
}

function isClosed(record: ApplicationRecord): boolean {
  return CLOSED_STAGES.includes(record.stage);
}

/** An open application that has not moved for weeks is worth flagging. */
function isStale(record: ApplicationRecord): boolean {
  return !isClosed(record) && daysSince(record.stageChangedAt) >= STALE_AFTER_DAYS;
}

// ── rendering ───────────────────────────────────────────────────────────────

function renderStageFilter(): void {
  const nav = must<HTMLElement>('stage-filter');
  const counts = countByStage(records);

  const chip = (key: Stage | 'all', label: string, count: number) => {
    const button = el('button', {
      type: 'button',
      className: `stage-chip${count === 0 && key !== 'all' ? ' is-empty' : ''}`,
    });
    button.setAttribute('aria-pressed', String(stageFilter === key));
    if (key !== 'all') button.append(stageDot(key));
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

function stageSelect(record: ApplicationRecord): HTMLElement {
  const wrapper = el('div', { className: 'stage-cell' });
  wrapper.append(stageDot(record.stage));

  const select = el('select', { ariaLabel: `Stage for ${record.role || record.company}` });
  for (const stage of STAGES) {
    select.append(el('option', { value: stage, textContent: STAGE_LABELS[stage] }));
  }
  select.value = record.stage;
  select.addEventListener('change', async () => {
    await setStage(record.id, select.value as Stage);
    await refresh();
  });

  wrapper.append(select);
  return wrapper;
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

/** `data-label` is what the narrow card layout draws above each value. */
function cell(className: string, label?: string): HTMLTableCellElement {
  const td = el('td', { className });
  if (label) td.dataset.label = label;
  return td;
}

function row(record: ApplicationRecord): HTMLTableRowElement {
  const tr = el('tr', { className: isClosed(record) ? 'closed' : '' });

  const roleCell = cell('col-role');
  roleCell.append(
    editableCell({
      value: record.role,
      placeholder: 'Add a role…',
      label: `Role at ${record.company || record.host}`,
      save: (value) => updateApplication(record.id, { role: value }),
      commit: (value) => {
        record.role = value;
      },
    }),
  );

  const companyCell = cell('col-company', 'Company');
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

  const stageCell = cell('col-stage', 'Stage');
  stageCell.append(stageSelect(record));

  const appliedCell = cell('col-applied', 'Applied');
  appliedCell.title = formatExact(record.createdAt);
  appliedCell.textContent = formatDate(record.createdAt);

  // How long it has sat where it is. Closed records show a dash: "3 weeks since
  // rejected" is not something anyone needs to act on.
  const ageCell = cell(`col-age${isStale(record) ? ' stale' : ''}`, 'In stage');
  if (isClosed(record)) {
    ageCell.textContent = '—';
  } else {
    ageCell.textContent = formatStageAge(record.stageChangedAt);
    ageCell.title = `In ${STAGE_LABELS[record.stage]} since ${formatExact(record.stageChangedAt)}`;
  }

  const notesCell = cell('col-notes', 'Notes');
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

  const actionsCell = cell('col-actions');
  const actions = el('div', { className: 'actions' });
  actions.append(
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
    className: 'ghost icon-button',
    textContent: 'Delete',
  });
  remove.addEventListener('click', async () => {
    const what = record.role || record.company || 'this application';
    if (!confirm(`Delete ${what} from your tracker?`)) return;
    await deleteApplication(record.id);
    await refresh();
  });
  actions.append(remove);
  actionsCell.append(actions);

  tr.append(roleCell, companyCell, stageCell, appliedCell, ageCell, notesCell, actionsCell);
  return tr;
}

function render(): void {
  renderStageFilter();

  const shown = visible();
  must<HTMLTableSectionElement>('rows').replaceChildren(...shown.map(row));

  renderSummary();

  const nothingToShow = shown.length === 0;
  must<HTMLElement>('grid-scroll').hidden = nothingToShow;
  must<HTMLElement>('empty').hidden = !nothingToShow;

  if (nothingToShow) {
    const blank = records.length === 0;
    must<HTMLElement>('empty-title').textContent = blank
      ? 'Nothing tracked yet'
      : 'No applications match those filters';
    must<HTMLElement>('empty-detail').textContent = blank
      ? 'Fill an application with AutoApply and it will appear here automatically.'
      : 'Clear the search box, or pick a different stage above.';
  }
}

/**
 * The one-line state of the pipeline. "Still open" is the number worth watching;
 * the stale count is the number worth acting on.
 */
function renderSummary(): void {
  const summary = must<HTMLElement>('summary');

  if (records.length === 0) {
    summary.textContent = 'Nothing tracked yet.';
    return;
  }

  const open = records.filter((record) => !isClosed(record)).length;
  const stale = records.filter(isStale).length;

  const parts = [
    `${records.length} application${records.length === 1 ? '' : 's'}`,
    `${open} still open`,
  ];
  if (stale > 0) parts.push(`${stale} with no movement in ${STALE_AFTER_DAYS}+ days`);
  summary.textContent = parts.join(' · ');
}

async function refresh(): Promise<void> {
  records = await listApplications();
  render();
}

// ── boot ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const searchInput = must<HTMLInputElement>('search');
  searchInput.addEventListener(
    'input',
    debounce(() => {
      search = searchInput.value;
      render();
    }, 150),
  );
  // type=search fires input on the native clear button too, but Escape does not.
  searchInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || searchInput.value === '') return;
    searchInput.value = '';
    search = '';
    render();
  });

  const sort = must<HTMLSelectElement>('sort');
  sort.addEventListener('change', () => {
    sortKey = sort.value as SortKey;
    render();
  });

  must<HTMLButtonElement>('open-options').addEventListener('click', () =>
    chrome.runtime.openOptionsPage(),
  );

  must<HTMLButtonElement>('export-csv').addEventListener('click', () => {
    if (records.length === 0) return;
    const blob = new Blob([toCsv(visible())], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = el('a', {
      href: url,
      download: `autoapply-${new Date().toISOString().slice(0, 10)}.csv`,
    });
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
