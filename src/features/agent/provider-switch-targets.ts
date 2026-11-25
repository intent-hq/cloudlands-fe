/**
 * Target choice for moving failed agents to another provider: the model pick
 * rule shared with the chat banner's "Retry on {provider}" (#4455), the
 * remembered last choice per failed (provider, model) pair, and the dialog
 * prefill. Remembering only prefills; nothing switches without the user
 * confirming. The memory lives in the daemon's FE-owned
 * `providerSwitch.state` setting; these helpers are pure over that bag.
 */
import type { BulkSwitchTarget } from './bulk-provider-switch';

// i18n-ignore (daemon setting path, not user-facing)
export const PROVIDER_SWITCH_SETTINGS_PATH = 'providerSwitch.state';

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

type Remembered = BulkSwitchTarget & { at: number };

/** `providerSwitch.state` bag: `{ choices: { "<providerRef>|<model>": { providerId, modelId, at } } }`. */
export type ProviderSwitchBag = Record<string, unknown>;

function pairKey(providerRef: string, model: string | null | undefined): string {
  return `${providerRef}|${model ?? ''}`;
}

function choicesOf(bag: ProviderSwitchBag): Record<string, Remembered> {
  const choices = bag.choices;
  return choices && typeof choices === 'object' && !Array.isArray(choices)
    ? (choices as Record<string, Remembered>)
    : {};
}

export function getRememberedProviderSwitch(
  bag: ProviderSwitchBag,
  providerRef: string,
  model: string | null | undefined,
): BulkSwitchTarget | undefined {
  const value = choicesOf(bag)[pairKey(providerRef, model)];
  if (!value || typeof value.providerId !== 'string' || typeof value.modelId !== 'string') {
    return undefined;
  }
  return { providerId: value.providerId, modelId: value.modelId };
}

/** The bag with each pair's choice recorded, keeping the newest pairs. */
export function withRememberedProviderSwitches(
  bag: ProviderSwitchBag,
  entries: Array<{ providerRef: string; model: string | null; target: BulkSwitchTarget }>,
  at: number,
): ProviderSwitchBag {
  const choices = { ...choicesOf(bag) };
  for (const { providerRef, model, target } of entries) {
    choices[pairKey(providerRef, model)] = { ...target, at };
  }
  const kept = Object.entries(choices)
    .sort(([, a], [, b]) => (b.at ?? 0) - (a.at ?? 0))
    .slice(0, MAX_PAIRS);
  return { ...bag, choices: Object.fromEntries(kept) };
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
