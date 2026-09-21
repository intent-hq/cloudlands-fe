import { describe, expect, it } from 'vitest';
import {
  beginWorkspaceCreateProgress,
  clearWorkspaceCreateProgress,
  initialState,
  workspaceCreateProgressDone,
  workspaceCreateProgressReceived,
  workspaceCreateProgressReducer,
} from './workspace-create-progress-slice';

const PID = '11111111-1111-4111-8111-111111111111';

describe('workspaceCreateProgressReducer', () => {
  it('returns initial state', () => {
    expect(workspaceCreateProgressReducer(undefined, { type: '@@INIT' })).toEqual(initialState);
  });

  it('begin registers a starting entry for the progressId', () => {
    const state = workspaceCreateProgressReducer(initialState, beginWorkspaceCreateProgress(PID));
    expect(state.byProgressId[PID]).toEqual({
      phase: 'starting',
      percent: 0,
      sawFrame: false,
      done: false,
    });
  });

  it('progressReceived folds phase/percent/message into a registered entry', () => {
    let state = workspaceCreateProgressReducer(initialState, beginWorkspaceCreateProgress(PID));
    state = workspaceCreateProgressReducer(
      state,
      workspaceCreateProgressReceived(PID, {
        phase: 'receiving',
        percent: 45,
        message: 'Receiving objects: 45%',
      }),
    );
    expect(state.byProgressId[PID]).toEqual({
      phase: 'receiving',
      percent: 45,
      message: 'Receiving objects: 45%',
      sawFrame: true,
      done: false,
    });
  });

  it('progressReceived ignores unregistered progressIds (no create in flight)', () => {
    const state = workspaceCreateProgressReducer(
      initialState,
      workspaceCreateProgressReceived('unknown-pid', { phase: 'receiving', percent: 10 }),
    );
    expect(state).toBe(initialState);
  });

  it('progressReceived ignores frames after the terminal done frame', () => {
    let state = workspaceCreateProgressReducer(initialState, beginWorkspaceCreateProgress(PID));
    state = workspaceCreateProgressReducer(state, workspaceCreateProgressDone(PID, { ok: true }));
    const after = workspaceCreateProgressReducer(
      state,
      workspaceCreateProgressReceived(PID, { phase: 'receiving', percent: 99 }),
    );
    expect(after).toBe(state);
  });

  it('done marks the entry terminal with ok', () => {
    let state = workspaceCreateProgressReducer(initialState, beginWorkspaceCreateProgress(PID));
    state = workspaceCreateProgressReducer(
      state,
      workspaceCreateProgressReceived(PID, { phase: 'checkout', percent: 90 }),
    );
    state = workspaceCreateProgressReducer(state, workspaceCreateProgressDone(PID, { ok: true }));
    expect(state.byProgressId[PID]).toMatchObject({
      phase: 'checkout',
      percent: 90,
      sawFrame: true,
      done: true,
      ok: true,
    });
  });

  it('done carries error + errorCode on failure', () => {
    let state = workspaceCreateProgressReducer(initialState, beginWorkspaceCreateProgress(PID));
    state = workspaceCreateProgressReducer(
      state,
      workspaceCreateProgressDone(PID, {
        ok: false,
        error: 'fatal: could not read Username',
        errorCode: 'auth-required',
      }),
    );
    expect(state.byProgressId[PID]).toMatchObject({
      sawFrame: true,
      done: true,
      ok: false,
      error: 'fatal: could not read Username',
      errorCode: 'auth-required',
    });
  });

  it('done ignores unregistered progressIds', () => {
    const state = workspaceCreateProgressReducer(
      initialState,
      workspaceCreateProgressDone('unknown-pid', { ok: true }),
    );
    expect(state).toBe(initialState);
  });

  it('clear drops the entry and is a no-op for unknown ids', () => {
    let state = workspaceCreateProgressReducer(initialState, beginWorkspaceCreateProgress(PID));
    state = workspaceCreateProgressReducer(state, clearWorkspaceCreateProgress(PID));
    expect(state.byProgressId[PID]).toBeUndefined();
    expect(workspaceCreateProgressReducer(state, clearWorkspaceCreateProgress('nope'))).toBe(state);
  });

  it('keys concurrent creates independently (no cross-talk)', () => {
    const other = '22222222-2222-4222-8222-222222222222';
    let state = workspaceCreateProgressReducer(initialState, beginWorkspaceCreateProgress(PID));
    state = workspaceCreateProgressReducer(state, beginWorkspaceCreateProgress(other));
    state = workspaceCreateProgressReducer(
      state,
      workspaceCreateProgressReceived(PID, { phase: 'receiving', percent: 45 }),
    );
    expect(state.byProgressId[PID]?.percent).toBe(45);
    expect(state.byProgressId[other]).toEqual({
      phase: 'starting',
      percent: 0,
      sawFrame: false,
      done: false,
    });
  });
});
