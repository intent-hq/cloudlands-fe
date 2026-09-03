/**
 * Unit tests for the canonical agent preview selector: pure state-in /
 * preview-out cases covering every precedence arm (attention → live text →
 * live tool → user line → digest/report → persisted fallbacks), both gates
 * (hidden tool, pre-first-chunk `receivedFirstChunk` window), the
 * `lastMessageRole === 'user'` freshness-wins arm, and the null case —
 * byte-identical to AgentCard's component-level derivation chain.
 */
import { describe, expect, it } from 'vitest';

import { AgentStatus } from '$shared/types';
import type { StoreState } from '../../types';
import type { StoredAgentSession } from './agent-session-types';
import { selectAgentPreview } from './agent-session-selectors';

const AGENT = 'agent-1';

function session(overrides: Record<string, unknown> = {}): StoredAgentSession {
  return {
    id: AGENT,
    status: AgentStatus.RuntimeIdle,
    messages: [],
    ...overrides,
  } as unknown as StoredAgentSession;
}

function stateWith(
  stored: StoredAgentSession | undefined,
  chat: { receivedFirstChunk?: boolean } = {},
): StoreState {
  return {
    agentSessions: { byAgentId: stored ? { [AGENT]: stored } : {} },
    chatState: {
      byAgentId: { [AGENT]: { receivedFirstChunk: chat.receivedFirstChunk ?? false } },
    },
  } as unknown as StoreState;
}

