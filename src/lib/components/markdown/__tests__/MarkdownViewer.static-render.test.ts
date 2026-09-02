/**
 * @vitest-environment jsdom
 *
 * Read-only markdown renders as static processed HTML — no ProseMirror
 * EditorView is constructed for chat transcript messages.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
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

  it('renders workspace videos inline and opens the video viewer in chat mode', async () => {
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

    await fireEvent.click(video);
    expect(screen.getByRole('dialog')).toBeTruthy();
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
