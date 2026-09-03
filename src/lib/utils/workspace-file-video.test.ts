import { describe, expect, it } from 'vitest';
import { splitWorkspaceVideoMarkdown } from './workspace-file-video';

const WS = 'workspace-1';

describe('splitWorkspaceVideoMarkdown', () => {
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
