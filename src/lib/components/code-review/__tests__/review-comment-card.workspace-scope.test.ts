/**
 * ReviewCommentCard must use the explicit review workspace for file reads even
 * when another workspace is active in the surrounding application state.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.hoisted(() => vi.fn());
const storeState = vi.hoisted(() => ({
  tabState: { currentTabId: 'ws-a' },
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: storeState });
});

vi.mock('$lib/electron-bridge', () => ({
  invoke: invokeMock,
}));

vi.mock('svelte-fa', async () => ({
  default: (await import('$lib/components/ui/__tests__/mocks/Fa.svelte')).default,
}));

vi.mock('$lib/components/editor/CodeBlock.svelte', async () => ({
  default: (await import('./mocks/MockCodeBlock.svelte')).default,
}));

vi.mock('$lib/components/markdown/MarkdownViewer.svelte', async () => ({
  default: (await import('$lib/components/workspace/sidebar/__tests__/mocks/MockSimple.svelte'))
    .default,
}));

import ReviewCommentCard from '../ReviewCommentCard.svelte';
import { store as appStore } from '$store/renderer/store';

const comment = {
  id: 'comment-b',
  severity: 'important' as const,
  category: 'bug' as const,
  title: 'Workspace B issue',
  description: 'The change needs attention.',
  location: { file: 'src/b.ts', startLine: 4, endLine: 5 },
  confidence: 0.9,
};

beforeEach(() => {
  vi.clearAllMocks();
  invokeMock.mockResolvedValue({
    success: true,
    data: { content: 'line1\nline2\nline3\nconst b = true;\nline5\nline6' },
  });
});

afterEach(cleanup);

describe('ReviewCommentCard workspace scope', () => {
  it('reads the explicit workspace B file while active workspace A is unrelated', async () => {
    const explicitWorkspaceId = 'ws-b';

    expect(appStore.state.tabState.currentTabId).toBe('ws-a');

    render(ReviewCommentCard, {
      props: {
        comment,
        workspaceId: explicitWorkspaceId,
        workspacePath: '/workspace-b',
      },
    });

    await fireEvent.click(screen.getAllByRole('button')[0]);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('file:read', {
        path: '/workspace-b/src/b.ts',
        workspaceId: explicitWorkspaceId,
      });
      expect(screen.getByTestId('mock-code-block').textContent).toContain('const b = true;');
    });
  });
});
