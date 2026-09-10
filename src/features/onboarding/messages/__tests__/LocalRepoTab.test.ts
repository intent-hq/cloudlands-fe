/**
 * @vitest-environment jsdom
 *
 * LocalRepoTab builds its Recent list from the known-repo registry plus
 * workspace-derived repos. Daemon-managed paths (`/.clones/`, `/.repo-cache/`)
 * and workspace-owned standalone checkouts (repositoryPath === worktreePath)
 * are excluded — the same exclusions RepoSelector applies — while manually
 * picked folders always appear.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';

const mocks = vi.hoisted(() => {
  const readable = <T>(getter: () => T) => ({
    subscribe(run: (v: T) => void) {
      run(getter());
      return () => {};
    },
  });
  const selector = <T>(getter: () => T) => {
    const fn = () => readable(getter);
    return Object.assign(fn, { select: () => getter() });
  };
  const state = {
    workspaces: [] as Array<Record<string, unknown>>,
    knownRepos: [] as Array<Record<string, unknown>>,
    discovered: [] as Array<{ path: string; name: string }>,
    discoveryStatus: 'idle',
    pickedPath: '/home/dev/manual',
  };
  return { readable, selector, state };
});

vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceItems: mocks.selector(() => mocks.state.workspaces),
}));
vi.mock('$store/renderer/slices/known-repos/known-repos-selectors', () => ({
  selectKnownRepos: mocks.selector(() => mocks.state.knownRepos),
  selectDiscoveredLocalRepos: mocks.selector(() => mocks.state.discovered),
  selectLocalRepoDiscoveryStatus: mocks.selector(() => mocks.state.discoveryStatus),
}));

vi.mock('$lib/electron-bridge', () => ({
  invoke: vi.fn(() => Promise.resolve(null)),
}));

// Resolve the picker immediately with the configured path, as if the user
// browsed to a folder and confirmed it.
vi.mock('$lib/directory-picker-service', () => ({
  pickDirectory: vi.fn(async ({ onSelect }: { onSelect: (path: string) => void }) =>
    onSelect(mocks.state.pickedPath),
  ),
}));

vi.mock('svelte-fa', async () => {
  const MockFa = (await import('../../../../lib/components/ui/__tests__/mocks/Fa.svelte')).default;
  return { default: MockFa, Fa: MockFa };
});

// The real modal reads directory listings from the store; the pickDirectory
// mock above short-circuits before it would open, so stub it out entirely.
vi.mock('../DirectoryPickerModal.svelte', async () => ({
  default: (await import('./mocks/MockDirectoryPickerModal.svelte')).default,
}));

import { m } from '$shared/paraglide/messages.js';
import LocalRepoTab from '../LocalRepoTab.svelte';
import { warmImport } from '../../../../test/warm-import';

const baseProps = () => ({ onSelect: vi.fn() });

const rowPaths = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLButtonElement>('button[role="option"]')).map(
    (row) => row.textContent ?? '',
  );

const standaloneWorkspace = {
  repositoryPath: '/ws/standalone',
  worktreePath: '/ws/standalone',
  repositoryName: 'standalone',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('../../../../lib/components/ui/__tests__/mocks/Fa.svelte'));
warmImport(() => import('./mocks/MockDirectoryPickerModal.svelte'));

describe('LocalRepoTab — recent repos filtering', () => {
  afterEach(() => {
    cleanup();
    mocks.state.workspaces = [];
    mocks.state.knownRepos = [];
    mocks.state.discovered = [];
    mocks.state.discoveryStatus = 'idle';
    mocks.state.pickedPath = '/home/dev/manual';
  });

  it('excludes registry entries under daemon-managed paths', () => {
    mocks.state.knownRepos = [
      { path: '/ws/.repo-cache/intent-hq/monorepo', name: 'monorepo', owner: 'intent-hq' },
      { path: '/ws/.clones/legacy', name: 'legacy' },
      { path: '/home/dev/app', name: 'app' },
    ];
    const { container } = render(LocalRepoTab, { props: baseProps() });

    const paths = rowPaths(container);
    expect(paths).toHaveLength(1);
    expect(paths[0]).toContain('/home/dev/app');
  });

  it('excludes registry entries that are workspace-owned standalone checkouts', () => {
    mocks.state.workspaces = [standaloneWorkspace];
    mocks.state.knownRepos = [
      { path: '/ws/standalone', name: 'standalone' },
      { path: '/home/dev/app', name: 'app' },
    ];
    const { container } = render(LocalRepoTab, { props: baseProps() });

    const paths = rowPaths(container);
    expect(paths).toHaveLength(1);
    expect(paths[0]).toContain('/home/dev/app');
  });

  it('excludes workspace-derived owned checkouts but keeps repos with separate worktrees', () => {
    mocks.state.workspaces = [
      standaloneWorkspace,
      {
        repositoryPath: '/home/dev/lib',
        worktreePath: '/ws/slug/lib',
        repositoryName: 'lib',
        updatedAt: '2026-08-02T00:00:00.000Z',
      },
    ];
    const { container } = render(LocalRepoTab, { props: baseProps() });

    const paths = rowPaths(container);
    expect(paths).toHaveLength(1);
    expect(paths[0]).toContain('/home/dev/lib');
  });

  it('keeps manually picked folders in the list', async () => {
    const props = baseProps();
    const { container } = render(LocalRepoTab, { props });

    expect(rowPaths(container)).toHaveLength(0);
    await fireEvent.click(
      screen.getByRole('button', { name: m.onboarding_localRepoTab_browse_ariaLabel() }),
    );

    await waitFor(() => {
      const paths = rowPaths(container);
      expect(paths).toHaveLength(1);
      expect(paths[0]).toContain('/home/dev/manual');
    });
    expect(props.onSelect).toHaveBeenCalledWith('/home/dev/manual', undefined);
  });

  it('searches and selects discovered suggestions without automatically selecting them', async () => {
    mocks.state.discovered = [
      { path: '/home/dev/app', name: 'app' },
      { path: '/home/dev/lib', name: 'lib' },
      { path: '/home/dev/app', name: 'app' },
      { path: '/ws/.repo-cache/internal', name: 'internal' },
    ];
    const props = baseProps();
    render(LocalRepoTab, { props });
    expect(screen.getAllByRole('option')).toHaveLength(2);
    expect(props.onSelect).not.toHaveBeenCalled();
    const input = screen.getByRole('combobox');
    await fireEvent.input(input, { target: { value: 'lib' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    await fireEvent.click(screen.getByRole('option'));
    await waitFor(() => expect(props.onSelect).toHaveBeenCalledWith('/home/dev/lib', undefined));
    await fireEvent.input(input, { target: { value: 'missing' } });
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  it.each(['loading', 'error', 'complete'])(
    'keeps manual browsing available during discovery %s',
    async (status) => {
      mocks.state.discoveryStatus = status;
      const props = baseProps();
      render(LocalRepoTab, { props });
      expect(screen.getByRole('listbox').getAttribute('aria-busy')).toBe(
        String(status === 'loading'),
      );
      if (status !== 'complete') expect(screen.getByRole('status')).toBeTruthy();
      await fireEvent.click(
        screen.getByRole('button', { name: m.onboarding_localRepoTab_browse_ariaLabel() }),
      );
      await waitFor(() =>
        expect(props.onSelect).toHaveBeenCalledWith('/home/dev/manual', undefined),
      );
    },
  );

  it('exempts manually picked folders from the exclusion filter', async () => {
    // Picking a path that the filter would otherwise exclude (a workspace-owned
    // standalone checkout) must still surface it — the user chose it explicitly.
    mocks.state.workspaces = [standaloneWorkspace];
    mocks.state.pickedPath = '/ws/standalone';
    const props = baseProps();
    const { container } = render(LocalRepoTab, { props });

    expect(rowPaths(container)).toHaveLength(0);
    await fireEvent.click(
      screen.getByRole('button', { name: m.onboarding_localRepoTab_browse_ariaLabel() }),
    );

    await waitFor(() => {
      const paths = rowPaths(container);
      expect(paths).toHaveLength(1);
      expect(paths[0]).toContain('/ws/standalone');
    });
  });
});
