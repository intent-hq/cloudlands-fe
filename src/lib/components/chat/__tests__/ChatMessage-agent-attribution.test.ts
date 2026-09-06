/**
 * @vitest-environment jsdom
 */
import { render, screen, fireEvent } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentMessage } from '$shared/types';
import { WorkspaceId } from '$shared/types/branded-ids';
import {
  configuredVisualStates,
  exerciseVisualStates,
} from '$lib/components/__tests__/helpers/visual-state-characterization';
import {
  SUBSCRIPTION_CARD_CONTAINMENT_CLASS,
  SUBSCRIPTION_CARD_SURFACE_CLASS,
  SUBSCRIPTION_DISCLOSURE_ROW_CLASS,
  SUBSCRIPTION_IN_THREAD_CARD_SPACING_CLASS,
} from '../subscription-disclosure';
import { USER_MESSAGE_SURFACE_CLASS } from '../user-message-surface';

const { dispatchMock, handleLinkMock, agentSelectorHarness } = vi.hoisted(() => {
  type Snapshot = {
    session: Record<string, unknown>;
    responding: boolean;
    waiting: boolean;
    permissionCount: number;
    provider: string | undefined;
  };
  const initialSnapshot: Snapshot = {
    session: { status: 'idle', metadata: { specialist: 'spec-writer' } },
    responding: false,
    waiting: false,
    permissionCount: 0,
    provider: 'augment',
  };
  let snapshot = initialSnapshot;
  const listeners = new Set<() => void>();
  return {
    dispatchMock: vi.fn(),
    handleLinkMock: vi.fn(),
    agentSelectorHarness: {
      readable: <T>(select: (value: Snapshot) => T) => ({
        subscribe: (run: (value: T) => void) => {
          const notify = () => run(select(snapshot));
          notify();
          listeners.add(notify);
          return () => listeners.delete(notify);
        },
      }),
      set: (updates: Partial<Snapshot>) => {
        snapshot = { ...snapshot, ...updates };
        for (const notify of [...listeners]) notify();
      },
      reset: () => {
        snapshot = initialSnapshot;
        for (const notify of [...listeners]) notify();
      },
    },
  };
});

// Mock Redux store and selectors
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => ({}),
    dispatch: dispatchMock,
  });
});

vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceById: Object.assign(
    () => ({
      subscribe: (run: (value: unknown) => void) => {
        run(undefined);
        return () => {};
      },
    }),
    { select: () => ({ repositoryOwner: 'intent-hq', repositoryName: 'monorepo' }) },
  ),
}));

vi.mock('$features/navigation/link-handler', () => ({
  handleLink: handleLinkMock,
}));

vi.mock('$store/renderer/slices/workspace-notes/workspace-notes-selectors', () => ({
  selectAllNotes: Object.assign(
    () => ({
      subscribe: (run: (value: any[]) => void) => {
        run([]);
        return () => {};
      },
    }),
    { select: () => [] },
  ),
}));

vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => ({
  selectAgentMessageById: Object.assign(
    () => ({
      subscribe: (run: (value: any) => void) => {
        run(undefined);
        return () => {};
      },
    }),
    { select: () => undefined },
  ),
  selectAgentSession: Object.assign(() => agentSelectorHarness.readable((value) => value.session), {
    select: () => ({ metadata: { specialist: 'spec-writer' } }),
  }),
  selectAgentIsResponding: () => agentSelectorHarness.readable((value) => value.responding),
  selectAgentIsWaiting: () => agentSelectorHarness.readable((value) => value.waiting),
  selectAgentProvider: () => agentSelectorHarness.readable((value) => value.provider),
}));

vi.mock('$store/renderer/slices/permission/permission-selectors', () => ({
  selectPendingCount: () => agentSelectorHarness.readable((value) => value.permissionCount),
}));

vi.mock('$features/agent/components/agent-avatar/AgentAvatarWithState.svelte', async () => ({
  default: (await import('./mocks/AgentMessageAttributionAvatar.svelte')).default,
}));

