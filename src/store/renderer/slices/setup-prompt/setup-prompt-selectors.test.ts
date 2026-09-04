/**
 * Setup Prompt Selectors Tests
 */

import { describe, it, expect } from 'vitest';
import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import { LOCAL_CONNECTION_ID } from '$shared/types/connections';
import type { StoreState } from '../../types';
import type { ConnectionRecord } from '../connections/connections-types';
import { initialState as connectionsInitialState } from '../connections/connections-slice';
import { initialState as setupPromptInitialState } from './setup-prompt-slice';
import type { SetupPromptState } from './setup-prompt-types';
import {
  selectActiveSetupEvaluation,
  selectBackendSetupGate,
  selectShowRemoteSetupPrompt,
  selectSetupEvaluation,
} from './setup-prompt-selectors';

const LOCAL: ConnectionRecord = {
  id: LOCAL_CONNECTION_ID,
  label: 'This machine (local)',
  host: null,
  port: null,
  fingerprint: null,
  isLocal: true,
};

const REMOTE: ConnectionRecord = {
  id: 'remote-1',
  label: 'Studio Mac',
  host: '10.0.0.5',
  port: 8443,
  fingerprint: 'AB:CD',
  isLocal: false,
};

function stateWith(opts: {
  windowBackendId?: string;
  activeId?: string;
  setupPrompt?: Partial<SetupPromptState>;
  workspaceIds?: string[];
  workspaceHasLoaded?: boolean;
  providerStatusMap?: Record<string, { available: boolean; authenticated?: boolean }>;
}): StoreState {
  const workspaceIds = opts.workspaceIds ?? [];
  return {
    connections: {
      ...connectionsInitialState,
      connections: createCollection<ConnectionRecord, 'id'>('id', [LOCAL, REMOTE]),
      activeId: opts.activeId ?? opts.windowBackendId ?? LOCAL_CONNECTION_ID,
      windowBackendId: opts.windowBackendId ?? LOCAL_CONNECTION_ID,
    },
    setupPrompt: { ...setupPromptInitialState, ...opts.setupPrompt },
    workspace: {
      hasLoaded: opts.workspaceHasLoaded ?? true,
      workspaces: createCollection<{ id: string }, 'id'>(
        'id',
        workspaceIds.map((id) => ({ id })),
      ),
    },
    agentAvailability: {
      providerStatusMap: opts.providerStatusMap ?? {},
    },
  } as unknown as StoreState;
}

describe('selectSetupEvaluation / selectActiveSetupEvaluation', () => {
  it('returns null before the first evaluation', () => {
    const state = stateWith({});
    expect(selectSetupEvaluation.select(state)).toBeNull();
    expect(selectActiveSetupEvaluation.select(state)).toBeNull();
  });

  it('gates the evaluation on this window backend id', () => {
    const evaluation = { connectionId: 'remote-1', isLocal: false, setupNeeded: true };
    const active = stateWith({ windowBackendId: 'remote-1', setupPrompt: { evaluation } });
    expect(selectActiveSetupEvaluation.select(active)).toEqual(evaluation);

    const stale = stateWith({ windowBackendId: LOCAL_CONNECTION_ID, setupPrompt: { evaluation } });
    expect(selectActiveSetupEvaluation.select(stale)).toBeNull();
  });

  it('matches on windowBackendId even when the persisted activeId differs', () => {
    // Boot-restored remote windows keep the persisted activeId untouched, so
    // the two ids routinely diverge; the window's own evaluation must win.
    const evaluation = { connectionId: 'remote-1', isLocal: false, setupNeeded: true };
    const state = stateWith({
      windowBackendId: 'remote-1',
      activeId: LOCAL_CONNECTION_ID,
      setupPrompt: { evaluation },
    });
    expect(selectActiveSetupEvaluation.select(state)).toEqual(evaluation);
  });
});

