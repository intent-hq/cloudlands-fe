import { describe, expect, it } from 'vitest';
import { readWorkspaceLocalCreation } from './local-creation-intent';
import {
  hydrateWorkspaceInitializer,
  setWorkspaceLocalCreation,
  workspaceInitializerReducer,
  workspaceLocalCreationOpened,
  workspaceLocalCreationClosed,
} from '../workspace-initializer-slice';
const receipt = {
  id: 'key',
  authority: 'owner',
  repositoryPath: '/owned/repo',
  baseRef: 'main',
  status: 'pending' as const,
};
describe('retained local creation receipt', () => {
  it('keeps only bounded serializable policy fields', () => {
    expect(
      readWorkspaceLocalCreation({
        ...receipt,
        callback: () => true,
        workspaceId: '',
        error: 'x'.repeat(8193),
      }),
    ).toEqual(receipt);
    for (const value of [
      null,
      [],
      {},
      { ...receipt, id: '' },
      { ...receipt, authority: '\0' },
      { ...receipt, repositoryPath: 'x'.repeat(4097) },
      { ...receipt, status: 'whatever' },
    ])
      expect(readWorkspaceLocalCreation(value)).toBeNull();
  });
  it('does not turn renderer restart uncertainty into retryable failure', () => {
    const state = workspaceInitializerReducer(
      undefined,
      hydrateWorkspaceInitializer({ localCreation: receipt }),
    );
    expect(state.localCreation).toEqual({ ...receipt, status: 'uncertain' });
  });
  it('replaces a previous authority receipt at admitted hydration, but keeps a same-owner in-flight request', () => {
    const state = workspaceInitializerReducer(undefined, setWorkspaceLocalCreation(receipt));
    expect(
      workspaceInitializerReducer(
        state,
        hydrateWorkspaceInitializer({ localCreation: { ...receipt, authority: 'new' } }),
      ).localCreation?.authority,
    ).toBe('new');
    expect(
      workspaceInitializerReducer(
        state,
        hydrateWorkspaceInitializer({ localCreation: { ...receipt, id: 'older' } }),
      ).localCreation,
    ).toBe(receipt);
    expect(
      workspaceInitializerReducer(state, hydrateWorkspaceInitializer({ localCreation: null }))
        .localCreation,
    ).toBeNull();
  });
  it('does not clear a newer form owner when an older form unmounts', () => {
    const state = workspaceInitializerReducer(
      undefined,
      workspaceLocalCreationOpened('new', 'context'),
    );
    expect(workspaceInitializerReducer(state, workspaceLocalCreationClosed('old'))).toBe(state);
    expect(
      workspaceInitializerReducer(state, workspaceLocalCreationClosed('new')).localConsumer,
    ).toBeNull();
  });
});
