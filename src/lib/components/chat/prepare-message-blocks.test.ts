import { describe, expect, it } from 'vitest';
import type { ContentBlock } from '$shared/types';
import { prepareMessageBlocks } from './prepare-message-blocks';

const block = (value: unknown) => value as ContentBlock;

const resource = block({
  type: 'resource',
  resource: {
    uri: 'intent-card://generic/1',
    name: 'Generic',
    mimeType: 'application/vnd.intent.other+json',
    text: JSON.stringify({ a: 1 }),
  },
});
const question = block({
  type: 'resource',
  resource: { uri: 'intent://question/q-1', mimeType: 'application/vnd.intent.question+json' },
});
const inlineVideo = () =>
  block({ type: 'file', data: 'bXA0', mimeType: 'video/mp4', fileName: 'demo.mp4' });
const text = (value: string) => block({ type: 'text', text: value });

const assistant = { role: 'assistant' as const, isStreaming: false };

describe('prepareMessageBlocks', () => {
  it('keeps one card per duplicated resource', () => {
    const result = prepareMessageBlocks([resource, { ...resource }, text('after')], assistant);
    expect(result.map((b) => b.type)).toEqual(['resource', 'text']);
  });

  it('normalizes assistant videos and drops repeated sources', () => {
    const result = prepareMessageBlocks([inlineVideo(), inlineVideo(), text('after')], assistant);
    expect(result.map((b) => b.type)).toEqual(['video', 'text']);
  });

  it('leaves user attachments untouched by video normalization', () => {
    const result = prepareMessageBlocks([inlineVideo(), inlineVideo()], {
      role: 'user',
      isStreaming: false,
    });
    expect(result.map((b) => b.type)).toEqual(['file', 'file']);
  });

  it('drops wizard-only question cards', () => {
    const result = prepareMessageBlocks([question, text('visible')], assistant);
    expect(result).toEqual([text('visible')]);
  });

  it('drops empty, whitespace-only and suggested-prompts-only text', () => {
    const result = prepareMessageBlocks(
      [text(''), text('  \n '), text('<!-- suggested-prompts\nDo the thing.\n-->'), text('kept')],
      assistant,
    );
    expect(result.map((b) => b.text)).toEqual(['kept']);
  });

  it('keeps text that only carries the legacy content field', () => {
    const legacy = block({ type: 'text', content: 'legacy body' });
    expect(prepareMessageBlocks([legacy], assistant)).toHaveLength(1);
  });

  it('keeps only the last tool_use for each id', () => {
    const skeleton = block({ type: 'tool_use', id: 't1', name: 'view', input: {} });
    const final = block({ type: 'tool_use', id: 't1', name: 'view', input: { path: 'a.ts' } });
    const other = block({ type: 'tool_use', id: 't2', name: 'view', input: {} });
    const result = prepareMessageBlocks([skeleton, other, final], assistant);
    expect(result).toEqual([other, final]);
  });

  it('hides tool rows only when asked', () => {
    const blocks = [
      block({ type: 'tool_use', id: 't1', name: 'view', input: {} }),
      block({ type: 'tool_result', tool_use_id: 't1', output: 'ok' }),
      text('prose'),
    ];
    expect(prepareMessageBlocks(blocks, assistant)).toHaveLength(3);
    expect(
      prepareMessageBlocks(blocks, { ...assistant, hideToolCalls: true }).map((b) => b.type),
    ).toEqual(['text']);
  });
});
