import { describe, expect, it } from 'vitest';

import { HardwareInputDecoder } from '../input-decoder';
import type {
  HardwareInputEventMap,
  HardwareInputEventType,
  HardwareInputOptions,
  VendorNotificationSource,
} from '../types';

/** Fixture builders mirroring live-captured wire shapes. */
const hid = (k: string, act: number) => ({ m: 'v.oai.hid', p: { k, act } });
const rad = (a: number, d: number) => ({ m: 'v.oai.rad', p: { a, d } });
const bare = (a: number, d: number) => ({ a, d });

type Recorded = { [T in HardwareInputEventType]: { type: T } & HardwareInputEventMap[T] };
type RecordedEvent = Recorded[HardwareInputEventType];

function createHarness(options: HardwareInputOptions = {}) {
  let now = 0;
  const decoder = new HardwareInputDecoder({ now: () => now, ...options });
  const events: RecordedEvent[] = [];
  const types: HardwareInputEventType[] = [
    'keydown',
    'keyup',
    'doublepress',
    'encoderrotate',
    'joystickengage',
    'joystickmove',
    'joysticksector',
    'joystickrelease',
  ];
  for (const type of types) {
    decoder.on(type, (payload) => {
      events.push({ type, ...payload } as RecordedEvent);
    });
  }
  return {
    decoder,
    events,
    advance(ms: number) {
      now += ms;
    },
    feed(...messages: unknown[]) {
      for (const message of messages) decoder.handleMessage(message);
    },
  };
}

describe('HardwareInputDecoder — keys and encoder', () => {
  it('emits keydown/keyup for agent and action keys', () => {
    const h = createHarness();
    h.feed(hid('AG00', 1), hid('AG00', 0), hid('ACT12', 1), hid('ACT12', 0));
    expect(h.events).toEqual([
      { type: 'keydown', key: 'AG00' },
      { type: 'keyup', key: 'AG00' },
      { type: 'keydown', key: 'ACT12' },
      { type: 'keyup', key: 'ACT12' },
    ]);
  });

  it('emits one encoderrotate per detent (act=2)', () => {
    const h = createHarness();
    h.feed(hid('ENC_CW', 2), hid('ENC_CW', 2), hid('ENC_CC', 2));
    expect(h.events).toEqual([
      { type: 'encoderrotate', direction: 'cw' },
      { type: 'encoderrotate', direction: 'cw' },
      { type: 'encoderrotate', direction: 'ccw' },
    ]);
  });

  it('treats encoder click as a key with press/release', () => {
    const h = createHarness();
    h.feed(hid('ENC_CLK', 1), hid('ENC_CLK', 0));
    expect(h.events).toEqual([
      { type: 'keydown', key: 'ENC_CLK' },
      { type: 'keyup', key: 'ENC_CLK' },
    ]);
  });

  it('ignores unrecognized traffic without emitting', () => {
    const h = createHarness();
    h.feed(
      { id: 1, result: {} },
      { m: 'v.oai.mystery', p: {} },
      { m: 'v.oai.hid', p: { k: 'AG00' } },
      null,
      'text',
    );
    expect(h.events).toEqual([]);
  });
});

describe('HardwareInputDecoder — double-press detection', () => {
  it('fires doublepress when the second press lands within the 350 ms window', () => {
    const h = createHarness();
    h.feed(hid('AG01', 1), hid('AG01', 0));
    h.advance(349);
    h.feed(hid('AG01', 1));
    expect(h.events).toEqual([
      { type: 'keydown', key: 'AG01' },
      { type: 'keyup', key: 'AG01' },
      { type: 'keydown', key: 'AG01' },
      { type: 'doublepress', key: 'AG01' },
    ]);
  });

  it('fires at exactly the window boundary but not beyond it', () => {
    const boundary = createHarness();
    boundary.feed(hid('ACT07', 1));
    boundary.advance(350);
    boundary.feed(hid('ACT07', 1));
    expect(boundary.events.filter((e) => e.type === 'doublepress')).toHaveLength(1);

    const late = createHarness();
    late.feed(hid('ACT07', 1));
    late.advance(351);
    late.feed(hid('ACT07', 1));
    expect(late.events.filter((e) => e.type === 'doublepress')).toHaveLength(0);
  });

  it('respects a custom window and applies to ENC_CLK', () => {
    const h = createHarness({ doublePressWindowMs: 100 });
    h.feed(hid('ENC_CLK', 1), hid('ENC_CLK', 0));
    h.advance(99);
    h.feed(hid('ENC_CLK', 1));
    expect(h.events.filter((e) => e.type === 'doublepress')).toEqual([
      { type: 'doublepress', key: 'ENC_CLK' },
    ]);
  });

  it('does not chain: a triple press yields one doublepress', () => {
    const h = createHarness();
    h.feed(hid('AG02', 1));
    h.advance(100);
    h.feed(hid('AG02', 1));
    h.advance(100);
    h.feed(hid('AG02', 1));
    expect(h.events.filter((e) => e.type === 'doublepress')).toHaveLength(1);
  });

  it('tracks keys independently', () => {
    const h = createHarness();
    h.feed(hid('AG00', 1));
    h.advance(100);
    h.feed(hid('AG01', 1));
    expect(h.events.filter((e) => e.type === 'doublepress')).toHaveLength(0);
  });
});

