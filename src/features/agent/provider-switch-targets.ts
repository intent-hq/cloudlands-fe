/**
 * Target choice for moving failed agents to another provider: the model pick
 * rule shared with the chat banner's "Retry on {provider}" (#4455), the
 * per-device memory of the last choice per failed (provider, model) pair,
 * and the dialog prefill. Remembering only prefills; nothing switches
 * without the user confirming.
 */
import { safeLocalStorage } from '$lib/utils/safe-storage';
import type { BulkSwitchTarget } from './bulk-provider-switch';

/** @internal */
// i18n-ignore (storage key, not user-facing)
export const PROVIDER_SWITCH_MEMORY_STORAGE_KEY = 'agent-failure:provider-switch-choices';

/** Newest N failed pairs kept. */
const MAX_PAIRS = 50;

interface PickableModel {
  value: string;
  isDefault?: boolean;
}

export interface SwitchTargetOption {
  providerId: string;
  models: PickableModel[];
}

/**
 * The user's configured model for the provider wins when the catalog still
 * serves it; else the provider's advertised default; else the first row.
 */
export function pickModelForProvider<T extends PickableModel>(
  models: T[],
  persisted: string | undefined,
): T | undefined {
  if (persisted) {
    const chosen = models.find((model) => model.value === persisted);
    if (chosen) return chosen;
  }
  return models.find((model) => model.isDefault === true) ?? models[0];
}

type Memory = Record<string, BulkSwitchTarget & { at: number }>;

function pairKey(providerRef: string, model: string | null | undefined): string {
  return `${providerRef}|${model ?? ''}`;
}

function readMemory(): Memory {
  const raw = safeLocalStorage.getItem(PROVIDER_SWITCH_MEMORY_STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Memory) : {};
  } catch {
    return {};
  }
}

export function getRememberedProviderSwitch(
  providerRef: string,
  model: string | null | undefined,
): BulkSwitchTarget | undefined {
  const value = readMemory()[pairKey(providerRef, model)];
  if (!value || typeof value.providerId !== 'string' || typeof value.modelId !== 'string') {
    return undefined;
  }
  return { providerId: value.providerId, modelId: value.modelId };
}

export function rememberProviderSwitch(
  providerRef: string,
  model: string | null | undefined,
  target: BulkSwitchTarget,
): void {
  const memory = readMemory();
  memory[pairKey(providerRef, model)] = { ...target, at: Date.now() };
  const kept = Object.entries(memory)
    .sort(([, a], [, b]) => (b.at ?? 0) - (a.at ?? 0))
    .slice(0, MAX_PAIRS);
  safeLocalStorage.setItem(
    PROVIDER_SWITCH_MEMORY_STORAGE_KEY,
    JSON.stringify(Object.fromEntries(kept)),
  );
}

/**
 * Prefill for one dialog row: an eligible remembered target, else the
 * remembered (or first eligible) provider with its configured default model.
 */
export function resolveSwitchPrefill(input: {
  remembered?: BulkSwitchTarget;
  targets: SwitchTargetOption[];
  configuredModels: Record<string, string>;
}): BulkSwitchTarget | null {
  const { remembered, targets, configuredModels } = input;
  const rememberedTarget = remembered
    ? targets.find((target) => target.providerId === remembered.providerId)
    : undefined;
  if (rememberedTarget && remembered) {
    if (rememberedTarget.models.some((model) => model.value === remembered.modelId)) {
      return remembered;
    }
  }
  const ordered = rememberedTarget
    ? [rememberedTarget, ...targets.filter((target) => target !== rememberedTarget)]
    : targets;
  for (const target of ordered) {
    const model = pickModelForProvider(target.models, configuredModels[target.providerId]);
    if (model) return { providerId: target.providerId, modelId: model.value };
  }
  return null;
}

export function unionTargets(perAgent: string[][]): string[] {
  return [...new Set(perAgent.flat())];
}
