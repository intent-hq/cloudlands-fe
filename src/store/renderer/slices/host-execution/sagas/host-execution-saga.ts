// Svelte lifetime binding; retire with the Svelte renderer.
import { backendRequest } from '$lib/client/live/backend-transport';
import { invalidateProviderAuthStatus } from '$features/providers/provider-auth-status.client';
import { resetSettingsConnectionCache } from '$lib/client/live/live-settings-client';
import {
  selectHostRole,
  selectPrincipalConnectionContext,
} from '../../principal/principal-selectors';
import {
  selectHostExecutionReadContext,
  selectHostExecutionGeneration,
} from '../host-execution-selectors';
import { hydrateProviderCatalog } from '../../provider-catalog/sagas/provider-catalog-saga';
import { createHostExecutionSaga } from './host-execution-saga-factory';
export const hostExecutionSaga = createHostExecutionSaga({
  backendRequest,
  selectHostRole,
  selectPrincipalConnectionContext,
  selectHostExecutionReadContext,
  hostExecutionGenerationEffect: selectHostExecutionGeneration.effect,
  resetSettingsConnectionCache,
  invalidateProviderAuthStatus,
  hydrateProviderCatalog,
});
