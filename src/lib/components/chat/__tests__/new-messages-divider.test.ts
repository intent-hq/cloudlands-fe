import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  resolveNewMessagesDividerAnchor,
  resolveLatchedDividerAnchor,
  dividerVisibleWhenScrolledToBottom,
  dividerDefersToTurnBoundary,
  dividerEntryScrollTop,
} from '../new-messages-divider';
import { indexConversationTurns } from '../conversation-turns';
import type { AgentMessage } from '$shared/types';

describe('resolveNewMessagesDividerAnchor', () => {
  const ids = ['m1', 'm2', 'm3', 'm4'];

  it('anchors the divider at the marker when it is older than the newest message', () => {
    expect(resolveNewMessagesDividerAnchor(ids, 'm2')).toBe('m2');
  });

  it('anchors at the second-to-last message (single unseen message)', () => {
    expect(resolveNewMessagesDividerAnchor(ids, 'm3')).toBe('m3');
  });

  it('anchors at the oldest message when everything after it is unseen', () => {
    expect(resolveNewMessagesDividerAnchor(ids, 'm1')).toBe('m1');
  });

  it('returns null when there is no marker', () => {
    expect(resolveNewMessagesDividerAnchor(ids, undefined)).toBeNull();
    expect(resolveNewMessagesDividerAnchor(ids, null)).toBeNull();
    expect(resolveNewMessagesDividerAnchor(ids, '')).toBeNull();
  });

  it('returns null when the marker is the newest message (nothing unseen)', () => {
    expect(resolveNewMessagesDividerAnchor(ids, 'm4')).toBeNull();
  });

  it('returns null for a dangling marker not present in the transcript', () => {
    expect(resolveNewMessagesDividerAnchor(ids, 'truncated-away')).toBeNull();
  });

  it('returns null for an empty transcript', () => {
    expect(resolveNewMessagesDividerAnchor([], 'm1')).toBeNull();
  });
});

describe('resolveLatchedDividerAnchor', () => {
  const ids = ['m1', 'm2', 'm3', 'm4'];

  it('renders at the latched anchor while it is present in the transcript', () => {
    expect(resolveLatchedDividerAnchor(ids, 'm2')).toBe('m2');
  });

  it('keeps the latched anchor even when it is the newest message', () => {
    // The entry-time resolver never latches the newest message, but a latched
    // anchor that BECAME newest (trailing rows truncated) still renders as-is.
    expect(resolveLatchedDividerAnchor(ids, 'm4')).toBe('m4');
  });

  it('stays put regardless of live marker convergence (marker plays no part)', () => {
    // Only the transcript ids and the latched anchor are inputs — there is no
    // lastSeenMessageId parameter, so marker advances cannot move the divider.
    expect(resolveLatchedDividerAnchor(ids, 'm2')).toBe('m2');
    expect(resolveLatchedDividerAnchor([...ids, 'm5', 'm6'], 'm2')).toBe('m2');
  });

  it('returns null for a null latch (no divider all session)', () => {
    expect(resolveLatchedDividerAnchor(ids, null)).toBeNull();
    expect(resolveLatchedDividerAnchor(ids, undefined)).toBeNull();
    expect(resolveLatchedDividerAnchor(ids, '')).toBeNull();
  });

  it('hides (not recomputes) when the latched anchor left the transcript', () => {
    expect(resolveLatchedDividerAnchor(['m1', 'm3', 'm4'], 'm2')).toBeNull();
  });

  it('returns null for an empty transcript', () => {
    expect(resolveLatchedDividerAnchor([], 'm2')).toBeNull();
  });
});

describe('dividerDefersToTurnBoundary', () => {
  it('defers when the anchor is the turn last rendered message and a turn follows', () => {
    expect(dividerDefersToTurnBoundary('m2', 'm2', true)).toBe(true);
  });

  it('keeps inline placement at end of transcript (no following turn)', () => {
    expect(dividerDefersToTurnBoundary('m2', 'm2', false)).toBe(false);
  });

  it('keeps inline placement for mid-turn anchors', () => {
    expect(dividerDefersToTurnBoundary('user-1', 'assistant-2', true)).toBe(false);
  });

  it('never defers without an anchor', () => {
    expect(dividerDefersToTurnBoundary(null, 'm2', true)).toBe(false);
    expect(dividerDefersToTurnBoundary(null, null, true)).toBe(false);
  });

  it('never defers for a turn with no rendered messages', () => {
    expect(dividerDefersToTurnBoundary('m2', null, true)).toBe(false);
    expect(dividerDefersToTurnBoundary('m2', undefined, true)).toBe(false);
  });
});

