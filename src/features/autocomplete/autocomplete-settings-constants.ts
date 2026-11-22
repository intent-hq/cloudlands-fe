/** Upstream services accepted by `autocomplete.service` (§5.12). */
export type AutocompleteService = 'kilo' | 'openrouter';

export const AUTOCOMPLETE_SERVICES: readonly AutocompleteService[] = ['kilo', 'openrouter'];

export const AUTOCOMPLETE_DEFAULT_SERVICE: AutocompleteService = 'kilo';

/** Base model IDs accepted by `autocomplete.model` (§5.12); the daemon adds `:free`. */
export type AutocompleteModel = 'nvidia/nemotron-3.5-lightning' | 'particle-ai/particle-1';

export const AUTOCOMPLETE_MODELS: readonly AutocompleteModel[] = [
  'nvidia/nemotron-3.5-lightning',
  'particle-ai/particle-1',
];

export const AUTOCOMPLETE_DEFAULT_MODEL: AutocompleteModel = 'nvidia/nemotron-3.5-lightning';

export function isAutocompleteService(value: unknown): value is AutocompleteService {
  return AUTOCOMPLETE_SERVICES.includes(value as AutocompleteService);
}

export function isAutocompleteModel(value: unknown): value is AutocompleteModel {
  return AUTOCOMPLETE_MODELS.includes(value as AutocompleteModel);
}
