import { initialState as connections } from '../../store/renderer/slices/connections/connections-slice';
import { initialState as daemonHealth } from '../../store/renderer/slices/daemon-health/daemon-health-slice';
import { initialState as workspaceEvents } from '../../store/renderer/slices/workspace-events/workspace-events-slice';
import { getPrincipalConnectionContext } from '../../store/renderer/slices/principal/principal-context';
import {
  initialState,
  principalContextChanged,
  principalReceived,
  principalReducer,
} from '../../store/renderer/slices/principal/principal-slice';

// Match the readonly domain keys of the canonical source reducer map without
// importing a framework-bound Store type into this shared fixture.
type LegacyPrincipalState = {
  readonly connections: typeof connections;
  readonly daemonHealth: typeof daemonHealth;
  readonly workspaceEvents: typeof workspaceEvents;
  readonly principal: typeof initialState;
};

type LegacyPrincipalBase = {
  connections?: Omit<Partial<LegacyPrincipalState['connections']>, 'hasReceivedList'> & {
    hasReceivedList?: never;
  };
  daemonHealth?: Omit<Partial<LegacyPrincipalState['daemonHealth']>, 'health'> & { health?: never };
  workspaceEvents?: Omit<
    Partial<LegacyPrincipalState['workspaceEvents']>,
    'subscriptionPending'
  > & {
    subscriptionPending?: never;
  };
  principal?: never;
  context?: never;
};

/** Store-independent construction: admission and the reducer snapshot share one context. */
export function createAdmittedLegacyPrincipal(
  base: LegacyPrincipalBase = {},
  role: 'owner' | 'guest' = 'owner',
): LegacyPrincipalState {
  const bound = {
    connections: { ...connections, ...base.connections, hasReceivedList: true },
    daemonHealth: { ...daemonHealth, ...base.daemonHealth, health: 'healthy' as const },
    workspaceEvents: {
      ...workspaceEvents,
      ...base.workspaceEvents,
      subscriptionPending: false,
      subscriptionGeneration: base.workspaceEvents?.subscriptionGeneration || 1,
    },
  };
  const context = getPrincipalConnectionContext(bound);
  const principal = principalReducer(initialState, principalContextChanged(context));
  return {
    ...bound,
    // An explicit auth refusal remains a negative fixture, never admitted authority.
    principal:
      context === null
        ? principal
        : principalReducer(
            principal,
            principalReceived(
              { context, invalidation: 0, presentationVersion: 0 },
              {
                principal: {
                  id: 'principal',
                  login: null,
                  displayName: null,
                  avatarUrl: null,
                  isAdministrator: role === 'owner',
                },
                capabilities: {
                  hostMembership: false,
                  personalPairing: false,
                  authenticatedDevices: false,
                  collaborationIdentity: false,
                },
              },
            ),
          ),
  };
}
