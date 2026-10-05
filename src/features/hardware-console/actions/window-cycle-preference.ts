import { ACTION_KEY_IDS } from './action-mapping';
import type { ActionKeyId, HardwareDeviceModel } from '../input/types';

/** Desktop-local projection of the last active owner's cycle bindings, never host settings. */
export const WINDOW_CYCLE_STORAGE_KEY = 'intent.hardwareConsole.windowCycle';

export interface WindowCyclePreference {
  enabled: boolean;
  keysByModel: Record<HardwareDeviceModel, ActionKeyId[]>;
}

/** Missing/corrupt snapshots grant no actions; never guess a shared host's mapping. */
export function parseWindowCyclePreference(value: unknown): WindowCyclePreference | null {
  if (!value || typeof value !== 'object') return null;
  const { enabled, keysByModel } = value as Partial<WindowCyclePreference>;
  if (typeof enabled !== 'boolean' || !keysByModel) return null;
  for (const model of ['creator-micro-2', 'codex-micro'] as const) {
    const keys = keysByModel[model];
    if (!Array.isArray(keys) || !keys.every((key) => ACTION_KEY_IDS.includes(key))) return null;
  }
  return { enabled, keysByModel };
}
