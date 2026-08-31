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

/**
 * Backoff schedule for auto-retrying a failed open. With the device still
 * present, no WebHID `connect` event will ever re-trigger an open, so
 * without retries a transient failure (boot race, device briefly claimed
 * elsewhere) strands the manager disconnected until a replug or toggle.
 */
const OPEN_RETRY_DELAYS_MS = [1000, 2000, 5000];

export type HardwareConsoleStatus = 'unavailable' | 'disconnected' | 'connecting' | 'connected';

/** Why the last `device.open()` failed; `name` preserves e.g. `NotAllowedError`. */
export interface HardwareConsoleConnectError {
  name: string;
  message: string;
}

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
  private connectError: HardwareConsoleConnectError | null = null;
  /** The device whose open() produced `connectError` (for removal clearing). */
  private failedDevice: HidDeviceLike | null = null;
  /** The device an in-flight performOpen is opening (for removal detection). */
  private openTarget: HidDeviceLike | null = null;
  /** Set when `openTarget` is unplugged while its open() is still in flight. */
  private openTargetRemoved = false;
  /** Pending auto-retry of a failed open (see scheduleOpenRetry), or `null`. */
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** Next index into OPEN_RETRY_DELAYS_MS; reset when the retry cycle ends. */
  private retryAttempt = 0;
  private openInFlight: Promise<boolean> | null = null;
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

  /**
   * Why the last `device.open()` failed, or `null`. Set when an open attempt
   * rejects (device present but unopenable — e.g. macOS Input Monitoring
   * denial); cleared on successful connect, `stop()`, and removal of the
   * failing device, notifying status listeners when the cleared error would
   * otherwise leave stale UI (status alone does not change).
   */
  get lastConnectError(): HardwareConsoleConnectError | null {
    return this.connectError;
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
    // An explicit user gesture starts a fresh auto-retry cycle: without the
    // reset, a Retry after the backoff schedule is exhausted would arm no
    // further retries, and a mid-cycle Retry would consume the shared
    // backoff budget.
    this.retryAttempt = 0;
    const device = await this.platform.requestDevice();
    if (!device) return false;
    await this.openDevice(device);
    return this.status === 'connected';
  }

  /** Tear down the connection and stop listening for hotplug events. */
  async stop(): Promise<void> {
    const generation = ++this.generation;
    // A pending open retry belongs to the generation being stopped; cancel
    // it even when a racing start() wins the trailing-teardown guard below
    // (clearConnectError would then be skipped).
    this.cancelOpenRetry();
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
    // Status is often already 'disconnected' after a failed open, so the
    // teardown transition alone would not refresh listeners — notify.
    this.clearConnectError(true);
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
    // The device being opened right now was unplugged: flag it so the
    // open's rejection is not surfaced as a failure of a present device
    // (`failedDevice` is still null in that window).
    if (device === this.openTarget) this.openTargetRemoved = true;
    if (device !== this.device) {
      // The device whose open() failed was unplugged: the failure no longer
      // describes a present device, so drop it and refresh listeners (there
      // is no status transition to do it — status is already disconnected).
      if (device === this.failedDevice) this.clearConnectError(true);
      return;
    }
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
    // Defensive: the single call site already checks these synchronously
    // with the generation capture below; keep the guard so a future call
    // site cannot silently break that invariant.
    if (!this.platform || !this.started || this.device || this.opening) return;
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
    this.openTarget = device;
    this.openTargetRemoved = false;
    try {
      if (!device.opened) await device.open();
    } catch (error) {
      logger.warn('Failed to open device', { error: String(error) });
      if (generation !== this.generation) {
        // A stop() (or stop→start toggle) superseded this open while
        // device.open() was rejecting: the failure belongs to the obsolete
        // lifecycle, so recording it (or arming retries) would mutate the
        // live generation's state. Report superseded so openDevice's rescan
        // can reconnect the live generation to the still-present device.
        this.setStatus('disconnected');
        return true;
      }
      if (this.openTargetRemoved) {
        // The device was unplugged while open() was in flight: the failure
        // no longer describes a present device — surfacing it (or arming
        // retries for the unplugged device) would resurrect a stale error.
        this.setStatus('disconnected');
        return false;
      }
      this.connectError = {
        name: error instanceof Error ? error.name : 'Error',
        message: error instanceof Error ? error.message : String(error),
      };
      this.failedDevice = device;
      this.setStatus('disconnected');
      this.scheduleOpenRetry(device, generation);
      return false;
    } finally {
      this.openTarget = null;
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
    // The 'connected' transition below notifies listeners; no extra notify.
    this.clearConnectError(false);
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

  /**
   * Bounded-backoff auto-retry after a failed open, so a transient failure
   * self-heals without a replug or integration toggle. Armed only while the
   * manager is still started for the same generation; the fired callback
   * re-checks the generation token before opening, mirroring the async
   * lifecycle discipline of start()/performOpen()
   * (intent-hq/monorepo#1434/#1437/#1438). Cancelled by stop(), removal of
   * the failing device, and a successful connect (via clearConnectError).
   * Once the schedule is exhausted the manager stays disconnected with
   * `lastConnectError` still set for the UI. An explicit user Retry
   * (requestConnect) resets the backoff budget, so a failed manual attempt
   * always starts a fresh cycle rather than consuming — or being refused
   * by — the exhausted automatic schedule.
   */
  private scheduleOpenRetry(device: HidDeviceLike, generation: number): void {
    if (!this.started || generation !== this.generation) return;
    if (this.retryAttempt >= OPEN_RETRY_DELAYS_MS.length) {
      logger.warn('Open retries exhausted; staying disconnected', {
        attempts: this.retryAttempt,
      });
      return;
    }
    const delayMs = OPEN_RETRY_DELAYS_MS[this.retryAttempt];
    this.retryAttempt += 1;
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      // Cancellation should have caught lifecycle changes already; the
      // generation token stays the authority for a timer that fires while
      // a stop()/toggle races it.
      if (!this.started || generation !== this.generation) return;
      if (this.device || this.opening) return;
      logger.info('Retrying device open', { attempt: this.retryAttempt });
      void this.openDevice(device).catch((error: unknown) => {
        logger.warn('Open retry failed', { error: String(error) });
      });
    }, delayMs);
  }

  /** Cancel any pending open retry and reset the backoff schedule. */
  private cancelOpenRetry(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.retryAttempt = 0;
  }

  /**
   * Drop the recorded connect error. `notify` re-fires status listeners with
   * the current status for call sites where no status transition happens
   * (already 'disconnected'), so subscribed UI re-reads `lastConnectError`.
   * Every call site also ends the open-retry cycle: successful connect,
   * stop(), and removal of the failing device.
   */
  private clearConnectError(notify: boolean): void {
    this.cancelOpenRetry();
    const hadError = this.connectError !== null;
    this.connectError = null;
    this.failedDevice = null;
    if (notify && hadError) {
      for (const listener of this.statusListeners) listener(this.currentStatus);
    }
  }

  private setStatus(status: HardwareConsoleStatus): void {
    if (status === this.currentStatus) return;
    this.currentStatus = status;
    for (const listener of this.statusListeners) listener(status);
  }
}
