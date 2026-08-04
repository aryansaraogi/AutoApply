import { beforeEach, describe, expect, it } from 'vitest';
import { harvest } from '@/core/harvest';
import { fieldByLabel, harvestHtml, mount } from './helpers';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('harvest control discovery', () => {
  it('collects the ordinary data-entry controls', () => {
    const fields = harvestHtml(`
      <form>
        <label for="a">First Name</label><input id="a" />
        <label for="b">Email</label><input id="b" type="email" />
        <label for="c">Cover Letter</label><textarea id="c"></textarea>
        <label for="d">Country</label><select id="d"><option value="us">US</option></select>
      </form>
    `);
    expect(fields.map((f) => f.kind)).toEqual(['text', 'email', 'textarea', 'select']);
    expect(fields.map((f) => f.label)).toEqual([
      'First Name',
      'Email',
      'Cover Letter',
      'Country',
    ]);
  });

  it('ignores buttons, hidden inputs, and disabled or readonly controls', () => {
    const fields = harvestHtml(`
      <form>
        <input type="hidden" name="csrf" />
        <input type="submit" value="Apply" />
        <button>Click</button>
        <input name="locked" disabled />
        <input name="frozen" readonly />
        <input name="ok" />
      </form>
    `);
    expect(fields).toHaveLength(1);
    expect(fields[0]?.name).toBe('ok');
  });

  it('ignores fields inside a display:none or aria-hidden subtree', () => {
    const fields = harvestHtml(`
      <form>
        <div style="display:none"><input name="hidden-branch" /></div>
        <div aria-hidden="true"><input name="aria-hidden-branch" /></div>
        <input name="visible" />
      </form>
    `);
    expect(fields.map((f) => f.name)).toEqual(['visible']);
  });

  it('keeps visually-hidden radios, which ATS forms style with a sibling', () => {
    const fields = harvestHtml(`
      <fieldset>
        <legend>Willing to relocate?</legend>
        <label><input type="radio" name="relo" value="yes" style="opacity:0" /> Yes</label>
        <label><input type="radio" name="relo" value="no" style="opacity:0" /> No</label>
      </fieldset>
    `);
    expect(fields).toHaveLength(1);
    expect(fields[0]?.kind).toBe('radiogroup');
  });
});

describe('harvest radio grouping', () => {
  it('emits one field per radio group, with the legend as its label', () => {
    const fields = harvestHtml(`
      <form>
        <fieldset>
          <legend>Are you legally authorized to work in the United States?</legend>
          <label><input type="radio" name="auth" value="Yes" /> Yes</label>
          <label><input type="radio" name="auth" value="No" /> No</label>
        </fieldset>
        <fieldset>
          <legend>Will you require sponsorship?</legend>
          <label><input type="radio" name="spon" value="Yes" /> Yes</label>
          <label><input type="radio" name="spon" value="No" /> No</label>
        </fieldset>
      </form>
    `);

    expect(fields).toHaveLength(2);
    const auth = fieldByLabel(fields, 'authorized');
    expect(auth.kind).toBe('radiogroup');
    expect(auth.options.map((o) => o.label)).toEqual(['Yes', 'No']);
    expect(auth.options.map((o) => o.value)).toEqual(['Yes', 'No']);
  });

  it('marks a group required when any member is required', () => {
    const fields = harvestHtml(`
      <fieldset>
        <legend>Veteran status</legend>
        <label><input type="radio" name="vet" value="a" required /> A</label>
        <label><input type="radio" name="vet" value="b" /> B</label>
      </fieldset>
    `);
    expect(fields[0]?.required).toBe(true);
  });

  it('reports hasValue when a member is already checked', () => {
    const fields = harvestHtml(`
      <fieldset>
        <legend>Gender</legend>
        <label><input type="radio" name="g" value="f" checked /> Female</label>
        <label><input type="radio" name="g" value="m" /> Male</label>
      </fieldset>
    `);
    expect(fields[0]?.hasValue).toBe(true);
  });
});

describe('harvest metadata', () => {
  it('captures options and existing values for selects', () => {
    const fields = harvestHtml(`
      <label for="s">Country</label>
      <select id="s">
        <option value="">Select…</option>
        <option value="us">United States</option>
        <option value="ca" selected>Canada</option>
      </select>
    `);
    const field = fields[0];
    expect(field?.options.map((o) => o.value)).toEqual(['', 'us', 'ca']);
    expect(field?.hasValue).toBe(true);
  });

  it('treats a blank placeholder option as no value', () => {
    const fields = harvestHtml(`
      <label for="s">Country</label>
      <select id="s"><option value="" selected>Select…</option><option value="us">US</option></select>
    `);
    expect(fields[0]?.hasValue).toBe(false);
  });

  it('reads the autocomplete token and required flag', () => {
    const fields = harvestHtml(`
      <label for="e">Email</label>
      <input id="e" autocomplete="section-main billing EMAIL" required />
    `);
    expect(fields[0]?.autocomplete).toBe('section-main billing email');
    expect(fields[0]?.required).toBe(true);
  });

  it('combines a legend with a bare option label for matching', () => {
    const fields = harvestHtml(`
      <fieldset>
        <legend>Do you require visa sponsorship?</legend>
        <label for="x">Yes</label><select id="x"><option>Yes</option></select>
      </fieldset>
    `);
    expect(fields[0]?.normalizedLabel).toContain('sponsorship');
    expect(fields[0]?.legend).toBe('Do you require visa sponsorship?');
  });
});

describe('harvest across shadow roots', () => {
  it('descends into open shadow roots', () => {
    mount(`<div id="host"></div><input id="light" aria-label="Light DOM field" />`);
    const shadow = document.getElementById('host')!.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <label for="inner">Shadow Field</label>
      <input id="inner" />
    `;

    const fields = harvest(document);
    expect(fields.map((f) => f.label).sort()).toEqual(['Light DOM field', 'Shadow Field']);
  });

  it('resolves a shadow field label against its own root', () => {
    mount(`<label for="inner">Decoy from light DOM</label><div id="host"></div>`);
    const shadow = document.getElementById('host')!.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<label for="inner">Real label</label><input id="inner" />`;

    const fields = harvest(document);
    expect(fields.map((f) => f.label)).toEqual(['Real label']);
  });
});
