/**
 * Voice settings service — provider + API-key management (PROTOCOL §5.12/§5.41).
 *
 * Voice dictation has **no** dedicated auth wire methods: the transcription
 * provider is the `voice.provider` daemon setting (enum `elevenlabs` |
 * `openai`) and the provider API keys are the sensitive settings paths
 * `voice.elevenlabs.apiKey` / `voice.openai.apiKey`, persisted to the
 * daemon's file-backed secret store like `linear.token` (the Linear
 * paste-key precedent — linear-auth-store-service.ts). Keys never reach the
 * renderer: `settings.get` redacts a stored secret to a placeholder string
 * and reports `null` when absent, so "configured" is derived from presence
 * of a non-empty value, never from the plaintext.
 *
 * Dependency-light per src/store AGENTS.md: imports only the AppClient seam.
 * The settings panel owns the (component-local) UI state; there is no Redux
 * slice because nothing outside the panel consumes these values — the daemon
 * resolves provider + key server-side at `voice.transcribe` time (§5.41).
 */
import { appClient } from "$lib/client";

/** Transcription providers supported by `voice.transcribe` (§5.41). */
export type VoiceProvider = "elevenlabs" | "openai";

export const VOICE_PROVIDERS: readonly VoiceProvider[] = ["elevenlabs", "openai"];

/** Daemon settings path selecting the default transcription provider (§5.12). */
export const VOICE_PROVIDER_SETTING_PATH = "voice.provider";

/** Sensitive daemon settings paths whose secret values back the provider API keys (§5.12). */
export const VOICE_API_KEY_SETTING_PATHS: Record<VoiceProvider, string> = {
  elevenlabs: "voice.elevenlabs.apiKey",
  openai: "voice.openai.apiKey",
};

/** Non-secret daemon settings path selecting the OpenAI transcription model (§5.12). */
export const VOICE_OPENAI_MODEL_SETTING_PATH = "voice.openai.model";

/** OpenAI transcription models accepted by `voice.openai.model` (§5.41). */
export type VoiceOpenAiModel =
  | "gpt-4o-transcribe"
  | "gpt-4o-mini-transcribe"
  | "whisper-1";

export const VOICE_OPENAI_MODELS: readonly VoiceOpenAiModel[] = [
  "gpt-4o-transcribe",
  "gpt-4o-mini-transcribe",
  "whisper-1",
];

/** Daemon-side default when the model setting is unset (openai.rs DEFAULT_MODEL). */
export const VOICE_OPENAI_DEFAULT_MODEL: VoiceOpenAiModel = "gpt-4o-transcribe";

/**
 * Non-secret daemon settings path holding the default transcription language
 * hint (optional ISO-639-1 string, no default — §5.12/§5.41 "Language
 * resolution"). Unset/blank means provider auto-detection; the daemon applies
 * it server-side to cloud `voice.transcribe` calls, and the FE forwards it to
 * the local OS engine as the recognizer locale.
 */
export const VOICE_LANGUAGE_SETTING_PATH = "voice.language";

/** Auto-detect sentinel: an empty string clears the language hint. */
export const VOICE_LANGUAGE_AUTO = "";

/**
 * Curated ISO-639-1 codes offered by the language selector — broad coverage
 * of the languages the transcription providers and macOS speech recognition
 * support well, without overwhelming the UI. Display names are derived via
 * `Intl.DisplayNames`, so the list needs no name table.
 */
export const VOICE_LANGUAGES: readonly string[] = [
  "en", "zh", "es", "hi", "ar", "pt", "fr", "de", "ja", "ko",
  "ru", "it", "nl", "pl", "tr", "vi", "id", "th", "sv", "da",
  "nb", "fi", "cs", "el", "he", "hu", "ro", "uk",
];

/** Non-secret daemon settings path holding the transcription vocabulary (string array, §5.12). */
export const VOICE_VOCABULARY_SETTING_PATH = "voice.vocabulary";

/** Maximum length of a single vocabulary term (providers skip longer keyterms, §5.41). */
export const VOICE_VOCABULARY_TERM_MAX_LENGTH = 50;

