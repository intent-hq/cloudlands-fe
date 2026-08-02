/**
 * Vendor report-6 framing: 64-byte HID packets
 * `[reportId=6][channel][len][payload ≤ 61 bytes][zero padding]`.
 *
 * WebHID passes the report ID out of band (`sendReport(reportId, data)` /
 * `HIDInputReportEvent.reportId`), so the encode/decode functions here work
 * on the 63-byte report body `[channel][len][payload…]`.
 *
 * Pure functions — no DOM, Electron, or hardware dependencies.
 */

/** HID report ID of the vendor protocol channel. */
export const REPORT_ID = 6;
/** Channel carrying firmware log text. */
export const CHANNEL_LOG = 1;
/** Channel carrying JSON-RPC messages. */
export const CHANNEL_RPC = 2;
/** Maximum payload bytes per packet (64 - reportId - channel - len). */
export const MAX_PAYLOAD = 61;
/** Report body size excluding the report ID byte (as seen by WebHID). */
export const REPORT_BODY_SIZE = 63;

/** Reassembly buffer cap; a run of undecodable fragments is dropped past it. */
const MAX_REASSEMBLY_BYTES = 64 * 1024;

export interface VendorFrame {
  channel: number;
  payload: Uint8Array;
}

/**
 * Split `data` into one or more 63-byte report bodies on `channel`.
 * Empty data still produces a single zero-length frame.
 */
export function encodeFrames(channel: number, data: Uint8Array): Uint8Array[] {
  const frames: Uint8Array[] = [];
  let offset = 0;
  do {
    const chunk = data.subarray(offset, offset + MAX_PAYLOAD);
    const body = new Uint8Array(REPORT_BODY_SIZE);
    body[0] = channel;
    body[1] = chunk.length;
    body.set(chunk, 2);
    frames.push(body);
    offset += MAX_PAYLOAD;
  } while (offset < data.length);
  return frames;
}

/**
 * Decode a 63-byte report body (report ID already stripped by WebHID) into a
 * frame. Throws on malformed length.
 */
export function decodeFrame(body: Uint8Array): VendorFrame {
  if (body.length < 2) {
    throw new Error(`vendor report too short: ${body.length} bytes`);
  }
  const len = body[1];
  if (len > MAX_PAYLOAD || 2 + len > body.length) {
    throw new Error(`invalid vendor payload length ${len}`);
  }
  return { channel: body[0], payload: body.slice(2, 2 + len) };
}

/**
 * Reassembles fragmented channel-2 payloads until they form complete JSON.
 *
 * Mirrors the reference implementations (cm2-probe, codex-microd): fragments
 * are appended and the buffer is parsed after each push; the message is
 * complete when the parse succeeds. RPC payloads are always JSON objects, so
 * a prefix of a message never parses as valid JSON.
 */
export class JsonReassembler {
  private buffer = new Uint8Array(0);
  private readonly decoder = new TextDecoder();

  /** Feed one fragment; returns the parsed JSON value once complete. */
  push(fragment: Uint8Array): unknown | undefined {
    const next = new Uint8Array(this.buffer.length + fragment.length);
    next.set(this.buffer, 0);
    next.set(fragment, this.buffer.length);
    this.buffer = next;
    try {
      const value: unknown = JSON.parse(this.decoder.decode(this.buffer));
      this.buffer = new Uint8Array(0);
      return value;
    } catch {
      if (this.buffer.length > MAX_REASSEMBLY_BYTES) {
        this.buffer = new Uint8Array(0);
      }
      return undefined;
    }
  }

  reset(): void {
    this.buffer = new Uint8Array(0);
  }
}
