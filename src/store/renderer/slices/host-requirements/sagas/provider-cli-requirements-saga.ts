import { call, put, takeLeading } from 'typed-redux-saga';
import { backendRequest } from '$lib/client/live/backend-transport';
import {
  providerCliWarnings,
  type ProviderCliDiscovery,
} from '$features/providers/utils/provider-cli-warnings';
import { selectHostAdministrationContext } from '../../principal/principal-selectors';
import { selectDaemonHealth } from '../../daemon-health/daemon-health-selectors';
import {
  checkProviderCliRequirementsRequested,
  providerCliRequirementsResolved,
} from '../host-requirements-slice';

function* checkProviderCliRequirements() {
  const context = yield* selectHostAdministrationContext.effect();
  if (!context || (yield* selectDaemonHealth.effect()) !== 'healthy') return;
  try {
    const result = yield* call(
      backendRequest<{ providers: ProviderCliDiscovery[] }>,
      'host.providerDiscovery',
      {},
    );
    if (
      context !== (yield* selectHostAdministrationContext.effect()) ||
      (yield* selectDaemonHealth.effect()) !== 'healthy'
    )
      return;
    yield* put(providerCliRequirementsResolved(context, providerCliWarnings(result.providers)));
  } catch {
    // Discovery is advisory. Transport failure is not an outdated CLI.
  }
}

/** Cancelled with the existing owner-services lifetime on connection/authority changes. */
export function* providerCliRequirementsSaga() {
  yield* takeLeading(checkProviderCliRequirementsRequested, checkProviderCliRequirements);
}
