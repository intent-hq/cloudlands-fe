import { describe, expect, it } from 'vitest';

import type { ContentBlock } from '$shared/types';
import type { HydratedBlockEntry } from '$store/renderer/slices/chat-state/chat-state-types';
import { hydratedBlockKey } from '$store/renderer/slices/chat-state/chat-state-types';
import { mergeHydratedContent } from './block-hydration';

const MSG = 'msg-1';

function cache(blockId: string, entry: Omit<HydratedBlockEntry & { status: 'loaded' }, 'seq'>) {
  return { [hydratedBlockKey(MSG, blockId)]: { ...entry, seq: 1 } as HydratedBlockEntry };
}

describe('mergeHydratedContent capped reads (§5.5, messageBlockPages: 1)', () => {
  const slimResult: ContentBlock = {
    type: 'tool_result',
    id: 'msg-1:1',
    output: 'preview',
    outputTruncated: true,
    outputBytes: 3_200_000,
  };

  it('substitutes a whole block unchanged', () => {
    const full: ContentBlock = { type: 'tool_result', id: 'msg-1:1', output: 'full' };
    const [merged] = mergeHydratedContent(
      [slimResult],
      MSG,
      cache('msg-1:1', { status: 'loaded', block: full }),
    );
    expect(merged).toBe(full);
  });

  it('shows a cut text body with its sizes', () => {
    const [merged] = mergeHydratedContent(
      [slimResult],
      MSG,
      cache('msg-1:1', {
        status: 'loaded',
        block: { type: 'tool_result', id: 'msg-1:1', output: 'first part' },
        truncation: {
          field: 'output',
          encoding: 'text',
          shownBytes: 480_000,
          totalBytes: 3_200_000,
        },
      }),
    );
    expect(merged).toEqual({
      type: 'tool_result',
      id: 'msg-1:1',
      output: 'first part',
      servedTruncation: { shownBytes: 480_000, totalBytes: 3_200_000 },
    });
  });

  it('keeps the structured slim preview when a JSON body was cut into text', () => {
    const slimUse: ContentBlock = {
      type: 'tool_use',
      id: 'msg-1:0',
      name: 'write',
      input: { path: 'a.txt' },
      inputTruncated: true,
    };
    const [merged] = mergeHydratedContent(
      [slimUse],
      MSG,
      cache('msg-1:0', {
        status: 'loaded',
        block: { type: 'tool_use', id: 'msg-1:0', name: 'write', input: '{"path":"a.t' as never },
        truncation: { field: 'input', encoding: 'json', shownBytes: 12, totalBytes: 900_000 },
      }),
    );
    expect(merged).toEqual({
      ...slimUse,
      servedTruncation: { shownBytes: null, totalBytes: 900_000 },
    });
  });

  it('keeps the thumbnail of an over-cap image', () => {
    const slimImage: ContentBlock = {
      type: 'image',
      id: 'msg-1:2',
      data: 'dGh1bWI=',
      mimeType: 'image/png',
      dataTruncated: true,
      dataIsThumbnail: true,
    };
    const [merged] = mergeHydratedContent(
      [slimImage],
      MSG,
      cache('msg-1:2', {
        status: 'loaded',
        block: {
          type: 'image',
          id: 'msg-1:2',
          mimeType: 'image/png',
          dataTruncated: true,
          dataBytes: 900_000,
        },
        truncation: { field: 'data', encoding: null, shownBytes: null, totalBytes: 900_000 },
      }),
    );
    expect(merged).toEqual({
      ...slimImage,
      servedTruncation: { shownBytes: null, totalBytes: 900_000 },
    });
  });
});
