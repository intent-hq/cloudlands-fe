import { store } from '$store/renderer/store';
import type { HostExecutionContext } from '$shared/types/host-execution';
import type { HostRole } from '$shared/types/principal';
import { admitLegacyPrincipal } from './principal-state';
import { principalReceived } from '$store/renderer/slices/principal/principal-slice';
import {
  hostExecutionConnectionChanged,
  hostExecutionReceived,
} from '$store/renderer/slices/host-execution/host-execution-slice';

/** Controlled renderer fixture only: no live authentication or host configuration. */
export function admitHostExecutionFixture(role: HostRole, execution: HostExecutionContext): void {
  admitLegacyPrincipal();
  const { principal } = store.state;
  const context = principal.context!;
  store.dispatch(
    principalReceived(
      {
        context,
        invalidation: principal.invalidation,
        presentationVersion: principal.presentationVersion,
      },
      {
        principal: {
          ...principal.snapshot!.principal,
          isAdministrator: role === 'owner',
          hostRole: role,
          hostMembershipRevision: 1,
        },
        capabilities: { ...principal.snapshot!.capabilities, hostMembership: true },
      },
    ),
  );
  store.dispatch(hostExecutionConnectionChanged(context));
  store.dispatch(hostExecutionReceived(context, store.state.hostExecution.generation, execution));
}

export const HOST_EXECUTION_FIXTURE: HostExecutionContext = {
  defaultProviderId: 'claude-code',
  defaultModelId: 'host-sonnet',
  enabledProviderIds: ['claude-code', 'codex'],
  repositoryConnections: [],
  gitCredentialPolicy: {
    provider: 'github',
    host: 'github.com',
    protocol: 'https',
    managedHelperEnabled: false,
    setting: 'sourceControl.github.exposeGitCredentialToChildren',
  },
};
