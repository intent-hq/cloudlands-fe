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

/** First retry delay after a send failure (before jitter). */
export const BACKOFF_BASE_MS = 1000;

/** Ceiling for the exponential backoff delay (before jitter). */
export const BACKOFF_CAP_MS = 60_000;

export interface LedRpcCaller {
  call(method: string, params: unknown): Promise<unknown>;
}

export interface HardwareLedEngineOptions {
  minSendIntervalMs?: number;
  now?: () => number;
  setTimer?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
  /** Uniform [0, 1) source for backoff jitter (injectable for tests). */
  random?: () => number;
}

export class HardwareLedEngine {
  private caller: LedRpcCaller | null = null;
  private snapshot: HardwareLedSnapshot | null = null;
  private sentThStatusJson: string | null = null;
  private sentRgbcfgJson: string | null = null;
  private lastSendAt = -Infinity;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  /** Consecutive failed flushes (a flush with ≥1 failed RPC counts once). */
  private consecutiveFailures = 0;
  /** No flush runs before this timestamp while a backoff streak is active. */
  private backoffUntil = -Infinity;
  private warnedThisStreak = false;
  private flushSeq = 0;
  private lastFailedFlushSeq = -1;
  private readonly minSendIntervalMs: number;
  private readonly now: () => number;
  private readonly setTimer: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  private readonly clearTimer: (timer: ReturnType<typeof setTimeout>) => void;
  private readonly random: () => number;

  constructor(options: HardwareLedEngineOptions = {}) {
    this.minSendIntervalMs = options.minSendIntervalMs ?? DEFAULT_MIN_SEND_INTERVAL_MS;
    this.now = options.now ?? (() => Date.now());
    this.setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
    this.clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer));
    this.random = options.random ?? (() => Math.random());
  }

  /**
   * Attach a connected device's RPC caller and replay the current snapshot
   * as a full repaint (reconnects reset the volatile firmware lighting).
   */
  attach(caller: LedRpcCaller): void {
    this.caller = caller;
    this.sentThStatusJson = null;
    this.sentRgbcfgJson = null;
    // A fresh transport deserves a fresh start: drop any backoff streak.
    this.resetBackoff();
    this.cancelPendingTimer();
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

  private resetBackoff(): void {
    this.consecutiveFailures = 0;
    this.backoffUntil = -Infinity;
    this.warnedThisStreak = false;
    this.lastFailedFlushSeq = -1;
  }

  private scheduleFlush(): void {
    if (this.pendingTimer !== null) return;
    const now = this.now();
    const throttleDelay = Math.max(0, this.minSendIntervalMs - (now - this.lastSendAt));
    const backoffDelay = Math.max(0, this.backoffUntil - now);
    const delay = Math.max(throttleDelay, backoffDelay);
    if (delay <= 0) {
      this.flushNow();
      return;
    }
    this.pendingTimer = this.setTimer(() => {
      this.pendingTimer = null;
      this.flushNow();
    }, delay);
  }

  /**
   * Register one failed flush: exponential backoff with full jitter,
   * `min(BACKOFF_BASE_MS * 2^(failures - 1), BACKOFF_CAP_MS)` jittered into
   * [delay/2, delay]. Only the first failed RPC of a flush advances the
   * streak; only the first failure of a streak logs at warn.
   */
  private handleSendFailure(seq: number, method: string, error: unknown): void {
    if (this.lastFailedFlushSeq !== seq) {
      this.lastFailedFlushSeq = seq;
      this.consecutiveFailures += 1;
      const exponential = Math.min(
        BACKOFF_BASE_MS * 2 ** (this.consecutiveFailures - 1),
        BACKOFF_CAP_MS,
      );
      const jittered = exponential / 2 + this.random() * (exponential / 2);
      this.backoffUntil = this.now() + jittered;
    }
    if (!this.warnedThisStreak) {
      this.warnedThisStreak = true;
      logger.warn(`${method} send failed; backing off`, {
        error: String(error),
        failures: this.consecutiveFailures,
      });
    } else {
      logger.debug(`${method} send failed (streak continues)`, {
        error: String(error),
        failures: this.consecutiveFailures,
      });
    }
    // Retry the latest snapshot once the backoff window expires.
    if (this.caller && this.snapshot) this.scheduleFlush();
  }

  private handleSendSuccess(): void {
    if (this.consecutiveFailures === 0) return;
    logger.info('LED send recovered', { afterFailures: this.consecutiveFailures });
    this.resetBackoff();
    // Resume normal cadence: replace a pending backoff-length timer.
    if (this.pendingTimer !== null) {
      this.cancelPendingTimer();
      if (this.caller && this.snapshot) this.scheduleFlush();
    }
  }

  private flushNow(): void {
    const caller = this.caller;
    const snapshot = this.snapshot;
    if (!caller || !snapshot) return;
    const now = this.now();
    if (now < this.backoffUntil) {
      // A stale coalesce timer fired inside the backoff window; re-arm.
      this.scheduleFlush();
      return;
    }
    this.lastSendAt = now;
    const seq = ++this.flushSeq;

    const thStatusParams = buildThStatusParams(snapshot.keys);
    const thStatusJson = JSON.stringify(thStatusParams);
    if (thStatusJson !== this.sentThStatusJson) {
      this.sentThStatusJson = thStatusJson;
      caller.call('v.oai.thstatus', thStatusParams).then(
        () => this.handleSendSuccess(),
        (error: unknown) => {
          // Resend after backoff — otherwise the LEDs stay stale.
          if (this.sentThStatusJson === thStatusJson) this.sentThStatusJson = null;
          this.handleSendFailure(seq, 'v.oai.thstatus', error);
        },
      );
    }

    const rgbcfgParams = buildRgbcfgParams(snapshot.ambient);
    const rgbcfgJson = JSON.stringify(rgbcfgParams);
    if (rgbcfgJson !== this.sentRgbcfgJson) {
      this.sentRgbcfgJson = rgbcfgJson;
      caller.call('v.oai.rgbcfg', rgbcfgParams).then(
        () => this.handleSendSuccess(),
        (error: unknown) => {
          if (this.sentRgbcfgJson === rgbcfgJson) this.sentRgbcfgJson = null;
          this.handleSendFailure(seq, 'v.oai.rgbcfg', error);
        },
      );
    }
  }
}
