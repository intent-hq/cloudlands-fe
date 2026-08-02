/**
 * Vendor-channel transport over an opened WebHID device.
 *
 * Owns the report-6 wire layer: fragments outbound messages into 63-byte
 * report bodies, reassembles inbound fragments, and demuxes channels
 * (1 = firmware log text, 2 = JSON-RPC). Platform-neutral: depends only on
 * the structural `HidDeviceLike` surface.
 */

import { Logger } from '../../../shared/logger';
import {
  CHANNEL_LOG,
  CHANNEL_RPC,
  decodeFrame,
  encodeFrames,
  JsonReassembler,
  REPORT_ID,
} from './frame';
import type { HidDeviceLike, HidInputReportEventLike } from './webhid-types';

const logger = new Logger('HardwareConsoleTransport');

export class VendorChannelTransport {
  private readonly reassembler = new JsonReassembler();
  private readonly rpcListeners = new Set<(message: unknown) => void>();
  private readonly logListeners = new Set<(text: string) => void>();
  private readonly textDecoder = new TextDecoder();
  private readonly textEncoder = new TextEncoder();
  private writeQueue: Promise<void> = Promise.resolve();
  private attached = false;

  private readonly inputListener = (event: HidInputReportEventLike): void => {
    this.handleInputReport(event);
  };

  constructor(private readonly device: HidDeviceLike) {}

  /** Start receiving input reports from the device. */
  attach(): void {
    if (this.attached) return;
    this.device.addEventListener('inputreport', this.inputListener);
    this.attached = true;
  }

  /** Stop receiving input reports and drop any partial reassembly state. */
  detach(): void {
    if (!this.attached) return;
    this.device.removeEventListener('inputreport', this.inputListener);
    this.attached = false;
    this.reassembler.reset();
  }

  /**
   * Serialize a JSON-RPC message and send it as one or more report-6 packets
   * on channel 2. Writes are queued so fragments from concurrent sends never
   * interleave on the wire.
   */
  sendRpcMessage(message: unknown): Promise<void> {
    const frames = encodeFrames(CHANNEL_RPC, this.textEncoder.encode(JSON.stringify(message)));
    const task = this.writeQueue.then(async () => {
      for (const frame of frames) {
        await this.device.sendReport(REPORT_ID, frame);
      }
    });
    this.writeQueue = task.catch(() => undefined);
    return task;
  }

  /** Subscribe to fully reassembled channel-2 JSON messages. */
  onRpcMessage(listener: (message: unknown) => void): () => void {
    this.rpcListeners.add(listener);
    return () => this.rpcListeners.delete(listener);
  }

  /** Subscribe to channel-1 firmware log text. */
  onLog(listener: (text: string) => void): () => void {
    this.logListeners.add(listener);
    return () => this.logListeners.delete(listener);
  }

  private handleInputReport(event: HidInputReportEventLike): void {
    if (event.reportId !== REPORT_ID) return;
    const body = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
    let frame;
    try {
      frame = decodeFrame(body);
    } catch (error) {
      logger.warn('Skipping undecodable vendor report', { error: String(error) });
      return;
    }
    switch (frame.channel) {
      case CHANNEL_LOG: {
        const text = this.textDecoder.decode(frame.payload);
        for (const listener of this.logListeners) listener(text);
        break;
      }
      case CHANNEL_RPC: {
        const message = this.reassembler.push(frame.payload);
        if (message !== undefined) {
          for (const listener of this.rpcListeners) listener(message);
        }
        break;
      }
      default:
        logger.warn('Ignoring frame on unknown vendor channel', { channel: frame.channel });
    }
  }
}