describe('HardwareInputDecoder — joystick', () => {
  const joystick = { sectorCount: 8, sectorDebounceMs: 50 };

  it('stays silent inside the dead-zone', () => {
    const h = createHarness({ joystick });
    h.feed(rad(0.1, 0.1), rad(0.2, 0.34), bare(0.3, 0.2), bare(0, 0));
    expect(h.events).toEqual([]);
  });

  it('engages when deflection crosses the dead-zone, with host-side sector math', () => {
    const h = createHarness({ joystick });
    h.feed(rad(0.763528, 1));
    expect(h.events).toEqual([
      { type: 'joystickengage', angle: 0.763528, distance: 1, sector: 6 },
      { type: 'joystickmove', angle: 0.763528, distance: 1, sector: 6 },
    ]);
  });

  it('drives the same state machine from the CM2 bare {a, d} form', () => {
    const h = createHarness({ joystick });
    h.feed(bare(0.5, 0.9), bare(0, 0));
    expect(h.events).toEqual([
      { type: 'joystickengage', angle: 0.5, distance: 0.9, sector: 4 },
      { type: 'joystickmove', angle: 0.5, distance: 0.9, sector: 4 },
      { type: 'joystickrelease', sector: 4 },
    ]);
  });

  it('releases on the centered {a:0, d:0} sample with the selected sector', () => {
    const h = createHarness({ joystick });
    h.feed(rad(0.9, 1), rad(0, 0));
    expect(h.events.at(-1)).toEqual({ type: 'joystickrelease', sector: 7 });
  });

  it('applies hysteresis: mid-band deflection neither engages nor releases', () => {
    const h = createHarness({ joystick });
    h.feed(rad(0.5, 1));
    h.events.length = 0;
    h.feed(rad(0.5, 0.25));
    expect(h.events).toEqual([{ type: 'joystickmove', angle: 0.5, distance: 0.25, sector: 4 }]);
    h.feed(rad(0.5, 0.2));
    expect(h.events.at(-1)).toEqual({ type: 'joystickrelease', sector: 4 });
  });

  it('debounces sector changes: a new sector must persist before it fires', () => {
    const h = createHarness({ joystick });
    h.feed(rad(0.5, 1));
    h.events.length = 0;
    h.feed(rad(0.63, 1));
    expect(h.events).toEqual([{ type: 'joystickmove', angle: 0.63, distance: 1, sector: 4 }]);
    h.advance(49);
    h.feed(rad(0.63, 1));
    expect(h.events.filter((e) => e.type === 'joysticksector')).toHaveLength(0);
    h.advance(1);
    h.feed(rad(0.63, 1));
    expect(h.events.filter((e) => e.type === 'joysticksector')).toEqual([
      { type: 'joysticksector', angle: 0.63, distance: 1, sector: 5 },
    ]);
    expect(h.events.at(-1)).toEqual({ type: 'joystickmove', angle: 0.63, distance: 1, sector: 5 });
  });

  it('cancels a pending sector change when the stick jitters back', () => {
    const h = createHarness({ joystick });
    h.feed(rad(0.5, 1));
    h.events.length = 0;
    h.feed(rad(0.63, 1));
    h.advance(30);
    h.feed(rad(0.5, 1));
    h.advance(100);
    h.feed(rad(0.5, 1));
    expect(h.events.filter((e) => e.type === 'joysticksector')).toHaveLength(0);
    h.feed(rad(0, 0));
    expect(h.events.at(-1)).toEqual({ type: 'joystickrelease', sector: 4 });
  });

  it('restarts the debounce clock when the candidate sector changes again', () => {
    const h = createHarness({ joystick });
    h.feed(rad(0.5, 1));
    h.events.length = 0;
    h.feed(rad(0.63, 1));
    h.advance(40);
    h.feed(rad(0.8, 1));
    h.advance(40);
    h.feed(rad(0.8, 1));
    expect(h.events.filter((e) => e.type === 'joysticksector')).toHaveLength(0);
    h.advance(10);
    h.feed(rad(0.8, 1));
    expect(h.events.filter((e) => e.type === 'joysticksector')).toEqual([
      { type: 'joysticksector', angle: 0.8, distance: 1, sector: 6 },
    ]);
  });

  it('honors setSectorCount and the sector offset', () => {
    const h = createHarness({ joystick: { ...joystick, sectorOffset: 0.25 } });
    h.decoder.setSectorCount(4);
    h.feed(rad(0.25, 1));
    expect(h.events[0]).toEqual({ type: 'joystickengage', angle: 0.25, distance: 1, sector: 0 });
    expect(() => h.decoder.setSectorCount(0)).toThrow(RangeError);
    expect(() => h.decoder.setSectorCount(1.5)).toThrow(RangeError);
  });

  it('normalizes out-of-range samples before sector math', () => {
    const h = createHarness({ joystick });
    h.feed(rad(1.25, 3));
    expect(h.events[0]).toEqual({ type: 'joystickengage', angle: 0.25, distance: 1, sector: 2 });
  });
});

