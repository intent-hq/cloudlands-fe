/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  resolveNewMessagesDividerAnchor,
  resolveLatchedDividerAnchor,
  dividerVisibleWhenScrolledToBottom,
  dividerDefersToTurnBoundary,
  dividerEntryScrollTop,
  DIVIDER_ENTRY_VIEWPORT_FRACTION,
} from '../new-messages-divider';
import { indexConversationTurns } from '../conversation-turns';
import type { AgentMessage } from '$shared/types';
import { resetScaffold, scaffold } from './mocks/chat-panel-render-scaffold';

vi.mock('$store/renderer/store', async () =>
  (await import('./mocks/chat-panel-render-scaffold')).appStore(),
);
vi.mock('$features/layout/panel-layout-adapter', async () =>
  (await import('./mocks/chat-panel-render-scaffold')).panelLayoutAdapter(),
);
vi.mock('$lib/client', async () =>
  (await import('./mocks/chat-panel-render-scaffold')).appClient(),
);
vi.mock('$lib/electron-bridge', () => ({
  invoke: vi.fn().mockResolvedValue({ success: true, data: [] }),
  listenSync: vi.fn(() => () => {}),
}));
vi.mock('$lib/components/patterns/notify', () => ({
  notify: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
vi.mock('svelte-fa', async () => ({ default: (await import('./mocks/SlotOnly.svelte')).default }));
vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', async () =>
  (await import('./mocks/chat-panel-render-scaffold')).agentSessionSelectors(),
);
vi.mock('$store/renderer/slices/chat-state/chat-state-selectors', async () =>
  (await import('./mocks/chat-panel-render-scaffold')).chatStateSelectors(),
);
vi.mock('$store/renderer/slices/unread-tracking/unread-tracking-selectors', async () =>
  (await import('./mocks/chat-panel-render-scaffold')).unreadTrackingSelectors(),
);
vi.mock('$store/renderer/slices/agent-queue/agent-queue-selectors', async () =>
  (await import('./mocks/chat-panel-render-scaffold')).agentQueueSelectors(),
);
vi.mock('$store/renderer/slices/transient-ui/transient-ui-selectors', async () =>
  (await import('./mocks/chat-panel-render-scaffold')).transientUiSelectors(),
);
vi.mock('$store/renderer/slices/provider-catalog/provider-catalog-selectors', async () =>
  (await import('./mocks/chat-panel-render-scaffold')).providerCatalogSelectors(),
);
vi.mock('$store/renderer/slices/panel-layout/panel-layout-selectors', async () =>
  (await import('./mocks/chat-panel-render-scaffold')).stub({ selectAllTabs: [] }),
);
vi.mock('$store/renderer/slices/workspace-notes/workspace-notes-selectors', async () =>
  (await import('./mocks/chat-panel-render-scaffold')).stub({ selectNoteById: null }),
);
vi.mock('$store/renderer/slices/workspace-tasks/workspace-tasks-selectors', async () =>
  (await import('./mocks/chat-panel-render-scaffold')).stub({
    selectWorkspaceTasks: [],
    selectWorkspaceTasksInitialized: false,
  }),
);
vi.mock('$store/renderer/slices/presence/presence-selectors', async () =>
  (await import('./mocks/chat-panel-render-scaffold')).stub({
    selectAgentTypingPeople: [],
    selectPresenceOwnPrincipalId: null,
  }),
);
vi.mock('$store/renderer/slices/multi-panel-context/multi-panel-context-selectors', async () =>
  (await import('./mocks/chat-panel-render-scaffold')).stub({
    selectCheckedPanels: [],
    selectPanels: [],
    selectCheckedSelections: [],
  }),
);
vi.mock('$store/renderer/slices/terminals/terminals-selectors', async () =>
  (await import('./mocks/chat-panel-render-scaffold')).stub({ selectWorkspaceSetupTerminal: null }),
);
vi.mock('$store/renderer/slices/workspace-navigation/workspace-navigation-selectors', async () =>
  (await import('./mocks/chat-panel-render-scaffold')).stub({
    selectWorkspaceNavigationMainPanel: { type: 'empty' },
  }),
);
vi.mock(
  '$store/renderer/slices/task-agent-associations/task-agent-associations-selectors',
  async () =>
    (await import('./mocks/chat-panel-render-scaffold')).stub({ selectTasksForAgent: [] }),
);
vi.mock('$store/renderer/slices/permission/permission-selectors', async () =>
  (await import('./mocks/chat-panel-render-scaffold')).stub({ selectPermissionRequests: [] }),
);
vi.mock('$store/renderer/slices/user-preferences/user-preferences-selectors', async () =>
  (await import('./mocks/chat-panel-render-scaffold')).stub({
    selectChatAuroraEnabled: false,
    selectIsAgentMonospace: false,
  }),
);
vi.mock('$store/renderer/slices/specialists/specialists-selectors', async () =>
  (await import('./mocks/chat-panel-render-scaffold')).stub({
    selectSpecialists: [],
    selectEffectiveBehaviorPrompt: '',
    selectEffectiveModel: '',
  }),
);
vi.mock('../input/SimpleRichInput.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../ChatMessage.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../EventWakeupBanner.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../AgentCard.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../StreamingStatus.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../LiveStreamPhaseIndicator.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../RegularAgentWelcome.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../SuggestedPrompts.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../questions/QuestionWizard.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../ChatFileChangesSummary.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../AutoCommitStatus.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../QueuedMessageList.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../BackgroundHooksRow.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../MonitoredPrsRow.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../AgentSubscriptions.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../EventSubscriptionsCard.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../AttentionRequestBanner.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../LazyTurn.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../InlinePermissionRequest.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../AuroraBackground.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../ModelChangeNotice.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('$features/onboarding/messages/WorkspaceSetupCard.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('$lib/components/ui/panel-find-bar', async () => ({
  PanelFindBar: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('$lib/components/ui/skeleton', async () => ({
  Skeleton: (await import('./mocks/SlotOnly.svelte')).default,
}));

import ChatPanel from '../ChatPanel.svelte';

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
});

describe('turn-boundary divider placement (rendered ChatPanel)', () => {
  const DAY_ONE = '2026-01-01T10:00:00.000Z';
  const DAY_TWO = '2026-01-02T10:00:00.000Z';
  const workspace = { id: 'ws-1', title: 'Workspace' } as never;

  const message = (
    id: string,
    role: AgentMessage['role'],
    extra: { timestamp?: string; metadata?: Record<string, unknown>; text?: string } = {},
  ): AgentMessage =>
    ({
      id,
      role,
      timestamp: extra.timestamp ?? DAY_ONE,
      contentBlocks: [{ type: 'text', text: extra.text ?? `${id} body` }],
      metadata: extra.metadata,
    }) as unknown as AgentMessage;
  const eventWake = (id: string) =>
    message(id, 'user', {
      metadata: { type: 'event_notification', eventCount: 1, eventTypes: ['file:changed'] },
    });
  const batched = (id: string, batchId: string) =>
    message(id, 'user', { metadata: { queueInfo: { batchId } } });
  const attentionRequest = (id: string) =>
    message(id, 'user', {
      metadata: {
        type: 'event_notification',
        eventCount: 1,
        eventTypes: ['agent:attention-requested'],
        events: [{ type: 'agent:attention-requested', data: { kind: 'discussion' } }],
      },
    });
  const questionAnswers = (id: string, answeredQuestionsMessageId: string) =>
    message(id, 'user', { metadata: { type: 'question_answers', answeredQuestionsMessageId } });
  const operationalAssistant = (id: string, extra: { timestamp?: string } = {}): AgentMessage =>
    ({
      id,
      role: 'assistant',
      timestamp: extra.timestamp ?? DAY_ONE,
      contentBlocks: [{ type: 'tool_use', id: `${id}-tool`, name: 'read', input: {} }],
    }) as unknown as AgentMessage;

  async function renderTranscript(messages: AgentMessage[], anchorId: string | null) {
    resetScaffold();
    scaffold.agentMessages = messages;
    scaffold.dividerAnchorId = anchorId;
    const view = render(ChatPanel, { props: { workspace, agentId: 'agent-1', isActive: true } });
    await tick();
    const container = view.container;
    const dividers = [...container.querySelectorAll<HTMLElement>('[data-new-messages-divider]')];
    const gaps = [
      ...container.querySelectorAll<HTMLElement>('[data-testid="conversation-turn-gap"]'),
    ];
    const turns = [...container.querySelectorAll<HTMLElement>('[data-conversation-turn]')];
    return { container, dividers, gaps, turns };
  }

  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('derives isLastTurnInConversation from rendered turns, not raw date groups', async () => {
    // The trailing day holds only rows the turn grouper skips, so it renders no
    // turn: the anchor's turn is still the LAST rendered one and the divider
    // stays inline (no following gap, no boundary placement).
    const { dividers, gaps, turns } = await renderTranscript(
      [
        message('user-1', 'user'),
        message('assistant-1', 'assistant'),
        message('sys-1', 'system', { timestamp: DAY_TWO }),
        message('err-1', 'error', { timestamp: DAY_TWO }),
      ],
      'assistant-1',
    );

    expect(turns).toHaveLength(1);
    expect(gaps).toHaveLength(0);
    expect(dividers).toHaveLength(1);
    expect(turns[0].contains(dividers[0])).toBe(true);
  });

  it('renders the turn-boundary divider immediately after the semantic inter-turn gap', async () => {
    const { dividers, gaps, turns } = await renderTranscript(
      [
        message('user-1', 'user'),
        message('assistant-1', 'assistant'),
        message('user-2', 'user'),
        message('assistant-2', 'assistant'),
      ],
      'assistant-1',
    );

    expect(turns).toHaveLength(2);
    expect(gaps).toHaveLength(1);
    expect(dividers).toHaveLength(1);
    expect(turns[0].contains(dividers[0])).toBe(false);
    expect(turns[0].nextElementSibling).toBe(gaps[0]);
    expect(gaps[0].nextElementSibling).toBe(dividers[0]);
    expect(dividers[0].nextElementSibling).toBe(turns[1]);
  });

  // One case per seam prop ChatPanel feeds the inter-turn gap: the gap's own
  // data attributes are the oracle, so a dropped or mis-wired prop shows up
  // as the seam not being classified.
  it('feeds the batched-delivery seam of the two turns into the gap the divider follows', async () => {
    const { dividers, gaps } = await renderTranscript(
      [
        batched('user-1', 'batch-1'),
        batched('user-2', 'batch-1'),
        message('assistant-2', 'assistant'),
      ],
      'user-1',
    );

    expect(gaps).toHaveLength(1);
    expect(gaps[0].getAttribute('data-batched-seam')).toBe('true');
    expect(gaps[0].getAttribute('data-attention-answer-seam')).toBeNull();
    expect(gaps[0].nextElementSibling).toBe(dividers[0]);
  });

  it('feeds the attention-request → answered-questions seam into the gap the divider follows', async () => {
    const { dividers, gaps, turns } = await renderTranscript(
      [
        attentionRequest('wake-1'),
        message('assistant-1', 'assistant'),
        questionAnswers('answer-1', 'assistant-1'),
        message('assistant-2', 'assistant'),
      ],
      'assistant-1',
    );

    expect(turns).toHaveLength(2);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].getAttribute('data-attention-answer-seam')).toBe('true');
    expect(gaps[0].getAttribute('data-batched-seam')).toBeNull();
    expect(turns[0].contains(dividers[0])).toBe(false);
    expect(gaps[0].nextElementSibling).toBe(dividers[0]);
    expect(dividers[0].nextElementSibling).toBe(turns[1]);
  });

  it('feeds the operational seam between tool-only assistant turns into the gap the divider follows', async () => {
    // The second turn is an orphan assistant turn (a new day, no user row), so
    // the operational boundary test runs against the first turn's last row.
    const { dividers, gaps, turns } = await renderTranscript(
      [
        message('user-1', 'user'),
        operationalAssistant('assistant-1'),
        operationalAssistant('assistant-2', { timestamp: DAY_TWO }),
      ],
      'assistant-1',
    );

    expect(turns).toHaveLength(2);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].getAttribute('data-operational-seam')).toBe('true');
    expect(gaps[0].getAttribute('data-tool-seam')).toBe('true');
    expect(gaps[0].nextElementSibling).toBe(dividers[0]);
  });

  it.each([
    {
      site: 'event banner',
      messages: [
        eventWake('wake-1'),
        message('user-2', 'user'),
        message('assistant-2', 'assistant'),
      ],
      anchorId: 'wake-1',
    },
    {
      site: 'user row',
      messages: [
        message('user-1', 'user'),
        message('user-2', 'user'),
        message('assistant-2', 'assistant'),
      ],
      anchorId: 'user-1',
    },
    {
      site: 'model-change notice',
      messages: [
        message('user-1', 'user'),
        message('notice-1', 'system', { metadata: { type: 'model_changed', from: 'a', to: 'b' } }),
        message('user-2', 'user'),
        message('assistant-2', 'assistant'),
      ],
      anchorId: 'notice-1',
    },
    {
      site: 'effort-change notice',
      messages: [
        message('user-1', 'user'),
        message('notice-1', 'system', {
          metadata: { type: 'effort_changed', from: 'medium', to: 'high' },
        }),
        message('user-2', 'user'),
        message('assistant-2', 'assistant'),
      ],
      anchorId: 'notice-1',
    },
    {
      site: 'provider re-home notice',
      messages: [
        message('user-1', 'user'),
        message('notice-1', 'system', {
          metadata: {
            type: 'provider_rehomed',
            reason: 'provider_disabled',
            from: 'a',
            to: null,
            fromProvider: 'codex',
            toProvider: 'auggie',
          },
        }),
        message('user-2', 'user'),
        message('assistant-2', 'assistant'),
      ],
      anchorId: 'notice-1',
    },
    {
      site: 'assistant row',
      messages: [
        message('user-1', 'user'),
        message('assistant-1', 'assistant'),
        message('user-2', 'user'),
        message('assistant-2', 'assistant'),
      ],
      anchorId: 'assistant-1',
    },
  ])(
    'suppresses the inline $site render when the divider defers to the turn boundary',
    async ({ messages, anchorId }) => {
      const { container, dividers, gaps, turns } = await renderTranscript(messages, anchorId);

      expect(container.querySelector(`[data-message-id="${anchorId}"]`)).not.toBeNull();
      expect(turns).toHaveLength(2);
      expect(dividers).toHaveLength(1);
      expect(turns[0].contains(dividers[0])).toBe(false);
      expect(dividers[0].previousElementSibling).toBe(gaps[0]);
    },
  );

  it('places an effort notice between the user and assistant without duplicating it', async () => {
    const { container, turns } = await renderTranscript(
      [
        message('user-1', 'user'),
        message('effort-1', 'system', {
          text: 'Daemon effort fallback',
          metadata: { type: 'effort_changed', from: 'medium', to: 'high' },
        }),
        message('assistant-1', 'assistant'),
      ],
      null,
    );
    expect(turns).toHaveLength(1);
    const rows = container.querySelectorAll('[data-message-id="effort-1"]');
    expect(rows).toHaveLength(1);
    const notice = rows[0].querySelector('[role="status"]');
    expect(notice?.textContent).toContain('Medium');
    expect(notice?.textContent).toContain('High');
    expect(container.textContent).not.toContain('Daemon effort fallback');
    const user = container.querySelector('[data-message-id="user-1"]')!;
    const assistant = container.querySelector('[data-message-id="assistant-1"]')!;
    expect(user.compareDocumentPosition(rows[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      rows[0].compareDocumentPosition(assistant) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('renders the daemon provider re-home notice once in the transcript (intent#5737)', async () => {
    const daemonText =
      'gpt-5-codex (OpenAI Codex) is no longer available — OpenAI Codex was disabled in Settings > Agents; this agent now runs on Augment Auggie.';
    const { container, turns } = await renderTranscript(
      [
        message('user-1', 'user'),
        message('rehome-1', 'system', {
          text: daemonText,
          metadata: {
            type: 'provider_rehomed',
            reason: 'provider_disabled',
            from: 'gpt-5-codex',
            to: null,
            fromProvider: 'codex',
            toProvider: 'auggie',
          },
        }),
        message('assistant-1', 'assistant'),
      ],
      null,
    );

    expect(turns).toHaveLength(1);
    const rows = container.querySelectorAll('[data-message-id="rehome-1"]');
    expect(rows).toHaveLength(1);
    const notices = rows[0].querySelectorAll('[role="status"]');
    expect(notices).toHaveLength(1);
    const text = notices[0].textContent ?? '';
    expect(text).toMatch(/gpt-5-codex/);
    expect(text).toMatch(/disabled/i);
    expect(text).toMatch(/auggie/i);
    // The notice sits between the user row and the assistant output.
    const userRow = container.querySelector('[data-message-id="user-1"]') as Node;
    const assistantRow = container.querySelector('[data-message-id="assistant-1"]') as Node;
    const follows = (a: Node, b: Node) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(userRow, rows[0])).toBe(true);
    expect(follows(rows[0], assistantRow)).toBe(true);
  });

  it('keeps the divider inline when the anchor is not the last rendered row of its turn', async () => {
    const { dividers, turns } = await renderTranscript(
      [
        message('user-1', 'user'),
        message('assistant-1', 'assistant'),
        message('user-2', 'user'),
        message('assistant-2', 'assistant'),
      ],
      'user-1',
    );

    expect(dividers).toHaveLength(1);
    expect(turns[0].contains(dividers[0])).toBe(true);
    const anchorRow = turns[0].querySelector('[data-message-id="user-1"]')!;
    expect(anchorRow.nextElementSibling).toBe(dividers[0]);
  });
});

describe('dividerEntryScrollTop', () => {
  // Expectations derive from the exported fraction so a placement tune
  // updates them in lockstep. At the pinned 0.2 with a 600px viewport the
  // divider lands 120px below the viewport top.
  const entryOffset = DIVIDER_ENTRY_VIEWPORT_FRACTION * 600;

  it('places the divider top at the entry fraction of the viewport height', () => {
    expect(dividerEntryScrollTop(1000, 600, 5000)).toBe(1000 - entryOffset);
  });

  it('clamps at 0 when the divider is near the top of the content', () => {
    // Ideal target 50 - entryOffset is negative.
    expect(dividerEntryScrollTop(50, 600, 5000)).toBe(0);
  });

  it('clamps at max scrollTop when the divider is near the content bottom', () => {
    // Ideal target 4900 - entryOffset exceeds max scrollTop 5000 - 600 = 4400.
    expect(dividerEntryScrollTop(4900, 600, 5000)).toBe(4400);
  });

  it('returns 0 when the content is shorter than the viewport', () => {
    expect(dividerEntryScrollTop(300, 600, 500)).toBe(0);
  });

  it('pins the entry placement contract at 20% of the viewport height', () => {
    expect(DIVIDER_ENTRY_VIEWPORT_FRACTION).toBe(0.2);
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
