import { describe, expect, it } from 'vitest';
import {
  RADIAL_CANCEL_SLOT,
  RADIAL_SLOT_COUNT,
  buildRadialSlots,
  fitRadialLabels,
  nextSelectableSlot,
  radialArcWidth,
  radialSlotForAngle,
  type RadialSlot,
} from '../radial-layout';

const texts = (slots: RadialSlot[]) =>
  slots.map((slot) =>
    slot.kind === 'cancel' ? 'CANCEL' : slot.kind === 'empty' ? null : slot.text,
  );

describe('buildRadialSlots', () => {
  it('fills the 7 non-Cancel directions clockwise from the top with used prompts', () => {
    const slots = buildRadialSlots([], ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7']);
    expect(slots).toHaveLength(RADIAL_SLOT_COUNT);
    expect(texts(slots)).toEqual(['p0', 'p1', 'p2', 'p3', 'CANCEL', 'p4', 'p5', 'p6']);
    expect(slots.every((slot) => slot.kind !== 'suggestion')).toBe(true);
  });

  it('puts chat suggestions at top, top-right and right, numbered 1-3', () => {
    const slots = buildRadialSlots(['s1', 's2', 's3', 's4'], ['p0', 'p1', 'p2', 'p3', 'p4']);
    expect(texts(slots)).toEqual(['s1', 's2', 's3', 'p0', 'CANCEL', 'p1', 'p2', 'p3']);
    expect(slots.slice(0, 3)).toEqual([
      { kind: 'suggestion', text: 's1', label: 's1', number: 1 },
      { kind: 'suggestion', text: 's2', label: 's2', number: 2 },
      { kind: 'suggestion', text: 's3', label: 's3', number: 3 },
    ]);
  });

  it('gives a free suggestion direction back to a used prompt', () => {
    const slots = buildRadialSlots(['s1', 's2'], ['p0', 'p1']);
    expect(texts(slots)).toEqual(['s1', 's2', 'p0', 'p1', 'CANCEL', null, null, null]);
  });

  it('skips used prompts that repeat a suggestion, ignoring whitespace', () => {
    const slots = buildRadialSlots(
      ['Commit and  push'],
      [' commit and push', 'Commit and push', 'p1'],
    );
    expect(texts(slots)).toEqual([
      'Commit and  push',
      ' commit and push',
      'p1',
      null,
      'CANCEL',
      null,
      null,
      null,
    ]);
  });

  it('labels markdown-link suggestions with their visible text but keeps the raw prompt', () => {
    const [slot] = buildRadialSlots(['Merge [#5034](https://github.com/o/r/pull/5034)'], []);
    expect(slot).toEqual({
      kind: 'suggestion',
      text: 'Merge [#5034](https://github.com/o/r/pull/5034)',
      label: 'Merge #5034',
      number: 1,
    });
  });

  it('always keeps Cancel at the bottom', () => {
    expect(buildRadialSlots([], [])[RADIAL_CANCEL_SLOT]).toEqual({ kind: 'cancel' });
  });
});

describe('radialSlotForAngle', () => {
  // Device a=0 points right (3 o'clock) and grows clockwise.
  it.each([
    { device: 0.75, direction: 'up', slot: 0 },
    { device: 0.875, direction: 'up-right', slot: 1 },
    { device: 0, direction: 'right', slot: 2 },
    { device: 0.125, direction: 'down-right', slot: 3 },
    { device: 0.25, direction: 'down (Cancel)', slot: 4 },
    { device: 0.375, direction: 'down-left', slot: 5 },
    { device: 0.5, direction: 'left', slot: 6 },
    { device: 0.625, direction: 'up-left', slot: 7 },
  ])('maps device angle $device ($direction) to slot $slot', ({ device, slot }) => {
    expect(radialSlotForAngle(device)).toBe(slot);
  });

  it('splits directions halfway between them', () => {
    expect(radialSlotForAngle(0.75 + 1 / 16 - 0.001)).toBe(0);
    expect(radialSlotForAngle(0.75 + 1 / 16 + 0.001)).toBe(1);
    expect(radialSlotForAngle(0.75 - 1 / 16 + 0.001)).toBe(0);
    expect(radialSlotForAngle(0.75 - 1 / 16 - 0.001)).toBe(7);
  });
});

describe('nextSelectableSlot', () => {
  const slots = buildRadialSlots(['s1'], ['p0']);

  it('steps clockwise and counter-clockwise over empty directions', () => {
    expect(nextSelectableSlot(slots, 1, 1)).toBe(RADIAL_CANCEL_SLOT);
    expect(nextSelectableSlot(slots, RADIAL_CANCEL_SLOT, 1)).toBe(0);
    expect(nextSelectableSlot(slots, 0, -1)).toBe(RADIAL_CANCEL_SLOT);
  });

  it('starts from Cancel when nothing is selected', () => {
    expect(nextSelectableSlot(slots, null, 1)).toBe(0);
    expect(nextSelectableSlot(slots, null, -1)).toBe(1);
  });
});

describe('fitRadialLabels', () => {
  const measure = (text: string) => text.length * 7;
  const options = { measure, minRadius: 150, maxRadius: 300 };

  it('keeps the smallest ring when every label fits on one line', () => {
    const fit = fitRadialLabels(['Continue', 'Cancel', ''], options);
    expect(fit.radius).toBe(150);
    expect(fit.lines).toEqual([['Continue'], ['Cancel'], []]);
  });

  it('grows the ring to keep labels on one line when one line can fit', () => {
    const fit = fitRadialLabels(['Commit and push', 'Cancel'], options);
    expect(fit.radius).toBeGreaterThan(150);
    expect(fit.lines[0]).toEqual(['Commit and push']);
    expect(measure('Commit and push')).toBeLessThanOrEqual(radialArcWidth(fit.radius));
    expect(measure('Commit and push')).toBeGreaterThan(radialArcWidth(fit.radius - 2));
  });

  it('grows the ring just enough for a long label to fit on two lines', () => {
    const label = 'Address every unresolved review comment';
    const fit = fitRadialLabels([label, 'Cancel'], options);
    const width = radialArcWidth(fit.radius);
    expect(fit.radius).toBeGreaterThan(150);
    expect(fit.radius).toBeLessThan(300);
    expect(fit.lines[0]).toHaveLength(2);
    expect(fit.lines[0].join(' ')).toBe(label);
    for (const line of fit.lines[0]) expect(measure(line)).toBeLessThanOrEqual(width);
    expect(
      fitRadialLabels([label], { ...options, maxRadius: fit.radius - 1 }).lines[0].join(' '),
    ).not.toBe(label);
  });

  it('ends the second line with an ellipsis when the largest ring is still too small', () => {
    const label = 'word '.repeat(80).trim();
    const fit = fitRadialLabels([label], options);
    const width = radialArcWidth(300);
    expect(fit.radius).toBe(300);
    expect(fit.lines[0]).toHaveLength(2);
    expect(fit.lines[0][1].endsWith('…')).toBe(true);
    for (const line of fit.lines[0]) expect(measure(line)).toBeLessThanOrEqual(width);
  });

  it('truncates a single word wider than the largest arc', () => {
    const fit = fitRadialLabels(['x'.repeat(200)], options);
    expect(fit.lines[0]).toHaveLength(1);
    expect(fit.lines[0][0].endsWith('…')).toBe(true);
    expect(measure(fit.lines[0][0])).toBeLessThanOrEqual(radialArcWidth(300));
  });
});
