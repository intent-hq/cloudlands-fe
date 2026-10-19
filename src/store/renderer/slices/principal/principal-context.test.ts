import { describe, expect, it } from 'vitest';
import { withHostPrincipal, withLegacyPrincipal } from '../../../../test/fixtures/principal-state';
import { getPrincipalActionContext } from './principal-context';
import { selectPrincipalActionContext } from './principal-selectors';

function admitted() {
  return withHostPrincipal({
    connections: { windowBackendId: 'host', activeId: 'host' },
    daemonHealth: { connectionGeneration: 7 },
    workspaceEvents: { subscriptionGeneration: 3 },
  });
}
type State = ReturnType<typeof admitted>;

function expectContext(state: State, expected: string | null) {
  expect(getPrincipalActionContext(state)).toBe(expected);
  expect(selectPrincipalActionContext.select(state)).toBe(expected);
}

describe('principal action context without renderer selector dependencies', () => {
  it.each(['owner', 'member', 'guest'] as const)('keeps the exact host %s identity', (role) => {
    const state = withHostPrincipal(admitted(), role);
    expectContext(state, JSON.stringify(['["host",7,3]', 'principal', 1, role, 0, 0]));
  });

  it.each(['owner', 'guest'] as const)('keeps the exact legacy %s identity', (role) => {
    const state = withLegacyPrincipal(admitted(), role);
    expectContext(state, JSON.stringify(['["host",7,3]', 'principal', null, role, 0, 0]));
  });

  it.each([
    [
      'loading',
      (s: State) => {
        s.principal.status = 'loading';
      },
    ],
    [
      'revoked',
      (s: State) => {
        s.principal.status = 'revoked';
      },
    ],
    [
      'missing snapshot',
      (s: State) => {
        s.principal.snapshot = null;
      },
    ],
    [
      'missing binding',
      (s: State) => {
        s.principal.context = null;
      },
    ],
    [
      'unknown backend',
      (s: State) => {
        s.connections.hasReceivedList = false;
      },
    ],
    [
      'backend replacement',
      (s: State) => {
        s.connections.windowBackendId = 'other';
      },
    ],
    [
      'reconnect',
      (s: State) => {
        s.daemonHealth.connectionGeneration++;
      },
    ],
    [
      'new subscription',
      (s: State) => {
        s.workspaceEvents.subscriptionGeneration++;
      },
    ],
    [
      'pending subscription',
      (s: State) => {
        s.workspaceEvents.subscriptionPending = true;
      },
    ],
    [
      'disconnection',
      (s: State) => {
        s.daemonHealth.health = 'down';
      },
    ],
  ] as const)('does not admit %s', (_name, change) => {
    const state = admitted();
    change(state);
    expectContext(state, null);
  });

  it.each([
    [
      'principal replacement',
      (s: State) => {
        s.principal.snapshot!.principal.id = 'another';
      },
    ],
    [
      'membership revision',
      (s: State) => {
        s.principal.snapshot!.principal.hostMembershipRevision = 2;
      },
    ],
    [
      'role change',
      (s: State) => {
        s.principal.snapshot!.principal.hostRole = 'guest';
      },
    ],
    [
      'invalidation',
      (s: State) => {
        s.principal.invalidation++;
      },
    ],
    [
      'presentation',
      (s: State) => {
        s.principal.presentationVersion++;
      },
    ],
  ] as const)('changes the shared read identity on %s', (_name, change) => {
    const state = admitted();
    const before = getPrincipalActionContext(state);
    change(state);
    const after = getPrincipalActionContext(state);
    expect(after).not.toBeNull();
    expect(after).not.toBe(before);
    expect(selectPrincipalActionContext.select(state)).toBe(after);
  });
});
