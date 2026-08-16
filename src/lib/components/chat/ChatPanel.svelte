<script lang="ts">
  /* eslint-disable max-lines */
  /**
   * Chat Panel Component
   *
   * A clean, focused chat interface that delegates chat side effects to Redux sagas.
   * This component is purely presentational with minimal state management.
   *
   * @component
   * @description Primary chat interface for interacting with AI agents in the workspace.
   * Manages the full chat lifecycle including initialization, message sending/receiving,
   * streaming responses, and error handling through Redux-owned chat state.
   *
   * @example
   * ```svelte
   * <ChatPanel
   *   {workspace}
   *   {agentId}
   *   agentName="Assistant"
   *   agentModel=""
   *   onClose={() => closeChat()}
   *   onChatUpdate={(update) => handleUpdate(update)}
   * />
   * ```
   *
   * @props
   * - workspace: Current workspace object
   * - agentId: Unique identifier for the agent
   * - agentName: Display name for the agent (default: 'Chat')
   * - agentModel: AI model to use (default: daemon/provider-resolved)
   * - isInitialWorkspaceAgent: Whether this is the first agent in a new workspace
   * - isNewWorkspace: Whether this is a newly created workspace
   * - onClose: Callback when chat is closed
   * - onFocus: Callback when chat gains focus
   * - onChatUpdate: Callback for chat state updates
   */

  import { onMount, onDestroy, untrack, tick } from 'svelte';
  import { deepEqual } from 'fast-equals';
  import { writable } from 'svelte/store';
  import { WorkspaceRebindTracker } from './workspace-rebind-tracker';
  import { shouldHandleChatFocusRequest, type ChatFocusRequest } from './chat-focus-ownership';
  import type { AgentMessage } from '$shared/types';
  import { saveAgentSessionRequested } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
  import {
    agentSessionDismissQuestionsRequested,
    agentSessionEditAndRegenerateRequested,
    agentSessionForkSessionRequested,
    agentSessionRegenerateFromMessageRequested,
    agentSessionRetryLastMessageRequested,
    agentSessionRetryWithModelRequested,
    agentSessionStopChatRequested,
    updateSession as updateAgentSessionFields,
  } from '$store/renderer/slices/agent-session/agent-session-slice';
  import {
    selectAgentSession,
    selectAgentIsResponding,
    selectAgentIsRunning,
    selectAgentSessionIsStreaming,
    selectAgentSessionStreamingContent,
    selectAgentMessages,
  } from '$store/renderer/slices/agent-session/agent-session-selectors';
  import { selectAgentQueueMessages } from '$store/renderer/slices/agent-queue/agent-queue-selectors';
  import { removeQueuedMessageRequested } from '$store/renderer/slices/agent-queue/agent-queue-slice';
  import { hydrateAgentQueue } from '$features/agent/agent-queue-read-service';
  import { selectNoteById } from '$store/renderer/slices/workspace-notes/workspace-notes-selectors';
  import { getPanelLayoutManager } from '$features/layout/panel-layout-adapter';
  import { selectAllTabs as selectPanelLayoutAllTabs } from '$store/renderer/slices/panel-layout/panel-layout-selectors';
  import {
    setWorkspace as setMultiPanelWorkspace,
    updatePanels as updateMultiPanels,
    setSelection as setMultiPanelSelection,
    clearSelection as clearMultiPanelSelection,
    type PanelContextItem,
  } from '$store/renderer/slices/multi-panel-context/multi-panel-context-slice';
  import {
    selectCheckedPanels,
    selectPanels,
    selectCheckedSelections,
  } from '$store/renderer/slices/multi-panel-context/multi-panel-context-selectors';

  import { selectWorkspaceSetupTerminal } from '$store/renderer/slices/terminals/terminals-selectors';

  import {
    sendMessage,
    initializeChatRequested,
    refreshChatTranscriptRequested,
    chatRebindStarted,
    chatRebindEnded,
    chatTrackedWorkspaceSet,
    chatErrorCleared,
    chatSendFailed,
    chatQueuedRetryRecordUpdated,
  } from '$store/renderer/slices/chat-state/chat-state-slice';
  import {
    selectChatError,
    selectChatLastChunkTime,
    selectChatModelUnavailable,
    selectChatReceivedFirstChunk,
    selectChatStatusEvents,
    selectChatStreamingStartTime,
    selectTranscriptHydratedOnce,
    selectTranscriptHydration,
    selectTranscriptSnapshotMeta,
  } from '$store/renderer/slices/chat-state/chat-state-selectors';
  import { selectWorkspaceNavigationMainPanel } from '$store/renderer/slices/workspace-navigation/workspace-navigation-selectors';
  import { appClient } from '$lib/client';
  import { selectChatDraft } from '$store/renderer/slices/transient-ui/transient-ui-selectors';
  import { setChatDraft } from '$store/renderer/slices/transient-ui/transient-ui-slice';

  import { selectTasksForAgent } from '$store/renderer/slices/task-agent-associations/task-agent-associations-selectors';
  import type { TaskAgentAssociation } from '$store/renderer/slices/task-agent-associations/task-agent-associations-types';
  import type { Workspace, AgentMetadata } from '$shared/types';
  import { extractAllContent, type SuggestedPrompt, AgentStatus } from '$shared/types';
  import type { ContextItem } from './input/context-api';
  import { createFileDropTarget } from '$lib/utils/file-drop';
  import { getPanelFileDropContext } from '$lib/components/layout/panel-system/panel-file-drop-context.svelte';
  import { createChatDraftManager } from './chat-panel-draft.svelte';
  import ChatDraftLoadingGate from './ChatDraftLoadingGate.svelte';
  import SimpleRichInput from './input/SimpleRichInput.svelte';
  import ChatMessage from './ChatMessage.svelte';
  import NewMessagesDivider from './NewMessagesDivider.svelte';
  import {
    resolveNewMessagesDividerAnchor,
    resolveLatchedDividerAnchor,
    dividerVisibleWhenScrolledToBottom,
    dividerDefersToTurnBoundary,
  } from './new-messages-divider';
  import EventWakeupBanner from './EventWakeupBanner.svelte';
  import ConversationTurnGap from './ConversationTurnGap.svelte';
  import { toast } from 'svelte-sonner';
  import { m } from '$shared/paraglide/messages.js';
  import { isDelegatedBackgroundTaskSession } from '$shared/utils/agent-session-metadata';
  import { getAgentStopReasonTimestamp } from '$shared/utils/agent-attention';
  import { createAppMessageId } from '$shared/utils/app-message-id';
  import StreamingStatus from './StreamingStatus.svelte';
  import RegularAgentWelcome from './RegularAgentWelcome.svelte';
  import ChiefStarterPrompts from './ChiefStarterPrompts.svelte';

  import SuggestedPrompts from './SuggestedPrompts.svelte';
  import QuestionWizard, { type QuestionAnswer } from './questions/QuestionWizard.svelte';
  import { deriveWizardPendingQuestions } from './questions/wizard-gate';
  import { buildAnswerMessageMetadata, flattenAnswersToMessage } from './questions/answer-message';
  import { groupMessagesByDate } from '$lib/utils/timeFormatting';
  import {
    animateScrollTo,
    followBottom,
    scrollToBottom as scrollToBottomUtil,
  } from '$lib/utils/smartScroll';
  import { getCachedChatScroll, setCachedChatScroll } from './chat-scroll-cache';
  import { createScrollBottomButtonVisibility } from './scroll-bottom-button-visibility';
  import { createLogger } from '$lib/utils/client-logger';
  import { isFocusInTerminal } from '$lib/utils/keyboardShortcuts';
  import Fa from 'svelte-fa';
  import {
    faArrowDown,
    faLock,
    faSquareCheck,
    faPaperclip,
  } from '@fortawesome/free-solid-svg-icons';
  import { fade } from 'svelte/transition';
  import { safeSlide } from '$lib/utils/animations';
  import { navigateToTask } from '$lib/utils/workspace-navigation';
  import { openTerminalTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
  import ChatFileChangesSummary from './ChatFileChangesSummary.svelte';
  import { isAggregateFileChangesRedundant } from '$lib/utils/get-file-changes-from-messages';
  import AutoCommitStatus, { type CommitStatus } from './AutoCommitStatus.svelte';
  import QueuedMessageList from './QueuedMessageList.svelte';
  import EventSubscriptionsCard from './EventSubscriptionsCard.svelte';
  import Button from '../ui/button/button.svelte';
  import { PanelFindBar } from '$lib/components/ui/panel-find-bar';
  import { getSelectedTextWithinSurface } from '$lib/utils/selected-text';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import AttentionRequestBanner from './AttentionRequestBanner.svelte';
  import { parseSuggestedPrompts } from '$lib/utils/messageParser';
  import { getQueueInfo, stripDequeueWaitNote } from '$lib/utils/queue-info';
  import {
    animateMessageSend,
    captureMessageSendOrigin,
    createMessageSendLaunchBubble,
    MESSAGE_SEND_MATCH_TIMEOUT_MS,
    type MessageSendOrigin,
  } from './message-send-transition';

  import LazyTurn from './LazyTurn.svelte';
  import PinnedUserPrompt from './PinnedUserPrompt.svelte';
  import {
    attachPinnedPromptMessage,
    trackPinnedPrompt,
    type PinnedPromptState,
  } from './pinned-prompt';
  import { measureScrollbarGutterWidth } from './scrollbar-gutter';
  import {
    createLazyTurnCacheScope,
    createLazyTurnHeightCache,
    type LazyTurnHeightCache,
  } from './lazy-turn-height-cache';
  import { isTurnInRecentWindow, shouldVirtualizeTurns } from './chat-turn-virtualization';
  import {
    EMPTY_TEMPORARY_TURN_MATERIALIZATION,
    isTurnTemporarilyMaterialized,
    materializeTurn,
    releaseMaterializedTurn,
    type TemporaryTurnMaterialization,
  } from './temporary-turn-materialization';
  import InlinePermissionRequest from './InlinePermissionRequest.svelte';
  import { selectPermissionRequests } from '$store/renderer/slices/permission/permission-selectors';
  import { selectIsAgentMonospace } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import {
    markAgentAsViewed,
    clearCurrentlyViewedAgent,
    startDividerSession,
  } from '$store/renderer/slices/unread-tracking/unread-tracking-slice';
  import { selectDividerSession } from '$store/renderer/slices/unread-tracking/unread-tracking-selectors';
  import AuroraBackground from './AuroraBackground.svelte';
  import { invoke, listenSync } from '$lib/electron-bridge';
  import {
    selectSpecialists,
    selectEffectiveBehaviorPrompt,
    selectEffectiveModel,
  } from '$store/renderer/slices/specialists/specialists-selectors';

  import { getAgentProvider } from '$shared/types/agent-session';
  import { selectEffectiveDefaultProviderId } from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
  import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
  import { canChangeAgentProvider as resolveCanChangeAgentProvider } from './provider-lock';
  import ModelChangeNotice from './ModelChangeNotice.svelte';
  import { getModelChangeNotice } from './model-change-notice';
  import { indexConversationTurns, type ConversationTurn } from './conversation-turns';
  import {
    collectSearchRanges,
    createRangeForSpan,
    findChatSearchMatches,
    type ChatSearchMatch,
  } from './chat-search';
  import { resolveHydratedInputModel } from './input-hydration';
  import {
    deriveQueuedMessagesVisibility,
    hasAuthoritativeConversationEvidence,
    shouldShowEndOfListStreamingStatus,
    shouldShowPendingAssistantStatus,
    shouldShowSetupCardOnly,
    shouldShowTranscriptSkeleton,
  } from './chat-panel-visibility';
  import { isUserQueuedMessage } from '$lib/utils/queued-message-visibility';
  import WorkspaceSetupCard from '$features/onboarding/messages/WorkspaceSetupCard.svelte';
  import { store as appStore } from '$store/renderer/store';

  const logger = createLogger('ChatPanel');

  const isAgentMonospace = selectIsAgentMonospace();

  // Constants
  const SCROLL_BOTTOM_THRESHOLD = 30; // pixels from bottom to consider "at bottom"

  interface Props {
    workspace: Workspace;
    agentId: string;
    agentName?: string;
    agentModel?: string;
    /** Whether this panel is the active/visible tab. Used to prevent input when hidden. */
    isActive?: boolean;
    isInitialWorkspaceAgent?: boolean;
    isNewWorkspace?: boolean;
    initialPrompt?: string | null;
    /** Draft prompt to pre-fill the input without sending */
    draftPrompt?: string | null;
    /** Focus the prompt once on mount after the input component is ready. */
    autoFocus?: boolean;
    onClose?: () => void;
    onFocus?: () => void;
    onChatUpdate?: (update: {
      lastUserMessage?: string;
      lastAgentResponse?: string;
      isProcessing?: boolean;
      messageCount?: number;
    }) => void;
    /** Whether this panel is focused (has DOM focus within panel wrapper) */
    isPanelFocused?: boolean;
  }

  let {
    workspace,
    agentId,
    agentName = 'Chat',
    agentModel = undefined,
    isActive = true,
    isInitialWorkspaceAgent = false,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    isNewWorkspace = false,
    initialPrompt: initialPromptProp = null,
    draftPrompt = null,
    autoFocus = false,

    onClose: _onClose, // Prefix with underscore to indicate intentionally unused
    onFocus,
    onChatUpdate,
    isPanelFocused = false,
  }: Props = $props();

  // True when this panel is rendering the Chief workspace, which opens directly
  // into its composer instead of showing the regular-agent welcome.
  const isChiefWorkspace = $derived(workspace?.id === CHIEF_WORKSPACE_ID);

  // Writable store mirroring workspace.id so Redux selectors re-evaluate reactively
  // svelte-ignore state_referenced_locally -- the effects below mirror later prop changes.
  const workspaceIdStore = writable(workspace?.id ?? '');
  // svelte-ignore state_referenced_locally -- the effects below mirror later prop changes.
  const agentIdStore = writable(agentId ?? '');
  $effect(() => {
    workspaceIdStore.set(workspace?.id ?? '');
  });
  $effect(() => {
    agentIdStore.set(agentId ?? '');
  });

  // Reactive subscription to all panel-layout tabs — triggers availablePanelContexts recompute on tab changes
  const allPanelLayoutTabs$ = selectPanelLayoutAllTabs(workspaceIdStore);

  // Redux selectors for chat values — called at init time, reactive via Svelte store protocol
  // Broad selector rationale: ChatPanel passes the materialized session to
  // helpers/components that need model, metadata, provider, and prompt-handled state.
  const agentSession$ = selectAgentSession(agentIdStore);
  const agentSessionIsStreaming$ = selectAgentSessionIsStreaming(agentIdStore);
  const agentMessages$ = selectAgentMessages(agentIdStore);
  const agentTasks$ = selectTasksForAgent(workspaceIdStore, agentIdStore);
  const queuedMessages$ = selectAgentQueueMessages(agentIdStore);
  const chatStreamingContent$ = selectAgentSessionStreamingContent(agentIdStore);
  const chatError$ = selectChatError(agentIdStore);
  const chatStreamingStartTime$ = selectChatStreamingStartTime(agentIdStore);
  const chatLastChunkTime$ = selectChatLastChunkTime(agentIdStore);
  const chatModelUnavailable$ = selectChatModelUnavailable(agentIdStore);
  const chatStatusEvents$ = selectChatStatusEvents(agentIdStore);
  const chatReceivedFirstChunk$ = selectChatReceivedFirstChunk(agentIdStore);
  const agentIsResponding$ = selectAgentIsResponding(agentIdStore);
  // Canonical "agent is running" gate for idle-only affordances (next-steps links).
  const agentIsRunning$ = selectAgentIsRunning(agentIdStore);
  const transcriptHydration$ = selectTranscriptHydration(agentIdStore);
  const transcriptSnapshotMeta$ = selectTranscriptSnapshotMeta(agentIdStore);
  // First-hydration latch: false until the initial hydration settles, then
  // true for the agent's lifetime — gates the indeterminate skeleton so a
  // partially-loaded transcript never renders as if complete.
  const transcriptHydratedOnce$ = selectTranscriptHydratedOnce(agentIdStore);
  // Indeterminate first-hydration gate: while the INITIAL hydration is in
  // flight (never settled before for this agent), a partially-loaded message
  // list — e.g. the standing subscription's newest page landing ahead of the
  // paged history read — must not render as a complete conversation. Refresh
  // re-hydrations (latch already true) keep the messages visible.
  const isFirstHydrationLoading = $derived(
    !$transcriptHydratedOnce$ && $transcriptHydration$ === 'loading',
  );
  const transcriptHydrationFailed = $derived($transcriptHydration$ === 'error');
  const authoritativeConversationEvidence = $derived(
    hasAuthoritativeConversationEvidence(
      $agentSession$ ?? null,
      $transcriptSnapshotMeta$?.totalMessages ?? 0,
    ),
  );
  // Latched "New messages" divider viewing session (entry-only, frozen).
  const dividerSession$ = selectDividerSession(agentIdStore);
  const isDelegatedBackgroundTaskAgent = $derived(isDelegatedBackgroundTaskSession($agentSession$));

  // Derive error state: combine transient chatError with persisted agent status.
  // After a reload, chatError is null but agent status may be Error — use
  // stopReason or a generic message so StreamingStatus shows the failure + Retry button.
  const effectiveError = $derived.by(() => {
    if ($chatError$) return $chatError$;
    if ($agentSession$?.status === AgentStatus.Error) {
      return $agentSession$.stopReason || m.chat_chatPanel_agentSpawnFailed_error();
    }
    return null;
  });

  // monorepo#940: the daemon flags the parked error session as corrupted —
  // Retry will recreate the provider session instead of resuming, so the error
  // surface shows recreate-aware copy. Absent flag (older daemons / ordinary
  // errors) renders exactly as before.
  const effectiveSessionCorrupted = $derived(
    $agentSession$?.status === AgentStatus.Error && $agentSession$?.sessionCorrupted === true,
  );

  // ISO timestamp of the terminal failure — shows "X ago" next to the error
  // title. Only surfaced when the session is parked in Error (accompanies
  // stopReason); null on older daemons or transient chat errors.
  const effectiveFailedAt = $derived.by(() => {
    if ($agentSession$?.status !== AgentStatus.Error) return null;
    return getAgentStopReasonTimestamp($agentSession$);
  });

  // Track if there's a pending permission request for this agent
  // When a permission is pending, we hide the "Thinking" indicator since the permission UI shows instead
  const allPermissionRequests = selectPermissionRequests();
  const agentPermissionRequests = $derived(
    agentId ? $allPermissionRequests.filter((r) => r.sessionId === agentId) : [],
  );
  let hasPendingPermission = $derived(agentPermissionRequests.length > 0);

  // Track previous workspace to detect changes — extracted into a helper so
  // the race-prevention logic can be unit-tested against production code.
  const rebindTracker = new WorkspaceRebindTracker();

  // DEBUG: Unique instance ID to detect duplicate ChatPanel mounts
  const instanceId = Math.random().toString(36).substring(2, 8);
  // svelte-ignore state_referenced_locally -- this records the identity at instance creation.
  logger.debug('[ChatPanel] INSTANCE CREATED', { instanceId, agentId });

  let scrollContainer = $state<HTMLDivElement>();
  let composerElement = $state<HTMLDivElement>();
  let inputComponent = $state<SimpleRichInput>();
  // Rehydrate the transcript scroll state cached by the previous instance's
  // destroy (column windowing unmounts off-screen panels) so a remount keeps
  // the user's reading position instead of re-entering at the bottom.
  // svelte-ignore state_referenced_locally -- mount-time snapshot of the identity props.
  const cachedScroll =
    workspace?.id && agentId ? getCachedChatScroll(workspace.id, agentId) : undefined;
  // Non-null when the previous instance was scrolled away from the bottom;
  // consumed by the entry-scroll paths below instead of scrolling to bottom.
  const cachedScrollRestoreTop =
    cachedScroll && !cachedScroll.shouldFollowBottom ? cachedScroll.scrollTop : null;
  let shouldFollowBottom = $state(cachedScroll?.shouldFollowBottom ?? true);
  // Committed (damped) visibility for the scroll-to-bottom button. Driven by
  // the hysteresis + settle-window controller below so per-frame
  // distance-from-bottom jitter (transient scrollHeight changes: lazy-turn
  // placeholder swaps, image loads) can never strobe the button.
  let scrollButtonVisible = $state(false);
  // Transient "scroll re-locked" confirmation: a lock icon briefly flashes when
  // scrolling crosses back to the bottom and auto-follow re-engages. Purely
  // decorative (aria-hidden, pointer-events-none) so it can never intercept
  // hover hit-tests or land in the tab order (monorepo#2508).
  let showLockConfirmation = $state(false);
  let lockConfirmationTimer: ReturnType<typeof setTimeout> | null = null;
  const LOCK_CONFIRMATION_DURATION_MS = 1500;

  function flashLockConfirmation(): void {
    if (lockConfirmationTimer !== null) clearTimeout(lockConfirmationTimer);
    showLockConfirmation = true;
    lockConfirmationTimer = setTimeout(() => {
      showLockConfirmation = false;
      lockConfirmationTimer = null;
    }, LOCK_CONFIRMATION_DURATION_MS);
  }

  let lazyTurnHeightCache = $state.raw<LazyTurnHeightCache>(createLazyTurnHeightCache('unbound'));
  let lazyTurnCacheScope = 'unbound';

  $effect(() => {
    const scope = createLazyTurnCacheScope({
      workspaceId: String(workspace?.id ?? ''),
      agentId,
      sessionId: $agentSession$?.backendSessionId ?? $agentSession$?.acpSessionId ?? null,
    });
    if (scope === lazyTurnCacheScope) return;
    lazyTurnHeightCache.clear();
    lazyTurnCacheScope = scope;
    lazyTurnHeightCache = createLazyTurnHeightCache(scope);
  });

  interface PendingSendTransition {
    origin: MessageSendOrigin;
    launchBubble: HTMLElement | null;
    followBottom: boolean;
    expiry: ReturnType<typeof setTimeout>;
  }

  const pendingSendTransitions = new Map<string, PendingSendTransition>();
  const activeSendTransitions = new Map<string, AbortController>();
  let pendingSendMessageIds = $state.raw<Set<string>>(new Set());

  function setPendingSendMessage(key: string, pending: boolean): void {
    const next = new Set(pendingSendMessageIds);
    if (pending) next.add(key);
    else next.delete(key);
    pendingSendMessageIds = next;
  }

  function cancelPendingSendTransition(key: string, pending: PendingSendTransition): void {
    if (pendingSendTransitions.get(key) !== pending) return;
    clearTimeout(pending.expiry);
    pending.launchBubble?.remove();
    pendingSendTransitions.delete(key);
    setPendingSendMessage(key, false);
  }

  function cancelAllSendTransitions(): void {
    for (const [key, pending] of pendingSendTransitions) {
      cancelPendingSendTransition(key, pending);
    }
    for (const controller of activeSendTransitions.values()) controller.abort();
    activeSendTransitions.clear();
  }

  function prepareMessageSendTransition(
    text: string,
    options: { enabled: boolean; followBottom: boolean; allowOverlap?: boolean },
  ): string {
    const userAppMessageId = createAppMessageId();
    if (!options.enabled || (!options.allowOverlap && pendingSendTransitions.size > 0)) {
      return userAppMessageId;
    }
    if (!composerElement) return userAppMessageId;
    const origin = captureMessageSendOrigin(composerElement);
    if (origin.width <= 0) return userAppMessageId;
    const key = String(userAppMessageId);
    const launchBubble = createMessageSendLaunchBubble(
      origin,
      text,
      `${workspace?.id ?? 'workspace'}:${agentId}:${instanceId}`,
    );
    const pending: PendingSendTransition = {
      origin,
      launchBubble,
      followBottom: options.followBottom,
      expiry: setTimeout(
        () => cancelPendingSendTransition(key, pending),
        MESSAGE_SEND_MATCH_TIMEOUT_MS,
      ),
    };
    pendingSendTransitions.set(key, pending);
    if (launchBubble) setPendingSendMessage(key, true);
    return userAppMessageId;
  }

  function startPendingSendTransitions(): boolean {
    if (!scrollContainer || pendingSendTransitions.size === 0) return false;
    let started = false;
    for (const message of $agentMessages$) {
      const key = message.role === 'user' ? String(message.appMessageId ?? '') : '';
      const pending = pendingSendTransitions.get(key);
      if (!pending) continue;
      const row = Array.from(
        scrollContainer.querySelectorAll<HTMLElement>('[data-send-app-message-id]'),
      ).find((candidate) => candidate.dataset.sendAppMessageId === key);
      if (!row) continue;
      clearTimeout(pending.expiry);
      pendingSendTransitions.delete(key);
      const target = row.querySelector<HTMLElement>('[data-testid="user-message-surface"]') ?? row;
      activeSendTransitions.get(key)?.abort();
      const controller = new AbortController();
      activeSendTransitions.set(key, controller);
      const settle = () => {
        if (activeSendTransitions.get(key) === controller) activeSendTransitions.delete(key);
        setPendingSendMessage(key, false);
      };
      void animateMessageSend({
        origin: pending.origin,
        target,
        scrollContainer,
        launchBubble: pending.launchBubble,
        followBottom: pending.followBottom,
        signal: controller.signal,
      }).then(settle, settle);
      started = true;
    }
    return started;
  }

  let pinnedPrompt = $state<PinnedPromptState | null>(null);

  // Onboarding context — reconstructed from workspace + agent session data.
  // No external storage needed; all essential fields live on the workspace object.
  let onboardingContext = $state<{
    projectName: string;
    projectPath: string;
    branch: string;
    prompt: string;
    worktreePath?: string;
    baseRef?: string;
    repoPath?: string;
    specialistName?: string;
    specialistId?: string;
    setupScript?: string;
    skipWorktree?: boolean;
  } | null>(null);

  function handleFocusSetupTerminal() {
    const setupTerminal = selectWorkspaceSetupTerminal.select(appStore.state, workspace.id);
    if (setupTerminal) {
      appStore.dispatch(openTerminalTabRequested(workspace.id, { terminalId: setupTerminal.id }));
    }
  }

  function handleRetryTranscriptHydration() {
    appStore.dispatch(refreshChatTranscriptRequested(String(workspace.id), agentId));
  }

  function handlePinnedPromptClick() {
    if (!scrollContainer || !pinnedPrompt) return;
    const source = scrollContainer.querySelector<HTMLElement>(
      `[data-pinned-prompt-id="${CSS.escape(pinnedPrompt.id)}"]`,
    );
    const turn = source?.closest<HTMLElement>('[data-conversation-turn]');
    setPinnedPrompt(null);
    if (turn) smoothScrollTo(turn, 'start');
  }

  function getPinnedPromptText(message: AgentMessage): string {
    const extracted = extractAllContent(message);
    const text = getQueueInfo(message.metadata) ? stripDequeueWaitNote(extracted) : extracted;
    if (text.trim()) return text.trim();
    const attachment = message.contentBlocks?.find(
      (block) => block.type === 'image' || block.type === 'file',
    );
    if (attachment?.type === 'file' && attachment.fileName) return attachment.fileName;
    if (attachment?.type === 'image') {
      return m.chat_chatMessage_attachedImage_fallback({ number: '1' });
    }
    return m.chat_shared_context_fallback();
  }

  // CRITICAL: Destruction flag to prevent async callbacks from accessing reactive state after destruction.
  // This prevents "N is not a function" errors when Svelte's reactive system tries to call
  // nullified internal functions. This MUST be set FIRST in onDestroy, before any other cleanup.
  // This is NOT reactive ($state) intentionally - we want to read it without triggering reactive tracking.
  let isComponentDestroyed = false;

  // Track container height for compact mode (line clamp 1 when short)
  // Use hysteresis to prevent flickering at the threshold boundary
  let containerHeight = $state(0);
  const COMPACT_HEIGHT_ENTER = 600; // Enter compact mode below this
  const COMPACT_HEIGHT_EXIT = 640; // Exit compact mode above this
  let isCompactMode = $state(false);

  // Width the scroll container reserves for its vertical scrollbar gutter.
  // The pinned-prompt overlay host subtracts it so the overlay lane occupies
  // the same horizontal box as the conversation column.
  let scrollbarGutterWidth = $state(0);

  $effect(() => {
    if (containerHeight > 0) {
      if (!isCompactMode && containerHeight < COMPACT_HEIGHT_ENTER) {
        isCompactMode = true;
      } else if (isCompactMode && containerHeight > COMPACT_HEIGHT_EXIT) {
        isCompactMode = false;
      }
    }
  });

  // Hoist suggested prompts so keyboard handlers can reference them
  const suggestedPrompts = $derived.by((): SuggestedPrompt[] => {
    if ($agentIsRunning$ || $agentMessages$.length === 0) {
      return [];
    }
    // Hide the moment the user submits a new prompt — before `agentIsRunning$`
    // flips true there is a window where the last assistant message (carrying
    // the prompts block) is still the last *assistant* message even though a
    // user message now trails it, or an optimistic pending user bubble is shown.
    const hasUserMessage = $agentMessages$.some((m) => m.role === 'user');
    const showingPendingUserMessage = !!pendingMessage && !hasUserMessage;
    const lastMessage = $agentMessages$[$agentMessages$.length - 1];
    if (lastMessage?.role === 'user' || showingPendingUserMessage) {
      return [];
    }
    const lastAssistantMessage = [...$agentMessages$].reverse().find((m) => m.role === 'assistant');
    if (!lastAssistantMessage) {
      return [];
    }
    // Suggested prompts stay hidden whenever the turn has pending Agent Q&A
    // questions — including while the wizard is Ignore-collapsed. Only
    // answering, dismissing, or a newer question set brings them back.
    if (pendingQuestions) {
      return [];
    }
    // Parse each text block on its own, mirroring MessageContent, which strips
    // the block per text block when rendering the transcript. Parsing a joined
    // string here would surface chips for a marker split across two blocks
    // while MessageContent still rendered its raw lines. The last text block
    // that yields prompts wins.
    const textBlocks = (lastAssistantMessage.contentBlocks ?? []).filter((b) => b.type === 'text');
    for (let i = textBlocks.length - 1; i >= 0; i--) {
      const { prompts } = parseSuggestedPrompts(textBlocks[i].text ?? '');
      if (prompts.length > 0) return prompts;
    }
    return [];
  });

  // Agent Q&A: question blocks on the newest question-bearing assistant
  // message (not streaming) replace the composer with the sequential wizard,
  // and stay pending across later plain user messages and agent replies until
  // answered (answer-tagged user row), dismissed, or superseded by a newer
  // question set. Derivation is purely transcript-based (wire contract), so
  // restored sessions re-surface unanswered questions automatically.
  // The gate (own active turn, NOT the broad running gate — an agent paused
  // on delegated agents has ended its turn and its questions must surface)
  // lives in deriveWizardPendingQuestions so the regression suite exercises
  // the real production gate.
  const pendingQuestions = $derived.by(() => {
    const hasUserMessage = $agentMessages$.some((m) => m.role === 'user');
    const showingPendingUserMessage = !!pendingMessage && !hasUserMessage;
    // Reading $agentIsResponding$ keeps this $derived reactive to gate flips
    // that do not change the transcript; the dismissal marker read keeps it
    // reactive to metadata-only session updates (optimistic dismiss /
    // agent:updated); the shared helper re-reads both from store state.
    void $agentIsResponding$;
    void $agentSession$?.metadata?.dismissedQuestionsMessageId;
    return deriveWizardPendingQuestions(
      appStore.state,
      agentId,
      $agentMessages$,
      showingPendingUserMessage,
    );
  });

  let questionWizardCollapsed = $state(false);
  let questionWizardMessageId = $state<string | null>(null);
  $effect(() => {
    const id = pendingQuestions?.messageId ?? null;
    if (id !== questionWizardMessageId) {
      questionWizardMessageId = id;
      questionWizardCollapsed = false;
    }
  });

  // Queue entries the user should see: user-authored ones only. Daemon-origin
  // entries (agent sends, event wakes, hook wakes, PR-monitor wakes,
  // `questions_dismissed`, `source: 'system'`, unknown types) stay hidden —
  // the list, its count, and the up-arrow edit path all use this filtered
  // view (display-only; the daemon queue and drain order are untouched).
  const visibleQueuedMessages = $derived($queuedMessages$.filter(isUserQueuedMessage));

  // Queue visibility around the wizard: hidden while the wizard is expanded,
  // shown with a held-for-questions hint while Ignore-collapsed (the daemon
  // parks automatic deliveries behind the pending Q&A — question hold,
  // PROTOCOL §5.5). Derivation shared with the regression suite.
  const queuedMessagesVisibility = $derived(
    deriveQueuedMessagesVisibility({
      queueLength: visibleQueuedMessages.length,
      hasPendingQuestions: !!pendingQuestions,
      questionWizardCollapsed,
    }),
  );

  // Dismiss = persistent, unlike Ignore: the mutation middleware stamps
  // `dismissedQuestionsMessageId` into session metadata optimistically (the
  // wizard-gate reads it, so the wizard hides immediately) and forwards
  // `agent.dismissQuestions` — the daemon persists the marker (survives
  // reload) and releases the question hold. On failure the middleware rolls
  // the metadata back, so the wizard re-surfaces, and surfaces the error toast.
  function handleQuestionWizardDismiss() {
    if (!workspace || !pendingQuestions) return;
    appStore.dispatch(
      agentSessionDismissQuestionsRequested(agentId, workspace.id, pendingQuestions.messageId),
    );
  }

  // Completing the wizard flattens all answers into ONE plain-text user
  // message of `Q:`/`A:` pairs sent through the ordinary send path, tagged
  // with `messageMetadata { type: "question_answers",
  // answeredQuestionsMessageId }` (wire contract). That structured tag — not
  // the text — resolves the pending set, so the wizard unmounts and the
  // composer restores; an untagged user message leaves the Q&A pending.
  function handleQuestionWizardComplete(answers: QuestionAnswer[]) {
    if (!workspace || !isActive || !pendingQuestions) return;
    const text = flattenAnswersToMessage(answers);
    logger.info('Question wizard completed', { answerCount: answers.length });
    appStore.dispatch(
      sendMessage(agentId, {
        wsId: workspace.id,
        text,
        agentName,
        agentModel,
        isInitialWorkspaceAgent,
        messageMetadata: buildAnswerMessageMetadata(pendingQuestions.messageId),
      }),
    );
    void performLocalSendCleanup({ followBottom: true });
  }

  // Search state
  let showSearch = $state(false);
  let searchQuery = $state('');
  // Debounced copy of searchQuery — drives the expensive match derivation so
  // intermediate keystrokes don't trigger a full rewalk + turn re-render cascade.
  let debouncedSearchQuery = $state('');
  let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  const SEARCH_DEBOUNCE_MS = 150;
  // Number of match-neighbors (before + after the current index) to force-render
  // via LazyTurn in addition to the current match's turn. Keeps initial search
  // responsive even when a query matches hundreds of turns.
  const SEARCH_NEIGHBOR_COUNT = 1;
  let searchInputRef: HTMLInputElement | null = $state(null);
  let panelElement: HTMLElement | null = $state(null);
  let currentSearchIndex = $state(0);

  // Tracks DOM focus within the panel wrapper. Combined with the `isPanelFocused`
  // prop (from the panel-system parent) so keyboard shortcuts that are scoped to a
  // single chat — like the suggested-prompts shortcut — only fire for the focused
  // chat when multiple chats are visible at once (split view, or Chief of Staff
  // open alongside a workspace agent panel). Updated by focusin/focusout handlers
  // on the panel wrapper plus an initial sync below.
  let isInternallyFocused = $state(false);
  const isChatFocused = $derived(isPanelFocused || isInternallyFocused);

  // Panel-wide OS-file drop target: dropping files anywhere over the chat panel
  // attaches them via SimpleRichInput's pipeline (which renders with
  // externalDropTarget so its own drag handlers/overlay stay off in this
  // context). Gated on isFileDragEvent inside the helper, so text/content and
  // tab drags are unaffected, and on input availability, so the overlay never
  // invites a drop that would be discarded (e.g. while the question wizard is
  // expanded and SimpleRichInput is unmounted).
  let isFileDragOverPanel = $state(false);
  const panelFileDrop = createFileDropTarget({
    onDragChange: (dragging) => (isFileDragOverPanel = dragging),
    onDrop: (files) => void inputComponent?.handleDroppedFiles?.(files),
    isEnabled: () => !!inputComponent,
  });

  // Clear stale drag state if the input unmounts mid-drag (wizard expands).
  $effect(() => {
    if (!inputComponent) panelFileDrop.reset();
  });

  // The panel header (agent name row) is part of the drop target too: while
  // this chat is the active tab and the input can accept files, register the
  // same pipeline with the surrounding panel-system Panel (context is null
  // outside a panel, e.g. the Chief of Staff sidebar). Header drags drive the
  // same overlay via isFileDragOverHeader.
  const panelFileDropContext = getPanelFileDropContext();
  let isFileDragOverHeader = $state(false);
  $effect(() => {
    if (!panelFileDropContext || !isActive || !inputComponent) return;
    const handler = {
      onDrop: (files: File[]) => void inputComponent?.handleDroppedFiles?.(files),
      onDragChange: (dragging: boolean) => (isFileDragOverHeader = dragging),
    };
    panelFileDropContext.register(handler);
    return () => {
      panelFileDropContext.unregister(handler);
      isFileDragOverHeader = false;
    };
  });

  $effect(() => {
    if (!panelElement || typeof document === 'undefined') return;
    isInternallyFocused = panelElement.contains(document.activeElement);
  });

  // Build a search catalog that matches what's actually rendered in the DOM.
  // The rendered text for a message is the result of two transforms applied by
  // MessageContent.svelte:
  //
  //   1. groupContentBlocks() splits text blocks on `<group:Name>` / `</group>`
  //      and `<think>` / `</think>` tags, consuming the tag markup and moving
  //      think content into separate `'thinking'` blocks.
  //   2. parseSuggestedPrompts(text).cleanedContent strips the
  //      `<!-- suggested-prompts … -->` comment block from each text block
  //      before markdown rendering.
  //
  // Mirroring those exact transforms (instead of re-encoding them as a regex)
  // keeps the search index in lockstep with the renderer automatically.
  //
  // Additionally:
  //   - Only the last top-level content_group stays expanded after streaming
  //     (`isLast={blockIndex === groupedBlocks.length - 1}` in
  //     MessageContent.svelte); earlier groups collapse and their children are
  //     removed from the DOM by ResponseGroup's `{#if isExpanded || showCylinder}`
  //     gate, so matches inside them have no text nodes to highlight.
  //   - Event-notification user messages are rendered as an EventWakeupBanner
  //     summary (+ optional AgentCards) instead of a ChatMessage, so the raw
  //     text never reaches the DOM.
  //
  // Skipping both categories here prevents unreachable "ghost" matches.
  // Derive all individual match positions: { messageId, matchIndex (within message), turnKey }
  // turnKey ties each match back to its enclosing conversation turn so that the
  // current-match turn (and its neighbors) can be force-rendered through the
  // LazyTurn virtualization while searching.
  const allSearchMatches = $derived.by(() => {
    return findChatSearchMatches($agentMessages$, debouncedSearchQuery, messageIdToTurnKey);
  });

  // Derive the match count from allSearchMatches
  const searchMatchCount = $derived(allSearchMatches.length);

  // Small set of turnKeys that must stay force-rendered while search is active:
  // just the current match's turn plus SEARCH_NEIGHBOR_COUNT neighbors on each
  // side (with wraparound). This caps the number of LazyTurn re-renders per
  // navigation step to a constant instead of "every turn containing a match".
  const visibleSearchTurnKeys = $derived.by(() => {
    const set = new Set<string>();
    const matches = allSearchMatches;
    if (matches.length === 0) return set;
    const total = matches.length;
    for (let offset = -SEARCH_NEIGHBOR_COUNT; offset <= SEARCH_NEIGHBOR_COUNT; offset++) {
      let idx = (currentSearchIndex + offset) % total;
      if (idx < 0) idx += total;
      set.add(matches[idx].turnKey);
    }
    return set;
  });

  // Navigate to a search match (wraps around at boundaries)
  function scrollToSearchMatch(index: number) {
    if (allSearchMatches.length === 0) return;
    // Navigating to an earlier match means the user no longer wants the
    // viewport pinned to the bottom; drop follow so incoming streaming content
    // doesn't yank them away from the highlighted match.
    shouldFollowBottom = false;
    // Wrap around: going past the end cycles to the beginning, and vice versa
    let wrappedIndex = index % allSearchMatches.length;
    if (wrappedIndex < 0) wrappedIndex += allSearchMatches.length;
    currentSearchIndex = wrappedIndex;
    triggerHighlight();
  }

  // Trigger highlighting (called from event handlers, not effects)
  // Async: awaits Svelte's pending DOM updates so that any LazyTurn force-rendered
  // by the visibleSearchTurnKeys change has actually rendered its message content
  // before we run querySelector('[data-message-id="..."]').
  async function triggerHighlight() {
    // Use untrack to read reactive values without creating dependencies
    const query = untrack(() => debouncedSearchQuery);
    const index = untrack(() => currentSearchIndex);
    const isShowing = untrack(() => showSearch);
    const matches = untrack(() => allSearchMatches);
    const container = untrack(() => scrollContainer);
    await tick();
    // Use requestAnimationFrame to ensure DOM is ready
    requestAnimationFrame(() => {
      doHighlightSearchMatches(query, index, matches, isShowing, container);
    });
  }

  // Use CSS Custom Highlight API for search highlighting
  // This is a browser-native way to highlight text without modifying the DOM
  // which avoids issues with Svelte/React re-rendering and wiping out our changes
  function doHighlightSearchMatches(
    query: string,
    currentIndex: number,
    matches: ChatSearchMatch[],
    isShowing: boolean,
    container: HTMLDivElement | undefined,
  ) {
    // Clear existing highlights
    CSS.highlights?.delete('search-results');
    CSS.highlights?.delete('current-search-result');

    if (!isShowing || !query.trim() || matches.length === 0 || !container) {
      return;
    }

    // Check if CSS Custom Highlight API is supported
    if (!CSS.highlights) {
      console.warn('[ChatPanel Search] CSS Custom Highlight API not supported');
      return;
    }

    const lowerQuery = query.toLowerCase();
    const allRanges: Range[] = [];
    let currentRange: Range | null = null;

    // Group matches by messageId
    const matchesByMessage = new Map<string, number[]>();
    matches.forEach((m, globalIndex) => {
      if (!matchesByMessage.has(m.messageId)) {
        matchesByMessage.set(m.messageId, []);
      }
      matchesByMessage.get(m.messageId)!.push(globalIndex);
    });

    // PERF: Index message elements once instead of running querySelector per message.
    // Previous implementation did a full container subtree scan for every message with
    // matches; this collapses that to a single walk.
    const messageElById = new Map<string, Element>();
    for (const el of container.querySelectorAll('[data-message-id]')) {
      const id = (el as HTMLElement).dataset.messageId;
      if (id && !messageElById.has(id)) messageElById.set(id, el);
    }

    for (const [messageId, globalIndices] of matchesByMessage) {
      const messageEl = messageElById.get(messageId);
      if (!messageEl) continue;

      // Walk all text nodes once, concatenating them into `fullText` and recording
      // each node's cumulative start offset. Running indexOf on the concatenated text
      // (instead of per-node) ensures we find matches that span multiple text nodes
      // — e.g. a query landing across syntax-highlighter token boundaries inside a
      // code block. Without this, the per-node scan miscounts against the catalog
      // and subsequent matches in the same message get mislabelled global indices.
      const walker = document.createTreeWalker(messageEl, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => {
          const parent = (n as Text).parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          const tag = parent.tagName;
          if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEXTAREA' || tag === 'INPUT') {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      });

      const textNodes: Text[] = [];
      const nodeStarts: number[] = [];
      const parts: string[] = [];
      let cursor = 0;
      let node: Text | null;
      while ((node = walker.nextNode() as Text | null)) {
        const text = node.textContent ?? '';
        textNodes.push(node);
        nodeStarts.push(cursor);
        parts.push(text);
        cursor += text.length;
      }

      if (cursor === 0) continue;

      const fullText = parts.join('');
      const lowerFullText = fullText.toLowerCase();
      const maxMatches = globalIndices.length;
      let searchPos = 0;
      let matchCountInMessage = 0;

      while (matchCountInMessage < maxMatches) {
        const hit = lowerFullText.indexOf(lowerQuery, searchPos);
        if (hit === -1) break;
        const hitEnd = hit + lowerQuery.length;
        const globalIndex = globalIndices[matchCountInMessage];

        const range = createRangeForSpan(textNodes, nodeStarts, hit, hitEnd);
        if (range) {
          if (globalIndex === currentIndex) {
            currentRange = range;
          } else {
            allRanges.push(range);
          }
        }

        matchCountInMessage++;
        // Advance by query length (non-overlapping) — matches allSearchMatches'
        // counting so global indices stay aligned with the catalog.
        searchPos = hitEnd;
      }
    }

    // Create highlights
    if (allRanges.length > 0) {
      const searchHighlight = new Highlight(...allRanges);
      CSS.highlights.set('search-results', searchHighlight);
    }

    if (currentRange) {
      const currentSearchHighlight = new Highlight(currentRange);
      CSS.highlights.set('current-search-result', currentSearchHighlight);

      // Scroll to the current match
      const rect = currentRange.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const elementOffsetTop = rect.top - containerRect.top + container.scrollTop;
      const targetScrollTop = elementOffsetTop - containerRect.height / 2 + rect.height / 2;

      container.scrollTo({
        top: Math.max(0, targetScrollTop),
        behavior: 'smooth',
      });
    }
  }

  // Flush any pending debounce so the next operation (Enter / Escape) sees
  // the latest typed query immediately.
  function flushSearchDebounce() {
    if (searchDebounceTimer !== null) {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = null;
    }
    if (debouncedSearchQuery !== searchQuery) {
      debouncedSearchQuery = searchQuery;
    }
  }

  // Close the search UI and fully reset search state. All close paths (Esc,
  // X button) must route through here so a stale `debouncedSearchQuery` or
  // pending debounce timer can't leave `allSearchMatches` populated — which
  // would otherwise show a stale match count and keep `LazyTurn` neighbors
  // force-visible the next time the search panel reopens.
  function closeSearch() {
    if (searchDebounceTimer !== null) {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = null;
    }
    showSearch = false;
    searchQuery = '';
    debouncedSearchQuery = '';
    triggerHighlight();
  }

  function navigateToPreviousSearchMatch() {
    // Pressing Enter before the debounce fires should navigate immediately
    // using the latest typed query, not the stale debounced one.
    flushSearchDebounce();
    scrollToSearchMatch(currentSearchIndex - 1);
  }

  function navigateToNextSearchMatch() {
    // Pressing Enter before the debounce fires should navigate immediately
    // using the latest typed query, not the stale debounced one.
    flushSearchDebounce();
    scrollToSearchMatch(currentSearchIndex + 1);
  }

  // Handle search input changes — debounce the expensive match derivation so
  // intermediate keystrokes don't trigger a full rewalk + LazyTurn re-render
  // cascade. An empty query flushes immediately to clear highlights.
  function handleSearchInput() {
    currentSearchIndex = 0;
    if (searchDebounceTimer !== null) {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = null;
    }
    if (!searchQuery.trim()) {
      debouncedSearchQuery = '';
      triggerHighlight();
      return;
    }
    searchDebounceTimer = setTimeout(() => {
      searchDebounceTimer = null;
      debouncedSearchQuery = searchQuery;
      triggerHighlight();
    }, SEARCH_DEBOUNCE_MS);
  }

  function openSearchFromSelection() {
    const selectedText = getSelectedTextWithinSurface(panelElement);

    if (selectedText) {
      if (searchDebounceTimer !== null) {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = null;
      }
      searchQuery = selectedText;
      debouncedSearchQuery = selectedText;
      currentSearchIndex = 0;
    }

    showSearch = true;
    tick().then(() => {
      searchInputRef?.focus();
      searchInputRef?.select();
      if (selectedText) triggerHighlight();
    });
  }

  // Context items for the input
  let contextItems = $state<ContextItem[]>([]);

  // Input value
  let inputValue = $state(
    untrack(() =>
      workspace?.id ? selectChatDraft.select(appStore.state, workspace.id, agentId) : '',
    ),
  );

  // Input history for up/down arrow navigation (like terminal)
  // Stores previously sent user prompts
  let inputHistory = $state<string[]>([]);
  // Current position in history (-1 means not navigating, at "new input" position)
  let historyIndex = $state(-1);
  // Saved input when user starts navigating history
  let savedInput = $state('');
  // Track if history has been initialized from messages
  let historyInitialized = $state(false);

  /**
   * Check if a message is automated (system-initiated, not user-typed)
   * User-typed messages never have metadata.type set.
   * All automated messages (event notifications, task wakes, agent messages, etc.)
   * have metadata.type defined.
   */
  function isAutomatedMessage(message: AgentMessage): boolean {
    // Primary check: User-typed messages never have metadata.type
    // All automated messages have metadata.type set
    if (message.metadata?.type) {
      return true;
    }

    // Fallback check for legacy messages that lost metadata during persistence
    // Check if the message content starts with known automated message patterns
    const text = extractAllContent(message);
    if (
      text.startsWith('[WORKSPACE EVENTS]') ||
      text.startsWith('[TASK WAKE]') ||
      text.startsWith('[AGENT MESSAGE]')
    ) {
      return true;
    }

    return false;
  }

  function isEventWakeMessage(message?: AgentMessage): boolean {
    if (!message) return false;
    return (
      message.metadata?.type === 'event_notification' ||
      extractAllContent(message).trim().startsWith('[WORKSPACE EVENTS]')
    );
  }

  // Initialize input history from existing chat messages
  // This runs once when messages are first loaded
  $effect(() => {
    if (historyInitialized) return;
    const messages = $agentMessages$;
    if (messages.length === 0) return;

    // Extract user messages and build history, excluding automated messages
    const userMessages = messages
      .filter((m) => m.role === 'user' && !isAutomatedMessage(m))
      .map((m) => extractAllContent(m).trim())
      .filter((text) => text.length > 0);

    if (userMessages.length > 0) {
      // Dedupe while preserving order (most recent last)
      const seen = new Set<string>();
      const deduped: string[] = [];
      for (const msg of userMessages) {
        if (!seen.has(msg)) {
          seen.add(msg);
          deduped.push(msg);
        }
      }
      inputHistory = deduped.slice(-100); // Keep last 100
      historyInitialized = true;
    }
  });

  // Draft restore/save lifecycle (gated restore + debounced save); see
  // chat-panel-draft.svelte.ts. While gateActive the composer rejects focus
  // and typing; the ChatDraftLoadingGate indicator only appears once the
  // restore is slow enough for gateVisible to flip. The Redux transient-ui
  // draft (initial inputValue + setChatDraft on value change) stays alongside
  // it as the synchronous same-process remount cache.
  const draftManager = createChatDraftManager({
    drafts: appClient.drafts,
    workspaceId: () => workspace?.id,
    agentId: () => agentId,
    inputValue: () => inputValue,
    setInputValue: (text) => (inputValue = text),
    contextItems: () => contextItems,
    setContextItems: (items) => (contextItems = items),
    applyEditorContent: (text) => inputComponent?.setContent?.(text),
    onSaveError: (err) => {
      logger.warn('[ChatPanel] Failed to save draft', { error: String(err) });
    },
  });

  // Reference to QueuedMessageList for programmatic editing via Up arrow
  let queuedMessageListRef: QueuedMessageList | undefined = $state();

  // Derive current main panel context from workspace state
  // This shows what's currently open in the main panel (file, note, diff, etc.)
  type MainPanelContext = {
    type: 'file' | 'note' | 'spec';
    path?: string;
    title?: string;
    noteId?: string;
    kind?: 'file' | 'note' | 'spec' | 'diff';
  };

  const mainPanel = selectWorkspaceNavigationMainPanel(workspaceIdStore);
  let currentMainPanelContext = $derived.by((): MainPanelContext | null => {
    if (!workspace?.id) return null;

    if (!$mainPanel?.type || $mainPanel.type === 'empty') {
      return null;
    }

    // Handle file type
    if ($mainPanel.type === 'file' && $mainPanel.selectedFile) {
      return {
        type: 'file',
        path: $mainPanel.selectedFile,
        kind: 'file',
      };
    }

    // Handle notes type
    if ($mainPanel.type === 'notes' && $mainPanel.selectedNoteId) {
      const noteId = $mainPanel.selectedNoteId;
      const note = selectNoteById.select(appStore.state, workspace.id, noteId);
      const isSpec = noteId === 'spec';

      return {
        type: isSpec ? 'spec' : 'note',
        noteId,
        title: note?.title || (isSpec ? m.chat_shared_spec_label() : undefined),
        kind: isSpec ? 'spec' : 'note',
      };
    }

    // Handle diff types
    if ($mainPanel.type === 'file-tracking-diff' && $mainPanel.selectedFile) {
      return {
        type: 'file',
        path: $mainPanel.selectedFile,
        kind: 'diff',
      };
    }

    return null;
  });

  // Get panel layout manager for reading available panels (not agent tabs)
  const panelLayoutManager = $derived(workspace?.id ? getPanelLayoutManager(workspace.id) : null);
  let previousAvailablePanelContexts: PanelContextItem[] = [];

  function stabilizeAvailablePanelContexts(panels: PanelContextItem[]): PanelContextItem[] {
    if (deepEqual(previousAvailablePanelContexts, panels)) {
      return previousAvailablePanelContexts;
    }

    previousAvailablePanelContexts = panels;
    return panels;
  }

  // Derive available panel contexts from all open tabs (excluding agent tabs and this agent's tab)
  // Reading $allPanelLayoutTabs$ creates a reactive dependency on Redux panel-layout state,
  // so this derived recomputes whenever tabs are added, removed, or reordered.
  let availablePanelContexts = $derived.by((): PanelContextItem[] => {
    void $allPanelLayoutTabs$; // reactive dependency on panel layout tab changes
    if (!panelLayoutManager || !workspace?.id) return stabilizeAvailablePanelContexts([]);

    const panels: PanelContextItem[] = [];
    const panelIds = panelLayoutManager.getPanelIds();

    for (const panelId of panelIds) {
      const panel = panelLayoutManager.getPanel(panelId);
      if (!panel) continue;

      for (const tab of panel.tabs) {
        // Skip THIS agent's tab (the one this ChatPanel belongs to) - we don't need to include ourselves
        if (tab.type === 'agent' && tab.agentId === agentId) continue;
        // Skip tabs without useful content
        if (tab.type === 'terminal' || tab.type === 'code-review' || tab.type === 'local-changes')
          continue;
        if (tab.type === 'chat-changes') continue;

        // Check if this tab is the active tab in its panel
        const isActiveTab = panel.activeTabId === tab.id;

        // Create context item based on tab type
        let contextItem: PanelContextItem | null = null;

        if (tab.type === 'file' && tab.filePath) {
          contextItem = {
            id: tab.id,
            panelId,
            tabId: tab.id,
            type: 'file',
            label: tab.title || tab.filePath.split('/').pop() || m.chat_shared_file_fallback(),
            filePath: tab.filePath,
            checked: false, // Default unchecked - user opts-in
            isActive: isActiveTab,
          };
        } else if (tab.type === 'note' && tab.noteId) {
          const isSpec = tab.noteId === 'spec';
          contextItem = {
            id: tab.id,
            panelId,
            tabId: tab.id,
            type: isSpec ? 'spec' : 'note',
            label:
              tab.title || (isSpec ? m.chat_shared_spec_label() : m.chat_shared_note_fallback()),
            noteId: tab.noteId,
            checked: false,
            isActive: isActiveTab,
          };
        } else if (tab.type === 'diff' && tab.diffPath) {
          contextItem = {
            id: tab.id,
            panelId,
            tabId: tab.id,
            type: 'diff',
            label: tab.title || tab.diffPath.split('/').pop() || m.chat_shared_diff_fallback(),
            filePath: tab.diffPath,
            checked: false,
            isActive: isActiveTab,
          };
        } else if (tab.type === 'browser' && tab.browserUrl) {
          contextItem = {
            id: tab.id,
            panelId,
            tabId: tab.id,
            type: 'browser',
            label: tab.title || m.chat_shared_browser_fallback(),
            browserUrl: tab.browserUrl,
            checked: false,
            isActive: isActiveTab,
          };
        } else if (
          tab.type === 'changes' ||
          tab.type === 'activity' ||
          tab.type === 'activity-changes'
        ) {
          // Include changes and activity tabs as generic context
          contextItem = {
            id: tab.id,
            panelId,
            tabId: tab.id,
            type: 'diff', // Use 'diff' type for changes-related tabs
            label: tab.title || tab.type,
            checked: false,
            isActive: isActiveTab,
          };
        } else if (tab.type === 'agent' && tab.agentId) {
          // Include other agent tabs as context
          contextItem = {
            id: tab.id,
            panelId,
            tabId: tab.id,
            type: 'agent',
            label: tab.title || m.chat_shared_agentName_fallback(),
            agentId: tab.agentId,
            checked: false,
            isActive: isActiveTab,
          };
        }

        if (contextItem) {
          panels.push(contextItem);
        }
      }
    }

    // Sort panels: active tabs first, then alphabetically by label
    const sortedPanels = panels.sort((a, b) => {
      if (a.isActive && !b.isActive) return -1;
      if (!a.isActive && b.isActive) return 1;
      return a.label.localeCompare(b.label);
    });

    return stabilizeAvailablePanelContexts(sortedPanels);
  });

  // Update the multi-panel context store when available panels change
  // Use untrack to prevent infinite loop - we only care about the value, not reactivity of the update
  $effect(() => {
    const workspaceId = workspace?.id ?? null;
    if (!workspaceId || !isActive) return;

    const panels = availablePanelContexts;
    untrack(() => {
      appStore.dispatch(setMultiPanelWorkspace(workspaceId));
      appStore.dispatch(updateMultiPanels(panels));
    });
  });

  // Sync selection context from editors to multi-panel context Redux store
  // Listen for the custom 'editor:selection-change' event dispatched by CodeEditor and TipTap
  // Editors dispatch 'editor:selection-change' custom events which we sync to Redux
  $effect(() => {
    const handleSelectionChange = (
      event: CustomEvent<{ text: string; file?: string; language?: string; source: string }>,
    ) => {
      const { text, file, language } = event.detail;
      // We use a synthetic panelId based on the file path since the legacy store
      // doesn't track panel info - this ensures selections show up in the picker
      const panelId = file || 'unknown';
      const tabId = file || 'selection';

      if (text?.trim()) {
        // Add selection to multi-panel context store
        // Detect if this is from a note (markdown) vs a code file
        const isNote = language === 'markdown' && !file?.includes('/');
        appStore.dispatch(
          setMultiPanelSelection({
            panelId,
            tabId,
            sourceType: isNote ? 'note' : 'file',
            sourceLabel: file?.split('/').pop() || m.chat_chatPanel_selection_fallback(),
            filePath: isNote ? undefined : file,
            text: text,
            language: language,
            timestamp: Date.now(),
          }),
        );
      } else {
        // Clear the selection when text is deselected
        // This event is only dispatched when editor.isFocused is true (user clicked within the editor)
        // so it won't clear when user clicks on chat input to send
        appStore.dispatch(clearMultiPanelSelection(panelId, tabId));
      }
    };

    window.addEventListener('editor:selection-change', handleSelectionChange as EventListener);
    return () => {
      window.removeEventListener('editor:selection-change', handleSelectionChange as EventListener);
    };
  });

  // Pending initial prompt data - shown immediately as optimistic UI before the message is actually sent.
  // Reads from `initialPromptProp` (passed from parent); the sessionStorage-based
  // FE-side send was removed with the daemon-owned create sequence.
  function getInitialPendingData(): { prompt: string | null; contextReferences: any[] | null } {
    if (initialPromptProp) {
      logger.info('Using initial prompt from prop for optimistic display', {
        agentId,
        promptLength: initialPromptProp.length,
      });
      return { prompt: initialPromptProp, contextReferences: null };
    }
    return { prompt: null, contextReferences: null };
  }

  // Initialize synchronously - this runs immediately when component is created
  let pendingInitialData = $state<{ prompt: string | null; contextReferences: any[] | null }>(
    getInitialPendingData(),
  );
  // Alias for backward compatibility
  let pendingInitialPrompt = $derived(pendingInitialData.prompt);

  // Provider/model lock — prevents changing provider or model after any message
  let canChangeProvider = $derived(
    resolveCanChangeAgentProvider({
      session: $agentSession$ ?? null,
      messages: $agentMessages$,
      pendingInitialPrompt,
      pendingContextReferenceCount: pendingInitialData.contextReferences?.length ?? 0,
    }),
  );

  // Hydrated input model — uses session model when available, falls back to agentModel prop
  let hydratedInputModel = $derived(resolveHydratedInputModel($agentSession$, agentModel));

  const catalogDefaultProviderId$ = selectEffectiveDefaultProviderId();

  // Provider ID for the input — resolved from the agent session
  let inputProviderId = $derived.by(() => {
    if (!$agentSession$) return undefined;
    return getAgentProvider($agentSession$, $catalogDefaultProviderId$);
  });

  // Create a synthetic message object for the pending prompt to use with ChatMessage component
  // Include contextReferences in metadata so they display as pills
  let pendingMessage = $derived(
    pendingInitialPrompt || pendingInitialData.contextReferences?.length
      ? ({
          id: 'pending-initial-message',
          role: 'user' as const,
          timestamp: new Date(),
          contentBlocks: pendingInitialPrompt
            ? [{ type: 'text' as const, text: pendingInitialPrompt }]
            : [],
          metadata: pendingInitialData.contextReferences?.length
            ? { contextReferences: pendingInitialData.contextReferences }
            : undefined,
        } as AgentMessage)
      : null,
  );

  // Grouped messages for display (include ALL messages)
  // We'll handle the streaming state when rendering
  let groupedMessages = $derived(groupMessagesByDate($agentMessages$));

  // ── "New messages" divider (unread marker, PROTOCOL §5.5 agent.markSeen) ──
  // The divider is entry-only and frozen per viewing session: on the first
  // transcript hydration the anchor is derived ONCE from the seen marker and
  // latched in Redux (unreadTracking.dividerSessionByAgentId) — `null` is
  // latched too ("session started, no divider"). First-write-wins in the
  // slice makes cached-panel remounts harmless; the latch clears only at
  // stop-looking boundaries (tab close / active-workspace switch — see
  // divider-session-boundary-service).
  let latchedDividerSessionAgentId: string | null = null;
  $effect(() => {
    if (!agentId || latchedDividerSessionAgentId === agentId) return;
    if ($transcriptHydration$ !== 'settled') return;
    latchedDividerSessionAgentId = agentId;
    appStore.dispatch(
      startDividerSession(
        agentId,
        resolveNewMessagesDividerAnchor(
          $agentMessages$.map((message) => message.id),
          typeof $agentSession$?.metadata?.lastSeenMessageId === 'string'
            ? $agentSession$.metadata.lastSeenMessageId
            : undefined,
        ),
      ),
    );
  });
  // Rendered position comes ONLY from the latched anchor — later
  // lastSeenMessageId convergence never adds/moves/removes the divider. A
  // latched anchor no longer in the transcript (e.g. edit-and-regenerate
  // truncation) hides it without recomputing.
  const newMessagesDividerAnchorId = $derived(
    resolveLatchedDividerAnchor(
      $agentMessages$.map((message) => message.id),
      $dividerSession$?.anchorId ?? null,
    ),
  );
  // One-shot guard: the divider entry-positioning happens once per panel mount
  // (first transcript availability), never again on later marker convergence.
  let hasAppliedNewMessagesEntryScroll = false;
  // One-shot guard: the cached scroll position is applied once on the first
  // transcript availability after remount, never again on later hydrations.
  let hasConsumedCachedScrollRestore = false;
  // Reapply the previous instance's scroll position (see cachedScrollRestoreTop
  // above). Returns true when the cached position was consumed.
  function applyCachedScrollRestore(): boolean {
    if (cachedScrollRestoreTop === null || hasConsumedCachedScrollRestore) return false;
    // Not consumed until the container is bound, so a premature call cannot
    // silently drop the cached position.
    if (!scrollContainer) return false;
    hasConsumedCachedScrollRestore = true;
    // The unread-divider entry scroll is superseded — the user already had a
    // deliberate reading position when the panel was unmounted.
    hasAppliedNewMessagesEntryScroll = true;
    scrollContainer.scrollTop = cachedScrollRestoreTop;
    return true;
  }
  // Get the auggie session ID from the most recent assistant message's metadata
  // This is the raw UUID format that auggie uses, needed for debugging/support
  let auggieSessionId = $derived.by(() => {
    // Look for auggieSessionId in assistant messages (most recent first)
    for (let i = $agentMessages$.length - 1; i >= 0; i--) {
      const msg = $agentMessages$[i];
      if (msg.role === 'assistant' && msg.metadata?.auggieSessionId) {
        return msg.metadata.auggieSessionId as string;
      }
    }
    return undefined;
  });

  // PERF: Pre-compute total turn count for lazy loading decisions
  // Count user messages as proxy for turns (each user message starts a turn)
  const totalTurnCount = $derived($agentMessages$.filter((m) => m.role === 'user').length);

  // PERF: Enable lazy loading only for larger conversations
  const shouldUseLazyLoading = $derived(shouldVirtualizeTurns(totalTurnCount));

  // PERF: Pre-compute message index and turn number maps for O(1) lookups
  // This avoids O(n²) complexity from indexOf/slice/filter in the render loop
  const messageIndexMap = $derived.by(() => {
    const map = new Map<string, number>();
    for (let i = 0; i < $agentMessages$.length; i++) {
      map.set($agentMessages$[i].id, i);
    }
    return map;
  });

  const messageTurnNumberMap = $derived.by(() => {
    const map = new Map<string, number>();
    let turnCount = 0;
    for (const message of $agentMessages$) {
      if (message.role === 'assistant') {
        turnCount++;
        map.set(message.id, turnCount);
      }
    }
    return map;
  });

  // Track previous message count to detect new messages
  let previousMessageCount = $state(0);

  // Auto-scroll to bottom when new messages are added and shouldFollowBottom is true
  $effect(() => {
    const currentCount = $agentMessages$.length;
    // Scroll to bottom when:
    // 1. New message added AND following is enabled, OR
    // 2. First message added (transition from empty to non-empty) - always scroll to show the new content
    const isFirstMessage = previousMessageCount === 0 && currentCount > 0;
    const hasNewMessages = currentCount > previousMessageCount;
    const shouldScroll =
      hasNewMessages && (isFirstMessage || shouldFollowBottom);
    if (hasNewMessages) {
      // Unread-marker entry: on the first transcript hydration with a latched
      // divider anchor, land at the "New messages" divider with follow
      // disabled when the unseen tail is taller than the viewport; when it
      // fits on screen, scroll to the bottom with follow enabled instead
      // (decided inside scrollToNewMessagesDivider).
      if (isFirstMessage && cachedScrollRestoreTop !== null && !hasConsumedCachedScrollRestore) {
        // Remount after column windowing: land at the previous instance's
        // reading position instead of the divider/bottom entry scroll.
        tick().then(() => {
          if (isComponentDestroyed) return;
          applyCachedScrollRestore();
        });
      } else if (
        shouldScroll &&
        isFirstMessage &&
        !hasAppliedNewMessagesEntryScroll &&
        newMessagesDividerAnchorId
      ) {
        hasAppliedNewMessagesEntryScroll = true;
        void scrollToNewMessagesDivider(newMessagesDividerAnchorId);
      } else {
        // New message added - scroll to bottom after DOM updates
        // Re-enable auto-follow when first message is added
        if (shouldScroll && isFirstMessage) {
          shouldFollowBottom = true;
        }
        tick().then(() => {
          // Guard against component destruction during tick
          if (isComponentDestroyed) return;
          const startedTransition = startPendingSendTransitions();
          if (scrollContainer && shouldScroll && !startedTransition) {
            scrollToBottomUtil(scrollContainer);
          }
        });
      }
    }
    previousMessageCount = currentCount;
  });

  // Helper functions for O(1) lookups
  function getMessageIndex(messageId: string): number {
    return messageIndexMap.get(messageId) ?? -1;
  }

  function getMessageTurnNumber(messageId: string): number {
    return messageTurnNumberMap.get(messageId) ?? 0;
  }

  // Compute the turn structure and both virtualization/search indexes in one
  // transcript pass rather than regrouping each date bucket for every consumer.
  const conversationTurnIndex = $derived(indexConversationTurns(groupedMessages));

  const lastConversationTurn = $derived.by((): ConversationTurn | null => {
    const lastGroup = conversationTurnIndex.groups[conversationTurnIndex.groups.length - 1];
    return lastGroup?.turns[lastGroup.turns.length - 1] ?? null;
  });

  // Hide the aggregate file-changes row when it merely duplicates the last
  // turn's per-turn row (same set of changed file paths)
  const showAggregateFileChangesSummary = $derived.by(() => {
    return (
      $agentMessages$.filter((message) => message.role === 'assistant').length > 1 &&
      !isAggregateFileChangesRedundant($agentMessages$)
    );
  });

  const showEndOfListStreamingStatus = $derived(
    shouldShowEndOfListStreamingStatus({
      isStreaming: $agentSessionIsStreaming$,
      isProcessing: $agentIsResponding$,
      error: $chatError$,
      modelUnavailable: $chatModelUnavailable$,
      hasMessages: $agentMessages$.length > 0,
      lastTurnHasAssistantMessages: (lastConversationTurn?.assistantMessages.length ?? 0) > 0,
      lastAssistantMessageIsStreaming:
        $agentSessionIsStreaming$ && (lastConversationTurn?.assistantMessages.length ?? 0) > 0,
    }),
  );

  // PERF: Pre-compute global turn index map for lazy loading decisions
  // Maps turnKey (userMessageId or `group-${groupIndex}-turn-${turnIndex}`) to global index
  const globalTurnIndexMap = $derived(conversationTurnIndex.globalIndexByTurnKey);

  $effect(() => {
    lazyTurnHeightCache.retain(globalTurnIndexMap.keys());
  });

  // Map each messageId to its enclosing turnKey. Used by allSearchMatches so that
  // matches in virtualized LazyTurn placeholders can be force-rendered during search.
  const messageIdToTurnKey = $derived(conversationTurnIndex.turnKeyByMessageId);

  // Helper to check if a turn should be force-visible (recent or streaming)
  function isTurnForceVisible(turnKey: string): boolean {
    if (!shouldUseLazyLoading) return true; // Always visible if lazy loading is disabled
    const globalIndex = globalTurnIndexMap.get(turnKey);
    if (globalIndex === undefined) return true; // Unknown turn, render it
    const totalTurns = globalTurnIndexMap.size;
    return (
      isTurnInRecentWindow(globalIndex, totalTurns) ||
      isTurnTemporarilyMaterialized(temporaryTurnMaterialization, turnKey)
    );
  }

  // --- Auto-commit status (fetched once, shared across all AutoCommitStatus instances) ---
  let autoCommitStatuses = $state<CommitStatus[]>([]);

  function refreshAutoCommitStatuses() {
    if (!agentId) return;
    invoke<{ success: boolean; data: CommitStatus[] }>('git:get-auto-commit-status', { agentId })
      .then((response) => {
        if (response?.success && response.data) {
          autoCommitStatuses = response.data;
        }
      })
      .catch(() => {
        // Silently ignore — component degrades gracefully
      });
  }

  // Fetch on mount / when agentId changes
  $effect(() => {
    void agentId;
    refreshAutoCommitStatuses();
  });

  // Listen for real-time auto-commit events (3 listeners total, not per-turn)
  $effect(() => {
    const cleanupStarted = listenSync<{ agentId: string }>('git:auto-commit-started', (event) => {
      const data = event.payload || event;
      if (data.agentId === agentId) refreshAutoCommitStatuses();
    });
    const cleanupSucceeded = listenSync<{ agentId: string }>(
      'git:auto-commit-succeeded',
      (event) => {
        const data = event.payload || event;
        if (data.agentId === agentId) refreshAutoCommitStatuses();
      },
    );
    const cleanupHookFailure = listenSync<{ agentId: string }>(
      'git:auto-commit-hook-failure',
      (event) => {
        const data = event.payload || event;
        if (data.agentId === agentId) refreshAutoCommitStatuses();
      },
    );
    return () => {
      cleanupStarted();
      cleanupSucceeded();
      cleanupHookFailure();
    };
  });

  // Get tasks assigned to this agent (reactive via Redux task-agent association state)

  // Get the current specialist ID from the session metadata
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const currentSpecialistId = $derived.by(() => {
    const session = $agentSession$;
    if (!session) return null;
    return session.metadata?.specialist || session.agentMetadata?.specialist || null;
  });

  // Generate URL for task navigation
  function getTaskUrl(task: TaskAgentAssociation): string {
    if (!workspace?.id) return '#';
    const url = new URL(window.location.href);
    url.searchParams.set('selectedNoteId', task.noteId);
    url.searchParams.set('mainContentType', 'notes');
    url.searchParams.set('taskText', task.taskText);
    url.searchParams.delete('selectedFile');
    return url.toString();
  }

  // Handle clicking on the task pill - navigate and scroll to the task
  async function handleTaskPillClick(e: MouseEvent, task: TaskAgentAssociation) {
    e.preventDefault();
    // Use taskText to find the task since we don't have position stored
    // Pass -1 as position to force text-based search
    await navigateToTask(task.noteId, -1, task.taskText);
  }

  // Initialize chat on mount
  onMount(() => {
    logger.info('ChatPanel mounted', {
      instanceId,
      agentId,
      workspace: workspace?.id,
    });

    // Permission store is now auto-initialized via Redux saga — no manual initialize() needed

    // Guard: Don't initialize chat for terminal IDs - they should use Terminal component
    if (agentId?.startsWith('terminal-')) {
      logger.warn('ChatPanel mounted with terminal ID - this should not happen', { agentId });
      return;
    }

    // Dispatch initializeChatRequested to the saga — it handles session lookup,
    // disk restore, retry with backoff, message loading, and streaming setup.
    // The saga uses takeLatest to cancel stale init calls automatically.
    if (workspace && agentId) {
      // Mirror to Redux so the send-message saga can detect workspace changes
      appStore.dispatch(chatTrackedWorkspaceSet(agentId, workspace.id));

      appStore.dispatch(
        initializeChatRequested(agentId, {
          wsId: workspace.id,
          options: {
            agentName,
            agentModel,
            isInitialWorkspaceAgent,
          },
        }),
      );

      logger.info('Dispatched initializeChatRequested on mount', {
        agentId,
        workspaceId: workspace.id,
      });

      // Reconcile the queued-messages mirror from the daemon — a missed
      // `agent:queue:updated` (e.g. while this panel was unmounted or during a
      // reconnect gap) would otherwise leave stale drained rows rendered
      // forever (monorepo#1749).
      void hydrateAgentQueue(agentId);

      // Reconstruct onboarding context entirely from workspace + agent session.
      // No external storage needed — all essential data lives on the workspace object.
      const repoName =
        workspace.repositoryName || workspace.repositoryPath?.split('/').pop() || workspace.title;
      if (repoName) {
        const session = $agentSession$;
        onboardingContext = {
          projectName: repoName,
          projectPath: workspace.repositoryPath || '',
          branch: workspace.branch || '',
          prompt: workspace.initialPrompt || '',
          worktreePath: workspace.worktreePath || workspace.repositoryPath || '',
          baseRef: workspace.baseRef ? `origin/${workspace.baseRef}` : 'origin/main',
          repoPath: workspace.repositoryPath || '',
          specialistName: session?.name,
          specialistId: (session?.metadata as any)?.specialist,
          setupScript: workspace.setupScript,
          skipWorktree: workspace.skipWorktree,
        };
      }
    }

    // Chat values are reactive via Redux selectors.
    // No manual Redux store subscription needed — selectors provide always-current values.
    // Initial-message delivery is owned by the daemon (harvested from
    // metadata.initialMessage on workspace create); the ChatPanel no longer
    // sends anything on mount — chat-history hydration renders the daemon-
    // delivered message once it arrives.

    // Scroll handling on mount
    const initialScrollFrame = requestAnimationFrame(() => {
      if (scrollContainer) {
        if ($agentMessages$.length > 0) {
          if (cachedScrollRestoreTop !== null) {
            // Remount after column windowing: restore the previous instance's
            // reading position (no-op when the hydration effect already did).
            applyCachedScrollRestore();
          } else {
            // Scroll to bottom if there are messages
            scrollToBottomUtil(scrollContainer);
          }
        } else {
          // Scroll to top for empty panel (shows specialist switcher)
          scrollContainer.scrollTop = 0;
          // Don't auto-follow until user sends a message
          shouldFollowBottom = false;
        }
      }
    });

    return () => cancelAnimationFrame(initialScrollFrame);
  });

  // ── Auto-focus on mount (used by Chief of Staff) ──
  function isEditableElement(element: Element | null): boolean {
    if (!element) return false;
    if (!(element instanceof HTMLElement)) return false;
    if (element.isContentEditable) return true;
    return Boolean(element.closest('input, textarea, select, [contenteditable="true"]'));
  }

  function shouldSkipPromptAutoFocus(): boolean {
    if (typeof document === 'undefined') return true;
    const activeElement = document.activeElement;
    return isEditableElement(activeElement) && !panelElement?.contains(activeElement);
  }

  onMount(() => {
    if (!autoFocus) return;

    const autoFocusTimer = setTimeout(async () => {
      await tick();
      if (shouldSkipPromptAutoFocus()) return;
      focusPrompt();
    }, 100);

    return () => clearTimeout(autoFocusTimer);
  });

  $effect(() => {
    const transitionWorkspaceId = workspace?.id;
    if (!transitionWorkspaceId) return;
    return cancelAllSendTransitions;
  });

  // WORKSPACE REBIND FIX: Reactively re-initialize chat state when the workspace
  // changes underneath an already-mounted ChatPanel. Without this, the panel stays stuck
  // on the pre-send conversation snapshot because initializeChatRequested only runs on mount and
  // during workspace rebind. During workspace restore/rebind the workspace prop changes
  // but the component does not remount (AgentTabType keys by agentId only).
  $effect(() => {
    const currentWorkspaceId = workspace?.id;
    if (!currentWorkspaceId || !agentId) return;

    // Check if workspace actually changed (also handles null/first-run guard)
    if (!untrack(() => rebindTracker.shouldRebind(currentWorkspaceId))) return;

    logger.info('[ChatPanel] Workspace changed underneath mounted panel, re-initializing chat', {
      instanceId,
      agentId,
      previousWorkspaceId: rebindTracker.trackedWorkspaceId,
      newWorkspaceId: currentWorkspaceId,
    });

    // Save previous workspace ID so we can revert on failure.
    // Update tracking variable (untracked to avoid re-triggering this effect).
    untrack(() => {
      rebindTracker.recordRebind(currentWorkspaceId);
      // Mirror to Redux so the send-message saga can read rebind state
      appStore.dispatch(chatTrackedWorkspaceSet(agentId, currentWorkspaceId));
    });

    // Re-initialize via saga — takeLatest automatically cancels any in-flight older init,
    // replacing the stale-result guard that used to be handled manually.
    const rebindGeneration = untrack(() => rebindTracker.startRebind());
    appStore.dispatch(chatRebindStarted(agentId));

    appStore.dispatch(
      initializeChatRequested(agentId, {
        wsId: currentWorkspaceId,
        options: {
          agentName,
          agentModel,
          isInitialWorkspaceAgent,
        },
      }),
    );

    // Reconcile the queued-messages mirror alongside the transcript re-init
    // (monorepo#1749).
    void hydrateAgentQueue(agentId);

    // The saga is fire-and-forget from the component's perspective.
    // End rebind tracking immediately — the saga handles its own cancellation.
    rebindTracker.endRebind(rebindGeneration);
    appStore.dispatch(chatRebindEnded(agentId));
  });

  // Message navigation state
  let currentMessageIndex = $state(-1); // -1 means at bottom (no selection)

  /**
   * Smoothly scroll an element into view with a custom duration.
   * Uses easeOutCubic for a natural feel.
   */
  function smoothScrollTo(
    element: HTMLElement,
    block: 'start' | 'center' | 'end' = 'center',
    duration: number = 150,
  ) {
    if (!scrollContainer) return;

    const containerRect = scrollContainer.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();

    let targetScrollTop: number;
    if (block === 'center') {
      targetScrollTop =
        scrollContainer.scrollTop +
        (elementRect.top - containerRect.top) -
        containerRect.height / 2 +
        elementRect.height / 2;
    } else if (block === 'start') {
      targetScrollTop = scrollContainer.scrollTop + (elementRect.top - containerRect.top) + 1;
    } else {
      targetScrollTop = scrollContainer.scrollTop + (elementRect.bottom - containerRect.bottom) + 1;
    }

    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      scrollContainer.scrollTop = targetScrollTop;
      return;
    }
    animateScrollTo(() => scrollContainer, targetScrollTop, duration);
  }

  /**
   * Smoothly scroll to a specific position with 150ms animation.
   */
  function smoothScrollToPosition(top: number, duration: number = 150) {
    animateScrollTo(() => scrollContainer, top, duration);
  }

  // Navigate to a specific message by index
  function navigateToMessage(index: number) {
    if (!scrollContainer) return;

    const messages = $agentMessages$;
    if (messages.length === 0) return;

    // Clamp index to valid range, or -1 for "at bottom"
    if (index < 0) {
      currentMessageIndex = -1;
      if (scrollContainer) scrollToBottomUtil(scrollContainer);
      return;
    }

    if (index >= messages.length) {
      index = messages.length - 1;
    }

    currentMessageIndex = index;

    // Find the message element by data-message-index
    const targetElement = scrollContainer.querySelector(
      `[data-message-index="${index}"]`,
    ) as HTMLElement;

    if (targetElement) {
      smoothScrollTo(targetElement, 'center');

      // // Flash highlight effect
      // targetElement.classList.add('message-highlight-flash');
      // setTimeout(() => {
      //   targetElement.classList.remove('message-highlight-flash');
      // }, 600);
    }
  }

  // Handle navigate-message event from keyboard shortcuts
  function handleNavigateMessage(event: Event) {
    const customEvent = event as CustomEvent<{ direction: 'previous' | 'next' }>;
    const direction = customEvent.detail?.direction;

    if (!direction) return;

    const messages = $agentMessages$;
    if (messages.length === 0) return;

    if (direction === 'previous') {
      // If at bottom (no selection), go to last message
      if (currentMessageIndex === -1) {
        navigateToMessage(messages.length - 1);
      } else if (currentMessageIndex > 0) {
        navigateToMessage(currentMessageIndex - 1);
      } else {
        // At first message, scroll to top
        smoothScrollToPosition(0);
      }
    } else {
      // next
      if (currentMessageIndex === -1) {
        // Already at bottom, do nothing
        return;
      } else if (currentMessageIndex < messages.length - 1) {
        navigateToMessage(currentMessageIndex + 1);
      } else {
        // At last message, go to bottom
        navigateToMessage(-1);
      }
    }
  }

  // Set up message navigation listener
  $effect(() => {
    if (typeof window === 'undefined') return;

    window.addEventListener('navigate-message', handleNavigateMessage);

    return () => {
      window.removeEventListener('navigate-message', handleNavigateMessage);
    };
  });

  // Listen for scroll-to-turn events (from agent attribution badges)
  $effect(() => {
    if (typeof window === 'undefined') return;

    const handleScrollToTurn = (event: Event) => {
      const { agentId: targetAgentId, turnNumber } = (event as CustomEvent).detail || {};

      // Only handle if this is for our agent
      if (targetAgentId !== agentId) return;

      logger.info('[ChatPanel] Scroll to turn requested', { targetAgentId, turnNumber });

      // Find the message element with the matching turn number
      const messageElement = scrollContainer?.querySelector(
        `[data-turn-number="${turnNumber}"]`,
      ) as HTMLElement | null;

      if (messageElement) {
        smoothScrollTo(messageElement, 'center');
        // Add highlight effect
        messageElement.classList.add('highlight-flash');
        setTimeout(() => {
          messageElement.classList.remove('highlight-flash');
        }, 1500);
      } else {
        logger.warn('[ChatPanel] Could not find message for turn', { turnNumber });
      }
    };

    window.addEventListener('agent:scroll-to-turn', handleScrollToTurn);

    return () => {
      window.removeEventListener('agent:scroll-to-turn', handleScrollToTurn);
    };
  });

  // Activity items open the agent and request the most precise matching chat location.
  $effect(() => {
    if (typeof window === 'undefined') return;

    const handleScrollToActivity = (event: Event) => {
      const {
        agentId: targetAgentId,
        messageId,
        toolCallId,
        turnNumber,
      } = (event as CustomEvent).detail || {};
      if (targetAgentId !== agentId || !scrollContainer) return;

      const toolSelector = toolCallId
        ? `[data-tool-call-id="${CSS.escape(toolCallId)}"], [data-tool-use-id="${CSS.escape(toolCallId)}"]`
        : null;
      const messageSelector = messageId ? `[data-message-id="${CSS.escape(messageId)}"]` : null;
      const turnSelector =
        typeof turnNumber === 'number' ? `[data-turn-number="${turnNumber}"]` : null;
      const targetElement =
        (toolSelector && scrollContainer.querySelector(toolSelector)) ||
        (messageSelector && scrollContainer.querySelector(messageSelector)) ||
        (turnSelector && scrollContainer.querySelector(turnSelector));

      if (targetElement instanceof HTMLElement) {
        smoothScrollTo(targetElement, 'center');
        targetElement.classList.add('highlight-flash');
        setTimeout(() => targetElement.classList.remove('highlight-flash'), 1500);
      }
    };

    window.addEventListener('agent:scroll-to-activity', handleScrollToActivity);
    return () => window.removeEventListener('agent:scroll-to-activity', handleScrollToActivity);
  });

  // Listen for scroll-to-subscription events (from AgentSubscriptions component)
  $effect(() => {
    if (typeof window === 'undefined') return;

    const handleScrollToSubscription = (event: Event) => {
      const { agentId: targetAgentId } = (event as CustomEvent).detail || {};

      // Only handle if this is for our agent
      if (targetAgentId !== agentId) return;

      logger.info('[ChatPanel] Scroll to subscription requested', { targetAgentId });

      // Find the message that contains a subscribe_to_events or create_agent tool call
      // These are the tools that create subscriptions
      const subscriptionToolNames = ['subscribe_to_events', 'create_agent', 'delegate'];

      // Search messages from newest to oldest to find the most recent subscription
      const allMessages = [...$agentMessages$].reverse();

      for (const message of allMessages) {
        if (message.role !== 'assistant') continue;

        // Check content blocks for tool use
        const contentBlocks = message.contentBlocks || [];
        const hasSubscriptionTool = contentBlocks.some((block: any) => {
          if (block.type !== 'tool_use') return false;
          const toolName = block.name || '';
          return subscriptionToolNames.some((name) => toolName.includes(name));
        });

        if (hasSubscriptionTool) {
          // Find and scroll to this message
          const messageElement = scrollContainer?.querySelector(
            `[data-message-id="${message.id}"]`,
          ) as HTMLElement | null;

          if (messageElement) {
            smoothScrollTo(messageElement, 'center');
            // Add highlight effect
            messageElement.classList.add('highlight-flash');
            setTimeout(() => {
              messageElement.classList.remove('highlight-flash');
            }, 1500);
            logger.info('[ChatPanel] Scrolled to subscription message', { messageId: message.id });
            return;
          }
        }
      }

      logger.warn('[ChatPanel] Could not find subscription message');
    };

    window.addEventListener('agent:scroll-to-subscription', handleScrollToSubscription);

    return () => {
      window.removeEventListener('agent:scroll-to-subscription', handleScrollToSubscription);
    };
  });

  // --- Deep-open at a message (openMessage helper, $lib/utils/open-message) ---
  // The helper hydrates the store (seek page when needed) and hands the DOM
  // work off via 'chat:open-message' on a retry ladder; this panel force-renders
  // the target's turn through LazyTurn, scrolls to it with a brief flash, and
  // highlights the query terms via the CSS Custom Highlight API (cleared on the
  // next user interaction or a short timeout — no persistent markup).
  let deepOpenTurnKey = $state<string | null>(null);
  let deepOpenReleaseTimer: ReturnType<typeof setTimeout> | null = null;
  let temporaryTurnMaterialization = $state<TemporaryTurnMaterialization>({
    ...EMPTY_TEMPORARY_TURN_MATERIALIZATION,
  });
  const handledOpenMessageRequestIds = new Set<string>();
  let clearDeepOpenHighlight: (() => void) | null = null;
  const DEEP_OPEN_HIGHLIGHT_NAME = 'deep-open-match';
  const DEEP_OPEN_HIGHLIGHT_TIMEOUT_MS = 8000;

  function handleTurnEditStateChange(turnKey: string, isEditing: boolean) {
    temporaryTurnMaterialization = isEditing
      ? materializeTurn(temporaryTurnMaterialization, 'editing', turnKey)
      : releaseMaterializedTurn(temporaryTurnMaterialization, 'editing', turnKey);
  }

  function scheduleDeepOpenRelease(turnKey = deepOpenTurnKey) {
    if (deepOpenReleaseTimer !== null) clearTimeout(deepOpenReleaseTimer);
    deepOpenReleaseTimer = setTimeout(() => {
      if (deepOpenTurnKey === turnKey) deepOpenTurnKey = null;
      deepOpenReleaseTimer = null;
    }, 200);
  }

  // Force-render a message's turn through the LazyTurn virtualization (reuses
  // the deep-open force-visible key) and resolve its DOM element once rendered.
  // Drops follow so the placeholder expanding doesn't yank the viewport back
  // down. Retries across a few frames; resolves null if it never appears.
  async function forceRenderAndFindMessage(messageId: string): Promise<HTMLElement | null> {
    deepOpenTurnKey = messageIdToTurnKey.get(messageId) ?? messageId;
    shouldFollowBottom = false;
    await tick();
    const selector = `[data-message-id="${CSS.escape(messageId)}"]`;
    for (let attempt = 0; attempt < 5; attempt++) {
      await new Promise(requestAnimationFrame);
      const targetElement = scrollContainer?.querySelector(selector) as HTMLElement | null;
      if (targetElement) return targetElement;
    }
    logger.warn('[ChatPanel] Message turn not rendered after force-visible', { messageId });
    scheduleDeepOpenRelease();
    return null;
  }

  // Entry positioning for the unread marker: force-render the anchor message's
  // turn (it may be a virtualized LazyTurn placeholder), then decide where to
  // land. If the divider would still be visible with the viewport scrolled
  // fully to the bottom (the whole unseen tail fits on screen), enter like a
  // normal conversation: scroll to the end with auto-follow enabled — the
  // frozen divider stays rendered where it is. Otherwise land the viewport on
  // the "New messages" divider with follow disabled
  // (forceRenderAndFindMessage drops it) so streaming growth doesn't yank the
  // viewport down. Falls back to today's scroll-to-bottom if the anchor never
  // renders.
  async function scrollToNewMessagesDivider(anchorMessageId: string) {
    const anchorElement = await forceRenderAndFindMessage(anchorMessageId);
    if (isComponentDestroyed || !scrollContainer) return;
    const dividerElement = scrollContainer.querySelector(
      '[data-new-messages-divider]',
    ) as HTMLElement | null;
    const targetElement = dividerElement ?? anchorElement;
    if (!targetElement) {
      shouldFollowBottom = true;
      scrollToBottomUtil(scrollContainer);
      scheduleDeepOpenRelease();
      return;
    }
    const containerRect = scrollContainer.getBoundingClientRect();
    const targetRect = targetElement.getBoundingClientRect();
    const targetOffsetTop = scrollContainer.scrollTop + (targetRect.top - containerRect.top);
    if (
      dividerVisibleWhenScrolledToBottom(
        targetOffsetTop,
        scrollContainer.scrollHeight,
        scrollContainer.clientHeight,
      )
    ) {
      shouldFollowBottom = true;
      scrollToBottomUtil(scrollContainer);
      scheduleDeepOpenRelease();
      return;
    }
    smoothScrollTo(targetElement, 'center');
    scheduleDeepOpenRelease();
  }

  // Collect ranges for every case-insensitive occurrence of each query token
  // inside the message element (same text-node walk as the search highlighter,
  // scoped to one message).
  function applyDeepOpenQueryHighlight(messageEl: HTMLElement, query: string) {
    if (!CSS.highlights) return;
    clearDeepOpenHighlight?.();
    const ranges = collectSearchRanges(messageEl, query);
    if (ranges.length === 0) return;
    CSS.highlights.set(DEEP_OPEN_HIGHLIGHT_NAME, new Highlight(...ranges));
    const clear = () => {
      CSS.highlights?.delete(DEEP_OPEN_HIGHLIGHT_NAME);
      window.removeEventListener('pointerdown', clear, true);
      window.removeEventListener('keydown', clear, true);
      window.removeEventListener('wheel', clear, true);
      clearTimeout(timer);
      clearDeepOpenHighlight = null;
    };
    const timer = setTimeout(clear, DEEP_OPEN_HIGHLIGHT_TIMEOUT_MS);
    // Capture phase: any interaction anywhere (click, keypress, manual scroll)
    // clears the transient highlight. The programmatic smooth scroll fires no
    // wheel events, so it never self-clears.
    window.addEventListener('pointerdown', clear, true);
    window.addEventListener('keydown', clear, true);
    window.addEventListener('wheel', clear, true);
    clearDeepOpenHighlight = clear;
  }

  async function handleOpenMessage(event: Event) {
    const detail = (event as CustomEvent).detail as
      { agentId: string; messageId: string; query?: string; requestId: string } | undefined;
    if (!detail || detail.agentId !== agentId) return;
    // The helper dispatches on a retry ladder (the panel may still be
    // mounting); dedup so a successfully handled request runs exactly once.
    if (handledOpenMessageRequestIds.has(detail.requestId)) return;

    // Force-render the target's turn through the LazyTurn virtualization and
    // drop follow so streaming growth doesn't yank the viewport back down.
    deepOpenTurnKey = messageIdToTurnKey.get(detail.messageId) ?? detail.messageId;
    shouldFollowBottom = false;
    await tick();
    requestAnimationFrame(() => {
      const targetElement = scrollContainer?.querySelector(
        `[data-message-id="${CSS.escape(detail.messageId)}"]`,
      ) as HTMLElement | null;
      if (!targetElement) {
        // Not rendered yet — leave the requestId unhandled so a later retry
        // from the dispatch ladder can try again.
        logger.warn('[ChatPanel] Deep-open target not rendered yet', {
          messageId: detail.messageId,
        });
        return;
      }
      handledOpenMessageRequestIds.add(detail.requestId);
      smoothScrollTo(targetElement, 'center');
      scheduleDeepOpenRelease();
      targetElement.classList.add('message-highlight-flash');
      setTimeout(() => targetElement.classList.remove('message-highlight-flash'), 600);
      if (detail.query) applyDeepOpenQueryHighlight(targetElement, detail.query);
    });
  }

  $effect(() => {
    if (typeof window === 'undefined') return;

    const listener = (event: Event) => void handleOpenMessage(event);
    window.addEventListener('chat:open-message', listener);

    return () => {
      window.removeEventListener('chat:open-message', listener);
      clearDeepOpenHighlight?.();
      if (deepOpenReleaseTimer !== null) clearTimeout(deepOpenReleaseTimer);
    };
  });

  // Listen for panel:focus-content events (from panel keyboard navigation)
  $effect(() => {
    if (typeof window === 'undefined') return;

    const handlePanelFocusContent = (event: Event) => {
      const detail = (event as CustomEvent<ChatFocusRequest>).detail;
      const ownerPanelId =
        panelElement?.closest<HTMLElement>('[data-panel-id]')?.dataset.panelId ?? null;
      if (
        shouldHandleChatFocusRequest(detail, {
          agentId,
          workspaceId: workspace.id,
          panelId: ownerPanelId,
          isActive,
          isPanelFocused,
        })
      ) {
        logger.debug('[ChatPanel] Panel focus event received, focusing prompt', {
          agentId,
          panelId: detail.panelId,
        });
        focusPrompt();
      }
    };

    window.addEventListener('panel:focus-content', handlePanelFocusContent);

    return () => {
      window.removeEventListener('panel:focus-content', handlePanelFocusContent);
    };
  });

  // Track scroll distance from bottom for the lock button
  // Use onMount pattern to avoid effect loops - scrollContainer binding can cause
  // effects to re-run when state changes trigger re-renders
  onMount(() => {
    let destroyed = false;
    let readinessFrame: number | null = null;
    let initialCalculationFrame: number | null = null;
    let boundContainer: HTMLDivElement | null = null;

    // Damps raw distanceFromBottom jitter into a stable committed button
    // state: shows only after the distance holds beyond the hysteresis band
    // for a settle window, hides immediately at the bottom, and flashes the
    // re-lock confirmation only on a committed shown → hidden transition so
    // the same jitter can never re-trigger it.
    const buttonVisibility = createScrollBottomButtonVisibility({
      atBottomThreshold: SCROLL_BOTTOM_THRESHOLD,
      onVisibilityChange: (visible) => {
        scrollButtonVisible = visible;
      },
      onRelock: flashLockConfirmation,
    });

    const handleScroll = () => {
      if (!boundContainer) return;
      const { scrollTop, scrollHeight, clientHeight } = boundContainer;
      buttonVisibility.update(scrollHeight - scrollTop - clientHeight);
    };

    // Wait for scrollContainer to be bound, then set up
    const setupWhenReady = () => {
      readinessFrame = null;
      if (destroyed) return;
      if (!scrollContainer) {
        readinessFrame = requestAnimationFrame(setupWhenReady);
        return;
      }
      boundContainer = scrollContainer;
      boundContainer.addEventListener('scroll', handleScroll, { passive: true });
      // Initial calculation (deferred to avoid effect loops)
      initialCalculationFrame = requestAnimationFrame(handleScroll);
    };
    readinessFrame = requestAnimationFrame(setupWhenReady);

    return () => {
      destroyed = true;
      if (readinessFrame !== null) cancelAnimationFrame(readinessFrame);
      if (initialCalculationFrame !== null) cancelAnimationFrame(initialCalculationFrame);
      boundContainer?.removeEventListener('scroll', handleScroll);
      buttonVisibility.destroy();
      if (lockConfirmationTimer !== null) {
        clearTimeout(lockConfirmationTimer);
        lockConfirmationTimer = null;
      }
    };
  });

  function setPinnedPrompt(next: PinnedPromptState | null) {
    if (next?.id === pinnedPrompt?.id && next?.message === pinnedPrompt?.message) return;
    const previousTurnKey = pinnedPrompt ? messageIdToTurnKey.get(pinnedPrompt.id) : undefined;
    if (previousTurnKey) {
      temporaryTurnMaterialization = releaseMaterializedTurn(
        temporaryTurnMaterialization,
        'pinned',
        previousTurnKey,
      );
    }
    pinnedPrompt = next;
    const nextTurnKey = next ? messageIdToTurnKey.get(next.id) : undefined;
    if (nextTurnKey) {
      temporaryTurnMaterialization = materializeTurn(
        temporaryTurnMaterialization,
        'pinned',
        nextTurnKey,
      );
    }
  }

  // Track container height for compact mode using ResizeObserver
  onMount(() => {
    let destroyed = false;
    let readinessFrame: number | null = null;
    let observer: ResizeObserver | null = null;

    const setupWhenReady = () => {
      readinessFrame = null;
      if (destroyed) return;
      if (!scrollContainer) {
        readinessFrame = requestAnimationFrame(setupWhenReady);
        return;
      }
      observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const newHeight = entry.contentRect.height;
          if (newHeight !== containerHeight) {
            containerHeight = newHeight;
          }
        }
        if (scrollContainer) {
          const gutterWidth = measureScrollbarGutterWidth(scrollContainer);
          if (gutterWidth !== scrollbarGutterWidth) {
            scrollbarGutterWidth = gutterWidth;
          }
        }
      });
      observer.observe(scrollContainer);
    };
    readinessFrame = requestAnimationFrame(setupWhenReady);

    return () => {
      destroyed = true;
      if (readinessFrame !== null) cancelAnimationFrame(readinessFrame);
      observer?.disconnect();
    };
  });

  // Scroll to previous user message from the current sticky one
  function scrollToPreviousUserMessage(currentMessageId: string) {
    if (!scrollContainer) return;

    // Get all user messages
    const userMessages = $agentMessages$.filter((m) => m.role === 'user');
    const currentIndex = userMessages.findIndex((m) => m.id === currentMessageId);

    if (currentIndex <= 0) {
      // At first message or not found - scroll to top
      smoothScrollToPosition(0);
      return;
    }

    // Find the previous user message
    const previousMessage = userMessages[currentIndex - 1];
    const targetElement = scrollContainer.querySelector(
      `[data-message-id="${previousMessage.id}"]`,
    ) as HTMLElement;

    if (targetElement) {
      smoothScrollTo(targetElement, 'start');

      // // Flash highlight effect
      // targetElement.classList.add('message-highlight-flash');
      // setTimeout(() => {
      //   targetElement.classList.remove('message-highlight-flash');
      // }, 600);
    }
  }

  // Track if draft prompt has been applied to prevent re-applying on re-renders
  let draftPromptApplied = $state(false);
  // Flash the input to draw attention when draft prompt is applied
  let showInputFlash = $state(false);

  // Handle draft prompt - pre-fill the input without sending
  $effect(() => {
    if (!draftPrompt || draftPromptApplied) return;
    if (!$agentSession$) return; // Wait for session to be ready

    // Pre-fill the input
    logger.info('[ChatPanel] Pre-filling input with draft prompt', {
      agentId,
      promptLength: draftPrompt.length,
    });

    // Use a small delay to ensure the input component is ready
    setTimeout(async () => {
      inputValue = draftPrompt;
      await inputComponent?.setContent?.(draftPrompt);
      inputComponent?.focus?.();
      draftPromptApplied = true;

      // Trigger subtle flash animation
      showInputFlash = true;
      setTimeout(() => {
        showInputFlash = false;
      }, 600);
    }, 100);
  });

  // Track unread status - mark agent as viewed when this panel is active
  // This prevents the workspace from being shown as "unread" in the spaces list
  // when the user is actively viewing the agent in the panel layout.
  // This handles the panel layout case.
  // Guard: only dispatch when agentId or isActive actually change to prevent cyclical re-dispatches.
  let lastViewedAgentId: string | undefined;
  let lastIsActive: boolean | undefined;
  $effect(() => {
    if (agentId === lastViewedAgentId && isActive === lastIsActive) return;
    const previousAgentId = lastViewedAgentId;
    lastViewedAgentId = agentId;
    lastIsActive = isActive;
    if (agentId && isActive) {
      appStore.dispatch(markAgentAsViewed(agentId));
    } else {
      // Panel is no longer active (user switched to another tab) —
      // clear so new messages for this agent are properly marked as unread.
      // Scoped to this panel's agent so a deactivating background panel's
      // trailing clear cannot tear down the newly viewed agent's chat
      // (monorepo#1215).
      const scopeAgentId = agentId || previousAgentId;
      if (scopeAgentId) {
        appStore.dispatch(clearCurrentlyViewedAgent(scopeAgentId));
      }
    }
  });

  // NOTE: the seen marker (agent.markSeen, PROTOCOL §5.5) is NOT advanced
  // from this component. It advances at three discrete triggers handled in
  // middleware — turn finish (streamEnded, gated on viewed tab + window
  // focus), user send (sendMessage), and stop-looking boundaries (tab close /
  // workspace switch via the divider-session boundary seam). See
  // $features/agent/mark-agent-seen.

  onDestroy(() => {
    // CRITICAL: Set destruction flag FIRST, before any other cleanup.
    // This prevents async callbacks (like unifiedOrchestrator.getQueue().then(...))
    // from accessing reactive state after destruction, which would cause
    // "N is not a function" errors in Svelte's reactive system.
    isComponentDestroyed = true;
    cancelAllSendTransitions();

    // Cache the transcript scroll state so a remount after column windowing
    // (WorkspaceColumnsView unmounting off-screen surfaces) restores the
    // user's reading position instead of re-entering at the bottom.
    if (workspace?.id && agentId && scrollContainer && $agentMessages$.length > 0) {
      setCachedChatScroll(workspace.id, agentId, {
        scrollTop: scrollContainer.scrollTop,
        shouldFollowBottom,
      });
    }

    // Clear currently viewed agent so other agents can properly be marked as
    // unread — scoped so a cached background tab's destroy cannot tear down
    // the currently viewed agent's chat (monorepo#1215).
    if (agentId) {
      appStore.dispatch(clearCurrentlyViewedAgent(agentId));
    }

    logger.info('ChatPanel destroyed', { instanceId, agentId });
    // Clean up subscriptions and scroll manager
    if (searchDebounceTimer !== null) {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = null;
    }
    if (deepOpenReleaseTimer !== null) clearTimeout(deepOpenReleaseTimer);
    lazyTurnHeightCache.clear();
    // Note: followBottom action cleanup is handled automatically by Svelte
    // Don't clear chat data - just cleanup listeners
    // The service will persist data for when the panel is reopened
  });

  // Notify parent of chat state updates (replaces the old store subscription callback)
  $effect(() => {
    if (typeof onChatUpdate !== 'function' || $agentMessages$.length === 0) return;
    const messages = $agentMessages$;
    const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');
    const lastAgentMessage = [...messages].reverse().find((m) => m.role === 'assistant');

    onChatUpdate({
      lastUserMessage: lastUserMessage ? extractAllContent(lastUserMessage) : undefined,
      lastAgentResponse: lastAgentMessage ? extractAllContent(lastAgentMessage) : undefined,
      isProcessing: $agentIsResponding$,
      messageCount: messages.length,
    });
  });

  // Handle editing a queued message. The client seam folds transport errors
  // into `{ success: false, error }`, so branching on `result.success` is safe.
  async function handleEditQueuedMessage(messageId: string, content: string, editing?: boolean) {
    const result = await appClient.agents.editQueued(agentId, messageId, content, editing);
    if (!result.success) {
      logger.error('Failed to edit queued message', { messageId, error: result.error });
    } else {
      // #1011: sync the parked retry record with what the daemon actually
      // persisted (save applies the edit; hold/cancel echo the original) —
      // otherwise a post-drain "Try again" resends the pre-edit text. Prefer
      // the authoritative echoed queuedMessage.content over the local arg so
      // the record can't drift from the daemon's entry.
      const persistedText = result.queuedMessage?.content ?? content;
      appStore.dispatch(chatQueuedRetryRecordUpdated(agentId, messageId, persistedText));
    }
    return result;
  }

  // Handle removing a queued message — the saga removes it optimistically from
  // Redux (immediate UI update) and restores it if the backend removal fails.
  function handleRemoveQueuedMessage(messageId: string) {
    appStore.dispatch(removeQueuedMessageRequested(agentId, messageId));
  }

  // Handle sending a queued message immediately (interrupts current stream).
  // One atomic daemon call (`agent.sendQueuedMessageNow`, monorepo#1032): the
  // send middleware needs only agentId/wsId/queuedMessageId — the daemon owns
  // the entry's content/attachments and dequeues + delivers transactionally.
  function handleSendQueuedMessageNow(messageId: string) {
    const message = $queuedMessages$.find((m) => m.id === messageId);
    if (!message || !workspace) return;

    logger.info('Send queued message now triggered', { messageId, agentId });

    appStore.dispatch(
      sendMessage(agentId, {
        wsId: workspace.id,
        text: message.content,
        queuedMessageId: messageId,
      }),
    );

    void performLocalSendCleanup({
      clearInput: false,
      followBottom: true,
    });
  }

  // Build workspace context string for agent messages
  function buildWorkspaceContextString(): string {
    const parts: string[] = [];

    // Add context from checked panels in the multi-panel context store
    const storeState = appStore.state;
    const checkedPanels = selectCheckedPanels.select(storeState);
    const allPanels = selectPanels.select(storeState);
    logger.info('ChatPanel: Building workspace context', {
      agentId,
      checkedPanelsCount: checkedPanels.length,
      allPanelsCount: allPanels.length,
      checkedPanelIds: checkedPanels.map((p) => p.id),
      allPanelIds: allPanels.map((p) => ({ id: p.id, checked: p.checked, type: p.type })),
    });
    for (const panel of checkedPanels) {
      if (panel.type === 'file' && panel.filePath) {
        // i18n-ignore (agent-directed context marker, not user-facing UI)
        parts.push(`[Currently viewing file: ${panel.filePath}]`);
      } else if (panel.type === 'diff' && panel.filePath) {
        // i18n-ignore (agent-directed context marker, not user-facing UI)
        parts.push(`[Currently viewing diff for: ${panel.filePath}]`);
      } else if (panel.type === 'note' && panel.noteId) {
        parts.push(
          // i18n-ignore (agent-directed context marker, not user-facing UI)
          `[Currently viewing note: "${panel.label}" (ID: ${panel.noteId}). Use read_note_space-mcp(noteId="${panel.noteId}") to read its content.]`,
        );
      } else if (panel.type === 'spec') {
        // i18n-ignore (agent-directed context marker, not user-facing UI)
        parts.push('[Currently viewing: Spec]');
      } else if (panel.type === 'browser' && panel.browserUrl) {
        // i18n-ignore (agent-directed context marker, not user-facing UI)
        parts.push(`[Currently viewing browser: ${panel.browserUrl}]`);
      }
    }

    // Add checked selections from multi-panel context store
    const checkedSelections = selectCheckedSelections.select(storeState);
    for (const selection of checkedSelections) {
      const selectedText = selection.text.trim();
      const displayText =
        selectedText.length > 500 ? selectedText.substring(0, 500) + '...' : selectedText;
      const source = selection.sourceLabel ? ` from ${selection.sourceLabel}` : '';
      // i18n-ignore (agent-directed context marker, not user-facing UI)
      parts.push(`[Selected text${source}:\n\`\`\`\n${displayText}\n\`\`\`]`);
    }

    return parts.join('\n');
  }

  // Input history navigation callbacks (terminal-like up/down arrow)
  function handleHistoryPrev(): string | null {
    // If there are visible queued messages and we're not already navigating
    // history, edit the last queued message instead of cycling through sent
    // history
    if (visibleQueuedMessages.length > 0 && historyIndex === -1 && !inputValue.trim()) {
      const editStarted = queuedMessageListRef?.editLastMessage?.();
      if (editStarted) {
        // Return null so TipTapEditor doesn't change the input content
        // Focus will move to QueuedMessageList's inline edit textarea
        return null;
      }
    }

    if (inputHistory.length === 0) {
      return null;
    }

    if (historyIndex === -1) {
      // Starting to navigate - save current input
      savedInput = inputValue;
      historyIndex = inputHistory.length - 1;
    } else if (historyIndex > 0) {
      // Move to older entry
      historyIndex = historyIndex - 1;
    } else {
      // Already at oldest entry
      return null;
    }

    return inputHistory[historyIndex];
  }

  function handleHistoryNext(): string | null {
    if (historyIndex === -1) {
      // Not navigating history
      return null;
    }

    if (historyIndex < inputHistory.length - 1) {
      // Move to newer entry
      historyIndex = historyIndex + 1;
      return inputHistory[historyIndex];
    } else {
      // At the end of history - restore saved input
      historyIndex = -1;
      return savedInput;
    }
  }

  // Reset history navigation when user types
  function resetHistoryNavigation() {
    historyIndex = -1;
    savedInput = '';
  }

  // Add to input history when a message is sent
  function addToInputHistory(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;

    // Remove duplicate if it exists (move to end instead)
    const filtered = inputHistory.filter((item) => item !== trimmed);
    // Add to end (most recent)
    inputHistory = [...filtered, trimmed];

    // Limit history size to 100 entries
    if (inputHistory.length > 100) {
      inputHistory = inputHistory.slice(-100);
    }

    // Reset navigation state
    resetHistoryNavigation();
  }

  async function performLocalSendCleanup(options: {
    clearInput?: boolean;
    followBottom?: boolean;
    historyText?: string | null;
  }) {
    if (options.historyText) {
      addToInputHistory(options.historyText);
    }

    if (options.clearInput) {
      // A drafts.get request may still be pending while the composer is usable.
      // Once this send owns the empty state, that stale response must not
      // restore the just-sent prompt into the editor.
      draftManager.invalidatePendingRestore();
      contextItems = [];
      inputValue = '';
      inputComponent?.clear();
      // Clear draft from backend when message is sent
      if (workspace && agentId) {
        await appClient.drafts.clear(workspace.id, agentId);
      }
    }

    if (options.followBottom) {
      shouldFollowBottom = true;
      if (scrollContainer) scrollToBottomUtil(scrollContainer);
    }
  }

  // Extract imageBlocks from any context item with imageData/imageMimeType
  // (file-type attachments and legacy inline-image items alike), and
  // attachment-reference fileBlocks from placed-attachment items
  // (file.placeAttachment — UUID + metadata, no bytes).
  function extractAttachmentBlocks(items: ContextItem[]) {
    const imageBlocks = items
      .filter((item) => item.imageData && item.imageMimeType)
      .map((item) => ({
        type: 'image' as const,
        data: item.imageData!,
        mimeType: item.imageMimeType!,
      }));
    const fileBlocks = items
      .filter((item) => item.attachmentId)
      .map((item) => ({
        type: 'file' as const,
        attachmentId: item.attachmentId!,
        fileName: item.label,
        ...(item.attachmentMimeType ? { mimeType: item.attachmentMimeType } : {}),
        ...(item.attachmentSize !== undefined ? { size: item.attachmentSize } : {}),
      }));
    return { imageBlocks, fileBlocks };
  }

  // Handle sending messages
  function handleSend(text: string) {
    // Gather DOM state only. Validation, queue decisions, serialization,
    // shared/domain cleanup, and send side effects live in sagas.
    const inlineImageItems = inputComponent?.getInlineImageContextItems?.() ?? [];
    const mentionContextItems = inputComponent?.getMentionContextItems?.() ?? [];
    if (!workspace || !isActive) return;

    const allContextItems = [...contextItems, ...inlineImageItems, ...mentionContextItems];
    const workspaceContextStr = buildWorkspaceContextString();
    const noteIds = currentMainPanelContext?.noteId ? [currentMainPanelContext.noteId] : undefined;

    const { imageBlocks, fileBlocks } = extractAttachmentBlocks(allContextItems);
    const followAfterSend = $agentMessages$.length === 0 || shouldFollowBottom;
    const userAppMessageId = prepareMessageSendTransition(text, {
      enabled: !$agentIsResponding$ && imageBlocks.length === 0 && fileBlocks.length === 0,
      followBottom: followAfterSend,
    });

    // Dispatch all orchestration to the send-message saga
    appStore.dispatch(
      sendMessage(agentId, {
        wsId: workspace.id,
        text,
        userAppMessageId,
        contextItems: allContextItems,
        workspaceContextStr,
        noteIds,
        ...(imageBlocks.length > 0 ? { imageBlocks } : {}),
        ...(fileBlocks.length > 0 ? { fileBlocks } : {}),
        agentName,
        agentModel,
        isInitialWorkspaceAgent,
      }),
    );

    void performLocalSendCleanup({
      clearInput: true,
      followBottom: followAfterSend,
      historyText: text,
    });
  }

  // Handle stopping the current generation
  function handleStop() {
    appStore.dispatch(agentSessionStopChatRequested(agentId));
  }

  // Handle retrying the last failed message
  async function handleRetry() {
    if (!workspace || !agentId) return;

    // When agent status is "error" (spawn failure after retries exhausted),
    // call the new agent.retry RPC to redrive the failed spawn.
    // Otherwise fall through to the regular retry-last-message path.
    const currentStatus = $agentSession$?.status;
    if (currentStatus === AgentStatus.Error) {
      // Capture the current error message before clearing so we can restore it on failure
      const priorError = $chatError$ || m.chat_chatPanel_agentFailedToStart_error();

      // Clear the current error so the UI shows loading state
      appStore.dispatch(chatErrorCleared(agentId));

      const result = await appClient.agents.retry(agentId, workspace.id);

      if (!result.ok) {
        // Retry was rejected - surface the error or fall back to prior error
        const errorToShow = result.error || priorError;
        appStore.dispatch(chatSendFailed(agentId, errorToShow));
        appStore.dispatch(agentSessionRetryLastMessageRequested(agentId, workspace.id));
        return;
      }

      // ok:true — the daemon cleared the error and emits agent:status-changed
      // (pending when a queued message is redriven, idle when the queue was
      // empty). Converge the local session status from the RPC ack too, so the
      // error banner clears even if the status event is missed (STAB-54).
      // Only an explicit `redriven: false` means idle; `undefined` (older
      // daemon omitting the field) keeps the pre-STAB-54 pending behaviour.
      appStore.dispatch(
        updateAgentSessionFields(agentId, {
          status: result.redriven === false ? AgentStatus.RuntimeIdle : AgentStatus.Pending,
          stopReason: null,
        }),
      );
      if (result.redriven === false) {
        // Nothing was queued to redrive — the error is cleared, but no new
        // turn starts. Tell the user what to do next instead of a silent no-op.
        toast.info(m.chat_chatPanel_nothingToRetry_toast());
      }
      return;
    }

    // Normal retry path for non-error statuses
    appStore.dispatch(agentSessionRetryLastMessageRequested(agentId, workspace.id));
  }

  // Handle retrying with a specific model (when current model is unavailable)
  function handleRetryWithModel(model: string) {
    if (!workspace) return;
    appStore.dispatch(agentSessionRetryWithModelRequested(agentId, workspace.id, model));
  }

  // Handle changing the specialist for an agent
  // The specialist can be changed at any time - even after messages have been sent.
  // The new specialist behavior will apply to subsequent messages.
  function handleSpecialistChange(specialistId: string | null) {
    if (!workspace || !agentId) return;

    const session = $agentSession$;
    if (!session) return;

    logger.info('Changing agent specialist', { agentId, specialistId });

    let behaviorPrompt: string | undefined;
    let newModel: string | null | undefined;
    let specialistName: string | undefined;

    if (specialistId) {
      // Direct specialist selected
      const reduxState = appStore.state;
      const specialist = selectSpecialists.select(reduxState).find((s) => s.id === specialistId);
      behaviorPrompt = specialist
        ? selectEffectiveBehaviorPrompt.select(reduxState, specialist.id)
        : undefined;
      // Use getEffectiveModel which resolves tier to actual model for current provider
      newModel = specialist
        ? selectEffectiveModel.select(reduxState, specialist.id) || session.model
        : session.model;
      specialistName = specialist?.name;
    } else {
      // Blank agent - no specialist
      newModel = session.model;
    }

    // Update session metadata with new specialist AND behavior prompt
    // The backend reads behaviorPrompt from metadata to build the system prompt
    const newMetadata: AgentMetadata = {
      ...session.metadata,
      specialist: specialistId ?? undefined,
      behaviorPrompt: behaviorPrompt ?? '',
      specialistName: specialistName ?? '',
    };

    // Update the session via Redux (agent-session slice is canonical)
    if (workspace?.id) {
      appStore.dispatch(
        updateAgentSessionFields(agentId, { metadata: newMetadata, model: newModel }),
      );
    }

    // Request persistence for future sessions (fire-and-forget; saga reports failures).
    // NOTE: This may fail for sessions with no messages (which is fine), because:
    // 1. The in-memory metadata is updated via Redux dispatch above
    // 2. When sending a message, the metadata is passed directly in the request
    // 3. The backend will read from request.metadata (priority) before disk
    // If persistence succeeds, the specialist will be remembered for future sessions.
    appStore.dispatch(saveAgentSessionRequested(workspace.id, agentId, true));
    logger.info('Agent specialist change dispatched', {
      agentId,
      specialistId,
      newModel,
      hasBehaviorPrompt: !!behaviorPrompt,
      behaviorPromptLength: behaviorPrompt?.length || 0,
    });
  }

  // Handle force submit - interrupt streaming and send immediately (⌘Enter)
  function handleForceSubmit(text: string) {
    // Gather DOM state only; validation and stop/send orchestration live in sagas.
    const inlineImageItems = inputComponent?.getInlineImageContextItems?.() ?? [];
    const mentionContextItems = inputComponent?.getMentionContextItems?.() ?? [];
    if (!workspace) return;

    logger.info('Force submit triggered', { agentId });

    const allContextItems = [...contextItems, ...inlineImageItems, ...mentionContextItems];
    const workspaceContextStr = buildWorkspaceContextString();
    const noteIds = currentMainPanelContext?.noteId ? [currentMainPanelContext.noteId] : undefined;

    const { imageBlocks, fileBlocks } = extractAttachmentBlocks(allContextItems);
    const followAfterSend = $agentMessages$.length === 0 || shouldFollowBottom;
    const userAppMessageId = prepareMessageSendTransition(text, {
      enabled: imageBlocks.length === 0 && fileBlocks.length === 0,
      followBottom: followAfterSend,
      allowOverlap: true,
    });

    appStore.dispatch(
      sendMessage(agentId, {
        wsId: workspace.id,
        text,
        userAppMessageId,
        contextItems: allContextItems,
        workspaceContextStr,
        noteIds,
        ...(imageBlocks.length > 0 ? { imageBlocks } : {}),
        ...(fileBlocks.length > 0 ? { fileBlocks } : {}),
        forceSubmit: true,
        agentName,
        agentModel,
        isInitialWorkspaceAgent,
      }),
    );

    void performLocalSendCleanup({
      clearInput: true,
      followBottom: followAfterSend,
      historyText: text,
    });
  }

  // Handle editing a user message and regenerating. The confirmation gate
  // lives in ChatMessage (the edit UI) — by the time this runs the user has
  // already confirmed the destructive truncation. `blocks` carries the
  // attachment blocks rebuilt from the edit strip (imageBlocks +
  // attachment-reference fileBlocks) so attachments ride the regenerated
  // message (PROTOCOL §5.5).
  function handleEditMessage(
    messageId: string,
    newText: string,
    model?: string,
    blocks?: {
      imageBlocks?: Array<{ type: 'image'; data: string; mimeType: string }>;
      fileBlocks?: Array<{
        type: 'file';
        attachmentId: string;
        fileName: string;
        mimeType?: string;
        size?: number;
      }>;
    },
  ) {
    if (!workspace) return;
    const options =
      model || blocks?.imageBlocks?.length || blocks?.fileBlocks?.length
        ? {
            ...(model ? { model } : {}),
            ...(blocks?.imageBlocks?.length ? { imageBlocks: blocks.imageBlocks } : {}),
            ...(blocks?.fileBlocks?.length ? { fileBlocks: blocks.fileBlocks } : {}),
          }
        : undefined;
    const action = agentSessionEditAndRegenerateRequested(
      agentId,
      workspace.id,
      messageId,
      newText,
      options,
    );
    appStore.dispatch(action);
    // Failures are surfaced via toast by the edit-regenerate middleware;
    // swallow the rejection here to avoid an unhandled-rejection warning.
    action.promise.catch(() => {});
  }

  // Handle regenerating from a specific assistant message
  function handleRegenerateFromMessage(assistantMessageId: string) {
    if (!workspace) return;
    appStore.dispatch(
      agentSessionRegenerateFromMessageRequested(agentId, workspace.id, assistantMessageId),
    );
  }

  // Handle forking the conversation from a specific message
  function handleForkFromMessage(messageId: string) {
    if (!workspace) return;
    appStore.dispatch(
      agentSessionForkSessionRequested(agentId, workspace.id, {
        forkFromMessageId: messageId,
      }),
    );
  }

  // Handle selecting a suggested prompt - sends immediately
  function handleSelectSuggestedPrompt(prompt: string) {
    handleSend(prompt);
  }

  // Handle editing a suggested prompt - loads into input without sending
  async function handleEditSuggestedPrompt(prompt: string) {
    inputValue = prompt;
    await inputComponent?.setContent?.(prompt);
    inputComponent?.focus?.();
  }

  // Export functions for parent components
  export function focusPrompt(): boolean {
    const result = inputComponent?.focus?.() ?? false;
    if (result && typeof result === 'boolean') {
      onFocus?.();
      return result;
    }
    return false;
  }

  export function scrollToTop() {
    smoothScrollToPosition(0);
  }

  export function scrollToBottom() {
    if (scrollContainer) {
      shouldFollowBottom = true;
      scrollToBottomUtil(scrollContainer);
    }
  }

  export function getMessages() {
    return $agentMessages$;
  }

  export function getNavigationState() {
    const userMessages = $agentMessages$.filter((m) => m.role === 'user');
    return {
      userMessageCount: userMessages.length,
      currentMessageIndex: -1, // Not tracking current visible message in simplified version
      isAtTop: scrollContainer ? scrollContainer.scrollTop === 0 : true,
      isAtBottom: scrollContainer
        ? scrollContainer.scrollTop >=
          scrollContainer.scrollHeight - scrollContainer.clientHeight - SCROLL_BOTTOM_THRESHOLD
        : true,
    };
  }

  export function navigateToPrevious() {
    // Not implemented in simplified version - could add if needed
    logger.debug('navigateToPrevious not implemented in ChatPanel');
  }

  export function navigateToNext() {
    // Not implemented in simplified version - could add if needed
    logger.debug('navigateToNext not implemented in ChatPanel');
  }

  // Resend/regenerate the last assistant message (triggered by Alt+Enter)
  function handleResendLastMessage() {
    const messages = $agentMessages$;
    if (messages.length === 0) return;

    // Find the last assistant message
    const lastAssistantMessage = [...messages].reverse().find((m) => m.role === 'assistant');
    if (lastAssistantMessage) {
      handleRegenerateFromMessage(lastAssistantMessage.id);
    } else {
      logger.debug('No assistant message to regenerate');
    }
  }

  // Listen for resend message event (Alt+Enter keyboard shortcut)
  $effect(() => {
    if (typeof window === 'undefined') return;

    const handleResendEvent = () => {
      handleResendLastMessage();
    };

    window.addEventListener('chat:resend-message', handleResendEvent);

    return () => {
      window.removeEventListener('chat:resend-message', handleResendEvent);
    };
  });
