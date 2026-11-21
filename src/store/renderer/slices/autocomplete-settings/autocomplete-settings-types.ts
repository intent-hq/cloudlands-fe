import type {
  AutocompleteModel,
  AutocompleteService,
} from '$features/autocomplete/autocomplete-settings-constants';

export interface AutocompleteSettingsSliceState {
  /** True until the initial daemon read settles. */
  isLoading: boolean;
  /** Whether the daemon catalog knows `autocomplete.enabled`; hide the section otherwise. */
  available: boolean;
  enabled: boolean;
  service: AutocompleteService;
  model: AutocompleteModel;
  /** Presence of a stored key per service (redacted placeholder ⇒ configured). */
  keyConfigured: Record<AutocompleteService, boolean>;
  /** Service with an in-flight key write/clear, if any. */
  busyService: AutocompleteService | null;
  /** Localized error from the last failed settings write (settings page only). */
  error: string | null;
}
