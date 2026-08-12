/**
 * @vitest-environment jsdom
 *
 * Deterministic reproduction of the mid-turn `<group:Name>` flatten
 * (monorepo "Group flicker — root cause" task).
 *
 * ROOT CAUSE (daemon-side block-id misprediction, faithfully applied by the FE):
 * the live chat-delta mapper predicts a completed tool's `tool_result` block id
 * as `tool_use index + 1` (`next_block_id` in
 * `intent-transport/src/subscriptions.rs::tool_delta`). When assistant text was
 * streamed AFTER the `tool_use` and before its completion, the durable
 * transcript flushes that text into `index + 1` and puts the real `tool_result`
 * at `index + 2` — so the live `tool_result` lands on the TEXT block's id. The
 * FE's `ChatTranscriptReconciler.upsertBlock` is id-keyed and overwrites the
 * text block in place. If that text carried the `<group:Name>` opener, the
 * group box AND its header sentence disappear for the rest of the turn while
 * every tool card stays put (`tool_result` blocks render nothing standalone —
 * they are folded into their `ToolCall`). It self-heals only at
 * `agent:stream:end`, when the terminal reconcile re-emits the persisted blocks.
 *
 * The daemon documents this misprediction as intentional and "self-heals at the
 * terminal reconcile" — see
 * `intentd/crates/intentd/tests/uds_chat_subscription.rs::chat_delta_orphaned_block_reconciles_via_nonempty_removed_ids`
 * ("MISPREDICTING the index (it overwrites the interleaved text block at
 * {mid}:2 live)"). These tests assert the mid-turn state a user actually sees.
 *
 * FIX (this file's subject): `upsertBlock` refuses a LIVE delta that would
 * change an existing block's type in place and parks the incoming block under a
 * displaced id, so the text block keeps its `<group:Name>` opener while the
 * tool_result still pairs with its call. The terminal reconcile stays
 * authoritative — it retires the stand-ins and may re-type blocks freely. The
 * daemon-side fix (carrying the real result index) is tracked separately; this
 * guard holds even against an unfixed daemon.
 */
import { describe, it, expect } from 'vitest';
import { ChatTranscriptReconciler } from '../live-chat-client';
import { groupContentBlocks, type ContentBlockGroup } from '$lib/utils/messageParser';
import type { ContentBlock } from '$lib/types/agent';

const MSG = 'msg-turn-1';
const LEAD = "I'll start by reading the task note. ";
const GROUP_TEXT = '<group:Setup>\nReading context and searching the codebase.';

/** Wrap a block as a §7.1 chat delta entity for the in-flight assistant message. */
const entity = (block: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  messageId: MSG,
  role: 'assistant',
  block,
  ...extra,
});

const text = (index: number, value: string) => ({
  type: 'text',
  id: `${MSG}:${index}`,
  text: value,
});

const toolUse = (index: number, name: string, toolCallId: string, status: string) => ({
  type: 'tool_use',
  id: `${MSG}:${index}`,
  name,
  input: { path: '.' },
  toolCallId,
  metadata: { toolKind: 'read', status },
});

const toolResult = (index: number, toolCallId: string) => ({
  type: 'tool_result',
  id: `${MSG}:${index}`,
  tool_use_id: toolCallId,
  output: 'ok',
  is_error: false,
});

/** The in-flight assistant message's blocks as the reconciler currently holds them. */
function liveBlocks(reconciler: ChatTranscriptReconciler): ContentBlock[] {
  const message = reconciler.transcript().messages.find((m) => m.id === MSG);
  return (message?.contentBlocks ?? []) as ContentBlock[];
}

/** A compact `type#id` shape of the block array, for readable diffs. */
function shape(blocks: ContentBlock[]): string[] {
  return blocks.map((block) => `${block.type}#${block.id}`);
}

/** The `<group:…>` boxes `StreamingMessageContent` would render, by name. */
function renderedGroups(blocks: ContentBlock[]): string[] {
  return groupContentBlocks(blocks, true)
    .filter((block): block is ContentBlockGroup => block.type === 'content_group')
    .map((group) => group.name);
}

/**
 * Drive a reconciler through the real Claude Code turn shape up to the point
 * just before the first tool completes:
 *
 *   :0 text     — leading narration (flushed by the tool call)
 *   :1 tool_use — Read, started
 *   :2 text     — `<group:Setup>` opener, streamed AFTER the tool call
 *
 * Returns the reconciler and the next sequence number to use.
 */
