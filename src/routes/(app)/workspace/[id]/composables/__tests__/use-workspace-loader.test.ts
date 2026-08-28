import { render, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ dispatch: vi.fn() }));

vi.mock('$store/renderer/store', () => ({
  store: { dispatch: mocks.dispatch },
}));

import { workspaceLoadRequested } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import TestUseWorkspaceLoader from './TestUseWorkspaceLoader.test.svelte';

describe('useWorkspaceLoader', () => {
  beforeEach(() => mocks.dispatch.mockReset());

  it('dispatches route load intent and follows route changes', async () => {
    const view = render(TestUseWorkspaceLoader, { props: { workspaceId: 'workspace-a' } });
    await waitFor(() =>
      expect(mocks.dispatch).toHaveBeenCalledWith(workspaceLoadRequested('workspace-a')),
    );

    await view.rerender({ workspaceId: 'workspace-b' });
    await waitFor(() =>
      expect(mocks.dispatch).toHaveBeenCalledWith(workspaceLoadRequested('workspace-b')),
    );
  });

  it.each(['', 'undefined', 'new'])(
    'does not dispatch for non-loadable route %j',
    async (workspaceId) => {
      render(TestUseWorkspaceLoader, { props: { workspaceId } });
      await Promise.resolve();
      expect(mocks.dispatch).not.toHaveBeenCalled();
    },
  );
});