describe('selectShowRemoteSetupPrompt', () => {
  const remoteNeedsSetup = { connectionId: 'remote-1', isLocal: false, setupNeeded: true };

  it('shows for a remote backend that needs setup', () => {
    const state = stateWith({
      windowBackendId: 'remote-1',
      setupPrompt: { evaluation: remoteNeedsSetup },
    });
    expect(selectShowRemoteSetupPrompt.select(state)).toBe(true);
  });

  it('never shows for the local backend', () => {
    const evaluation = { connectionId: LOCAL_CONNECTION_ID, isLocal: true, setupNeeded: true };
    const state = stateWith({ setupPrompt: { evaluation } });
    expect(selectShowRemoteSetupPrompt.select(state)).toBe(false);
  });

  it('does not show when setup is not needed', () => {
    const evaluation = { ...remoteNeedsSetup, setupNeeded: false };
    const state = stateWith({ windowBackendId: 'remote-1', setupPrompt: { evaluation } });
    expect(selectShowRemoteSetupPrompt.select(state)).toBe(false);
  });

  it('respects session dismissal per connection', () => {
    const state = stateWith({
      windowBackendId: 'remote-1',
      setupPrompt: { evaluation: remoteNeedsSetup, dismissedConnectionIds: ['remote-1'] },
    });
    expect(selectShowRemoteSetupPrompt.select(state)).toBe(false);
  });
});

describe('selectBackendSetupGate', () => {
  it.each([undefined, false, true])(
    'does not bypass setup with Antigravity auth=%s',
    (authenticated) => {
      const state = stateWith({
        providerStatusMap: { antigravity: { available: true, authenticated } },
      });
      expect(selectBackendSetupGate.select(state)).toBe(
        authenticated === true ? 'none' : 'pending',
      );
    },
  );
  it("returns 'none' when the backend has workspaces", () => {
    const state = stateWith({ workspaceIds: ['ws-1'] });
    expect(selectBackendSetupGate.select(state)).toBe('none');
  });

  it("returns 'pending' while the evaluation has not resolved", () => {
    expect(selectBackendSetupGate.select(stateWith({}))).toBe('pending');
    expect(selectBackendSetupGate.select(stateWith({ workspaceHasLoaded: false }))).toBe('pending');
  });

  it("returns 'redirect' when the local backend needs setup", () => {
    const evaluation = { connectionId: LOCAL_CONNECTION_ID, isLocal: true, setupNeeded: true };
    const state = stateWith({ setupPrompt: { evaluation } });
    expect(selectBackendSetupGate.select(state)).toBe('redirect');
  });

  it("returns 'redirect' when a remote backend needs setup", () => {
    const evaluation = { connectionId: 'remote-1', isLocal: false, setupNeeded: true };
    const state = stateWith({ windowBackendId: 'remote-1', setupPrompt: { evaluation } });
    expect(selectBackendSetupGate.select(state)).toBe('redirect');
  });

  it("returns 'pending' on a remote backend while its evaluation has not resolved", () => {
    const state = stateWith({ windowBackendId: 'remote-1' });
    expect(selectBackendSetupGate.select(state)).toBe('pending');
  });

  it('ignores a stale evaluation from a previous backend after a switch', () => {
    const evaluation = { connectionId: LOCAL_CONNECTION_ID, isLocal: true, setupNeeded: true };
    const state = stateWith({ windowBackendId: 'remote-1', setupPrompt: { evaluation } });
    expect(selectBackendSetupGate.select(state)).toBe('pending');
  });

  it('gates on the window backend, not the persisted activeId, in a divergent window', () => {
    const evaluation = { connectionId: 'remote-1', isLocal: false, setupNeeded: true };
    const state = stateWith({
      windowBackendId: 'remote-1',
      activeId: LOCAL_CONNECTION_ID,
      setupPrompt: { evaluation },
    });
    expect(selectBackendSetupGate.select(state)).toBe('redirect');
  });

  it("returns 'none' when the backend does not need setup", () => {
    const evaluation = { connectionId: LOCAL_CONNECTION_ID, isLocal: true, setupNeeded: false };
    const state = stateWith({ setupPrompt: { evaluation } });
    expect(selectBackendSetupGate.select(state)).toBe('none');
  });

  it('ignores the chief workspace when counting workspaces (matches the saga)', () => {
    const state = stateWith({ workspaceIds: [CHIEF_WORKSPACE_ID] });
    expect(selectBackendSetupGate.select(state)).toBe('pending');
  });

  it("resolves 'none' as soon as a ready provider is known, without an evaluation", () => {
    const state = stateWith({ providerStatusMap: { auggie: { available: true } } });
    expect(selectBackendSetupGate.select(state)).toBe('none');

    const notReady = stateWith({
      providerStatusMap: { auggie: { available: true, authenticated: false } },
    });
    expect(selectBackendSetupGate.select(notReady)).toBe('pending');
  });
});
