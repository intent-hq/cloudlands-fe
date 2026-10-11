/** Svelte compatibility API; remove at Svelte picker retirement. */
import type { ProviderLoadError } from './provider-load-error';
import { formatProviderLoadError as projectProviderLoadError } from './model-picker-provider-projections';
import { getModelPickerProviderContext } from './model-picker-provider-context';

export type { ProviderLoadError } from './provider-load-error';

export function formatProviderLoadError(providerId: string, error: unknown): ProviderLoadError {
  // Error guidance follows the GLOBAL catalog and host membership, as in the source.
  return projectProviderLoadError(providerId, error, getModelPickerProviderContext());
}
