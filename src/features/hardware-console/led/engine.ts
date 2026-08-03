/**
 * Host-side LED frame engine: keeps the last-known lighting snapshot,
 * coalesces updates to ≤ ~10 fps, sends only the RPCs whose params changed,
 * and replays the full frame on (re)attach so lighting restores after a
 * device reconnect (all lighting methods are volatile on the firmware).
 *
 * Pure web code — no Electron imports, no store imports. The transport seam
 * is a minimal `call(method, params)` function (satisfied by
 * `HardwareRpcClient`).
 */

import { Logger } from '../../../shared/logger';
import {
  buildRgbcfgParams,
  buildThStatusParams,
  type HardwareLedSnapshot,
} from './frames';

const logger = new Logger('HardwareLedEngine');

/** Minimum interval between frame sends (≤ ~10 fps). */
export const DEFAULT_MIN_SEND_INTERVAL_MS = 100;

export interface LedRpcCaller {
  call(method: string, params: unknown): Promise<unknown>;
}

export interface HardwareLedEngineOptions {
  minSendIntervalMs?: number;
  now?: () => number;
  setTimer?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}

export class HardwareLedEngine {
  private caller: LedRpcCaller | null = null;
  private snapshot: HardwareLedSnapshot | null = null;
  private sentThStatusJson: string | null = null;
  private sentRgbcfgJson: string | null = null;
  private lastSendAt = -Infinity;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly minSendIntervalMs: number;
  private readonly now: () => number;
  private readonly setTimer: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  private readonly clearTimer: (timer: ReturnType<typeof setTimeout>) => void;

  constructor(options: HardwareLedEngineOptions = {}) {
    this.minSendIntervalMs = options.minSendIntervalMs ?? DEFAULT_MIN_SEND_INTERVAL_MS;
    this.now = options.now ?? (() => Date.now());
    this.setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
    this.clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer));
  }

  /**
   * Attach a connected device's RPC caller and replay the current snapshot
   * as a full repaint (reconnects reset the volatile firmware lighting).
   */
  attach(caller: LedRpcCaller): void {
    this.caller = caller;
    this.sentThStatusJson = null;
    this.sentRgbcfgJson = null;
    if (this.snapshot) this.scheduleFlush();
  }

  /** Detach on disconnect; the snapshot is kept for the next attach. */
  detach(): void {
    this.caller = null;
    this.cancelPendingTimer();
  }

  /** Feed the latest desired lighting snapshot (idempotent per content). */
  update(snapshot: HardwareLedSnapshot): void {
    this.snapshot = snapshot;
    if (this.caller) this.scheduleFlush();
  }

  /** Stop timers and drop the transport (end of engine lifetime). */
  dispose(): void {
    this.detach();
    this.snapshot = null;
  }

  private cancelPendingTimer(): void {
    if (this.pendingTimer !== null) {
      this.clearTimer(this.pendingTimer);
      this.pendingTimer = null;
    }
  }

  private scheduleFlush(): void {
    if (this.pendingTimer !== null) return;
    const elapsed = this.now() - this.lastSendAt;
    const delay = Math.max(0, this.minSendIntervalMs - elapsed);
    if (delay <= 0) {
      this.flushNow();
      return;
    }
    this.pendingTimer = this.setTimer(() => {
      this.pendingTimer = null;
      this.flushNow();
    }, delay);
  }

  private flushNow(): void {
    const caller = this.caller;
    const snapshot = this.snapshot;
    if (!caller || !snapshot) return;
    this.lastSendAt = this.now();

    const thStatusParams = buildThStatusParams(snapshot.keys);
    const thStatusJson = JSON.stringify(thStatusParams);
    if (thStatusJson !== this.sentThStatusJson) {
      this.sentThStatusJson = thStatusJson;
      caller.call('v.oai.thstatus', thStatusParams).catch((error: unknown) => {
        // Resend on the next update — otherwise the LEDs stay stale.
        if (this.sentThStatusJson === thStatusJson) this.sentThStatusJson = null;
        logger.warn('v.oai.thstatus frame send failed', { error: String(error) });
      });
    }

    const rgbcfgParams = buildRgbcfgParams(snapshot.ambient);
    const rgbcfgJson = JSON.stringify(rgbcfgParams);
    if (rgbcfgJson !== this.sentRgbcfgJson) {
      this.sentRgbcfgJson = rgbcfgJson;
      caller.call('v.oai.rgbcfg', rgbcfgParams).catch((error: unknown) => {
        if (this.sentRgbcfgJson === rgbcfgJson) this.sentRgbcfgJson = null;
        logger.warn('v.oai.rgbcfg send failed', { error: String(error) });
      });
    }
  }
}
