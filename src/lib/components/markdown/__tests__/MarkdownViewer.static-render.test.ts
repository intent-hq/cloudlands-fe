/**
 * @vitest-environment jsdom
 *
 * Read-only markdown renders as static processed HTML — no ProseMirror
 * EditorView is constructed for chat transcript messages.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import MarkdownViewer from '../MarkdownViewer.svelte';

describe('MarkdownViewer static rendering', () => {
  it('renders plain text through the simple path', () => {
    const { container } = render(MarkdownViewer, {
      props: { content: 'just plain text with no markdown' },
    });
    expect(container.querySelector('.simple-content')).toBeTruthy();
    expect(container.querySelector('.ProseMirror')).toBeNull();
  });

  it('renders task lists as static HTML without a ProseMirror view', async () => {
    const { container } = render(MarkdownViewer, {
      props: { content: '- [ ] open item\n- [x] done item' },
    });

    await waitFor(() => {
      const items = container.querySelectorAll('li[data-type="taskItem"]');
      expect(items.length).toBe(2);
    });

    expect(container.querySelector('.static-content')).toBeTruthy();
    expect(container.querySelector('.ProseMirror')).toBeNull();

    const checkboxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(checkboxes.length).toBe(2);
    expect(checkboxes[0]?.checked).toBe(false);
    expect(checkboxes[1]?.checked).toBe(true);
    // Read-only: static checkboxes must be disabled so they are not
    // focusable/toggleable via keyboard
    expect(checkboxes[0]?.disabled).toBe(true);
    expect(checkboxes[1]?.disabled).toBe(true);
  });

  it('renders tables as static HTML without a ProseMirror view', async () => {
    const { container } = render(MarkdownViewer, {
      props: { content: '| a | b |\n| --- | --- |\n| 1 | 2 |' },
    });

    await waitFor(() => expect(container.querySelector('table')).toBeTruthy());
    expect(container.querySelector('.static-content')).toBeTruthy();
    expect(container.querySelector('.ProseMirror')).toBeNull();
  });

  it('renders fenced code blocks as static HTML', async () => {
    const { container } = render(MarkdownViewer, {
      props: { content: '```ts\nconst x = 1;\n```' },
    });

    await waitFor(() => expect(container.querySelector('pre code')).toBeTruthy());
    expect(container.querySelector('.ProseMirror')).toBeNull();
    expect(container.querySelector('pre code')?.textContent).toContain('const x = 1;');
  });

  it('leaves workspace video clicks to the native controls in chat mode', async () => {
    const { container } = render(MarkdownViewer, {
      props: {
        content: '![demo](intent://local/file/out/demo.mp4)',
        workspaceId: 'ws-abc',
        chatImageThumbnails: true,
      },
    });

    const video = await waitFor(() => {
      const element = container.querySelector<HTMLVideoElement>('video.markdown-video');
      expect(element).toBeTruthy();
      return element!;
    });
    expect(video.controls).toBe(true);
    expect(video.getAttribute('src')).toBe('workspace-file://ws-abc/out/demo.mp4');

    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    expect(video.dispatchEvent(click)).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it.each(['Enter', ' '])('opens workspace image lightbox with %s', async (key) => {
    const { container } = render(MarkdownViewer, {
      props: {
        content: '![diagram](intent://local/file/docs/diagram.png)',
        workspaceId: 'ws-abc',
      },
    });
    const image = await waitFor(() => {
      const element = container.querySelector<HTMLImageElement>('img');
      expect(element).toBeTruthy();
      return element!;
    });

    await fireEvent.keyDown(image, { key });

    expect(screen.getByRole('dialog', { name: /image preview/i })).toBeTruthy();
  });

  it('offers image actions for a note workspace asset without chat thumbnails', async () => {
    const { container } = render(MarkdownViewer, {
      props: { content: '![note image](workspace-asset://asset-123)' },
    });
    const image = await waitFor(() => {
      const element = container.querySelector<HTMLImageElement>('img');
      expect(element).toBeTruthy();
      return element!;
    });

    await waitFor(() => expect(image.tabIndex).toBe(0));
    image.focus();
    const trigger = await screen.findByRole('button', { name: /image options/i });
    await fireEvent.keyDown(trigger, { key: 'ArrowDown' });

    expect(await screen.findByRole('menuitem', { name: /copy image/i })).toBeTruthy();
  });

  it('replaces a missing workspace image with its file placeholder and actions', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    const { container } = render(MarkdownViewer, {
      props: {
        content: '![missing](intent://local/file/out/missing%20image.png)',
        workspaceId: 'ws-abc',
      },
    });
    await waitFor(() => expect(container.querySelector('img')).toBeTruthy());
    const image = container.querySelector<HTMLImageElement>('img')!;

    await fireEvent.error(image);

    expect(screen.getByRole('status').textContent).toContain('File is missing');
    await fireEvent.click(screen.getByRole('button', { name: /copy path/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('out/missing image.png'));
  });

  it('replaces unsupported workspace media with an unsupported placeholder', async () => {
    render(MarkdownViewer, {
      props: {
        content: '![logo](intent://local/file/assets/logo.svg)',
        workspaceId: 'ws-abc',
      },
    });

    const status = await screen.findByRole('status');
    expect(status.textContent).toContain('logo');
    expect(status.textContent).toContain('not supported');
    expect(screen.getByRole('button', { name: /open file/i })).toBeTruthy();
  });

  it('replaces a missing workspace video with its file placeholder', async () => {
    const { container } = render(MarkdownViewer, {
      props: {
        content: '![demo](intent://local/file/out/demo.mp4)',
        workspaceId: 'ws-abc',
      },
    });
    await waitFor(() => expect(container.querySelector('video')).toBeTruthy());
    const video = container.querySelector<HTMLVideoElement>('video')!;

    await fireEvent.error(video);

    const status = screen.getByRole('status');
    expect(status.textContent).toContain('demo');
    expect(status.textContent).toContain('File is missing');
  });

  it('renders Mermaid fenced blocks as visible source when requested', async () => {
    const { container } = render(MarkdownViewer, {
      props: {
        content: '```mermaid\nflowchart LR\n  A --> B\n```',
        renderRichFencesAsCode: true,
      },
    });

    await waitFor(() => expect(container.querySelector('code.language-mermaid')).toBeTruthy());
    expect(container.querySelector('code.language-mermaid')?.textContent).toContain('A --> B');
    expect(container.querySelector('[data-type="mermaid-block"]')).toBeNull();
  });

  it('renders diff fenced blocks as visible source when requested', async () => {
    const { container } = render(MarkdownViewer, {
      props: {
        content: '```diff\n-old\n+new\n```',
        renderRichFencesAsCode: true,
      },
    });

    await waitFor(() => expect(container.querySelector('code.language-diff')).toBeTruthy());
    expect(container.querySelector('code.language-diff')?.textContent).toContain('-old\n+new');
    expect(container.querySelector('[data-type="diff-block"]')).toBeNull();
  });

  it('mounts a video component for standalone workspace video markdown', async () => {
    const { container } = render(MarkdownViewer, {
      props: {
        content: '![demo](intent://local/file/.demo-artifacts/demo.webm)',
        workspaceId: 'workspace-1',
      },
    });

    await waitFor(() => expect(container.querySelector('[data-chat-video]')).toBeTruthy());
  });

  it('renders unsupported workspace media as a link instead of an image', async () => {
    const { container } = render(MarkdownViewer, {
      props: {
        content: '![demo](intent://local/file/.demo-artifacts/demo.mov)',
        workspaceId: 'workspace-1',
      },
    });

    await waitFor(() => expect(container.querySelector('a')).toBeTruthy());
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[data-chat-video]')).toBeNull();
  });
});
