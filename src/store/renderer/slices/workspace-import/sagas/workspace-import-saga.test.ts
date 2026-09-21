import { afterEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), navigate: vi.fn() }));
vi.mock('$lib/utils/navigation.client', () => ({ navigateToRoute: mocks.navigate }));

import {
  closeImportModal,
  importOpenWorkspaceRequested,
  importRunSucceeded,
  importStartRequested,
  initialState,
  workspaceImportReducer,
} from '../workspace-import-slice';
import type { WorkspaceImportState } from '../workspace-import-types';
import { workspaceImportSaga } from './workspace-import-saga';
import { m } from '$shared/paraglide/messages.js';

const settle = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

function harness(seed: WorkspaceImportState = initialState) {
  const channel = stdChannel();
  let state = seed;
  const dispatch = vi.fn((action) => {
    state = workspaceImportReducer(state, action);
    channel.put(action);
  });
  const task = runSaga(
    { channel, dispatch, getState: () => ({ workspaceImport: state }) },
    workspaceImportSaga,
  );
  return { channel, dispatch, task, state: () => state };
}

describe('workspaceImportSaga', () => {
  afterEach(() => {
    mocks.invoke.mockReset();
    mocks.navigate.mockReset();
    vi.unstubAllGlobals();
  });

  function stubBridge() {
    vi.stubGlobal('window', {
      electronAPI: { invoke: mocks.invoke, on: vi.fn(() => 'listener-1'), offById: vi.fn() },
    });
  }

  it('invokes transfer:import-start and stores the success result', async () => {
    stubBridge();
    mocks.invoke.mockResolvedValue({
      success: true,
      workspaceId: 'ws-1',
      workspaceTitle: 'My Space',
      interruptedAgents: ['agent-9'],
    });
    const h = harness(
      workspaceImportReducer(initialState, importStartRequested({ reuseLastFile: false })),
    );

    h.channel.put(importStartRequested({ reuseLastFile: false }));
    await settle();

    expect(mocks.invoke).toHaveBeenCalledWith('transfer:import-start', { reuseLastFile: false });
    expect(h.state().step).toBe('result');
    expect(h.state().runStatus).toBe('succeeded');
    expect(h.state().workspaceId).toBe('ws-1');
    expect(h.state().workspaceTitle).toBe('My Space');
    expect(h.state().interruptedAgents).toEqual(['agent-9']);
    h.task.cancel();
  });

  it('does not launch a headless import when the reducer rejected the start', async () => {
    stubBridge();
    mocks.invoke.mockResolvedValue({ success: true });
    // Settled success screen: the reducer drops importStartRequested here.
    let seed = workspaceImportReducer(initialState, importStartRequested({ reuseLastFile: false }));
    seed = workspaceImportReducer(
      seed,
      importRunSucceeded({
        workspaceId: 'ws-1',
        workspaceTitle: 'My Space',
        interruptedAgents: [],
      }),
    );
    const h = harness(seed);

    h.channel.put(importStartRequested({ reuseLastFile: false }));
    await settle();

    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(h.state().step).toBe('result');
    expect(h.state().runStatus).toBe('succeeded');
    h.task.cancel();
  });

  it('surfaces a failed result with the daemon error verbatim', async () => {
    stubBridge();
    const daemonError = 'archive was created by intentd 1.0.0 but this daemon is 1.2.3';
    mocks.invoke.mockResolvedValue({ success: false, error: daemonError });
    const h = harness(
      workspaceImportReducer(initialState, importStartRequested({ reuseLastFile: false })),
    );

    h.channel.put(importStartRequested({ reuseLastFile: false }));
    await settle();

    expect(h.state().runStatus).toBe('failed');
    expect(h.state().runError).toBe(daemonError);
    h.task.cancel();
  });

  it('maps a not-session-owner rejection to the localized message', async () => {
    stubBridge();
    mocks.invoke.mockResolvedValue({
      success: false,
      error: 'the import session belongs to another window',
      code: 'not-session-owner',
    });
    const h = harness(
      workspaceImportReducer(initialState, importStartRequested({ reuseLastFile: false })),
    );

    h.channel.put(importStartRequested({ reuseLastFile: false }));
    await settle();

    expect(h.state().runStatus).toBe('failed');
    expect(h.state().runError).toBe(m.workspace_import_notSessionOwner_error());
    h.task.cancel();
  });

  it('a dismissed dialog closes the wizard silently', async () => {
    stubBridge();
    mocks.invoke.mockResolvedValue({ success: false, canceled: true });
    const h = harness(
      workspaceImportReducer(initialState, importStartRequested({ reuseLastFile: false })),
    );

    h.channel.put(importStartRequested({ reuseLastFile: false }));
    await settle();

    expect(h.state()).toEqual(initialState);
    h.task.cancel();
  });

  it('close fires a best-effort transfer:import-cancel', async () => {
    stubBridge();
    mocks.invoke.mockResolvedValue({ success: true });
    const h = harness();

    h.channel.put(closeImportModal());
    await settle();

    expect(mocks.invoke).toHaveBeenCalledWith('transfer:import-cancel', undefined);
    h.task.cancel();
  });

  it('open-workspace navigates to the imported workspace and closes', async () => {
    stubBridge();
    mocks.navigate.mockResolvedValue(undefined);
    let seed = workspaceImportReducer(initialState, importStartRequested({ reuseLastFile: false }));
    seed = workspaceImportReducer(
      seed,
      importRunSucceeded({
        workspaceId: 'ws-1',
        workspaceTitle: 'My Space',
        interruptedAgents: [],
      }),
    );
    const h = harness(seed);

    h.channel.put(importOpenWorkspaceRequested());
    await settle();

    expect(mocks.navigate).toHaveBeenCalledWith('/workspace/ws-1');
    expect(h.state().open).toBe(false);
    h.task.cancel();
  });
});
