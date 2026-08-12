/**
 * Commits the onboarding welcome step's visually-selected provider when the
 * user explicitly advances (button or ⌘↵), mirroring AgentGrid's card-click
 * dispatch sequence so step 4 never sees an empty enabled-provider set while
 * a ready provider exists.
 *
 * Per decision D1(B) this must only run on an explicit user advance action —
 * never on mere render/detection — so the caller (AgentGrid's
 * `commitSelection`, invoked from OnboardingPage's advance handlers) decides
 * when to call it.
 */
import { reloadModelsForProvider } from '$store/renderer/slices/model/model-slice';
import {
  setActiveProvider,
  setProviderEnabled,
} from '$store/renderer/slices/provider-settings/provider-settings-slice';

export type CommitOnboardingProviderSelectionAction =
  | ReturnType<typeof setProviderEnabled>
  | ReturnType<typeof setActiveProvider>
  | ReturnType<typeof reloadModelsForProvider>;

export interface CommitOnboardingProviderSelectionInput {
  /** The card the grid currently renders as selected — the output of
   *  `resolveOnboardingSelectedProvider`; undefined when nothing is ready. */
  selectedProviderId: string | undefined;
  /** The store's current active provider id ('' when unset). */
  activeProviderId: string | undefined;
  dispatch: (action: CommitOnboardingProviderSelectionAction) => void;
}

/**
 * Returns the committed provider id, or undefined when nothing was
 * dispatched (no ready selection, or the selection is already active).
 */
export function commitOnboardingProviderSelection(
  input: CommitOnboardingProviderSelectionInput,
): string | undefined {
  const { selectedProviderId, activeProviderId, dispatch } = input;
  if (!selectedProviderId) return undefined;
  // The resolver only returns the active provider when it is ready, so a
  // match means the selection is already committed — don't double-dispatch.
  if (selectedProviderId === activeProviderId) return undefined;
  dispatch(setProviderEnabled({ providerId: selectedProviderId, enabled: true }));
  dispatch(setActiveProvider(selectedProviderId));
  dispatch(reloadModelsForProvider());
  return selectedProviderId;
}
