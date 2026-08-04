/**
 * The combobox driver is tested against a fake widget that behaves the way
 * react-select does: options render only after the menu opens, they are
 * portalled outside the field, they filter as you type, and — the detail that
 * breaks naive autofill — selection commits on mousedown rather than click.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { driveCombobox } from '@/adapters/combobox';
import { harvest } from '@/core/harvest';
import type { FieldDescriptor } from '@/core/types';
import { mount } from './helpers';

interface WidgetConfig {
  options: string[];
  /** Commit on mousedown (react-select) rather than click. */
  commitOn?: 'mousedown' | 'click';
  /** Render the listbox into <body> instead of inside the field. */
  portal?: boolean;
  /** Delay before options appear, imitating an async loader. */
  delayMs?: number;
  /** Narrow the option list by what has been typed. */
  filter?: boolean;
}

/** Builds the fake widget and returns what it ends up holding. */
function buildWidget(config: WidgetConfig): { selected: () => string } {
  const {
    options,
    commitOn = 'mousedown',
    portal = true,
    delayMs = 0,
    filter = true,
  } = config;

  mount(`
    <label for="combo">Country</label>
    <div id="combo" role="combobox" aria-expanded="false" aria-controls="listbox">
      <input id="combo-input" type="text" aria-autocomplete="list" />
      <span id="combo-display"></span>
    </div>
    <div id="portal"></div>
  `);

  const combo = document.getElementById('combo')!;
  const input = document.getElementById('combo-input') as HTMLInputElement;
  const display = document.getElementById('combo-display')!;
  const host = portal ? document.getElementById('portal')! : combo;

  let value = '';
  let listbox: HTMLElement | null = null;

  const render = () => {
    if (!listbox) return;
    const typed = input.value.toLowerCase();
    const visible = filter
      ? options.filter((o) => o.toLowerCase().includes(typed))
      : options;

    listbox.replaceChildren();
    for (const option of visible) {
      const node = document.createElement('div');
      node.setAttribute('role', 'option');
      node.textContent = option;
      node.addEventListener(commitOn, () => {
        value = option;
        display.textContent = option;
        input.value = '';
        listbox?.remove();
        listbox = null;
        combo.setAttribute('aria-expanded', 'false');
      });
      listbox.append(node);
    }
  };

  const openMenu = () => {
    if (listbox) return;
    combo.setAttribute('aria-expanded', 'true');
    setTimeout(() => {
      listbox = document.createElement('div');
      listbox.id = 'listbox';
      listbox.setAttribute('role', 'listbox');
      host.append(listbox);
      render();
    }, delayMs);
  };

  combo.addEventListener('mousedown', openMenu);
  input.addEventListener('mousedown', openMenu);
  input.addEventListener('input', render);

  return { selected: () => value };
}

function comboField(): FieldDescriptor {
  const field = harvest(document).find((f) => f.kind === 'combobox');
  if (!field) throw new Error('fixture did not produce a combobox field');
  return field;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('driveCombobox', () => {
  it('opens, filters, and commits a portalled react-select style widget', async () => {
    const widget = buildWidget({ options: ['United States', 'Canada', 'United Kingdom'] });

    const outcome = await driveCombobox(comboField(), 'Canada');

    expect(outcome.ok).toBe(true);
    expect(widget.selected()).toBe('Canada');
  });

  it('commits on mousedown, which click alone would miss', async () => {
    const widget = buildWidget({ options: ['Canada'], commitOn: 'mousedown' });
    await driveCombobox(comboField(), 'Canada');
    expect(widget.selected()).toBe('Canada');
  });

  it('handles widgets that commit on click instead', async () => {
    const widget = buildWidget({ options: ['Canada'], commitOn: 'click' });
    await driveCombobox(comboField(), 'Canada');
    expect(widget.selected()).toBe('Canada');
  });

  it('waits for options that load asynchronously', async () => {
    const widget = buildWidget({ options: ['Canada', 'Chile'], delayMs: 250 });
    const outcome = await driveCombobox(comboField(), 'Chile');
    expect(outcome.ok).toBe(true);
    expect(widget.selected()).toBe('Chile');
  });

  it('finds options rendered inside the field rather than portalled', async () => {
    const widget = buildWidget({ options: ['Canada'], portal: false });
    await driveCombobox(comboField(), 'Canada');
    expect(widget.selected()).toBe('Canada');
  });

  it('reports a failure instead of selecting the wrong option', async () => {
    const widget = buildWidget({ options: ['Canada', 'Chile'] });

    const outcome = await driveCombobox(comboField(), 'Japan', { timeoutMs: 200 });

    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toContain('Japan');
    expect(widget.selected()).toBe('');
  });

  it('refuses an ambiguous prefix rather than guessing', async () => {
    const widget = buildWidget({
      options: ['United States', 'United States Minor Outlying Islands'],
    });

    const outcome = await driveCombobox(comboField(), 'United', { timeoutMs: 200 });

    expect(outcome.ok).toBe(false);
    expect(widget.selected()).toBe('');
  });

  it('still picks the exact match when a longer option shares its prefix', async () => {
    const widget = buildWidget({
      options: ['United States', 'United States Minor Outlying Islands'],
    });

    await driveCombobox(comboField(), 'United States');

    expect(widget.selected()).toBe('United States');
  });

  it('times out cleanly when the menu never opens', async () => {
    mount(`
      <label for="combo">Country</label>
      <div id="combo" role="combobox"><input id="combo-input" aria-autocomplete="list" /></div>
    `);

    const outcome = await driveCombobox(comboField(), 'Canada', { timeoutMs: 150 });

    expect(outcome.ok).toBe(false);
  });
});
