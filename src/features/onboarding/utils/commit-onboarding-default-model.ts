/**
 * Commits the onboarding prompt-step picker's *default* (never-overridden)
 * selection at create-submit time, making the picker the authoritative source
 * of the initial default provider + default model (intent-hq/monorepo#3044).
 *
 * An explicit pick already persists at pick time (`handleOnboardingModelChange`
 * dispatches `selectModel`, whose saga adopts the provider and writes
 * `model.providerDefaults` / `providers.active`). The gap this closes is the
 * never-touched selection: the resolved provider is committed through
 * `commitOnboardingProviderSelection` (the existing card-click dispatch path,
 * a no-op when already active) and the picker's effective default-model
 * preview — when one resolved — through the same `selectModel` trigger an
 * explicit pick uses. No direct `settings.update` calls: persistence stays
 * owned by the model-selection and provider-settings sagas.
 *
 * A missing preview (the picker shows "Provider default") persists no model:
 * the daemon already resolves to the provider CLI default, and there is no
 * concrete id to pin. The provider commit still applies.
 */
import { selectModel } from '$store/renderer/slices/model/model-slice';
import { splitLegacyCompoundId } from '$shared/utils/legacy-model-id';
import {
  commitOnboardingProviderSelection,
  type CommitOnboardingProviderSelectionAction,
} from './commit-onboarding-provider-selection';

type CommitOnboardingDefaultModelAction =
  CommitOnboardingProviderSelectionAction | ReturnType<typeof selectModel>;

export interface CommitOnboardingDefaultModelInput {
  /** Provider `resolveOnboardingModel` returned for the create ('' ⇒ unresolved). */
  provider: string;
  /**
   * The picker's displayed default-model preview (daemon `resolvedModel`,
   * PROTOCOL §5.11) — bare or compound. Undefined ⇒ "Provider default".
   */
  effectiveDefaultModel: string | undefined;
  /** The store's current active provider id ('' when unset). */
  activeProviderId: string;
  dispatch: (action: CommitOnboardingDefaultModelAction) => void;
}

/**
 * Returns what was committed; either field is undefined when the
 * corresponding dispatch was skipped (provider already active / no preview).
 * The provider commit is dispatched BEFORE `selectModel` so the selection
 * saga sees the adopted provider and never double-dispatches the switch.
 */
export function commitOnboardingDefaultModel(input: CommitOnboardingDefaultModelInput): {
  committedProvider: string | undefined;
  committedModel: string | undefined;
} {
  const { provider, effectiveDefaultModel, activeProviderId, dispatch } = input;

  const committedProvider = commitOnboardingProviderSelection({
    selectedProviderId: provider || undefined,
    activeProviderId,
    dispatch,
  });

  let committedModel: string | undefined;
  if (effectiveDefaultModel) {
    // Dispatch the pick as an explicit triple so the model-selection saga
    // attributes it to the resolved provider: the preview is normally a bare
    // id paired with `provider`; a legacy compound preview keeps its own
    // prefix (an empty `:model` prefix falls back to the resolved provider).
    const { providerId, modelId } = splitLegacyCompoundId(effectiveDefaultModel);
    const pickProvider = providerId || provider;
    if (pickProvider && modelId) {
      committedModel = modelId;
      dispatch(selectModel(modelId, pickProvider));
    }
  }

  return { committedProvider, committedModel };
}
