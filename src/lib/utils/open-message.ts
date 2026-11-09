import { CHAT_PAGE_SIZE } from '$shared/constants';
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
 *      newest `MAX_MESSAGES_PER_AGENT` messages, so a very old message can be
 *      absent even after a full hydrate — once hydration settles without it,
 *      seek the page
 *      CONTAINING the message via `agent.getConversation`'s `aroundMessageId`
 *      (PROTOCOL §5.5) and seed the history segment with that page, retaining the live tail.
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
import type { AgentMessage } from '$shared/types';
import { appClient } from '$lib/client';
import { store as appStore } from '$store/renderer/store';
import { openAgentTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
import {
  seedHistoryAround,
  setHistoryOldestReached,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import {
  openPanel,
  setChiefActiveAgentId,
} from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import { setActiveAgentId } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
import {
  scrollbackFetchStarted,
  scrollbackSeekSettled,
} from '$store/renderer/slices/chat-state/chat-state-slice';
import { selectChatAgentState } from '$store/renderer/slices/chat-state/chat-state-selectors';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import { dispatchWindowEvent } from './window-events';
import { navigateToRoute } from './navigation.client';
import { openAndShowWorkspace, workspaceRoute } from './show-workspace';

const logger = new Logger('OpenMessage');

export interface OpenMessageOptions {
  workspaceId: string;
  agentId: string;
  messageId: string;
  /** A tool call inside the message to land on instead, when it is rendered. */
  toolCallId?: string;
  /** Search query whose matched terms get highlighted inside the message. */
  query?: string;
  /** The caller already opened a conversation viewer in another layout. */
  contentAlreadyOpen?: boolean;
  /** Reveal only in this tab, even when the same agent is visible in another pane. */
  targetTabId?: string;
  /** Cancel when the caller navigates elsewhere while history is loading. */
  signal?: AbortSignal;
}

/** Detail payload of the 'chat:open-message' window event ChatPanel consumes. */
export interface OpenMessageEventDetail {
  agentId: string;
  messageId: string;
  toolCallId?: string;
  query?: string;
  targetTabId?: string;
  signal?: AbortSignal;
  /** Unique per openMessage() call so the panel handles retries exactly once. */
  requestId: string;
}

const HYDRATION_POLL_INTERVAL_MS = 150;
const HYDRATION_TIMEOUT_MS = 15_000;
/** Minimum polls before trusting a (possibly stale) 'settled' hydration status. */
const MIN_POLLS_BEFORE_SETTLED = 2;
/** Retry ladder for the scroll hand-off event (ChatPanel may still be mounting). */
const SCROLL_DISPATCH_DELAYS_MS = [150, 400, 800, 1500, 3000];
const SEEK_PAGE_LIMIT = CHAT_PAGE_SIZE;
// A new explicit message destination supersedes the previous deep-open, even
// if its history request or DOM hand-off has not finished yet.
let pendingOpenMessage: AbortController | undefined;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Dependency-light state reads straight off `appStore.state` (no selectors). */
type StoreStateView = {
  agentSessions?: {
    byAgentId: Record<string, { messages?: AgentMessage[] }>;
    historySegmentsByAgentId?: Record<string, { messages: AgentMessage[] }>;
  };
  chatState?: {
    byAgentId: Record<string, { transcriptHydration?: 'loading' | 'settled' }>;
  };
};

function isMessageInStore(agentId: string, messageId: string): boolean {
  const state = appStore.state as StoreStateView;
  const messages = state.agentSessions?.byAgentId[agentId]?.messages;
  const history = state.agentSessions?.historySegmentsByAgentId?.[agentId]?.messages;
  return Boolean(
    messages?.some((message) => message.id === messageId) ||
    history?.some((message) => message.id === messageId),
  );
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
async function waitForMessage(
  agentId: string,
  messageId: string,
  signal: AbortSignal,
): Promise<boolean> {
  const deadline = Date.now() + HYDRATION_TIMEOUT_MS;
  let polls = 0;
  while (Date.now() < deadline) {
    if (signal.aborted) return false;
    if (isMessageInStore(agentId, messageId)) return true;
    if (
      polls >= MIN_POLLS_BEFORE_SETTLED &&
      hydrationStatus(agentId) === 'settled' &&
      !selectChatAgentState.select(appStore.state, agentId).initialHistoryPending
    ) {
      return false;
    }
    polls++;
    await sleep(HYDRATION_POLL_INTERVAL_MS);
  }
  return !signal.aborted && isMessageInStore(agentId, messageId);
}

/**
 * Fetch the page containing the message (§5.5 `aroundMessageId` seek) and
 * seed the history segment with it. Returns false when the message no
 * longer exists (-32602) or the session is not in the store.
 *
 * Also exported for ChatPanel's message navigator: selecting an index-only
 * row (outside the loaded window) reuses this seek before the
 * panel force-renders and scrolls to the message.
 */
export async function seekConversationToMessage(
  agentId: string,
  messageId: string,
  workspaceId?: string,
  signal?: AbortSignal,
): Promise<boolean> {
  // A timeout waiting for a row is not permission to race the initial transfer.
  const deadline = Date.now() + HYDRATION_TIMEOUT_MS;
  while (selectChatAgentState.select(appStore.state, agentId).initialHistoryPending) {
    if (signal?.aborted || Date.now() >= deadline) return false;
    await sleep(HYDRATION_POLL_INTERVAL_MS);
  }
  const session = appStore.state.agentSessions?.byAgentId[agentId];
  if (!session || signal?.aborted) return false;
  if (isMessageInStore(agentId, messageId)) return true;
  workspaceId ??= session.workspaceId;
  const previous = selectChatAgentState.select(appStore.state, agentId);
  let tokens = { nextToken: previous.scrollbackOlderToken, prevToken: previous.scrollbackGapToken };
  appStore.dispatch(scrollbackFetchStarted(agentId, 'seek'));
  const epoch = selectChatAgentState.select(appStore.state, agentId).scrollbackDiscardEpoch;
  const ownsSeek = () =>
    Boolean(appStore.state.agentSessions?.byAgentId[agentId]) &&
    selectChatAgentState.select(appStore.state, agentId).scrollbackDiscardEpoch === epoch;
  try {
    const page = await appClient.agents.getConversation(
      agentId,
      SEEK_PAGE_LIMIT,
      undefined,
      messageId,
      undefined,
      workspaceId,
    );
    if (
      signal?.aborted ||
      !ownsSeek() ||
      !page.messages.some((message) => message.id === messageId)
    )
      return false;
    // Retain the live tail and use persisted sequence numbers for the window's
    // position. Legacy rows without a sequence leave that estimate unknown.
    appStore.dispatch(seedHistoryAround(agentId, page.messages, page.messages[0]?.seq));
    if (page.nextToken === null) appStore.dispatch(setHistoryOldestReached(agentId));
    tokens = { nextToken: page.nextToken, prevToken: page.prevToken };
    return isMessageInStore(agentId, messageId);
  } catch (error) {
    logger.warn('[seekConversationToMessage] Seek fetch failed (message may no longer exist)', {
      agentId,
      messageId,
      error,
    });
    return false;
  } finally {
    if (ownsSeek()) appStore.dispatch(scrollbackSeekSettled(agentId, tokens));
  }
}

/**
 * Navigate to the workspace, open/focus the agent's conversation, ensure the
 * message is loaded (seek page when needed), then scroll to it with a brief
 * highlight flash — and highlight the `query` terms when provided.
 */
export async function openMessage(options: OpenMessageOptions): Promise<void> {
  if (options.signal?.aborted) return;
  pendingOpenMessage?.abort();
  pendingOpenMessage = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([pendingOpenMessage.signal, options.signal])
    : pendingOpenMessage.signal;
  const { workspaceId, agentId, messageId, toolCallId, query, targetTabId } = options;
  logger.info('[openMessage] Deep-opening conversation at message', {
    workspaceId,
    agentId,
    messageId,
  });

  const isChiefMessage = workspaceId === CHIEF_WORKSPACE_ID;
  if (isChiefMessage && !options.contentAlreadyOpen) {
    appStore.dispatch(setChiefActiveAgentId(agentId));
    appStore.dispatch(setActiveAgentId(CHIEF_WORKSPACE_ID, agentId));
    appStore.dispatch(openPanel('chief'));
  }
  const targetPathname = isChiefMessage ? '/' : workspaceRoute(workspaceId);

  if (
    !options.contentAlreadyOpen &&
    typeof window !== 'undefined' &&
    window.location.pathname !== targetPathname
  ) {
    try {
      // Both no-op in the HUD pop-out window (never leave /hud). A workspace
      // jump also opens the workspace's tab once the route lands.
      if (isChiefMessage) await navigateToRoute(targetPathname);
      else await openAndShowWorkspace(workspaceId);
    } catch (error) {
      logger.warn('[openMessage] Workspace navigation failed', { workspaceId, error });
      return;
    }
    if (signal.aborted) return;
    if (window.location.pathname !== targetPathname) {
      logger.warn('[openMessage] Workspace navigation was not confirmed', { workspaceId });
      return;
    }
  }

  if (!options.contentAlreadyOpen && !isChiefMessage) {
    appStore.dispatch(openAgentTabRequested(workspaceId, { agentId }));
  }

  const present = (await waitForMessage(agentId, messageId, signal))
    ? true
    : await seekConversationToMessage(agentId, messageId, workspaceId, signal);
  if (signal.aborted) return;
  if (!present) {
    logger.warn('[openMessage] Message not found; conversation opened at tail', {
      agentId,
      messageId,
    });
    return;
  }

  const requestId = `open-message-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const detail: OpenMessageEventDetail = {
    agentId,
    messageId,
    toolCallId,
    query,
    targetTabId,
    requestId,
    signal,
  };
  for (const delay of SCROLL_DISPATCH_DELAYS_MS) {
    setTimeout(() => {
      if (!signal.aborted) dispatchWindowEvent('chat:open-message', detail);
    }, delay);
  }
}
