/**
 * @vitest-environment jsdom
 *
 * GitHub-tab selections are picked repos: the selection carries the GitHub
 * URL and the owner/repo shorthand as `repoPath` (never a local path), has
 * no `clonePath`, and validates as soon as a repo name is parseable — no
 * directory pre-flight, because the daemon owns the checkout location
 * (same picked-repo flow as CompactWorkspaceInitializer).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';

const LOCAL_PATH = '/tmp/local-folder';
const mocks = vi.hoisted(() => ({
  localDirectoryStatus: null as Record<string, unknown> | null,
}));

vi.mock('$lib/electron-bridge', () => ({
  invoke: vi.fn(async (channel: string) =>
    channel === 'file:getDirectoryStatus'
      ? { success: true, data: mocks.localDirectoryStatus }
      : undefined,
  ),
}));

vi.mock('$lib/directory-picker-service', () => ({
  pickDirectory: vi.fn(async ({ onSelect }: { onSelect: (path: string) => void }) =>
    onSelect(LOCAL_PATH),
  ),
}));

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
}));

vi.mock('$lib/components/ui/Portal.svelte', async () => {
  const MockPortal = (
    await import('../../../../lib/components/modals/__tests__/mocks/MockPortal.svelte')
  ).default;
  return { default: MockPortal };
});

vi.mock('svelte-fa', async () => {
  const MockFa = (await import('../../../../lib/components/ui/__tests__/mocks/Fa.svelte')).default;
  return { default: MockFa, Fa: MockFa };
});

import { backendRequest } from '$lib/client/live/backend-transport';
import { store as appStore } from '$store/renderer/store';
import { resetMockIpcRouter, setMockIpcInvokeFallback } from '$shared/ipc-mock-router';
// Side-effect import: bridges `file:getDirectoryStatus` → daemon `host.directoryStatus`.
import '$store/renderer/seeders/host-bridge-seeder';

import ProjectPickerMessage, { type ProjectSelection } from '../ProjectPickerMessage.svelte';

const backendRequestMock = vi.mocked(backendRequest);

/** Route daemon RPCs: capture `host.directoryStatus` params, benign defaults elsewhere. */
function mockDaemon(): Array<Record<string, unknown>> {
  const dirStatusCalls: Array<Record<string, unknown>> = [];
  backendRequestMock.mockImplementation(((method: string, params?: unknown) => {
    if (method === 'host.directoryStatus') {
      dirStatusCalls.push(params as Record<string, unknown>);
      return Promise.resolve({
        exists: false,
        isDirectory: false,
        isEmpty: true,
        isGitRepo: false,
        isSubdirectoryOfGitRepo: false,
        path: '',
      });
    }
    if (method === 'host.checkGit') return Promise.resolve({ available: true });
    return Promise.resolve(undefined);
  }) as never);
  return dirStatusCalls;
}

async function pickLocalFolder(
  directoryStatus: Record<string, unknown>,
): Promise<ProjectSelection[]> {
  mocks.localDirectoryStatus = directoryStatus;
  mockDaemon();
  const selections: ProjectSelection[] = [];
  render(ProjectPickerMessage, { props: { onProjectChange: (s) => selections.push(s) } });

  await fireEvent.click(screen.getByRole('button', { name: 'Browse for a folder' }));
  await waitFor(() => expect(selections.at(-1)?.repoPath).toBe(LOCAL_PATH));
  return selections;
}

/** Render the picker, switch to the GitHub tab, and return the URL input. */
async function openGithubTab(
  onProjectChange: (selection: ProjectSelection) => void,
): Promise<HTMLInputElement> {
  render(ProjectPickerMessage, { props: { onProjectChange } });
  const tabButton = Array.from(document.body.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === 'GitHub repo',
  );
  if (!tabButton) throw new Error('GitHub repo tab button not found');
  await fireEvent.click(tabButton);
  return waitFor(() => {
    const el = document.body.querySelector('input[role="combobox"]');
    if (!el) throw new Error('GitHub URL input not rendered yet');
    return el as HTMLInputElement;
  });
}