describe('HardwareInputDecoder — Codex Micro Mic linked pair', () => {
  it('keeps ACT10 and ACT11 as separate keys (both fire on a factory Mic press)', () => {
    const h = createHarness({ deviceModel: 'codex-micro' });
    h.feed(hid('ACT10', 1), hid('ACT11', 1), hid('ACT10', 0), hid('ACT11', 0));
    expect(h.events).toEqual([
      { type: 'keydown', key: 'ACT10' },
      { type: 'keydown', key: 'ACT11' },
      { type: 'keyup', key: 'ACT10' },
      { type: 'keyup', key: 'ACT11' },
    ]);
  });

  it('supports an unlinked ACT11 pressed on its own', () => {
    const h = createHarness({ deviceModel: 'codex-micro' });
    h.feed(hid('ACT11', 1), hid('ACT11', 0));
    expect(h.events).toEqual([
      { type: 'keydown', key: 'ACT11' },
      { type: 'keyup', key: 'ACT11' },
    ]);
  });

  it('tracks double-press per switch, not across the pair', () => {
    const h = createHarness({ deviceModel: 'codex-micro' });
    h.feed(hid('ACT10', 1), hid('ACT10', 0));
    h.advance(200);
    h.feed(hid('ACT11', 1));
    expect(h.events.filter((e) => e.type === 'doublepress')).toEqual([]);
    h.advance(100);
    h.feed(hid('ACT10', 1));
    expect(h.events.filter((e) => e.type === 'doublepress')).toEqual([
      { type: 'doublepress', key: 'ACT10' },
    ]);
  });

  it('behaves identically on the Creator Micro 2', () => {
    const h = createHarness({ deviceModel: 'creator-micro-2' });
    h.feed(hid('ACT10', 1), hid('ACT11', 1), hid('ACT10', 0), hid('ACT11', 0));
    expect(h.events).toEqual([
      { type: 'keydown', key: 'ACT10' },
      { type: 'keydown', key: 'ACT11' },
      { type: 'keyup', key: 'ACT10' },
      { type: 'keyup', key: 'ACT11' },
    ]);
  });
});

describe('HardwareInputDecoder — emitter and transport attachment', () => {
  it('supports unsubscribing via the returned function and off()', () => {
    const decoder = new HardwareInputDecoder();
    const seen: string[] = [];
    const unsubscribe = decoder.on('keydown', ({ key }) => seen.push(`a:${key}`));
    const second = ({ key }: { key: string }) => seen.push(`b:${key}`);
    decoder.on('keydown', second);
    decoder.handleMessage(hid('AG00', 1));
    unsubscribe();
    decoder.off('keydown', second);
    decoder.handleMessage(hid('AG01', 1));
    expect(seen).toEqual(['a:AG00', 'b:AG00']);
  });

  it('consumes a VendorNotificationSource via attach() until detached', () => {
    let listener: ((message: unknown) => void) | null = null;
    const source: VendorNotificationSource = {
      onNotification(cb) {
        listener = cb;
        return () => {
          listener = null;
        };
      },
    };
    const decoder = new HardwareInputDecoder();
    const seen: string[] = [];
    decoder.on('keydown', ({ key }) => seen.push(key));
    const detach = decoder.attach(source);
    listener!(hid('AG03', 1));
    detach();
    expect(listener).toBeNull();
    expect(seen).toEqual(['AG03']);
  });
});
