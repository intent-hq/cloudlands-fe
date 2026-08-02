import { describe, expect, it } from 'vitest';

import { decodeVendorMessage, isVendorControlId } from '../decode';

describe('decodeVendorMessage', () => {
  describe('v.oai.hid key events', () => {
    it('decodes agent-key and action-key presses and releases', () => {
      expect(decodeVendorMessage({ m: 'v.oai.hid', p: { k: 'AG00', act: 1 } })).toEqual({
        kind: 'key',
        control: 'AG00',
        action: 'press',
      });
      expect(decodeVendorMessage({ m: 'v.oai.hid', p: { k: 'AG05', act: 0 } })).toEqual({
        kind: 'key',
        control: 'AG05',
        action: 'release',
      });
      expect(decodeVendorMessage({ m: 'v.oai.hid', p: { k: 'ACT06', act: 1 } })).toEqual({
        kind: 'key',
        control: 'ACT06',
        action: 'press',
      });
      expect(decodeVendorMessage({ m: 'v.oai.hid', p: { k: 'ACT12', act: 0 } })).toEqual({
        kind: 'key',
        control: 'ACT12',
        action: 'release',
      });
    });

    it('decodes encoder click as a key with press/release', () => {
      expect(decodeVendorMessage({ m: 'v.oai.hid', p: { k: 'ENC_CLK', act: 1 } })).toEqual({
        kind: 'key',
        control: 'ENC_CLK',
        action: 'press',
      });
      expect(decodeVendorMessage({ m: 'v.oai.hid', p: { k: 'ENC_CLK', act: 0 } })).toEqual({
        kind: 'key',
        control: 'ENC_CLK',
        action: 'release',
      });
    });

    it('decodes encoder rotation (act=2, one event per detent)', () => {
      expect(decodeVendorMessage({ m: 'v.oai.hid', p: { k: 'ENC_CW', act: 2 } })).toEqual({
        kind: 'encoder-rotate',
        direction: 'cw',
      });
      expect(decodeVendorMessage({ m: 'v.oai.hid', p: { k: 'ENC_CC', act: 2 } })).toEqual({
        kind: 'encoder-rotate',
        direction: 'ccw',
      });
    });

    it('rejects act=2 on non-rotation controls and press/release on rotation controls', () => {
      expect(decodeVendorMessage({ m: 'v.oai.hid', p: { k: 'AG00', act: 2 } })).toBeNull();
      expect(decodeVendorMessage({ m: 'v.oai.hid', p: { k: 'ENC_CW', act: 1 } })).toBeNull();
      expect(decodeVendorMessage({ m: 'v.oai.hid', p: { k: 'ENC_CC', act: 0 } })).toBeNull();
    });

    it('rejects malformed hid params', () => {
      expect(decodeVendorMessage({ m: 'v.oai.hid', p: { k: 'AG00' } })).toBeNull();
      expect(decodeVendorMessage({ m: 'v.oai.hid', p: { k: 'NOPE', act: 1 } })).toBeNull();
      expect(decodeVendorMessage({ m: 'v.oai.hid', p: { k: 'AG00', act: 7 } })).toBeNull();
      expect(decodeVendorMessage({ m: 'v.oai.hid', p: { k: 'AG00', act: '1' } })).toBeNull();
      expect(decodeVendorMessage({ m: 'v.oai.hid', p: null })).toBeNull();
      expect(decodeVendorMessage({ m: 'v.oai.hid' })).toBeNull();
    });
  });

  describe('joystick stream forms', () => {
    it('decodes the Codex Micro v.oai.rad notification', () => {
      expect(decodeVendorMessage({ m: 'v.oai.rad', p: { a: 0.763528, d: 1 } })).toEqual({
        kind: 'joystick',
        angle: 0.763528,
        distance: 1,
      });
    });

    it('decodes the centered v.oai.rad release sample', () => {
      expect(decodeVendorMessage({ m: 'v.oai.rad', p: { a: 0, d: 0 } })).toEqual({
        kind: 'joystick',
        angle: 0,
        distance: 0,
      });
    });

    it('decodes the CM2 bare {a, d} vendor-mode stream', () => {
      expect(decodeVendorMessage({ a: 0.25, d: 0.9 })).toEqual({
        kind: 'joystick',
        angle: 0.25,
        distance: 0.9,
      });
      expect(decodeVendorMessage({ a: 0, d: 0 })).toEqual({
        kind: 'joystick',
        angle: 0,
        distance: 0,
      });
    });

    it("accepts the transport's normalized {method, params} notification shape", () => {
      expect(decodeVendorMessage({ method: 'v.oai.hid', params: { k: 'AG02', act: 1 } })).toEqual({
        kind: 'key',
        control: 'AG02',
        action: 'press',
      });
      expect(decodeVendorMessage({ method: 'v.oai.rad', params: { a: 0.5, d: 1 } })).toEqual({
        kind: 'joystick',
        angle: 0.5,
        distance: 1,
      });
      expect(decodeVendorMessage({ method: 42, params: {} })).toBeNull();
    });

    it('rejects malformed joystick samples', () => {
      expect(decodeVendorMessage({ m: 'v.oai.rad', p: { a: '0.5', d: 1 } })).toBeNull();
      expect(decodeVendorMessage({ m: 'v.oai.rad', p: { a: 0.5 } })).toBeNull();
      expect(decodeVendorMessage({ m: 'v.oai.rad', p: { a: Number.NaN, d: 0.5 } })).toBeNull();
      expect(decodeVendorMessage({ a: 0.5 })).toBeNull();
      expect(decodeVendorMessage({ a: '0.5', d: 1 })).toBeNull();
    });
  });

  describe('non-input traffic', () => {
    it('ignores JSON-RPC responses and device-originated requests', () => {
      expect(decodeVendorMessage({ id: 1, result: { version: 'v0.6.0' } })).toBeNull();
      expect(decodeVendorMessage({ m: 'host.focused_app', p: {}, id: 3 })).toBeNull();
      expect(decodeVendorMessage({ id: 4, error: { code: 404 } })).toBeNull();
    });

    it('ignores unknown notifications and non-object values', () => {
      expect(decodeVendorMessage({ m: 'v.oai.mystery', p: {} })).toBeNull();
      expect(decodeVendorMessage({ m: 'kb.radial', p: { a: 0.5, d: 1, s: 3 } })).toBeNull();
      expect(decodeVendorMessage(null)).toBeNull();
      expect(decodeVendorMessage(undefined)).toBeNull();
      expect(decodeVendorMessage('v.oai.hid')).toBeNull();
      expect(decodeVendorMessage(42)).toBeNull();
      expect(decodeVendorMessage([{ a: 0.5, d: 1 }])).toBeNull();
    });
  });
});

describe('isVendorControlId', () => {
  it('accepts all 16 vendor control ids', () => {
    for (const id of [
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
    ]) {
      expect(isVendorControlId(id)).toBe(true);
    }
  });

  it('rejects unknown values', () => {
    expect(isVendorControlId('MIC')).toBe(false);
    expect(isVendorControlId('AG06')).toBe(false);
    expect(isVendorControlId(1)).toBe(false);
  });
});
