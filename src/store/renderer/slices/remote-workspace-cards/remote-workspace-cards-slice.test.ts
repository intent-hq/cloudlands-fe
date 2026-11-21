import { describe, expect, it } from 'vitest';
import type { Workspace } from '$shared/types';
import {
  remoteWorkspaceCardKey,
  remoteWorkspaceCardsReceived,
  remoteWorkspaceCardsReducer,
  remoteWorkspaceCardsStarted,
} from './remote-workspace-cards-slice';

const reduce = remoteWorkspaceCardsReducer;
const initialState = { byKey: {} };
const key = (id: string) => remoteWorkspaceCardKey('fp:AB', id);
const found = { id: 'kept', title: 'Kept' } as Workspace;

describe('remote workspace cards', () => {
  it('marks each card found or missing from one answer for the machine', () => {
    const loading = reduce(initialState, remoteWorkspaceCardsStarted('fp:AB', ['kept', 'gone']));
    expect(loading.byKey[key('kept')]).toEqual({ status: 'loading' });

    const state = reduce(
      loading,
      remoteWorkspaceCardsReceived(
        'fp:AB',
        ['kept', 'gone'],
        { status: 'ok', machineName: 'Mac Studio', workspaces: [found] },
        5,
      ),
    );

    expect(state.byKey[key('kept')]).toEqual({
      status: 'found',
      machineName: 'Mac Studio',
      workspace: found,
      loadedAt: 5,
    });
    expect(state.byKey[key('gone')]).toEqual({
      status: 'missing',
      machineName: 'Mac Studio',
      loadedAt: 5,
    });
  });

  it('gives every card the machine-level failure', () => {
    const state = reduce(
      initialState,
      remoteWorkspaceCardsReceived('fp:AB', ['a', 'b'], { status: 'unknown-backend' }, 5),
    );

    expect(state.byKey[key('a')]).toEqual({ status: 'unknown-backend', loadedAt: 5 });
    expect(state.byKey[key('b')]).toEqual({ status: 'unknown-backend', loadedAt: 5 });
  });

  it('keeps a shown card while it is read again', () => {
    const shown = reduce(
      initialState,
      remoteWorkspaceCardsReceived(
        'fp:AB',
        ['kept'],
        { status: 'ok', machineName: 'Mac Studio', workspaces: [found] },
        5,
      ),
    );

    const refreshing = reduce(shown, remoteWorkspaceCardsStarted('fp:AB', ['kept']));

    expect(refreshing.byKey[key('kept')]).toEqual(shown.byKey[key('kept')]);
  });
});
