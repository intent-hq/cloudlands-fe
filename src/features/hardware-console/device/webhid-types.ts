/**
 * Minimal structural typings for the WebHID API.
 *
 * TypeScript's DOM lib does not ship WebHID declarations; these interfaces
 * describe only the surface the hardware-console transport uses, so real
 * `navigator.hid` objects satisfy them structurally and tests can provide
 * lightweight fakes. No Electron or Node types here.
 */

export interface HidCollectionInfoLike {
  usagePage: number;
  usage: number;
}

export interface HidInputReportEventLike {
  reportId: number;
  data: DataView;
}

export interface HidDeviceLike {
  readonly opened: boolean;
  readonly vendorId: number;
  readonly productId: number;
  readonly productName: string;
  readonly collections: readonly HidCollectionInfoLike[];
  open(): Promise<void>;
  close(): Promise<void>;
  sendReport(reportId: number, data: Uint8Array): Promise<void>;
  addEventListener(type: 'inputreport', listener: (event: HidInputReportEventLike) => void): void;
  removeEventListener(
    type: 'inputreport',
    listener: (event: HidInputReportEventLike) => void,
  ): void;
}

export interface HidConnectionEventLike {
  device: HidDeviceLike;
}

export interface HidDeviceFilter {
  vendorId?: number;
  productId?: number;
  usagePage?: number;
  usage?: number;
}

/** The `navigator.hid` surface used by the transport. */
export interface WebHidApiLike {
  getDevices(): Promise<HidDeviceLike[]>;
  requestDevice(options: { filters: HidDeviceFilter[] }): Promise<HidDeviceLike[]>;
  addEventListener(
    type: 'connect' | 'disconnect',
    listener: (event: HidConnectionEventLike) => void,
  ): void;
  removeEventListener(
    type: 'connect' | 'disconnect',
    listener: (event: HidConnectionEventLike) => void,
  ): void;
}