export interface VoiceSettingsSnapshot {
  /** Whether the connected daemon exposes the voice settings catalog (v4.3+). */
  available: boolean;
  /** Selected provider; the daemon default (`elevenlabs`) when unset. */
  provider: VoiceProvider;
  /** Presence of a stored key per provider (redacted placeholder ⇒ configured). */
  keyConfigured: Record<VoiceProvider, boolean>;
  /** Vocabulary terms biased into every transcription; `null` when the daemon predates the setting. */
  vocabulary: string[] | null;
  /** OpenAI transcription model; `null` when the daemon's catalog lacks the setting. */
  openaiModel: VoiceOpenAiModel | null;
  /**
   * Language hint (ISO-639-1); `""` = auto-detect (unset). `null` when the
   * daemon's catalog lacks `voice.language` (pre-setting daemon — hide the
   * selector, same availability pattern as `voice.openai.model`).
   */
  language: string | null;
}

function isVoiceProvider(value: unknown): value is VoiceProvider {
  return value === "elevenlabs" || value === "openai";
}

export function isVoiceOpenAiModel(value: unknown): value is VoiceOpenAiModel {
  return VOICE_OPENAI_MODELS.includes(value as VoiceOpenAiModel);
}

/** A sensitive setting reads as configured when the daemon reports a non-empty (redacted) value. */
function isConfigured(value: unknown): boolean {
  return typeof value === "string" && value.length > 0;
}

/** The vocabulary reads as a string array; anything else (older daemon) ⇒ `null`. */
function parseVocabulary(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((term) => typeof term === "string")
    ? (value as string[])
    : null;
}

/**
 * Read the current voice settings from the daemon. A `null` provider entry
 * means the daemon predates the voice catalog (pre-4.3) — surfaced as
 * `available: false` so the panel can say so instead of failing writes.
 */
export async function loadVoiceSettings(): Promise<VoiceSettingsSnapshot> {
  const [
    providerEntry,
    elevenlabsEntry,
    openaiEntry,
    vocabularyEntry,
    openaiModelEntry,
    languageEntry,
  ] = await Promise.all([
    appClient.settings.get(VOICE_PROVIDER_SETTING_PATH),
    appClient.settings.get(VOICE_API_KEY_SETTING_PATHS.elevenlabs),
    appClient.settings.get(VOICE_API_KEY_SETTING_PATHS.openai),
    appClient.settings.get(VOICE_VOCABULARY_SETTING_PATH),
    appClient.settings.get(VOICE_OPENAI_MODEL_SETTING_PATH),
    appClient.settings.get(VOICE_LANGUAGE_SETTING_PATH),
  ]);
  return {
    available: providerEntry !== null,
    provider: isVoiceProvider(providerEntry?.value) ? providerEntry.value : "elevenlabs",
    keyConfigured: {
      elevenlabs: isConfigured(elevenlabsEntry?.value),
      openai: isConfigured(openaiEntry?.value),
    },
    vocabulary: parseVocabulary(vocabularyEntry?.value),
    // `null` entry ⇒ setting absent from the catalog (older daemon) ⇒ hide the
    // selector. A present entry with an unset/unknown value folds to the
    // daemon-side default so the selector reflects what will actually run.
    openaiModel:
      openaiModelEntry === null
        ? null
        : isVoiceOpenAiModel(openaiModelEntry.value)
          ? openaiModelEntry.value
          : VOICE_OPENAI_DEFAULT_MODEL,
    // `null` entry ⇒ daemon predates `voice.language` ⇒ hide the selector.
    // Unset/blank/non-string values fold to auto-detect (the daemon trims and
    // treats blank as unset — §5.41 "Language resolution"). Lowercased so a
    // hand-edited value ("DE" in config.toml) matches the curated codes —
    // ISO-639-1/BCP-47 language subtags are case-insensitive.
    language:
      languageEntry === null
        ? null
        : typeof languageEntry.value === "string"
          ? languageEntry.value.trim().toLowerCase()
          : VOICE_LANGUAGE_AUTO,
  };
}

/**
 * Persist the provider selection. Throws when the daemon rejects the change
 * or silently drops the path (older daemon) so the panel keeps its previous
 * state instead of lying about what was applied.
 */
