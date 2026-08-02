/**
 * Stateful hardware input decoder: consumes parsed vendor channel-2 JSON
 * messages (via `handleMessage` or a {@link VendorNotificationSource}) and
 * emits typed input events. Pure web code — no Electron imports.
 *
 * Session behavior on top of the pure decode:
 * - Double-press detection per logical key (350 ms window by default).
 * - Joystick dead-zone with hysteresis, host-side sector math, and a debounce
 *   on sector changes (the ~45 Hz stream jitters near sector boundaries).
 *
 * The Codex Micro's factory 2U Mic keycap presses the ACT10 + ACT11 switches
 * together, but the firmware reports them as two distinct ids and the decoder
 * keeps them separate — each slot fires its own mapped action (ACT11 defaults
 * to unset, so the linked pair triggers a single action out of the box).
 */

import { decodeVendorMessage } from './decode';
import { angleToSector, clampDistance, normalizeAngle } from './sector';
import type {
  DecodedVendorMessage,
  HardwareInputEventMap,
  HardwareInputEventType,
  HardwareInputListener,
  HardwareInputOptions,
  LogicalKeyId,
  VendorControlId,
  VendorNotificationSource,
} from './types';

export const DEFAULT_DOUBLE_PRESS_WINDOW_MS = 350;
export const DEFAULT_JOYSTICK_ENGAGE_DISTANCE = 0.35;
export const DEFAULT_JOYSTICK_RELEASE_DISTANCE = 0.2;
export const DEFAULT_SECTOR_COUNT = 8;
export const DEFAULT_SECTOR_DEBOUNCE_MS = 50;

export class HardwareInputDecoder {
  private readonly listeners = new Map<HardwareInputEventType, Set<(payload: never) => void>>();
  private readonly now: () => number;
  private readonly doublePressWindowMs: number;
  private readonly engageDistance: number;
  private readonly releaseDistance: number;
  private readonly sectorOffset: number;
  private readonly sectorDebounceMs: number;
  private sectorCount: number;

  private readonly lastPressAt = new Map<LogicalKeyId, number>();

  private joystickEngaged = false;
  private activeSector = 0;
  private pendingSector: { sector: number; since: number } | null = null;

  constructor(options: HardwareInputOptions = {}) {
    this.now = options.now ?? Date.now;
    this.doublePressWindowMs = options.doublePressWindowMs ?? DEFAULT_DOUBLE_PRESS_WINDOW_MS;
    this.engageDistance = options.joystick?.engageDistance ?? DEFAULT_JOYSTICK_ENGAGE_DISTANCE;
    this.releaseDistance = options.joystick?.releaseDistance ?? DEFAULT_JOYSTICK_RELEASE_DISTANCE;
    this.sectorCount = options.joystick?.sectorCount ?? DEFAULT_SECTOR_COUNT;
    this.sectorOffset = options.joystick?.sectorOffset ?? 0;
    this.sectorDebounceMs = options.joystick?.sectorDebounceMs ?? DEFAULT_SECTOR_DEBOUNCE_MS;
  }

  on<T extends HardwareInputEventType>(type: T, listener: HardwareInputListener<T>): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener as (payload: never) => void);
    return () => this.off(type, listener);
  }

  off<T extends HardwareInputEventType>(type: T, listener: HardwareInputListener<T>): void {
    this.listeners.get(type)?.delete(listener as (payload: never) => void);
  }

  /** Subscribe to a transport's notification stream. Returns unsubscribe. */
  attach(source: VendorNotificationSource): () => void {
    return source.onNotification((message) => this.handleMessage(message));
  }

  /** Feed one parsed channel-2 JSON value. Unrecognized values are ignored. */
  handleMessage(message: unknown): void {
    const decoded = decodeVendorMessage(message);
    if (!decoded) return;
    this.handleDecoded(decoded);
  }

  /** Number of radial sectors used for joystick sector math. */
  setSectorCount(sectorCount: number): void {
    if (!Number.isInteger(sectorCount) || sectorCount < 1) {
      throw new RangeError(`sectorCount must be a positive integer, got ${sectorCount}`);
    }
    this.sectorCount = sectorCount;
  }

  private emit<T extends HardwareInputEventType>(type: T, payload: HardwareInputEventMap[T]): void {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const listener of [...set]) {
      (listener as HardwareInputListener<T>)(payload);
    }
  }

  private handleDecoded(decoded: DecodedVendorMessage): void {
    switch (decoded.kind) {
      case 'encoder-rotate':
        this.emit('encoderrotate', { direction: decoded.direction });
        return;
      case 'key':
        this.handleKey(decoded.control, decoded.action);
        return;
      case 'joystick':
        this.handleJoystickSample(decoded.angle, decoded.distance);
        return;
    }
  }

  private handleKey(control: VendorControlId, action: 'press' | 'release'): void {
    if (control === 'ENC_CC' || control === 'ENC_CW') return;
    this.emitKey(control, action);
  }

  private emitKey(key: LogicalKeyId, action: 'press' | 'release'): void {
    if (action === 'release') {
      this.emit('keyup', { key });
      return;
    }
    const now = this.now();
    const last = this.lastPressAt.get(key);
    this.emit('keydown', { key });
    if (last !== undefined && now - last <= this.doublePressWindowMs) {
      this.lastPressAt.delete(key);
      this.emit('doublepress', { key });
    } else {
      this.lastPressAt.set(key, now);
    }
  }

  private handleJoystickSample(rawAngle: number, rawDistance: number): void {
    const angle = normalizeAngle(rawAngle);
    const distance = clampDistance(rawDistance);
    if (!this.joystickEngaged) {
      if (distance < this.engageDistance) return;
      this.joystickEngaged = true;
      this.activeSector = angleToSector(angle, this.sectorCount, this.sectorOffset);
      this.pendingSector = null;
      const payload = { angle, distance, sector: this.activeSector };
      this.emit('joystickengage', payload);
      this.emit('joystickmove', payload);
      return;
    }
    if (distance <= this.releaseDistance) {
      const sector = this.activeSector;
      this.joystickEngaged = false;
      this.pendingSector = null;
      this.emit('joystickrelease', { sector });
      return;
    }
    const candidate = angleToSector(angle, this.sectorCount, this.sectorOffset);
    if (candidate === this.activeSector) {
      this.pendingSector = null;
    } else {
      const now = this.now();
      if (this.pendingSector?.sector !== candidate) {
        this.pendingSector = { sector: candidate, since: now };
      }
      if (now - this.pendingSector.since >= this.sectorDebounceMs) {
        this.activeSector = candidate;
        this.pendingSector = null;
        this.emit('joysticksector', { angle, distance, sector: candidate });
      }
    }
    this.emit('joystickmove', { angle, distance, sector: this.activeSector });
  }
}
