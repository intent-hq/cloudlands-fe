/**
 * Gating rules of the Autocomplete settings section (approved mock-up):
 *
 * - Kilo without a key sends conversation text to Kilo's free, anonymous
 *   tier, so turning it on needs an explicit confirmation first.
 * - OpenRouter cannot run without a key, so turning it on opens the key field
 *   instead; cancelling that field turns it off again.
 *
 * Pure functions so the panel and its tests share one source of truth.
 */
import type { AutocompleteService } from '../autocomplete-settings-constants';

export type AutocompleteKeys = Record<AutocompleteService, boolean>;

/** What flipping the switch on should do. */
export type EnableDecision =
  /** Write `enabled: true` now. */
  | 'enable'
  /** Show the Kilo data confirmation; enable only on confirm. */
  | 'confirm-kilo'
  /** Open the OpenRouter key field; enable once a key is saved. */
  | 'ask-key';

export function decideEnable(service: AutocompleteService, keys: AutocompleteKeys): EnableDecision {
  if (keys[service]) return 'enable';
  return service === 'kilo' ? 'confirm-kilo' : 'ask-key';
}

export interface ServiceChangeDecision {
  /** Turn autocomplete off before anything else. */
  disable: boolean;
  /** Show the Kilo data confirmation (re-enables on confirm). */
  confirmKilo: boolean;
  /** Open the key field for the new service. */
  askKey: boolean;
}

/**
 * Switching service while on must re-apply the gate of the new service:
 * keyless Kilo turns off and asks for confirmation; keyless OpenRouter keeps
 * its state and opens the key field. While off, nothing is gated.
 */
export function decideServiceChange(
  enabled: boolean,
  next: AutocompleteService,
  keys: AutocompleteKeys,
): ServiceChangeDecision {
  const none = { disable: false, confirmKilo: false, askKey: false };
  if (!enabled || keys[next]) return none;
  if (next === 'kilo') return { disable: true, confirmKilo: true, askKey: false };
  return { ...none, askKey: true };
}

/** Cancelling the key field turns autocomplete off when the service cannot run without a key. */
export function shouldDisableOnKeyCancel(
  service: AutocompleteService,
  keys: AutocompleteKeys,
): boolean {
  return service === 'openrouter' && !keys.openrouter;
}

/**
 * Removing the active service's key while on turns autocomplete off. For Kilo
 * the keyless free tier sends text anonymously, so it needs the data
 * confirmation again before turning back on.
 */
export function decideKeyRemove(
  enabled: boolean,
  service: AutocompleteService,
): { disable: boolean; confirmKilo: boolean } {
  if (!enabled) return { disable: false, confirmKilo: false };
  return { disable: true, confirmKilo: service === 'kilo' };
}
