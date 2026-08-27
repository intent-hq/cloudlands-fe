import { describe, expect, it } from 'vitest';
import type { ContentBlock, VideoContentBlock } from '../content-block';
import { dedupeAgentVideoContentBlocks, normalizeAgentVideoContentBlocks } from '../content-block';
import { isMediaBlock, isVideoBlock } from '../content-block.guards';

const block = (value: unknown) => value as ContentBlock;

describe('agent video content normalization', () => {
  it('normalizes inline file and resource blob video data', () => {
    const result = normalizeAgentVideoContentBlocks(
      [
        block({ type: 'file', data: 'bXA0', mimeType: 'video/mp4', fileName: 'demo.mp4' }),
        block({
          type: 'resource',
          resource: { uri: 'memory://clip', blob: 'd2VibQ==', mimeType: 'video/webm' },
        }),
      ],
      'assistant',
    ) as VideoContentBlock[];

    expect(result[0]).toEqual({
      type: 'video',
      fileName: 'demo.mp4',
      source: { kind: 'inline', data: 'bXA0', mimeType: 'video/mp4' },
    });
    expect(result[1].source).toEqual({
      kind: 'inline',
      data: 'd2VibQ==',
      mimeType: 'video/webm',
    });
    expect(isVideoBlock(result[0])).toBe(true);
    expect(isMediaBlock(result[0])).toBe(true);
  });

  it.each(['mp4', 'webm', 'mov', 'm4v'])('accepts HTTPS .%s resource links', (extension) => {
    const result = normalizeAgentVideoContentBlocks(
      [block({ type: 'resource_link', uri: `https://media.example/clip.${extension}?download=1` })],
      'assistant',
    );

    expect(result[0]).toMatchObject({
      type: 'video',
      source: { kind: 'remote', url: `https://media.example/clip.${extension}?download=1` },
    });
  });

  it('accepts an HTTPS resource identified by video MIME without an extension', () => {
    const result = normalizeAgentVideoContentBlocks(
      [
        block({
          type: 'resource',
          resource: {
            uri: 'https://media.example/download?id=7',
            mimeType: 'video/quicktime; codecs=hvc1',
            text: '',
          },
        }),
      ],
      'assistant',
    );

    expect((result[0] as VideoContentBlock).source).toEqual({
      kind: 'remote',
      url: 'https://media.example/download?id=7',
      mimeType: 'video/quicktime',
    });
  });

  it.each([
    [
      'intent://local/file/.demo-artifacts/run/frontend-preview.webm',
      'workspace-file://ws-1/.demo-artifacts/run/frontend-preview.webm',
      'video/webm',
    ],
    [
      'intent://local/ws-1/file/artifacts/demo%20clip.mp4',
      'workspace-file://ws-1/artifacts/demo%20clip.mp4',
      'video/mp4',
    ],
  ])('normalizes a trusted current-workspace video %s', (uri, url, mimeType) => {
    const result = normalizeAgentVideoContentBlocks(
      [block({ type: 'resource_link', uri, name: 'preview' })],
      'assistant',
      'ws-1',
    );

    expect(result[0]).toMatchObject({
      type: 'video',
      source: { kind: 'workspace', url, mimeType },
    });
  });

  it.each([
    'intent://local/ws-2/file/demo.webm',
    'intent://local/file/../demo.webm',
    'intent://local/file/demo.mov',
    'workspace-file://ws-1/demo.webm',
    'file:///tmp/demo.webm',
  ])('does not normalize unsafe or unsupported local video %s', (uri) => {
    const original = block({ type: 'resource_link', uri });
    const input = [original];

    expect(normalizeAgentVideoContentBlocks(input, 'assistant', 'ws-1')).toBe(input);
  });

  it('requires an explicit current workspace before normalizing a local video', () => {
    const original = block({ type: 'resource_link', uri: 'intent://local/file/demo.webm' });
    const input = [original];

    expect(normalizeAgentVideoContentBlocks(input, 'assistant')).toBe(input);
  });

  it.each([
    { type: 'resource_link', uri: 'http://media.example/clip.mp4' },
    { type: 'resource_link', uri: 'not a URL', mimeType: 'video/mp4' },
    { type: 'resource_link', uri: 'https://user:pass@media.example/clip.mp4' },
    { type: 'resource_link', uri: 'https://media.example/readme.txt', mimeType: 'text/plain' },
    { type: 'resource_link', uri: 'https://media.example/download', mimeType: 'video/avi' },
    { type: 'file', data: 42, mimeType: 'video/mp4' },
    { type: 'file', data: 'bytes', mimeType: 'audio/mp4' },
  ])('preserves unsafe, malformed, or unsupported input: $uri', (value) => {
    const original = block(value);
    const input = [original];
    const result = normalizeAgentVideoContentBlocks(input, 'assistant');

    expect(result).toBe(input);
    expect(result[0]).toBe(original);
  });

  it('normalizes video items nested in tool-result output arrays', () => {
    const result = normalizeAgentVideoContentBlocks(
      [
        block({
          type: 'tool_result',
          tool_use_id: 'tool-1',
          output: [
            { type: 'text', text: 'Recording' },
            { type: 'resource_link', uri: 'https://media.example/recording.webm' },
          ],
        }),
      ],
      'assistant',
    );

    expect((result[0].output as ContentBlock[])[1]).toMatchObject({
      type: 'video',
      source: { kind: 'remote', url: 'https://media.example/recording.webm' },
    });
  });

  it('deduplicates normalized video sources across top-level and nested output', () => {
    const source = { kind: 'remote' as const, url: 'https://media.example/recording.mp4' };
    const result = dedupeAgentVideoContentBlocks([
      block({ type: 'video', source }),
      block({ type: 'tool_result', output: [{ type: 'video', source }] }),
    ]);

    expect(result).toHaveLength(2);
    expect(result[1].output).toEqual([]);
  });

  it.each(['user', 'system', 'error'] as const)('does not normalize %s-role content', (role) => {
    const original = block({
      type: 'file',
      data: 'bXA0',
      mimeType: 'video/mp4',
      fileName: 'upload.mp4',
    });
    const input = [original];

    expect(normalizeAgentVideoContentBlocks(input, role)).toBe(input);
  });
});