describe('selectAgentPreview', () => {
  it('returns null when the session is unknown', () => {
    expect(selectAgentPreview.select(stateWith(undefined), AGENT)).toBeNull();
  });

  it('returns null when the session has no preview content', () => {
    expect(selectAgentPreview.select(stateWith(session()), AGENT)).toBeNull();
  });

  it('attention outranks every other source once the turn has ended', () => {
    const state = stateWith(
      session({
        attentionRequestKind: 'blocker',
        attentionRequestReason: 'sandbox broken',
        lastAgentResponse: 'live text',
        lastToolUse: { name: 'view' },
        lastMessageRole: 'user',
        lastUserMessage: 'user line',
        digest: 'digest',
      }),
      { receivedFirstChunk: true },
    );
    expect(selectAgentPreview.select(state, AGENT)).toEqual({
      kind: 'attention',
      attention: { kind: 'blocker', reason: 'sandbox broken', timestamp: undefined },
      isLive: false,
    });
  });

  it('gates a pending attention request while the turn is live (live text wins)', () => {
    // Mid-turn rehydration can deliver the persisted attention fields while
    // the agent is still streaming — the preview must not surface them until
    // the turn ends.
    const state = stateWith(
      session({
        attentionRequestKind: 'blocker',
        attentionRequestReason: 'sandbox broken',
        isResponding: true,
        isStreaming: true,
        lastAgentResponse: 'live text',
      }),
      { receivedFirstChunk: true },
    );
    expect(selectAgentPreview.select(state, AGENT)).toEqual({
      kind: 'live-text',
      text: 'live text',
      isLive: true,
    });
  });

  it('serves live text (last meaningful line) while responding once the first chunk landed', () => {
    const state = stateWith(
      session({ isResponding: true, lastAgentResponse: 'First line\n\n  Last line  ' }),
      { receivedFirstChunk: true },
    );
    expect(selectAgentPreview.select(state, AGENT)).toEqual({
      kind: 'live-text',
      text: 'Last line',
      isLive: true,
    });
  });

  it('pre-first-chunk gate: lastAgentResponse is not live text before receivedFirstChunk', () => {
    const state = stateWith(
      session({ isResponding: true, lastAgentResponse: 'First line\nLast line' }),
      { receivedFirstChunk: false },
    );
    expect(selectAgentPreview.select(state, AGENT)).toEqual({
      kind: 'last-response',
      text: 'Last line',
      isLive: true,
    });
  });

  it('serves the in-flight tool overlay while streaming (persisted text cleared)', () => {
    const state = stateWith(
      session({ isStreaming: true, lastToolUse: { name: 'view' }, lastAgentResponse: 'old text' }),
      { receivedFirstChunk: false },
    );
    expect(selectAgentPreview.select(state, AGENT)).toEqual({
      kind: 'live-tool',
      toolUse: { type: 'tool_use', id: `live-tool:${AGENT}`, name: 'view', input: {} },
      isLive: true,
    });
  });

  it('serves the live tool on canonical running evidence without the FE isStreaming flag', () => {
    // Background/delegated agents never get the FE-owned send-path
    // `isStreaming` flag; canonical liveness (isResponding here) must be
    // enough to render the in-flight tool chip during tool-only stretches.
    const responding = stateWith(
      session({ isResponding: true, lastToolUse: { name: 'view', input: {} } }),
    );
    expect(selectAgentPreview.select(responding, AGENT)).toEqual({
      kind: 'live-tool',
      toolUse: { type: 'tool_use', id: `wire-tool:${AGENT}`, name: 'view', input: {} },
      isLive: true,
    });

    // The sticky liveTurnOpen bit is equally sufficient evidence.
    const liveTurn = stateWith(session({ liveTurnOpen: true, lastToolUse: { name: 'view' } }));
    expect(selectAgentPreview.select(liveTurn, AGENT)).toMatchObject({
      kind: 'live-tool',
      isLive: true,
    });

    // The same session idle falls back to the persisted tool arm.
    const idle = stateWith(session({ lastToolUse: { name: 'view' } }));
    expect(selectAgentPreview.select(idle, AGENT)).toMatchObject({
      kind: 'last-tool',
      isLive: false,
    });
  });

  it('live text outranks the live tool overlay', () => {
    const state = stateWith(
      session({
        isResponding: true,
        isStreaming: true,
        lastAgentResponse: 'streamed line',
        lastToolUse: { name: 'view' },
      }),
      { receivedFirstChunk: true },
    );
    expect(selectAgentPreview.select(state, AGENT)).toMatchObject({
      kind: 'live-text',
      text: 'streamed line',
    });
  });

  it('hidden-tool gate: an unlabelled live tool falls through to the user line', () => {
    const state = stateWith(
      session({
        isStreaming: true,
        lastToolUse: { name: 'workspace_api' },
        lastMessageRole: 'user',
        lastUserMessage: '[Currently viewing: foo] Fix the bug\nsecond line',
      }),
    );
    expect(selectAgentPreview.select(state, AGENT)).toEqual({
      kind: 'user',
      text: 'Fix the bug',
      isLive: true,
    });
  });

  it('freshness-wins: the newest user line outranks digest/report and persisted text', () => {
    const state = stateWith(
      session({
        lastMessageRole: 'user',
        lastUserMessage: 'Do the thing',
        digest: 'previous-turn digest',
        lastAgentResponse: 'previous-turn response',
      }),
    );
    expect(selectAgentPreview.select(state, AGENT)).toEqual({
      kind: 'user',
      text: 'Do the thing',
      isLive: false,
    });
  });

  it('while responding, only the live digest may serve as the report arm', () => {
    const base = {
      isResponding: true,
      metadata: { completionReport: 'metadata report' },
    };
    const withDigest = stateWith(session({ ...base, digest: 'Live digest' }));
    expect(selectAgentPreview.select(withDigest, AGENT)).toEqual({
      kind: 'report',
      text: 'Live digest',
      isLive: true,
    });
    // Previous-turn summaries (metadata completionReport) never surface
    // mid-turn (monorepo#1327): with no digest there is no preview at all.
    expect(selectAgentPreview.select(stateWith(session(base)), AGENT)).toBeNull();
  });

  it('idle report precedence: digest → prop report → metadata report → summary fallback', () => {
    const digestState = stateWith(
      session({ digest: 'Digest', metadata: { completionReport: 'Meta report' } }),
    );
    expect(selectAgentPreview.select(digestState, AGENT)).toEqual({
      kind: 'report',
      text: 'Digest',
      isLive: false,
    });

    const metaState = stateWith(session({ metadata: { completionReport: 'Meta report' } }));
    expect(selectAgentPreview.select(metaState, AGENT, 'Prop report')).toMatchObject({
      kind: 'report',
      text: 'Prop report',
    });
    expect(selectAgentPreview.select(metaState, AGENT)).toMatchObject({
      kind: 'report',
      text: 'Meta report',
    });

    const emptyState = stateWith(session());
    expect(selectAgentPreview.select(emptyState, AGENT, undefined, 'Summary')).toMatchObject({
      kind: 'report',
      text: 'Summary',
    });
  });

  it('falls back to the persisted last response for idle agents', () => {
    const state = stateWith(session({ lastAgentResponse: 'line1\nline2' }));
    expect(selectAgentPreview.select(state, AGENT)).toEqual({
      kind: 'last-response',
      text: 'line2',
      isLive: false,
    });
  });

  it('falls back to the persisted tool preview when there is no response text', () => {
    const state = stateWith(
      session({ lastToolUse: { name: 'str_replace_editor', input: { path: 'a.ts' } } }),
    );
    expect(selectAgentPreview.select(state, AGENT)).toEqual({
      kind: 'last-tool',
      toolUse: {
        type: 'tool_use',
        id: `wire-tool:${AGENT}`,
        name: 'str_replace_editor',
        input: { path: 'a.ts' },
      },
      isLive: false,
    });
  });

  it('falls back to the persisted user message last (prefixes stripped)', () => {
    const state = stateWith(session({ lastUserMessage: '[Currently viewing: x] hello there' }));
    expect(selectAgentPreview.select(state, AGENT)).toEqual({
      kind: 'last-user',
      text: 'hello there',
      isLive: false,
    });
  });

  it('derives the report arm from fallback args before the session lands in state', () => {
    const state = stateWith(undefined);
    expect(selectAgentPreview.select(state, AGENT, 'Prop report')).toEqual({
      kind: 'report',
      text: 'Prop report',
      isLive: false,
    });
  });
});
