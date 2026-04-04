/**
 * Regression test: selecting a workspace should be driven by the URL (route).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

vi.mock('$app/navigation', () => ({
  goto: vi.fn(),
}));

import { goto } from '$app/navigation';
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

  it('navigates using the workspace route as the source of truth', async () => {
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

    expect(goto).toHaveBeenCalledWith('/workspace/ws-1');
  });
});
