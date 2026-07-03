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

  it('rejects a block that aliases `text` as `content` (§7 divergence)', () => {
    expect(() => migrateFromLegacy({ type: 'text', content: 'hello' })).toThrow(/content/);
  });

  it('rejects a tool_use block that aliases `name` as `toolName` (§7 divergence)', () => {
    expect(() =>
      migrateFromLegacy({ type: 'tool_use', toolName: 'read_file', input: {} }),
    ).toThrow(/toolName/);
  });

  it('rejects a tool_result block that aliases `tool_use_id` as `toolCallId` (§7 divergence)', () => {
    expect(() =>
      migrateFromLegacy({ type: 'tool_result', toolCallId: 'tc_1' }),
    ).toThrow(/tool_use_id/);
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
