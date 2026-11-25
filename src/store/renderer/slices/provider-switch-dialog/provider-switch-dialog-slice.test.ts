import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import { describe, expect, it } from 'vitest';

import {
  providerSwitchAgentSettled,
  providerSwitchDialogClosed,
  providerSwitchDialogOpened,
  providerSwitchDialogReducer as reduce,
  providerSwitchRowsLoaded,
  providerSwitchRunFinished,
  providerSwitchRunStarted,
  providerSwitchTargetChosen,
} from './provider-switch-dialog-slice';
import type { ProviderSwitchDialogRow } from './provider-switch-dialog-types';

const initial = reduce(undefined, { type: '@@test/init' });

const row = (key: string, agentIds: string[]): ProviderSwitchDialogRow => ({
  key,
  providerRef: 'claude-code',
  model: key,
  label: key,
  agents: agentIds.map((agentId) => ({ agentId, name: agentId, eligibleProviderIds: ['codex'] })),
  workerCount: 0,
  targets: [],
  selection: { providerId: 'codex', modelId: 'sol' },
});

function loaded() {
  let state = reduce(
    initial,
    providerSwitchDialogOpened({
      groupKey: 'quota:claude-code',
      kind: 'quota',
      providerLabel: 'Claude Code',
    }),
  );
  state = reduce(
    state,
    providerSwitchRowsLoaded('quota:claude-code', [row('opus', ['a', 'b']), row('fable', ['c'])]),
  );
  return state;
}

describe('providerSwitchDialog reducer', () => {
  it('starts closed and empty', () => {
    expect(initial.open).toBe(false);
    expect(getItems(initial.rows)).toEqual([]);
  });

  it('opens loading, then takes rows only for the open group', () => {
    const opened = reduce(
      initial,
      providerSwitchDialogOpened({
        groupKey: 'quota:claude-code',
        kind: 'quota',
        providerLabel: 'Claude Code',
      }),
    );
    expect(opened).toMatchObject({ open: true, loading: true, groupKey: 'quota:claude-code' });
    expect(reduce(opened, providerSwitchRowsLoaded('auth:codex', [row('x', ['a'])]))).toBe(opened);
    const state = loaded();
    expect(state.loading).toBe(false);
    expect(getItems(state.rows).map((r) => r.key)).toEqual(['opus', 'fable']);
  });

  it('changes a row target only before a run', () => {
    const target = { providerId: 'gemini', modelId: 'pro' };
    const chosen = reduce(loaded(), providerSwitchTargetChosen('fable', target));
    expect(getItems(chosen.rows)[1].selection).toEqual(target);
    const running = reduce(loaded(), providerSwitchRunStarted(3));
    expect(reduce(running, providerSwitchTargetChosen('fable', target))).toBe(running);
  });

  it('records each settled agent with progress and switched workers', () => {
    let state = reduce(loaded(), providerSwitchRunStarted(3));
    state = reduce(
      state,
      providerSwitchAgentSettled({ agentId: 'b', status: 'switched', workersSwitched: 2 }),
    );
    state = reduce(
      state,
      providerSwitchAgentSettled({
        agentId: 'c',
        status: 'failed',
        reason: 'rejected',
        workersSwitched: 0,
      }),
    );
    const [opus, fable] = getItems(state.rows);
    expect(state.progress).toEqual({ done: 2, total: 3 });
    expect(opus.workersSwitched).toBe(2);
    expect(opus.agents.map((a) => a.outcome)).toEqual([undefined, { status: 'switched' }]);
    expect(fable.agents[0].outcome).toEqual({ status: 'failed', reason: 'rejected' });
  });

  it('cannot be closed or reopened while a run is active', () => {
    const running = reduce(loaded(), providerSwitchRunStarted(3));
    expect(reduce(running, providerSwitchDialogClosed())).toBe(running);
    expect(
      reduce(
        running,
        providerSwitchDialogOpened({
          groupKey: 'auth:codex',
          kind: 'auth',
          providerLabel: 'Codex',
        }),
      ),
    ).toBe(running);
    const finished = reduce(running, providerSwitchRunFinished());
    expect(finished).toMatchObject({ running: false, finished: true });
    expect(reduce(finished, providerSwitchDialogClosed())).toEqual(initial);
  });
});
