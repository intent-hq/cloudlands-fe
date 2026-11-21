/**
 * Composer autocomplete settings (PROTOCOL §5.12, TOML `[autocomplete]`).
 *
 * The daemon owns every value: `autocomplete.enabled`, `autocomplete.service`,
 * `autocomplete.model` and the two sensitive key paths, which live in the
 * daemon's secret store and read back redacted (a non-empty placeholder means
 * "configured", `null` means absent) — the same seam as the voice provider
 * keys (voice-settings-service.ts). Keys never reach the renderer.
 *
 * Dependency-light: imports only the AppClient seam.
 */
import { appClient } from '$lib/client';
import {
  AUTOCOMPLETE_DEFAULT_MODEL,
  AUTOCOMPLETE_DEFAULT_SERVICE,
  isAutocompleteModel,
  isAutocompleteService,
  type AutocompleteModel,
  type AutocompleteService,
} from './autocomplete-settings-constants';

export const AUTOCOMPLETE_ENABLED_SETTING_PATH = 'autocomplete.enabled';
export const AUTOCOMPLETE_SERVICE_SETTING_PATH = 'autocomplete.service';
export const AUTOCOMPLETE_MODEL_SETTING_PATH = 'autocomplete.model';

/** Sensitive daemon settings paths backing the per-service API keys. */
export const AUTOCOMPLETE_API_KEY_SETTING_PATHS: Record<AutocompleteService, string> = {
  kilo: 'autocomplete.kilo.apiKey',
  openrouter: 'autocomplete.openrouter.apiKey',
};

export interface AutocompleteSettingsSnapshot {
  /** Whether the daemon catalog knows `autocomplete.enabled`; the section hides otherwise. */
  available: boolean;
  enabled: boolean;
  service: AutocompleteService;
  model: AutocompleteModel;
  keyConfigured: Record<AutocompleteService, boolean>;
}

function isConfigured(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0;
}

export async function loadAutocompleteSettings(): Promise<AutocompleteSettingsSnapshot> {
  const [enabledEntry, serviceEntry, modelEntry, kiloKeyEntry, openrouterKeyEntry] =
    await Promise.all([
      appClient.settings.get(AUTOCOMPLETE_ENABLED_SETTING_PATH),
      appClient.settings.get(AUTOCOMPLETE_SERVICE_SETTING_PATH),
      appClient.settings.get(AUTOCOMPLETE_MODEL_SETTING_PATH),
      appClient.settings.get(AUTOCOMPLETE_API_KEY_SETTING_PATHS.kilo),
      appClient.settings.get(AUTOCOMPLETE_API_KEY_SETTING_PATHS.openrouter),
    ]);
  return {
    available: enabledEntry !== null,
    enabled: enabledEntry?.value === true,
    service: isAutocompleteService(serviceEntry?.value)
      ? serviceEntry.value
      : AUTOCOMPLETE_DEFAULT_SERVICE,
    model: isAutocompleteModel(modelEntry?.value) ? modelEntry.value : AUTOCOMPLETE_DEFAULT_MODEL,
    keyConfigured: {
      kilo: isConfigured(kiloKeyEntry?.value),
      openrouter: isConfigured(openrouterKeyEntry?.value),
    },
  };
}

async function updateOne(path: string, value: unknown): Promise<void> {
  const applied = await appClient.settings.update([{ path, value }]);
  if (!applied.some((change) => change.path === path)) {
    // i18n-ignore (Error.message carries the wire path; the panel maps it to a localized message)
    throw new Error(`settings.update did not apply ${path}`);
  }
}

export function setAutocompleteEnabled(enabled: boolean): Promise<void> {
  return updateOne(AUTOCOMPLETE_ENABLED_SETTING_PATH, enabled);
}

export function setAutocompleteService(service: AutocompleteService): Promise<void> {
  return updateOne(AUTOCOMPLETE_SERVICE_SETTING_PATH, service);
}

export function setAutocompleteModel(model: AutocompleteModel): Promise<void> {
  return updateOne(AUTOCOMPLETE_MODEL_SETTING_PATH, model);
}

/** Store a pasted key in the daemon secret store. Blank keys are a programmer error. */
export async function saveAutocompleteApiKey(
  service: AutocompleteService,
  apiKey: string,
): Promise<void> {
  const key = apiKey.trim();
  if (!key) {
    // i18n-ignore (guard against programmer error; the panel disables Save for empty drafts)
    throw new Error('API key must not be empty');
  }
  await appClient.settings.update([
    { path: AUTOCOMPLETE_API_KEY_SETTING_PATHS[service], value: key },
  ]);
}

/** Delete a stored key; the live client folds reset failures to `null`. */
export async function clearAutocompleteApiKey(service: AutocompleteService): Promise<void> {
  const path = AUTOCOMPLETE_API_KEY_SETTING_PATHS[service];
  if ((await appClient.settings.reset(path)) === null) {
    // i18n-ignore (Error.message carries the wire path; the panel maps it to a localized message)
    throw new Error(`settings.reset failed for ${path}`);
  }
}
