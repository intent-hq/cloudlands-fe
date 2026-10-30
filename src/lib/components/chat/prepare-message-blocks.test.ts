import { describe, expect, it } from 'vitest';
import type { ContentBlock } from '$shared/types';
import {
  prepareMessageBlocks,
  rendersReasoningAsText,
  suggestedPromptsFromBlocks,
} from './prepare-message-blocks';

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

  it('does not let a hidden tool result claim a video source from a visible copy', () => {
    const source = { kind: 'remote' as const, url: 'https://media.example/recording.mp4' };
    const result = prepareMessageBlocks(
      [
        block({ type: 'tool_result', tool_use_id: 't1', output: [{ type: 'video', source }] }),
        block({ type: 'video', source }),
      ],
      { ...assistant, hideToolCalls: true },
    );
    expect(result.map((b) => b.type)).toEqual(['video']);
  });
});

const thinking = (value: string) => block({ type: 'thinking', text: value });
const PROMPTS = '<!-- suggested-prompts\nShip it.\nHold off.\n-->';

describe('rendersReasoningAsText', () => {
  it('is on for claude-code agents, including backup profiles', () => {
    expect(rendersReasoningAsText({ provider: 'claude-code' })).toBe(true);
    expect(rendersReasoningAsText({ provider: 'claude-code@backup-1' })).toBe(true);
  });

  it('is off for other providers and before the session loads', () => {
    expect(rendersReasoningAsText({ provider: 'codex' })).toBe(false);
    expect(rendersReasoningAsText({ provider: 'augment' })).toBe(false);
    expect(rendersReasoningAsText(undefined)).toBe(false);
    expect(rendersReasoningAsText(null)).toBe(false);
  });
});

describe('prepareMessageBlocks reasoningAsText', () => {
  it('keeps thinking as reasoning by default', () => {
    const result = prepareMessageBlocks([thinking('an update'), text('after')], assistant);
    expect(result.map((b) => b.type)).toEqual(['thinking', 'text']);
  });

  it('renders non-empty thinking as text, including legacy content-only blocks', () => {
    const result = prepareMessageBlocks(
      [thinking('an update'), block({ type: 'thinking', content: 'legacy update' })],
      { ...assistant, reasoningAsText: true },
    );
    expect(result.map((b) => [b.type, b.text])).toEqual([
      ['text', 'an update'],
      ['text', 'legacy update'],
    ]);
  });

  it('leaves empty and whitespace-only thinking as reasoning', () => {
    const result = prepareMessageBlocks([thinking(''), thinking('  \n'), text('after')], {
      ...assistant,
      reasoningAsText: true,
    });
    expect(result.map((b) => b.type)).toEqual(['thinking', 'thinking', 'text']);
  });

  it('strips a suggested-prompts block carried by converted thinking', () => {
    const result = prepareMessageBlocks([thinking(`Done.\n${PROMPTS}`)], {
      ...assistant,
      reasoningAsText: true,
    });
    expect(result).toHaveLength(1);
    expect(result[0].text?.trim()).toBe('Done.');
  });
});

describe('suggestedPromptsFromBlocks', () => {
  it('reads prompts from text blocks', () => {
    const prompts = suggestedPromptsFromBlocks([text(`Done.\n${PROMPTS}`)], false);
    expect(prompts).toEqual(['Ship it.', 'Hold off.']);
  });

  it('reads prompts from thinking the renderer shows as text', () => {
    const prompts = suggestedPromptsFromBlocks([thinking(`Done.\n${PROMPTS}`)], true);
    expect(prompts).toEqual(['Ship it.', 'Hold off.']);
  });

  it('ignores prompts inside thinking that stays a reasoning row', () => {
    expect(suggestedPromptsFromBlocks([thinking(`Done.\n${PROMPTS}`)], false)).toEqual([]);
  });
});