describe('turn-boundary divider placement (ChatPanel contract)', () => {
  it('does not defer when only skipped rows trail the last rendered turn', () => {
    // A trailing date group holding only rows groupIntoTurns skips (ordinary
    // system/error, non-model-change notices) renders no turn, so the last
    // RENDERED turn must count as last — mirroring ChatPanel's
    // `globalTurnIndexMap.get(turnKey) === globalTurnIndexMap.size - 1`.
    const message = (id: string, role: AgentMessage['role'], type?: string): AgentMessage =>
      ({ id, role, contentBlocks: [], metadata: type ? { type } : undefined }) as AgentMessage;
    const indexed = indexConversationTurns([
      { messages: [message('user-1', 'user'), message('assistant-1', 'assistant')] },
      { messages: [message('sys-1', 'system'), message('err-1', 'error')] },
    ]);
    expect(indexed.groups[1].turns).toHaveLength(0);
    const turnKey = 'user-1';
    const isLastTurnInConversation =
      indexed.globalIndexByTurnKey.get(turnKey) === indexed.globalIndexByTurnKey.size - 1;
    expect(isLastTurnInConversation).toBe(true);
    expect(
      dividerDefersToTurnBoundary('assistant-1', 'assistant-1', !isLastTurnInConversation),
    ).toBe(false);
  });

  it('derives isLastTurnInConversation from rendered turns, not raw date groups', () => {
    const panel = readFileSync(
      resolve(process.cwd(), 'src/lib/components/chat/ChatPanel.svelte'),
      'utf8',
    );
    expect(panel).toContain(
      'isLastTurnInConversation =\n                    globalTurnIndexMap.get(turnKey) === globalTurnIndexMap.size - 1',
    );
  });

  it('renders the turn-boundary divider immediately after the semantic inter-turn gap', () => {
    const panel = readFileSync(
      resolve(process.cwd(), 'src/lib/components/chat/ChatPanel.svelte'),
      'utf8',
    ).replace(/<!--[\s\S]*?-->/g, '');
    const normalized = panel.replace(/\s+/g, ' ');
    expect(normalized).toContain(
      '{#if !isLastTurnInConversation} <ConversationTurnGap currentIsEventNotification={isEventNotification} currentHasAssistantMessages={turn.assistantMessages.length > 0} nextIsEventNotification={nextTurnIsEventNotification} nextHasUserMessage={nextTurnHasUserMessage} compactOperationalSeam={compactOperationalTurnBoundary} zeroToolSeam={zeroOperationalTurnBoundary} /> {/if} {#if dividerAtTurnBoundary} <NewMessagesDivider /> {/if}',
    );
  });

  it('suppresses the inline render when the divider defers to the turn boundary', () => {
    const panel = readFileSync(
      resolve(process.cwd(), 'src/lib/components/chat/ChatPanel.svelte'),
      'utf8',
    );
    expect(panel).toContain(
      '{#if newMessagesDividerAnchorId === messageId && !deferToTurnBoundary}',
    );
    // Every inline render site (event banner, user row, notice, assistant)
    // passes the defer flag — anchored to the concrete count so removed or
    // non-matching sites fail rather than vacuously comparing undefined.
    const allSites = panel.match(/@render newMessagesDividerAfter\(/g) ?? [];
    const withFlag =
      panel.match(/@render newMessagesDividerAfter\([^)]+,\s*dividerAtTurnBoundary,?\s*\)/g) ?? [];
    expect(allSites.length).toBe(4);
    expect(withFlag.length).toBe(allSites.length);
  });
});

describe('dividerEntryScrollTop', () => {
  it('places the divider top at 20% of the viewport height from the top', () => {
    // 600px viewport → divider lands 120px below the viewport top.
    expect(dividerEntryScrollTop(1000, 600, 5000)).toBe(880);
  });

  it('clamps at 0 when the divider is near the top of the content', () => {
    // Ideal target would be 50 - 120 = -70.
    expect(dividerEntryScrollTop(50, 600, 5000)).toBe(0);
  });

  it('clamps at max scrollTop when the divider is near the content bottom', () => {
    // Ideal target 4900 - 120 = 4780 exceeds max scrollTop 5000 - 600 = 4400.
    expect(dividerEntryScrollTop(4900, 600, 5000)).toBe(4400);
  });

  it('returns 0 when the content is shorter than the viewport', () => {
    expect(dividerEntryScrollTop(300, 600, 500)).toBe(0);
  });
});

describe('dividerVisibleWhenScrolledToBottom', () => {
  it('is true when the unseen tail fits on screen (bottom entry, follow enabled)', () => {
    // Divider 400px above the content bottom, 600px viewport: visible at bottom.
    expect(dividerVisibleWhenScrolledToBottom(1600, 2000, 600)).toBe(true);
  });

  it('is true at the exact boundary (divider top lands at the viewport top)', () => {
    expect(dividerVisibleWhenScrolledToBottom(1400, 2000, 600)).toBe(true);
  });

  it('is false when the unseen tail is taller than the viewport (divider entry)', () => {
    // Divider 1000px above the content bottom, 600px viewport: scrolled out.
    expect(dividerVisibleWhenScrolledToBottom(1000, 2000, 600)).toBe(false);
  });

  it('is true when everything fits without scrolling at all', () => {
    expect(dividerVisibleWhenScrolledToBottom(100, 500, 600)).toBe(true);
  });
});
