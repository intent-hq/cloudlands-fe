/**
 * @vitest-environment jsdom
 *
 * VirtualizedFileTree — Download / Download-as-Zip / Reveal context-menu
 * locality gating (monorepo#2171).
 *
 * These are desktop actions on workspace file paths: they require BOTH the
 * daemon to be local (PROTOCOL §5.14) AND the workspace checkout to live on
 * the daemon host (`selectIsWorkspaceHostLocal`). Renders the REAL component
 * against the REAL configured store: seeds daemon locality
 * (`systemStatusSuccess` → `host.locality`) plus an optional workspace
 * entity, opens a file row's context menu, and asserts the items' visibility.
 */
import { beforeAll, beforeEach, afterAll, afterEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';

import VirtualizedFileTree from '../VirtualizedFileTree.svelte';
import { store as appStore } from '$store/renderer/store';
import { systemStatusSuccess } from '$store/renderer/slices/daemon-health/daemon-health-slice';
import { selectDaemonConnectionGeneration } from '$store/renderer/slices/daemon-health/daemon-health-selectors';
import {
  removeWorkspaceEntity,
  setWorkspaceEntity,
} from '$store/renderer/slices/workspace/workspace-slice';
import type { FlattenedFileNode } from '$store/renderer/slices/file-explorer/file-explorer-types';
import type { Workspace } from '$shared/types';
import { WorkspaceStatusEnum } from '$shared/types';
import { WorkspaceId } from '$shared/types/branded-ids';

const WS_ID = 'ws-tree-locality';
const FILE_PATH = '/home/dev/project/src/index.ts';

const flattenedNodes: FlattenedFileNode[] = [
  {
    node: { name: 'index.ts', path: FILE_PATH, type: 'file', children: [] },
    depth: 0,
    isExpanded: false,
    isLoading: false,
  },
];

/** Dispatch a system.status poll result with the given daemon locality. */
function seedLocality(locality: 'local' | 'remote') {
  appStore.dispatch(
    systemStatusSuccess(
      {
        running: true,
        listenMode: 'both',
        transports: ['uds'],
        clients: 1,
        agents: 1,
        protocolVersion: '2.4',
        host: { os: 'macos', arch: 'aarch64', hasDisplay: true, locality },
      },
      '2026-07-30T20:00:00.000Z',
      selectDaemonConnectionGeneration.select(appStore.state),
    ),
  );
}

/** Seed the workspace entity, optionally as a remote (SSH) workspace. */
function seedWorkspace(remote: boolean) {
  appStore.dispatch(
    setWorkspaceEntity({
      id: WorkspaceId(WS_ID),
      title: 'Tree WS',
      branch: 'main',
      changesets: [],
      timeline: [],
      conversationInfo: [],
      status: WorkspaceStatusEnum.Active,
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
      ...(remote
        ? { environmentConfig: { type: 'remote', ssh: { host: 'example.com', user: 'dev' } } }
        : {}),
    } as unknown as Workspace),
  );
}

async function openFileContextMenu(container: HTMLElement) {
  const row = container.querySelector(`[data-file-path="${FILE_PATH}"]`);
  expect(row).not.toBeNull();
  await fireEvent.contextMenu(row!);
}

describe('VirtualizedFileTree download/reveal locality gating (monorepo#2171)', () => {
  // jsdom has no ResizeObserver (the tree uses one to track container height).
  const originalResizeObserver = globalThis.ResizeObserver;
  beforeAll(() => {
    globalThis.ResizeObserver = class ResizeObserverMock {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  });
  afterAll(() => {
    globalThis.ResizeObserver = originalResizeObserver;
  });

  beforeEach(() => {
    appStore.init();
  });

  afterEach(() => {
    appStore.dispatch(removeWorkspaceEntity(WS_ID));
  });

  it('shows Download and Reveal for a local workspace on a local daemon', async () => {
    seedLocality('local');
    seedWorkspace(false);

    const { container } = render(VirtualizedFileTree, {
      props: { flattenedNodes, workspaceId: WS_ID },
    });
    await openFileContextMenu(container);

    expect(await screen.findByText(/^Download/)).toBeTruthy();
    expect(screen.queryByText(/^Reveal in /)).toBeTruthy();
  });

  it('hides Download and Reveal for a remote (SSH) workspace even when the daemon is local', async () => {
    seedLocality('local');
    seedWorkspace(true);

    const { container } = render(VirtualizedFileTree, {
      props: { flattenedNodes, workspaceId: WS_ID },
    });
    await openFileContextMenu(container);

    // Menu is open (Open present) but no download/reveal entries.
    expect(await screen.findByText('Open')).toBeTruthy();
    expect(screen.queryByText(/^Download/)).toBeNull();
    expect(screen.queryByText(/^Reveal in /)).toBeNull();
  });

  it('hides Download and Reveal when the daemon is remote', async () => {
    seedLocality('remote');
    seedWorkspace(false);

    const { container } = render(VirtualizedFileTree, {
      props: { flattenedNodes, workspaceId: WS_ID },
    });
    await openFileContextMenu(container);

    expect(await screen.findByText('Open')).toBeTruthy();
    expect(screen.queryByText(/^Download/)).toBeNull();
    expect(screen.queryByText(/^Reveal in /)).toBeNull();
  });
});
