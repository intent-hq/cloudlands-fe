import { describe, expect, it } from 'vitest';

import {
  CHANNEL_LOG,
  CHANNEL_RPC,
  decodeFrame,
  encodeFrames,
  JsonReassembler,
  MAX_PAYLOAD,
  REPORT_BODY_SIZE,
} from '../frame';

const encoder = new TextEncoder();

/** Build a 63-byte report body the way the firmware does. */
function body(channel: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(REPORT_BODY_SIZE);
  out[0] = channel;
  out[1] = payload.length;
  out.set(payload, 2);
  return out;
}

describe('encodeFrames', () => {
  it('encodes a short payload as a single padded 63-byte body', () => {
    const frames = encodeFrames(CHANNEL_RPC, encoder.encode('{"id":1}'));
    expect(frames).toHaveLength(1);
    const frame = frames[0];
    expect(frame.length).toBe(REPORT_BODY_SIZE);
    expect(frame[0]).toBe(CHANNEL_RPC);
    expect(frame[1]).toBe(8);
    expect(Array.from(frame.slice(2, 10))).toEqual(Array.from(encoder.encode('{"id":1}')));
    // Zero padding after the payload.
    expect(frame.slice(10).every((b) => b === 0)).toBe(true);
  });

  it('encodes exactly MAX_PAYLOAD bytes as a single full frame', () => {
    const data = new Uint8Array(MAX_PAYLOAD).fill(0x41);
    const frames = encodeFrames(CHANNEL_RPC, data);
    expect(frames).toHaveLength(1);
    expect(frames[0][1]).toBe(MAX_PAYLOAD);
  });

  it('fragments payloads larger than MAX_PAYLOAD', () => {
    const data = new Uint8Array(MAX_PAYLOAD + 5).fill(0x42);
    const frames = encodeFrames(CHANNEL_RPC, data);
    expect(frames).toHaveLength(2);
    expect(frames[0][1]).toBe(MAX_PAYLOAD);
    expect(frames[1][1]).toBe(5);
  });

  it('round-trips a multi-fragment payload through decodeFrame', () => {
    const message = JSON.stringify({
      method: 'sys.version',
      params: { detail: 'x'.repeat(200) },
      id: 42,
    });
    const data = encoder.encode(message);
    const frames = encodeFrames(CHANNEL_RPC, data);
    expect(frames.length).toBe(Math.ceil(data.length / MAX_PAYLOAD));
    const rejoined = new Uint8Array(data.length);
    let offset = 0;
    for (const frame of frames) {
      const decoded = decodeFrame(frame);
      expect(decoded.channel).toBe(CHANNEL_RPC);
      rejoined.set(decoded.payload, offset);
      offset += decoded.payload.length;
    }
    expect(new TextDecoder().decode(rejoined)).toBe(message);
  });

  it('encodes empty data as a single zero-length frame', () => {
    const frames = encodeFrames(CHANNEL_RPC, new Uint8Array(0));
    expect(frames).toHaveLength(1);
    expect(frames[0][1]).toBe(0);
  });
});

describe('decodeFrame', () => {
  it('decodes channel and payload from a padded body', () => {
    const frame = decodeFrame(body(CHANNEL_LOG, encoder.encode('boot ok')));
    expect(frame.channel).toBe(CHANNEL_LOG);
    expect(new TextDecoder().decode(frame.payload)).toBe('boot ok');
  });

  it('throws on a body that is too short', () => {
    expect(() => decodeFrame(new Uint8Array([2]))).toThrow(/too short/);
  });

  it('throws on a length byte larger than the body allows', () => {
    const bad = new Uint8Array([CHANNEL_RPC, 62]);
    expect(() => decodeFrame(bad)).toThrow(/invalid vendor payload length/);
  });
});

describe('JsonReassembler', () => {
  it('returns the parsed value for a single complete fragment', () => {
    const reassembler = new JsonReassembler();
    const value = reassembler.push(encoder.encode('{"id":1,"result":{"fw":"0.6.0"}}'));
    expect(value).toEqual({ id: 1, result: { fw: '0.6.0' } });
  });

  it('buffers fragments until the JSON parses', () => {
    const reassembler = new JsonReassembler();
    const message = JSON.stringify({ id: 7, result: { blob: 'y'.repeat(150) } });
    const data = encoder.encode(message);
    const first = data.subarray(0, MAX_PAYLOAD);
    const second = data.subarray(MAX_PAYLOAD, MAX_PAYLOAD * 2);
    const third = data.subarray(MAX_PAYLOAD * 2);
    expect(reassembler.push(first)).toBeUndefined();
    expect(reassembler.push(second)).toBeUndefined();
    expect(reassembler.push(third)).toEqual(JSON.parse(message));
  });

  it('handles back-to-back messages after completion', () => {
    const reassembler = new JsonReassembler();
    expect(reassembler.push(encoder.encode('{"id":1,"result":null}'))).toEqual({
      id: 1,
      result: null,
    });
    expect(reassembler.push(encoder.encode('{"id":2,"result":null}'))).toEqual({
      id: 2,
      result: null,
    });
  });

  it('reset drops partial state', () => {
    const reassembler = new JsonReassembler();
    expect(reassembler.push(encoder.encode('{"id":3,'))).toBeUndefined();
    reassembler.reset();
    expect(reassembler.push(encoder.encode('{"id":4,"result":null}'))).toEqual({
      id: 4,
      result: null,
    });
  });
});
