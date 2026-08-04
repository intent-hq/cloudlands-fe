/**
 * Connect/disconnect lifecycle for the hardware console.
 *
 * Wires platform (WebHID) → transport (framing/demux) → RPC client, opens an
 * already-granted device on start, and auto-reconnects on replug via the
 * WebHID `connect`/`disconnect` events (permission persists across replug on
 * both USB and Bluetooth, so `connect` fires without a new chooser).
 */

import { Logger } from '../../../shared/logger';
import { createWebHidPlatform, selectVendorDevice, type HidPlatform } from './platform';
import { HardwareRpcClient, type RpcNotification } from './rpc-client';
import {
  findSupportedHardwareConsoleDevice,
  hasVendorCollection,
  isSupportedHardwareConsoleDevice,
  type SupportedHardwareConsoleDevice,
} from './supported-devices';
import { VendorChannelTransport } from './transport';
import type { HidCollectionInfoLike, HidDeviceLike } from './webhid-types';

const logger = new Logger('HardwareConsoleManager');

export type HardwareConsoleStatus = 'unavailable' | 'disconnected' | 'connecting' | 'connected';

export interface HardwareConsoleManagerOptions {
  requestTimeoutMs?: number;
  /**
   * Value returned to the device's `host.focused_app` AppSense polls. The
   * exact result shape is undocumented; replying (rather than ignoring the
   * request) keeps the device from waiting on a dead id.
   */
  focusedAppProvider?: () => unknown;
}

export class HardwareConsoleManager {
  private currentStatus: HardwareConsoleStatus;
  private device: HidDeviceLike | null = null;
  private transport: VendorChannelTransport | null = null;
  private rpcClient: HardwareRpcClient | null = null;
  private platformUnsubs: (() => void)[] = [];
  private connectionUnsubs: (() => void)[] = [];
  private readonly statusListeners = new Set<(status: HardwareConsoleStatus) => void>();
  private readonly notificationListeners = new Set<(notification: RpcNotification) => void>();
  private readonly rawMessageListeners = new Set<(message: unknown) => void>();
  private readonly logListeners = new Set<(text: string) => void>();
  private started = false;
  private opening = false;

  constructor(
    private readonly platform: HidPlatform | null = createWebHidPlatform(),
    private readonly options: HardwareConsoleManagerOptions = {},
  ) {
    this.currentStatus = this.platform ? 'disconnected' : 'unavailable';
  }

  get status(): HardwareConsoleStatus {
    return this.currentStatus;
  }

  /** The live RPC client, or `null` while disconnected. */
  get client(): HardwareRpcClient | null {
    return this.rpcClient;
  }

  /** Supported-device metadata for the connected device, or `null`. */
  get connectedDevice(): SupportedHardwareConsoleDevice | null {
    if (!this.device) return null;
    return findSupportedHardwareConsoleDevice(this.device.vendorId, this.device.productId) ?? null;
  }

  /**
   * Flattened top-level collections of all granted HID devices matching the
   * connected device's VID/PID. macOS may enumerate one granted device per
   * usage pair or coalesce all pairs onto a single device, so callers must
   * inspect collections, not device count (intent-hq/monorepo#1422). Feeds
   * the transport heuristic in transport-heuristic.ts; empty while
   * disconnected.
   */
  async connectedCollections(): Promise<HidCollectionInfoLike[]> {
    if (!this.platform || !this.device) return [];
    const { vendorId, productId } = this.device;
    const devices = await this.platform.getDevices();
    return devices
      .filter((d) => d.vendorId === vendorId && d.productId === productId)
      .flatMap((d) => [...d.collections]);
  }

