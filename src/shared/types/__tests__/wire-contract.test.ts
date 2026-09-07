/**
 * Wire-contract tests for AUDIT-P1-5.
 *
 * Drives PROTOCOL.md §5.5 / §7 shaped payloads through the renderer's strict
 * intake utilities. The renderer is a thin presenter: a canonical wire payload
 * MUST pass through unchanged, and a divergent payload (legacy field aliases or
 * missing required fields) MUST surface as a thrown error so the BE \u2014 not the
 * FE \u2014 is corrected at the source.
 */

import { describe, it, expect } from 'vitest';
import { migrateFromLegacy, migrateContentBlocks } from '../content-block.migration';
import { normalizeAgentMessage } from '../agent-message.conversion';

describe('PROTOCOL.md §7 ContentBlock wire contract', () => {
  it('passes a canonical text block through unchanged', () => {
    const wire = { type: 'text', id: 'blk_1', text: 'hello' };
    const out = migrateFromLegacy(wire);
    expect(out).toEqual(wire);
  });

  it('passes a canonical tool_use block through unchanged', () => {
    const wire = {
      type: 'tool_use',
      id: 'blk_2',
      name: 'read_file',
      input: { path: 'foo.ts' },
      toolCallId: 'tc_1',
    };
    const out = migrateFromLegacy(wire);
    expect(out).toEqual(wire);
  });

  it('passes a canonical tool_result block through unchanged', () => {
    const wire = {
      type: 'tool_result',
      id: 'blk_3',
      tool_use_id: 'tc_1',
      output: { stdout: 'ok' },
      is_error: false,
    };
    const out = migrateFromLegacy(wire);
    expect(out).toEqual(wire);
  });

  it.each([
    {
      label: 'full image',
      wire: { type: 'image', id: 'img-full', data: 'AAAA', mimeType: 'image/png' },
    },
    {
      label: 'slim thumbnail',
      wire: {
        type: 'image',
        id: 'img-thumbnail',
        data: 'BBBB',
        mimeType: 'image/webp',
        dataTruncated: true,
        dataIsThumbnail: true,
        dataBytes: 8192,
      },
    },
    {
      label: 'zero-byte slim thumbnail',
      wire: {
        type: 'image',
        id: 'img-zero-thumbnail',
        data: 'BBBB',
        mimeType: 'image/webp',
        dataTruncated: true,
        dataIsThumbnail: true,
        dataBytes: 0,
      },
    },
    {
      label: 'legacy slim placeholder',
      wire: {
        type: 'image',
        id: 'img-placeholder',
        mimeType: 'image/jpeg',
        dataTruncated: true,
        dataBytes: 16384,
      },
    },
    {
      label: 'zero-byte legacy slim placeholder',
      wire: {
        type: 'image',
        id: 'img-zero-placeholder',
        mimeType: 'image/jpeg',
        dataTruncated: true,
        dataBytes: 0,
      },
    },
  ])('passes a protocol-valid $label through unchanged', ({ wire }) => {
    expect(migrateFromLegacy(wire)).toEqual(wire);
  });

  it.each([
    ['data omitted without slim metadata', { type: 'image', mimeType: 'image/png' }],
    ['missing MIME type', { type: 'image', data: 'AAAA' }],
    ['empty MIME type', { type: 'image', data: 'AAAA', mimeType: '' }],
    ['non-image MIME type', { type: 'image', data: 'AAAA', mimeType: 'text/plain' }],
    [
      'thumbnail marker without truncation',
      { type: 'image', data: 'AAAA', mimeType: 'image/png', dataIsThumbnail: true },
    ],
    [
      'truncated data without thumbnail marker',
      {
        type: 'image',
        data: 'AAAA',
        mimeType: 'image/png',
        dataTruncated: true,
        dataBytes: 8192,
      },
    ],
    [
      'placeholder with thumbnail marker',
      {
        type: 'image',
        mimeType: 'image/png',
        dataTruncated: true,
        dataIsThumbnail: true,
        dataBytes: 8192,
      },
    ],
    [
      'truncated placeholder without byte count',
      { type: 'image', mimeType: 'image/png', dataTruncated: true },
    ],
    [
      'truncated placeholder with fractional byte count',
      { type: 'image', mimeType: 'image/png', dataTruncated: true, dataBytes: 3.5 },
    ],
    [
      'truncated placeholder with negative byte count',
      { type: 'image', mimeType: 'image/png', dataTruncated: true, dataBytes: -1 },
    ],
    [
      'full image with orphan byte count',
      { type: 'image', data: 'AAAA', mimeType: 'image/png', dataBytes: 4 },
    ],
    [
      'explicit false truncation flag',
      { type: 'image', data: 'AAAA', mimeType: 'image/png', dataTruncated: false },
    ],
  ])('rejects an image with %s', (_label, wire) => {
    expect(() => migrateFromLegacy(wire)).toThrow(/image block/);
  });

  it('strips provider metadata from an otherwise valid bounded plan snapshot', () => {
    const wire = {
      type: 'plan',
      id: 'blk_plan',
      entries: [
        {
          content: 'Inspect the code',
          priority: 'high',
          status: 'completed',
          _meta: { provider: 'codex' },
          providerExtension: { traceId: 'provider-only' },
        },
      ],
    };
    expect(migrateFromLegacy(wire)).toEqual({
      type: 'plan',
      id: 'blk_plan',
      entries: [{ content: 'Inspect the code', priority: 'high', status: 'completed' }],
    });
  });

  it('rejects a plan snapshot with an unsupported entry value', () => {
    expect(() =>
      migrateFromLegacy({
        type: 'plan',
        entries: [{ content: 'Inspect the code', priority: 'high', status: 'cancelled' }],
      }),
    ).toThrow(/plan block/);
  });

  it('rejects a block that aliases `text` as `content` (§7 divergence)', () => {
    expect(() => migrateFromLegacy({ type: 'text', content: 'hello' })).toThrow(/content/);
  });

  it('rejects a tool_use block that aliases `name` as `toolName` (§7 divergence)', () => {
    expect(() => migrateFromLegacy({ type: 'tool_use', toolName: 'read_file', input: {} })).toThrow(
      /toolName/,
    );
  });

  it('rejects a tool_result block that aliases `tool_use_id` as `toolCallId` (§7 divergence)', () => {
    expect(() => migrateFromLegacy({ type: 'tool_result', toolCallId: 'tc_1' })).toThrow(
      /tool_use_id/,
    );
  });

  it('rejects a tool_result block that aliases `is_error` as `isError` (§7 divergence)', () => {
    expect(() =>
      migrateFromLegacy({ type: 'tool_result', tool_use_id: 'tc_1', isError: true }),
    ).toThrow(/isError/);
  });

  it('rejects a block missing the `type` discriminator (§7 divergence)', () => {
    expect(() => migrateFromLegacy({ text: 'hello' })).toThrow(/type/);
  });

  it('rejects an array of blocks on the first divergence (no silent drop)', () => {
    const wire = [
      { type: 'text', text: 'ok' },
      { type: 'tool_use', toolName: 'bad', input: {} },
    ];
    expect(() => migrateContentBlocks(wire)).toThrow(/toolName/);
  });
});