</script>

<svelte:window
  onkeydown={(e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
      // Only open search if this panel is focused and active, and focus is not in terminal
      if (
        isPanelFocused &&
        isActive &&
        !isFocusInTerminal(document.activeElement as HTMLElement | null)
      ) {
        e.preventDefault();
        openSearchFromSelection();
      }
    }

    // Suggested prompt shortcuts: Ctrl+1/2/3 (Mac) / Alt+1/2/3 (Win/Linux)
    // Mac uses Ctrl because ⌥+number produces special chars and ⌘+number is tab switching.
    // Win/Linux uses Alt because Ctrl+number is tab switching.
    // Gated on `isChatFocused` so only the focused chat reacts when multiple chats are
    // visible at once (split view, or Chief of Staff open alongside a workspace agent panel).
    if (isActive && isChatFocused && suggestedPrompts.length > 0) {
      // On macOS, Alt+number produces special characters (e.g. Alt+7 → ¶), so e.key is NOT
      // the digit. Use e.code to get the physical key when a modifier is held.
      let num = parseInt(e.key, 10);
      if (isNaN(num) && e.code.startsWith('Digit')) {
        num = parseInt(e.code.slice(5), 10);
      }
      if (num >= 1 && num <= Math.min(suggestedPrompts.length, 3)) {
        const promptIndex = num - 1;
        const isMac = navigator.platform.toUpperCase().includes('MAC');
        const hasModifier = isMac
          ? e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey // Ctrl on Mac
          : e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey; // Alt on Win/Linux
        if (hasModifier) {
          e.preventDefault();
          const prompt = suggestedPrompts[promptIndex];
          handleSelectSuggestedPrompt(prompt);
        }
      }
    }
  }}