  onStatusChange(listener: (status: HardwareConsoleStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  /** Device notifications; survives reconnects. */
  onNotification(listener: (notification: RpcNotification) => void): () => void {
    this.notificationListeners.add(listener);
    return () => this.notificationListeners.delete(listener);
  }

  /**
   * Every reassembled channel-2 JSON value, before RPC dispatch — includes
   * bare objects with neither `id` nor `method` (e.g. the CM2 vendor-mode
   * joystick stream `{"a":0.76,"d":1}`), which the RPC layer ignores.
   * Survives reconnects.
   */
  onRawMessage(listener: (message: unknown) => void): () => void {
    this.rawMessageListeners.add(listener);
    return () => this.rawMessageListeners.delete(listener);
  }

  /** Firmware log lines (channel 1); survives reconnects. */
  onLog(listener: (text: string) => void): () => void {
    this.logListeners.add(listener);
    return () => this.logListeners.delete(listener);
  }

  /**
   * Subscribe to hotplug events and open an already-granted device if one is
   * present. No-op when WebHID is unavailable.
   */
  async start(): Promise<void> {
    if (!this.platform || this.started) return;
    this.started = true;
    this.platformUnsubs.push(
      this.platform.onConnect((device) => void this.handleDeviceArrival(device)),
      this.platform.onDisconnect((device) => this.handleDeviceRemoval(device)),
    );
    const granted = await this.platform.getDevices();
    const candidate = selectVendorDevice(granted);
    if (candidate) await this.openDevice(candidate);
  }

  /**
   * Explicitly request device access: silent in Electron, chooser (user
   * gesture required) on web. Resolves `true` when connected.
   */
  async requestConnect(): Promise<boolean> {
    if (!this.platform) return false;
    if (this.currentStatus === 'connected') return true;
    const device = await this.platform.requestDevice();
    if (!device) return false;
    await this.openDevice(device);
    return this.status === 'connected';
  }

  /** Tear down the connection and stop listening for hotplug events. */
  async stop(): Promise<void> {
    for (const unsub of this.platformUnsubs) unsub();
    this.platformUnsubs = [];
    this.started = false;
    await this.teardown('manager stopped');
  }

  private async handleDeviceArrival(device: HidDeviceLike): Promise<void> {
    if (this.device) return;
    if (!isSupportedHardwareConsoleDevice(device.vendorId, device.productId)) return;
    if (!hasVendorCollection(device.collections)) return;
    logger.info('Supported device connected; reconnecting', {
      vendorId: device.vendorId,
      productId: device.productId,
    });
    await this.openDevice(device);
  }

  private handleDeviceRemoval(device: HidDeviceLike): void {
    if (device !== this.device) return;
    logger.info('Connected device removed');
    void this.teardown('device disconnected')
      .then(() => this.reopenRemainingDevice(device))
      .catch((error: unknown) => {
        logger.warn('Removal rescan failed', { error: String(error) });
      });
  }

  /**
   * After the connected device drops, another already-granted surface of the
   * same hardware may still be present (e.g. BLE→USB hand-off: the USB
   * surface was granted while BLE was connected, so its arrival never fires
   * a WebHID `connect` event). Rescan and open it instead of sitting
   * disconnected until the integration is toggled. Removal-only — never runs
   * on `stop()` (`started` is false by then and the hotplug listeners are
   * unsubscribed).
   */
  private async reopenRemainingDevice(removed: HidDeviceLike): Promise<void> {
    if (!this.platform || !this.started || this.device || this.opening) return;
    const granted = await this.platform.getDevices();
    const candidate = selectVendorDevice(granted.filter((d) => d !== removed));
    if (!candidate) return;
    logger.info('Reconnecting to remaining granted device after removal', {
      vendorId: candidate.vendorId,
      productId: candidate.productId,
    });
    await this.openDevice(candidate);
  }

  private async openDevice(device: HidDeviceLike): Promise<void> {
    // `opening` closes the async gap between this guard and `this.device`
    // being assigned below: without it, a hotplug arrival racing an in-flight
    // open would attach a SECOND transport whose subscription is never torn
    // down (duplicate clients → "unknown or stale id" warnings).
    if (this.device || this.opening) return;
    this.opening = true;
    try {
      this.setStatus('connecting');
      try {
        if (!device.opened) await device.open();
      } catch (error) {
        logger.warn('Failed to open device', { error: String(error) });
        this.setStatus('disconnected');
        return;
      }
      const transport = new VendorChannelTransport(device);
      const client = new HardwareRpcClient(
        { sendMessage: (message) => transport.sendRpcMessage(message) },
        { requestTimeoutMs: this.options.requestTimeoutMs },
      );
      const focusedAppProvider = this.options.focusedAppProvider ?? (() => ({ name: 'Intent' }));
      client.setRequestHandler('host.focused_app', () => focusedAppProvider());
      this.connectionUnsubs = [
        transport.onRpcMessage((message) => {
          for (const listener of this.rawMessageListeners) listener(message);
          client.handleMessage(message);
        }),
        client.onNotification((notification) => {
          for (const listener of this.notificationListeners) listener(notification);
        }),
        transport.onLog((text) => {
          for (const listener of this.logListeners) listener(text);
        }),
      ];
      transport.attach();
      this.device = device;
      this.transport = transport;
      this.rpcClient = client;
      this.setStatus('connected');
    } finally {
      this.opening = false;
    }
  }

  private async teardown(reason: string): Promise<void> {
    const { device, transport, rpcClient } = this;
    this.device = null;
    this.transport = null;
    this.rpcClient = null;
    for (const unsub of this.connectionUnsubs) unsub();
    this.connectionUnsubs = [];
    transport?.detach();
    rpcClient?.dispose(reason);
    if (device?.opened) {
      try {
        await device.close();
      } catch {
        // Already gone (e.g. unplugged) — nothing to release.
      }
    }
    this.setStatus(this.platform ? 'disconnected' : 'unavailable');
  }

  private setStatus(status: HardwareConsoleStatus): void {
    if (status === this.currentStatus) return;
    this.currentStatus = status;
    for (const listener of this.statusListeners) listener(status);
  }
}
