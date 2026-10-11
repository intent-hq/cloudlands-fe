import {
  selectHostRole,
  selectPrincipalConnectionContext,
} from '../../principal/principal-selectors';
import * as availability from '../agent-availability-selectors';
import {
  providerStatusClient,
  providerAuthStatusClient,
} from '@/features/providers/provider-read-clients';
import { createProviderAvailabilitySaga } from '../../../../../../src/store/renderer/slices/agent-availability/sagas/provider-availability-saga-factory';

/** Read owner only: no terminal/login workflow and no adapter preparation startup. */
export const { providerAvailabilityReadSaga } = createProviderAvailabilitySaga({
  ...availability,
  selectPrincipalConnectionContext,
  selectHostRole,
  authLifetime: providerAuthStatusClient,
  readAvailability: async () => ({
    success: true,
    data: await providerStatusClient.readProviderStatus(
      providerStatusClient.getProviderAvailability,
    ),
  }),
  readSingleProvider: async (id) => ({
    success: true,
    data: await providerStatusClient.readProviderStatus(() =>
      providerStatusClient.checkSingleProvider(id),
    ),
  }),
});
