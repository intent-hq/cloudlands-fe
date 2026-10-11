// Svelte binding of the shared read owner; remove this facade when the Svelte renderer retires.
import { prepareOnboardingAdapters } from '$features/providers/provider-adapter-preparation.client';
import { selectOnboardingAdapterPreparationContext } from '../agent-availability-selectors';
import { createProviderAdapterPreparationSaga } from './provider-adapter-preparation-saga-factory';

export const { providerAdapterPreparationSaga } = createProviderAdapterPreparationSaga({
  selectOnboardingAdapterPreparationContext,
  prepareOnboardingAdapters,
});
