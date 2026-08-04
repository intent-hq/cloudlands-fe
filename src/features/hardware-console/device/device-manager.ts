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
  private openInFlight: Promise<unknown> | null = null;
  /**
   * Lifecycle generation token, incremented by every start()/stop(). Async
   * lifecycle paths capture it before awaiting and bail when it has moved
   * on, so a stop() (or rapid stop→start toggle) racing an in-flight await
   * can never let a stale continuation attach a connection or tear down a
   * newer generation's connection (intent-hq/monorepo#1434). Deliberately
   * not a `started` check: requestConnect() must keep working on a
   * never-started manager.
   */
  private generation = 0;

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
    const generation = ++this.generation;
    this.started = true;
    this.platformUnsubs.push(
      this.platform.onConnect((device) => void this.handleDeviceArrival(device)),
      this.platform.onDisconnect((device) => this.handleDeviceRemoval(device)),
    );
    const granted = await this.platform.getDevices();
    // A stop() during the await already unsubscribed our hotplug listeners;
    // opening now would attach a connection on a stopped manager.
    if (generation !== this.generation) return;
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
    const generation = ++this.generation;
    for (const unsub of this.platformUnsubs) unsub();
    this.platformUnsubs = [];
    this.started = false;
    // An in-flight openDevice() assigns the connection fields only after its
    // awaits settle; tearing down before it completes would read null fields
    // and leak the freshly opened connection. Wait for it to finish first.
    if (this.openInFlight) await this.openInFlight.catch(() => undefined);
    // A start() during the await owns any connection attached since; tearing
    // it down here would leave started === true with a closed device.
    if (generation !== this.generation) return;
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
    const generation = this.generation;
    const granted = await this.platform.getDevices();
    // A stop() during the await already tore the manager down; opening now
    // would capture the post-stop generation, so performOpen's guard would
    // pass and attach a connection on a stopped manager
    // (intent-hq/monorepo#1437). Mirrors start()'s guard.
    if (generation !== this.generation) return;
    const candidate = selectVendorDevice(granted.filter((d) => d !== removed));
    if (!candidate) return;
    logger.info('Reconnecting to remaining granted device after removal', {
      vendorId: candidate.vendorId,
      productId: candidate.productId,
    });
    await this.openDevice(candidate);
  }

  /**
   * start()-style rescan for the live generation, used when a superseded
   * open releases its device while the current generation is started but
   * deviceless (rapid OFF→ON toggle: the restart's own scan bailed on
   * `opening`). A real, still-plugged device fires no WebHID `connect`
   * event, so without this the manager would sit disconnected until a
   * replug (intent-hq/monorepo#1438).
   */
  private async rescanForLiveGeneration(): Promise<void> {
    if (!this.platform) return;
    const generation = this.generation;
    const granted = await this.platform.getDevices();
    // Mirrors start()'s guard: a stop() during the await must not let this
    // open attach on a stopped manager.
    if (generation !== this.generation) return;
    const candidate = selectVendorDevice(granted);
    if (candidate) await this.openDevice(candidate);
  }

  private async openDevice(device: HidDeviceLike): Promise<void> {
    // `opening` closes the async gap between this guard and `this.device`
    // being assigned below: without it, a hotplug arrival racing an in-flight
    // open would attach a SECOND transport whose subscription is never torn
    // down (duplicate clients → "unknown or stale id" warnings).
    if (this.device || this.opening) return;
    this.opening = true;
    // Also expose the in-flight open so stop() can await it before teardown
    // (otherwise a stop() racing this open would leak the new connection).
    const open = this.performOpen(device);
    this.openInFlight = open;
    let superseded = false;
    try {
      superseded = await open;
    } finally {
      this.opening = false;
      if (this.openInFlight === open) this.openInFlight = null;
    }
    // A superseded open released its device without attaching; if the live
    // generation is started but deviceless, rescan for it now that
    // `opening` has cleared (intent-hq/monorepo#1438). Fire-and-forget so
    // callers awaiting this open are not held on the rescan's own open.
    if (superseded && this.started && !this.device) {
      void this.rescanForLiveGeneration().catch((error: unknown) => {
        logger.warn('Rescan after superseded open failed', { error: String(error) });
      });
    }
  }

  /** Resolves `true` when superseded by a generation change (no attach). */
  private async performOpen(device: HidDeviceLike): Promise<boolean> {
    const generation = this.generation;
    this.setStatus('connecting');
    try {
      if (!device.opened) await device.open();
    } catch (error) {
      logger.warn('Failed to open device', { error: String(error) });
      this.setStatus('disconnected');
      return false;
    }
    if (generation !== this.generation) {
      // A stop() (or stop→start toggle) superseded this open while
      // device.open() was in flight: release the device instead of attaching
      // to the stale lifecycle, and never emit the 'connected' blip status
      // listeners would otherwise see.
      if (device.opened) {
        try {
          await device.close();
        } catch {
          // Already gone (e.g. unplugged) — nothing to release.
        }
      }
      this.setStatus('disconnected');
      return true;
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
    return false;
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
