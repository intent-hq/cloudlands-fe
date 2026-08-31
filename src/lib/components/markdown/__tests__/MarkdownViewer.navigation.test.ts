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
          rawHref: 'src/scoped.ts',
        }),
      ),
    );
    expect(handleLink.mock.calls[0]?.[1]).not.toHaveProperty('openInAdjacentPanel');
    expect(handleLink.mock.calls[0]?.[1]).not.toHaveProperty('openInNewAdjacentPanel');
  });

  it('forwards forceExternal for http(s) links when forceExternalLinks is set', async () => {
    const MarkdownViewer = (await import('../MarkdownViewer.svelte')).default;
    render(MarkdownViewer, {
      props: {
        content: '[PR #1](https://github.com/intent-hq/cloudlands-fe/pull/1)',
        workspaceId: 'owning-workspace',
        forceExternalLinks: true,
      },
    });

    const link = await screen.findByRole('link', { name: 'PR #1' });
    await fireEvent.click(link);

    await waitFor(() =>
      expect(handleLink).toHaveBeenCalledWith(
        'https://github.com/intent-hq/cloudlands-fe/pull/1',
        expect.objectContaining({ forceExternal: true }),
      ),
    );
  });

  it('does not forward forceExternal by default', async () => {
    const MarkdownViewer = (await import('../MarkdownViewer.svelte')).default;
    render(MarkdownViewer, {
      props: {
        content: '[PR #1](https://github.com/intent-hq/cloudlands-fe/pull/1)',
        workspaceId: 'owning-workspace',
      },
    });

    const link = await screen.findByRole('link', { name: 'PR #1' });
    await fireEvent.click(link);

    await waitFor(() => expect(handleLink).toHaveBeenCalled());
    expect(handleLink.mock.calls[0]?.[1]).not.toHaveProperty('forceExternal');
  });

  it('forwards modified Enter for a focused markdown link', async () => {
    const MarkdownViewer = (await import('../MarkdownViewer.svelte')).default;
    render(MarkdownViewer, {
      props: { content: '[Open note](intent://local/note/spec)', workspaceId: 'owning-workspace' },
    });

    const link = await screen.findByRole('link', { name: 'Open note' });
    await fireEvent.keyDown(link, { key: 'Enter', ctrlKey: true });

    expect(handleLink).toHaveBeenCalledWith(
      expect.stringContaining('intent://local/note/spec'),
      expect.objectContaining({ event: expect.any(KeyboardEvent) }),
    );
  });
});
