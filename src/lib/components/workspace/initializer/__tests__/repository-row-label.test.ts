import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { store as appStore } from '$store/renderer/store';
import { githubAuthStatusUnavailable } from '$store/renderer/slices/github-auth/github-auth-slice';
import { selectForgeConnectionState } from '$store/renderer/slices/workspace-initializer/plain-folder-selectors';
import {
  resolveForgeConnectionState,
  resolveRepositoryRowLabelKind,
  type ForgeConnectionInput,
} from '../repository-row-label';
import { resetPlainFolderState, settleForgeAuth } from './plain-folder-test-state';

describe('resolveRepositoryRowLabelKind', () => {
  it('is Project with plain folders offered and no forge connected', () => {
    expect(
      resolveRepositoryRowLabelKind({
        plainFoldersOffered: true,
        forgeState: 'none',
        hasPlainFolderEntry: false,
      }),
    ).toBe('project');
    expect(
      resolveRepositoryRowLabelKind({
        plainFoldersOffered: true,
        forgeState: 'none',
        hasPlainFolderEntry: true,
      }),
    ).toBe('project');
  });

  it('is Codebase/Project with a forge connected and a plain-folder entry listed', () => {
    expect(
      resolveRepositoryRowLabelKind({
        plainFoldersOffered: true,
        forgeState: 'connected',
        hasPlainFolderEntry: true,
      }),
    ).toBe('codebaseOrProject');
  });

  it('is Codebase with a forge connected and no plain-folder entry', () => {
    expect(
      resolveRepositoryRowLabelKind({
        plainFoldersOffered: true,
        forgeState: 'connected',
        hasPlainFolderEntry: false,
      }),
    ).toBe('codebase');
  });

  it('never claims "no forge" while forge status is unknown', () => {
    expect(
      resolveRepositoryRowLabelKind({
        plainFoldersOffered: true,
        forgeState: 'unknown',
        hasPlainFolderEntry: false,
      }),
    ).toBe('codebase');
    expect(
      resolveRepositoryRowLabelKind({
        plainFoldersOffered: true,
        forgeState: 'unknown',
        hasPlainFolderEntry: true,
      }),
    ).toBe('codebaseOrProject');
  });

  it.each(['none', 'connected', 'unknown'] as const)(
    'stays Codebase with plain folders not offered (forge %s)',
    (forgeState) => {
      for (const hasPlainFolderEntry of [false, true]) {
        expect(
          resolveRepositoryRowLabelKind({
            plainFoldersOffered: false,
            forgeState,
            hasPlainFolderEntry,
          }),
        ).toBe('codebase');
      }
    },
  );
});

const settledNone: ForgeConnectionInput = {
  githubConnected: false,
  githubSettled: true,
  githubFailed: false,
  gitlabConnected: false,
  gitlabSettled: true,
  gitlabFailed: false,
};

describe('resolveForgeConnectionState', () => {
  it('is none once both forges are known and neither is connected', () => {
    expect(resolveForgeConnectionState(settledNone)).toBe('none');
  });

  it.each([
    ['GitHub connected', { githubConnected: true }],
    ['GitLab connected', { gitlabConnected: true }],
  ])('is connected when %s', (_name, patch) => {
    expect(resolveForgeConnectionState({ ...settledNone, ...patch })).toBe('connected');
  });

  it.each([
    ['GitHub status pending', { githubSettled: false }],
    ['GitHub status failed', { githubFailed: true }],
    ['GitLab status pending', { gitlabSettled: false }],
    ['GitLab status failed', { gitlabFailed: true }],
  ])('is unknown when %s', (_name, patch) => {
    expect(resolveForgeConnectionState({ ...settledNone, ...patch })).toBe('unknown');
  });
});

describe('selectForgeConnectionState', () => {
  beforeAll(() => appStore.init());
  afterEach(() => {
    resetPlainFolderState();
  });

  // Runs first: GitHub's settled marker is not reset by later tests' cleanup.
  it('is unknown before forge status settles', () => {
    expect(selectForgeConnectionState.select(appStore.state)).toBe('unknown');
  });

  it('is none with both forges settled and disconnected', () => {
    settleForgeAuth();
    expect(selectForgeConnectionState.select(appStore.state)).toBe('none');
  });

  it('is connected with GitHub connected', () => {
    settleForgeAuth({ github: true });
    expect(selectForgeConnectionState.select(appStore.state)).toBe('connected');
  });

  it('is connected with GitLab connected (no Labs gate)', () => {
    settleForgeAuth({ gitlab: true });
    expect(selectForgeConnectionState.select(appStore.state)).toBe('connected');
  });

  it('is unknown when the GitHub status read failed', () => {
    settleForgeAuth();
    appStore.dispatch(githubAuthStatusUnavailable());
    expect(selectForgeConnectionState.select(appStore.state)).toBe('unknown');
  });
});
