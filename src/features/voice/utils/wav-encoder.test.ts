/**
 * Tests for the WAV encoder: RIFF header layout, 16-bit PCM sample encoding
 * with clamping, mono downmix, and chunked base64 encoding. `blobToWav` needs
 * WebAudio (not present in jsdom) and is covered by its consumers with the
 * conversion stubbed.
 */
import { describe, expect, it } from "vitest";
import {
  arrayBufferToBase64,
  downmixToMono,
  encodeWavPcm16,
  WAV_SAMPLE_RATE,
} from "./wav-encoder";

const ascii = (view: DataView, offset: number, length: number) =>
  Array.from({ length }, (_, i) => String.fromCharCode(view.getUint8(offset + i))).join("");

describe("encodeWavPcm16", () => {
  it("writes a valid RIFF/WAVE header for 16 kHz mono 16-bit PCM", () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1]);
    const buffer = encodeWavPcm16(samples, WAV_SAMPLE_RATE);
    const view = new DataView(buffer);

    expect(buffer.byteLength).toBe(44 + samples.length * 2);
    expect(ascii(view, 0, 4)).toBe("RIFF");
    expect(view.getUint32(4, true)).toBe(36 + samples.length * 2);
    expect(ascii(view, 8, 4)).toBe("WAVE");
    expect(ascii(view, 12, 4)).toBe("fmt ");
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(WAV_SAMPLE_RATE);
    expect(view.getUint32(28, true)).toBe(WAV_SAMPLE_RATE * 2); // byte rate
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
    expect(ascii(view, 36, 4)).toBe("data");
    expect(view.getUint32(40, true)).toBe(samples.length * 2);
  });

  it("encodes and clamps samples to the int16 range", () => {
    const buffer = encodeWavPcm16(new Float32Array([0, 1, -1, 2, -2]), WAV_SAMPLE_RATE);
    const view = new DataView(buffer);
    expect(view.getInt16(44, true)).toBe(0);
    expect(view.getInt16(46, true)).toBe(0x7fff);
    expect(view.getInt16(48, true)).toBe(-0x8000);
    expect(view.getInt16(50, true)).toBe(0x7fff); // clamped
    expect(view.getInt16(52, true)).toBe(-0x8000); // clamped
  });
});

describe("downmixToMono", () => {
  it("averages the channels of a stereo buffer", () => {
    const channels = [new Float32Array([1, 0]), new Float32Array([0, 1])];
    const fakeBuffer = {
      length: 2,
      numberOfChannels: 2,
      getChannelData: (index: number) => channels[index],
    } as unknown as AudioBuffer;
    expect(Array.from(downmixToMono(fakeBuffer))).toEqual([0.5, 0.5]);
  });
});

describe("arrayBufferToBase64", () => {
  it("encodes small buffers", () => {
    expect(arrayBufferToBase64(new Uint8Array([1, 2, 3]).buffer)).toBe("AQID");
  });

  it("encodes buffers larger than one chunk (0x8000 bytes)", () => {
    const bytes = new Uint8Array(0x8000 + 3);
    bytes.fill(65);
    const decoded = atob(arrayBufferToBase64(bytes.buffer));
    expect(decoded.length).toBe(bytes.length);
    expect(decoded.charCodeAt(0)).toBe(65);
    expect(decoded.charCodeAt(decoded.length - 1)).toBe(65);
  });
});
