import { describe, expect, it } from 'vitest';
import { request, permission } from '$features/desktop/renderer/desktop-test-fixtures';
import { connectionStatusChanged } from '../daemon-health/daemon-health-slice';
import {
  desktopControlReducer as reduce,
  desktopEventReceived as event,
  desktopSnapshotReceived as snapshot,
  desktopEntryPatched as patch,
} from './desktop-control-slice';
import { desktopKey, type DesktopControlState } from './desktop-control-types';
const key = desktopKey('workspace', 'agent');
const requested = event({
  id: 'request-event',
  type: 'desktop:permission-requested',
  data: request,
});
const active = (id = 'session') =>
  event({
    id: `active-${id}`,
    type: 'desktop:session-changed',
    data: {
      workspaceId: 'workspace',
      agentId: 'agent',
      sessionId: id,
      computerId: 'computer',
      computerName: permission.computerName,
      status: 'active',
    },
  });
const ended = (id = 'session') =>
  event({
    id: `ended-${id}`,
    type: 'desktop:session-changed',
    data: {
      workspaceId: 'workspace',
      agentId: 'agent',
      sessionId: id,
      computerId: 'computer',
      computerName: permission.computerName,
      status: 'ended',
      reason: 'user_stop',
    },
  });
const entry = (state: DesktopControlState) => state.byKey[key];
describe('desktop permission mirror', () => {
  it('deduplicates requests and preserves a submitted decision', () => {
    let state = reduce(undefined, requested);
    state = reduce(state, patch('workspace', 'agent', 0, { submitting: true }));
    expect(reduce(state, requested)).toBe(state);
    state = reduce(state, event({ ...requested.payload[0], id: 'repeat' }));
    expect(entry(state).submitting).toBe(true);
  });
  it.each(['denied', 'expired', 'withdrawn', 'invalidated', 'failed'] as const)(
    'removes %s requests and rejects stale prompts',
    (outcome) => {
      let state = reduce(undefined, requested);
      state = reduce(
        state,
        event({
          id: 'resolved',
          type: 'desktop:permission-resolved',
          data: {
            workspaceId: 'workspace',
            agentId: 'agent',
            requestId: 'request',
            outcome,
            state: { status: 'inactive' },
          },
        }),
      );
      state = reduce(state, event({ ...requested.payload[0], id: 'replayed' }));
      expect(entry(state).pending).toBeUndefined();
      expect(entry(state).state.status).toBe('inactive');
    },
  );
  it('keeps remembered permission separate from active control and Stop', () => {
    let state = reduce(
      undefined,
      snapshot('workspace', 'agent', 0, 0, {
        state: { status: 'inactive' },
        permission: { ...permission, allowed: true },
      }),
    );
    expect(entry(state).state.status).toBe('inactive');
    state = reduce(state, active());
    state = reduce(state, ended());
    expect(entry(state).permission?.allowed).toBe(true);
    expect(entry(state).state.status).toBe('inactive');
    state = reduce(state, active('next'));
    state = reduce(
      state,
      event({
        id: 'disable',
        type: 'desktop:permission-changed',
        data: { workspaceId: 'workspace', agentId: 'agent', permission },
      }),
    );
    expect(entry(state).state).toMatchObject({ status: 'active', sessionId: 'next' });
    expect(entry(state).permission?.allowed).toBe(false);
  });
  it('does not stop a successor or resurrect an ended session from replay', () => {
    let state = reduce(undefined, active());
    state = reduce(state, ended());
    state = reduce(state, active('next'));
    state = reduce(state, event({ ...ended().payload[0], id: 'late-stop-report' }));
    state = reduce(state, event({ ...active().payload[0], id: 'late-active' }));
    expect(entry(state).state).toMatchObject({ status: 'active', sessionId: 'next' });
  });
  it('rejects snapshot replies predating events and disconnects', () => {
    let state = reduce(undefined, requested);
    state = reduce(
      state,
      snapshot('workspace', 'agent', 0, 0, { state: { status: 'inactive' }, permission }),
    );
    expect(entry(state).pending?.requestId).toBe('request');
    state = reduce(state, connectionStatusChanged('disconnected'));
    state = reduce(
      state,
      snapshot('workspace', 'agent', 0, 0, {
        state: {
          status: 'pending_permission',
          requestId: 'request',
          computerName: permission.computerName,
        },
        permission,
        pending: request,
      }),
    );
    expect(entry(state).pending).toBeUndefined();
    expect(entry(state).permission).toBeUndefined();
  });
  it('does not resurrect a stopped session when its grant outcome arrives late', () => {
    let state = reduce(undefined, requested);
    state = reduce(state, active());
    state = reduce(state, ended());
    state = reduce(
      state,
      event({
        id: 'late-grant',
        type: 'desktop:permission-resolved',
        data: {
          workspaceId: 'workspace',
          agentId: 'agent',
          requestId: 'request',
          outcome: 'granted',
          state: {
            status: 'active',
            sessionId: 'session',
            computerName: permission.computerName,
            hint: 'Release when finished',
          },
        },
      }),
    );
    expect(entry(state).state.status).toBe('inactive');
    expect(entry(state).pending).toBeUndefined();
  });
});