/>

<div
  bind:this={panelElement}
  class="group/panel flex flex-col h-full w-full min-w-0 relative z-20"
  data-agent-model={agentModel}
  onfocusin={() => {
    isInternallyFocused = true;
  }}
  onfocusout={(e) => {
    const next = e.relatedTarget as Element | null;
    if (!next || !panelElement?.contains(next)) {
      isInternallyFocused = false;
    }
  }}
  ondragenter={panelFileDrop.handleDragEnter}
  ondragleave={panelFileDrop.handleDragLeave}
  ondragover={panelFileDrop.handleDragOver}
  ondrop={panelFileDrop.handleDrop}
>
  <!-- Full-panel drop zone overlay (file drags only) -->
  {#if isFileDragOverPanel || isFileDragOverHeader}
    <div
      class="absolute inset-0 z-50 flex items-center justify-center rounded-lg border border-dashed border-primary bg-primary/5 pointer-events-none"
      data-testid="chat-panel-drop-overlay"
    >
      <div class="flex flex-col items-center gap-2 text-primary">
        <Fa icon={faPaperclip} class="w-6 h-6" />
        <span class="text-sm font-medium">{m.chat_richInput_dropFiles_label()}</span>
      </div>
    </div>
  {/if}

  <!-- Search Bar -->
  {#if showSearch}
    <PanelFindBar
      bind:query={searchQuery}
      bind:inputRef={searchInputRef}
      placeholder={m.chat_chatSearch_input_placeholder()}
      currentMatchIndex={currentSearchIndex}
      totalMatches={searchMatchCount}
      disableNavigationWhenNoMatches={false}
      resultVariant="muted"
      inputClass="w-48"
      onInput={handleSearchInput}
      onPrevious={navigateToPreviousSearchMatch}
      onNext={navigateToNextSearchMatch}
      onClose={closeSearch}
    />
  {/if}

  <!-- Messages Area -->
  <div class="w-full relative flex-1 flex flex-col min-h-0 z-10">
    <!-- Inline-end padding compensates the scroll container's scrollbar gutter
         so the lane's box matches the conversation column's box. -->
    <div
      class="pointer-events-none absolute inset-x-0 top-0 z-40"
      style:padding-inline-end="{scrollbarGutterWidth}px"
      data-testid="pinned-prompt-overlay-host"
      aria-live="off"
    >
      {#if pinnedPrompt}
        <!-- Mirror the conversation column's horizontal padding plus the chief
             variant's user-row inset so the pinned bubble aligns with
             in-conversation user bubbles. -->
        <div
          class={isChiefWorkspace ? 'px-0' : 'px-4 sm:px-6'}
          data-testid="pinned-prompt-overlay-lane"
        >
          <div class={isChiefWorkspace ? 'mx-1 sm:mx-2' : ''}>
            <PinnedUserPrompt
              text={getPinnedPromptText(pinnedPrompt.message)}
              {workspace}
              onActivate={handlePinnedPromptClick}
            />
          </div>
        </div>
      {/if}
    </div>
    <!-- followBottom and the LazyTurn height ledger own scroll compensation. -->
    <div
      bind:this={scrollContainer}
      use:trackPinnedPrompt={{
        enabled: containerHeight >= 400,
        onChange: setPinnedPrompt,
      }}
      use:followBottom={{
        // While search is open we drive our own programmatic scrolls (to the
        // current match), so we drop `follow` to keep the mutation/resize
        // observers from yanking the viewport to the bottom when a LazyTurn
        // placeholder expands between us computing and applying the match's
        // scroll target.
        follow: shouldFollowBottom && !showSearch && $agentMessages$.length > 0,
        threshold: 100,
        onFollowChange: (f) => {
          shouldFollowBottom = f;
        },
      }}
      class="flex-1 overflow-y-auto"
      class:agent-font-monospace={$isAgentMonospace}
      style="scrollbar-gutter: stable; overflow-anchor: none;"
    >
      <div
        class="conversation-column flex min-h-full w-full flex-col {isChiefWorkspace
          ? 'px-0'
          : 'px-4 pt-2 sm:px-6'}"
        class:pb-3={!isChiefWorkspace && isCompactMode}
        class:pb-2={!isChiefWorkspace && !isCompactMode}
      >
        <!-- Task Assignment Pill -->
        {#if $agentTasks$.length > 0}
          {@const task = $agentTasks$[0]}
          <a
            href={getTaskUrl(task)}
            class="flex items-center gap-1.5 px-2.5 py-1 mt-2 text-xs rounded-full border border-border bg-background hover:bg-muted transition-colors w-fit cursor-pointer no-underline mb-2"
            onclick={(e) => handleTaskPillClick(e, task)}
          >
            <Fa icon={faSquareCheck} class="text-ghost opacity-50" size="w-3 h-3" />
            <span class="text-subtle truncate max-w-[200px]">
              {task.taskText || m.chat_chatPanel_assignedTask_fallback()}
            </span>
          </a>
        {/if}

        {#if transcriptHydrationFailed && $agentMessages$.length === 0}
          <div class="flex min-h-48 flex-col items-center justify-center gap-3 p-6 text-center">
            <p class="text-sm text-muted-foreground">{m.chat_shared_actionFailed_label()}</p>
            <Button variant="outline" onclick={handleRetryTranscriptHydration}>
              {m.chat_shared_retry_label()}
            </Button>
          </div>
        {:else if isChiefWorkspace && !isInitialWorkspaceAgent && $agentMessages$.length === 0 && !$agentSessionIsStreaming$ && $agentSession$ && !pendingInitialPrompt && $transcriptHydration$ === 'settled' && !authoritativeConversationEvidence}
          <ChiefStarterPrompts onSelect={handleSelectSuggestedPrompt} compact={isCompactMode} />
        {:else if !isInitialWorkspaceAgent && $agentMessages$.length === 0 && !$agentSessionIsStreaming$ && $agentSession$ && !pendingInitialPrompt && $transcriptHydration$ === 'settled' && !authoritativeConversationEvidence}
          <!-- Welcome page: settled hydration + zero messages + no durable conversation evidence. -->
          <div class="mt-16"></div>
          <RegularAgentWelcome
            onSpecialistChange={handleSpecialistChange}
            session={$agentSession$}
          />
        {:else if onboardingContext && shouldShowSetupCardOnly( { isInitialWorkspaceAgent, hasOnboardingContext: true, hasOnboardingPrompt: Boolean(onboardingContext.prompt?.trim()), hasMessages: $agentMessages$.length > 0, isStreaming: $agentSessionIsStreaming$, hasPendingInitialPrompt: Boolean(pendingInitialPrompt), hydrationSettled: $transcriptHydration$ === 'settled' } )}
          <!-- Initial workspace agent with no prompt, hydration settled — show setup card only, no skeletons (a loading transcript falls through to the skeleton branch below) -->
          <div class="pt-16 pb-6">
            <WorkspaceSetupCard
              repoName={onboardingContext.projectName ||
                onboardingContext.projectPath?.split('/').pop() ||
                m.chat_chatPanel_yourProject_fallback()}
              repoPath={onboardingContext.repoPath || onboardingContext.projectPath}
              worktreePath={onboardingContext.worktreePath}
              workspaceId={workspace?.id}
              branch={onboardingContext.branch}
              baseRef={onboardingContext.baseRef || 'origin/main'}
              specialistName={onboardingContext.specialistName}
              specialistId={onboardingContext.specialistId}
              hasPrompt={false}
              repoStatus="done"
              branchStatus="done"
              agentStatus="done"
              setupScriptStatus={onboardingContext.setupScript ? 'done' : undefined}
              setupScriptContent={onboardingContext.setupScript}
              onFocusSetupTerminal={onboardingContext.setupScript
                ? handleFocusSetupTerminal
                : undefined}
              skipIsolation={onboardingContext.skipWorktree}
            />
          </div>
        {:else if shouldShowTranscriptSkeleton( { isFirstHydrationLoading, hasSession: Boolean($agentSession$), hydrationSettled: $transcriptHydration$ === 'settled', hasMessages: $agentMessages$.length > 0, isStreaming: $agentSessionIsStreaming$, hasPendingInitialPrompt: Boolean(pendingInitialPrompt) } )}
          <!-- Skeleton: initial newest-window hydration is unresolved. -->
          {#if isInitialWorkspaceAgent && onboardingContext}
            <div class="pt-16 pb-6">
              <WorkspaceSetupCard
                repoName={onboardingContext.projectName ||
                  onboardingContext.projectPath?.split('/').pop() ||
                  m.chat_chatPanel_yourProject_fallback()}
                repoPath={onboardingContext.repoPath || onboardingContext.projectPath}
                worktreePath={onboardingContext.worktreePath}
                workspaceId={workspace?.id}
                branch={onboardingContext.branch}
                baseRef={onboardingContext.baseRef || 'origin/main'}
                specialistName={onboardingContext.specialistName}
                specialistId={onboardingContext.specialistId}
                hasPrompt={!!onboardingContext.prompt?.trim()}
                repoStatus="done"
                branchStatus="done"
                agentStatus="done"
                setupScriptStatus={onboardingContext.setupScript ? 'done' : undefined}
                setupScriptContent={onboardingContext.setupScript}
                onFocusSetupTerminal={onboardingContext.setupScript
                  ? handleFocusSetupTerminal
                  : undefined}
                skipIsolation={onboardingContext.skipWorktree}
              />
            </div>
          {/if}
          <!-- Skeleton loading state when session is not yet initialized or transcript is loading -->
          <div class="flex flex-col gap-4 p-4 w-full">
            <!-- User message skeleton -->
            <div class="flex justify-end">
              <div class="flex flex-col gap-1.5 max-w-[70%]">
                <Skeleton class="h-4 w-48 ml-auto" />
                <Skeleton class="h-4 w-32 ml-auto" />
              </div>
            </div>
            <!-- Assistant message skeleton -->
            <div class="flex gap-2">
              <Skeleton class="h-6 w-6 rounded-full shrink-0" />
              <div class="flex flex-col gap-1.5 flex-1">
                <Skeleton class="h-4 w-full max-w-[300px]" />
                <Skeleton class="h-4 w-full max-w-[250px]" />
                <Skeleton class="h-4 w-full max-w-[280px]" />
              </div>
            </div>
            <!-- Another user message skeleton -->
            <div class="flex justify-end">
              <div class="flex flex-col gap-1.5 max-w-[70%]">
                <Skeleton class="h-4 w-36 ml-auto" />
              </div>
            </div>
            <!-- Another assistant message skeleton -->
            <div class="flex gap-2">
              <Skeleton class="h-6 w-6 rounded-full shrink-0" />
              <div class="flex flex-col gap-1.5 flex-1">
                <Skeleton class="h-4 w-full max-w-[320px]" />
                <Skeleton class="h-4 w-full max-w-[200px]" />
              </div>
            </div>
          </div>
        {:else}
          <!-- Pending initial prompt - shown as optimistic UI immediately -->
          <!-- FIX: Keep showing pendingMessage until a USER message arrives in $agentMessages$ -->
          <!-- This prevents the flash where pendingMessage disappears but only assistant streaming content has arrived -->
          {@const hasUserMessage = $agentMessages$.some((m) => m.role === 'user')}
          {@const pendingCondition = pendingMessage && !hasUserMessage}
          {@const messagesCondition = hasUserMessage || $agentMessages$.length > 0}
          {#if pendingCondition}
            <!-- Get any streaming assistant messages to render alongside the pending user message -->
            {@const streamingAssistantMessages = $agentMessages$.filter(
              (m) => m.role === 'assistant',
            )}
            {#if initialPromptProp}
              <!-- No animation - parent already showed optimistic message, but we need to keep showing it -->
              <div class="w-full">
                {#if isInitialWorkspaceAgent && onboardingContext}
                  <div class="pt-16 pb-6">
                    <WorkspaceSetupCard
                      repoName={onboardingContext.projectName ||
                        onboardingContext.projectPath?.split('/').pop() ||
                        m.chat_chatPanel_yourProject_fallback()}
                      repoPath={onboardingContext.repoPath || onboardingContext.projectPath}
                      worktreePath={onboardingContext.worktreePath}
                      workspaceId={workspace?.id}
                      branch={onboardingContext.branch}
                      baseRef={onboardingContext.baseRef || 'origin/main'}
                      specialistName={onboardingContext.specialistName}
                      specialistId={onboardingContext.specialistId}
                      hasPrompt={!!onboardingContext.prompt?.trim()}
                      repoStatus="done"
                      branchStatus="done"
                      agentStatus="done"
                      setupScriptStatus={onboardingContext.setupScript ? 'done' : undefined}
                      setupScriptContent={onboardingContext.setupScript}
                      onFocusSetupTerminal={onboardingContext.setupScript
                        ? handleFocusSetupTerminal
                        : undefined}
                      skipIsolation={onboardingContext.skipWorktree}
                    />
                  </div>
                {/if}
                <!-- Conversation turn container - constrains sticky behavior -->
                <div class="conversation-turn">
                  <div class="message-nav-target z-10 mb-9 bg-transparent">
                    <ChatMessage
                      message={pendingMessage}
                      {workspace}
                      backendSessionId={auggieSessionId}
                    />
                  </div>

                  <!-- Render any streaming assistant messages -->
                  {#each streamingAssistantMessages as message, index (message.id)}
                    {@const isLastMessage = index === streamingAssistantMessages.length - 1}
                    {@const isCurrentlyStreaming = isLastMessage && $agentSessionIsStreaming$}
                    <div
                      data-message-id={message.id}
                      data-message-role="assistant"
                      class="message-nav-target"
                    >
                      <ChatMessage
                        {agentId}
                        messageId={message.id}
                        {workspace}
                        isStreaming={isCurrentlyStreaming}
                        backendSessionId={auggieSessionId}
                      />
                    </div>
                    {#if (isCurrentlyStreaming && ($agentIsResponding$ || $agentSessionIsStreaming$)) || (isLastMessage && (effectiveError || $chatModelUnavailable$))}
                      <div class={isCompactMode ? 'mb-2' : 'mb-16'}>
                        <StreamingStatus
                          isStreaming={$agentSessionIsStreaming$}
                          isProcessing={$agentIsResponding$}
                          lastChunkTime={$chatLastChunkTime$}
                          receivedFirstChunk={$chatReceivedFirstChunk$}
                          streamingContentLength={$chatStreamingContent$?.length ?? 0}
                          error={effectiveError}
                          sessionCorrupted={effectiveSessionCorrupted}
                          failedAt={effectiveFailedAt}
                          modelUnavailable={$chatModelUnavailable$}
                          {hasPendingPermission}
                          onRetry={handleRetry}
                          onRetryWithModel={handleRetryWithModel}
                          onStop={handleStop}
                          seed={agentId}
                          statusEvents={$chatStatusEvents$}
                          streamingStartTime={$chatStreamingStartTime$}
                        />
                      </div>
                    {/if}
                  {/each}

                  <!-- Show streaming status while waiting for first assistant message -->
                  {#if streamingAssistantMessages.length === 0}
                    <div class="mb-4">
                      <StreamingStatus
                        isStreaming={$agentSessionIsStreaming$}
                        isProcessing={$agentIsResponding$}
                        lastChunkTime={$chatLastChunkTime$}
                        receivedFirstChunk={$chatReceivedFirstChunk$}
                        streamingContentLength={$chatStreamingContent$?.length ?? 0}
                        error={effectiveError}
                        sessionCorrupted={effectiveSessionCorrupted}
                        failedAt={effectiveFailedAt}
                        modelUnavailable={$chatModelUnavailable$}
                        {hasPendingPermission}
                        onRetry={handleRetry}
                        onRetryWithModel={handleRetryWithModel}
                        onStop={handleStop}
                        seed={agentId}
                        statusEvents={$chatStatusEvents$}
                        streamingStartTime={$chatStreamingStartTime$}
                      />
                    </div>
                  {/if}
                </div>
              </div>
            {:else}
              <!-- With animation - normal case where parent didn't show optimistic message -->
              <!-- NOTE: Removed in:fly transition to debug duplicate flash issue -->
              <div class="w-full">
                {#if isInitialWorkspaceAgent && onboardingContext}
                  <div class="pt-16 pb-6">
                    <WorkspaceSetupCard
                      repoName={onboardingContext.projectName ||
                        onboardingContext.projectPath?.split('/').pop() ||
                        m.chat_chatPanel_yourProject_fallback()}
                      repoPath={onboardingContext.repoPath || onboardingContext.projectPath}
                      worktreePath={onboardingContext.worktreePath}
                      workspaceId={workspace?.id}
                      branch={onboardingContext.branch}
                      baseRef={onboardingContext.baseRef || 'origin/main'}
                      specialistName={onboardingContext.specialistName}
                      specialistId={onboardingContext.specialistId}
                      hasPrompt={!!onboardingContext.prompt?.trim()}
                      repoStatus="done"
                      branchStatus="done"
                      agentStatus="done"
                      setupScriptStatus={onboardingContext.setupScript ? 'done' : undefined}
                      setupScriptContent={onboardingContext.setupScript}
                      onFocusSetupTerminal={onboardingContext.setupScript
                        ? handleFocusSetupTerminal
                        : undefined}
                      skipIsolation={onboardingContext.skipWorktree}
                    />
                  </div>
                {/if}
                <!-- Conversation turn container - constrains sticky behavior -->
                <div class="conversation-turn">
                  <div class="message-nav-target z-10 mb-9">
                    <ChatMessage
                      message={pendingMessage}
                      {workspace}
                      backendSessionId={auggieSessionId}
                    />
                  </div>

                  <!-- Render any streaming assistant messages -->
                  {#each streamingAssistantMessages as message, index (message.id)}
                    {@const isLastMessage = index === streamingAssistantMessages.length - 1}
                    {@const isCurrentlyStreaming = isLastMessage && $agentSessionIsStreaming$}
                    <div
                      data-message-id={message.id}
                      data-message-role="assistant"
                      class="message-nav-target"
                    >
                      <ChatMessage
                        {agentId}
                        messageId={message.id}
                        {workspace}
                        isStreaming={isCurrentlyStreaming}
                        backendSessionId={auggieSessionId}
                      />
                    </div>
                    {#if (isCurrentlyStreaming && ($agentIsResponding$ || $agentSessionIsStreaming$)) || (isLastMessage && ($chatError$ || $chatModelUnavailable$))}
                      <div class={isCompactMode ? 'mb-2' : 'mb-16'}>
                        <StreamingStatus
                          isStreaming={$agentSessionIsStreaming$}
                          isProcessing={$agentIsResponding$}
                          lastChunkTime={$chatLastChunkTime$}
                          receivedFirstChunk={$chatReceivedFirstChunk$}
                          streamingContentLength={$chatStreamingContent$?.length ?? 0}
                          error={effectiveError}
                          sessionCorrupted={effectiveSessionCorrupted}
                          failedAt={effectiveFailedAt}
                          modelUnavailable={$chatModelUnavailable$}
                          {hasPendingPermission}
                          onRetry={handleRetry}
                          onRetryWithModel={handleRetryWithModel}
                          onStop={handleStop}
                          seed={agentId}
                          statusEvents={$chatStatusEvents$}
                          streamingStartTime={$chatStreamingStartTime$}
                        />
                      </div>
                    {/if}
                  {/each}

                  <!-- Show streaming status while waiting for first assistant message -->
                  {#if streamingAssistantMessages.length === 0}
                    <div class="mb-4">
                      <StreamingStatus
                        isStreaming={$agentSessionIsStreaming$}
                        isProcessing={$agentIsResponding$}
                        lastChunkTime={$chatLastChunkTime$}
                        receivedFirstChunk={$chatReceivedFirstChunk$}
                        streamingContentLength={$chatStreamingContent$?.length ?? 0}
                        error={effectiveError}
                        sessionCorrupted={effectiveSessionCorrupted}
                        failedAt={effectiveFailedAt}
                        modelUnavailable={$chatModelUnavailable$}
                        {hasPendingPermission}
                        onRetry={handleRetry}
                        onRetryWithModel={handleRetryWithModel}
                        onStop={handleStop}
                        seed={agentId}
                        statusEvents={$chatStatusEvents$}
                        streamingStartTime={$chatStreamingStartTime$}
                      />
                    </div>
                  {/if}
                </div>
              </div>
            {/if}
          {/if}

          <!-- Fallback: Show streaming/processing status when no messages and no pending message -->
          <!-- This covers the window where the backend starts processing before the user message echo arrives -->
          {#if !pendingCondition && !messagesCondition && ($agentIsResponding$ || $agentSessionIsStreaming$ || $chatError$ || $chatModelUnavailable$)}
            <div class="w-full">
              <div class="mb-4">
                <StreamingStatus
                  isStreaming={$agentSessionIsStreaming$}
                  isProcessing={$agentIsResponding$}
                  lastChunkTime={$chatLastChunkTime$}
                  receivedFirstChunk={$chatReceivedFirstChunk$}
                  streamingContentLength={$chatStreamingContent$?.length ?? 0}
                  error={effectiveError}
                  sessionCorrupted={effectiveSessionCorrupted}
                  failedAt={effectiveFailedAt}
                  modelUnavailable={$chatModelUnavailable$}
                  {hasPendingPermission}
                  onRetry={handleRetry}
                  onRetryWithModel={handleRetryWithModel}
                  onStop={handleStop}
                  seed={agentId}
                  statusEvents={$chatStatusEvents$}
                  streamingStartTime={$chatStreamingStartTime$}
                />
              </div>
            </div>
          {/if}

          <!-- IMPORTANT: Only show messages when NOT showing pending message to avoid duplicate display -->
          <!-- When pendingCondition is true, we show the optimistic user message + streaming status -->
          <!-- When pendingCondition is false and we have messages, we show the actual message list -->
          {#if messagesCondition && !pendingCondition}
            <!-- Messages container (removed in:fly to test duplicate flash issue) -->
            <div class="w-full">
              {#if isInitialWorkspaceAgent && onboardingContext}
                <div class="pt-16 pb-6">
                  <WorkspaceSetupCard
                    repoName={onboardingContext.projectName ||
                      onboardingContext.projectPath?.split('/').pop() ||
                      m.chat_chatPanel_yourProject_fallback()}
                    repoPath={onboardingContext.repoPath || onboardingContext.projectPath}
                    worktreePath={onboardingContext.worktreePath}
                    workspaceId={workspace?.id}
                    branch={onboardingContext.branch}
                    baseRef={onboardingContext.baseRef || 'origin/main'}
                    specialistName={onboardingContext.specialistName}
                    specialistId={onboardingContext.specialistId}
                    hasPrompt={!!onboardingContext.prompt?.trim()}
                    repoStatus="done"
                    branchStatus="done"
                    agentStatus="done"
                    setupScriptStatus={onboardingContext.setupScript ? 'done' : undefined}
                    setupScriptContent={onboardingContext.setupScript}
                    onFocusSetupTerminal={onboardingContext.setupScript
                      ? handleFocusSetupTerminal
                      : undefined}
                    skipIsolation={onboardingContext.skipWorktree}
                  />
                </div>
              {/if}
              <!-- Inline (mid-turn) divider placement; suppressed when the anchor
                   is the turn's last rendered message and another turn follows —
                   the divider then renders after the inter-turn spacer instead. -->
              {#snippet newMessagesDividerAfter(messageId: string, deferToTurnBoundary: boolean)}
                {#if newMessagesDividerAnchorId === messageId && !deferToTurnBoundary}
                  <NewMessagesDivider />
                {/if}
              {/snippet}
              <!-- PERF: Use keyed each blocks for efficient list diffing -->
              {#each conversationTurnIndex.groups as indexedGroup, groupIndex (indexedGroup.group.messages[0]?.id ?? groupIndex)}
                {@const turns = indexedGroup.turns}
                {#each turns as turn, turnIndex (turn.userMessage?.id ?? `turn-${turnIndex}`)}
                  {@const turnKey = turn.userMessage?.id ?? `group-${groupIndex}-turn-${turnIndex}`}
                  <!-- "Last" means last RENDERED turn (globalTurnIndexMap indexes the
                       turns groupIntoTurns produced), not the last raw date group — a
                       trailing group holding only skipped rows (system/error, non-model-
                       change notices) renders no turn and must not count as a follower. -->
                  {@const isEventNotification = isEventWakeMessage(turn.userMessage ?? undefined)}
                  {@const nextTurn =
                    turns[turnIndex + 1] ?? conversationTurnIndex.groups[groupIndex + 1]?.turns[0]}
                  {@const nextTurnIsEventNotification = isEventWakeMessage(
                    nextTurn?.userMessage ?? undefined,
                  )}
                  {@const isLastTurnInConversation =
                    globalTurnIndexMap.get(turnKey) === globalTurnIndexMap.size - 1}
                  <!-- Conversation turn container - constrains sticky behavior -->
                  <!-- PERF: LazyTurn defers rendering of off-screen turns -->
                  <!-- PERF: Only force-visible the last turn during streaming, not all turns -->
                  <!-- Fallback chain mirrors the row render order below. Edge case:
                       a user message with metadata.type === 'event_notification' but
                       no eventTypes (and no [WORKSPACE EVENTS] prefix) renders neither
                       the banner nor the user row, yet still counts as "last rendered"
                       here — if it is the anchor, the divider renders at the turn
                       boundary (previously it rendered nowhere). -->
                  {@const turnLastRenderedMessageId =
                    turn.assistantMessages[turn.assistantMessages.length - 1]?.id ??
                    turn.noticeMessages.findLast((notice) => getModelChangeNotice(notice))?.id ??
                    turn.userMessage?.id ??
                    null}
                  {@const dividerAtTurnBoundary = dividerDefersToTurnBoundary(
                    newMessagesDividerAnchorId,
                    turnLastRenderedMessageId,
                    !isLastTurnInConversation,
                  )}
                  <div class="conversation-turn" data-conversation-turn>
                    <LazyTurn
                      {turnKey}
                      scrollRoot={scrollContainer}
                      heightCache={lazyTurnHeightCache}
                      forceVisible={isTurnForceVisible(turnKey) ||
                        ($agentSessionIsStreaming$ && isLastTurnInConversation) ||
                        visibleSearchTurnKeys.has(turnKey) ||
                        deepOpenTurnKey === turnKey}
                    >
                      {#snippet children()}
                        <!-- Event wakeup banner - shown when agent is woken by a subscription -->
                        <!-- Also detect [WORKSPACE EVENTS] messages as a fallback in case metadata is missing -->
                        {#if turn.userMessage && isEventNotification}
                          {@const message = turn.userMessage}
                          {@const globalIndex = getMessageIndex(message.id)}
                          {@const messageText = extractAllContent(message)}
                          <!-- Source wake-up row remains owned by this transcript turn. -->
                          <div
                            data-message-id={message.id}
                            data-pinned-prompt-id={message.id}
                            data-message-index={globalIndex}
                            class="message-nav-target relative z-10"
                            class:bg-sidebar={isChiefWorkspace}
                            class:bg-card={!isChiefWorkspace}
                            use:attachPinnedPromptMessage={message}
                            transition:safeSlide={{ axis: 'y', duration: 200 }}
                          >
                            <EventWakeupBanner
                              metadata={message.metadata as {
                                type: 'event_notification';
                                eventCount: number;
                                eventTypes: string[];
                                events?: Array<{
                                  type: string;
                                  data: Record<string, unknown>;
                                  timestamp: string;
                                }>;
                              }}
                              {messageText}
                              asDivider={true}
                              compact={isCompactMode}
                              showAgentCards={!isDelegatedBackgroundTaskAgent}
                              {workspace}
                            />
                          </div>
                          {@render newMessagesDividerAfter(message.id, dividerAtTurnBoundary)}
                        {/if}
                        <!-- User message source row; the independent overlay never moves this node. -->
                        <!-- Also skip messages starting with [WORKSPACE EVENTS] as a fallback in case metadata is missing -->
                        {#if turn.userMessage && !isEventNotification}
                          {@const message = turn.userMessage}
                          {@const globalIndex = getMessageIndex(message.id)}
                          <div
                            data-message-id={message.id}
                            data-message-role="user"
                            data-pinnable-user-prompt={!isAutomatedMessage(message)
                              ? ''
                              : undefined}
                            data-pinned-prompt-id={message.id}
                            data-send-app-message-id={message.appMessageId}
                            data-message-index={globalIndex}
                            class="message-nav-target relative z-20 mb-4"
                            class:invisible={pendingSendMessageIds.has(
                              String(message.appMessageId ?? ''),
                            )}
                            class:bg-sidebar={isChiefWorkspace}
                            class:bg-card={!isChiefWorkspace}
                            use:attachPinnedPromptMessage={message}
                          >
                            <div class={isChiefWorkspace ? 'mx-1 sm:mx-2' : ''}>
                              <ChatMessage
                                {agentId}
                                messageId={message.id}
                                {workspace}
                                onEditSubmit={(newText, model, blocks) =>
                                  handleEditMessage(message.id, newText, model, blocks)}
                                onEditStateChange={(isEditing) =>
                                  handleTurnEditStateChange(turnKey, isEditing)}
                                editModel={turn.assistantMessages[0]?.metadata?.model ??
                                  hydratedInputModel}
                                onScrollToPrevious={() => scrollToPreviousUserMessage(message.id)}
                                backendSessionId={auggieSessionId}
                              />
                            </div>
                          </div>
                          {@render newMessagesDividerAfter(message.id, dividerAtTurnBoundary)}
                        {/if}

                        <!-- Model-change notices (daemon-persisted, after the user row, before assistant output) -->
                        {#each turn.noticeMessages as noticeMessage (noticeMessage.id)}
                          {@const notice = getModelChangeNotice(noticeMessage)}
                          {#if notice}
                            <div data-message-id={noticeMessage.id} class="px-2">
                              <ModelChangeNotice
                                {notice}
                                fallbackText={extractAllContent(noticeMessage) || undefined}
                              />
                            </div>
                            {@render newMessagesDividerAfter(
                              noticeMessage.id,
                              dividerAtTurnBoundary,
                            )}
                          {/if}
                        {/each}

                        <!-- Show status when active but no assistant message yet, or when there's an error/modelUnavailable -->
                        {#if groupIndex === groupedMessages.length - 1 && turnIndex === turns.length - 1 && turn.assistantMessages.length === 0 && shouldShowPendingAssistantStatus( { isStreaming: $agentSessionIsStreaming$, isProcessing: $agentIsResponding$, error: effectiveError, modelUnavailable: $chatModelUnavailable$ } )}
                          <div class={isCompactMode ? 'mb-2' : 'mb-8'}>
                            <StreamingStatus
                              isStreaming={$agentSessionIsStreaming$}
                              isProcessing={$agentIsResponding$}
                              lastChunkTime={$chatLastChunkTime$}
                              receivedFirstChunk={$chatReceivedFirstChunk$}
                              streamingContentLength={$chatStreamingContent$?.length ?? 0}
                              error={effectiveError}
                              sessionCorrupted={effectiveSessionCorrupted}
                              failedAt={effectiveFailedAt}
                              modelUnavailable={$chatModelUnavailable$}
                              {hasPendingPermission}
                              onRetry={handleRetry}
                              onRetryWithModel={handleRetryWithModel}
                              onStop={handleStop}
                              seed={agentId}
                              statusEvents={$chatStatusEvents$}
                              streamingStartTime={$chatStreamingStartTime$}
                            />
                          </div>
                        {/if}

                        <!-- Assistant messages -->
                        <!-- PERF: Key by message.id for efficient updates during streaming -->
                        {#each turn.assistantMessages as message, assistantIndex (message.id)}
                          {@const isLastTurn =
                            groupIndex === groupedMessages.length - 1 &&
                            turnIndex === turns.length - 1}
                          {@const isLastAssistant =
                            assistantIndex === turn.assistantMessages.length - 1}
                          {@const isLastMessage = isLastTurn && isLastAssistant}
                          {@const isCurrentlyStreaming = isLastMessage && $agentSessionIsStreaming$}
                          {@const turnNumber = getMessageTurnNumber(message.id)}
                          {@const globalIndex = getMessageIndex(message.id)}
                          <div
                            data-message-id={message.id}
                            data-message-role="assistant"
                            data-message-index={globalIndex}
                            data-turn-number={turnNumber}
                            class="message-nav-target"
                          >
                            <ChatMessage
                              {agentId}
                              messageId={message.id}
                              {workspace}
                              isStreaming={isCurrentlyStreaming}
                              onEditSubmit={(newText, model, blocks) =>
                                handleEditMessage(message.id, newText, model, blocks)}
                              onRegenerate={() => handleRegenerateFromMessage(message.id)}
                              onFork={() => handleForkFromMessage(message.id)}
                              backendSessionId={auggieSessionId}
                              suppressCoordinationStoppedIndicator={turn.userMessage
                                ? isAutomatedMessage(turn.userMessage)
                                : false}
                            />
                          </div>
                          <!-- Show streaming status while streaming or when there's an error/modelUnavailable -->
                          {#if (isCurrentlyStreaming && ($agentIsResponding$ || $agentSessionIsStreaming$)) || (isLastMessage && (effectiveError || $chatModelUnavailable$))}
                            <div class={isCompactMode ? 'mb-2' : 'mb-16'}>
                              <StreamingStatus
                                isStreaming={$agentSessionIsStreaming$}
                                isProcessing={$agentIsResponding$}
                                lastChunkTime={$chatLastChunkTime$}
                                receivedFirstChunk={$chatReceivedFirstChunk$}
                                streamingContentLength={$chatStreamingContent$?.length ?? 0}
                                error={effectiveError}
                                sessionCorrupted={effectiveSessionCorrupted}
                                failedAt={effectiveFailedAt}
                                modelUnavailable={$chatModelUnavailable$}
                                {hasPendingPermission}
                                onRetry={handleRetry}
                                onRetryWithModel={handleRetryWithModel}
                                onStop={handleStop}
                                seed={agentId}
                                statusEvents={$chatStatusEvents$}
                                streamingStartTime={$chatStreamingStartTime$}
                              />
                            </div>
                          {/if}
                          <!-- Show file changes after each assistant turn -->
                          <div class="w-full mb-1">
                            <ChatFileChangesSummary
                              workspaceId={workspace.id}
                              {message}
                              isStreaming={isCurrentlyStreaming}
                              {agentId}
                              {turnNumber}
                            />
                          </div>
                          <!-- Show auto-commit status after the last assistant message of each turn -->
                          {#if isLastAssistant}
                            <AutoCommitStatus
                              status={autoCommitStatuses[globalTurnIndexMap.get(turnKey) ?? 0]}
                              workspaceId={workspace.id}
                            />
                          {/if}
                          {@render newMessagesDividerAfter(message.id, dividerAtTurnBoundary)}
                        {/each}
                      {/snippet}
                    </LazyTurn>
                  </div>
                  <!-- Editorial rhythm between turns (not after the last one).
                       Must stay the negation of dividerDefersToTurnBoundary's
                       hasFollowingTurn input so a deferred divider always follows
                       a spacer. -->
                  {#if !isLastTurnInConversation}
                    <ConversationTurnGap
                      currentIsEventNotification={isEventNotification}
                      currentHasAssistantMessages={turn.assistantMessages.length > 0}
                      nextIsEventNotification={nextTurnIsEventNotification}
                    />
                  {/if}
                  <!-- Turn-boundary divider placement: the anchor is this turn's
                       last rendered message and another turn follows, so the
                       divider sits after the spacer, directly above the next turn. -->
                  {#if dividerAtTurnBoundary}
                    <NewMessagesDivider />
                  {/if}
                {/each}
              {/each}
              {#if showEndOfListStreamingStatus}
                <div class={isCompactMode ? 'mb-2' : 'mb-16'}>
                  <StreamingStatus
                    isStreaming={$agentSessionIsStreaming$}
                    isProcessing={$agentIsResponding$}
                    lastChunkTime={$chatLastChunkTime$}
                    receivedFirstChunk={$chatReceivedFirstChunk$}
                    streamingContentLength={$chatStreamingContent$?.length ?? 0}
                    error={effectiveError}
                    sessionCorrupted={effectiveSessionCorrupted}
                    failedAt={effectiveFailedAt}
                    modelUnavailable={$chatModelUnavailable$}
                    {hasPendingPermission}
                    onRetry={handleRetry}
                    onRetryWithModel={handleRetryWithModel}
                    onStop={handleStop}
                    seed={agentId}
                    statusEvents={$chatStatusEvents$}
                    streamingStartTime={$chatStreamingStartTime$}
                  />
                </div>
              {/if}
            </div>
          {/if}
        {/if}
        <!-- Aggregate File Changes Summary (show if more than one assistant message and it isn't redundant with the last turn's row, updates during streaming) -->
        {#if showAggregateFileChangesSummary}
          <div class="w-full">
            <ChatFileChangesSummary
              workspaceId={workspace.id}
              messages={$agentMessages$}
              suffix={m.chat_chatPanel_fileChangesAggregate_suffix()}
              isAggregate={true}
              isStreaming={$agentSessionIsStreaming$}
              {agentId}
            />
          </div>
        {/if}

        <!-- Show suggested prompts for the last message only, when not streaming -->
        {#if suggestedPrompts.length > 0}
          <div class="w-full {isCompactMode ? 'pb-1 pt-2' : 'py-2'}">
            <SuggestedPrompts
              prompts={suggestedPrompts}
              onSelect={handleSelectSuggestedPrompt}
              onEdit={handleEditSuggestedPrompt}
              compact={isCompactMode}
              showShortcutHints={isChatFocused}
            />
          </div>
        {/if}

        <!-- Inline Permission Requests (filtered by current agent) -->
        {#if agentId && agentPermissionRequests.length > 0}
          {@const currentRequest = agentPermissionRequests[0]}
          <div class="w-full px-2">
            <InlinePermissionRequest
              request={currentRequest}
              pendingCount={agentPermissionRequests.length}
              keyboardShortcutsEnabled={isActive && isChatFocused}
            />
          </div>
        {/if}

        <!-- Pending attention request (discussion/blocker) remains in transcript order. -->
        {#if workspace?.id && agentId}
          <AttentionRequestBanner {agentId} />
        {/if}

        <!-- The utility stack owns short-chat surplus through its auto margin.
             It collapses naturally when transcript or expanded disclosure content overflows. -->
        <div class="mt-auto" data-testid="transcript-utility-stack">
          <!-- {#key} forces a full remount when workspace or agent changes,
             preventing stale subscription UI from leaking across switches. -->
          {#if workspace?.id}
            {#key `${workspace.id}::${agentId}`}
              <EventSubscriptionsCard
                workspaceId={workspace.id}
                {agentId}
                compact={isCompactMode}
              />
            {/key}
          {/if}

          <!-- Queued messages remain in the same scroll/follow surface. -->
          {#if queuedMessagesVisibility.showQueue}
            <div
              class="mt-6 {isChiefWorkspace
                ? 'w-full'
                : 'queued-message-utility-wide -mx-4 sm:-mx-6'}"
              data-testid="queued-message-utility-area"
            >
              <QueuedMessageList
                bind:this={queuedMessageListRef}
                messages={visibleQueuedMessages}
                heldForQuestions={queuedMessagesVisibility.heldForQuestions}
                onedit={handleEditQueuedMessage}
                onremove={handleRemoveQueuedMessage}
                onsendnow={handleSendQueuedMessageNow}
                ondone={() => inputComponent?.focus?.()}
              />
            </div>
          {/if}
        </div>

        <!-- Scroll anchor - ensures proper scroll to absolute bottom -->
        <div class="min-h-px min-w-6 shrink-0"></div>
      </div>
    </div>
    <!-- Scroll-to-bottom button: rendered only while scrolled up so no
         invisible control overlaps the message actions bar or lingers in the
         tab order while at the bottom. Auto-follow re-locks on click or on
         scrolling back to the bottom; scrolling up unlocks it. Visibility is
         the damped (hysteresis + settle window) state, not the raw distance,
         so per-frame scroll-metric jitter cannot strobe the button. -->
    {#if $agentMessages$.length > 0 && scrollButtonVisible}
      <Button
        variant="outline"
        size="icon-xs"
        data-testid="chat-scroll-to-bottom-button"
        onclick={() => scrollToBottom()}
        class="absolute bottom-2 right-2 text-muted-foreground bg-sidebar rounded-sm transition-all opacity-0 group-hover/panel:opacity-100 focus-visible:opacity-100 active:scale-95"
        title={m.chat_chatPanel_scrollToBottom_tooltip()}
      >
        <Fa icon={faArrowDown} class="w-3! h-3!" />
      </Button>
    {:else if showLockConfirmation}
      <!-- Transient re-lock confirmation: purely decorative feedback that
           auto-follow re-engaged on reaching the bottom. Never interactive:
           aria-hidden keeps it out of the accessibility tree and
           pointer-events-none out of hover hit-tests (monorepo#2508). -->
      <div
        aria-hidden="true"
        data-testid="chat-scroll-lock-confirmation"
        class="lock-confirmation pointer-events-none absolute bottom-2 right-2 flex size-7 items-center justify-center rounded-sm border border-border bg-sidebar text-muted-foreground"
      >
        <Fa icon={faLock} class="w-3! h-3!" />
      </div>
    {/if}
  </div>

  <!-- Message Input with Aurora Background -->
  <div
    bind:this={composerElement}
    class="conversation-composer relative z-20 w-full"
    class:input-flash={showInputFlash}
    data-streaming={$agentSessionIsStreaming$}
  >
    <!-- Aurora northern lights effect during streaming -->
    {#if $agentSessionIsStreaming$}
      <div
        class="absolute -inset-x-2 -bottom-2 pointer-events-none z-0 overflow-hidden"
        transition:fade
        style="height: calc(100% + 10rem);"
      >
        <AuroraBackground {agentId} />
      </div>
    {/if}

    {#if pendingQuestions}
      {#key pendingQuestions.messageId}
        <div class="w-full" data-testid="question-wizard-slot">
          <QuestionWizard
            questions={pendingQuestions.questions}
            collapsed={questionWizardCollapsed}
            onToggleCollapsed={(collapsed) => (questionWizardCollapsed = collapsed)}
            onComplete={handleQuestionWizardComplete}
            onDismiss={handleQuestionWizardDismiss}
          />
        </div>
      {/key}
    {/if}
    {#if !pendingQuestions || questionWizardCollapsed}
      {#if draftManager.gateVisible}
        <ChatDraftLoadingGate />
      {/if}
      <SimpleRichInput
        bind:this={inputComponent}
        bind:contextItems
        bind:value={inputValue}
        onvaluechange={(value) => {
          if (workspace?.id && agentId) {
            appStore.dispatch(setChatDraft(workspace.id, agentId, value));
          }
        }}
        onsubmit={handleSend}
        onforcesubmit={handleForceSubmit}
        onstop={handleStop}
        onHistoryPrev={handleHistoryPrev}
        onHistoryNext={handleHistoryNext}
        disabled={!workspace || !$agentSession$}
        inputLocked={draftManager.gateActive}
        isStreaming={$agentSessionIsStreaming$}
        isResponding={$agentIsResponding$}
        {workspace}
        currentContext={currentMainPanelContext}
        {agentId}
        selectedModel={hydratedInputModel}
        compactMode={isCompactMode}
        editorClassName={isChiefWorkspace ? 'w-full px-1.5!' : 'w-full px-4! sm:px-6!'}
        contentInsetClassName={isChiefWorkspace ? 'w-full px-1.5' : 'w-full px-4 sm:px-6'}
        edgeDocked
        externalDropTarget
        requiresModelSwitchConfirmation={!canChangeProvider}
        providerId={inputProviderId}
      />
    {/if}
  </div>
</div>

<style>
  /* Keep style invalidation local without paint-containing sticky descendants. */
  /* Chromium can flash sticky layers as they cross a paint-containment boundary. */
  :global(.conversation-turn) {
    contain: style;
  }

  /* Paint containment on the sticky node itself causes the same compositor instability. */
  :global(.message-nav-target) {
    contain: style;
  }

  /* Flash animation for message navigation */
  :global(.message-highlight-flash) {
    animation: message-flash 0.6s ease-out;
  }

  /* Flash animation for scroll-to-turn navigation */
  :global(.highlight-flash) {
    animation: highlight-flash 1.5s ease-out;
  }

  /* Transient scroll re-lock confirmation: hold briefly, then fade out.
     Forwards fill keeps it invisible until the element unmounts. */
  .lock-confirmation {
    animation: lock-confirmation-fade 1.5s ease-out forwards;
  }

  @media (prefers-reduced-motion: reduce) {
    .lock-confirmation {
      animation: none;
      opacity: 0.9;
    }
  }

  @keyframes lock-confirmation-fade {
    0%,
    40% {
      opacity: 0.9;
    }
    100% {
      opacity: 0;
    }
  }

  @keyframes message-flash {
    0% {
      background-color: hsl(var(--accent) / 0.3);
    }
    100% {
      background-color: transparent;
    }
  }

  @keyframes highlight-flash {
    0%,
    30% {
      background-color: hsl(var(--accent) / 0.25);
      border-radius: 0.5rem;
    }
    100% {
      background-color: transparent;
    }
  }

  /* Subtle flash animation for input when draft prompt is applied */
  .input-flash :global(.rich-input-container) {
    animation: input-flash 0.6s ease-out;
  }

  @keyframes input-flash {
    0% {
      box-shadow: inset 0 0 0 2px hsl(var(--primary) / 0.4);
    }
    50% {
      box-shadow: inset 0 0 0 2px hsl(var(--primary) / 0.2);
    }
    100% {
      box-shadow: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    :global(.conversation-column *),
    .conversation-composer {
      scroll-behavior: auto;
    }
  }

  /* CSS Custom Highlight API styles for search */
  ::highlight(search-results) {
    background-color: hsl(var(--primary) / 0.2);
    color: inherit;
  }

  ::highlight(current-search-result) {
    background-color: hsl(var(--primary));
    color: hsl(var(--primary-foreground));
  }

  /* Transient query-term highlight for deep-open navigation (openMessage) */
  ::highlight(deep-open-match) {
    background-color: hsl(var(--primary) / 0.35);
    color: inherit;
  }
</style>
