/**
 * LED frame building: snapshot states → `v.oai.thstatus` / `v.oai.rgbcfg`
 * params (cm2-probe README + led.rs wire shapes, live-verified on CM2
 * fw v0.6.0).
 *
 * `v.oai.thstatus` takes an ARRAY of per-LED entries `{id, c, b, e, s}` and
 * the firmware repaints the whole status display per call, so every frame
 * carries all 6 agent-key ids (0–5). `v.oai.rgbcfg` takes grouped
 * `keys`/`ambient` zone objects `{e, b, s, m, c}`.
 *
 * Status palette (spec, both CM2 and Codex Micro): white = idle, blue =
 * thinking/working (slow breath), green = complete (steady), yellow = needs
 * input (fast breath), red = error/failed (fast breath). Breathing is
 * firmware-driven — the effect set is off/solid/snake/rainbow/breath/gradient
 * with a per-entry speed, so no host-side animation timer is needed and a
 * single frame replay restores animations after reconnect.
 *
 * Pure web code — no Electron imports, no store imports.
 */

/** Per-key LED state for one agent key (spec "Agent-key LED palette"). */
export type AgentKeyLedState =
  | 'unassigned'
  | 'idle'
  | 'running'
  | 'complete'
  | 'attention'
  | 'failed';

/** Ambient/keys backlight state (spec ambient row of the control mapping). */
export type AmbientLedState = 'dark' | 'breath' | 'attention';

/** Host-side lighting state snapshot: 6 key states + the ambient state. */
export interface HardwareLedSnapshot {
  /** Slot-ordered key states (slot 0 = key "1" = AG02); length 6. */
  keys: readonly AgentKeyLedState[];
  ambient: AmbientLedState;
}

/** One per-LED entry of a `v.oai.thstatus` frame. */
export interface ThStatusEntry {
  id: number;
  /** 24-bit RGB color. */
  c: number;
  /** Brightness 0–1. */
  b: number;
  /** Effect code (see LED_EFFECT_*). */
  e: number;
  /** Effect speed 0–1. */
  s: number;
}

/** One zone of a `v.oai.rgbcfg` call. */
export interface RgbcfgZone {
  e: number;
  b: number;
  s: number;
  m: number;
  c: number;
}

export interface RgbcfgParams {
  keys: RgbcfgZone;
  ambient: RgbcfgZone;
}

export const LED_EFFECT_OFF = 0;
export const LED_EFFECT_SOLID = 1;
export const LED_EFFECT_BREATH = 4;

/** Number of agent-key LEDs (ids 0–5) in every thstatus frame. */
export const AGENT_KEY_LED_COUNT = 6;

/**
 * Firmware LED id per binding slot. LED ids follow the physical AG keys
 * (id 0 = AG00 top-left, id 1 = AG01 top-right, ids 2–5 = AG02–AG05 second
 * row left→right; cm2-probe README), while the binding numbers the second
 * row as slots 1–4 and the top row as slots 5–6 (`AGENT_KEY_IDS` order:
 * AG02…AG05, AG00, AG01).
 */
export const SLOT_TO_LED_ID: readonly number[] = [2, 3, 4, 5, 0, 1];

const COLOR_WHITE = 0xffffff;
const COLOR_BLUE = 0x0a84ff;
const COLOR_GREEN = 0x30d158;
const COLOR_YELLOW = 0xffd60a;
const COLOR_RED = 0xff3b30;

/** Fast breath for the urgent states (needs input / error). */
const FAST_BREATH_SPEED = 0.9;
/** Slow breath for the calm thinking/working state. */
const SLOW_BREATH_SPEED = 0.5;
const AMBIENT_BREATH_SPEED = 0.35;

const KEY_LED_PALETTE: Record<AgentKeyLedState, Omit<ThStatusEntry, 'id'>> = {
  unassigned: { c: 0, b: 0, e: LED_EFFECT_OFF, s: 0 },
  idle: { c: COLOR_WHITE, b: 0.12, e: LED_EFFECT_SOLID, s: 0 },
  running: { c: COLOR_BLUE, b: 0.6, e: LED_EFFECT_BREATH, s: SLOW_BREATH_SPEED },
  complete: { c: COLOR_GREEN, b: 0.5, e: LED_EFFECT_SOLID, s: 0 },
  attention: { c: COLOR_YELLOW, b: 0.8, e: LED_EFFECT_BREATH, s: FAST_BREATH_SPEED },
  failed: { c: COLOR_RED, b: 0.7, e: LED_EFFECT_BREATH, s: FAST_BREATH_SPEED },
};

const DARK_ZONE: RgbcfgZone = { e: LED_EFFECT_OFF, b: 0, s: 0, m: 0, c: 0 };

const AMBIENT_PALETTE: Record<AmbientLedState, RgbcfgZone> = {
  dark: DARK_ZONE,
  breath: { e: LED_EFFECT_BREATH, b: 0.5, s: AMBIENT_BREATH_SPEED, m: 0, c: COLOR_BLUE },
  attention: { e: LED_EFFECT_BREATH, b: 0.8, s: FAST_BREATH_SPEED, m: 0, c: COLOR_YELLOW },
};

/**
 * Build a FULL `v.oai.thstatus` frame (all 6 agent-key ids, 0–5). `keys` is
 * slot-ordered (binding numbering); each slot's state lands on its physical
 * LED via {@link SLOT_TO_LED_ID}, and entries are emitted in ascending LED
 * id order. Missing trailing states render as `unassigned` (off).
 */
export function buildThStatusParams(keys: readonly AgentKeyLedState[]): ThStatusEntry[] {
  const frame: ThStatusEntry[] = [];
  for (let slot = 0; slot < AGENT_KEY_LED_COUNT; slot += 1) {
    const state = keys[slot] ?? 'unassigned';
    frame.push({ id: SLOT_TO_LED_ID[slot], ...KEY_LED_PALETTE[state] });
  }
  frame.sort((a, b) => a.id - b.id);
  return frame;
}

/** Build `v.oai.rgbcfg` params: both zones driven by the ambient state. */
export function buildRgbcfgParams(ambient: AmbientLedState): RgbcfgParams {
  const zone = AMBIENT_PALETTE[ambient];
  return { keys: { ...zone }, ambient: { ...zone } };
}