export async function setVoiceProvider(provider: VoiceProvider): Promise<void> {
  const applied = await appClient.settings.update([
    { path: VOICE_PROVIDER_SETTING_PATH, value: provider },
  ]);
  if (!applied.some((change) => change.path === VOICE_PROVIDER_SETTING_PATH)) {
    // i18n-ignore (Error.message carries the wire path; the panel maps it to a localized message)
    throw new Error(`settings.update did not apply ${VOICE_PROVIDER_SETTING_PATH}`);
  }
}

/**
 * Persist the OpenAI transcription model selection. Throws when the daemon
 * rejects the change or silently drops the path (older daemon without the
 * setting) so the panel can roll back its optimistic value.
 */
export async function setVoiceOpenAiModel(model: VoiceOpenAiModel): Promise<void> {
  const applied = await appClient.settings.update([
    { path: VOICE_OPENAI_MODEL_SETTING_PATH, value: model },
  ]);
  if (!applied.some((change) => change.path === VOICE_OPENAI_MODEL_SETTING_PATH)) {
    // i18n-ignore (Error.message carries the wire path; the panel maps it to a localized message)
    throw new Error(`settings.update did not apply ${VOICE_OPENAI_MODEL_SETTING_PATH}`);
  }
}

/**
 * Persist the language hint (ISO-639-1 code, or `""` for auto-detect — the
 * daemon treats a blank stored value as unset, §5.41 "Language resolution").
 * Throws when the daemon rejects the change or silently drops the path
 * (older daemon without the setting) so the panel can roll back its
 * optimistic value.
 */
export async function setVoiceLanguage(language: string): Promise<void> {
  const applied = await appClient.settings.update([
    { path: VOICE_LANGUAGE_SETTING_PATH, value: language },
  ]);
  if (!applied.some((change) => change.path === VOICE_LANGUAGE_SETTING_PATH)) {
    // i18n-ignore (Error.message carries the wire path; the panel maps it to a localized message)
    throw new Error(`settings.update did not apply ${VOICE_LANGUAGE_SETTING_PATH}`);
  }
}

/**
 * Persist the full vocabulary array (the daemon owns storage — the FE always
 * writes the complete list). Throws when the daemon rejects the change or
 * silently drops the path (older daemon) so the panel can roll back.
 */
export async function setVoiceVocabulary(terms: string[]): Promise<void> {
  const applied = await appClient.settings.update([
    { path: VOICE_VOCABULARY_SETTING_PATH, value: terms },
  ]);
  if (!applied.some((change) => change.path === VOICE_VOCABULARY_SETTING_PATH)) {
    // i18n-ignore (Error.message carries the wire path; the panel maps it to a localized message)
    throw new Error(`settings.update did not apply ${VOICE_VOCABULARY_SETTING_PATH}`);
  }
}

/**
 * Store a pasted API key through the daemon secrets-file path. Whitespace-only
 * keys are rejected locally; daemon errors propagate to the caller.
 */
export async function saveVoiceApiKey(provider: VoiceProvider, apiKey: string): Promise<void> {
  const key = apiKey.trim();
  if (!key) {
    // i18n-ignore (guard against programmer error; the panel disables Save for empty drafts)
    throw new Error("API key must not be empty");
  }
  await appClient.settings.update([
    { path: VOICE_API_KEY_SETTING_PATHS[provider], value: key },
  ]);
}

/**
 * Clear a stored API key (`settings.reset` deletes the secrets-file entry).
 * The live client folds reset failures to `null` instead of throwing, so a
 * `null` result is the failure signal and is rethrown here. The daemon may
 * still fall back to the provider's environment variable (§5.41 key
 * resolution) — that fallback is invisible to settings reads.
 */
export async function clearVoiceApiKey(provider: VoiceProvider): Promise<void> {
  const path = VOICE_API_KEY_SETTING_PATHS[provider];
  const applied = await appClient.settings.reset(path);
  if (applied === null) {
    // i18n-ignore (Error.message carries the wire path; the panel maps it to a localized message)
    throw new Error(`settings.reset failed for ${path}`);
  }
}
