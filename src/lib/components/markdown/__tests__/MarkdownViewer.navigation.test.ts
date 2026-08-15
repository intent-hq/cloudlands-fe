/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const handleLink = vi.hoisted(() => vi.fn(() => Promise.resolve(true)));

vi.mock('$features/navigation/link-handler', () => ({ handleLink }));

describe('MarkdownViewer panel navigation', () => {
  beforeEach(() => handleLink.mockClear());

  it('uses the owning chat workspace and rendered source panel for markdown links', async () => {
    const MarkdownViewer = (await import('../MarkdownViewer.svelte')).default;
    const { container } = render(MarkdownViewer, {
      props: { content: '[Open file](src/scoped.ts)', workspaceId: 'owning-workspace' },
    });
    container.setAttribute('data-panel-id', 'panel-chat');

    const link = await screen.findByRole('link', { name: 'Open file' });
    await fireEvent.click(link);

    await waitFor(() =>
      expect(handleLink).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          workspaceId: 'owning-workspace',
          sourcePanelId: 'panel-chat',
          openInAdjacentPanel: true,
          openInNewAdjacentPanel: true,
          rawHref: 'src/scoped.ts',
        }),
      ),
    );
  });
});
