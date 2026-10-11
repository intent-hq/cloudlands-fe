import { backendRequest } from '@/features/backend/backend-transport';
import { invalidateProviderAuthStatus } from '@/features/providers/provider-read-clients';
import { settingsRuntime } from '@/features/settings/settings-client';
import { hydrateProviderCatalog } from '../../provider-catalog/sagas/provider-catalog-saga';
import {
  selectHostRole,
  selectPrincipalConnectionContext,
} from '../../principal/principal-selectors';
import {
  selectHostExecutionReadContext,
  selectHostExecutionGeneration,
} from '../host-execution-selectors';
import { createHostExecutionSaga } from '../../../../../../src/store/renderer/slices/host-execution/sagas/host-execution-saga-factory';
export const hostExecutionSaga = createHostExecutionSaga({
  backendRequest,
  invalidateProviderAuthStatus,
  hydrateProviderCatalog,
  resetSettingsConnectionCache: settingsRuntime.resetSettingsConnectionCache,
  selectHostRole,
  selectPrincipalConnectionContext,
  selectHostExecutionReadContext,
  hostExecutionGenerationEffect: selectHostExecutionGeneration.effect,
});
