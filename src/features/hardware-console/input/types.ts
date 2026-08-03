/**
 * Types for decoding vendor input from the Work Louder Creator Micro 2 (Codex
 * mode) and Codex Micro. Pure renderer/web code — no Electron imports.
 *
 * Protocol references: cm2-probe (live-verified CM2 fw v0.6.0) and
 * work-louder-oai PROTOCOL.md (Codex Micro fw v0.4.1).
 */

/** Which physical device the vendor channel belongs to. */
export type HardwareDeviceModel = 'creator-micro-2' | 'codex-micro';

/** The 6 agent keys (top two rows). */
export type AgentKeyId = 'AG00' | 'AG01' | 'AG02' | 'AG03' | 'AG04' | 'AG05';

/** The 7 action keys (bottom two rows). */
export type ActionKeyId = 'ACT06' | 'ACT07' | 'ACT08' | 'ACT09' | 'ACT10' | 'ACT11' | 'ACT12';

/** Raw vendor control identifiers carried in `v.oai.hid` `k` fields. */
export type VendorControlId = AgentKeyId | ActionKeyId | 'ENC_CC' | 'ENC_CW' | 'ENC_CLK';

/**
 * Logical key identifiers surfaced by the input decoder. On the Codex Micro
 * the factory 2U Mic keycap presses the ACT10 + ACT11 switches together; the
 * firmware reports them as two distinct ids and the decoder keeps them
 * separate, so each slot carries its own action (ACT11 defaults to unset).
 */
export type LogicalKeyId = AgentKeyId | ActionKeyId | 'ENC_CLK';

export type EncoderDirection = 'cw' | 'ccw';

/** Intermediate result of pure per-message decoding (no session state). */
export type DecodedVendorMessage =
  | { kind: 'key'; control: VendorControlId; action: 'press' | 'release' }
  | { kind: 'encoder-rotate'; direction: EncoderDirection }
  | { kind: 'joystick'; angle: number; distance: number };

/** Payloads for the typed events emitted by {@link HardwareInputEventMap}. */
export interface KeyEventPayload {
  key: LogicalKeyId;
}

export interface EncoderRotateEventPayload {
  direction: EncoderDirection;
}

export interface JoystickEventPayload {
  /** Normalized angular position, wrapping 0.0–1.0. */
  angle: number;
  /** Normalized deflection from center, 0.0–1.0. */
  distance: number;
  /** Active sector index (0-based), per the configured sector count. */
  sector: number;
}

export interface JoystickReleasePayload {
  /** The sector that was active when the stick was released (the selection). */
  sector: number;
}

/** Event map for the hardware input emitter. */
export interface HardwareInputEventMap {
  keydown: KeyEventPayload;
  keyup: KeyEventPayload;
  /** Second press of the same key within the double-press window. */
  doublepress: KeyEventPayload;
  /** One event per encoder detent. */
  encoderrotate: EncoderRotateEventPayload;
  /** Deflection crossed the dead-zone: the radial interaction begins. */
  joystickengage: JoystickEventPayload;
  /** Every stream sample while engaged (live cursor position). */
  joystickmove: JoystickEventPayload;
  /** The debounced active sector changed while engaged. */
  joysticksector: JoystickEventPayload;
  /** Stick returned to center: the interaction ends with a selection. */
  joystickrelease: JoystickReleasePayload;
}

export type HardwareInputEventType = keyof HardwareInputEventMap;

export type HardwareInputListener<T extends HardwareInputEventType> = (
  payload: HardwareInputEventMap[T],
) => void;

/**
 * Narrow interface to the device transport: anything that can deliver parsed
 * channel-2 JSON values that are not responses to host-originated requests
 * (i.e. notifications and the CM2's bare `{a, d}` joystick stream). Both the
 * raw wire shapes (`{m, p}`, bare `{a, d}`) and the transport's normalized
 * `{method, params}` notification shape are accepted. The transport layer
 * implements this; the decoder never imports transport code.
 */
export interface VendorNotificationSource {
  /** Subscribe to incoming vendor messages. Returns an unsubscribe function. */
  onNotification(listener: (message: unknown) => void): () => void;
}

export interface JoystickOptions {
  /** Deflection at or above which the radial interaction engages. */
  engageDistance?: number;
  /** Deflection at or below which an engaged stick releases (hysteresis). */
  releaseDistance?: number;
  /** Number of radial sectors (prompt slots). */
  sectorCount?: number;
  /** Rotation offset in turns applied before sector math (calibration). */
  sectorOffset?: number;
  /** A new sector must persist this long before `joysticksector` fires. */
  sectorDebounceMs?: number;
}

export interface HardwareInputOptions {
  /** Connected device model. Currently informational — decoding is identical
   * across models (the Codex Mic pair's ACT10/ACT11 stay separate keys). */
  deviceModel?: HardwareDeviceModel;
  /** Window for double-press detection, in ms. Defaults to 350. */
  doublePressWindowMs?: number;
  joystick?: JoystickOptions;
  /** Clock, injectable for tests. Defaults to Date.now. */
  now?: () => number;
}
