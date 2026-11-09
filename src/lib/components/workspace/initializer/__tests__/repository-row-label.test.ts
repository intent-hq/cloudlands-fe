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
  const offered = { plainFoldersOffered: true };

  it.each(['none', 'connected', 'unknown'] as const)(
    'follows the selection over the list (forge %s)',
    (forgeState) => {
      for (const list of [
        { hasGitRepositoryEntry: true, hasPlainFolderEntry: true },
        { hasGitRepositoryEntry: true, hasPlainFolderEntry: false },
        { hasGitRepositoryEntry: false, hasPlainFolderEntry: true },
        { hasGitRepositoryEntry: false, hasPlainFolderEntry: false },
      ]) {
        expect(
          resolveRepositoryRowLabelKind({ ...offered, forgeState, ...list, selected: 'folder' }),
        ).toBe('folder');
        expect(
          resolveRepositoryRowLabelKind({ ...offered, forgeState, ...list, selected: 'codebase' }),
        ).toBe('codebase');
      }
    },
  );

  it('keeps Codebase for a selected plain folder with plain folders not offered', () => {
    expect(
      resolveRepositoryRowLabelKind({
        plainFoldersOffered: false,
        forgeState: 'none',
        hasGitRepositoryEntry: false,
        hasPlainFolderEntry: true,
        selected: 'folder',
      }),
    ).toBe('codebase');
  });

  it.each(['none', 'connected', 'unknown'] as const)(
    'is Codebase whenever a git repository is listed (forge %s)',
    (forgeState) => {
      for (const hasPlainFolderEntry of [false, true]) {
        expect(
          resolveRepositoryRowLabelKind({
            ...offered,
            forgeState,
            hasGitRepositoryEntry: true,
            hasPlainFolderEntry,
          }),
        ).toBe('codebase');
      }
    },
  );

  it('is Folder with no git repository listed and no forge connected', () => {
    for (const hasPlainFolderEntry of [false, true]) {
      expect(
        resolveRepositoryRowLabelKind({
          ...offered,
          forgeState: 'none',
          hasGitRepositoryEntry: false,
          hasPlainFolderEntry,
        }),
      ).toBe('folder');
    }
  });

  it.each(['connected', 'unknown'] as const)(
    'is Folder with only plain folders listed (forge %s)',
    (forgeState) => {
      expect(
        resolveRepositoryRowLabelKind({
          ...offered,
          forgeState,
          hasGitRepositoryEntry: false,
          hasPlainFolderEntry: true,
        }),
      ).toBe('folder');
    },
  );

  it.each(['connected', 'unknown'] as const)(
    'is Codebase with an empty list and forge %s',
    (forgeState) => {
      expect(
        resolveRepositoryRowLabelKind({
          ...offered,
          forgeState,
          hasGitRepositoryEntry: false,
          hasPlainFolderEntry: false,
        }),
      ).toBe('codebase');
    },
  );

  it.each(['none', 'connected', 'unknown'] as const)(
    'stays Codebase with plain folders not offered (forge %s)',
    (forgeState) => {
      for (const hasGitRepositoryEntry of [false, true]) {
        for (const hasPlainFolderEntry of [false, true]) {
          expect(
            resolveRepositoryRowLabelKind({
              plainFoldersOffered: false,
              forgeState,
              hasGitRepositoryEntry,
              hasPlainFolderEntry,
            }),
          ).toBe('codebase');
        }
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
