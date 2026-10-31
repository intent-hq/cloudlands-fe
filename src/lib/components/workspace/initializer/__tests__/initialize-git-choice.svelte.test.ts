import { flushSync } from 'svelte';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Workspace } from '$shared/types';
import { store as appStore } from '$store/renderer/store';
import {
  createInitializeGitChoice,
  type InitializeGitChoice,
} from '../initialize-git-choice.svelte';
import { INITIALIZE_GIT_CHOICE_STORAGE_KEY } from '../plain-folder-create';
import {
  loadWorkspaces,
  resetPlainFolderState,
  setPlainFolderLabs,
  settleForgeAuth,
} from './plain-folder-test-state';

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial));
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  };
}

let cleanup: (() => void) | undefined;
function mount(storage: Storage, gitlabWaitMs = 60_000): InitializeGitChoice {
  let choice!: InitializeGitChoice;
  cleanup = $effect.root(() => {
    choice = createInitializeGitChoice({ storage, gitlabWaitMs });
  });
  flushSync();
  return choice;
}

const gitWorkspace = { id: 'ws-git', title: 'Repo' } as unknown as Workspace;
const plainWorkspace = {
  id: 'ws-plain',
  title: 'Notes',
  plainFolder: true,
} as unknown as Workspace;

beforeAll(() => appStore.init());
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  resetPlainFolderState();
  vi.useRealTimers();
});

describe('createInitializeGitChoice', () => {
  // Runs first: GitHub's settled marker is not reset by later tests' cleanup.
  it('stays hidden (behaves as git) until forge auth and the workspace list load', async () => {
    setPlainFolderLabs(true);
    const choice = mount(memoryStorage());
    expect(choice.available).toBe(true);
    expect(choice.visible).toBe(false);
    expect(choice.initializeGit).toBe(true);

    loadWorkspaces([]);
    settleForgeAuth();
    await vi.waitFor(() => {
      flushSync();
      expect(choice.visible).toBe(true);
    });
    expect(choice.initializeGit).toBe(false);
  });

  it('is unavailable with Labs off: no toggle, today’s git behavior', () => {
    setPlainFolderLabs(false);
    settleForgeAuth();
    loadWorkspaces([]);
    const choice = mount(memoryStorage({ [INITIALIZE_GIT_CHOICE_STORAGE_KEY]: 'false' }));
    expect(choice.available).toBe(false);
    expect(choice.visible).toBe(false);
    expect(choice.initializeGit).toBe(true);
  });

  it('is unavailable on a daemon that predates plainFolder creates', () => {
    setPlainFolderLabs(true, '15.2');
    settleForgeAuth();
    loadWorkspaces([]);
    const choice = mount(memoryStorage());
    expect(choice.available).toBe(false);
    expect(choice.initializeGit).toBe(true);
  });

  it.each([
    ['GitHub connected', () => settleForgeAuth({ github: true }), [] as Workspace[]],
    ['GitLab connected', () => settleForgeAuth({ gitlab: true }), [] as Workspace[]],
    ['an existing git workspace', () => settleForgeAuth(), [gitWorkspace]],
  ])('defaults on with %s', (_label, settle, workspaces) => {
    setPlainFolderLabs(true);
    settle();
    loadWorkspaces(workspaces);
    const choice = mount(memoryStorage());
    expect(choice.visible).toBe(true);
    expect(choice.initializeGit).toBe(true);
  });

  it('defaults off when the only workspaces are plain folders', () => {
    setPlainFolderLabs(true);
    settleForgeAuth();
    loadWorkspaces([plainWorkspace]);
    expect(mount(memoryStorage()).initializeGit).toBe(false);
  });

  it('never flips while visible when a forge connects later', async () => {
    setPlainFolderLabs(true);
    settleForgeAuth();
    loadWorkspaces([]);
    const choice = mount(memoryStorage());
    expect(choice.initializeGit).toBe(false);

    settleForgeAuth({ github: true });
    loadWorkspaces([gitWorkspace]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    flushSync();
    expect(choice.visible).toBe(true);
    expect(choice.initializeGit).toBe(false);
  });

  it('remembers the last explicit choice for the next create', () => {
    setPlainFolderLabs(true);
    settleForgeAuth({ github: true });
    loadWorkspaces([gitWorkspace]);
    const storage = memoryStorage();
    const first = mount(storage);
    expect(first.initializeGit).toBe(true);
    first.set(false);
    flushSync();
    expect(first.initializeGit).toBe(false);
    expect(storage.getItem(INITIALIZE_GIT_CHOICE_STORAGE_KEY)).toBe('false');
    cleanup?.();

    expect(mount(storage).initializeGit).toBe(false);
  });

  it('decides without a GitLab status read once the bounded wait elapses', () => {
    vi.useFakeTimers();
    setPlainFolderLabs(true);
    settleForgeAuth();
    loadWorkspaces([]);
    appStore.dispatch({ type: 'gitlabAuth/resetAdmission' });
    const choice = mount(memoryStorage(), 1_000);
    expect(choice.visible).toBe(false);
    vi.advanceTimersByTime(1_000);
    flushSync();
    expect(choice.visible).toBe(true);
    expect(choice.initializeGit).toBe(false);
  });
});
