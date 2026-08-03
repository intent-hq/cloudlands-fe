/**
 * Action-key → action-id mapping for the action keys (ACT06–ACT12).
 *
 * The mapping is a 7-slot array of action ids (slot 0 = ACT06), kept
 * per-model: both supported devices expose the same ACT06–ACT12 switch ids,
 * but their physical layouts (and therefore sensible defaults) differ. The
 * CM2 has 7 discrete action keys; the Codex Micro has 6 printed caps — the
 * factory 2U Mic keycap presses the ACT10 + ACT11 switches together. The
 * firmware reports those as two separate switch ids (`v.oai.hid` `k` =
 * ACT10/ACT11, per the work-louder-oai protocol), so each slot carries its
 * own action: the Codex defaults put the Mic action on ACT10 and leave
 * ACT11 unset (with the factory cap both would fire on every Mic press).
 * ACT11 stays individually assignable — an assignment only makes sense with
 * the pair physically unlinked, which the Settings UI warns about.
 *
 * Pure web code — no Electron imports, no store imports.
 */

import type { ActionKeyId, HardwareDeviceModel, LogicalKeyId } from '../input/types';

/** Number of action-key slots (ACT06–ACT12) on both supported devices. */
export const ACTION_KEY_COUNT = 7;

/** Supported device models, in a stable order for per-model records. */
export const HARDWARE_CONSOLE_MODELS: readonly HardwareDeviceModel[] = [
  'creator-micro-2',
  'codex-micro',
];

/** Action key ids in slot order: slot 0 = ACT06 … slot 6 = ACT12. */
export const ACTION_KEY_IDS: readonly ActionKeyId[] = [
  'ACT06',
  'ACT07',
  'ACT08',
  'ACT09',
  'ACT10',
  'ACT11',
  'ACT12',
];

/** The v1 action catalog, in spec order (plus the explicit `none`). */
export const ACTION_KEY_ACTION_IDS = [
  'cycle-workspace-agents',
  'cycle-in-progress-agents',
  'cycle-attention-agents',
  'cycle-idle-agents',
  'cycle-unread-agents',
  'cycle-failed-agents',
  'stop-agent',
  'see-spec',
  'toggle-sidebar-tabs',
  'new-agent',
  'new-workspace',
  'switch-window-layouts',
  'none',
] as const;

export type ActionKeyActionId = (typeof ACTION_KEY_ACTION_IDS)[number];

export function isActionKeyActionId(value: unknown): value is ActionKeyActionId {
  return (
    typeof value === 'string' && (ACTION_KEY_ACTION_IDS as readonly string[]).includes(value)
  );
}

/**
 * Slot index (0-based) of ACT11 — the second switch under the Codex Micro's
 * factory 2U Mic keycap (which presses ACT10 + ACT11 together). Defaults to
 * `none` so the linked pair fires a single action out of the box, but the
 * slot remains individually assignable — the Settings UI surfaces the
 * "only works if the keys are unlinked" warning for it.
 */
export const CODEX_MIC_LINKED_SLOT = 5;

/**
 * Per-model default mappings on ACT06–ACT12.
 *
 * CM2 (7 discrete keys): creation/navigation actions first, then the
 * agent-cycling actions on ACT10–ACT12 (Settings-graphic row 4) —
 * in-progress, attention, unread; `cycle-workspace-agents`, `stop-agent`,
 * and `toggle-sidebar-tabs` ship unassigned (all stay assignable).
 *
 * Codex Micro (6 printed caps): row 3 = lightning (ACT06), checkmark
 * (ACT07), x-mark (ACT08), branching (ACT09); row 4 = the linked 2U Mic
 * pair (action on ACT10, ACT11 unset by default) and the logo key (ACT12).
 */
export const DEFAULT_ACTION_MAPPINGS: Record<
  HardwareDeviceModel,
  readonly ActionKeyActionId[]
> = {
  'creator-micro-2': [
    'new-workspace',
    'new-agent',
    'see-spec',
    'switch-window-layouts',
    'cycle-in-progress-agents',
    'cycle-attention-agents',
    'cycle-unread-agents',
  ],
  'codex-micro': [
    'cycle-in-progress-agents',
    'cycle-attention-agents',
    'stop-agent',
    'new-workspace',
    'cycle-unread-agents',
    'none',
    'new-agent',
  ],
};

/**
 * CM2 defaults before `cycle-attention-agents` landed on slot 6 (ACT12).
 * Used only by the one-shot hydration migration below.
 */