describe('PROTOCOL.md §5.5 AgentMessage wire contract', () => {
  it('passes a canonical assistant message through unchanged', () => {
    const wire = {
      id: 'msg_abc',
      role: 'assistant',
      timestamp: '2026-01-01T00:00:00.000Z',
      contentBlocks: [{ type: 'text', text: 'hello' }],
    };
    const out = normalizeAgentMessage(wire);
    expect(out).toMatchObject(wire);
  });

  it('rejects an AgentMessage missing the canonical `id` (§5.5 divergence)', () => {
    expect(() =>
      normalizeAgentMessage({
        role: 'assistant',
        timestamp: '2026-01-01T00:00:00.000Z',
        contentBlocks: [{ type: 'text', text: 'hello' }],
      }),
    ).toThrow(/id/);
  });

  it('rejects an AgentMessage missing the canonical `role` (§5.5 divergence)', () => {
    expect(() =>
      normalizeAgentMessage({
        id: 'msg_abc',
        timestamp: '2026-01-01T00:00:00.000Z',
        contentBlocks: [{ type: 'text', text: 'hello' }],
      }),
    ).toThrow(/role/);
  });

  it('rejects an AgentMessage missing the canonical `timestamp` (§5.5 divergence)', () => {
    expect(() =>
      normalizeAgentMessage({
        id: 'msg_abc',
        role: 'assistant',
        contentBlocks: [{ type: 'text', text: 'hello' }],
      }),
    ).toThrow(/timestamp/);
  });

  it('rejects an AgentMessage carrying legacy `content` instead of `contentBlocks` (§5.5 divergence)', () => {
    expect(() =>
      normalizeAgentMessage({
        id: 'msg_abc',
        role: 'assistant',
        timestamp: '2026-01-01T00:00:00.000Z',
        content: 'hello',
      }),
    ).toThrow(/content/);
  });
});
