/**
 * Layout for the joystick radial prompt picker: a fixed 8-direction ring
 * (45° each), numbered clockwise from 12 o'clock like a d-pad. Cancel always
 * sits at the bottom (slot 4). The focused chat's suggested prompts take
 * slots 0-2 (top, top-right, right); the user's most-used prompts fill the
 * remaining directions clockwise from the top.
 *
 * Screen turns are clockwise from 12 o'clock; raw device angles are converted
 * via {@link deviceAngleToScreenTurn} (device 0 = 3 o'clock, clockwise).
 */

import { promptVisibleText } from '$lib/components/chat/suggested-prompt-markdown-links';
import { angleToSector, deviceAngleToScreenTurn } from '../input/sector';
import { promptKey } from './curation';

export const RADIAL_SLOT_COUNT = 8;
export const RADIAL_CANCEL_SLOT = 4;
export const MAX_RADIAL_SUGGESTIONS = 3;

export type RadialSlot =
  | { kind: 'suggestion'; text: string; label: string; number: number }
  | { kind: 'prompt'; text: string; label: string }
  | { kind: 'cancel' }
  | { kind: 'empty' };

/**
 * Assign chat suggestions and used prompts to the 8 directions. `text` is
 * what gets sent/inserted; `label` is what the ring shows (markdown links
 * reduced to their visible label).
 */
export function buildRadialSlots(
  suggestions: readonly string[],
  prompts: readonly string[],
): RadialSlot[] {
  const slots: RadialSlot[] = Array.from({ length: RADIAL_SLOT_COUNT }, () => ({ kind: 'empty' }));
  slots[RADIAL_CANCEL_SLOT] = { kind: 'cancel' };

  const shown = suggestions.slice(0, MAX_RADIAL_SUGGESTIONS);
  shown.forEach((text, index) => {
    slots[index] = { kind: 'suggestion', text, label: promptVisibleText(text), number: index + 1 };
  });

  const suggestionKeys = new Set(shown.map(promptKey));
  const remaining = prompts.filter((text) => !suggestionKeys.has(promptKey(text)));
  for (let slot = 0; slot < RADIAL_SLOT_COUNT && remaining.length > 0; slot++) {
    if (slots[slot].kind !== 'empty') continue;
    const text = remaining.shift() as string;
    slots[slot] = { kind: 'prompt', text, label: text };
  }
  return slots;
}

/** True when releasing on the slot does something (send or insert). */
export function isActionSlot(slot: RadialSlot | undefined): boolean {
  return slot?.kind === 'suggestion' || slot?.kind === 'prompt';
}

/** Screen turn (clockwise from 12 o'clock) of a slot's center. */
export function radialSlotTurn(slot: number): number {
  return slot / RADIAL_SLOT_COUNT;
}

/** Map a raw device joystick angle to the highlighted slot. */
export function radialSlotForAngle(angle: number): number {
  return angleToSector(
    deviceAngleToScreenTurn(angle),
    RADIAL_SLOT_COUNT,
    -1 / (2 * RADIAL_SLOT_COUNT),
  );
}

/**
 * Keyboard stepping: the next non-empty slot in `direction` (1 = clockwise).
 * With nothing selected, stepping starts from Cancel.
 */
export function nextSelectableSlot(
  slots: readonly RadialSlot[],
  from: number | null,
  direction: 1 | -1,
): number {
  let slot = from ?? RADIAL_CANCEL_SLOT;
  for (let step = 0; step < RADIAL_SLOT_COUNT; step++) {
    slot = (slot + direction + RADIAL_SLOT_COUNT) % RADIAL_SLOT_COUNT;
    if (slots[slot]?.kind !== 'empty') return slot;
  }
  return RADIAL_CANCEL_SLOT;
}

/** Gap between neighbouring slots, as a fraction of a full turn. */
export const RADIAL_SLOT_GAP_TURNS = 5 / 360;
/** Horizontal breathing room inside each slot's arc, in px. */
export const RADIAL_LABEL_PADDING = 24;
const MAX_LABEL_LINES = 2;
const ELLIPSIS = '…';

/** Usable text width along one slot's arc at `radius`. */
export function radialArcWidth(radius: number): number {
  return (
    radius * 2 * Math.PI * (1 / RADIAL_SLOT_COUNT - RADIAL_SLOT_GAP_TURNS) - RADIAL_LABEL_PADDING
  );
}

export interface RadialLabelFitOptions {
  /** Rendered width of a string in px. */
  measure: (text: string) => number;
  minRadius: number;
  maxRadius: number;
  step?: number;
}

export interface RadialLabelFit {
  radius: number;
  /** Per label, the 0-2 lines to draw on that slot's arc. */
  lines: string[][];
}

function wrapWords(text: string, width: number, measure: (text: string) => number): string[] {
  const lines: string[] = [];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const current = lines.at(-1);
    const joined = current === undefined ? word : `${current} ${word}`;
    if (current !== undefined && measure(joined) <= width) lines[lines.length - 1] = joined;
    else lines.push(word);
  }
  return lines;
}

function ellipsize(text: string, width: number, measure: (text: string) => number): string {
  if (measure(text) <= width) return text;
  let cut = text;
  while (cut.length > 0 && measure(`${cut.trimEnd()}${ELLIPSIS}`) > width) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}${ELLIPSIS}`;
}

/**
 * Pick the smallest ring radius (from `minRadius`, growing by `step`) at
 * which every label wraps into at most two lines that fit its slot's arc, so
 * no label overlaps a neighbour. When even `maxRadius` is too small, labels
 * are clamped to two lines and the overflow ends with an ellipsis.
 */
export function fitRadialLabels(
  labels: readonly string[],
  { measure, minRadius, maxRadius, step = 2 }: RadialLabelFitOptions,
): RadialLabelFit {
  const fits = (radius: number): boolean => {
    const width = radialArcWidth(radius);
    return labels.every((label) => {
      const lines = wrapWords(label, width, measure);
      return lines.length <= MAX_LABEL_LINES && lines.every((line) => measure(line) <= width);
    });
  };

  let radius = minRadius;
  while (radius < maxRadius && !fits(radius)) radius = Math.min(radius + step, maxRadius);

  const width = radialArcWidth(radius);
  const lines = labels.map((label) => {
    const wrapped = wrapWords(label, width, measure);
    if (wrapped.length <= MAX_LABEL_LINES) return wrapped.map((l) => ellipsize(l, width, measure));
    const head = wrapped.slice(0, MAX_LABEL_LINES - 1).map((l) => ellipsize(l, width, measure));
    const tail = wrapped.slice(MAX_LABEL_LINES - 1).join(' ');
    // The tail never fits whole here, so it always ends with an ellipsis.
    return [...head, ellipsize(`${tail}${ELLIPSIS}`, width, measure)];
  });
  return { radius, lines };
}
