/**
 * @vitest-environment jsdom
 *
 * Read-only markdown renders as static processed HTML — no ProseMirror
 * EditorView is constructed for chat transcript messages.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MarkdownViewer from '../MarkdownViewer.svelte';

const imageSources = [
  'workspace-asset://asset-123',
  'https://example.com/diagram.png',
  'data:image/png;base64,iVBORw0KGgo=',
];

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('MarkdownViewer static rendering', () => {
  it('renders plain text through the simple path', () => {
    const { container } = render(MarkdownViewer, {
      props: { content: 'just plain text with no markdown' },
    });
    expect(container.querySelector('.simple-content')).toBeTruthy();
    expect(container.querySelector('.ProseMirror')).toBeNull();
  });

  it.each([
    ['$x^2$', false],
    [String.raw`\(x^2\)`, false],
    [String.raw`$$\frac{1}{2}$$`, true],
    [String.raw`\[\sqrt{x}\]`, true],
  ])('renders math-only read-only content for %s', async (content, displayMode) => {
    const { container } = render(MarkdownViewer, { props: { content } });

    const math = await waitFor(() => {
      const element = container.querySelector('math');
      expect(element).toBeTruthy();
      return element!;
    });
    expect(math.closest(displayMode ? '.math-display' : '.math-inline')).toBeTruthy();
    expect(container.querySelector('.ProseMirror')).toBeNull();
  });

  it.each([
    ['ordinary prices', 'Costs $5 and $10'],
    ['escaped delimiters', String.raw`Literal \$x$ and \\(y\\)`],
    ['inline code', '`$x^2$`'],
    ['unfinished math', String.raw`Before \(x + 1`],
  ])('keeps %s literal', async (_case, content) => {
    const { container } = render(MarkdownViewer, { props: { content } });

    await waitFor(() => expect(container.textContent).toContain(content.replace(/`/g, '')));
    expect(container.querySelector('math')).toBeNull();
  });

  it('renders math only after streaming content completes', async () => {
    const content = String.raw`Answer: $x^2$`;
    const view = render(MarkdownViewer, { props: { content, isStreaming: true } });

    await waitFor(() => expect(view.container.textContent).toContain('$x^2$'));
    expect(view.container.querySelector('math')).toBeNull();

    await view.rerender({ content, isStreaming: false });
    await waitFor(() => expect(view.container.querySelector('math')).toBeTruthy());
  });

  it('reclassifies mounted content between plain text, math and task lists', async () => {
    const view = render(MarkdownViewer, { props: { content: '' } });
    expect(view.container.querySelector('math')).toBeNull();

    await view.rerender({ content: '$x^2$' });
    await waitFor(() => expect(view.container.querySelector('math')).toBeTruthy());

    await view.rerender({ content: 'Costs $5 and $10' });
    await waitFor(() => expect(view.container.textContent).toContain('Costs $5 and $10'));
    expect(view.container.querySelector('math')).toBeNull();

    await view.rerender({ content: '- [x] completed' });
    await waitFor(() => {
      const checkbox = view.container.querySelector<HTMLInputElement>('input[type="checkbox"]');
      expect(checkbox?.checked).toBe(true);
      expect(checkbox?.disabled).toBe(true);
    });

    await view.rerender({ content: 'plain end' });
    await waitFor(() => expect(view.container.textContent).toContain('plain end'));
    expect(view.container.querySelector('input')).toBeNull();
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

  it('renders a workspace video once with the accessible snapshot and modal player', async () => {
    const { container } = render(MarkdownViewer, {
      props: {
        content: '![demo](intent://local/file/out/demo.mp4)',
        workspaceId: 'ws-abc',
        chatImageThumbnails: true,
      },
    });

    const snapshot = await screen.findByRole('button', { name: /play demo/i });
    expect(container.querySelectorAll('[data-chat-video]')).toHaveLength(1);
    expect(container.querySelector('video')?.getAttribute('src')).toBe(
      'workspace-file://ws-abc/out/demo.mp4',
    );

    await fireEvent.click(snapshot);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByTestId('chat-video-player')).toBeTruthy();
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

  it.each(['webm', 'mp4'])(
    'opens a saved %s asset in the video player without file routing',
    async (extension) => {
      const src = `workspace-asset://ws-abc/mfr7-1234abcd.${extension}?backend=remote-1`;
      const { container } = render(MarkdownViewer, {
        props: {
          content: `![saved demo](${src})`,
          workspaceId: 'ws-abc',
          chatImageThumbnails: true,
        },
      });
      const trigger = await screen.findByRole('button', { name: /play saved demo/i });
      expect(container.querySelector('img')).toBeNull();
      await fireEvent.click(trigger);
      const player = screen.getByTestId('chat-video-player') as HTMLVideoElement;
      expect(player.src).toBe(src);
      expect(player.controls).toBe(true);
      expect(player.autoplay).toBe(false);
    },
  );

  it.each([false, true])(
    'opens image actions on right-click with streaming=%s',
    async (isStreaming) => {
      render(MarkdownViewer, {
        props: {
          content: '![diagram](data:image/png;base64,iVBORw0KGgo=)\n\nOther content.',
          isStreaming,
        },
      });
      const image = await screen.findByRole('button', { name: 'diagram' });
      expect(await fireEvent.contextMenu(screen.getByText('Other content.'))).toBe(true);
      expect(screen.queryByRole('menu')).toBeNull();
      expect(await fireEvent.contextMenu(image)).toBe(false);
      expect(await screen.findByRole('menuitem', { name: /download/i })).toBeTruthy();
      expect(screen.queryByRole('dialog')).toBeNull();
      await fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
      await fireEvent.click(image);
      expect(await screen.findByRole('dialog', { name: /image preview/i })).toBeTruthy();
    },
  );

  it.each(imageSources)('offers keyboard image actions for %s', async (src) => {
    const { container } = render(MarkdownViewer, {
      props: { content: `![note image](${src})` },
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

  it.each(imageSources)('keeps %s actions interactive across streaming updates', async (src) => {
    const content = `![streamed image](${src})`;
    const view = render(MarkdownViewer, { props: { content, isStreaming: true } });
    const image = await waitFor(() => {
      const element = view.container.querySelector<HTMLImageElement>('img');
      expect(element?.tabIndex).toBe(0);
      return element!;
    });
    image.focus();
    const trigger = await screen.findByRole('button', { name: /image options/i });
    await fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(await screen.findByRole('menuitem', { name: /copy image/i })).toBeTruthy();

    await fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    await view.rerender({ content: content + '\n\nA new streamed paragraph.' });
    await waitFor(() => expect(view.container.textContent).toContain('A new streamed paragraph.'));
    expect(trigger.isConnected).toBe(true);
    await fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(await screen.findByRole('menuitem', { name: /copy image/i })).toBeTruthy();
  });

  it('keeps keyboard image actions reachable when the pointer leaves', async () => {
    const { container } = render(MarkdownViewer, {
      props: { content: '![diagram](https://example.com/diagram.png)\n\nOther content.' },
    });
    const image = await screen.findByRole('button', { name: 'diagram' });
    image.focus();
    const trigger = await screen.findByRole('button', { name: /image options/i });

    await fireEvent.mouseOver(screen.getByText('Other content.'));
    await fireEvent.mouseLeave(container.querySelector('.markdown-viewer')!);
    expect(trigger.isConnected).toBe(true);
    trigger.focus();
    await fireEvent.mouseLeave(container.querySelector('.markdown-viewer')!);
    expect(document.activeElement).toBe(trigger);
    await fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(await screen.findByRole('menuitem', { name: /copy image/i })).toBeTruthy();
  });

  it.each(imageSources)('previews %s with the keyboard and restores image focus', async (src) => {
    const { container } = render(MarkdownViewer, { props: { content: `![preview](${src})` } });
    const image = await waitFor(() => {
      const element = container.querySelector<HTMLImageElement>('img');
      expect(element?.tabIndex).toBe(0);
      return element!;
    });
    image.focus();
    await fireEvent.keyDown(image, { key: 'Enter' });
    const dialog = await screen.findByRole('dialog', { name: /image preview/i });
    expect(dialog.querySelector('img')?.getAttribute('src')).toBe(src);
    await fireEvent.click(screen.getByRole('button', { name: /close preview/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(image);
  });

  it.each(['http://example.com/image.png', 'file:///tmp/image.png', 'blob:untrusted'])(
    'does not add image actions or preview to unsupported %s',
    async (src) => {
      const { container } = render(MarkdownViewer, {
        props: { content: `![unsupported](${src})\n\nrender complete` },
      });
      await screen.findByText('render complete');
      const image = container.querySelector<HTMLImageElement>('img');
      if (image) {
        expect(image.tabIndex).toBe(-1);
        expect(await fireEvent.contextMenu(image)).toBe(true);
        expect(screen.queryByRole('menu')).toBeNull();
        await fireEvent.mouseOver(image);
        await fireEvent.click(image);
        await fireEvent.keyDown(image, { key: 'Enter' });
      }
      expect(screen.queryByRole('button', { name: /image options/i })).toBeNull();
      expect(screen.queryByRole('dialog')).toBeNull();
    },
  );

  it.each([
    ['recursive', 'workspace-asset://other-ws/demo.webm', 'ws-abc'],
    ['inline', 'workspace-asset://ws-abc/demo.mp4?backend=bad%2Froute', 'ws-abc'],
    ['static', 'workspace-asset://ws-abc/../demo.mp4', 'ws-abc'],
    ['unknown workspace', 'workspace-asset://ws-abc/demo.webm', undefined],
  ])('keeps rejected saved videos inert in %s rendering', async (mode, src, workspaceId) => {
    const validSrc = 'workspace-asset://ws-abc/valid.mp4';
    const markdown = `![rejected](${src})`;
    const { container } = render(MarkdownViewer, {
      props: {
        content:
          mode === 'recursive'
            ? `![valid](${validSrc})\n\n${markdown}\n\nrender complete`
            : `Recording: ${markdown}\n\nrender complete`,
        workspaceId,
        chatImageThumbnails: mode === 'recursive',
      },
    });
    await screen.findByText('render complete');
    const sources = Array.from(container.querySelectorAll('img[src], video[src]'), (node) =>
      node.getAttribute('src'),
    );
    expect(sources).toEqual(mode === 'recursive' ? [validSrc] : []);
  });

  it.each(['webm', 'mp4'])(
    'retains download recovery for a failed inline saved %s video',
    async (extension) => {
      const src = `workspace-asset://ws-abc/mfr7-1234abcd.${extension}?backend=remote-1`;
      const fetchVideo = vi
        .fn()
        .mockResolvedValue({ ok: true, blob: async () => new Blob(['video']) });
      vi.stubGlobal('fetch', fetchVideo);
      vi.stubGlobal(
        'URL',
        Object.assign(URL, {
          createObjectURL: vi.fn(() => 'blob:saved-video'),
          revokeObjectURL: vi.fn(),
        }),
      );
      const anchorClick = vi
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => {});
      const { container } = render(MarkdownViewer, {
        props: { content: `Here is the recording: ![saved demo](${src})`, workspaceId: 'ws-abc' },
      });
      await waitFor(() => expect(container.querySelector('video')).toBeTruthy());
      await fireEvent.error(container.querySelector('video')!);
      expect(screen.getByTestId('media-unavailable').dataset.reason).toBe('load-failed');
      expect(screen.queryByRole('button', { name: /open file|copy path/i })).toBeNull();
      const trigger = screen.getByRole('button', { name: /video options/i });
      trigger.focus();
      await fireEvent.keyDown(trigger, { key: 'ArrowDown' });
      await fireEvent.click(await screen.findByRole('menuitem', { name: /download/i }));
      await waitFor(() => expect(anchorClick).toHaveBeenCalledOnce());
      expect(fetchVideo).toHaveBeenCalledWith(src);
      expect((anchorClick.mock.instances[0] as HTMLAnchorElement).download).toBe(
        `saved demo.${extension}`,
      );
    },
  );

  it('preserves file actions without claiming an image load error proves absence', async () => {
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

    expect(screen.getByTestId('media-unavailable').dataset.reason).toBe('load-failed');
    await fireEvent.click(screen.getByRole('button', { name: /copy path/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('out/missing image.png'));
  });

  it('does not label a workspace video load error as a missing file', async () => {
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
    expect(status.dataset.reason).toBe('load-failed');
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

  it('renders a placeholder instead of a raw intent:// image when the workspace is unknown', async () => {
    const { container } = render(MarkdownViewer, {
      props: {
        content: 'Latest chart: ![chart](intent://local/file/charts/bridge_tracking.png)',
      },
    });

    const status = await screen.findByRole('status');
    expect(status.textContent).toContain('chart');
    expect(status.textContent).toContain('Media could not load');
    expect(container.querySelector('img[src^="intent://"]')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
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
