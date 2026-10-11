import { selectOnboardingAdapterPreparationContext } from '../agent-availability-selectors';
import { createProviderAdapterPreparationSaga } from '../../../../../../src/store/renderer/slices/agent-availability/sagas/provider-adapter-preparation-saga-factory';

/** Only bind at the real onboarding lifetime, with its captured-route preparation client. */
export function createReactProviderAdapterPreparationSaga(
  prepareOnboardingAdapters: (context: string) => Promise<void>,
) {
  return createProviderAdapterPreparationSaga({
    selectOnboardingAdapterPreparationContext,
    prepareOnboardingAdapters,
  }).providerAdapterPreparationSaga;
}
