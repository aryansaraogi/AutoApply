import { beforeEach, describe, expect, it } from 'vitest';
import { resolveLabel, resolveLegend } from '@/core/label';

function mount(html: string): void {
  document.body.innerHTML = html;
}

function field(id = 'target'): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`no #${id} in fixture`);
  return node;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('resolveLabel priority chain', () => {
  it('prefers aria-labelledby over everything else', () => {
    mount(`
      <span id="q">Work authorization</span>
      <label for="target">Ignored label</label>
      <input id="target" aria-labelledby="q" aria-label="Ignored aria" placeholder="Ignored" />
    `);
    expect(resolveLabel(field(), document)).toEqual({
      text: 'Work authorization',
      source: 'aria-labelledby',
    });
  });

  it('joins multiple aria-labelledby targets in order', () => {
    mount(`
      <span id="a">Emergency</span><span id="b">contact</span>
      <input id="target" aria-labelledby="a b" />
    `);
    expect(resolveLabel(field(), document).text).toBe('Emergency contact');
  });

  it('falls back to label[for] when there is no aria-labelledby', () => {
    mount(`
      <label for="target">First Name *</label>
      <input id="target" aria-label="Ignored" placeholder="Ignored" />
    `);
    expect(resolveLabel(field(), document)).toEqual({
      text: 'First Name *',
      source: 'label-for',
    });
  });

  it('does not pick up option text from a label wrapping a select', () => {
    mount(`
      <label for="target">Country</label>
      <select id="target"><option>United States</option></select>
    `);
    expect(resolveLabel(field(), document).text).toBe('Country');
  });

  it('falls back to an ancestor label', () => {
    mount(`<label>Email address <input id="target" placeholder="Ignored" /></label>`);
    expect(resolveLabel(field(), document)).toEqual({
      text: 'Email address',
      source: 'label-ancestor',
    });
  });

  it('falls back to aria-label', () => {
    mount(`<input id="target" aria-label="Phone number" placeholder="Ignored" />`);
    expect(resolveLabel(field(), document)).toEqual({
      text: 'Phone number',
      source: 'aria-label',
    });
  });

  it('falls back to placeholder before the name attribute', () => {
    mount(`<input id="target" name="ignored_name" placeholder="you@example.com" />`);
    expect(resolveLabel(field(), document)).toEqual({
      text: 'you@example.com',
      source: 'placeholder',
    });
  });

  it('falls back to the name attribute as a last resort', () => {
    mount(`<input id="target" name="candidate_first_name" />`);
    expect(resolveLabel(field(), document)).toEqual({
      text: 'candidate_first_name',
      source: 'name-attribute',
    });
  });

  it('returns a none-source empty label when there is no signal at all', () => {
    // No id, no name, no label, no nearby text — the only case that yields 'none'.
    mount(`<div id="wrap"><input /></div>`);
    const bare = document.querySelector('#wrap input') as HTMLElement;
    expect(resolveLabel(bare, document)).toEqual({ text: '', source: 'none' });
  });
});

describe('resolveLabel nearby-text heuristic', () => {
  it('reads a sibling div used as a label', () => {
    mount(`
      <div class="field">
        <div class="label">LinkedIn Profile</div>
        <input id="target" />
      </div>
    `);
    expect(resolveLabel(field(), document)).toEqual({
      text: 'LinkedIn Profile',
      source: 'preceding-text',
    });
  });

  it('reads a bare text node preceding the control', () => {
    mount(`<div class="field">Portfolio URL <input id="target" /></div>`);
    expect(resolveLabel(field(), document).text).toBe('Portfolio URL');
  });

  it('takes the nearest preceding text, not the first', () => {
    mount(`
      <div class="field">
        <div>Section heading</div>
        <div>City</div>
        <input id="target" />
      </div>
    `);
    expect(resolveLabel(field(), document).text).toBe('City');
  });

  it('refuses text from a subtree that holds another control', () => {
    mount(`
      <div class="row">
        <div class="other"><span>First name</span><input name="first" /></div>
        <input id="target" />
      </div>
    `);
    // "First name" belongs to the sibling input, so it must not leak across.
    expect(resolveLabel(field(), document).source).not.toBe('preceding-text');
  });

  it('stops climbing once the ancestor holds several controls', () => {
    mount(`
      <form>
        <div>Contact details</div>
        <input name="a" />
        <input id="target" />
      </form>
    `);
    expect(resolveLabel(field(), document).source).not.toBe('preceding-text');
  });
});

describe('resolveLabel inside a shadow root', () => {
  it('resolves label[for] within the shadow root rather than the document', () => {
    mount(`<div id="host"></div>`);
    const host = document.getElementById('host')!;
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <label for="target">Preferred Name</label>
      <input id="target" />
    `;
    const input = root.getElementById('target') as HTMLElement;
    expect(resolveLabel(input, root)).toEqual({
      text: 'Preferred Name',
      source: 'label-for',
    });
  });
});

describe('resolveLegend', () => {
  it('returns the enclosing fieldset legend', () => {
    mount(`
      <fieldset>
        <legend>Are you legally authorized to work in the United States?</legend>
        <label><input type="radio" id="target" name="auth" value="yes" /> Yes</label>
        <label><input type="radio" name="auth" value="no" /> No</label>
      </fieldset>
    `);
    expect(resolveLegend(field(), document)).toBe(
      'Are you legally authorized to work in the United States?',
    );
  });

  it('falls back to aria-label on a role=radiogroup', () => {
    mount(`
      <div role="radiogroup" aria-label="Do you require sponsorship?">
        <input type="radio" id="target" name="spon" value="yes" />
      </div>
    `);
    expect(resolveLegend(field(), document)).toBe('Do you require sponsorship?');
  });

  it('returns an empty string when there is no group', () => {
    mount(`<input id="target" />`);
    expect(resolveLegend(field(), document)).toBe('');
  });
});
