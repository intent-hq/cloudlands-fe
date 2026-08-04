import { describe, expect, it } from 'vitest';
import {
  AGENT_KEY_LED_COUNT,
  LED_EFFECT_BREATH,
  LED_EFFECT_OFF,
  LED_EFFECT_SNAKE,
  LED_EFFECT_SOLID,
  SLOT_TO_LED_ID,
  buildRgbcfgParams,
  buildThStatusParams,
  type AgentKeyLedState,
  type ThStatusEntry,
} from '../frames';

/** Frame entry driving the physical LED of a binding slot. */
function entryForSlot(frame: ThStatusEntry[], slot: number): ThStatusEntry {
  return frame.find((entry) => entry.id === SLOT_TO_LED_ID[slot])!;
}

describe('buildThStatusParams', () => {
  it('always emits a full frame with ids 0-5', () => {
    const frame = buildThStatusParams(['idle', 'running', 'complete', 'attention', 'failed', 'unassigned']);
    expect(frame).toHaveLength(AGENT_KEY_LED_COUNT);
    expect(frame.map((entry) => entry.id)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('maps binding slots to physical LEDs: slots 1-4 = second row (ids 2-5), slots 5-6 = top row (ids 0-1)', () => {
    expect(SLOT_TO_LED_ID).toEqual([2, 3, 4, 5, 0, 1]);
    const frame = buildThStatusParams(['running', 'unassigned', 'unassigned', 'unassigned', 'idle', 'unassigned']);
    // Slot 0 (key "1", AG02) drives LED id 2.
    expect(frame.find((entry) => entry.id === 2)).toMatchObject({ e: LED_EFFECT_BREATH });
    // Slot 4 (key "5", AG00) drives LED id 0.
    expect(frame.find((entry) => entry.id === 0)).toMatchObject({ e: LED_EFFECT_SOLID });
  });

  it('pads missing trailing slots as unassigned (off)', () => {
    const frame = buildThStatusParams(['idle']);
    expect(frame).toHaveLength(AGENT_KEY_LED_COUNT);
    for (const entry of frame) {
      if (entry.id === SLOT_TO_LED_ID[0]) continue;
      expect(entry.e).toBe(LED_EFFECT_OFF);
      expect(entry.b).toBe(0);
    }
  });

  it('maps the spec palette per state', () => {
    const states: AgentKeyLedState[] = [
      'unassigned',
      'idle',
      'running',
      'complete',
      'attention',
      'failed',
    ];
    const frame = buildThStatusParams(states);
    // Off: key unassigned
    expect(entryForSlot(frame, 0).e).toBe(LED_EFFECT_OFF);
    // Dim white: idle
    expect(entryForSlot(frame, 1)).toMatchObject({ c: 0xffffff, e: LED_EFFECT_SOLID });
    expect(entryForSlot(frame, 1).b).toBeLessThan(0.3);
    // Blue slow breath: thinking/working
    expect(entryForSlot(frame, 2)).toMatchObject({ c: 0x0a84ff, e: LED_EFFECT_BREATH });
    // Green steady: complete / PR ready
    expect(entryForSlot(frame, 3)).toMatchObject({ c: 0x30d158, e: LED_EFFECT_SOLID });
    expect(entryForSlot(frame, 3).s).toBe(0);
    // Yellow fast breath: needs input
    expect(entryForSlot(frame, 4)).toMatchObject({ c: 0xffd60a, e: LED_EFFECT_BREATH });
    expect(entryForSlot(frame, 4).s).toBeGreaterThan(entryForSlot(frame, 2).s);
    // Red fast breath: failed / error
    expect(entryForSlot(frame, 5)).toMatchObject({ c: 0xff3b30, e: LED_EFFECT_BREATH });
    expect(entryForSlot(frame, 5).s).toBe(entryForSlot(frame, 4).s);
    expect(entryForSlot(frame, 5).s).toBeGreaterThan(entryForSlot(frame, 2).s);
  });

  it('blocked breathes orange fast with brightness between attention and failed', () => {
    const frame = buildThStatusParams(['blocked', 'attention', 'failed']);
    const blocked = entryForSlot(frame, 0);
    const attention = entryForSlot(frame, 1);
    const failed = entryForSlot(frame, 2);
    expect(blocked).toMatchObject({ c: 0xff9f0a, e: LED_EFFECT_BREATH });
    expect(blocked.s).toBe(attention.s);
    expect(blocked.b).toBeLessThan(attention.b);
    expect(blocked.b).toBeGreaterThan(failed.b);
  });

  it('unread breathes cyan slower than running with modest brightness', () => {
    const frame = buildThStatusParams(['unread', 'running']);
    const unread = entryForSlot(frame, 0);
    expect(unread).toMatchObject({ c: 0x64d2ff, e: LED_EFFECT_BREATH });
    expect(unread.s).toBeLessThan(entryForSlot(frame, 1).s);
    expect(unread.b).toBeCloseTo(0.4);
  });

  it('every entry carries the {id, c, b, e, s} wire shape', () => {
    for (const entry of buildThStatusParams(['running'])) {
      expect(Object.keys(entry).sort()).toEqual(['b', 'c', 'e', 'id', 's']);
    }
  });
});

describe('buildRgbcfgParams', () => {
  it('dark turns both zones off', () => {
    const params = buildRgbcfgParams({ kind: 'dark' });
    expect(params.keys.e).toBe(LED_EFFECT_OFF);
    expect(params.ambient.e).toBe(LED_EFFECT_OFF);
    expect(params.ambient.b).toBe(0);
  });

  it('running pulses blue in both zones', () => {
    const params = buildRgbcfgParams({ kind: 'running', runningCount: 1 });
    expect(params.keys).toMatchObject({ e: LED_EFFECT_BREATH, c: 0x0a84ff, b: 0.5 });
    expect(params.ambient).toMatchObject({ e: LED_EFFECT_BREATH, c: 0x0a84ff, b: 0.5 });
  });

  it('running breath speed scales with the running count, clamped at 4+', () => {
    const speedAt = (runningCount: number) =>
      buildRgbcfgParams({ kind: 'running', runningCount }).ambient.s;
    expect(speedAt(1)).toBeCloseTo(0.35);
    expect(speedAt(2)).toBeGreaterThan(speedAt(1));
    expect(speedAt(4)).toBeGreaterThan(speedAt(2));
    expect(speedAt(4)).toBeCloseTo(0.75);
    expect(speedAt(9)).toBe(speedAt(4));
    expect(speedAt(0)).toBe(speedAt(1));
  });

  it('question breathes yellow faster and brighter than running', () => {
    const question = buildRgbcfgParams({ kind: 'question' });
    const running = buildRgbcfgParams({ kind: 'running', runningCount: 1 });
    expect(question.ambient.c).toBe(0xffd60a);
    expect(question.ambient.s).toBeGreaterThan(running.ambient.s);
    expect(question.ambient.b).toBeGreaterThan(running.ambient.b);
  });

  it('blocked breathes orange at the urgent speed and brightness', () => {
    const blocked = buildRgbcfgParams({ kind: 'blocked' });
    const question = buildRgbcfgParams({ kind: 'question' });
    expect(blocked.ambient).toMatchObject({ e: LED_EFFECT_BREATH, c: 0xff9f0a });
    expect(blocked.ambient.s).toBe(question.ambient.s);
    expect(blocked.ambient.b).toBe(question.ambient.b);
  });

  it('failed breathes red at the urgent speed and brightness', () => {
    const failed = buildRgbcfgParams({ kind: 'failed' });
    const question = buildRgbcfgParams({ kind: 'question' });
    expect(failed.ambient).toMatchObject({ e: LED_EFFECT_BREATH, c: 0xff3b30 });
    expect(failed.ambient.s).toBe(question.ambient.s);
    expect(failed.ambient.b).toBe(question.ambient.b);
  });

  it('unread breathes cyan slower than running at 1', () => {
    const unread = buildRgbcfgParams({ kind: 'unread' });
    const running = buildRgbcfgParams({ kind: 'running', runningCount: 1 });
    expect(unread.ambient).toMatchObject({ e: LED_EFFECT_BREATH, c: 0x64d2ff, b: 0.4 });
    expect(unread.ambient.s).toBeLessThan(running.ambient.s);
  });

  it('complete glows solid green, dim', () => {
    const params = buildRgbcfgParams({ kind: 'complete' });
    expect(params.ambient).toMatchObject({ e: LED_EFFECT_SOLID, c: 0x30d158, s: 0 });
    expect(params.ambient.b).toBeLessThanOrEqual(0.3);
    expect(params.ambient.b).toBeGreaterThan(0);
  });

  it('disconnected crawls a dim purple snake', () => {
    const params = buildRgbcfgParams({ kind: 'disconnected' });
    expect(params.keys).toMatchObject({ e: LED_EFFECT_SNAKE, c: 0xbf5af2 });
    expect(params.ambient).toMatchObject({ e: LED_EFFECT_SNAKE, c: 0xbf5af2 });
    expect(params.ambient.b).toBeLessThanOrEqual(0.2);
    expect(params.ambient.s).toBeGreaterThan(0);
  });

  it('zones carry the {e, b, s, m, c} wire shape', () => {
    const params = buildRgbcfgParams({ kind: 'running', runningCount: 1 });
    expect(Object.keys(params.keys).sort()).toEqual(['b', 'c', 'e', 'm', 's']);
    expect(Object.keys(params.ambient).sort()).toEqual(['b', 'c', 'e', 'm', 's']);
  });
});
