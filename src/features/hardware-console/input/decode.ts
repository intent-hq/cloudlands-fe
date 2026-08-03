/**
 * Pure, stateless decoding of vendor channel-2 JSON messages into typed
 * shapes. Session behavior (double-press, dead-zone, Mic coalescing) lives in
 * the stateful decoder; this module never holds state.
 *
 * Handled shapes:
 * - `{"m":"v.oai.hid","p":{"k":"AG00","act":1}}` — key/encoder events
 *   (both devices). `act`: 1 = press, 0 = release, 2 = encoder detent.
 * - `{"m":"v.oai.rad","p":{"a":0.76,"d":1}}` — Codex Micro joystick stream.
 * - `{"a":0.76,"d":1}` — CM2 vendor-mode joystick stream (bare form, no
 *   method wrapper). Centered `{a:0,d:0}` means released on both devices.
 * - The transport's normalized notification shape `{method, params}` is
 *   accepted as an alias for the wire `{m, p}` keys.
 */

import type { DecodedVendorMessage, VendorControlId } from './types';

const VENDOR_CONTROL_IDS: readonly VendorControlId[] = [
  'AG00',
  'AG01',
  'AG02',
  'AG03',
  'AG04',
  'AG05',
  'ACT06',
  'ACT07',
  'ACT08',
  'ACT09',
  'ACT10',
  'ACT11',
  'ACT12',
  'ENC_CC',
  'ENC_CW',
  'ENC_CLK',
];

export function isVendorControlId(value: unknown): value is VendorControlId {
  return typeof value === 'string' && (VENDOR_CONTROL_IDS as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decodeHidParams(params: unknown): DecodedVendorMessage | null {
  if (!isRecord(params)) return null;
  const { k, act } = params;
  if (!isVendorControlId(k) || typeof act !== 'number') return null;
  if (act === 2) {
    if (k === 'ENC_CW') return { kind: 'encoder-rotate', direction: 'cw' };
    if (k === 'ENC_CC') return { kind: 'encoder-rotate', direction: 'ccw' };
    return null;
  }
  if (act !== 0 && act !== 1) return null;
  // Rotation-only controls never emit press/release.
  if (k === 'ENC_CW' || k === 'ENC_CC') return null;
  return { kind: 'key', control: k, action: act === 1 ? 'press' : 'release' };
}

function decodeRadialParams(params: unknown): DecodedVendorMessage | null {
  if (!isRecord(params)) return null;
  const { a, d } = params;
  if (typeof a !== 'number' || typeof d !== 'number') return null;
  if (!Number.isFinite(a) || !Number.isFinite(d)) return null;
  return { kind: 'joystick', angle: a, distance: d };
}

/**
 * Decode one parsed channel-2 JSON value into a typed message, or `null` for
 * anything unrecognized (responses, unknown notifications, malformed params).
 */
export function decodeVendorMessage(message: unknown): DecodedVendorMessage | null {
  if (!isRecord(message)) return null;
  // JSON-RPC responses / device-originated requests carry an id — not input.
  if ('id' in message) return null;
  if ('m' in message || 'method' in message) {
    const method = message.m ?? message.method;
    if (typeof method !== 'string') return null;
    const params = 'p' in message ? message.p : message.params;
    if (method === 'v.oai.hid') return decodeHidParams(params);
    if (method === 'v.oai.rad') return decodeRadialParams(params);
    return null;
  }
  // CM2 vendor-mode joystick stream: bare `{a, d}` with no method wrapper.
  if ('a' in message && 'd' in message) {
    return decodeRadialParams(message);
  }
  return null;
}