function seedTurnThroughGroupOpener(): { reconciler: ChatTranscriptReconciler; seq: number } {
  const reconciler = new ChatTranscriptReconciler();
  reconciler.applySnapshot(0, {
    agentId: 'agent-1',
    messages: [],
    truncated: false,
    totalMessages: 0,
  });
  let seq = 1;
  const apply = (added: unknown[], updated: unknown[] = []) =>
    reconciler.applyDelta(seq++, { added, updated, removedIds: [] });

  apply([entity(text(0, LEAD))]);
  apply([entity(toolUse(1, 'Read', 'call_a', 'started'))]);
  apply([entity(text(2, GROUP_TEXT))]);

  return { reconciler, seq };
}

describe('mid-turn <group:Name> flatten (block-id collision)', () => {
  it('renders the group while the opener text block is intact', () => {
    const { reconciler } = seedTurnThroughGroupOpener();

    expect(shape(liveBlocks(reconciler))).toEqual([
      `text#${MSG}:0`,
      `tool_use#${MSG}:1`,
      `text#${MSG}:2`,
    ]);
    expect(renderedGroups(liveBlocks(reconciler))).toEqual(['Setup']);
  });

  it('keeps the group across a mid-turn snapshot re-seed (the daemon snapshot is faithful)', () => {
    const { reconciler } = seedTurnThroughGroupOpener();

    // A gap/reconnect resnapshot: `chat_snapshot` merges the live turn from
    // `Transcript::snapshot_blocks`, which carries the pushed blocks plus the
    // still-pending text buffer at its final index — byte-identical ids.
    reconciler.applySnapshot(10, {
      agentId: 'agent-1',
      messages: [
        {
          id: MSG,
          role: 'assistant',
          isStreaming: true,
          contentBlocks: [
            text(0, LEAD),
            toolUse(1, 'Read', 'call_a', 'started'),
            text(2, GROUP_TEXT),
          ],
        },
      ],
      truncated: false,
      totalMessages: 1,
      turnInFlight: true,
    });

    expect(renderedGroups(liveBlocks(reconciler))).toEqual(['Setup']);
  });

  it('keeps the group when the mispredicted tool_result lands on the opener block', () => {
    const { reconciler, seq: seqStart } = seedTurnThroughGroupOpener();
    let seq = seqStart;
    const apply = (added: unknown[], updated: unknown[] = []) =>
      reconciler.applyDelta(seq++, { added, updated, removedIds: [] });

    // Read completes WITH output. The durable transcript flushed the
    // interleaved text into :2 and puts the real tool_result at :3, but the
    // live mapper predicts `next_block_id(":1") === ":2"`.
    apply([entity(toolResult(2, 'call_a'))], [entity(toolUse(1, 'Read', 'call_a', 'completed'))]);

    // The turn continues with a second tool INSIDE the group.
    apply([entity(toolUse(4, 'Grep', 'call_b', 'started'))]);
    apply([entity(toolResult(5, 'call_b'))], [entity(toolUse(4, 'Grep', 'call_b', 'completed'))]);

    // The reconciler refuses the type-changing upsert: :2 stays the text block
    // that owns the id, and the mispredicted tool_result is parked under a
    // displaced id so its tool card still pairs and completes.
    expect(shape(liveBlocks(reconciler))).toEqual([
      `text#${MSG}:0`,
      `tool_use#${MSG}:1`,
      `text#${MSG}:2`,
      `tool_result#${MSG}:2#displaced`,
      `tool_use#${MSG}:4`,
      `tool_result#${MSG}:5`,
    ]);
    expect(renderedGroups(liveBlocks(reconciler))).toEqual(['Setup']);
  });

  it('keeps the displaced tool_result pairable with its tool call', () => {
    const { reconciler, seq: seqStart } = seedTurnThroughGroupOpener();
    let seq = seqStart;
    reconciler.applyDelta(seq++, {
      added: [entity(toolResult(2, 'call_a'))],
      updated: [entity(toolUse(1, 'Read', 'call_a', 'completed'))],
      removedIds: [],
    });

    // `StreamingMessageContent` pairs results to calls by tool_use_id, so the
    // relocated block must still be present and still reference `call_a` —
    // otherwise the tool card spins until the turn ends.
    const displaced = liveBlocks(reconciler).find((block) => block.type === 'tool_result');
    expect(displaced).toBeDefined();
    expect((displaced as ContentBlock & { tool_use_id?: string }).tool_use_id).toBe('call_a');
  });

  it('updates a displaced block in place instead of piling up duplicates', () => {
    const { reconciler, seq: seqStart } = seedTurnThroughGroupOpener();
    let seq = seqStart;
    const apply = (added: unknown[], updated: unknown[] = []) =>
      reconciler.applyDelta(seq++, { added, updated, removedIds: [] });

    apply([entity(toolResult(2, 'call_a'))], [entity(toolUse(1, 'Read', 'call_a', 'completed'))]);
    apply([], [entity(toolResult(2, 'call_a'))]);
    apply([], [entity(toolResult(2, 'call_a'))]);

    expect(liveBlocks(reconciler).filter((block) => block.type === 'tool_result')).toHaveLength(1);
  });

  it('retires a displaced block when the daemon removes the id it stands for', () => {
    const { reconciler, seq: seqStart } = seedTurnThroughGroupOpener();
    let seq = seqStart;
    reconciler.applyDelta(seq++, {
      added: [entity(toolResult(2, 'call_a'))],
      updated: [entity(toolUse(1, 'Read', 'call_a', 'completed'))],
      removedIds: [],
    });
    expect(shape(liveBlocks(reconciler))).toContain(`tool_result#${MSG}:2#displaced`);

    reconciler.applyDelta(seq++, { added: [], updated: [], removedIds: [`${MSG}:2`] });

    // Both the block that owns :2 and its stand-in go.
    expect(shape(liveBlocks(reconciler))).toEqual([`text#${MSG}:0`, `tool_use#${MSG}:1`]);
  });

  it('still merges a tool_use progress tick onto the titled block', () => {
    // The guard keys on a type CHANGE, so tool_use → tool_use is untouched and
    // mergeToolUseBlock still protects the name/input from a sparse ACP tick.
    const { reconciler, seq: seqStart } = seedTurnThroughGroupOpener();
    reconciler.applyDelta(seqStart, {
      added: [],
      updated: [
        entity({
          type: 'tool_use',
          id: `${MSG}:1`,
          name: '',
          input: {},
          toolCallId: 'call_a',
          metadata: { toolKind: 'other', status: 'completed' },
        }),
      ],
      removedIds: [],
    });

    const toolBlock = liveBlocks(reconciler).find((block) => block.id === `${MSG}:1`);
    expect(toolBlock?.type).toBe('tool_use');
    expect(toolBlock?.name).toBe('Read');
    expect(toolBlock?.metadata?.status).toBe('completed');
    expect(toolBlock?.metadata?.toolKind).toBe('read');
  });

  it('rebuilds the message from the terminal reconcile, retiring the stand-in', () => {
    const { reconciler, seq: seqStart } = seedTurnThroughGroupOpener();
    let seq = seqStart;
    const apply = (added: unknown[], updated: unknown[] = [], removedIds: string[] = []) =>
      reconciler.applyDelta(seq++, { added, updated, removedIds });

    apply([entity(toolResult(2, 'call_a'))], [entity(toolUse(1, 'Read', 'call_a', 'completed'))]);
    apply([entity(toolUse(4, 'Grep', 'call_b', 'started'))]);
    apply([entity(toolResult(5, 'call_b'))], [entity(toolUse(4, 'Grep', 'call_b', 'completed'))]);

    // Mid-turn the group already survives — no flicker to heal.
    expect(renderedGroups(liveBlocks(reconciler))).toEqual(['Setup']);

    // `agent:stream:end` → the terminal reconcile re-emits every PERSISTED
    // block. It is authoritative: the stand-in retires and the real
    // `tool_result` takes its true index at :3.
    apply(
      [entity(toolResult(3, 'call_a'), { streamingComplete: true })],
      [
        entity(text(0, LEAD), { streamingComplete: true }),
        entity(toolUse(1, 'Read', 'call_a', 'completed'), { streamingComplete: true }),
        entity(text(2, GROUP_TEXT), { streamingComplete: true }),
        entity(toolUse(4, 'Grep', 'call_b', 'completed'), { streamingComplete: true }),
        entity(toolResult(5, 'call_b'), { streamingComplete: true }),
      ],
    );

    expect(shape(liveBlocks(reconciler))).toEqual([
      `text#${MSG}:0`,
      `tool_use#${MSG}:1`,
      `text#${MSG}:2`,
      `tool_use#${MSG}:4`,
      `tool_result#${MSG}:5`,
      `tool_result#${MSG}:3`,
    ]);
    expect(renderedGroups(liveBlocks(reconciler))).toEqual(['Setup']);
  });

  it('lets the terminal reconcile change a block type in place', () => {
    // The guard is a LIVE-delta heuristic only. If a turn somehow settles with
    // a wrong type at an id, the authoritative terminal frame must still be
    // able to correct it rather than parking yet another stand-in.
    const reconciler = new ChatTranscriptReconciler();
    reconciler.applySnapshot(0, {
      agentId: 'agent-1',
      messages: [
        {
          id: MSG,
          role: 'assistant',
          isStreaming: true,
          contentBlocks: [toolResult(0, 'call_a')],
        },
      ],
      truncated: false,
      totalMessages: 1,
      turnInFlight: true,
    });

    reconciler.applyDelta(1, {
      added: [],
      updated: [entity(text(0, GROUP_TEXT), { streamingComplete: true })],
      removedIds: [],
    });

    expect(shape(liveBlocks(reconciler))).toEqual([`text#${MSG}:0`]);
  });
});
