/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { splitWorkspaceVideoMarkdown } from './workspace-file-video';
import { processMarkdownToHTML } from './markdown-processor';

const WS = 'workspace-1';

describe('splitWorkspaceVideoMarkdown', () => {
  it.each([
    ['webm', 'video/webm'],
    ['mp4', 'video/mp4'],
  ] as const)('resolves saved %s assets without rewriting the source', (extension, mimeType) => {
    const url = `workspace-asset://${WS}/mfr7-1234abcd.${extension}?backend=remote-1&v=render-1`;
    expect(splitWorkspaceVideoMarkdown(`![demo](${url})`, WS)).toEqual([
      { type: 'video', name: 'demo', source: { kind: 'workspace', url, mimeType } },
    ]);
  });

  it('keeps saved images and code examples in markdown', () => {
    for (const markdown of [
      `![image](workspace-asset://${WS}/image.png)`,
      `\`\`\`md\n![demo](workspace-asset://${WS}/demo.webm)\n\`\`\``,
    ]) {
      expect(splitWorkspaceVideoMarkdown(markdown, WS)).toEqual([
        { type: 'markdown', content: markdown },
      ]);
    }
  });

  it.each([undefined, 'other-ws'])(
    'does not resolve saved video outside its workspace (%s)',
    (workspaceId) => {
      expect(
        splitWorkspaceVideoMarkdown(`![demo](workspace-asset://${WS}/demo.webm)`, workspaceId).some(
          (segment) => segment.type === 'video',
        ),
      ).toBe(false);
    },
  );

  it.each([
    ['cross-workspace', 'workspace-asset://other-ws/demo.webm', WS],
    ['unknown workspace', `workspace-asset://${WS}/demo.mp4`, undefined],
    ['traversal', `workspace-asset://${WS}/../demo.webm`, WS],
    ['encoded separator', `workspace-asset://${WS}/a%2Fdemo.mp4`, WS],
    ['malformed escape', `workspace-asset://${WS}/bad%zz.webm`, WS],
    ['duplicate backend', `workspace-asset://${WS}/demo.webm?backend=one&backend=two`, WS],
    ['invalid backend', `workspace-asset://${WS}/demo.mp4?backend=remote%2Fother`, WS],
    ['unknown query', `workspace-asset://${WS}/demo.webm?url=remote`, WS],
    ['fragment', `workspace-asset://${WS}/demo.mp4#fragment`, WS],
  ])(
    'cannot reload rejected %s video as an image in recursive markdown',
    async (_reason, src, workspaceId) => {
      const segments = splitWorkspaceVideoMarkdown(`![rejected](${src})`, workspaceId);
      expect(segments.some((segment) => segment.type === 'video')).toBe(false);
      for (const segment of segments) {
        if (segment.type !== 'markdown') continue;
        const element = document.createElement('div');
        element.innerHTML = await processMarkdownToHTML(segment.content, { workspaceId });
        expect(element.querySelector('img[src], video[src]')).toBeNull();
        expect(element.textContent).toContain('rejected');
      }
    },
  );

  it.each(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'tiff'])(
    'keeps saved %s images loadable through recursive markdown',
    async (extension) => {
      const src = `workspace-asset://${WS}/image.${extension}?backend=remote-1&v=render-1`;
      const [segment] = splitWorkspaceVideoMarkdown(`![image](${src})`, WS);
      expect(segment.type).toBe('markdown');
      if (segment.type !== 'markdown') throw new Error('Expected image markdown');
      const element = document.createElement('div');
      element.innerHTML = await processMarkdownToHTML(segment.content, { workspaceId: WS });
      expect(element.querySelector('img')?.getAttribute('src')).toBe(src);
      expect(element.querySelector('video')).toBeNull();
    },
  );

  it.each([
    ['webm', 'video/webm'],
    ['mp4', 'video/mp4'],
  ] as const)('resolves standalone %s images as workspace videos', (extension, mimeType) => {
    expect(
      splitWorkspaceVideoMarkdown(`![demo](intent://local/file/demo.${extension})`, WS),
    ).toEqual([
      {
        type: 'video',
        name: 'demo',
        source: { kind: 'workspace', url: `workspace-file://${WS}/demo.${extension}`, mimeType },
      },
    ]);
  });

  it('resolves the workspace-qualified form for the current workspace', () => {
    expect(splitWorkspaceVideoMarkdown(`![demo](intent://local/${WS}/file/demo.webm)`, WS)).toEqual(
      [
        {
          type: 'video',
          name: 'demo',
          source: {
            kind: 'workspace',
            url: `workspace-file://${WS}/demo.webm`,
            mimeType: 'video/webm',
          },
        },
      ],
    );
  });

  it('resolves a direct workspace-file video owned by the current workspace', () => {
    expect(splitWorkspaceVideoMarkdown(`![demo](workspace-file://${WS}/demo.webm)`, WS)).toEqual([
      {
        type: 'video',
        name: 'demo',
        source: {
          kind: 'workspace',
          url: `workspace-file://${WS}/demo.webm`,
          mimeType: 'video/webm',
        },
      },
    ]);
  });

  it('leaves workspace PNG image markdown unchanged', () => {
    const markdown = '![diagram](intent://local/file/diagram.png)';
    expect(splitWorkspaceVideoMarkdown(markdown, WS)).toEqual([
      { type: 'markdown', content: markdown },
    ]);
  });

  it('renders unsupported workspace media as a plain link', () => {
    expect(splitWorkspaceVideoMarkdown('![clip](intent://local/file/clip.mov)', WS)).toEqual([
      { type: 'markdown', content: '[clip](intent://local/file/clip.mov)' },
    ]);
  });

  it('rejects video links owned by another workspace', () => {
    expect(
      splitWorkspaceVideoMarkdown(
        '![private](intent://local/other-workspace/file/private.webm)',
        WS,
      ),
    ).toEqual([
      {
        type: 'markdown',
        content: '[private](intent://local/other-workspace/file/private.webm)',
      },
    ]);
  });

  it('does not load a direct workspace-file video owned by another workspace', () => {
    const markdown = '![private](workspace-file://other-workspace/private.webm)';
    expect(splitWorkspaceVideoMarkdown(markdown, WS)).toEqual([
      { type: 'markdown', content: '[private](workspace-file://other-workspace/private.webm)' },
    ]);
  });

  it.each([
    ['fenced code', '```markdown\n![demo](intent://local/file/demo.webm)\n```'],
    ['indented code', '    ![demo](intent://local/file/demo.webm)'],
    [
      'a rich block documented inside a longer fence',
      '````markdown\n```ws-block:video\n{"path":"demo.webm"}\n```\n````',
    ],
  ])('leaves video markdown in %s unchanged', (_description, markdown) => {
    expect(splitWorkspaceVideoMarkdown(markdown, WS)).toEqual([
      { type: 'markdown', content: markdown },
    ]);
  });

  it('resolves a top-level fenced video block', () => {
    expect(splitWorkspaceVideoMarkdown('```ws-block:video\n{"path":"demo.webm"}\n```', WS)).toEqual(
      [
        {
          type: 'video',
          name: 'demo.webm',
          poster: undefined,
          source: {
            kind: 'workspace',
            url: `workspace-file://${WS}/demo.webm`,
            mimeType: 'video/webm',
          },
        },
      ],
    );
  });
});