// Stub the edit-mode input; its real dependency tree (ModelPicker → useAgentSession)
// needs live store context that these rendering tests don't exercise.
vi.mock('../input/SimpleRichInput.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));

import ChatMessage from '../ChatMessage.svelte';
import ChatMessageRouteContextHarness from './ChatMessageRouteContextHarness.test.svelte';

async function expandAutomatedWake() {
  const toggle = screen.getByTestId('automated-wake-toggle');
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  await fireEvent.click(toggle);
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
}

function userMessage(
  metadata?: Record<string, unknown>,
  text = 'hello from another agent',
): AgentMessage {
  return {
    id: 'msg-1',
    role: 'user',
    contentBlocks: [{ type: 'text', text }],
    timestamp: new Date('2026-01-01T12:00:00Z'),
    ...(metadata ? { metadata } : {}),
  };
}

function userTextMessage(text: string): AgentMessage {
  return {
    id: 'msg-1',
    role: 'user',
    contentBlocks: [{ type: 'text', text }],
    timestamp: new Date('2026-01-01T12:00:00Z'),
  };
}

function installGeometryUtilities(): HTMLStyleElement {
  const style = document.createElement('style');
  style.textContent = `
    .px-1\\.5 { padding-left: 6px; padding-right: 6px; }
    .py-1 { padding-top: 4px; padding-bottom: 4px; }
    .px-3 { padding-left: 12px; padding-right: 12px; }
    .py-2 { padding-top: 8px; padding-bottom: 8px; }
    .min-h-9 { min-height: 36px; }
    .h-9\\! { height: 36px; }
    .h-5 { height: 20px; }
    .w-5 { width: 20px; }
    .h-6 { height: 24px; }
    .w-6 { width: 24px; }
    [data-geometry-card] { box-sizing: border-box; border: 1px solid; }
  `;
  document.head.append(style);
  return style;
}

function px(value: string): number {
  return Number.parseFloat(value) || 0;
}

function measureCollapsedCard(
  card: HTMLElement,
  row: HTMLElement,
  chevron: HTMLElement,
  width: number,
  zoom: number,
) {
  const cardStyle = getComputedStyle(card);
  const rowStyle = getComputedStyle(row);
  const chevronStyle = getComputedStyle(chevron);
  const contentHeight = px(chevronStyle.height);
  const rowHeight =
    px(rowStyle.height) ||
    Math.max(
      px(rowStyle.minHeight),
      px(rowStyle.paddingTop) + contentHeight + px(rowStyle.paddingBottom),
    );
  const height =
    px(cardStyle.borderTopWidth) +
    px(cardStyle.paddingTop) +
    rowHeight +
    px(cardStyle.paddingBottom) +
    px(cardStyle.borderBottomWidth);
  card.getBoundingClientRect = () => ({ width: width * zoom, height: height * zoom }) as DOMRect;
  return {
    rect: {
      width: card.getBoundingClientRect().width,
      height: card.getBoundingClientRect().height,
    },
    insets: {
      top:
        (px(cardStyle.borderTopWidth) + px(cardStyle.paddingTop) + px(rowStyle.paddingTop)) * zoom,
      right:
        (px(cardStyle.borderRightWidth) + px(cardStyle.paddingRight) + px(rowStyle.paddingRight)) *
        zoom,
      bottom:
        (px(cardStyle.borderBottomWidth) +
          px(cardStyle.paddingBottom) +
          px(rowStyle.paddingBottom)) *
        zoom,
      left:
        (px(cardStyle.borderLeftWidth) + px(cardStyle.paddingLeft) + px(rowStyle.paddingLeft)) *
        zoom,
    },
    chevron: { width: px(chevronStyle.width) * zoom, height: contentHeight * zoom },
  };
}

describe('ChatMessage user message text rendering', () => {
  it('renders multi-line text with no leading whitespace before the first character', () => {
    const { container } = render(ChatMessage, {
      props: { message: userTextMessage('Q: q1\nA: a1') },
    });

    // The element(s) applying whitespace-pre-wrap must contain exactly the
    // message text — no template whitespace text nodes rendered under pre-wrap.
    const preWrapEls = Array.from(container.querySelectorAll('.whitespace-pre-wrap')).filter((el) =>
      el.textContent?.includes('Q: q1'),
    );
    expect(preWrapEls.length).toBeGreaterThan(0);
    for (const el of preWrapEls) {
      expect(el.textContent).toBe('Q: q1\nA: a1');
    }
  });

  it('preserves internal newlines of the message text', () => {
    const { container } = render(ChatMessage, {
      props: { message: userTextMessage('line one\nline two') },
    });

    const span = Array.from(container.querySelectorAll('span')).find(
      (el) => el.textContent === 'line one\nline two',
    );
    expect(span).toBeTruthy();
    expect(span!.className).toContain('whitespace-pre-wrap');
  });

  it('still renders inline mention chips alongside text segments', () => {
    const { container } = render(ChatMessage, {
      props: { message: userTextMessage('see @note/spec now') },
    });

    // Mention chip renders as a button
    const chip = Array.from(container.querySelectorAll('button')).find((el) =>
      el.textContent?.includes('spec'),
    );
    expect(chip).toBeTruthy();

    // Surrounding text segments keep their message-internal whitespace
    const spans = Array.from(container.querySelectorAll('span.whitespace-pre-wrap'));
    expect(spans.some((el) => el.textContent === 'see ')).toBe(true);
    expect(spans.some((el) => el.textContent === ' now')).toBe(true);
  });
});

describe('ChatMessage agent-to-agent sender attribution', () => {
  beforeEach(() => {
    dispatchMock.mockClear();
    handleLinkMock.mockReset();
    handleLinkMock.mockResolvedValue(true);
    agentSelectorHarness.reset();
  });

  it('affirms attributed message hierarchy and density in every required visual state', async () => {
    const observed = await exerciseVisualStates(() => {
      const attributed = render(ChatMessage, {
        props: {
          message: userMessage({
            type: 'agent_message',
            fromAgentId: 'agent-sender-visual',
            fromAgentName: 'Builder',
          }),
        },
      });
      const target = attributed.getByTestId('agent-message-attribution');
      return {
        container: attributed.container,
        target,
        unmount: attributed.unmount,
        assertCapability: () => {
          expect(attributed.getByTestId('agent-message-attribution')).toBeTruthy();
          expect(attributed.getByTestId('user-message-surface').className).toContain('min-w-0');
        },
      };
    });
    expect(observed).toEqual(configuredVisualStates);
  });

  it('renders the attribution header for an agent_message user row', () => {
    render(ChatMessage, {
      props: {
        message: userMessage({
          type: 'agent_message',
          fromAgentId: 'agent-sender-1',
          fromAgentName: 'Builder',
        }),
      },
    });

    const header = screen.getByTestId('agent-message-attribution');
    expect(header).toBeTruthy();
    expect(screen.getByText('Builder')).toBeTruthy();
    expect(screen.getByText('sent a message')).toBeTruthy();
    const avatar = screen.getByTestId('agent-avatar');
    expect(avatar.getAttribute('data-agent-id')).toBe('agent-sender-1');
    expect(avatar.getAttribute('data-specialist')).toBe('spec-writer');
    expect(avatar.getAttribute('data-provider')).toBe('augment');
    expect(avatar.getAttribute('data-avatar-state')).toBe('idle');
    expect(avatar.getAttribute('data-avatar-variant')).toBe('standard');
    const preview = screen.getByTestId('agent-message-preview');
    expect(preview.textContent).toContain('hello from another agent');
    expect(screen.queryByTestId('agent-message-expanded-body')).toBeNull();
    const surface = screen.getByTestId('user-message-surface');
    for (const token of [
      ...SUBSCRIPTION_CARD_CONTAINMENT_CLASS.split(' '),
      ...SUBSCRIPTION_CARD_SURFACE_CLASS.split(' '),
    ]) {
      expect(surface.classList.contains(token)).toBe(true);
    }
    const disclosureHeader = screen.getByTestId('agent-message-disclosure-header');
    for (const token of SUBSCRIPTION_DISCLOSURE_ROW_CLASS.split(' ')) {
      expect(disclosureHeader.classList.contains(token)).toBe(true);
    }
    for (const token of ['min-h-9', 'px-3!', 'py-2!', 'type-body', 'font-normal']) {
      expect(disclosureHeader.classList.contains(token)).toBe(true);
    }
    expect(disclosureHeader.classList.contains('gap-2')).toBe(true);
    expect(disclosureHeader.classList.contains('justify-start!')).toBe(true);
    expect(surface.querySelector('button button')).toBeNull();
  });

  it('updates live semantic state and identity inputs without remounting', async () => {
    render(ChatMessage, {
      props: {
        message: userMessage({
          type: 'agent_message',
          fromAgentId: 'agent-sender-live',
          fromAgentName: 'Live Builder',
        }),
      },
    });
    const mountedAvatar = screen.getByTestId('agent-avatar');
    expect(mountedAvatar.getAttribute('data-avatar-state')).toBe('idle');

    const transitions = [
      {
        updates: {
          responding: true,
          session: { status: 'Processing', metadata: { specialist: 'implementor' } },
          provider: 'codex',
        },
        state: 'running',
      },
      {
        updates: { responding: false, waiting: true, session: { status: 'Waiting' } },
        state: 'waiting',
      },
      {
        updates: { waiting: false, session: { status: 'error' } },
        state: 'failed',
      },
      {
        updates: { session: { status: 'Waiting' }, permissionCount: 1 },
        state: 'needs-permission',
      },
      {
        updates: {
          permissionCount: 0,
          session: { status: 'Waiting', attentionRequestKind: 'discussion' },
        },
        state: 'attention-discussion',
      },
    ] as const;

    for (const transition of transitions) {
      agentSelectorHarness.set(transition.updates);
      await Promise.resolve();
      const avatar = screen.getByTestId('agent-avatar');
      expect(avatar).toBe(mountedAvatar);
      expect(avatar.getAttribute('data-avatar-state')).toBe(transition.state);
    }
    expect(mountedAvatar.getAttribute('data-specialist')).toBeNull();
    expect(mountedAvatar.getAttribute('data-provider')).toBe('codex');
  });

  it('renders the sender as running, not waiting, while a tool is executing mid-turn', async () => {
    render(ChatMessage, {
      props: {
        message: userMessage({
          type: 'agent_message',
          fromAgentId: 'agent-sender-tool',
          fromAgentName: 'Tool Builder',
        }),
      },
    });

    // Only the session drives the avatar state: an unresolved tool_use on the
    // in-flight turn must resolve to running under the shared precedence.
    agentSelectorHarness.set({
      session: { status: 'active', isResponding: true, isWaitingOnTool: true },
    });
    await Promise.resolve();

    expect(screen.getByTestId('agent-avatar').getAttribute('data-avatar-state')).toBe('running');
  });

  it.each([
    { width: 450, zoom: 1 },
    { width: 220, zoom: 1 },
    { width: 450, zoom: 2 },
    { width: 220, zoom: 2 },
  ])('matches finished event geometry at $width px and $zoom× zoom', ({ width, zoom }) => {
    const style = installGeometryUtilities();
    const view = render(ChatMessage, {
      props: {
        message: userMessage({
          type: 'agent_message',
          fromAgentId: 'agent-sender-geometry',
          fromAgentName: 'Coordinator with a deliberately long sender name',
        }),
      },
    });
    const agentCard = screen.getByTestId('user-message-surface');
    const agentRow = screen.getByTestId('agent-message-disclosure-header');
    const agentChevron = screen.getByTestId('agent-message-chevron-column');
    agentCard.setAttribute('data-geometry-card', '');
    const eventCard = document.createElement('div');
    eventCard.setAttribute('data-geometry-card', '');
    eventCard.className = SUBSCRIPTION_CARD_SURFACE_CLASS;
    const eventRow = document.createElement('div');
    eventRow.className = SUBSCRIPTION_DISCLOSURE_ROW_CLASS;
    const eventChevron = document.createElement('span');
    eventChevron.className = 'h-6 w-6';
    eventRow.append(eventChevron);
    eventCard.append(eventRow);
    view.container.append(eventCard);
    expect(measureCollapsedCard(agentCard, agentRow, agentChevron, width, zoom)).toEqual(
      measureCollapsedCard(eventCard, eventRow, eventChevron, width, zoom),
    );
    expect(measureCollapsedCard(agentCard, agentRow, agentChevron, width, zoom).rect.height).toBe(
      38 * zoom,
    );
    style.remove();
  });

  it('uses a single-line attributed preview without changing plain user messages', () => {
    const { unmount } = render(ChatMessage, {
      props: {
        message: userMessage({
          type: 'agent_message',
          fromAgentId: 'agent-sender-1',
          fromAgentName: 'Builder',
        }),
      },
    });

    const preview = screen.getByTestId('agent-message-preview');
    expect(preview.className).toContain('truncate');
    expect(preview.className).toContain('whitespace-nowrap');
    expect(screen.queryByTestId('agent-message-expanded-body')).toBeNull();

    unmount();
    render(ChatMessage, { props: { message: userMessage() } });

    const plainBody = screen.getByText('hello from another agent').closest('.type-body');
    expect(plainBody?.className).toContain('line-clamp-6');
    expect(plainBody?.className).not.toContain('line-clamp-2');
  });

  it('expands and collapses the full attributed message inside the same card', async () => {
    const longMessage = 'Long coordinator message '.repeat(12).trim();
    render(ChatMessage, {
      props: {
        message: userMessage(
          {
            type: 'agent_message',
            fromAgentId: 'agent-sender-1',
            fromAgentName: 'Builder',
          },
          longMessage,
        ),
      },
    });

    const surface = screen.getByTestId('user-message-surface');
    const toggle = screen.getByTestId('agent-message-disclosure-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('agent-message-expanded-body')).toBeNull();

    await fireEvent.click(toggle);
    const expanded = screen.getByTestId('agent-message-expanded-body');
    const body = screen.getByText(longMessage).closest('.type-body');
    expect(surface.contains(expanded)).toBe(true);
    expect(expanded.className).toContain('border-t');
    expect(expanded.className).toContain('px-3');
    expect(expanded.className).toContain('py-2');
    expect(body?.className).not.toContain('line-clamp-2');
    expect(body?.getAttribute('data-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    await fireEvent.click(toggle);
    expect(screen.queryByTestId('agent-message-expanded-body')).toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('hides the daemon sender header line from the preview and expanded body', async () => {
    render(ChatMessage, {
      props: {
        message: userMessage(
          {
            type: 'agent_message',
            fromAgentId: 'agent-11111111-2222-3333-4444-555555555555',
            fromAgentName: 'Builder',
          },
          '[MESSAGE FROM AGENT Builder (agent-11111111-2222-3333-4444-555555555555)]\n\nhello from another agent',
        ),
      },
    });

    const preview = screen.getByTestId('agent-message-preview');
    expect(preview.textContent).toContain('hello from another agent');
    expect(preview.textContent).not.toContain('[MESSAGE FROM AGENT');

    await fireEvent.click(screen.getByTestId('agent-message-disclosure-toggle'));
    expect(screen.getByText('hello from another agent')).toBeTruthy();
    expect(screen.queryByText(/\[MESSAGE FROM AGENT/)).toBeNull();
  });

  it('dispatches openAgentTabRequested with the sender agent id on click', async () => {
    render(ChatMessageRouteContextHarness, {
      props: {
        workspaceId: WorkspaceId('ws-1'),
        message: userMessage({
          type: 'agent_message',
          fromAgentId: 'agent-sender-1',
          fromAgentName: 'Builder',
        }),
      },
    });

    await fireEvent.click(screen.getByTestId('agent-message-attribution'));

    expect(dispatchMock).toHaveBeenCalledTimes(1);
    const action = dispatchMock.mock.calls[0][0];
    expect(action.type).toBe('appLayout/openAgentTabRequested');
    expect(action.payload[0]).toBe('ws-1');
    expect(action.payload[1]).toMatchObject({ agentId: 'agent-sender-1' });
  });

  it('renders Chief attribution as an exact source-message link', async () => {
    const sourceUrl = 'intent://local/__chief__/agent/agent-chief-1/message/msg-source-1';
    render(ChatMessageRouteContextHarness, {
      props: {
        workspaceId: WorkspaceId('ws-1'),
        message: userMessage({
          type: 'chief_message',
          fromAgentId: 'agent-chief-1',
          fromAgentName: 'Ignored sender label',
          fromWorkspaceId: '__chief__',
          sourceMessageId: 'msg-source-1',
          sourceUrl,
        }),
      },
    });

    expect(screen.getByText('Chief of Staff')).toBeTruthy();
    const sourceLink = screen.getByTestId('agent-message-attribution');
    expect(sourceLink.tagName).toBe('A');
    expect(sourceLink.getAttribute('href')).toBe(sourceUrl);

    await fireEvent.click(sourceLink);

    expect(handleLinkMock).toHaveBeenCalledWith(sourceUrl, {
      workspaceId: 'ws-1',
      event: expect.any(MouseEvent),
    });
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('preserves Chief attribution and source navigation for a queued delivery', async () => {
    const sourceUrl = 'intent://local/__chief__/agent/agent-chief-1/message/msg-source-1';
    render(ChatMessageRouteContextHarness, {
      props: {
        workspaceId: WorkspaceId('ws-1'),
        message: userMessage({
          type: 'chief_message',
          fromAgentId: 'agent-chief-1',
          fromWorkspaceId: '__chief__',
          sourceMessageId: 'msg-source-1',
          sourceUrl,
          queueInfo: { queuedAt: '2026-01-01T11:59:57Z', waitedMs: 3000 },
        }),
      },
    });

    const sourceLink = screen.getByTestId('agent-message-attribution');
    await fireEvent.click(sourceLink);
    await fireEvent.click(screen.getByTestId('agent-message-disclosure-toggle'));

    expect(screen.getByText('Chief of Staff')).toBeTruthy();
    expect(sourceLink.getAttribute('href')).toBe(sourceUrl);
    expect(screen.getByTestId('queued-message-notice-text').textContent).toBe(
      'Waited in queue for 3s',
    );
    expect(handleLinkMock).toHaveBeenCalledWith(sourceUrl, {
      workspaceId: 'ws-1',
      event: expect.any(MouseEvent),
    });
  });

  it('shows Chief attribution without a broken link when source metadata is incomplete', () => {
    render(ChatMessage, {
      props: {
        message: userMessage({
          type: 'chief_message',
          fromAgentId: 'agent-chief-1',
          fromWorkspaceId: '__chief__',
          sourceMessageId: 'msg-source-1',
          sourceUrl: 'not-a-canonical-link',
        }),
      },
    });

    expect(screen.getByText('Chief of Staff')).toBeTruthy();
    expect(screen.getByTestId('agent-message-attribution').tagName).toBe('SPAN');
    expect(handleLinkMock).not.toHaveBeenCalled();
  });

  it('falls back to "Agent" when fromAgentName is absent', () => {
    render(ChatMessage, {
      props: {
        message: userMessage({ type: 'agent_message', fromAgentId: 'agent-sender-2' }),
      },
    });

    expect(screen.getByTestId('agent-message-attribution')).toBeTruthy();
    expect(screen.getByText('Agent')).toBeTruthy();
  });

  it('renders a plain user message without the attribution header', () => {
    render(ChatMessage, { props: { message: userMessage() } });

    expect(screen.queryByTestId('agent-message-attribution')).toBeNull();
    expect(screen.getByText('hello from another agent')).toBeTruthy();
  });

  it('ignores malformed metadata (missing fromAgentId)', () => {
    render(ChatMessage, {
      props: { message: userMessage({ type: 'agent_message', fromAgentName: 'Builder' }) },
    });

    expect(screen.queryByTestId('agent-message-attribution')).toBeNull();
    expect(screen.getByText('hello from another agent')).toBeTruthy();
  });

  it('ignores non-string fromAgentId', () => {
    render(ChatMessage, {
      props: { message: userMessage({ type: 'agent_message', fromAgentId: 42 }) },
    });

    expect(screen.queryByTestId('agent-message-attribution')).toBeNull();
  });

  it('does not enter edit mode when clicking an attributed message body', async () => {
    const onEditSubmit = vi.fn();
    render(ChatMessage, {
      props: {
        message: userMessage({
          type: 'agent_message',
          fromAgentId: 'agent-sender-1',
          fromAgentName: 'Builder',
        }),
        onEditSubmit,
      },
    });

    await fireEvent.click(screen.getByTestId('agent-message-disclosure-toggle'));
    await fireEvent.click(screen.getByText('hello from another agent'));

    // Still rendering the message (no edit input swapped in)
    expect(screen.getByText('hello from another agent')).toBeTruthy();
    expect(screen.getByTestId('agent-message-attribution')).toBeTruthy();
  });

  it('keeps click-to-edit for plain user messages', async () => {
    const onEditSubmit = vi.fn();
    render(ChatMessage, {
      props: { message: userMessage(), onEditSubmit },
    });

    await fireEvent.click(screen.getByText('hello from another agent'));

    // Edit mode replaces the message body view
    expect(screen.queryByText('hello from another agent')).toBeNull();
  });

  it('compacts a sticky user message and scrolls it instead of editing', async () => {
    const onEditSubmit = vi.fn();
    const onStickyClick = vi.fn();
    const { rerender } = render(ChatMessage, {
      props: {
        message: userMessage(),
        isSticky: false,
        onStickyClick,
        onEditSubmit,
      },
    });

    const text = screen.getByText('hello from another agent');
    const body = text.closest('.type-body');
    const surface = screen.getByTestId('user-message-surface');
    expect(body).not.toBeNull();
    expect(body.className).toContain('line-clamp-6');
    expect(body.className).not.toContain('line-clamp-2');
    for (const token of USER_MESSAGE_SURFACE_CLASS.split(' ')) {
      expect(surface.classList.contains(token)).toBe(true);
    }
    expect(surface.className).not.toContain(SUBSCRIPTION_CARD_SURFACE_CLASS);

    await rerender({
      message: userMessage(),
      isSticky: true,
      onStickyClick,
      onEditSubmit,
    });

    expect(body.className).toContain('line-clamp-2');
    expect(body.className).not.toContain('line-clamp-6');
    for (const token of USER_MESSAGE_SURFACE_CLASS.split(' ')) {
      expect(surface.classList.contains(token)).toBe(true);
    }

    await fireEvent.click(text);

    expect(onStickyClick).toHaveBeenCalledOnce();
    expect(screen.queryByTestId('mock-rich-input')).toBeNull();
    expect(screen.getByText('hello from another agent')).toBeTruthy();
  });
});

describe('ChatMessage hook wake attribution', () => {
  const hookWakeMetadata = {
    type: 'hook_wake',
    hookId: 'hook-1',
    hookName: 'ci-watch',
    reason: 'dispatched',
  };

  function hookWakeMessage(opts: {
    rowMetadata?: boolean;
    blockMetadata?: boolean;
    metadata?: Record<string, unknown>;
    text?: string;
  }): AgentMessage {
    const metadata = opts.metadata ?? hookWakeMetadata;
    return {
      id: 'msg-1',
      role: 'user',
      contentBlocks: [
        {
          type: 'text',
          text: opts.text ?? '[Background hook "ci-watch"] CI is red',
          ...(opts.blockMetadata ? { messageMetadata: metadata } : {}),
        },
      ],
      timestamp: new Date('2026-01-01T12:00:00Z'),
      ...(opts.rowMetadata ? { metadata } : {}),
    };
  }

  it('affirms wake disclosure containment in every required visual state', async () => {
    const observed = await exerciseVisualStates(() => {
      const view = render(ChatMessage, {
        props: { message: hookWakeMessage({ rowMetadata: true }) },
      });
      const target = view.getByTestId('automated-wake-toggle');
      return {
        ...view,
        target,
        assertCapability: () => {
          expect(
            view.getByTestId('user-message-surface').hasAttribute('data-automated-wake-card'),
          ).toBe(true);
          expect(view.getByTestId('automated-wake-header')).toBeTruthy();
        },
      };
    });
    expect(observed).toEqual(configuredVisualStates);
  });

  it('renders a collapsed hook wake card and strips the prefix when expanded', async () => {
    render(ChatMessage, { props: { message: hookWakeMessage({ rowMetadata: true }) } });

    const header = screen.getByTestId('automated-wake-header');
    expect(header).toBeTruthy();
    const surface = screen.getByTestId('user-message-surface');
    for (const token of [
      ...SUBSCRIPTION_CARD_CONTAINMENT_CLASS.split(' '),
      ...SUBSCRIPTION_CARD_SURFACE_CLASS.split(' '),
    ]) {
      expect(surface.classList.contains(token)).toBe(true);
    }
    for (const token of SUBSCRIPTION_DISCLOSURE_ROW_CLASS.split(' ')) {
      expect(header.classList.contains(token)).toBe(true);
    }
    for (const token of SUBSCRIPTION_IN_THREAD_CARD_SPACING_CLASS.split(' ')) {
      expect(surface.classList.contains(token)).toBe(true);
    }
    expect(surface.getAttribute('data-external-spacing-owner')).toBe('automated-wake-card');
    expect(screen.getByText('ci-watch')).toBeTruthy();
    expect(screen.getByText('woke the agent')).toBeTruthy();
    const primaryLabel = screen.getByTestId('automated-wake-primary-label');
    expect(primaryLabel.textContent?.trim()).toBe('ci-watch');
    expect(primaryLabel.getAttribute('title')).toBe('ci-watch');
    expect(screen.queryByTestId('automated-wake-details')).toBeNull();
    await expandAutomatedWake();
    expect(screen.getByText('CI is red')).toBeTruthy();
    expect(screen.queryByText(/\[Background hook/)).toBeNull();
  });

  it('yields the wake card top gap to the batched-delivery seam when suppressed', () => {
    render(ChatMessage, {
      props: {
        message: hookWakeMessage({ rowMetadata: true }),
        suppressAutomatedWakeTopSpacing: true,
      },
    });

    const surface = screen.getByTestId('user-message-surface');
    for (const token of SUBSCRIPTION_IN_THREAD_CARD_SPACING_CLASS.split(' ')) {
      expect(surface.classList.contains(token)).toBe(false);
    }
    expect(surface.classList.contains('mt-0')).toBe(true);
    // The preceding gap owns the seam, so the card no longer claims it.
    expect(surface.hasAttribute('data-external-spacing-owner')).toBe(false);
    expect(surface.hasAttribute('data-automated-wake-card')).toBe(true);
  });

  it('detects hook wake from block-level messageMetadata', async () => {
    render(ChatMessage, { props: { message: hookWakeMessage({ blockMetadata: true }) } });

    expect(screen.getByTestId('automated-wake-header')).toBeTruthy();
    await expandAutomatedWake();
    expect(screen.getByText('CI is red')).toBeTruthy();
    expect(screen.queryByText(/\[Background hook/)).toBeNull();
  });

  it('uses the protocol legacy hook prefix when metadata is absent', async () => {
    render(ChatMessage, {
      props: { message: hookWakeMessage({}) },
    });

    expect(screen.getByTestId('automated-wake-header')).toBeTruthy();
    await expandAutomatedWake();
    expect(screen.getByText('CI is red')).toBeTruthy();
    expect(screen.queryByText(/\[Background hook/)).toBeNull();
  });

  it('does not enter edit mode when clicking a hook wake message body', async () => {
    const onEditSubmit = vi.fn();
    render(ChatMessage, {
      props: { message: hookWakeMessage({ rowMetadata: true }), onEditSubmit },
    });

    await expandAutomatedWake();
    await fireEvent.click(screen.getByText('CI is red'));

    expect(screen.getByText('CI is red')).toBeTruthy();
    expect(screen.getByTestId('automated-wake-header')).toBeTruthy();
  });

  it('toggles the disclosure from anywhere on the header bar', async () => {
    render(ChatMessage, { props: { message: hookWakeMessage({ rowMetadata: true }) } });

    const header = screen.getByTestId('automated-wake-header');
    expect(header.className).toContain('cursor-pointer');
    const toggle = screen.getByTestId('automated-wake-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    // Empty row space toggles open.
    await fireEvent.click(header);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('CI is red')).toBeTruthy();

    // Hook name label toggles closed again.
    await fireEvent.click(screen.getByTestId('automated-wake-primary-label'));
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('automated-wake-details')).toBeNull();

    // Status text toggles open again.
    await fireEvent.click(screen.getByTestId('wake-status'));
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('hides the trailing state note (old wording) from the rendered body', async () => {
    render(ChatMessage, {
      props: {
        message: hookWakeMessage({
          rowMetadata: true,
          text:
            '[Background hook "ci-watch"] CI is red\n\n' +
            '[This hook has now fired and is retired — it will not run again. ' +
            'Schedule a new hook via ws.hook.schedule if you still need to watch this condition.]',
        }),
      },
    });

    await expandAutomatedWake();
    expect(screen.getByText('CI is red')).toBeTruthy();
    expect(screen.queryByText(/\[This hook/)).toBeNull();
  });

  it('hides the trailing state note (new wording) from the rendered body', async () => {
    render(ChatMessage, {
      props: {
        message: hookWakeMessage({
          rowMetadata: true,
          text:
            '[Background hook "ci-watch"] CI is red\n\n' +
            '[This hook is now retired and will not run again — ' +
            'reschedule via ws.hook.schedule if still needed.]',
        }),
      },
    });

    await expandAutomatedWake();
    expect(screen.getByText('CI is red')).toBeTruthy();
    expect(screen.queryByText(/\[This hook/)).toBeNull();
  });

  it('shows queued timing only when expanded and suppresses the raw delivery note', async () => {
    render(ChatMessage, {
      props: {
        message: hookWakeMessage({
          rowMetadata: true,
          metadata: {
            ...hookWakeMetadata,
            queueInfo: { queuedAt: '2026-01-01T11:59:57Z', waitedMs: 3000 },
          },
          text:
            '[Background hook "ci-watch"] CI is red\n\n' +
            '[SYSTEM NOTE] This message was queued at 2026-01-01T11:59:57Z and waited 3s before delivery.',
        }),
      },
    });

    expect(screen.queryByTestId('queued-message-notice')).toBeNull();
    await expandAutomatedWake();
    const timing = screen.getByTestId('queued-message-notice');
    expect(screen.getByTestId('automated-wake-details').contains(timing)).toBe(true);
    // Automated-wake cards render on the subscription-card surface → muted tone.
    expect(timing.className).toContain('text-subtle');
    expect(timing.className).not.toContain('text-primary-foreground/80');
    expect(screen.getByTestId('queued-message-notice-text').textContent).toBe(
      'Waited in queue for 3s',
    );
    expect(screen.getByText('CI is red')).toBeTruthy();
    expect(screen.queryByText(/SYSTEM NOTE/)).toBeNull();
  });

  it('contains long wake details for narrow and zoomed transcript layouts', async () => {
    const longBody = `Failure ${'unbroken-result'.repeat(40)} 你好世界`;
    const view = render(ChatMessage, {
      props: {
        message: hookWakeMessage({
          rowMetadata: true,
          text: `[Background hook "ci-watch"] ${longBody}`,
        }),
      },
    });
    view.container.style.width = '200px';
    view.container.style.zoom = '2';
    await expandAutomatedWake();

    const details = screen.getByTestId('automated-wake-details');
    expect(details.className).toContain('min-w-0');
    expect(details.className).toContain('max-w-full');
    expect(screen.getByText(longBody).parentElement?.className).toContain(
      '[overflow-wrap:anywhere]',
    );
  });

  it('says "and is now retired" when hookStillActive is false', () => {
    render(ChatMessage, {
      props: {
        message: hookWakeMessage({
          rowMetadata: true,
          metadata: { ...hookWakeMetadata, hookStillActive: false },
        }),
      },
    });

    expect(screen.getByText('woke the agent and is now retired')).toBeTruthy();
  });

  it('says "and will continue to run" when hookStillActive is true', () => {
    render(ChatMessage, {
      props: {
        message: hookWakeMessage({
          rowMetadata: true,
          metadata: { ...hookWakeMetadata, hookStillActive: true },
        }),
      },
    });

    expect(screen.getByText('woke the agent and will continue to run')).toBeTruthy();
  });

  it('falls back to the plain "woke the agent" chip when hookStillActive is absent', () => {
    render(ChatMessage, {
      props: { message: hookWakeMessage({ rowMetadata: true }) },
    });

    expect(screen.getByText('woke the agent')).toBeTruthy();
  });

  it('shows the retired suffix for evicted wakes without needing hookStillActive', async () => {
    render(ChatMessage, {
      props: {
        message: hookWakeMessage({
          rowMetadata: true,
          metadata: { ...hookWakeMetadata, reason: 'evicted' },
          text:
            '[Background hook "ci-watch"] Hook failed\n\n' +
            '[This hook will not run again. Schedule a new hook via ' +
            'ws.hook.schedule if the condition is still worth watching.]',
        }),
      },
    });

    expect(screen.getByText('woke the agent and is now retired')).toBeTruthy();
    await expandAutomatedWake();
    expect(screen.queryByText(/\[This hook/)).toBeNull();
  });
});

describe('ChatMessage PR-monitor wake attribution', () => {
  beforeEach(() => {
    handleLinkMock.mockClear();
  });

  const prMonitorWakeMetadata = {
    type: 'pr_monitor_wake',
    monitorId: 'mon-1',
    repo: 'intent-hq/monorepo',
    prNumber: 42,
    reason: 'checks_failed',
  };

  function prMonitorWakeMessage(opts: {
    rowMetadata?: boolean;
    blockMetadata?: boolean;
    metadata?: Record<string, unknown>;
  }): AgentMessage {
    const metadata = opts.metadata ?? prMonitorWakeMetadata;
    return {
      id: 'msg-1',
      role: 'user',
      contentBlocks: [
        {
          type: 'text',
          text: '[PR monitor intent-hq/monorepo#42] Checks failed',
          ...(opts.blockMetadata ? { messageMetadata: metadata } : {}),
        },
      ],
      timestamp: new Date('2026-01-01T12:00:00Z'),
      ...(opts.rowMetadata ? { metadata } : {}),
    };
  }

  it('renders the PR wake card with the chip and strips the prefix when expanded', async () => {
    render(ChatMessage, { props: { message: prMonitorWakeMessage({ rowMetadata: true }) } });

    const header = screen.getByTestId('automated-wake-header');
    expect(header).toBeTruthy();
    // Workspace repo unknown → owner/repo #N chip
    const chip = screen.getByTestId('pr-monitor-wake-chip');
    expect(chip.textContent?.trim()).toBe('intent-hq/monorepo #42');
    expect(chip.getAttribute('title')).toBe('Open intent-hq/monorepo #42');
    expect(screen.getByTestId('wake-status').textContent?.trim()).toBe('woke the agent');
    expect(screen.getByText('woke the agent')).toBeTruthy();
    await expandAutomatedWake();
    expect(screen.getByText('Checks failed')).toBeTruthy();
    expect(screen.queryByText(/\[PR monitor/)).toBeNull();
  });

  it('detects PR wake from block-level messageMetadata', async () => {
    render(ChatMessage, { props: { message: prMonitorWakeMessage({ blockMetadata: true }) } });

    expect(screen.getByTestId('automated-wake-header')).toBeTruthy();
    await expandAutomatedWake();
    expect(screen.getByText('Checks failed')).toBeTruthy();
    expect(screen.queryByText(/\[PR monitor/)).toBeNull();
  });

  it('labels a same-owner, different-repo PR with the repo name only', () => {
    render(ChatMessageRouteContextHarness, {
      props: {
        workspaceId: WorkspaceId('ws-1'),
        message: prMonitorWakeMessage({
          rowMetadata: true,
          metadata: { ...prMonitorWakeMetadata, repo: 'intent-hq/intentd' },
        }),
        workspace: {
          id: 'ws-1',
          repositoryOwner: 'intent-hq',
          repositoryName: 'monorepo',
        } as any,
      },
    });

    expect(screen.getByTestId('pr-monitor-wake-chip').textContent?.trim()).toBe('intentd #42');
  });

  it('labels a different-owner PR with owner/repo', () => {
    render(ChatMessage, {
      props: {
        message: prMonitorWakeMessage({
          rowMetadata: true,
          metadata: { ...prMonitorWakeMetadata, repo: 'other/lib' },
        }),
        workspace: {
          id: 'ws-1',
          repositoryOwner: 'intent-hq',
          repositoryName: 'monorepo',
        } as any,
      },
    });

    expect(screen.getByTestId('pr-monitor-wake-chip').textContent?.trim()).toBe('other/lib #42');
  });

  it('opens the PR externally on chip click (metadata url preferred)', async () => {
    render(ChatMessage, {
      props: {
        message: prMonitorWakeMessage({
          rowMetadata: true,
          metadata: { ...prMonitorWakeMetadata, url: 'https://github.example/pr/42' },
        }),
      },
    });

    await fireEvent.click(screen.getByTestId('pr-monitor-wake-chip'));

    expect(handleLinkMock).toHaveBeenCalledTimes(1);
    expect(handleLinkMock.mock.calls[0][0]).toBe('https://github.example/pr/42');
    expect(handleLinkMock.mock.calls[0][1]).toMatchObject({ forceExternal: true });
    // Chip click stays sibling to the disclosure — it never toggles the card.
    expect(screen.getByTestId('automated-wake-toggle').getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('automated-wake-details')).toBeNull();
  });

  it('toggles the disclosure from the header bar without opening the PR', async () => {
    render(ChatMessage, { props: { message: prMonitorWakeMessage({ rowMetadata: true }) } });

    const toggle = screen.getByTestId('automated-wake-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    await fireEvent.click(screen.getByTestId('automated-wake-header'));
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Checks failed')).toBeTruthy();

    await fireEvent.click(screen.getByTestId('wake-status'));
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('automated-wake-details')).toBeNull();
    expect(handleLinkMock).not.toHaveBeenCalled();
  });

  it('falls back to the GitHub PR URL when metadata has no url', async () => {
    render(ChatMessage, { props: { message: prMonitorWakeMessage({ rowMetadata: true }) } });

    await fireEvent.click(screen.getByTestId('pr-monitor-wake-chip'));

    expect(handleLinkMock).toHaveBeenCalledTimes(1);
    expect(handleLinkMock.mock.calls[0][0]).toBe('https://github.com/intent-hq/monorepo/pull/42');
  });

  it('uses the protocol legacy PR prefix when metadata is absent', async () => {
    render(ChatMessage, { props: { message: prMonitorWakeMessage({}) } });

    expect(screen.getByTestId('automated-wake-header')).toBeTruthy();
    await expandAutomatedWake();
    expect(screen.getByText('Checks failed')).toBeTruthy();
    expect(screen.queryByText(/\[PR monitor/)).toBeNull();
  });

  it('falls back to the protocol prefix when row metadata is malformed', () => {
    render(ChatMessage, {
      props: {
        message: prMonitorWakeMessage({
          rowMetadata: true,
          metadata: { type: 'pr_monitor_wake', monitorId: 'mon-1', repo: 'intent-hq/monorepo' },
        }),
      },
    });

    expect(screen.getByTestId('automated-wake-header')).toBeTruthy();
  });

  it('does not enter edit mode when clicking a PR wake message body', async () => {
    const onEditSubmit = vi.fn();
    render(ChatMessage, {
      props: { message: prMonitorWakeMessage({ rowMetadata: true }), onEditSubmit },
    });

    await expandAutomatedWake();
    await fireEvent.click(screen.getByText('Checks failed'));

    expect(screen.getByText('Checks failed')).toBeTruthy();
    expect(screen.getByTestId('automated-wake-header')).toBeTruthy();
  });
});
