import { harvest } from '@/core/harvest';
import type { FieldDescriptor } from '@/core/types';

export function mount(html: string): void {
  document.body.innerHTML = html;
}

/** Harvests a fragment and returns the descriptors, in document order. */
export function harvestHtml(html: string): FieldDescriptor[] {
  mount(html);
  return harvest(document);
}

/** Finds a harvested field by (case-insensitive substring of) its label. */
export function fieldByLabel(fields: FieldDescriptor[], needle: string): FieldDescriptor {
  const match = fields.find((f) => f.label.toLowerCase().includes(needle.toLowerCase()));
  if (!match) {
    const seen = fields.map((f) => `"${f.label}"`).join(', ');
    throw new Error(`No field labelled like "${needle}". Harvested: ${seen}`);
  }
  return match;
}
