import { describe, expect, it } from 'vitest';
import { readRepositoryCheckoutDraft } from './repository-checkout-draft';
import {
  hydrateWorkspaceInitializer,
  setCompactWorkspaceInitializerFormState,
  workspaceInitializerReducer,
  initialState,
} from '../workspace-initializer/workspace-initializer-slice';
import { mapInitialRepoToFormState } from '$lib/components/workspace/initializer/initial-repo-utils';

const instanceBaseUrl = 'https://git.example:8443/Forge';
const draft = {
  instanceBaseUrl,
  projectPath: 'group/subgroup/project',
  branch: 'release/next',
  mode: 'cached' as const,
};
describe('qualified checkout intent persistence', () => {
  it('restores intent without any cached authority or asserted commit', () => {
    expect(
      readRepositoryCheckoutDraft({
        ...draft,
        checkoutId: 'stale',
        revision: 'old',
        commitSha: 'a'.repeat(40),
        user: 'A',
        cursor: 'foreign',
      }),
    ).toEqual(draft);
  });
  it('preserves an original MR URL including query/fragment without rewriting its branch', () => {
    const contextUrl =
      instanceBaseUrl + '/' + draft.projectPath + '/-/merge_requests/7?view=parallel#note_42';
    expect(readRepositoryCheckoutDraft({ ...draft, contextUrl })).toEqual({ ...draft, contextUrl });
    const form = mapInitialRepoToFormState({
      repositoryCheckoutDraft: { ...draft, contextUrl },
      repoPath: '/stale/github',
      owner: 'old',
      name: 'old',
    });
    expect(form).toMatchObject({
      repoType: 'gitlab',
      githubUrl: '',
      branch: '',
      repositoryCheckoutDraft: { ...draft, contextUrl },
    });
  });
  it.each(['', '/'])('persists a plain project URL%s with intent but no authority', (suffix) => {
    const contextUrl = `${instanceBaseUrl}/${draft.projectPath}${suffix}?ref=release%2Fnext#readme`;
    const value = {
      ...draft,
      contextUrl,
      checkoutId: 'old-lease',
      revision: 'old-account',
      commitSha: 'a'.repeat(40),
    };
    const saved = workspaceInitializerReducer(
      initialState,
      setCompactWorkspaceInitializerFormState({
        repoType: 'gitlab',
        repositoryCheckoutDraft: value,
      }),
    ).compactFormState;
    expect(saved?.repositoryCheckoutDraft).toEqual({ ...draft, contextUrl });
    const restored = workspaceInitializerReducer(
      initialState,
      hydrateWorkspaceInitializer({ compactFormState: saved }),
    ).compactFormState;
    expect(restored?.repositoryCheckoutDraft).toEqual({ ...draft, contextUrl });
    expect(mapInitialRepoToFormState({ repositoryCheckoutDraft: value })).toMatchObject({
      repoType: 'gitlab',
      repositoryCheckoutDraft: { ...draft, contextUrl },
    });
    expect(readRepositoryCheckoutDraft({ instanceBaseUrl, contextUrl })?.projectPath).toBe(
      draft.projectPath,
    );
  });
  it.each([
    { ...draft, instanceBaseUrl: 'http://git.example' },
    { ...draft, instanceBaseUrl: instanceBaseUrl + '/../other' },
    { ...draft, contextUrl: 'https://unknown.example/group/subgroup/project/-/issues/4' },
    { ...draft, contextUrl: instanceBaseUrl.toLowerCase() + '/group/subgroup/project/-/issues/4' },
    { ...draft, contextUrl: instanceBaseUrl + '/other/project/-/issues/4' },
    { ...draft, contextUrl: 'https://unknown.example/group/subgroup/project' },
    { ...draft, contextUrl: instanceBaseUrl.toLowerCase() + '/group/subgroup/project' },
    { ...draft, contextUrl: instanceBaseUrl + '/other/project' },
    { ...draft, contextUrl: instanceBaseUrl + '/group/../subgroup/project' },
    { ...draft, contextUrl: instanceBaseUrl + '/group/%2e%2e/subgroup/project' },
    { ...draft, contextUrl: instanceBaseUrl + '/group/subgroup/project/-/work_items/4' },
    { ...draft, contextUrl: instanceBaseUrl + '/groups/subgroup/project' },
  ])('rejects malformed or foreign instance intent %j', (value) => {
    expect(readRepositoryCheckoutDraft(value)).toBeUndefined();
  });
  it.each(['hydrate', 'edit'])(
    'sanitizes %s before persisted form state can carry a lease or alternate source',
    (mode) => {
      const form = {
        repoType: 'gitlab' as const,
        repositoryCheckoutDraft: {
          ...draft,
          checkoutId: 'stale',
          revision: 'old',
          commitSha: 'a'.repeat(40),
        },
        repoPath: '/old',
        githubUrl: 'https://github.com/old/repo',
        branch: 'old',
        skipIsolation: true,
      };
      const action =
        mode === 'hydrate'
          ? hydrateWorkspaceInitializer({ compactFormState: form })
          : setCompactWorkspaceInitializerFormState(form);
      const state = workspaceInitializerReducer(initialState, action);
      expect(state.compactFormState).toMatchObject({
        repositoryCheckoutDraft: draft,
        repoPath: '',
        branch: '',
        githubUrl: '',
        skipIsolation: false,
      });
      expect(JSON.stringify(state.compactFormState)).not.toContain('checkoutId');
      expect(JSON.stringify(state.compactFormState)).not.toContain('commitSha');
    },
  );
});
