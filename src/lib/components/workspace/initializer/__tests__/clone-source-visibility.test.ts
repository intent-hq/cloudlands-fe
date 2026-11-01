import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { store as appStore } from '$store/renderer/store';
import { githubAuthStatusUnavailable } from '$store/renderer/slices/github-auth/github-auth-slice';
import { gitlabAuthStatusUnavailable } from '$store/renderer/slices/gitlab-auth/gitlab-auth-slice';
import { selectCloneSourceVisible } from '$store/renderer/slices/workspace-initializer/plain-folder-selectors';
import {
  resolveCloneSourceVisible,
  type CloneSourceVisibilityInput,
} from '../clone-source-visibility';
import { resetPlainFolderState, settleForgeAuth } from './plain-folder-test-state';

const settledNone: CloneSourceVisibilityInput = {
  githubConnected: false,
  githubSettled: true,
  githubFailed: false,
  gitlabConnected: false,
  gitlabSettled: true,
  gitlabFailed: false,
};

describe('resolveCloneSourceVisible', () => {
  it('hides Clone once both forges are known and neither is connected', () => {
    expect(resolveCloneSourceVisible(settledNone)).toBe(false);
  });

  it.each([
    ['GitHub connected', { githubConnected: true }],
    ['GitLab connected', { gitlabConnected: true }],
    ['GitHub status pending', { githubSettled: false }],
    ['GitLab status pending', { gitlabSettled: false }],
    ['GitHub status failed', { githubFailed: true }],
    ['GitLab status failed', { gitlabFailed: true }],
  ])('keeps Clone visible when %s', (_label, override) => {
    expect(resolveCloneSourceVisible({ ...settledNone, ...override })).toBe(true);
  });
});

describe('selectCloneSourceVisible', () => {
  beforeAll(() => appStore.init());
  afterEach(() => resetPlainFolderState());

  const visible = () => selectCloneSourceVisible.select(appStore.state);

  // Runs first: GitHub's settled marker is not reset by later tests' cleanup.
  it('is visible while forge status is pending, hidden once neither is connected', () => {
    expect(visible()).toBe(true);
    settleForgeAuth();
    expect(visible()).toBe(false);
  });

  it('is visible with GitHub or GitLab connected', () => {
    settleForgeAuth({ github: true });
    expect(visible()).toBe(true);
    settleForgeAuth({ gitlab: true });
    expect(visible()).toBe(true);
  });

  it('is visible when a forge status read failed', () => {
    settleForgeAuth();
    appStore.dispatch(githubAuthStatusUnavailable());
    expect(visible()).toBe(true);
    settleForgeAuth();
    appStore.dispatch(gitlabAuthStatusUnavailable());
    expect(visible()).toBe(true);
  });
});
