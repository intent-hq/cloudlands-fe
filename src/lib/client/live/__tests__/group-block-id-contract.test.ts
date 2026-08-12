/**
 * @vitest-environment jsdom
 *
 * Contract regression: a `<group:Name>` box opened mid-turn keeps rendering for
 * the rest of that turn when the daemon streams the block ids the §7.1 contract
 * promises.
 *
 * BACKGROUND (intent-hq/monorepo#2029, fixed in intent-hq/intentd#1142): the
 * live chat-delta mapper used to PREDICT a completing tool's `tool_result` block
 * id as `tool_use index + 1`. When assistant text streamed AFTER the `tool_use`
 * and before its completion, the durable transcript had already flushed that
 * text into `index + 1`, so the predicted id collided with the text block that
 * legitimately owned it. `ChatTranscriptReconciler.upsertBlock` is id-keyed, so
 * it faithfully overwrote the text block — and when that text carried the
 * `<group:Name>` opener, the group box and its header sentence vanished for the
 * rest of the turn (healing only at the terminal reconcile — hence *flicker*).
 * intentd#1142 stamps the real indices on `agent:tool:call` and deletes the
 * prediction helper, so a colliding id is no longer emitted.
 *
 * WHAT THIS FILE PROTECTS: the FE end of that contract — given the correct
 * (post-#1142) delta sequence, grouping survives the live stream, a mid-turn
 * snapshot re-seed, and the terminal reconcile.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: guard the reconciler against a colliding
 * id. A client-side guard (parking the refused block under a synthetic
 * `${id}#displaced` id) was implemented and REJECTED — cloudlands-fe
 * `AGENTS.md` forbids healing, patching or renaming BE-owned payloads on the
 * way in, and a wire mismatch is fixed at the diverging side. See the closed
 * cloudlands-fe#1069 and monorepo#2055. Do not "restore" that guard: the
 * reconciler must keep applying daemon block ids verbatim.
 */
import { describe, it, expect } from 'vitest';
import { ChatTranscriptReconciler } from '../live-chat-client';
import { groupContentBlocks, type ContentBlockGroup } from '$lib/utils/messageParser';
import type { ContentBlock } from '$lib/types/agent';

const MSG = 'msg-turn-1';
const LEAD = "I'll start by reading the task note. ";
const GROUP_HEADER = 'Reading context and searching the codebase.';
const GROUP_TEXT = `<group:Setup>\n${GROUP_HEADER}`;

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

/** The `<group:…>` boxes `StreamingMessageContent` would render. */
function renderedGroups(blocks: ContentBlock[]): ContentBlockGroup[] {
  return groupContentBlocks(blocks, true).filter(
    (block): block is ContentBlockGroup => block.type === 'content_group',
  );
}

/**
 * `groupContentBlocks` re-emits the text that follows the open tag as a fresh,
 * id-less child block, so children are shaped by id where the daemon owns one.
 */
