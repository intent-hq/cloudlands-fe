/**
 * @vitest-environment jsdom
 *
 * SetupScriptAgent now generates drafts through the AppClient seam
 * (`workspace.generateSetupScript`, PROTOCOL §5.25) instead of the deleted
 * `setup-scripts:*` streaming IPC flow. These tests cover the seam calls and
 * the unmount race the old listener-cleanup tests guarded against.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
}));

vi.mock('$lib/client', () => ({
  appClient: {
    setupScripts: { generate: mocks.generate },
  },
}));

vi.mock('$lib/components/editor/CodeEditor.svelte', async () => ({
  default: (await import('./mocks/MockComponent.svelte')).default,
}));

vi.mock('$features/agent/components/agent-avatar/AgentAvatar.svelte', async () => ({
  default: (await import('./mocks/MockComponent.svelte')).default,
}));

vi.mock('$lib/components/ui/button/button.svelte', async () => ({
  default: (await import('./mocks/MockComponent.svelte')).default,
}));

vi.mock('svelte-fa', async () => ({
  default: (await import('./mocks/MockComponent.svelte')).default,
}));

import SetupScriptAgent from '../SetupScriptAgent.svelte';
import { initAppStore, store as appStore } from '$store/renderer/store';
import { replaceWorkspaceList } from '$store/renderer/slices/workspace/workspace-slice';

let storeContext: ReturnType<typeof initAppStore> | undefined;

/** §5.25 SetupScript record as the daemon returns it. */
const RUST_DRAFT = {
  script: '#!/usr/bin/env bash\nset -euo pipefail\ncargo fetch\n',
  projectType: 'rust',
  updatedAt: 1750000000000,
  generatedBy: 'agent' as const,
};

describe('SetupScriptAgent (workspace.generateSetupScript flow)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeContext = initAppStore(appStore);
    appStore.dispatch(
      replaceWorkspaceList([{ id: 'ws-1', path: '/repo', repositoryPath: '/repo' } as never]),
    );
  });

  afterEach(() => {
    appStore.dispatch(replaceWorkspaceList([]));
    cleanup();
    storeContext?.dispose();
    storeContext = undefined;
  });

  it('resolves the workspace by repo path, requests a draft, and renders it', async () => {
    mocks.generate.mockResolvedValue(RUST_DRAFT);

    render(SetupScriptAgent, { props: { repoPath: '/repo' } });

    await waitFor(() => expect(mocks.generate).toHaveBeenCalledWith('ws-1'));
    await waitFor(() => {
      expect(screen.getByText('rust setup')).toBeTruthy();
    });
  });

  it('does not request a draft if the component unmounts before the workspace resolves', async () => {
    const { unmount } = render(SetupScriptAgent, { props: { repoPath: '/repo' } });

    unmount();
    await new Promise((r) => setTimeout(r, 0));

    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it('shows an error when no workspace matches the repo path', async () => {
    appStore.dispatch(replaceWorkspaceList([{ id: 'ws-other', path: '/elsewhere' } as never]));

    render(SetupScriptAgent, { props: { repoPath: '/repo' } });

    await waitFor(() => {
      expect(screen.getByText(/No workspace found for this repository yet/)).toBeTruthy();
    });
    expect(mocks.generate).not.toHaveBeenCalled();
  });
});
