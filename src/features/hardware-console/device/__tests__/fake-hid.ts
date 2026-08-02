/**
 * Test fakes for the structural WebHID surface (webhid-types.ts).
 *
 * FakeHidDevice records sent reports and lets tests inject inbound
 * report-6 packets; FakeWebHidApi drives connect/disconnect events.
 */

import { encodeFrames, REPORT_ID } from '../frame';
import type {
  HidCollectionInfoLike,
  HidConnectionEventLike,
  HidDeviceLike,
  HidInputReportEventLike,
  WebHidApiLike,
} from '../webhid-types';

export const VENDOR_COLLECTION: HidCollectionInfoLike = { usagePage: 0xff00, usage: 0x0001 };

export class FakeHidDevice implements HidDeviceLike {
  opened = false;
  readonly sentReports: { reportId: number; data: Uint8Array }[] = [];
  openError: Error | null = null;
  private readonly listeners = new Set<(event: HidInputReportEventLike) => void>();

  constructor(
    public readonly vendorId: number,
    public readonly productId: number,
    public readonly productName = 'Fake Device',
    public readonly collections: readonly HidCollectionInfoLike[] = [VENDOR_COLLECTION],
  ) {}

  open(): Promise<void> {
    if (this.openError) return Promise.reject(this.openError);
    this.opened = true;
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.opened = false;
    return Promise.resolve();
  }

  sendReport(reportId: number, data: Uint8Array): Promise<void> {
    this.sentReports.push({ reportId, data: data.slice() });
    return Promise.resolve();
  }

  addEventListener(_type: 'inputreport', listener: (event: HidInputReportEventLike) => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(
    _type: 'inputreport',
    listener: (event: HidInputReportEventLike) => void,
  ): void {
    this.listeners.delete(listener);
  }

  /** Inject one raw report body as an inputreport event. */
  emitReport(body: Uint8Array, reportId = REPORT_ID): void {
    const event: HidInputReportEventLike = {
      reportId,
      data: new DataView(body.buffer, body.byteOffset, body.byteLength),
    };
    for (const listener of this.listeners) listener(event);
  }

  /** Encode `data` on `channel` and inject every resulting packet. */
  emitMessage(channel: number, data: Uint8Array): void {
    for (const frame of encodeFrames(channel, data)) this.emitReport(frame);
  }

  /** Encode a JSON value on channel 2 and inject it. */
  emitRpc(message: unknown): void {
    this.emitMessage(2, new TextEncoder().encode(JSON.stringify(message)));
  }
}

export class FakeWebHidApi implements WebHidApiLike {
  devices: HidDeviceLike[] = [];
  requestDeviceResult: HidDeviceLike[] = [];
  requestDeviceCalls = 0;
  private readonly connectListeners = new Set<(event: HidConnectionEventLike) => void>();
  private readonly disconnectListeners = new Set<(event: HidConnectionEventLike) => void>();

  getDevices(): Promise<HidDeviceLike[]> {
    return Promise.resolve([...this.devices]);
  }

  requestDevice(): Promise<HidDeviceLike[]> {
    this.requestDeviceCalls += 1;
    return Promise.resolve([...this.requestDeviceResult]);
  }

  addEventListener(
    type: 'connect' | 'disconnect',
    listener: (event: HidConnectionEventLike) => void,
  ): void {
    (type === 'connect' ? this.connectListeners : this.disconnectListeners).add(listener);
  }

  removeEventListener(
    type: 'connect' | 'disconnect',
    listener: (event: HidConnectionEventLike) => void,
  ): void {
    (type === 'connect' ? this.connectListeners : this.disconnectListeners).delete(listener);
  }

  emitConnect(device: HidDeviceLike): void {
    for (const listener of this.connectListeners) listener({ device });
  }

  emitDisconnect(device: HidDeviceLike): void {
    for (const listener of this.disconnectListeners) listener({ device });
  }
}

/** Let queued microtasks (promise chains) settle. */
export async function flushMicrotasks(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}
