import { describe, expect, it } from 'vitest';
import {
  closeImportModal,
  importProgressReceived,
  importRunCancelled,
  importRunFailed,
  importRunSucceeded,
  importStartRequested,
  initialState,
  workspaceImportReducer,
} from './workspace-import-slice';
import type { ImportProgress, WorkspaceImportState } from './workspace-import-types';

const progress: ImportProgress = {
  phase: 'uploading',
  bytesTotal: 100,
  bytesUp: 50,
  chunksTotal: 2,
  chunksDone: 1,
};

function running(): WorkspaceImportState {
  return workspaceImportReducer(initialState, importStartRequested({ reuseLastFile: false }));
}

describe('workspaceImportReducer', () => {
  it('has a closed initial state', () => {
    expect(initialState.open).toBe(false);
    expect(initialState.runStatus).toBe('idle');
  });

  it('start opens the wizard in running', () => {
    const state = running();
    expect(state.open).toBe(true);
    expect(state.step).toBe('importing');
    expect(state.runStatus).toBe('running');
  });

  it('start is ignored while a run is already in flight', () => {
    const state = running();
    const again = workspaceImportReducer(
      workspaceImportReducer(state, importProgressReceived(progress)),
      importStartRequested({ reuseLastFile: false }),
    );
    expect(again.progress).toEqual(progress);
  });

  it('retry from a failed result restarts the run', () => {
    let state = running();
    state = workspaceImportReducer(state, importRunFailed('version mismatch'));
    expect(state.step).toBe('result');
    expect(state.runStatus).toBe('failed');
    state = workspaceImportReducer(state, importStartRequested({ reuseLastFile: true }));
    expect(state.step).toBe('importing');
    expect(state.runStatus).toBe('running');
    expect(state.runError).toBeNull();
  });

  it('stores progress frames only while running', () => {
    const state = workspaceImportReducer(running(), importProgressReceived(progress));
    expect(state.progress).toEqual(progress);
    const closed = workspaceImportReducer(initialState, importProgressReceived(progress));
    expect(closed.progress).toBeNull();
  });

  it('success lands on the result screen with workspace + interrupted agents', () => {
    const state = workspaceImportReducer(
      running(),
      importRunSucceeded({
        workspaceId: 'ws-1',
        workspaceTitle: 'My Space',
        interruptedAgents: ['agent-9'],
      }),
    );
    expect(state.step).toBe('result');
    expect(state.runStatus).toBe('succeeded');
    expect(state.workspaceId).toBe('ws-1');
    expect(state.workspaceTitle).toBe('My Space');
    expect(state.interruptedAgents).toEqual(['agent-9']);
  });

  it('failure lands on the result screen with the daemon error verbatim', () => {
    const daemonError = 'archive was created by intentd 1.0.0 but this daemon is 1.2.3';
    const state = workspaceImportReducer(running(), importRunFailed(daemonError));
    expect(state.step).toBe('result');
    expect(state.runStatus).toBe('failed');
    expect(state.runError).toBe(daemonError);
  });

  it('a dismissed dialog (cancelled run) closes the wizard silently', () => {
    const state = workspaceImportReducer(running(), importRunCancelled());
    expect(state).toEqual(initialState);
  });

  it('close resets everything', () => {
    const state = workspaceImportReducer(
      workspaceImportReducer(running(), importRunFailed('x')),
      closeImportModal(),
    );
    expect(state).toEqual(initialState);
  });
});
