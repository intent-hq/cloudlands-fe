/**
 * Deep-open a conversation at a specific message.
 *
 * `openMessage` navigates from anywhere (e.g. a command-palette transcript
 * search hit) to the exact message: right workspace, right agent tab,
 * scrolled and highlighted. The flow:
 *
 *   1. `goto(/workspace/{id})` when not already there (cross-workspace).
 *   2. `openAgentTabRequested` — the app-layout navigation middleware opens
 *      (or focuses) the agent's conversation tab; the mounting ChatPanel
 *      dispatches `initializeChatRequested`, whose chat-read-service hydrates
 *      the full transcript into the agent-session slice.
 *   3. Wait for the message to appear in the store. The store prunes to the
 *      newest 500 messages, so a very old message can be absent even after a
 *      full hydrate — once hydration settles without it, seek the page
 *      CONTAINING the message via `agent.getConversation`'s `aroundMessageId`
 *      (PROTOCOL §5.5) and `replaceMessages` the session with that page.
 *   4. Hand the DOM work to the mounted ChatPanel through the
 *      'chat:open-message' window event (dispatched on a retry ladder to
 *      cover slow cross-workspace mounts): the panel force-renders the
 *      target's turn, scrolls to it with a brief flash, and highlights the
 *      matched `query` terms (cleared on next interaction / short timeout).
 *
 * Graceful fallback: when the message no longer exists (seek rejects with
 *  -32602) or never lands in the store, the conversation stays open at the
 * tail and the failure is logged — no event is dispatched.
 */
import { Logger } from '$shared/logger';
import { goto } from '$app/navigation';
import type { AgentMessage } from '$shared/types';
import { appClient } from '$lib/client';
import { store as appStore } from '$store/renderer/store';
import { openAgentTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
import { replaceMessages } from '$store/renderer/slices/agent-session/agent-session-slice';
import { dispatchWindowEvent } from './window-events';

const logger = new Logger('OpenMessage');

export interface OpenMessageOptions {
  workspaceId: string;
  agentId: string;
  messageId: string;
  /** Search query whose matched terms get highlighted inside the message. */
  query?: string;
}

/** Detail payload of the 'chat:open-message' window event ChatPanel consumes. */
export interface OpenMessageEventDetail {
  agentId: string;
  messageId: string;
  query?: string;
  /** Unique per openMessage() call so the panel handles retries exactly once. */
  requestId: string;
}

const HYDRATION_POLL_INTERVAL_MS = 150;
const HYDRATION_TIMEOUT_MS = 15_000;
/** Minimum polls before trusting a (possibly stale) 'settled' hydration status. */
const MIN_POLLS_BEFORE_SETTLED = 2;
/** Retry ladder for the scroll hand-off event (ChatPanel may still be mounting). */
const SCROLL_DISPATCH_DELAYS_MS = [150, 400, 800, 1500, 3000];
const SEEK_PAGE_LIMIT = 200;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Dependency-light state reads straight off `appStore.state` (no selectors). */
type StoreStateView = {
  agentSessions?: { byAgentId: Record<string, { messages?: AgentMessage[] }> };
  chatState?: {
    byAgentId: Record<string, { transcriptHydration?: 'loading' | 'settled' }>;
  };
};

function isMessageInStore(agentId: string, messageId: string): boolean {
  const state = appStore.state as StoreStateView;
  const messages = state.agentSessions?.byAgentId[agentId]?.messages;
  return Boolean(messages?.some((message) => message.id === messageId));
}

function hydrationStatus(agentId: string): 'loading' | 'settled' | undefined {
  const state = appStore.state as StoreStateView;
  return state.chatState?.byAgentId[agentId]?.transcriptHydration;
}

/**
 * Poll until the message is in the store (true) or the transcript hydration
 * has settled without it / the deadline passed (false). The 'settled' status
 * is only honored after a couple of polls: a stale settled marker from a
 * previous load can predate the fresh init the just-mounted ChatPanel kicks.
 */
async function waitForMessage(agentId: string, messageId: string): Promise<boolean> {
  const deadline = Date.now() + HYDRATION_TIMEOUT_MS;
  let polls = 0;
  while (Date.now() < deadline) {
    if (isMessageInStore(agentId, messageId)) return true;
    if (polls >= MIN_POLLS_BEFORE_SETTLED && hydrationStatus(agentId) === 'settled') {
      return false;
    }
    polls++;
    await sleep(HYDRATION_POLL_INTERVAL_MS);
  }
  return isMessageInStore(agentId, messageId);
}

/**
 * Fetch the page containing the message (§5.5 `aroundMessageId` seek) and
 * replace the session's messages with it. Returns false when the message no
 * longer exists (-32602) or the session is not in the store.
 */
async function seekToMessage(agentId: string, messageId: string): Promise<boolean> {
  try {
    const page = await appClient.agents.getConversation(
      agentId,
      SEEK_PAGE_LIMIT,
      undefined,
      messageId,
    );
    if (!page.messages.some((message) => message.id === messageId)) return false;
    appStore.dispatch(replaceMessages(agentId, page.messages));
    return isMessageInStore(agentId, messageId);
  } catch (error) {
    logger.warn('[openMessage] Seek fetch failed (message may no longer exist)', {
      agentId,
      messageId,
      error,
    });
    return false;
  }
}

/**
 * Navigate to the workspace, open/focus the agent's conversation, ensure the
 * message is loaded (seek page when needed), then scroll to it with a brief
 * highlight flash — and highlight the `query` terms when provided.
 */
export async function openMessage(options: OpenMessageOptions): Promise<void> {
  const { workspaceId, agentId, messageId, query } = options;
  logger.info('[openMessage] Deep-opening conversation at message', {
    workspaceId,
    agentId,
    messageId,
  });

  if (
    typeof window !== 'undefined' &&
    window.location.pathname !== `/workspace/${workspaceId}`
  ) {
    try {
      await goto(`/workspace/${workspaceId}`);
    } catch (error) {
      logger.warn('[openMessage] Workspace navigation failed', { workspaceId, error });
    }
  }

  appStore.dispatch(openAgentTabRequested(workspaceId, { agentId }));

  const present = (await waitForMessage(agentId, messageId))
    ? true
    : await seekToMessage(agentId, messageId);
  if (!present) {
    logger.warn('[openMessage] Message not found; conversation opened at tail', {
      agentId,
      messageId,
    });
    return;
  }

  const requestId = `open-message-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const detail: OpenMessageEventDetail = { agentId, messageId, query, requestId };
  for (const delay of SCROLL_DISPATCH_DELAYS_MS) {
    setTimeout(() => dispatchWindowEvent('chat:open-message', detail), delay);
  }
}
