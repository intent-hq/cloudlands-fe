import { describe, expect, expectTypeOf, it } from 'vitest';
import type { StoreState } from '$store/renderer/types';
import { createAdmittedLegacyPrincipal } from './admitted-legacy-principal';
import {
  selectCanAdministerHost,
  selectHostRole,
  selectPrincipalSnapshot,
} from '$store/renderer/slices/principal/principal-selectors';
import { withLegacyPrincipal } from './principal-state';

describe('legacy principal fixture admission', () => {
  it.each(['owner', 'guest'] as const)('admits %s on a non-default connection', (role) => {
    const state = withLegacyPrincipal(
      {
        connections: { windowBackendId: 'remote-host' },
        daemonHealth: { connectionGeneration: 7 },
        workspaceEvents: { subscriptionGeneration: 4 },
      },
      role,
    );
    expect(selectHostRole.select(state)).toBe(role);
    expect(selectCanAdministerHost.select(state)).toBe(role === 'owner');
    expect(selectPrincipalSnapshot.select(state)).not.toBeNull();
    expect(
      selectPrincipalSnapshot.select({
        ...state,
        daemonHealth: { ...state.daemonHealth, connectionGeneration: 8 },
      }),
    ).toBeNull();
    expect(
      selectPrincipalSnapshot.select({
        ...state,
        workspaceEvents: { ...state.workspaceEvents, subscriptionGeneration: 5 },
      }),
    ).toBeNull();
  });

  it.each([
    [
      'list not received',
      (state: StoreState) => ({
        ...state,
        connections: { ...state.connections, hasReceivedList: false },
      }),
    ],
    [
      'connection down',
      (state: StoreState) => ({
        ...state,
        daemonHealth: { ...state.daemonHealth, health: 'down' as const },
      }),
    ],
    [
      'not subscribed',
      (state: StoreState) => ({
        ...state,
        workspaceEvents: { ...state.workspaceEvents, subscriptionGeneration: 0 },
      }),
    ],
    [
      'subscription pending',
      (state: StoreState) => ({
        ...state,
        workspaceEvents: { ...state.workspaceEvents, subscriptionPending: true },
      }),
    ],
    [
      'backend replaced',
      (state: StoreState) => ({
        ...state,
        connections: { ...state.connections, windowBackendId: 'replacement' },
      }),
    ],
  ] as const)('withholds an admitted snapshot when %s', (_name, change) => {
    const state = withLegacyPrincipal({});
    expect(selectCanAdministerHost.select(state)).toBe(true);
    expect(selectPrincipalSnapshot.select(change(state))).toBeNull();
    expect(selectCanAdministerHost.select(change(state))).toBe(false);
  });

  it('keeps explicit refused fixtures without authority', () => {
    const refused = withLegacyPrincipal({
      connections: { authRejected: { id: 'local', statusCode: 401 } },
    });
    expect(selectHostRole.select(refused)).toBeNull();
  });

  it('rejects caller-owned authority and admission flags at the constructor boundary', () => {
    type Base = NonNullable<Parameters<typeof createAdmittedLegacyPrincipal>[0]>;
    expectTypeOf({ principal: withLegacyPrincipal({}).principal }).not.toMatchTypeOf<Base>();
    expectTypeOf({ context: 'serialized-context' }).not.toMatchTypeOf<Base>();
    expectTypeOf({ connections: { hasReceivedList: true } }).not.toMatchTypeOf<Base>();
    expectTypeOf({ daemonHealth: { health: 'healthy' as const } }).not.toMatchTypeOf<Base>();
    expectTypeOf({ workspaceEvents: { subscriptionPending: false } }).not.toMatchTypeOf<Base>();
  });
});
