/**
 * How a pipeline stage is drawn.
 *
 * The tracker and the side panel both show stages, and before this they showed
 * them differently — the tracker gave each stage its own colour, the panel
 * flattened all seven into three generic pill tones, so the same application
 * looked like two different things depending on which view you were in.
 *
 * Colours themselves live in ui/shared.css as `--stage-<name>`, because they
 * need a dark-mode variant; this module is only the mapping and the markup.
 */

import { STAGE_LABELS, type Stage } from '@/storage/applications';
import { el } from './dom';

/** The custom property holding this stage's colour. */
export function stageColour(stage: Stage): string {
  return `var(--stage-${stage})`;
}

/**
 * A coloured dot followed by the stage name.
 *
 * The colour is passed as an inline `--dot` custom property rather than a class
 * per stage, so adding a stage to the Stage union needs no CSS change — only the
 * one token in shared.css.
 */
export function stageTag(stage: Stage): HTMLElement {
  const tag = el('span', { className: 'stage-tag' });
  tag.style.setProperty('--dot', stageColour(stage));
  tag.append(el('span', { className: 'stage-dot' }), STAGE_LABELS[stage]);
  return tag;
}

/** Just the dot, for places that already name the stage some other way. */
export function stageDot(stage: Stage): HTMLElement {
  const dot = el('span', { className: 'stage-dot' });
  dot.style.setProperty('--dot', stageColour(stage));
  return dot;
}