export const LEGACY_CM2_DEFAULT_ACTION_MAPPING: readonly ActionKeyActionId[] = [
  'new-workspace',
  'new-agent',
  'see-spec',
  'switch-window-layouts',
  'cycle-in-progress-agents',
  'cycle-workspace-agents',
  'cycle-unread-agents',
];

/**
 * CM2 defaults before row 4 became in-progress / attention / unread (this
 * generation still carried `cycle-workspace-agents` on slot 5 = ACT11).
 * Used only by the one-shot hydration migration below.
 */
export const PREVIOUS_CM2_DEFAULT_ACTION_MAPPING: readonly ActionKeyActionId[] = [
  'new-workspace',
  'new-agent',
  'see-spec',
  'switch-window-layouts',
  'cycle-in-progress-agents',
  'cycle-workspace-agents',
  'cycle-attention-agents',
];

/** Every prior CM2 default generation the migration recognizes. */
const PRIOR_CM2_DEFAULT_ACTION_MAPPINGS: readonly (readonly ActionKeyActionId[])[] = [
  LEGACY_CM2_DEFAULT_ACTION_MAPPING,
  PREVIOUS_CM2_DEFAULT_ACTION_MAPPING,
];

/**
 * Migrate a persisted CM2 mapping that still equals a prior default
 * generation (never customized) to the current defaults. Whole-mapping
 * equality keeps user-customized mappings untouched — a user who changed
 * any slot keeps their layout and can pick up the new default via
 * reset-to-defaults. Returns true when the record was changed.
 */
export function migrateLegacyCm2DefaultActionMapping(
  mappings: Record<HardwareDeviceModel, ActionKeyActionId[]>,
): boolean {
  const cm2 = mappings['creator-micro-2'];
  const isPriorDefault = PRIOR_CM2_DEFAULT_ACTION_MAPPINGS.some(
    (prior) => cm2.length === prior.length && cm2.every((id, slot) => id === prior[slot]),
  );
  if (!isPriorDefault) return false;
  mappings['creator-micro-2'] = [...DEFAULT_ACTION_MAPPINGS['creator-micro-2']];
  return true;
}

/** CM2 defaults — the legacy single-model seam, kept for existing consumers. */
export const DEFAULT_ACTION_MAPPING: readonly ActionKeyActionId[] =
  DEFAULT_ACTION_MAPPINGS['creator-micro-2'];

/** The default mapping for a device model. */
export function getDefaultActionMapping(
  model: HardwareDeviceModel,
): readonly ActionKeyActionId[] {
  return DEFAULT_ACTION_MAPPINGS[model];
}

/** Slot index (0-based) for a logical key, or null for non-action keys. */
export function actionKeyToSlot(key: LogicalKeyId): number | null {
  const index = (ACTION_KEY_IDS as readonly string[]).indexOf(key);
  return index === -1 ? null : index;
}

/**
 * Normalize an arbitrary persisted mapping value to exactly 7 entries for a
 * model. Unknown/missing entries fall back to the model's default for their
 * slot (`none` for slots past the default list).
 */
export function normalizeActionMapping(
  mapping: readonly unknown[] | undefined,
  model: HardwareDeviceModel = 'creator-micro-2',
): ActionKeyActionId[] {
  const defaults = DEFAULT_ACTION_MAPPINGS[model];
  const result: ActionKeyActionId[] = new Array(ACTION_KEY_COUNT);
  for (let slot = 0; slot < ACTION_KEY_COUNT; slot += 1) {
    const value = mapping?.[slot];
    result[slot] = isActionKeyActionId(value) ? value : (defaults[slot] ?? 'none');
  }
  return result;
}

/**
 * Normalize an arbitrary persisted per-model record (plus an optional legacy
 * flat array, treated as the CM2 mapping when the record has no CM2 entry)
 * to a complete `Record<model, 7-slot mapping>`.
 */
export function normalizeActionMappingsByModel(
  value: unknown,
  legacyMapping?: readonly unknown[],
): Record<HardwareDeviceModel, ActionKeyActionId[]> {
  const record =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const result = {} as Record<HardwareDeviceModel, ActionKeyActionId[]>;
  for (const model of HARDWARE_CONSOLE_MODELS) {
    let entry = record[model];
    if (entry === undefined && model === 'creator-micro-2') entry = legacyMapping;
    result[model] = normalizeActionMapping(
      Array.isArray(entry) ? entry : undefined,
      model,
    );
  }
  return result;
}