describe('ProjectPickerMessage — GitHub tab picked-repo selection', () => {
  beforeAll(() => {
    appStore.init();
  });

  beforeEach(() => {
    // Unrelated channels invoked during tab mount (github auth/search) resolve
    // to undefined instead of rejecting as unbridged.
    setMockIpcInvokeFallback(undefined);
  });

  afterEach(() => {
    cleanup();
    backendRequestMock.mockReset();
    mocks.localDirectoryStatus = null;
    sessionStorage.clear();
  });

  afterAll(() => {
    // Restore the loud-failure default so the blanket fallback cannot leak
    // into other suites (also drops this file's seeder handlers, which are
    // re-registered on the next import in a fresh module registry).
    resetMockIpcRouter();
  });

  it('typing owner/repo yields a valid picked-repo selection with no clonePath', async () => {
    mockDaemon();
    const selections: ProjectSelection[] = [];
    const input = await openGithubTab((s) => selections.push(s));

    await fireEvent.input(input, { target: { value: 'octo/hello' } });

    await waitFor(() => {
      const last = selections.at(-1);
      expect(last?.type).toBe('github');
      expect(last?.isValid).toBe(true);
    });
    const last = selections.at(-1);
    expect(last?.githubUrl).toBe('https://github.com/octo/hello');
    expect(last?.repoPath).toBe('octo/hello');
    expect(last?.projectName).toBe('hello');
    expect(last).not.toHaveProperty('clonePath');
  });

  it('never runs a clone-destination directory pre-flight for GitHub selections', async () => {
    const dirStatusCalls = mockDaemon();
    const selections: ProjectSelection[] = [];
    const input = await openGithubTab((s) => selections.push(s));

    await fireEvent.input(input, { target: { value: 'octo/hello' } });

    await waitFor(() => {
      expect(selections.at(-1)?.isValid).toBe(true);
    });
    // Debounced dir-status checks fired at 300ms in the old flow; give any
    // stray timer a chance to fire before asserting none did. The New-project
    // tab's own pre-flight (~/Developer/my-project) may still run — only the
    // clone target must never be probed.
    await new Promise((r) => setTimeout(r, 400));
    expect(dirStatusCalls).not.toContainEqual({ path: '~/Developer/hello' });
    expect(dirStatusCalls.filter((c) => String(c.path).endsWith('/hello'))).toHaveLength(0);
  });

  it('reports isValid:false when the URL has no parseable repo name', async () => {
    mockDaemon();
    const selections: ProjectSelection[] = [];
    const input = await openGithubTab((s) => selections.push(s));

    await fireEvent.input(input, { target: { value: 'octo' } });

    await waitFor(() => {
      const last = selections.at(-1);
      expect(last?.type).toBe('github');
      expect(last?.isValid).toBe(false);
    });
  });

  it.each([
    ['an omitted branch', {}, ''],
    ['an explicit branch', { branch: 'master' }, 'master'],
  ])('preserves %s in a local-repo prefill', async (_, branchPrefill, expectedBranch) => {
    mockDaemon();
    sessionStorage.setItem(
      'workspace-prefill',
      JSON.stringify({ repoPath: '/tmp/non-main-repo', ...branchPrefill }),
    );
    const onProjectChange = vi.fn();

    render(ProjectPickerMessage, { props: { onProjectChange } });

    await waitFor(() =>
      expect(onProjectChange).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'local',
          repoPath: '/tmp/non-main-repo',
          branch: expectedBranch,
        }),
      ),
    );
  });

  it('marks an existing non-git folder for Git initialization', async () => {
    const selections = await pickLocalFolder({
      exists: true,
      isDirectory: true,
      isGitRepo: false,
      isSubdirectoryOfGitRepo: false,
      path: LOCAL_PATH,
    });

    expect(selections).toContainEqual(
      expect.objectContaining({ type: 'local', initGit: true, isValid: true }),
    );
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('does not mark a Git repository for initialization', async () => {
    const selections = await pickLocalFolder({
      exists: true,
      isDirectory: true,
      isGitRepo: true,
      isSubdirectoryOfGitRepo: false,
      path: LOCAL_PATH,
    });

    expect(
      selections
        .filter((selection) => selection.repoPath === LOCAL_PATH)
        .every((selection) => !('initGit' in selection)),
    ).toBe(true);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('keeps scope without Git initialization for a subdirectory of a repository', async () => {
    const selections = await pickLocalFolder({
      exists: true,
      isDirectory: true,
      isGitRepo: false,
      isSubdirectoryOfGitRepo: true,
      relativePathFromGitRoot: 'packages/app',
      path: LOCAL_PATH,
    });

    expect(selections).toContainEqual(
      expect.objectContaining({ type: 'local', scope: 'packages/app' }),
    );
    expect(
      selections
        .filter((selection) => selection.repoPath === LOCAL_PATH)
        .every((selection) => !('initGit' in selection)),
    ).toBe(true);
  });
});
