/**
 * Regression test: selecting a workspace should be driven by the URL (route).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

const mocks = vi.hoisted(() => ({ show: vi.fn(async () => true) }));
vi.mock('$lib/utils/show-workspace.client', () => ({ openAndShowWorkspace: mocks.show }));

import { page } from '$app/stores';
import WorkspaceLinks from '$lib/components/workspace/WorkspaceLinks.svelte';

describe('WorkspaceLinks', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Simulate we are currently on /workspace/ws-1 so the item is active
    (page.subscribe as any).mockImplementation((run: any) => {
      run({ url: new URL('http://localhost/workspace/ws-1') });
      return () => {};
    });
  });

  it('shows the workspace and opens its tab through the shared helper', async () => {
    const workspaces = [
      {
        id: 'ws-1',
        title: 'Demo workspace',
        createdAt: new Date().toISOString(),
      } as any,
    ];

    const { getByRole } = render(WorkspaceLinks, { props: { workspaces } });

    const button = getByRole('button', { name: /demo workspace/i });
    await fireEvent.click(button);

    expect(mocks.show).toHaveBeenCalledWith('ws-1');
  });
});