function childShape(group: ContentBlockGroup): string[] {
  return group.children.map((child) => `${child.type}#${child.id ?? 'split-text'}`);
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

describe('mid-turn <group:Name> rendering over the §7.1 delta stream', () => {
  it('renders the group as soon as the opener text block arrives', () => {
    const { reconciler } = seedTurnThroughGroupOpener();

    expect(shape(liveBlocks(reconciler))).toEqual([
      `text#${MSG}:0`,
      `tool_use#${MSG}:1`,
      `text#${MSG}:2`,
    ]);
    const [group] = renderedGroups(liveBlocks(reconciler));
    expect(group?.name).toBe('Setup');
    expect(childShape(group)).toEqual(['text#split-text']);
    expect(group.children[0].text).toBe(GROUP_HEADER);
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

    const [group] = renderedGroups(liveBlocks(reconciler));
    expect(group?.name).toBe('Setup');
    expect(childShape(group)).toEqual(['text#split-text']);
  });

  it('keeps the group when a tool completes at its real block id after interleaved text', () => {
    const { reconciler, seq: seqStart } = seedTurnThroughGroupOpener();
    let seq = seqStart;
    const apply = (added: unknown[], updated: unknown[] = []) =>
      reconciler.applyDelta(seq++, { added, updated, removedIds: [] });

    // Read completes. The interleaved text already occupies :2, so the
    // `tool_result` carries its REAL index :3 (intentd#1142) — no collision
    // with the block that owns the `<group:Setup>` opener.
    apply([entity(toolResult(3, 'call_a'))], [entity(toolUse(1, 'Read', 'call_a', 'completed'))]);

    // The turn continues with a second tool INSIDE the group.
    apply([entity(toolUse(4, 'Grep', 'call_b', 'started'))]);
    apply([entity(toolResult(5, 'call_b'))], [entity(toolUse(4, 'Grep', 'call_b', 'completed'))]);

    expect(shape(liveBlocks(reconciler))).toEqual([
      `text#${MSG}:0`,
      `tool_use#${MSG}:1`,
      `text#${MSG}:2`,
      `tool_result#${MSG}:3`,
      `tool_use#${MSG}:4`,
      `tool_result#${MSG}:5`,
    ]);

    const [group] = renderedGroups(liveBlocks(reconciler));
    expect(group?.name).toBe('Setup');
    // Everything streamed after the opener renders inside the box; the tool
    // call that PRECEDED it stays outside, which is the authored semantics.
    expect(childShape(group)).toEqual([
      'text#split-text',
      `tool_result#${MSG}:3`,
      `tool_use#${MSG}:4`,
      `tool_result#${MSG}:5`,
    ]);

    // `StreamingMessageContent` pairs results to calls by tool_use_id, so the
    // first call's result must still reference `call_a` — otherwise its tool
    // card spins until the turn ends.
    const result = liveBlocks(reconciler).find((block) => block.id === `${MSG}:3`);
    expect((result as ContentBlock & { tool_use_id?: string }).tool_use_id).toBe('call_a');
  });

  it('keeps the group through the terminal reconcile', () => {
    const { reconciler, seq: seqStart } = seedTurnThroughGroupOpener();
    let seq = seqStart;
    const apply = (added: unknown[], updated: unknown[] = []) =>
      reconciler.applyDelta(seq++, { added, updated, removedIds: [] });

    apply([entity(toolResult(3, 'call_a'))], [entity(toolUse(1, 'Read', 'call_a', 'completed'))]);
    apply([entity(toolUse(4, 'Grep', 'call_b', 'started'))]);
    apply([entity(toolResult(5, 'call_b'))], [entity(toolUse(4, 'Grep', 'call_b', 'completed'))]);

    // `agent:stream:end` → the terminal reconcile re-emits every PERSISTED
    // block. Post-#1142 the live ids already match the persisted ones, so the
    // block array is unchanged and there is no flicker to heal.
    apply(
      [],
      [
        entity(text(0, LEAD), { streamingComplete: true }),
        entity(toolUse(1, 'Read', 'call_a', 'completed'), { streamingComplete: true }),
        entity(text(2, GROUP_TEXT), { streamingComplete: true }),
        entity(toolResult(3, 'call_a'), { streamingComplete: true }),
        entity(toolUse(4, 'Grep', 'call_b', 'completed'), { streamingComplete: true }),
        entity(toolResult(5, 'call_b'), { streamingComplete: true }),
      ],
    );

    expect(shape(liveBlocks(reconciler))).toEqual([
      `text#${MSG}:0`,
      `tool_use#${MSG}:1`,
      `text#${MSG}:2`,
      `tool_result#${MSG}:3`,
      `tool_use#${MSG}:4`,
      `tool_result#${MSG}:5`,
    ]);
    expect(reconciler.transcript().isStreaming).toBe(false);

    // Settled render (`MessageContent` passes isStreaming: false).
    const settled = groupContentBlocks(liveBlocks(reconciler), false).filter(
      (block): block is ContentBlockGroup => block.type === 'content_group',
    );
    expect(settled.map((group) => group.name)).toEqual(['Setup']);
    expect(childShape(settled[0])).toEqual([
      'text#split-text',
      `tool_result#${MSG}:3`,
      `tool_use#${MSG}:4`,
      `tool_result#${MSG}:5`,
    ]);
  });
});
