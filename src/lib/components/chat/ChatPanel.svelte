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
  import { getPresentedUserMessageText } from '$lib/utils/user-message-presentation';
  import {
    reportStreamLifecycle,
    streamTurnCorrelation,
  } from '$lib/utils/stream-lifecycle-telemetry';
  import {
    restoreRetiredAgentRequested,
    saveAgentSessionRequested,
  } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
  import {
    agentSessionDismissQuestionsRequested,
    agentSessionEditAndRegenerateRequested,
    agentSessionRegenerateFromMessageRequested,
    agentSessionRetryFromStalledRequested,
    agentSessionRetryLastMessageRequested,
    agentSessionRetryWithModelRequested,
    agentSessionStopChatRequested,
    clearHistorySegment,
    updateSession as updateAgentSessionFields,
  } from '$store/renderer/slices/agent-session/agent-session-slice';
  import {
    selectAgentSession,
    selectAgentIsResponding,
    selectAgentIsRunning,
    selectAgentSessionIsStreaming,
    selectAgentSessionStreamingContent,
    selectAgentMessages,
    selectAgentHistoryMessages,
    selectHistorySegmentMeta,
    selectAgentTailCapPruned,
  } from '$store/renderer/slices/agent-session/agent-session-selectors';
  import { selectAgentQueueMessages } from '$store/renderer/slices/agent-queue/agent-queue-selectors';
  import { removeQueuedMessageRequested } from '$store/renderer/slices/agent-queue/agent-queue-slice';
  import { hydrateAgentQueue } from '$features/agent/agent-queue-read-service';
  import {
    acquireChatInterestLease,
    releaseChatInterestLease,
  } from '$features/agent/utils/chat-interest-leases';
  import { selectNoteById } from '$store/renderer/slices/workspace-notes/workspace-notes-selectors';
  import {
    selectWorkspaceTasks,
    selectWorkspaceTasksInitialized,
  } from '$store/renderer/slices/workspace-tasks/workspace-tasks-selectors';
  import { getPanelLayoutManager } from '$features/layout/panel-layout-adapter';
  import { selectAllTabs as selectPanelLayoutAllTabs } from '$store/renderer/slices/panel-layout/panel-layout-selectors';
  import { clearBrowserElementCapture } from '$store/renderer/slices/browser/browser-slice';
  import { selectPendingBrowserElementCaptures } from '$store/renderer/slices/browser/browser-selectors';
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
    olderHistoryPageRequested,
    historyGapFillRequested,
    historySeekRequested,
    pendingProposalRecoveryPruned,
    pendingProposalRecoveryRequested,
    pendingQuestionRecoveryRequested,
    pendingQuestionRecoveryCleared,
  } from '$store/renderer/slices/chat-state/chat-state-slice';
  import {
    selectAwaitingSwitchBackSnapshot,
    selectChatError,
    selectChatFailureCorrelation,
    selectChatLastChunkTime,
    selectChatModelUnavailable,
    selectChatReceivedFirstChunk,
    selectChatStatusEvents,
    selectChatStreamingStartTime,
    selectFetchingGapFill,
    selectFetchingHistorySeek,
    selectFetchingOlderHistory,
    selectHistoryExhausted,
    selectHistorySeekUnsupported,
    selectPendingProposalRecovery,
    selectPendingQuestionRecovery,
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
  import type { Workspace, AgentMetadata, PendingProposalRef } from '$shared/types';
  import { extractAllContent, type SuggestedPrompt, AgentStatus } from '$shared/types';
  import type { ContextItem } from './input/context-api';
  import {
    appendContextItemContent,
    browserCaptureTargetsAgent,
    browserCaptureToContextItems,
  } from './browser-capture-context';
  import { createFileDropTarget } from '$lib/utils/file-drop';
  import type { DropSplit } from '$lib/utils/drop-split';
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
    dividerEntryScrollTop,
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
  import {
    deriveMarkedQuestionRecoveryState,
    deriveWizardPendingQuestions,
  } from './questions/wizard-gate';
  import { classifyPendingQuestionMarker } from './questions/pending-questions';
  import { derivePendingProposalRecoveryState } from './proposals/pending-proposal-recovery';
  import { classifyPendingProposalRefs } from './proposals/pending-proposals';
  import { reconcileAppliedProposals } from './proposals/proposal-action-handlers';
  import { selectProposalLifecycleMap } from '$store/renderer/slices/proposal-lifecycle/proposal-lifecycle-selectors';
  import {
    initialWizardCollapsed,
    saveWizardCollapsed,
    wizardDraftKey,
  } from './questions/wizard-draft-storage';
  import { buildAnswerMessageMetadata, flattenAnswersToMessage } from './questions/answer-message';
  import {
    appendScrollSample,
    classifyScrollbackGesture,
    classifyScrollBurst,
    composeTranscript,
    isConversationStartLoaded,
    mapScrollTopToOrdinal,
    OLDER_HISTORY_INDICATOR_QUIET_MS,
    olderHistoryIndicatorAction,
    RAPID_SCROLL_WINDOW_MS,
    reconcileVirtualSpacer,
    restateFrozenSpacers,
    shouldRequestOlderHistory,
    splitUnloadedRows,
    VIRTUAL_ROW_HEIGHT_MIN_PX,
    type ScrollSample,
  } from './chat-scrollback-composition';
  import { buildDateGroupKeys } from '$lib/utils/timeFormatting';
  import {
    animateScrollTo,
    captureScrollAnchor,
    followBottom,
    followToBottom,
    restoreScrollAnchor,
    type FollowBottomState,
  } from '$lib/utils/smartScroll';
  import { getCachedChatScroll, setCachedChatScroll } from './chat-scroll-cache';
  import { createScrollBottomButtonVisibility } from './scroll-bottom-button-visibility';
  import { createLogger } from '$lib/utils/client-logger';
  import { isFocusInEditableElement, isFocusInTerminal } from '$lib/utils/keyboardShortcuts';
  import Fa from 'svelte-fa';
  import { faLock, faPaperclip, faSpinner, faSquareCheck } from '@fortawesome/free-solid-svg-icons';
  import { fade } from 'svelte/transition';
  import { safeSlide } from '$lib/utils/animations';
  import { navigateToTask } from '$lib/utils/workspace-navigation';
  import { seekConversationToMessage } from '$lib/utils/open-message';
  import { openTab } from '$store/renderer/slices/panel-layout/panel-layout-slice';
  import ChatFileChangesSummary from './ChatFileChangesSummary.svelte';
  import { isAggregateFileChangesRedundant } from '$lib/utils/get-file-changes-from-messages';
  import AutoCommitStatus, { type CommitStatus } from './AutoCommitStatus.svelte';
  import QueuedMessageList from './QueuedMessageList.svelte';
  import EventSubscriptionsCard from './EventSubscriptionsCard.svelte';
  import { deriveTaskProgress, type TaskProgressItem } from './workspace-task-fallback';
  import Button from '../ui/button/button.svelte';
  import { PanelFindBar } from '$lib/components/ui/panel-find-bar';
  import { getSelectedTextWithinSurface } from '$lib/utils/selected-text';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import AttentionRequestBanner from './AttentionRequestBanner.svelte';
  import {
    getMessageNavigationStartScrollTop,
    getUserMessageNavigationItems,
    getUserMessageNavigationItemsFromIndex,
    mergeUserMessageNavigationItems,
    type ChatNavigationState,
    type UserMessageNavigationItem,
  } from './chat-message-navigation';
  import { parseSuggestedPromptsFromContentBlocks } from '$lib/utils/messageParser';
  import { getQueueInfo, isBatchedDeliverySeam, stripDequeueWaitNote } from '$lib/utils/queue-info';
  import {
    eventCardAssistantMarginClass,
    isAttentionQuestionAnswerSeam,
  } from './attention-flow-spacing';
  import {
    captureMessageSendOrigin,
    createMessageSendLaunchBubble,
  } from './message-send-transition';
  import { createPendingSendTransitions } from './pending-send-transitions';

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
  import {
    CHAT_HYDRATION_FRAME_BUDGET_MS,
    CHAT_HYDRATION_MAX_ROWS_PER_FRAME,
    createMessageHydrationPolicy,
    type HydrationMessage,
  } from './message-hydration-policy';
  import {
    CHIEF_LAZY_MESSAGE_THRESHOLD,
    INITIAL_LAZY_MODE_TRACKER,
    isOlderHistoryPrepend,
    nextLazyMode,
    USER_ROW_ESTIMATED_HEIGHT,
  } from './chat-turn-virtualization';
  import {
    EMPTY_TEMPORARY_TURN_MATERIALIZATION,
    isTurnTemporarilyMaterialized,
    materializeTurn,
    releaseMaterializedTurn,
    type TemporaryTurnMaterialization,
  } from './temporary-turn-materialization';
  import InlinePermissionRequest from './InlinePermissionRequest.svelte';
  import { selectPermissionRequests } from '$store/renderer/slices/permission/permission-selectors';
  import {
    selectChatAuroraEnabled,
    selectIsAgentMonospace,
  } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import {
    markAgentAsViewed,
    clearCurrentlyViewedAgent,
    startDividerSession,
  } from '$store/renderer/slices/unread-tracking/unread-tracking-slice';
  import { selectDividerSession } from '$store/renderer/slices/unread-tracking/unread-tracking-selectors';
  import AuroraBackground from './AuroraBackground.svelte';
  import {
    CHAT_SCROLL_END_MARKER_CLASS,
    CHAT_TRANSCRIPT_OVERFLOW_CLASS,
    chatTranscriptBottomInsetClass,
  } from './chat-queue-edge-layout';
  import { invoke, listenSync } from '$lib/electron-bridge';
  import {
    selectSpecialists,
    selectEffectiveBehaviorPrompt,
    selectEffectiveModel,
  } from '$store/renderer/slices/specialists/specialists-selectors';

  import { getAgentProvider } from '$shared/types/agent-session';
  import {
    selectEffectiveDefaultProviderId,
    selectProviderAuthFailureGuidance,
    selectProviderCatalogLoaded,
  } from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
  import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
  import { canChangeAgentProvider as resolveCanChangeAgentProvider } from './provider-lock';
  import ModelChangeNotice from './ModelChangeNotice.svelte';
  import { getModelChangeNotice } from './model-change-notice';
  import {
    hasOperationalAssistantMessageBoundary,
    hasOperationalAssistantTurnBoundary,
    indexConversationTurns,
    type ConversationTurn,
  } from './conversation-turns';
  import { createChatTranscriptStructureProjector } from './chat-transcript-structure';
  import {
    collectSearchRanges,
    createRangeForSpan,
    findChatSearchMatches,
    type ChatSearchMatch,
  } from './chat-search';
  import { requestSearchDisclosure } from './chat-search-disclosure';
  import { resolveHydratedInputModel } from './input-hydration';
  import {
    deriveQueuedMessagesVisibility,
    hasAuthoritativeConversationEvidence,
    shouldDeferTranscriptReveal,
    shouldShowEndOfListStreamingStatus,
    shouldShowPendingAssistantStatus,
    shouldShowSetupCardOnly,
    shouldShowTranscriptSkeleton,
    shouldShowTranscriptUtilityStack,
  } from './chat-panel-visibility';
  import { isUserQueuedMessage } from '$lib/utils/queued-message-visibility';
  import {
    findPreviousUserMessage,
    isAutomatedChatMessage,
  } from '$lib/utils/previous-user-message';
  import WorkspaceSetupCard from '$features/onboarding/messages/WorkspaceSetupCard.svelte';
  import { store as appStore } from '$store/renderer/store';
  import { getEffectiveShortcut } from '$lib/utils/effective-shortcuts';
  import { matchesShortcut } from '$lib/utils/shortcut-bindings';

  const logger = createLogger('ChatPanel');

  const chatAuroraEnabled$ = selectChatAuroraEnabled();
  const isAgentMonospace = selectIsAgentMonospace();

  // Constants
  const SCROLL_BOTTOM_THRESHOLD = 30; // pixels from bottom to consider "at bottom"
  const SCROLL_BOTTOM_BUTTON_EPSILON = 1;

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
    onNavigationStateChange?: (state: ChatNavigationState) => void;
    onTaskProgressChange?: (tasks: TaskProgressItem[]) => void;
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
    onNavigationStateChange,
    onTaskProgressChange,
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
  const pendingBrowserElementCaptures$ = selectPendingBrowserElementCaptures(workspaceIdStore);

  // Redux selectors for chat values — called at init time, reactive via Svelte store protocol
  // Broad selector rationale: ChatPanel passes the materialized session to
  // helpers/components that need model, metadata, provider, and prompt-handled state.
  const agentSession$ = selectAgentSession(agentIdStore);
  const agentSessionIsStreaming$ = selectAgentSessionIsStreaming(agentIdStore);
  const agentMessages$ = selectAgentMessages(agentIdStore);
  // Scrollback history segment (older rows hydrated on demand) + paging state.
  const agentHistoryMessages$ = selectAgentHistoryMessages(agentIdStore);
  const historySegmentMeta$ = selectHistorySegmentMeta(agentIdStore);
  // FE-owned latch: the client cap dropped live tail rows, so older rows
  // exist even when the (stale) chat-init snapshot meta says otherwise.
  const agentTailCapPruned$ = selectAgentTailCapPruned(agentIdStore);
  const fetchingOlderHistory$ = selectFetchingOlderHistory(agentIdStore);
  const fetchingGapFill$ = selectFetchingGapFill(agentIdStore);
  const fetchingHistorySeek$ = selectFetchingHistorySeek(agentIdStore);
  const historySeekUnsupported$ = selectHistorySeekUnsupported(agentIdStore);
  const historyExhausted$ = selectHistoryExhausted(agentIdStore);
  const pendingQuestionRecovery$ = selectPendingQuestionRecovery(agentIdStore);
  const pendingProposalRecovery$ = selectPendingProposalRecovery(agentIdStore);
  // Whole-map lifecycle readable: the tray derivation scans resolution
  // statuses across all pending proposals at once.
  const proposalLifecycleMap$ = selectProposalLifecycleMap();
  const agentTasks$ = selectTasksForAgent(workspaceIdStore, agentIdStore);
  const workspaceTasks$ = selectWorkspaceTasks(workspaceIdStore);
  const workspaceTasksInitialized$ = selectWorkspaceTasksInitialized(workspaceIdStore);
  const queuedMessages$ = selectAgentQueueMessages(agentIdStore);
  const chatStreamingContent$ = selectAgentSessionStreamingContent(agentIdStore);
  const chatError$ = selectChatError(agentIdStore);
  const chatFailureCorrelation$ = selectChatFailureCorrelation(agentIdStore);
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
  // Switch-back gate: true while a re-viewed conversation's (re)opening
  // standing subscription has not yet delivered its fresh seq-0 snapshot.
  const awaitingSwitchBackSnapshot$ = selectAwaitingSwitchBackSnapshot(agentIdStore);
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
  // The transcript is KNOWN empty (not merely not-yet-hydrated): hydration
  // settled, no switch-back snapshot outstanding, and no durable evidence of
  // messages. A fresh mount over a still-hydrating conversation must not be
  // mistaken for an empty chat.
  const transcriptSettledEmpty = $derived(
    $agentMessages$.length === 0 &&
      $transcriptHydration$ === 'settled' &&
      !$awaitingSwitchBackSnapshot$ &&
      !authoritativeConversationEvidence,
  );
  // Latched "New messages" divider viewing session (entry-only, frozen).
  const dividerSession$ = selectDividerSession(agentIdStore);
  const isDelegatedBackgroundTaskAgent = $derived(isDelegatedBackgroundTaskSession($agentSession$));

  // Retired sessions (PROTOCOL v7.5+, retiredAt set) are read-only: the transcript
  // stays viewable but the composer is replaced with a restore affordance.
  const isRetiredSession = $derived(!!$agentSession$?.retiredAt);

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

  const latestAssistantForTelemetry = $derived.by(() => {
    for (let index = $agentMessages$.length - 1; index >= 0; index -= 1) {
      const message = $agentMessages$[index];
      if (message.role === 'assistant') return message;
    }
    return undefined;
  });

  // Confirm the primary transcript boundary from DOM that exists after the
  // update. Redux values identify the expected row only; they never stand in
  // for a rendered row or error surface.
  $effect(() => {
    const message = latestAssistantForTelemetry;
    if (!message) return;
    const storeStreamState = $agentSessionIsStreaming$ ? 'streaming' : 'idle';
    let cancelled = false;
    void (async () => {
      await tick();
      if (cancelled) return;
      const assistantRow = Array.from(
        panelElement?.querySelectorAll<HTMLElement>('[data-message-role="assistant"]') ?? [],
      ).find((row) => row.dataset.messageId === message.id);
      reportStreamLifecycle({
        stage: 'render',
        event: assistantRow ? 'assistant-message-committed' : 'assistant-message-not-committed',
        turnCorrelation: streamTurnCorrelation(message.id),
        correlationBasis: 'assistant-message',
        blockCount: assistantRow?.querySelectorAll('[data-message-content-block]').length ?? 0,
        storeStreamState,
        callbackResult: assistantRow ? 'delivered' : 'ignored',
      });
    })();
    return () => {
      cancelled = true;
    };
  });

  $effect(() => {
    const shouldObserveError = Boolean(effectiveError || $chatModelUnavailable$);
    const failureCorrelation = $chatFailureCorrelation$;
    if (!shouldObserveError) return;
    let cancelled = false;
    void (async () => {
      await tick();
      if (cancelled) return;
      const terminalErrorVisible = Boolean(
        panelElement?.querySelector('[data-stream-terminal-error="true"]'),
      );
      reportStreamLifecycle({
        stage: 'render',
        event: terminalErrorVisible ? 'terminal-error-committed' : 'terminal-error-not-committed',
        ...failureCorrelation,
        correlationBasis: failureCorrelation?.turnCorrelation
          ? 'assistant-message'
          : failureCorrelation?.turnIdCorrelation
            ? 'turn'
            : 'unjoinable',
        terminalErrorVisible,
        storeStreamState: 'error',
        callbackResult: terminalErrorVisible ? 'delivered' : 'ignored',
      });
    })();
    return () => {
      cancelled = true;
    };
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

  let panelInterestAgentId: string | null = null;

  function activePanelInterestAgentId(): string | null {
    return isActive && agentId && !agentId.startsWith('terminal-') ? agentId : null;
  }

  function transferPanelInterestLease(nextAgentId: string | null): void {
    if (nextAgentId === panelInterestAgentId) return;
    if (nextAgentId) acquireChatInterestLease(nextAgentId, instanceId);
    const previousAgentId = panelInterestAgentId;
    panelInterestAgentId = nextAgentId;
    if (previousAgentId) releaseChatInterestLease(previousAgentId, instanceId);
  }

  let scrollContainer = $state<HTMLDivElement>();
  let composerElement = $state<HTMLDivElement>();
  let composerHeight = $state(0);
  let inputComponent = $state<SimpleRichInput>();
  // Rehydrate the transcript scroll state cached by the previous instance's
  // destroy so a remount keeps the user's reading position instead of
  // re-entering at the bottom.
  // svelte-ignore state_referenced_locally -- mount-time snapshot of the identity props.
  const cachedScroll =
    workspace?.id && agentId ? getCachedChatScroll(workspace.id, agentId) : undefined;
  // Non-null when the previous instance was scrolled away from the bottom;
  // consumed by the entry-scroll paths below instead of scrolling to bottom.
  const cachedScrollRestoreTop =
    cachedScroll && !cachedScroll.shouldFollowBottom ? cachedScroll.scrollTop : null;
  let shouldFollowBottom = $state(cachedScroll?.shouldFollowBottom ?? true);
  let distanceFromBottom = $state(0); // Track actual scroll distance from bottom
  // Full-history user-message index (agent.listUserMessages), fetched when the
  // navigator popover opens and cached for this agent (the panel is keyed per
  // agent). Merged with the tail-derived items — tail wins by id (freshest,
  // incl. streaming) and provides instant content before the fetch resolves;
  // any fetch failure silently leaves the tail-only fallback in place.
  let userMessageIndexItems = $state<UserMessageNavigationItem[] | null>(null);
  let userMessageIndexUnsupported = false;
  let userMessageIndexFetchInFlight = $state(false);
  const userMessageNavigationItems = $derived(
    mergeUserMessageNavigationItems(
      userMessageIndexItems ?? [],
      getUserMessageNavigationItems($agentMessages$),
    ),
  );

  $effect(() => {
    onNavigationStateChange?.({
      isAtBottom: distanceFromBottom <= SCROLL_BOTTOM_BUTTON_EPSILON,
      userMessages: userMessageNavigationItems,
      isLoadingUserMessageIndex: userMessageIndexFetchInFlight && userMessageIndexItems === null,
    });
  });

  function handleBottomStateChange(state: FollowBottomState) {
    distanceFromBottom = state.distanceFromBottom;
    scrollButtonVisibility?.update(state.distanceFromBottom);
    // Keep the cache current before a panel-layout update can recreate this
    // chat and run the replacement instance ahead of our destroy callback.
    if (
      workspace?.id &&
      agentId &&
      scrollContainer &&
      $agentMessages$.length > 0 &&
      canRecordChatScroll(state.isFollowing)
    ) {
      setCachedChatScroll(workspace.id, agentId, {
        scrollTop: scrollContainer.scrollTop,
        shouldFollowBottom: state.isFollowing,
      });
    }
  }
  let scrollButtonVisibility: ReturnType<typeof createScrollBottomButtonVisibility> | null = null;
  // Transient "scroll re-locked" confirmation: a lock icon briefly flashes when
  // scrolling crosses back to the bottom and auto-follow re-engages. Purely
  // decorative (aria-hidden, pointer-events-none) so it can never intercept
  // hover hit-tests or land in the tab order (monorepo#2508).
  let showLockConfirmation = $state(false);
  let lockConfirmationTimer: ReturnType<typeof setTimeout> | null = null;
  const highlightRemovalTimers = new Set<ReturnType<typeof setTimeout>>();
  const activeAnimationFrames = new Set<number>();

  function scheduleHighlightRemoval(element: HTMLElement, className: string, delayMs: number) {
    if (!isActive) return;
    const timer = setTimeout(() => {
      highlightRemovalTimers.delete(timer);
      if (isActive && !isComponentDestroyed) element.classList.remove(className);
    }, delayMs);
    highlightRemovalTimers.add(timer);
  }

  function scheduleActiveAnimationFrame(callback: () => void) {
    if (!isActive) return;
    const frame = requestAnimationFrame(() => {
      activeAnimationFrames.delete(frame);
      if (isActive && !isComponentDestroyed) callback();
    });
    activeAnimationFrames.add(frame);
  }

  $effect(() => {
    if (isActive) return;
    for (const timer of highlightRemovalTimers) clearTimeout(timer);
    highlightRemovalTimers.clear();
    for (const frame of activeAnimationFrames) cancelAnimationFrame(frame);
    activeAnimationFrames.clear();
  });
  const LOCK_CONFIRMATION_DURATION_MS = 1500;

  function flashLockConfirmation(): void {
    if (!isActive) return;
    if (lockConfirmationTimer !== null) clearTimeout(lockConfirmationTimer);
    showLockConfirmation = true;
    lockConfirmationTimer = setTimeout(() => {
      if (!isActive) return;
      showLockConfirmation = false;
      lockConfirmationTimer = null;
    }, LOCK_CONFIRMATION_DURATION_MS);
  }

  $effect(() => {
    if (isActive || lockConfirmationTimer === null) return;
    clearTimeout(lockConfirmationTimer);
    lockConfirmationTimer = null;
    showLockConfirmation = false;
  });

  let lazyTurnHeightCache = $state.raw<LazyTurnHeightCache>(createLazyTurnHeightCache('unbound'));
  let lazyTurnCacheScope = 'unbound';
  let hydratedMessageIds = $state.raw<Set<string>>(new Set());

  function syncHydratedMessageIds() {
    hydratedMessageIds = new Set(messageHydrationPolicy.getHydratedIds());
  }

  // Batch-end callback: one hydratedMessageIds rebuild per policy call, not
  // one per transitioned row (a mass transition would otherwise be O(n²)).
  const messageHydrationPolicy = createMessageHydrationPolicy([], {
    onHydrationChange: syncHydratedMessageIds,
    frameBudgetMs: CHAT_HYDRATION_FRAME_BUDGET_MS,
    maxRowsPerFrame: CHAT_HYDRATION_MAX_ROWS_PER_FRAME,
  });

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

  let pendingSendMessageIds = $state.raw<Set<string>>(new Set());

  function setPendingSendMessage(key: string, pending: boolean): void {
    const next = new Set(pendingSendMessageIds);
    if (pending) next.add(key);
    else next.delete(key);
    pendingSendMessageIds = next;
  }

  // The controller retries matching on its own interval until the match
  // timeout, so a transcript row that appears late (or without a message-count
  // increase) still gets its transition; on timeout the bubble fades out and
  // the row is un-hidden.
  const sendTransitions = createPendingSendTransitions({
    getScrollContainer: () => scrollContainer,
    setRowHidden: setPendingSendMessage,
  });

  function cancelAllSendTransitions(): void {
    sendTransitions.cancelAll();
  }

  function prepareMessageSendTransition(
    text: string,
    options: { enabled: boolean; followBottom: boolean; allowOverlap?: boolean },
  ): string {
    const userAppMessageId = createAppMessageId();
    if (!options.enabled || (!options.allowOverlap && sendTransitions.hasPending())) {
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
    sendTransitions.add(key, { origin, launchBubble, followBottom: options.followBottom });
    return userAppMessageId;
  }

  function startPendingSendTransitions(): boolean {
    return sendTransitions.attemptMatches();
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
      appStore.dispatch(
        openTab(workspace.id, {
          type: 'terminal',
          title: m.layout_tabTypes_terminal_title(),
          terminalId: setupTerminal.id,
          closable: true,
        }),
      );
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
  let hasVisibleTranscriptUtility = $state(false);

  $effect(() => {
    workspace?.id;
    agentId;
    hasVisibleTranscriptUtility = false;
  });

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
    if ($agentIsRunning$ || pendingQuestionRecoveryLoading || $agentMessages$.length === 0) {
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
    return parseSuggestedPromptsFromContentBlocks(lastAssistantMessage.contentBlocks ?? []).prompts;
  });

  // Agent Q&A: the daemon's pending marker is authoritative when present, so
  // its selected question-bearing assistant message stays pending across later
  // rows AND later automatic/user turns until cleared, dismissed, or
  // superseded. Transcript parsing remains the content source; legacy sessions
  // use the daemon's non-system tail rule, gated on the agent's own active
  // turn (NOT the broad running gate — an agent paused on delegated agents has
  // ended its turn and its questions must surface). Both live in
  // deriveWizardPendingQuestions so the regression suite exercises the real
  // production gate.
  const markedQuestionRecovery = $derived.by(() => {
    void $agentMessages$;
    void $agentHistoryMessages$;
    void $agentSession$?.metadata?.pendingQuestionsMessageId;
    void $pendingQuestionRecovery$;
    return deriveMarkedQuestionRecoveryState(appStore.state, agentId);
  });
  const pendingQuestionRecoveryLoading = $derived(
    $transcriptHydration$ === 'settled' && markedQuestionRecovery?.loading === true,
  );
  $effect(() => {
    if ($agentSession$?.id !== agentId) return;
    const marker = classifyPendingQuestionMarker(
      $agentSession$?.metadata?.pendingQuestionsMessageId,
    );
    const tracked = $pendingQuestionRecovery$;
    if (marker.kind !== 'set') {
      if (tracked) appStore.dispatch(pendingQuestionRecoveryCleared(agentId));
      return;
    }
    if ($transcriptHydration$ === 'settled' && markedQuestionRecovery?.shouldRequest) {
      appStore.dispatch(pendingQuestionRecoveryRequested(agentId, marker.messageId));
    }
  });

  const pendingQuestions = $derived.by(() => {
    const hasUserMessage = $agentMessages$.some((m) => m.role === 'user');
    const showingPendingUserMessage = !!pendingMessage && !hasUserMessage;
    // Reading $agentIsResponding$ keeps this $derived reactive to gate flips
    // that do not change the transcript; the dismissal marker read keeps it
    // reactive to metadata-only session updates (optimistic dismiss /
    // agent:updated); the shared helper re-reads both from store state.
    void $agentIsResponding$;
    void $agentSession$?.metadata?.dismissedQuestionsMessageId;
    void $agentSession$?.metadata?.pendingQuestionsMessageId;
    void $pendingQuestionRecovery$;
    return deriveWizardPendingQuestions(
      appStore.state,
      agentId,
      $agentMessages$,
      showingPendingUserMessage,
    );
  });

  // Collapsed (Hide) state is host-owned and persisted per question set
  // alongside the answer draft. A newly pending set starts from its persisted
  // value when one exists; otherwise it auto-collapses when the composer
  // holds in-flight user input (text or attachments) so the input textbox is
  // never replaced mid-typing — Hide semantics only, nothing is dismissed.
  // Resolved in a $derived (not a post-render $effect) so the very first
  // render of a newly pending set already sees the collapsed value — an
  // effect would run after the DOM update, transiently unmounting the
  // composer (losing editor focus/selection/IME composition) before
  // collapsing. The initial resolution is latched per messageId in a
  // non-reactive cache so it is decided once per set; user toggles override
  // it reactively.
  let wizardCollapsedInitial: { messageId: string; collapsed: boolean } | null = null;
  let questionWizardCollapsedOverride = $state<{ messageId: string; collapsed: boolean } | null>(
    null,
  );
  const questionWizardCollapsed = $derived.by(() => {
    const id = pendingQuestions?.messageId ?? null;
    if (id === null) return false;
    if (questionWizardCollapsedOverride?.messageId === id) {
      return questionWizardCollapsedOverride.collapsed;
    }
    if (wizardCollapsedInitial?.messageId !== id) {
      wizardCollapsedInitial = {
        messageId: id,
        collapsed: untrack(() =>
          initialWizardCollapsed(
            wizardDraftKey(agentId, id),
            inputValue.trim() !== '' || contextItems.length > 0,
          ),
        ),
      };
    }
    return wizardCollapsedInitial.collapsed;
  });

  // Queue entries the user should see: user-authored ones only. Daemon-origin
  // entries (agent sends, event wakes, hook wakes, PR-monitor wakes,
  // `questions_dismissed`, `source: 'system'`, unknown types) stay hidden —
  // the list, its count, and the up-arrow edit path all use this filtered
  // view (display-only; the daemon queue and drain order are untouched).
  const visibleQueuedMessages = $derived($queuedMessages$.filter(isUserQueuedMessage));

  // Queue visibility around the wizard: hidden while the wizard is expanded,
  // shown while Ignore-collapsed. Derivation shared with the regression suite.
  const queuedMessagesVisibility = $derived(
    deriveQueuedMessagesVisibility({
      queueLength: visibleQueuedMessages.length,
      hasPendingQuestions: !!pendingQuestions,
      questionWizardCollapsed,
    }),
  );
  const transcriptBottomInsetClass = $derived(
    chatTranscriptBottomInsetClass({
      isChiefWorkspace,
      isCompactMode,
      // Mirrors the render gate: retired sessions hide the queue block.
      showQueue: queuedMessagesVisibility.showQueue && !isRetiredSession,
    }),
  );

  // Dismiss = persistent, unlike Ignore: the mutation middleware stamps
  // `dismissedQuestionsMessageId` into session metadata optimistically (the
  // wizard-gate reads it, so the wizard hides immediately) and forwards
  // `agent.dismissQuestions` — the daemon persists the marker (survives
  // reload) and clears the pending question set, so the sticky wizard stays
  // hidden across later turns. On failure the middleware rolls
  // the metadata back, so the wizard re-surfaces, and surfaces the error toast.
  // Returns the action promise so the wizard clears its stored draft only
  // after the dismissal is confirmed (a failure keeps the draft).
  async function handleQuestionWizardDismiss(): Promise<void> {
    if (!workspace || !pendingQuestions) return;
    const action = agentSessionDismissQuestionsRequested(
      agentId,
      workspace.id,
      pendingQuestions.messageId,
    );
    appStore.dispatch(action);
    await action.promise;
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

  const pendingProposalRefs = $derived(
    classifyPendingProposalRefs($agentSession$?.metadata?.pendingProposals),
  );

  // Targeted recovery for refs whose carrying message is not hydrated
  // (mirrors the marked-question recovery): request each missing messageId
  // once the transcript settles; prune cache entries for refs that left the
  // metadata so resolved proposals do not pin stale recoveries.
  const pendingProposalRecoveryRequests = $derived.by(() => {
    void $agentMessages$;
    void $agentHistoryMessages$;
    void $agentSession$?.metadata?.pendingProposals;
    void $pendingProposalRecovery$;
    void $proposalLifecycleMap$;
    return derivePendingProposalRecoveryState(appStore.state, agentId);
  });
  $effect(() => {
    if ($agentSession$?.id !== agentId) return;
    const refs = pendingProposalRefs;
    const tracked = $pendingProposalRecovery$;
    const keep = [...new Set(refs.map((ref) => ref.messageId))];
    if (tracked && Object.keys(tracked).some((messageId) => !keep.includes(messageId))) {
      appStore.dispatch(pendingProposalRecoveryPruned(agentId, keep));
    }
    if (refs.length === 0 || $transcriptHydration$ !== 'settled') return;
    for (const request of pendingProposalRecoveryRequests) {
      if (request.shouldRequest) {
        appStore.dispatch(pendingProposalRecoveryRequested(agentId, request.messageId));
      }
    }
  });

  // Apply→resolve bridge. Applies key lifecycle under
  // `getProposalId(proposal)` — which can differ from the daemon's metadata
  // ref key. Inline proposal hosts capture the ref→local identity while they
  // are rendered. Any still-pending metadata ref
  // whose lifecycle shows 'applied' under either identity gets ONE
  // resolve(applied) (daemon resolution is idempotent; first outcome wins).
  $effect(() => {
    const wsId = workspace?.id;
    if (!wsId || $agentSession$?.id !== agentId) return;
    reconcileAppliedProposals({
      agentId,
      workspaceId: wsId,
      refs: pendingProposalRefs,
      lifecycle: $proposalLifecycleMap$ ?? {},
    });
  });

  // Search state
  let showSearch = $state(false);
  let searchQuery = $state('');
  // Debounced copy of searchQuery — drives the expensive match derivation so
  // intermediate keystrokes don't trigger a full rewalk + turn re-render cascade.
  let debouncedSearchQuery = $state('');
  let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  type PendingSearchWork = { bindingKey: string };
  let pendingSearchWork: PendingSearchWork | null = null;
  const SEARCH_DEBOUNCE_MS = 150;
  // Number of match-neighbors (before + after the current index) to force-render
  // via LazyTurn in addition to the current match's turn. Keeps initial search
  // responsive even when a query matches hundreds of turns.
  const SEARCH_NEIGHBOR_COUNT = 1;
  let searchInputRef: HTMLInputElement | null = $state(null);
  let panelElement: HTMLElement | null = $state(null);
  let currentSearchIndex = $state(0);
  let searchOpenedDisclosures: Array<{ messageId: string; disclosureId: string }> = [];
  let searchHighlightRequest = 0;

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
    onDrop: (drop) => void inputComponent?.handleDroppedFiles?.(drop),
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
      onDrop: (drop: DropSplit) => void inputComponent?.handleDroppedFiles?.(drop),
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
  // Additionally, completed content groups are indexed with disclosure paths.
  // Search can temporarily reveal the exact group that owns a match, then
  // restore only the disclosure state that search changed.
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

  async function restoreSearchDisclosures(
    container: HTMLDivElement | undefined,
    keepMessageId: string | undefined,
    keep: ReadonlySet<string>,
  ) {
    if (!isActive) return;
    if (!container) return;
    const remaining: Array<{ messageId: string; disclosureId: string }> = [];
    for (const opened of [...searchOpenedDisclosures].reverse()) {
      if (opened.messageId === keepMessageId && keep.has(opened.disclosureId)) {
        remaining.unshift(opened);
        continue;
      }
      const message = container.querySelector(
        `[data-message-id="${CSS.escape(opened.messageId)}"]`,
      );
      const disclosure = message?.querySelector(
        `[data-chat-search-disclosure-id="${CSS.escape(opened.disclosureId)}"]`,
      );
      if (disclosure) requestSearchDisclosure(disclosure, false);
      await tick();
      if (!isActive) return;
    }
    searchOpenedDisclosures = remaining;
  }

  async function revealSearchMatch(
    match: ChatSearchMatch | undefined,
    container: HTMLDivElement | undefined,
  ) {
    if (!isActive) return;
    const required = new Set(match?.disclosurePath ?? []);
    await restoreSearchDisclosures(container, match?.messageId, required);
    if (!isActive || !match || !container) return;
    const message = container.querySelector(`[data-message-id="${CSS.escape(match.messageId)}"]`);
    if (!message) return;
    for (const id of match.disclosurePath) {
      const disclosure = message.querySelector(
        `[data-chat-search-disclosure-id="${CSS.escape(id)}"]`,
      );
      if (!disclosure) continue;
      if (disclosure.getAttribute('data-chat-search-expanded') !== 'true') {
        requestSearchDisclosure(disclosure, true);
        if (
          !searchOpenedDisclosures.some(
            (opened) => opened.messageId === match.messageId && opened.disclosureId === id,
          )
        ) {
          searchOpenedDisclosures.push({ messageId: match.messageId, disclosureId: id });
        }
        await tick();
        if (!isActive) return;
        await new Promise(requestAnimationFrame);
        if (!isActive) return;
      }
    }
  }

  // Trigger highlighting after LazyTurn materialization and disclosure reveal.
  async function triggerHighlight() {
    if (!isActive) return;
    const request = ++searchHighlightRequest;
    const query = untrack(() => debouncedSearchQuery);
    const index = untrack(() => currentSearchIndex);
    const isShowing = untrack(() => showSearch);
    const matches = untrack(() => allSearchMatches);
    const container = untrack(() => scrollContainer);
    await tick();
    if (!isActive || request !== searchHighlightRequest) return;
    await revealSearchMatch(isShowing ? matches[index] : undefined, container);
    if (!isActive || request !== searchHighlightRequest) return;
    await tick();
    if (!isActive) return;
    await new Promise(requestAnimationFrame);
    if (!isActive || request !== searchHighlightRequest) return;
    doHighlightSearchMatches(query, index, matches, isShowing, container);
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

    // Index materialized messages once. Only the active match's search-owned
    // disclosure ancestors need to be present.
    const messageElById = new Map<string, Element>();
    for (const el of container.querySelectorAll('[data-message-id]')) {
      const id = (el as HTMLElement).dataset.messageId;
      if (id && !messageElById.has(id)) messageElById.set(id, el);
    }

    const matchesByBlock = new Map<
      string,
      Array<{ match: ChatSearchMatch; globalIndex: number }>
    >();
    matches.forEach((match, globalIndex) => {
      const key = `${match.messageId}\u0000${match.blockPath}`;
      const group = matchesByBlock.get(key) ?? [];
      group.push({ match, globalIndex });
      matchesByBlock.set(key, group);
    });

    for (const blockMatches of matchesByBlock.values()) {
      const first = blockMatches[0].match;
      const messageEl = messageElById.get(first.messageId);
      if (!messageEl) continue;
      const selector = `[data-chat-search-block-path="${CSS.escape(first.blockPath)}"]`;
      const blockEl = first.blockPath
        ? messageEl.matches(selector)
          ? messageEl
          : messageEl.querySelector(selector)
        : messageEl;
      if (!blockEl) continue;

      const walker = document.createTreeWalker(blockEl, NodeFilter.SHOW_TEXT, {
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
      const maxOccurrence = Math.max(...blockMatches.map(({ match }) => match.occurrenceInBlock));
      const rangesByOccurrence: Range[] = [];
      let searchPos = 0;
      while (rangesByOccurrence.length <= maxOccurrence) {
        const hit = lowerFullText.indexOf(lowerQuery, searchPos);
        if (hit === -1) break;
        const hitEnd = hit + lowerQuery.length;
        const range = createRangeForSpan(textNodes, nodeStarts, hit, hitEnd);
        if (range) rangesByOccurrence.push(range);
        searchPos = hitEnd;
      }

      for (const { match, globalIndex } of blockMatches) {
        const range = rangesByOccurrence[match.occurrenceInBlock];
        if (!range) continue;
        if (globalIndex === currentIndex) currentRange = range;
        else allRanges.push(range);
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
    pendingSearchWork = null;
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
    pendingSearchWork = null;
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
  function searchBindingKey(): string {
    return `${workspace?.id ?? ''}\u0000${agentId ?? ''}`;
  }

  function armPendingSearch(work: PendingSearchWork) {
    if (searchDebounceTimer !== null) return;
    const timer = setTimeout(() => {
      if (searchDebounceTimer !== timer) return;
      searchDebounceTimer = null;
      if (
        isComponentDestroyed ||
        !isActive ||
        !showSearch ||
        pendingSearchWork !== work ||
        work.bindingKey !== searchBindingKey()
      ) {
        return;
      }
      pendingSearchWork = null;
      if (debouncedSearchQuery === searchQuery) return;
      debouncedSearchQuery = searchQuery;
      triggerHighlight();
    }, SEARCH_DEBOUNCE_MS);
    searchDebounceTimer = timer;
  }

  function handleSearchInput() {
    if (!isActive) return;
    currentSearchIndex = 0;
    if (debouncedSearchQuery !== searchQuery) searchHighlightRequest += 1;
    if (searchDebounceTimer !== null) {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = null;
    }
    pendingSearchWork = null;
    if (!searchQuery.trim()) {
      debouncedSearchQuery = '';
      triggerHighlight();
      return;
    }
    if (debouncedSearchQuery === searchQuery) return;
    const work = { bindingKey: searchBindingKey() };
    pendingSearchWork = work;
    armPendingSearch(work);
  }

  function openSearchFromSelection() {
    if (!isActive) return;
    const selectedText = getSelectedTextWithinSurface(panelElement);

    if (selectedText) {
      if (searchDebounceTimer !== null) {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = null;
      }
      pendingSearchWork = null;
      searchQuery = selectedText;
      debouncedSearchQuery = selectedText;
      currentSearchIndex = 0;
    }

    showSearch = true;
    tick().then(() => {
      if (!isActive) return;
      searchInputRef?.focus();
      searchInputRef?.select();
      if (selectedText) triggerHighlight();
    });
  }

  // svelte-ignore state_referenced_locally -- identity snapshot is refreshed by the effect below.
  let lastSearchBindingKey = searchBindingKey();
  $effect(() => {
    const bindingKey = searchBindingKey();
    if (bindingKey !== lastSearchBindingKey) {
      lastSearchBindingKey = bindingKey;
      searchHighlightRequest += 1;
      if (searchDebounceTimer !== null) clearTimeout(searchDebounceTimer);
      searchDebounceTimer = null;
      pendingSearchWork = null;
      return;
    }
    if (!isActive) {
      searchHighlightRequest += 1;
      if (searchDebounceTimer !== null) clearTimeout(searchDebounceTimer);
      searchDebounceTimer = null;
      return;
    }
    const work = pendingSearchWork;
    if (!work) return;
    if (!showSearch || searchQuery === debouncedSearchQuery || work.bindingKey !== bindingKey) {
      pendingSearchWork = null;
      return;
    }
    armPendingSearch(work);
  });

  // Context items for the input
  let contextItems = $state<ContextItem[]>([]);

  // Input value
  let inputValue = $state(
    untrack(() =>
      workspace?.id ? selectChatDraft.select(appStore.state, workspace.id, agentId) : '',
    ),
  );

  type PendingDraftWrite = { workspaceId: string; agentId: string; draft: string };
  let pendingDraftWrite: PendingDraftWrite | null = null;

  function flushPendingDraftWrite(): void {
    const pending = pendingDraftWrite;
    pendingDraftWrite = null;
    if (pending) {
      appStore.dispatch(setChatDraft(pending.workspaceId, pending.agentId, pending.draft));
    }
  }

  function commitDraftWrite(draft: string): void {
    const workspaceId = workspace?.id;
    if (!workspaceId || !agentId) return;
    pendingDraftWrite = null;
    appStore.dispatch(setChatDraft(workspaceId, agentId, draft));
  }

  function scheduleDraftWrite(draft: string): void {
    const workspaceId = workspace?.id;
    if (!workspaceId || !agentId) return;
    pendingDraftWrite = { workspaceId, agentId, draft };
  }

  // svelte-ignore state_referenced_locally -- identity snapshot is refreshed by the effect below.
  let lastDraftBindingKey = `${workspace?.id ?? ''}\u0000${agentId ?? ''}`;
  $effect(() => {
    const bindingKey = `${workspace?.id ?? ''}\u0000${agentId ?? ''}`;
    if (bindingKey === lastDraftBindingKey) return;
    flushPendingDraftWrite();
    lastDraftBindingKey = bindingKey;
  });

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
   * Check if a message is automated (system-initiated, not user-typed).
   * Delegates to the pure helper in previous-user-message.ts: string
   * metadata.type (except the user-authored `question_answers` tag),
   * non-empty fromAgentId, or source === 'system' — plus the legacy
   * text-prefix fallback for messages that lost metadata.
   */
  function isAutomatedMessage(message: AgentMessage): boolean {
    return isAutomatedChatMessage(message);
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
    active: () => isActive,
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

  $effect(() => {
    const captures = $pendingBrowserElementCaptures$;
    const workspaceId = workspace?.id;
    if (!workspaceId || !agentId || !isActive || captures.length === 0) return;

    const targeted = captures.filter((capture) => browserCaptureTargetsAgent(capture, agentId));
    if (targeted.length === 0) return;

    untrack(() => {
      const existingIds = new Set(contextItems.map((item) => item.id));
      const additions = targeted
        .flatMap(browserCaptureToContextItems)
        .filter((item) => !existingIds.has(item.id));
      if (additions.length > 0) contextItems = [...contextItems, ...additions];
    });
    for (const capture of targeted) {
      appStore.dispatch(clearBrowserElementCapture(workspaceId, capture.id));
    }
    void tick().then(() => inputComponent?.focus?.());
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

    flushPendingSelectionWrites();
    const panels = availablePanelContexts;
    untrack(() => {
      appStore.dispatch(setMultiPanelWorkspace(workspaceId));
      appStore.dispatch(updateMultiPanels(panels));
    });
  });

  // Sync selection context from editors to multi-panel context Redux store
  // Listen for the custom 'editor:selection-change' event dispatched by CodeEditor and TipTap
  // Editors dispatch 'editor:selection-change' custom events which we sync to Redux
  type PendingSelectionWrite =
    | {
        kind: 'set';
        key: string;
        selection: Omit<Parameters<typeof setMultiPanelSelection>[0], never>;
      }
    | { kind: 'clear'; key: string; panelId: string; tabId: string };
  let pendingSelectionWrites = new Map<string, PendingSelectionWrite>();
  let pendingSelectionFrame: number | null = null;

  function flushPendingSelectionWrites(): void {
    if (pendingSelectionFrame !== null) {
      cancelAnimationFrame(pendingSelectionFrame);
      pendingSelectionFrame = null;
    }
    const pending = pendingSelectionWrites;
    pendingSelectionWrites = new Map();
    for (const update of pending.values()) {
      if (update.kind === 'set') {
        appStore.dispatch(setMultiPanelSelection(update.selection));
      } else {
        appStore.dispatch(clearMultiPanelSelection(update.panelId, update.tabId));
      }
    }
  }

  function scheduleSelectionWrite(update: PendingSelectionWrite): void {
    pendingSelectionWrites.set(update.key, update);
    if (pendingSelectionFrame !== null) return;
    pendingSelectionFrame = requestAnimationFrame(() => {
      pendingSelectionFrame = null;
      flushPendingSelectionWrites();
    });
  }

  $effect(() => {
    if (isActive) return;
    flushPendingDraftWrite();
    flushPendingSelectionWrites();
  });

  $effect(() => {
    if (!isActive) return;
    const handleSelectionChange = (
      event: CustomEvent<{ text: string; file?: string; language?: string; source: string }>,
    ) => {
      const { text, file, language } = event.detail;
      // We use a synthetic panelId based on the file path since the legacy store
      // doesn't track panel info - this ensures selections show up in the picker
      const panelId = file || 'unknown';
      const tabId = file || 'selection';
      const key = `${panelId}\u0000${tabId}`;

      if (text?.trim()) {
        // Add selection to multi-panel context store
        // Detect if this is from a note (markdown) vs a code file
        const isNote = language === 'markdown' && !file?.includes('/');
        scheduleSelectionWrite({
          kind: 'set',
          key,
          selection: {
            panelId,
            tabId,
            sourceType: isNote ? 'note' : 'file',
            sourceLabel: file?.split('/').pop() || m.chat_chatPanel_selection_fallback(),
            filePath: isNote ? undefined : file,
            text: text,
            language: language,
            timestamp: Date.now(),
          },
        });
      } else {
        // Clear the selection when text is deselected
        // This event is only dispatched when editor.isFocused is true (user clicked within the editor)
        // so it won't clear when user clicks on chat input to send
        scheduleSelectionWrite({ kind: 'clear', key, panelId, tabId });
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

  // Transcript reveal deferral: keep the indeterminate skeleton up until the
  // resubscribe snapshot applies (or the saga-owned bounded recovery clears
  // the gate). Utility-footer reads populate independently after reveal.
  const deferTranscriptReveal = $derived(
    shouldDeferTranscriptReveal({
      awaitingSwitchBackSnapshot: $awaitingSwitchBackSnapshot$,
      transcriptHydratedOnce: $transcriptHydratedOnce$,
      hasPendingInitialPrompt: Boolean(pendingInitialPrompt),
    }),
  );

  // The utility stack never precedes the transcript. Once transcript hydration
  // settles, each footer source owns its loading/failure/empty presentation.
  const showTranscriptUtilityCard = $derived(
    shouldShowTranscriptUtilityStack({
      transcriptHydratedOnce: $transcriptHydratedOnce$,
      hydrationSettled: $transcriptHydration$ === 'settled',
      revealDeferred: deferTranscriptReveal,
    }),
  );
  const taskProgressItems = $derived(
    showTranscriptUtilityCard
      ? deriveTaskProgress({
          initialized: $workspaceTasksInitialized$,
          tasks: $workspaceTasks$,
          session: $agentSession$ ?? null,
          messages: [...$agentHistoryMessages$, ...$agentMessages$],
        })
      : [],
  );

  $effect(() => {
    onTaskProgressChange?.(taskProgressItems);
  });

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
  const providerCatalogLoaded$ = selectProviderCatalogLoaded();

  // Provider ID for the input — resolved from the agent session
  let inputProviderId = $derived.by(() => {
    if (!$agentSession$) return undefined;
    return getAgentProvider($agentSession$, $catalogDefaultProviderId$);
  });

  // Provider auth-failure login guidance: when the chat error matches the
  // provider's catalog auth-error patterns, StreamingStatus shows the login
  // command hint (and the claude-code desktop-app caveat) alongside the error.
  const chatAuthGuidance = $derived.by(() => {
    if (!effectiveError) return null;
    // Depend on the loaded flag (false → true on hydration): an error
    // rendered before `providers.catalog` lands recomputes once it does —
    // the default-provider-id string alone may not change on hydration.
    void $providerCatalogLoaded$;
    void $catalogDefaultProviderId$;
    return selectProviderAuthFailureGuidance.select(
      appStore.state,
      $agentSession$?.provider,
      $agentSession$?.model,
      effectiveError,
    );
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

  // Grouped messages for display: scrollback history segment + live tail.
  // With no history hydrated this is exactly the old tail-only grouping.
  // NOTE: transcript search, sticky headers, pinned prompts, message
  // navigation, and the unread divider intentionally keep operating on the
  // tail ($agentMessages$) only for this iteration — history rows render but
  // are not indexed by those features.
  const composedTranscript = $derived(
    composeTranscript($agentHistoryMessages$, $agentMessages$, $historySegmentMeta$.gapToTail),
  );
  let groupedMessages = $derived(composedTranscript.groups);
  // Index of the first tail group when the history→tail hole is open; the
  // gap affordance renders immediately before this group.
  const historyGapBeforeGroupIndex = $derived(composedTranscript.gapBeforeGroupIndex);
  // True only when the conversation's TRUE START is resident — gates the
  // top-of-transcript workspace intro card so it never renders mid-history
  // (falsely signalling "you've reached the beginning" while older rows
  // still exist above the resident window).
  const conversationStartLoaded = $derived(
    isConversationStartLoaded({
      exhausted: $historyExhausted$,
      historyCount: $agentHistoryMessages$.length,
      tailCount: $agentMessages$.length,
      tailTruncated: $transcriptSnapshotMeta$?.truncated === true || $agentTailCapPruned$,
      totalMessages: $transcriptSnapshotMeta$?.totalMessages ?? 0,
    }),
  );

  // ── Infinite scrollback triggers + no-jump prepend anchoring ──────────
  // Near-top px distance that requests one older-history page.
  const SCROLLBACK_TOP_THRESHOLD_PX = 240;

  function maybeRequestOlderHistory() {
    const container = scrollContainer;
    if (!isActive || !container || !workspace?.id || !agentId) return;
    // A far-flick seek owns the transcript while in flight / landing: its
    // landing REPLACES the segment, so no serial page may race it.
    if ($fetchingHistorySeek$ || seekLandingPending) return;
    const request = shouldRequestOlderHistory({
      scrollTop: container.scrollTop,
      threshold: SCROLLBACK_TOP_THRESHOLD_PX,
      canScroll: container.scrollHeight > container.clientHeight,
      fetching: $fetchingOlderHistory$,
      exhausted: $historyExhausted$,
      historyCount: $agentHistoryMessages$.length,
      tailCount: $agentMessages$.length,
      tailTruncated: $transcriptSnapshotMeta$?.truncated === true || $agentTailCapPruned$,
      totalMessages: $transcriptSnapshotMeta$?.totalMessages ?? 0,
      // Any viewport position inside the virtual spacer (reached by dragging
      // the scrollbar thumb up) drives the same older-history walk.
      spacerAbove: virtualSpacerHeight,
    });
    if (request) appStore.dispatch(olderHistoryPageRequested(workspace.id, agentId));
  }

  // ── Far-flick seek: jump instead of serial page walk ───────────────────
  // A scroll position deep inside a virtual spacer (more than
  // SCROLLBACK_SEEK_NEAR_PAGES pages from the resident edge) maps to a
  // target ordinal and — once the thumb settles for SEEK_DEBOUNCE_MS — fires
  // ONE aroundIndex seek that replaces the history segment with the landing
  // page (saga: historySeekWorker). Near-edge positions keep today's serial
  // chaining. Daemons without aroundIndex latch historySeekUnsupported and
  // everything falls back to the serial walk. The debounce IS the rapid
  // classification window: "rapid" means "moving faster than one settle
  // window can absorb", so the two are the same constant by construction.
  const SEEK_DEBOUNCE_MS = RAPID_SCROLL_WINDOW_MS;
  let seekDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  // Set from debounce fire until the landing is applied: suppresses the
  // serial trigger, the prepend anchor restore, and the frozen-phase
  // absorption (the landing handler owns spacers + scroll position).
  let seekLandingPending = false;
  let pendingSeekTargetOrdinal: number | null = null;

  // Estimated unloaded-row split for the current segment (above vs below).
  function currentUnloadedSplit(): { above: number; below: number } {
    return splitUnloadedRows({
      totalMessages: $transcriptSnapshotMeta$?.totalMessages ?? 0,
      residentCount: $agentHistoryMessages$.length + $agentMessages$.length,
      exhausted: $historyExhausted$,
      startOrdinalEstimate: $historySegmentMeta$.startOrdinalEstimate,
      gapToTail: $historySegmentMeta$.gapToTail,
      holeRowsEstimate: $historySegmentMeta$.holeRowsEstimate,
    });
  }

  /**
   * Target ordinal (0-based from oldest) for a scroll position that
   * classifies as a far-flick seek, or null for near/resident positions
   * (serial paths apply). Covers both spacers: the above-spacer maps into
   * `[0, unloadedAbove)`; the below-spacer (open gap) maps into the hole's
   * ordinal range after the history segment.
   */
  function seekTargetOrdinalAt(scrollTop: number): number | null {
    if ($historySeekUnsupported$ || !workspace?.id || !agentId) return null;
    const total = $transcriptSnapshotMeta$?.totalMessages ?? 0;
    if (total <= 0) return null;
    const split = currentUnloadedSplit();
    if (scrollTop < virtualSpacerHeight) {
      const kind = classifyScrollbackGesture({
        scrollTop,
        spacerAboveHeight: virtualSpacerHeight,
        rowHeightEstimate: spacerRowHeightEma,
      });
      if (kind !== 'seek') return null;
      return mapScrollTopToOrdinal({
        scrollTop,
        spacerAboveHeight: virtualSpacerHeight,
        unloadedRowsAbove: split.above,
      });
    }
    // Below-spacer region (open history→tail hole): same near/far rule
    // against the hole's top edge, mapped into the hole's ordinal range.
    if (virtualSpacerBelowHeight > 0 && split.below > 0 && belowSpacerEl && scrollContainer) {
      const containerTop = scrollContainer.getBoundingClientRect().top;
      const spacerTop =
        belowSpacerEl.getBoundingClientRect().top - containerTop + scrollContainer.scrollTop;
      const intoSpacer = scrollTop - spacerTop;
      if (intoSpacer < 0 || intoSpacer > virtualSpacerBelowHeight) return null;
      const kind = classifyScrollbackGesture({
        scrollTop: virtualSpacerBelowHeight - intoSpacer,
        spacerAboveHeight: virtualSpacerBelowHeight,
        rowHeightEstimate: spacerRowHeightEma,
      });
      if (kind !== 'seek') return null;
      const fraction = Math.min(1, Math.max(0, intoSpacer / virtualSpacerBelowHeight));
      // Hole start ordinal = rows above the segment + the segment itself —
      // `split.above` covers both seek-seeded (start-ordinal-anchored) and
      // serial-walk (hole-estimate-anchored) segments.
      const holeStart = split.above + $agentHistoryMessages$.length;
      return Math.min(total - 1, holeStart + Math.floor(fraction * split.below));
    }
    return null;
  }

  /**
   * Viewport ∩ below-spacer test (the downward DEAD ZONE): a settled
   * position inside the below spacer that classified 'serial' has no other
   * driver — too far below the gap sentinel's rootMargin, too near the
   * hole's top edge for a seek. When it overlaps, a bounded forward gap
   * refill fires instead: each page appends at the hole's top and shrinks
   * the hole, so the chain converges onto the parked viewport (and never
   * re-seeks on estimate error).
   */
  function viewportOverlapsBelowSpacer(): boolean {
    const container = scrollContainer;
    if (!container || !$historySegmentMeta$.gapToTail) return false;
    if (virtualSpacerBelowHeight <= 0 || !belowSpacerEl) return false;
    const top =
      belowSpacerEl.getBoundingClientRect().top -
      container.getBoundingClientRect().top +
      container.scrollTop;
    return (
      container.scrollTop < top + virtualSpacerBelowHeight &&
      container.scrollTop + container.clientHeight > top
    );
  }

  /**
   * True when the viewport sits ENTIRELY below the open history→tail hole
   * (gap affordance + below spacer) — the user is back on the live tail.
   */
  function viewportFullyBelowOpenHole(): boolean {
    const container = scrollContainer;
    if (!container || !$historySegmentMeta$.gapToTail) return false;
    if ($agentHistoryMessages$.length === 0) return false;
    const edge = belowSpacerEl ?? historyGapSentinel;
    if (!edge) return false;
    const bottomDoc =
      edge.getBoundingClientRect().bottom -
      container.getBoundingClientRect().top +
      container.scrollTop;
    return container.scrollTop >= bottomDoc;
  }

  /**
   * Return-to-tail collapse: a settled viewport fully below the open hole
   * is reading the live tail, so the detached segment above it (and its
   * Load-more affordance + below spacer) is a phantom gap that would
   * persist forever — no downward driver can close a hole the user already
   * jumped over. Drop the segment wholesale (`clearHistorySegment`; the
   * saga watcher resets both walk cursors) and zero both spacers in the
   * same flush; the prepend-anchoring effect captures a visible tail row
   * before the DOM updates and restores its viewport offset after (native
   * clamp when the capture was skipped near the bottom), so the removal
   * never moves the reading position. An upward scroll afterwards re-arms
   * the serial walk from scratch (fresh anchored seek at the tail's oldest
   * row). Returns true when the segment was dropped.
   */
  function maybeCollapseHistorySegmentAtTail(): boolean {
    if (!isActive || !workspace?.id || !agentId) return false;
    if ($fetchingOlderHistory$ || $fetchingGapFill$) return false;
    if ($fetchingHistorySeek$ || seekLandingPending) return false;
    if (!viewportFullyBelowOpenHole()) return false;
    virtualSpacerHeight = 0;
    virtualSpacerBelowHeight = 0;
    appStore.dispatch(clearHistorySegment(agentId));
    return true;
  }

  function cancelSeekDebounce() {
    if (seekDebounceTimer !== null) {
      clearTimeout(seekDebounceTimer);
      seekDebounceTimer = null;
    }
  }

  /**
   * Settle-point re-classification (the 'seek' arm of
   * classifySettledPosition, DOM-side): map the settled scrollTop through
   * seekTargetOrdinalAt — the same near/far classification over both
   * spacers — and dispatch ONE aroundIndex jump when the parked position is
   * still far from resident rows. Called at EVERY settle point (the seek
   * debounce firing, an older-history page settling, a gap-fill page
   * settling) so a chain never keeps serially walking toward a far target.
   * Returns true when a seek was dispatched (the caller stops its chain).
   */
  function maybeDispatchSettledSeek(): boolean {
    if (!isActive || isComponentDestroyed || !scrollContainer || !workspace?.id || !agentId)
      return false;
    if ($fetchingHistorySeek$ || seekLandingPending) return false;
    if ($fetchingOlderHistory$ || $fetchingGapFill$) return false;
    const target = seekTargetOrdinalAt(scrollContainer.scrollTop);
    if (target === null) return false;
    cancelSeekDebounce();
    seekLandingPending = true;
    pendingSeekTargetOrdinal = target;
    appStore.dispatch(historySeekRequested(workspace.id, agentId, target));
    return true;
  }

  // (Re)arm the settle debounce; the target is recomputed at fire time from
  // the settled scrollTop, so intermediate drag positions never fire.
  function armSeekDebounce() {
    cancelSeekDebounce();
    if (!isActive) return;
    seekDebounceTimer = setTimeout(() => {
      seekDebounceTimer = null;
      if (!isActive || isComponentDestroyed || !scrollContainer || !workspace?.id || !agentId)
        return;
      if ($fetchingHistorySeek$ || seekLandingPending) return;
      // Racing serial fetch: let it settle — the settle chains call
      // maybeDispatchSettledSeek and re-classify the parked position.
      if ($fetchingOlderHistory$ || $fetchingGapFill$) return;
      if (maybeDispatchSettledSeek()) return;
      // Settled without a far target: the below drivers decide. Fully
      // below the hole collapses the segment (return-to-tail); a
      // dead-zone overlap with the below spacer chains a bounded forward
      // gap refill; otherwise the near-top serial trigger applies.
      if (maybeCollapseHistorySegmentAtTail()) return;
      if (viewportOverlapsBelowSpacer()) {
        requestHistoryGapFill();
        return;
      }
      maybeRequestOlderHistory();
    }, SEEK_DEBOUNCE_MS);
  }

  // Seek settle: the saga replaced the segment (or failed / latched
  // unsupported). Size both spacers for the seeded segment and put the
  // target ordinal mid-viewport — the landing owns positioning, so the
  // anchor-restore and absorption effects were suppressed for this update.
  let wasFetchingHistorySeek = false;
  $effect(() => {
    const fetching = $fetchingHistorySeek$;
    if (!isActive) {
      wasFetchingHistorySeek = fetching;
      return;
    }
    const settled = wasFetchingHistorySeek && !fetching;
    wasFetchingHistorySeek = fetching;
    if (!settled) return;
    tick().then(() => {
      if (!isActive || isComponentDestroyed || !scrollContainer) return;
      // Discard raced this settle: the dispatch that cleared
      // fetchingHistorySeek was a resumed:false reset, not a landing. The
      // discard effect below owns the viewport (followToBottom on this
      // same tick, one microtask later) — the failed-seek fallback must
      // not dispatch an older-history page against the scrollTop the
      // just-zeroed spacers clamped to an arbitrary position.
      if (discardReanchorPending) return;
      const target = pendingSeekTargetOrdinal;
      pendingSeekTargetOrdinal = null;
      seekLandingPending = false;
      const startOrdinal = $historySegmentMeta$.startOrdinalEstimate;
      if (target === null || startOrdinal === null) {
        // Failed or unsupported seek: nothing landed. Fall back to the
        // serial walk from the current position.
        maybeRequestOlderHistory();
        return;
      }
      const split = currentUnloadedSplit();
      const rowHeight = spacerRowHeightEma ?? VIRTUAL_ROW_HEIGHT_MIN_PX;
      const above = Math.round(split.above * rowHeight);
      const below = Math.round(split.below * rowHeight);
      virtualSpacerHeight = above;
      virtualSpacerBelowHeight = below;
      tick().then(() => {
        if (!isActive || isComponentDestroyed || !scrollContainer) return;
        scrollContainer.scrollTop = Math.max(
          0,
          Math.round(
            above + (target - startOrdinal) * rowHeight - scrollContainer.clientHeight / 2,
          ),
        );
      });
    });
  });

  // Transcript discard (§7.1 `resumed: false` seq-0 snapshot, e.g. after an
  // intentd restart): the store dropped the retained transcript and the
  // reducers reset the walk cursors + fetching flags atomically — but the
  // panel-local walk geometry (spacers, seek debounce, landing-pending) was
  // sized against the discarded rows and would strand the viewport inside a
  // phantom spacer over an empty store. Zero it all and re-anchor to the
  // fresh tail. Keyed on the snapshot's OBJECT IDENTITY (every
  // chatTranscriptSnapshotApplied mints a fresh meta object) so only a NEW
  // discarded snapshot fires; the first observation per agent only records
  // the baseline (a mount over an already-discarded snapshot has nothing to
  // reset). Identity — not seq — because the restart sequence clears the
  // snapshot first (phase→null resets seq), and effect batching can flush
  // the clear + fresh snapshot together, where a seq comparison against the
  // pre-clear baseline could coincide and miss the discard.
  let discardBaselineAgentId: string | undefined;
  let discardBaselineMeta: typeof $transcriptSnapshotMeta$;
  // Raised synchronously by the discard reset below until its re-anchor
  // lands. The same dispatch that applies the discard also clears
  // fetchingHistorySeek (the atomic reducer reset), so with a seek in
  // flight the seek-settle effect above (created earlier, flushed earlier)
  // observes a spurious settle and schedules its landing handler one
  // microtask BEFORE this effect's followToBottom — with
  // pendingSeekTargetOrdinal already nulled it would take the failed-seek
  // fallback and dispatch a spurious older-history page. The flag makes it
  // stand down for the discard's re-anchor.
  let discardReanchorPending = false;
  $effect(() => {
    const meta = $transcriptSnapshotMeta$;
    const currentAgentId = agentId;
    untrack(() => {
      if (currentAgentId !== discardBaselineAgentId) {
        discardBaselineAgentId = currentAgentId;
        discardBaselineMeta = meta;
        // The older-history indicator tracked the PREVIOUS agent's walk:
        // drop it instantly so switching agents mid-walk cannot carry the
        // visible indicator (or its armed hide / pending evaluation) over
        // to the newly selected agent for the quiet window.
        resetOlderHistoryIndicator();
        // Same rebaseline for the gap-fill settle tracker: the switch flips
        // $fetchingGapFill$ to the NEW agent's value, and without this a
        // mid-refill switch would read as a settle — re-running the settle
        // chain (including a possible seek dispatch) for the new agent
        // without any user scroll.
        wasFetchingGapFill = false;
        return;
      }
      if (meta === discardBaselineMeta) return;
      const isNewDiscard = meta?.resumed === false;
      discardBaselineMeta = meta;
      if (!isNewDiscard) return;
      cancelSeekDebounce();
      seekLandingPending = false;
      pendingSeekTargetOrdinal = null;
      discardReanchorPending = true;
      virtualSpacerHeight = 0;
      virtualSpacerBelowHeight = 0;
      shouldFollowBottom = true;
      tick().then(() => {
        discardReanchorPending = false;
        if (!isActive || isComponentDestroyed || !scrollContainer) return;
        followToBottom(scrollContainer);
      });
    });
  });

  // ── Virtual scrollbar: spacer above the resident rows ─────────────────
  // Sized to the ESTIMATED unloaded extent (unloaded rows x smoothed average
  // row height) so the scrollbar represents the full conversation. The
  // estimate is deliberately STABLE while the user interacts — the invariant
  // is that the total scroll extent only changes at quiet reconcile points
  // or boundaries:
  //
  // - FROZEN during interaction: while scroll events or older-history
  //   fetches are active the row-height EMA is locked. Every history-segment
  //   change restates both spacers count-derived — the unloaded above/below
  //   split x the frozen EMA (restateFrozenSpacers) — so cap pruning (which
  //   keeps measured height constant but moves rows out of the above
  //   extent) still shrinks the above spacer monotonically through a paging
  //   chain, with same-frame scrollTop compensation.
  // - RECONCILED when quiet: no scroll events and no fetch in flight for
  //   SPACER_QUIET_MS. The measured average row height folds into a
  //   slow-moving EMA, and the retarget applies only past a hysteresis
  //   threshold (reconcileVirtualSpacer); an applied change compensates
  //   scrollTop by the same delta in the same flush so neither the viewport
  //   nor the apparent thumb position jumps.
  // - BOUNDARIES are exact: exhaustion (or all rows resident) zeroes the
  //   spacer immediately, bypassing hysteresis and the quiet window.
  // 0 (no spacer, today's behavior) when totalMessages is unknown or the
  // walk is exhausted.
  //
  // DUAL SPACERS: an open history→tail hole splits the unloaded extent into
  // a spacer ABOVE the segment (rows older than its first row) and a spacer
  // BELOW it (rows in the hole, splitUnloadedRows). Seek-seeded segments
  // anchor the split on startOrdinalEstimate; serial-walk segments on the
  // reducer-tracked holeRowsEstimate (cap-pruned rows — attributing them
  // above used to overestimate the above extent by up to 2x mid-walk). Both
  // share the same row-height EMA and reconcile at the same quiet points.
  const SPACER_QUIET_MS = 400;
  let virtualSpacerHeight = $state(0);
  let virtualSpacerBelowHeight = $state(0);
  let belowSpacerEl = $state<HTMLElement>();
  let spacerRowHeightEma: number | null = null;
  let spacerReconcileTimer: ReturnType<typeof setTimeout> | null = null;
  let lastScrollActivityAt = 0;

  function scheduleSpacerReconcile() {
    if (spacerReconcileTimer !== null) clearTimeout(spacerReconcileTimer);
    if (!isActive) {
      spacerReconcileTimer = null;
      return;
    }
    spacerReconcileTimer = setTimeout(() => {
      spacerReconcileTimer = null;
      if (!isActive) return;
      runSpacerReconcile(false);
    }, SPACER_QUIET_MS);
  }

  function runSpacerReconcile(force: boolean) {
    if (!isActive || isComponentDestroyed) return;
    const container = scrollContainer;
    if (!container) return;
    // A seek in flight / landing owns the spacers — its settle handler sizes
    // them for the seeded segment.
    if ($fetchingHistorySeek$ || seekLandingPending) return;
    // Still interacting (fetch in flight or a scroll event landed inside the
    // quiet window): stay frozen and re-arm — unless forced at a boundary.
    if (
      !force &&
      ($fetchingOlderHistory$ ||
        $fetchingGapFill$ ||
        performance.now() - lastScrollActivityAt < SPACER_QUIET_MS)
    ) {
      scheduleSpacerReconcile();
      return;
    }
    const totalMessages = $transcriptSnapshotMeta$?.totalMessages ?? 0;
    const residentCount = $agentHistoryMessages$.length + $agentMessages$.length;
    const exhausted = $historyExhausted$;
    const split = splitUnloadedRows({
      totalMessages,
      residentCount,
      exhausted,
      startOrdinalEstimate: $historySegmentMeta$.startOrdinalEstimate,
      gapToTail: $historySegmentMeta$.gapToTail,
      holeRowsEstimate: $historySegmentMeta$.holeRowsEstimate,
    });
    const residentContentHeight = Math.max(
      0,
      container.scrollHeight - virtualSpacerHeight - virtualSpacerBelowHeight,
    );
    const result = reconcileVirtualSpacer({
      totalMessages,
      residentCount,
      exhausted,
      residentContentHeight,
      currentSpacerHeight: virtualSpacerHeight,
      rowHeightEma: spacerRowHeightEma,
      viewportHeight: container.clientHeight,
      unloadedRows: split.above,
    });
    spacerRowHeightEma = result.rowHeightEma;
    // Below spacer (history→tail hole): same estimate + hysteresis, EMA
    // already folded above so it is passed through unchanged.
    const belowResult = reconcileVirtualSpacer({
      totalMessages,
      residentCount,
      // The below extent zeroes when the hole closes (split.below 0), not on
      // the older walk's exhaustion.
      exhausted: false,
      residentContentHeight: 0,
      currentSpacerHeight: virtualSpacerBelowHeight,
      rowHeightEma: spacerRowHeightEma,
      viewportHeight: container.clientHeight,
      unloadedRows: split.below,
    });
    if (!result.applied && !belowResult.applied) return;
    // Same-flush scrollTop compensation: only the ABOVE spacer changes
    // content above the viewport (the below spacer sits under the resident
    // history the viewport is anchored in after a seek; when the viewport is
    // in the tail below the hole, the below delta also shifts content above
    // it — compensate for that case too).
    const previousScrollTop = container.scrollTop;
    let compensation = result.applied ? result.scrollTopDelta : 0;
    if (belowResult.applied && belowSpacerEl) {
      const spacerTopDoc =
        belowSpacerEl.getBoundingClientRect().top -
        container.getBoundingClientRect().top +
        container.scrollTop;
      if (previousScrollTop > spacerTopDoc) compensation += belowResult.scrollTopDelta;
    }
    if (result.applied) virtualSpacerHeight = result.spacerHeight;
    if (belowResult.applied) virtualSpacerBelowHeight = belowResult.spacerHeight;
    if (compensation === 0) return;
    tick().then(() => {
      if (!isActive || isComponentDestroyed || !scrollContainer) return;
      scrollContainer.scrollTop = Math.max(0, previousScrollTop + compensation);
    });
  }

  // Reconcile scheduling: any estimate input changing (re)arms the quiet
  // timer; the exhaustion boundary reconciles immediately (target 0 exactly,
  // no hysteresis). The spacer state itself is never a dep — the effect
  // only re-arms off external inputs.
  $effect(() => {
    if (!isActive) return;
    void ($agentHistoryMessages$.length + $agentMessages$.length);
    void $transcriptSnapshotMeta$?.totalMessages;
    const exhausted = $historyExhausted$;
    const gapOpen = $historySegmentMeta$.gapToTail;
    void $fetchingOlderHistory$;
    void $fetchingGapFill$;
    void $fetchingHistorySeek$;
    if (!scrollContainer) return;
    untrack(() => {
      if ((exhausted && virtualSpacerHeight > 0) || (!gapOpen && virtualSpacerBelowHeight > 0)) {
        runSpacerReconcile(true);
        return;
      }
      scheduleSpacerReconcile();
    });
  });

  // Frozen-phase restatement: any history-segment change (prepend, cap
  // pruning, gap refill) restates BOTH spacers COUNT-derived — the unloaded
  // above/below split x the FROZEN row-height EMA (restateFrozenSpacers) —
  // in the same flush as the row change. The old measured-delta absorption
  // was blind to cap pruning: a capped prepend adds about as much height as
  // it prunes (and keeps the segment length constant), so the above spacer
  // froze at a stale height while the true above count shrank with every
  // page — blank viewport mid-chain, then one big thumb snap at the forced
  // exhaustion reconcile. Counts see pruning exactly, so the above spacer
  // shrinks monotonically toward the boundary; the EMA is only refreshed at
  // quiet reconcile points, keeping the restatement stable across a chain.
  let restatedHistoryLength = -1;
  let restatedHistoryFirstId: string | undefined;
  let restatedHistoryLastId: string | undefined;
  $effect.pre(() => {
    const historyLength = $agentHistoryMessages$.length;
    const firstId = $agentHistoryMessages$[0]?.id;
    const lastId = $agentHistoryMessages$[historyLength - 1]?.id;
    if (
      historyLength === restatedHistoryLength &&
      firstId === restatedHistoryFirstId &&
      lastId === restatedHistoryLastId
    ) {
      return;
    }
    const isFirstRun = restatedHistoryLength === -1;
    restatedHistoryLength = historyLength;
    restatedHistoryFirstId = firstId;
    restatedHistoryLastId = lastId;
    if (!isActive) return;
    const container = untrack(() => scrollContainer);
    if (isFirstRun || !container) return;
    untrack(() => {
      // A seek landing REPLACES the segment (not a change to the frozen
      // extent): the seek settle handler sizes both spacers itself.
      if (seekLandingPending || $fetchingHistorySeek$) return;
      // No spacer active: nothing frozen to restate — the quiet reconcile
      // owns sizing from scratch.
      if (virtualSpacerHeight <= 0 && virtualSpacerBelowHeight <= 0) return;
      if (($transcriptSnapshotMeta$?.totalMessages ?? 0) <= 0) return;
      const restated = restateFrozenSpacers(currentUnloadedSplit(), spacerRowHeightEma);
      const previousAbove = virtualSpacerHeight;
      const previousBelow = virtualSpacerBelowHeight;
      if (restated.above === previousAbove && restated.below === previousBelow) return;
      const previousScrollTop = container.scrollTop;
      // Same-frame scrollTop compensation (the reconcile pattern): an above
      // delta shifts content above the viewport — EXCEPT when the viewport
      // is parked INSIDE the above spacer, where scrollTop must stay put so
      // the resident window rises toward it (rows materialize at the
      // resident edge, not at the viewport's ordinal). A below delta shifts
      // content above the viewport only when the viewport sits below the
      // hole. The prepended rows' own height is handled by the anchor
      // restore effect below, exactly as before.
      let compensation = 0;
      if (previousScrollTop >= previousAbove) compensation += restated.above - previousAbove;
      if (restated.below !== previousBelow && belowSpacerEl) {
        const spacerTopDoc =
          belowSpacerEl.getBoundingClientRect().top -
          container.getBoundingClientRect().top +
          container.scrollTop;
        if (previousScrollTop > spacerTopDoc) compensation += restated.below - previousBelow;
      }
      virtualSpacerHeight = restated.above;
      virtualSpacerBelowHeight = restated.below;
      if (compensation === 0) return;
      tick().then(() => {
        if (!isActive || isComponentDestroyed || !scrollContainer) return;
        scrollContainer.scrollTop = Math.max(0, previousScrollTop + compensation);
      });
    });
  });

  // Clear deferred viewport work on deactivate as well as destroy.
  $effect(() => {
    if (isActive) return;
    if (spacerReconcileTimer !== null) {
      clearTimeout(spacerReconcileTimer);
      spacerReconcileTimer = null;
    }
    cancelSeekDebounce();
    return () => {
      if (spacerReconcileTimer !== null) clearTimeout(spacerReconcileTimer);
      cancelSeekDebounce();
    };
  });

  // Older-history scroll trigger. The saga sets the fetching flag
  // synchronously on the first dispatch, deduping the scroll-event burst.
  // Scroll events also mark interaction activity, keeping the spacer frozen
  // until the transcript goes quiet. Positions deep inside a spacer arm the
  // seek debounce INSTEAD of the serial trigger — the serial walk would
  // load every intermediate page on the way to a far target. Rapid bursts
  // (a wheel flick / thumb drag covering more than a viewport per settle
  // window — classifyScrollBurst) ALSO defer to the settle debounce even
  // over near/resident territory: chasing intermediate positions with
  // serial pages wastes fetches the settle re-classification replaces with
  // one driver picked at the parked position. The buffer ingests EVERY
  // scroll event, including programmatic ones (prepend anchor restore,
  // spacer compensation, seek-landing positioning, followToBottom on agent
  // switch/send): a gentle user scroll within one window of such a write
  // can transiently classify 'rapid' and defer its serial trigger by one
  // settle window — accepted, because the deferral is self-correcting (the
  // samples age out via appendScrollSample and the settle debounce still
  // drives the walk) and the write sites are too scattered for a reliable
  // per-site buffer reset. The same aging means no reset is needed across
  // agent switches.
  let scrollBurstSamples: ScrollSample[] = [];
  $effect(() => {
    const container = scrollContainer;
    if (!isActive || !container) return;
    scrollBurstSamples = [];
    const onScroll = () => {
      lastScrollActivityAt = performance.now();
      scheduleSpacerReconcile();
      scrollBurstSamples = appendScrollSample(scrollBurstSamples, {
        scrollTop: container.scrollTop,
        timestamp: lastScrollActivityAt,
      });
      if (seekTargetOrdinalAt(container.scrollTop) !== null) {
        armSeekDebounce();
        return;
      }
      // Downward dead zone / return-to-tail: a position overlapping the
      // below spacer that classified 'serial' has NO edge-triggered driver
      // (below the gap sentinel's rootMargin, too near the hole's edge for
      // a seek) — and a position fully below the open hole is back on the
      // tail. Both arm the same settle debounce; its fire re-classifies
      // from the settled position and picks the collapse or bounded
      // gap-refill driver.
      if (viewportOverlapsBelowSpacer() || viewportFullyBelowOpenHole()) {
        armSeekDebounce();
        return;
      }
      // Rapid burst over near/resident territory: defer to the settle
      // debounce — its fire (or the in-flight page's settle chain)
      // re-classifies the SETTLED position instead of chasing every
      // intermediate one with serial pages.
      if (
        classifyScrollBurst({
          samples: scrollBurstSamples,
          viewportHeight: container.clientHeight,
        }) === 'rapid'
      ) {
        armSeekDebounce();
        return;
      }
      cancelSeekDebounce();
      maybeRequestOlderHistory();
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  });

  // Chain-scoped visibility for the top "Loading older messages" indicator:
  // the raw fetching flag toggles false between every page of the settle
  // chain below, so rendering it directly blinked once per page. The
  // indicator instead tracks the WALK — shown while a fetch is in flight or
  // the settle re-evaluation is pending, hidden only after a short quiet
  // window once the chain truly stops (olderHistoryIndicatorAction).
  let olderHistoryIndicatorVisible = $state(false);
  let olderHistoryChainEvaluationPending = false;
  let olderHistoryIndicatorHideTimer: ReturnType<typeof setTimeout> | null = null;

  function syncOlderHistoryIndicator(fetching: boolean) {
    if (!isActive) return;
    const action = olderHistoryIndicatorAction({
      fetching,
      chainEvaluationPending: olderHistoryChainEvaluationPending,
      visible: olderHistoryIndicatorVisible,
      hideArmed: olderHistoryIndicatorHideTimer !== null,
    });
    if (action === 'show') {
      if (olderHistoryIndicatorHideTimer !== null) {
        clearTimeout(olderHistoryIndicatorHideTimer);
        olderHistoryIndicatorHideTimer = null;
      }
      olderHistoryIndicatorVisible = true;
    } else if (action === 'arm-hide') {
      olderHistoryIndicatorHideTimer = setTimeout(() => {
        olderHistoryIndicatorHideTimer = null;
        if (!isActive || isComponentDestroyed) return;
        olderHistoryIndicatorVisible = false;
      }, OLDER_HISTORY_INDICATOR_QUIET_MS);
    }
  }

  // Drop the indicator instantly (visible flag, armed hide timer, pending
  // chain evaluation) — the agent-change branch of the discard-baseline
  // effect above calls this so a mid-walk agent switch never carries the
  // previous agent's indicator over to the new agent for the quiet window.
  // Also rebaselines the settle tracker: the switch flips
  // $fetchingOlderHistory$ to the NEW agent's value, and without the
  // rebaseline that flip would read as the old agent's walk settling
  // (spurious settle → evaluation pending → indicator re-shown).
  function resetOlderHistoryIndicator() {
    if (olderHistoryIndicatorHideTimer !== null) {
      clearTimeout(olderHistoryIndicatorHideTimer);
      olderHistoryIndicatorHideTimer = null;
    }
    olderHistoryChainEvaluationPending = false;
    olderHistoryIndicatorVisible = false;
    wasFetchingOlderHistory = false;
  }

  // Clear the indicator hide timer on deactivate and destroy.
  $effect(() => {
    if (!isActive) untrack(resetOlderHistoryIndicator);
    return () => {
      if (olderHistoryIndicatorHideTimer !== null) clearTimeout(olderHistoryIndicatorHideTimer);
    };
  });

  // Continuous paging: the scroll listener above is edge-triggered, and a
  // prepend + anchor restore emits no scroll event — without this settle
  // re-evaluation the walk strands after one page while the user holds the
  // viewport at the top. On the fetching flag's true→false transition,
  // re-run the trigger guard AFTER the anchor restore has landed (tick +
  // double rAF orders behind the restore's tick + rAF in the prepend
  // anchoring effect below) so it measures the post-restore scrollTop.
  // Runaway-loop guards are the trigger guard's own stop conditions: the
  // restore moving the viewport past the threshold, exhaustion, or all rows
  // resident stop the chain (shouldChainOlderHistoryOnSettle). Every settle
  // point re-classifies the parked position first
  // (maybeDispatchSettledSeek — the classifySettledPosition contract): a
  // viewport still deep inside the spacer, e.g. parked there while this
  // page was in flight, issues ONE aroundIndex jump instead of serially
  // chaining every intermediate page toward it. The below drivers are
  // evaluated too (collapse, then dead-zone gap refill — same order as the
  // seek-debounce fire): a debounce consumed by this racing fetch may have
  // carried a BELOW intent (the user flicked down past the open hole), and
  // without these checks that intent would strand until the next scroll
  // event.
  let wasFetchingOlderHistory = false;
  $effect(() => {
    const fetching = $fetchingOlderHistory$;
    if (!isActive) {
      wasFetchingOlderHistory = fetching;
      olderHistoryChainEvaluationPending = false;
      return;
    }
    const settled = wasFetchingOlderHistory && !fetching;
    wasFetchingOlderHistory = fetching;
    // The pending flag is raised BEFORE the indicator sync so the settle
    // gap (fetch false, chain not yet re-evaluated) never arms the hide.
    if (settled) olderHistoryChainEvaluationPending = true;
    untrack(() => syncOlderHistoryIndicator(fetching));
    if (!settled) return;
    tick().then(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          olderHistoryChainEvaluationPending = false;
          if (!isActive || isComponentDestroyed) return;
          if (scrollContainer && !maybeDispatchSettledSeek()) {
            if (maybeCollapseHistorySegmentAtTail()) {
              // Below intent handled; the chain (and its indicator) stops.
            } else if (viewportOverlapsBelowSpacer()) {
              requestHistoryGapFill();
            } else {
              maybeRequestOlderHistory();
            }
          }
          // The saga raises the fetching flag synchronously on dispatch, so
          // this read distinguishes "chain continued" (stay visible) from
          // "chain stopped" (arm the quiet-window hide).
          syncOlderHistoryIndicator($fetchingOlderHistory$);
        });
      });
    });
  });

  function requestHistoryGapFill() {
    if (!isActive || !workspace?.id || !agentId) return;
    if ($fetchingGapFill$ || !$historySegmentMeta$.gapToTail) return;
    // Never race a settling seek (mirror of maybeRequestOlderHistory): the
    // seek REPLACES the segment, so a gap page anchored at the pre-seek
    // segment must not go to the wire. The saga carries the same guard;
    // this closes the panel-side dispatch window (sentinel, button).
    if ($fetchingHistorySeek$ || seekLandingPending) return;
    appStore.dispatch(historyGapFillRequested(workspace.id, agentId));
  }

  // Gap-refill chaining (mirror of the older-history settle chain above,
  // for the forward walk): a refill page emits no scroll event, so on the
  // fetching flag's true→false transition re-evaluate the below drivers
  // after the anchor restore has landed. The settle re-classification runs
  // first (maybeDispatchSettledSeek): a viewport dragged far away while the
  // refill was in flight jumps there instead of continuing the refill.
  // Otherwise collapse when the viewport is now fully below the hole;
  // another bounded refill page while it still overlaps the below spacer.
  // Stop conditions are state-derived — the gap closing (gapToTail false)
  // or the overlap clearing ends the chain — so the loop is bounded by the
  // hole's row count.
  let wasFetchingGapFill = false;
  $effect(() => {
    const fetching = $fetchingGapFill$;
    if (!isActive) {
      wasFetchingGapFill = fetching;
      return;
    }
    const settled = wasFetchingGapFill && !fetching;
    wasFetchingGapFill = fetching;
    if (!settled) return;
    tick().then(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!isActive || isComponentDestroyed || !scrollContainer) return;
          if (maybeDispatchSettledSeek()) return;
          if (maybeCollapseHistorySegmentAtTail()) return;
          if (viewportOverlapsBelowSpacer()) requestHistoryGapFill();
        });
      });
    });
  });

  // Gap sentinel: scrolling near/into the history→tail hole requests a
  // refill page (the affordance also offers a click-to-load fallback).
  let historyGapSentinel = $state<HTMLElement>();
  $effect(() => {
    const sentinel = historyGapSentinel;
    const root = scrollContainer;
    if (!isActive || !sentinel || !root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) requestHistoryGapFill();
      },
      { root, rootMargin: '160px 0px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  });

  // No-jump prepends/refills: history rows landing above the viewport would
  // shift the reading position (native scroll anchoring is disabled on the
  // container). Capture an element anchor BEFORE the DOM updates and restore
  // it after — this composes with the LazyTurn height ledger, which only
  // compensates height CHANGES of existing turns, never new siblings.
  let anchoredHistoryLength = -1;
  $effect.pre(() => {
    const historyLength = $agentHistoryMessages$.length;
    if (!isActive) {
      anchoredHistoryLength = historyLength;
      return;
    }
    if (historyLength === anchoredHistoryLength) return;
    const isFirstRun = anchoredHistoryLength === -1;
    anchoredHistoryLength = historyLength;
    const container = untrack(() => scrollContainer);
    if (isFirstRun || !container) return;
    // A seek landing replaces the segment wholesale — the settle handler
    // positions the viewport at the target; restoring the pre-landing
    // anchor would fight it.
    if (untrack(() => seekLandingPending || $fetchingHistorySeek$)) return;
    const anchor = captureScrollAnchor(container);
    tick().then(() => {
      requestAnimationFrame(() => {
        if (!isActive || isComponentDestroyed || !scrollContainer) return;
        restoreScrollAnchor(scrollContainer, anchor);
      });
    });
  });

  // Keyed by calendar day (not first message ID) so a same-day older-history
  // prepend does not change the group key and recreate its rendered turns.
  const dateGroupKeys = $derived(buildDateGroupKeys(groupedMessages));

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
  // Retry budget once the container has rendered but is still shorter than
  // the cached position (rows still streaming in / late layout).
  const CACHED_SCROLL_RESTORE_MAX_ATTEMPTS = 60;
  let cachedScrollRestoreAttempts = 0;
  let cachedScrollRestoreRetryFrame: number | null = null;
  $effect(() => {
    if (isActive) {
      if (cachedScrollRestoreTop !== null && !hasConsumedCachedScrollRestore)
        scheduleCachedScrollRestoreRetry();
      return;
    }
    if (cachedScrollRestoreRetryFrame !== null) {
      cancelAnimationFrame(cachedScrollRestoreRetryFrame);
      cachedScrollRestoreRetryFrame = null;
    }
    return () => {
      if (cachedScrollRestoreRetryFrame !== null)
        cancelAnimationFrame(cachedScrollRestoreRetryFrame);
    };
  });
  function scheduleCachedScrollRestoreRetry() {
    if (!isActive || cachedScrollRestoreRetryFrame !== null) return;
    cachedScrollRestoreRetryFrame = requestAnimationFrame(() => {
      cachedScrollRestoreRetryFrame = null;
      if (!isActive || isComponentDestroyed) return;
      applyCachedScrollRestore();
    });
  }
  // Reapply the previous instance's scroll position (see cachedScrollRestoreTop
  // above). Returns true when the cached position was consumed.
  function applyCachedScrollRestore(): boolean {
    if (!isActive || cachedScrollRestoreTop === null || hasConsumedCachedScrollRestore)
      return false;
    // Not consumed until the container is bound, so a premature call cannot
    // silently drop the cached position.
    if (!scrollContainer) return false;
    // Never apply (and consume) against an unrendered (skeleton/collapsed)
    // or still-short container: the browser clamps the write to ~0 and the
    // panel would land at the top of the transcript. Retry on animation
    // frames until the transcript can hold the position. While the container
    // has not rendered at all (zero client height) the retry keeps waiting;
    // once rendered, the bounded budget ends with a clamped apply — the
    // content is then genuinely shorter (e.g. pruned scrollback rows) and
    // the nearest valid position is the correct landing.
    const maxScrollTop = scrollContainer.scrollHeight - scrollContainer.clientHeight;
    if (maxScrollTop < cachedScrollRestoreTop) {
      const rendered = scrollContainer.clientHeight > 0;
      if (!rendered || cachedScrollRestoreAttempts < CACHED_SCROLL_RESTORE_MAX_ATTEMPTS) {
        if (rendered) cachedScrollRestoreAttempts += 1;
        scheduleCachedScrollRestoreRetry();
        return false;
      }
    }
    hasConsumedCachedScrollRestore = true;
    // The unread-divider entry scroll is superseded — the user already had a
    // deliberate reading position when the panel was unmounted.
    hasAppliedNewMessagesEntryScroll = true;
    scrollContainer.scrollTop = cachedScrollRestoreTop;
    return true;
  }
  // The deferred restore must never fire after the user has started
  // scrolling: while the transcript is still shorter than the cached
  // position (rows streaming in / LazyTurn placeholders under-reporting
  // height) the retry loop stays pending, and a late apply would yank the
  // viewport away from the position the user just chose.
  function cancelPendingCachedScrollRestore() {
    if (cachedScrollRestoreTop === null || hasConsumedCachedScrollRestore) return;
    hasConsumedCachedScrollRestore = true;
    if (cachedScrollRestoreRetryFrame !== null) {
      cancelAnimationFrame(cachedScrollRestoreRetryFrame);
      cachedScrollRestoreRetryFrame = null;
    }
  }
  // First user-initiated scroll intent cancels the pending restore: wheel,
  // touch, or a pointer grab on the scrollbar track (a pointerdown on the
  // container itself with offsetX past the content box — clientWidth
  // excludes the scrollbar gutter). Plain clicks inside the content are not
  // scroll intents.
  $effect(() => {
    const container = scrollContainer;
    if (!isActive || !container) return;
    const cancel = () => cancelPendingCachedScrollRestore();
    const onPointerDown = (event: PointerEvent) => {
      if (event.target === container && event.offsetX >= container.clientWidth) {
        cancelPendingCachedScrollRestore();
      }
    };
    container.addEventListener('wheel', cancel, { passive: true });
    container.addEventListener('touchstart', cancel, { passive: true });
    container.addEventListener('pointerdown', onPointerDown);
    return () => {
      container.removeEventListener('wheel', cancel);
      container.removeEventListener('touchstart', cancel);
      container.removeEventListener('pointerdown', onPointerDown);
    };
  });
  // A cache write must record a real, user-held reading position: never
  // while this instance's own cached restore is still pending (until it is
  // consumed the current scrollTop is not user-chosen), and — away from the
  // bottom — never from a collapsed/unrendered container, whose clamped
  // scrollTop of ~0 would overwrite a useful cached position and land the
  // next mount at the top. With follow engaged the recorded scrollTop is
  // ignored on restore, so container dimensions do not matter.
  function canRecordChatScroll(isFollowing: boolean): boolean {
    if (!scrollContainer) return false;
    if (cachedScrollRestoreTop !== null && !hasConsumedCachedScrollRestore) return false;
    if (!isFollowing && scrollContainer.scrollHeight <= scrollContainer.clientHeight) return false;
    // Stop-looking boundary (workspace switch / tab close): the boundary
    // saga clears the cache and ends this agent's divider session in the
    // same dispatch tick, BEFORE Svelte's teardown flush destroys this
    // panel. When the session this instance latched has ended, this is a
    // boundary teardown — not a column-windowing remount — and recording
    // would repopulate the entry the boundary just cleared, so the next
    // entry would restore a stale position instead of following the entry
    // policy (bottom / divider).
    if (
      agentId &&
      latchedDividerSessionAgentId === agentId &&
      selectDividerSession.select(appStore.state, agentId) === null
    ) {
      return false;
    }
    return true;
  }
  // Structural transcript metadata is derived in one pass. During a live turn,
  // replacing only the final assistant row's content reuses this projection;
  // ChatMessage keeps subscribing to that row by id, so volatile text stays live.
  const projectTranscriptStructure = createChatTranscriptStructureProjector();
  const transcriptStructure = $derived(
    projectTranscriptStructure({
      messages: $agentMessages$,
      isStreaming: $agentSessionIsStreaming$,
      isActive,
      snapshotSequence: $transcriptSnapshotMeta$?.seq,
    }),
  );
  const auggieSessionId = $derived(transcriptStructure.latestAuggieSessionId);
  const totalTurnCount = $derived(transcriptStructure.userTurnCount);

  // PERF: Enable lazy loading only for larger conversations, latched across
  // background older-history prepends (see nextLazyMode). The decision crosses
  // on either the user-turn count OR the total message count (currentCount) so
  // assistant-heavy transcripts (Chief-of-staff threads) virtualize despite a
  // low turn count. Chief threads use a lower message threshold so their
  // assistant-heavy transcripts engage virtualization much sooner. Mutating the
  // plain (non-$state) tracker inside the derived is safe: re-evaluation with
  // unchanged inputs is idempotent (`unchanged` → latch), and deriveds are
  // lazy, so the latch is best-effort — a prepend coalesced with an append into
  // one observed transition recomputes from the threshold, failing open to the
  // pre-latch behavior. Do not make the tracker stateful.
  let lazyModeTracker = INITIAL_LAZY_MODE_TRACKER;
  const shouldUseLazyLoading = $derived.by(() => {
    const currentCount = $agentMessages$.length;
    const currentNewestId = $agentMessages$[currentCount - 1]?.id;
    const messageThreshold = isChiefWorkspace ? CHIEF_LAZY_MESSAGE_THRESHOLD : undefined;
    lazyModeTracker = nextLazyMode(
      lazyModeTracker,
      currentCount,
      currentNewestId,
      totalTurnCount,
      messageThreshold,
    );
    return lazyModeTracker.mode;
  });

  // Track previous message count and newest row to detect new messages and to
  // distinguish appended NEW messages from the background older-history
  // prepend (list grew, newest row unchanged), which must stay scroll-neutral.
  let previousMessageCount = $state(0);
  let previousNewestMessageId: string | undefined = undefined;

  // Auto-scroll to bottom when new messages are added and shouldFollowBottom is true
  $effect(() => {
    const currentCount = $agentMessages$.length;
    const currentNewestId = $agentMessages$[currentCount - 1]?.id;
    // Scroll to bottom when:
    // 1. New message added AND following is enabled, OR
    // 2. First message added (transition from empty to non-empty) - always scroll to show the new content
    const isFirstMessage = previousMessageCount === 0 && currentCount > 0;
    const hasNewMessages =
      currentCount > previousMessageCount &&
      !isOlderHistoryPrepend(
        previousMessageCount,
        previousNewestMessageId,
        currentCount,
        currentNewestId,
      );
    const shouldScroll = hasNewMessages && (isFirstMessage || shouldFollowBottom);
    if (hasNewMessages) {
      // Unread-marker entry: on the first transcript hydration with a latched
      // divider anchor, land at the "New messages" divider with follow
      // disabled when the unseen tail is taller than the viewport; when it
      // fits on screen, scroll to the bottom with follow enabled instead
      // (decided inside scrollToNewMessagesDivider).
      if (isFirstMessage && cachedScrollRestoreTop !== null && !hasConsumedCachedScrollRestore) {
        // Land at the previous instance's reading position instead of the
        // divider/bottom entry scroll.
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
          if (!startedTransition && scrollContainer && shouldScroll)
            followToBottom(scrollContainer);
        });
      }
    }
    previousMessageCount = currentCount;
    previousNewestMessageId = currentNewestId;
  });

  // Helper functions for O(1) lookups
  function getMessageIndex(messageId: string): number {
    return transcriptStructure.messageIndexById.get(messageId) ?? -1;
  }

  function getMessageTurnNumber(messageId: string): number {
    return transcriptStructure.assistantTurnNumberById.get(messageId) ?? 0;
  }

  // Compute the turn structure and both virtualization/search indexes in one
  // transcript pass rather than regrouping each date bucket for every consumer.
  const conversationTurnIndex = $derived(indexConversationTurns(groupedMessages));
  const hydrationMessages = $derived.by((): HydrationMessage[] =>
    groupedMessages
      .flatMap((group) => group.messages)
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .map(({ id, role }) => ({ id, role })),
  );

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

  // Map each messageId to its enclosing turnKey. Used by allSearchMatches so that
  // matches in virtualized message placeholders can be force-rendered during search.
  const messageIdToTurnKey = $derived(conversationTurnIndex.turnKeyByMessageId);

  let offscreenPendingProposalMessageId = $state<string | null>(null);

  function findPendingProposalCard(
    message: HTMLElement,
    ref: PendingProposalRef,
    claimed: Set<Element> = new Set(),
  ): HTMLElement | null {
    const exact = message.querySelector<HTMLElement>(
      `[data-apply-tool-call-id="${CSS.escape(ref.proposalId)}"]`,
    );
    if (exact && !claimed.has(exact)) return exact;
    return (
      Array.from(message.querySelectorAll<HTMLElement>('[data-proposal-kind]')).find(
        (candidate) => !claimed.has(candidate),
      ) ?? null
    );
  }

  // Watch pending turns against the transcript viewport. The persistent
  // LazyTurn shell survives content hydration changes, so observation does
  // not go stale when a card is replaced by a placeholder and restored.
  $effect(() => {
    const refs = pendingProposalRefs;
    const root = scrollContainer;
    void $agentMessages$;
    void $pendingProposalRecovery$;
    void $proposalLifecycleMap$;
    if (!isActive || !root || refs.length === 0) {
      offscreenPendingProposalMessageId = null;
      return;
    }

    let disposed = false;
    let observer: IntersectionObserver | null = null;
    tick().then(() => {
      if (disposed || !isActive || scrollContainer !== root) return;
      const refKeysByTarget = new Map<Element, string[]>();
      const visibility = new Map<string, boolean>();
      const claimed = new Set<Element>();
      const recovered = $pendingProposalRecovery$;
      for (const ref of refs) {
        const refKey = `${ref.messageId}\u0000${ref.proposalId}`;
        const message = root.querySelector<HTMLElement>(
          `[data-message-id="${CSS.escape(ref.messageId)}"]`,
        );
        let target = message?.closest<HTMLElement>('[data-lazy-turn-key]') ?? null;
        if (!target) {
          const turnKey = messageIdToTurnKey.get(ref.messageId);
          target = turnKey
            ? root.querySelector<HTMLElement>(`[data-lazy-turn-key="${CSS.escape(turnKey)}"]`)
            : null;
        }
        if (!target && message) target = findPendingProposalCard(message, ref, claimed);
        if (!target) {
          const recoveredEntry = recovered?.[ref.messageId];
          if (
            recoveredEntry?.status === 'found' &&
            recoveredEntry.proposals?.some((entry) => entry.proposalId === ref.proposalId)
          ) {
            visibility.set(refKey, false);
          }
          continue;
        }
        claimed.add(target);
        refKeysByTarget.set(target, [...(refKeysByTarget.get(target) ?? []), refKey]);
      }
      if (refKeysByTarget.size === 0 || typeof IntersectionObserver === 'undefined') {
        offscreenPendingProposalMessageId =
          refs.find((ref) => visibility.get(`${ref.messageId}\u0000${ref.proposalId}`) === false)
            ?.messageId ?? null;
        return;
      }
      offscreenPendingProposalMessageId =
        refs.find((ref) => visibility.get(`${ref.messageId}\u0000${ref.proposalId}`) === false)
          ?.messageId ?? null;
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            for (const refKey of refKeysByTarget.get(entry.target) ?? []) {
              visibility.set(refKey, entry.isIntersecting);
            }
          }
          offscreenPendingProposalMessageId =
            refs.find((ref) => visibility.get(`${ref.messageId}\u0000${ref.proposalId}`) === false)
              ?.messageId ?? null;
        },
        { root, threshold: 0.01 },
      );
      for (const target of refKeysByTarget.keys()) observer.observe(target);
    });

    return () => {
      disposed = true;
      observer?.disconnect();
    };
  });

  // --- Auto-commit status (fetched once, shared across all AutoCommitStatus instances) ---
  let autoCommitStatuses = $state<CommitStatus[]>([]);

  function refreshAutoCommitStatuses() {
    const requestedAgentId = agentId;
    if (!isActive || !requestedAgentId) return;
    invoke<{ success: boolean; data: CommitStatus[] }>('git:get-auto-commit-status', {
      agentId: requestedAgentId,
    })
      .then((response) => {
        if (isActive && requestedAgentId === agentId && response?.success && response.data) {
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
    if (!isActive) return;
    refreshAutoCommitStatuses();
  });

  // Listen for real-time auto-commit events (3 listeners total, not per-turn)
  $effect(() => {
    if (!isActive) return;
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
    // Establish interest before initialization can open a subscription and
    // before any viewed-agent sweep can decide which registrations to keep.
    transferPanelInterestLease(activePanelInterestAgentId());

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

    // Empty chats start at the top and unlock until the first send. Non-empty
    // chats are positioned by the follow action itself. A still-hydrating
    // transcript (empty store, hydration not settled) is left untouched: the
    // first-hydration auto-scroll effect owns that entry. The settled-empty
    // branch only fires on a remount over an already-settled store (a new
    // agent's hydration settles after this frame); either way an empty
    // container sits at 0, so this is a no-op safeguard, not the entry owner.
    const initialScrollFrame = requestAnimationFrame(() => {
      if (!isActive) return;
      if (scrollContainer) {
        if ($agentMessages$.length > 0) {
          if (cachedScrollRestoreTop !== null) {
            // Restore the previous instance's reading position (no-op when
            // the hydration effect already did).
            applyCachedScrollRestore();
          } else {
            shouldFollowBottom = true;
            followToBottom(scrollContainer);
          }
        } else if (transcriptSettledEmpty) {
          // Scroll to top for empty panel (shows specialist switcher)
          scrollContainer.scrollTop = 0;
          // Don't auto-follow until user sends a message
          shouldFollowBottom = false;
        }
      }
    });

    return () => cancelAnimationFrame(initialScrollFrame);
  });

  $effect(() => {
    transferPanelInterestLease(activePanelInterestAgentId());
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
      if (!isActive) return;
      if (shouldSkipPromptAutoFocus()) return;
      focusPrompt();
    }, 100);

    return () => clearTimeout(autoFocusTimer);
  });

  $effect(() => {
    const transitionWorkspaceId = workspace?.id;
    const transitionAgentId = agentId;
    if (!transitionWorkspaceId || !transitionAgentId) return;
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

  function getRenderedPanelHeaderBottom(): number | undefined {
    const ownerPanel = panelElement?.closest<HTMLElement>('[data-panel-id]');
    if (!ownerPanel) return undefined;
    const header = Array.from(
      ownerPanel.querySelectorAll<HTMLElement>('[data-panel-content-header]'),
    ).find((candidate) => candidate.closest('[data-panel-id]') === ownerPanel);
    return header?.getBoundingClientRect().bottom;
  }

  /**
   * Smoothly scroll an element into view with a custom duration.
   * Uses easeOutCubic for a natural feel.
   */
  function smoothScrollTo(
    element: HTMLElement,
    block: 'start' | 'center' | 'end' = 'center',
    duration: number = 150,
  ) {
    if (!isActive || !scrollContainer) return;

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
      targetScrollTop = getMessageNavigationStartScrollTop({
        currentScrollTop: scrollContainer.scrollTop,
        targetTop: elementRect.top,
        containerTop: containerRect.top,
        headerBottom: getRenderedPanelHeaderBottom(),
      });
    } else {
      targetScrollTop = scrollContainer.scrollTop + (elementRect.bottom - containerRect.bottom) + 1;
    }

    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      scrollContainer.scrollTop = targetScrollTop;
      return;
    }
    animateScrollTo(() => (isActive ? scrollContainer : null), targetScrollTop, duration);
  }

  /**
   * Smoothly scroll to a specific position with 150ms animation.
   */
  function smoothScrollToPosition(top: number, duration: number = 150) {
    if (!isActive) return;
    animateScrollTo(() => (isActive ? scrollContainer : null), top, duration);
  }

  // Navigate to a specific message by index
  function navigateToMessage(index: number) {
    if (!scrollContainer) return;

    const messages = $agentMessages$;
    if (messages.length === 0) return;

    // Clamp index to valid range, or -1 for "at bottom"
    if (index < 0) {
      currentMessageIndex = -1;
      shouldFollowBottom = true;
      followToBottom(scrollContainer);
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
    if (!isActive || typeof window === 'undefined') return;

    window.addEventListener('navigate-message', handleNavigateMessage);

    return () => {
      window.removeEventListener('navigate-message', handleNavigateMessage);
    };
  });

  // Listen for scroll-to-turn events (from agent attribution badges)
  $effect(() => {
    if (!isActive || typeof window === 'undefined') return;

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
        scheduleHighlightRemoval(messageElement, 'highlight-flash', 1500);
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
    if (!isActive || typeof window === 'undefined') return;

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
        scheduleHighlightRemoval(targetElement, 'highlight-flash', 1500);
      }
    };

    window.addEventListener('agent:scroll-to-activity', handleScrollToActivity);
    return () => window.removeEventListener('agent:scroll-to-activity', handleScrollToActivity);
  });

  // Listen for scroll-to-subscription events (from AgentSubscriptions component)
  $effect(() => {
    if (!isActive || typeof window === 'undefined') return;

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
            scheduleHighlightRemoval(messageElement, 'highlight-flash', 1500);
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

  function isMessageForceVisible(messageId: string): boolean {
    if (!shouldUseLazyLoading) return true;
    const turnKey = messageIdToTurnKey.get(messageId);
    if (!turnKey) return true;
    const isLastTurn = globalTurnIndexMap.get(turnKey) === globalTurnIndexMap.size - 1;
    return (
      isTurnTemporarilyMaterialized(temporaryTurnMaterialization, turnKey) ||
      ($agentSessionIsStreaming$ && isLastTurn) ||
      visibleSearchTurnKeys.has(turnKey) ||
      deepOpenTurnKey === turnKey
    );
  }

  // The controller order is the composed history + live-tail chronology, not
  // turn position. User and assistant rows both register with the shared
  // observer and follow the asymmetric displayport frontier; user rows never
  // dehydrate once hydrated (see message-hydration-policy.ts).
  $effect(() => {
    const messages = hydrationMessages;
    messageHydrationPolicy.setScope(
      `${String(workspace?.id ?? '')}:${agentId}:${$agentSession$?.backendSessionId ?? $agentSession$?.acpSessionId ?? ''}`,
    );
    messageHydrationPolicy.setActive(isActive);
    if (!isActive) return;
    messageHydrationPolicy.updateMessages(messages);
    for (const message of messages) {
      messageHydrationPolicy.setForced(message.id, isMessageForceVisible(message.id));
    }
    lazyTurnHeightCache.retain(messages.map((message) => message.id));
    syncHydratedMessageIds();
  });

  function handleTurnEditStateChange(turnKey: string, isEditing: boolean) {
    temporaryTurnMaterialization = isEditing
      ? materializeTurn(temporaryTurnMaterialization, 'editing', turnKey)
      : releaseMaterializedTurn(temporaryTurnMaterialization, 'editing', turnKey);
  }

  function scheduleDeepOpenRelease(turnKey = deepOpenTurnKey) {
    if (deepOpenReleaseTimer !== null) clearTimeout(deepOpenReleaseTimer);
    if (!isActive) {
      deepOpenReleaseTimer = null;
      return;
    }
    deepOpenReleaseTimer = setTimeout(() => {
      if (!isActive) return;
      if (deepOpenTurnKey === turnKey) deepOpenTurnKey = null;
      deepOpenReleaseTimer = null;
    }, 200);
  }

  $effect(() => {
    if (isActive) return;
    if (deepOpenReleaseTimer !== null) clearTimeout(deepOpenReleaseTimer);
    deepOpenReleaseTimer = null;
    deepOpenTurnKey = null;
    untrack(() => clearDeepOpenHighlight?.());
  });

  // Force-render a message's turn through the LazyTurn virtualization (reuses
  // the deep-open force-visible key) and resolve its DOM element once rendered.
  // Drops follow so the placeholder expanding doesn't yank the viewport back
  // down. Retries across a few frames; resolves null if it never appears.
  async function forceRenderAndFindMessage(messageId: string): Promise<HTMLElement | null> {
    if (!isActive) return null;
    deepOpenTurnKey = messageIdToTurnKey.get(messageId) ?? messageId;
    shouldFollowBottom = false;
    await tick();
    if (!isActive) return null;
    const selector = `[data-message-id="${CSS.escape(messageId)}"]`;
    for (let attempt = 0; attempt < 5; attempt++) {
      await new Promise(requestAnimationFrame);
      if (!isActive) return null;
      const targetElement = scrollContainer?.querySelector(selector) as HTMLElement | null;
      if (targetElement) return targetElement;
    }
    logger.warn('[ChatPanel] Message turn not rendered after force-visible', { messageId });
    scheduleDeepOpenRelease();
    return null;
  }

  async function scrollToPendingProposal(): Promise<void> {
    const messageId = offscreenPendingProposalMessageId;
    const ref = pendingProposalRefs.find((candidate) => candidate.messageId === messageId);
    if (!messageId || !ref) return;
    if (!messageIdToTurnKey.has(messageId)) {
      if (!(await seekConversationToMessage(agentId, messageId)) || !isActive) return;
      await tick();
    }
    const message = await forceRenderAndFindMessage(messageId);
    if (!message || !isActive) return;
    await tick();
    if (!isActive) return;
    const target = findPendingProposalCard(message, ref) ?? message;
    smoothScrollTo(target, 'center');
    target.classList.add('highlight-flash');
    scheduleHighlightRemoval(target, 'highlight-flash', 1500);
    scheduleDeepOpenRelease();
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
    if (!isActive || isComponentDestroyed || !scrollContainer) return;
    const dividerElement = scrollContainer.querySelector(
      '[data-new-messages-divider]',
    ) as HTMLElement | null;
    const targetElement = dividerElement ?? anchorElement;
    if (!targetElement) {
      shouldFollowBottom = true;
      followToBottom(scrollContainer);
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
      followToBottom(scrollContainer);
      scheduleDeepOpenRelease();
      return;
    }
    // Land the divider's top edge at DIVIDER_ENTRY_VIEWPORT_FRACTION of the
    // viewport height from the top so most of the viewport shows unseen
    // content.
    const entryScrollTop = dividerEntryScrollTop(
      targetOffsetTop,
      scrollContainer.clientHeight,
      scrollContainer.scrollHeight,
    );
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      scrollContainer.scrollTop = entryScrollTop;
    } else {
      smoothScrollToPosition(entryScrollTop);
    }
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

  $effect(() => {
    if (isActive) return;
    untrack(() => clearDeepOpenHighlight?.());
  });

  async function handleOpenMessage(event: Event) {
    const detail = (event as CustomEvent).detail as
      { agentId: string; messageId: string; query?: string; requestId: string } | undefined;
    if (!isActive || !detail || detail.agentId !== agentId) return;
    // The helper dispatches on a retry ladder (the panel may still be
    // mounting); dedup so a successfully handled request runs exactly once.
    if (handledOpenMessageRequestIds.has(detail.requestId)) return;

    // Force-render the target's turn through the LazyTurn virtualization and
    // drop follow so streaming growth doesn't yank the viewport back down.
    deepOpenTurnKey = messageIdToTurnKey.get(detail.messageId) ?? detail.messageId;
    shouldFollowBottom = false;
    await tick();
    if (!isActive) return;
    scheduleActiveAnimationFrame(() => {
      if (!isActive) return;
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
      scheduleHighlightRemoval(targetElement, 'message-highlight-flash', 600);
      if (detail.query) applyDeepOpenQueryHighlight(targetElement, detail.query);
    });
  }

  $effect(() => {
    if (!isActive || typeof window === 'undefined') return;

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
    if (!isActive || typeof window === 'undefined') return;

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

  // The followBottom action is the only scroll authority. Its geometry callback
  // drives this damped control state without adding a second scroll listener.
  onMount(() => {
    scrollButtonVisibility = createScrollBottomButtonVisibility({
      atBottomThreshold: SCROLL_BOTTOM_THRESHOLD,
      onVisibilityChange: () => {},
      onRelock: flashLockConfirmation,
    });
    scrollButtonVisibility.update(distanceFromBottom);

    return () => {
      scrollButtonVisibility?.destroy();
      scrollButtonVisibility = null;
    };
  });
  function setPinnedPrompt(next: PinnedPromptState | null) {
    if (next?.id === pinnedPrompt?.id && next?.message === pinnedPrompt?.message) return;
    pinnedPrompt = next;
  }

  // Track container height for compact mode using ResizeObserver
  $effect(() => {
    if (!isActive) return;
    let destroyed = false;
    let readinessFrame: number | null = null;
    let observer: ResizeObserver | null = null;

    const setupWhenReady = () => {
      readinessFrame = null;
      if (destroyed) return;
      if (!scrollContainer || !composerElement) {
        readinessFrame = requestAnimationFrame(setupWhenReady);
        return;
      }
      observer = new ResizeObserver((entries) => {
        let scrollContainerResized = false;
        for (const entry of entries) {
          if (entry.target === scrollContainer) {
            const newHeight = entry.contentRect.height;
            if (newHeight !== containerHeight) {
              containerHeight = newHeight;
            }
            scrollContainerResized = true;
          } else if (entry.target === composerElement) {
            const newHeight = entry.contentRect.height;
            if (newHeight !== composerHeight) {
              composerHeight = newHeight;
            }
          }
        }
        if (scrollContainerResized && scrollContainer) {
          const gutterWidth = measureScrollbarGutterWidth(scrollContainer);
          if (gutterWidth !== scrollbarGutterWidth) {
            scrollbarGutterWidth = gutterWidth;
          }
        }
      });
      observer.observe(scrollContainer);
      observer.observe(composerElement);
    };
    readinessFrame = requestAnimationFrame(setupWhenReady);

    return () => {
      destroyed = true;
      if (readinessFrame !== null) cancelAnimationFrame(readinessFrame);
      observer?.disconnect();
    };
  });

  // Scroll to previous user-authored message from the current sticky one.
  // Automated rows (wakes, system, agent-origin) are skipped; when the
  // current message is itself automated, the walk starts from its position
  // in the full message order. No preceding user message → scroll to top.
  function scrollToPreviousUserMessage(currentMessageId: string) {
    if (!scrollContainer) return;

    const previousMessage = findPreviousUserMessage($agentMessages$, currentMessageId);

    if (!previousMessage) {
      // No preceding user-authored message - scroll to top
      smoothScrollToPosition(0);
      return;
    }
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
  let draftPromptApplyTimer: ReturnType<typeof setTimeout> | null = null;
  let draftPromptFlashTimer: ReturnType<typeof setTimeout> | null = null;

  function cancelDraftPromptTimers() {
    if (draftPromptApplyTimer !== null) clearTimeout(draftPromptApplyTimer);
    if (draftPromptFlashTimer !== null) clearTimeout(draftPromptFlashTimer);
    draftPromptApplyTimer = null;
    draftPromptFlashTimer = null;
    showInputFlash = false;
  }

  $effect(() => {
    void isActive;
    if (!isActive) cancelDraftPromptTimers();
    return cancelDraftPromptTimers;
  });

  // Handle draft prompt - pre-fill the input without sending
  $effect(() => {
    if (!isActive || !draftPrompt || draftPromptApplied || draftPromptApplyTimer !== null) return;
    if (!$agentSession$) return; // Wait for session to be ready

    // Pre-fill the input
    logger.info('[ChatPanel] Pre-filling input with draft prompt', {
      agentId,
      promptLength: draftPrompt.length,
    });

    // Use a small delay to ensure the input component is ready
    draftPromptApplyTimer = setTimeout(async () => {
      draftPromptApplyTimer = null;
      if (!isActive) return;
      inputValue = draftPrompt;
      await inputComponent?.setContent?.(draftPrompt);
      if (!isActive) return;
      inputComponent?.focus?.();
      draftPromptApplied = true;

      // Trigger subtle flash animation
      showInputFlash = true;
      draftPromptFlashTimer = setTimeout(() => {
        draftPromptFlashTimer = null;
        if (isActive) showInputFlash = false;
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
    transferPanelInterestLease(null);
    flushPendingDraftWrite();
    flushPendingSelectionWrites();
    cancelAllSendTransitions();
    if (lockConfirmationTimer !== null) {
      clearTimeout(lockConfirmationTimer);
      lockConfirmationTimer = null;
    }
    if (cachedScrollRestoreRetryFrame !== null) {
      cancelAnimationFrame(cachedScrollRestoreRetryFrame);
      cachedScrollRestoreRetryFrame = null;
    }
    for (const timer of highlightRemovalTimers) clearTimeout(timer);
    highlightRemovalTimers.clear();
    for (const frame of activeAnimationFrames) cancelAnimationFrame(frame);
    activeAnimationFrames.clear();

    // Cache the transcript scroll state so a remount restores the user's
    // reading position instead of re-entering at the bottom. Guarded
    // so a collapsed container or a pending (unconsumed) restore cannot
    // record a clamped ~0 scrollTop over a useful cached position.
    if (
      workspace?.id &&
      agentId &&
      scrollContainer &&
      $agentMessages$.length > 0 &&
      canRecordChatScroll(shouldFollowBottom)
    ) {
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
    searchHighlightRequest += 1;
    pendingSearchWork = null;
    if (searchDebounceTimer !== null) {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = null;
    }
    if (deepOpenReleaseTimer !== null) clearTimeout(deepOpenReleaseTimer);
    messageHydrationPolicy.dispose();
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
      lastUserMessage: lastUserMessage ? getPresentedUserMessageText(lastUserMessage) : undefined,
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
  function buildWorkspaceContextString(items: ContextItem[] = []): string {
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

    return appendContextItemContent(parts.join('\n'), items);
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
    // Scroll + follow re-lock must run synchronously, before any await: a
    // stalled or rejecting drafts.clear must never delay or skip them.
    if (options.followBottom) {
      shouldFollowBottom = true;
      if (scrollContainer) followToBottom(scrollContainer);
    }

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
      commitDraftWrite('');
      // Clear draft from backend when message is sent
      if (workspace && agentId) {
        await appClient.drafts.clear(workspace.id, agentId);
      }
    }
  }

  // Extract imageBlocks from any context item with imageData/imageMimeType
  // (file-type attachments and legacy inline-image items alike) plus
  // already-placed image items (attachmentId + imageMimeType → reference
  // arm, monorepo#3338), and attachment-reference fileBlocks from the
  // remaining placed-attachment items (file.placeAttachment — UUID +
  // metadata, no bytes). Inline image blocks are placed and swapped to
  // references by the send saga before the wire call.
  function extractAttachmentBlocks(items: ContextItem[]) {
    const imageBlocks = items
      .filter((item) => (item.imageData || item.attachmentId) && item.imageMimeType)
      .map((item) =>
        item.attachmentId
          ? {
              type: 'image' as const,
              attachmentId: item.attachmentId,
              // The neutral 'image' marker (reference restored without a
              // persisted mime) stays off the wire — mimeType is optional
              // on the reference arm.
              ...(item.imageMimeType!.includes('/') ? { mimeType: item.imageMimeType! } : {}),
            }
          : {
              type: 'image' as const,
              data: item.imageData!,
              mimeType: item.imageMimeType!,
            },
      );
    const fileBlocks = items
      .filter((item) => item.attachmentId && !item.imageMimeType)
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
    if (!workspace || !isActive) {
      logger.warn('[ChatPanel] Dropping send: panel has no workspace or is inactive', {
        agentId,
        hasWorkspace: !!workspace,
        isActive,
      });
      return;
    }
    flushPendingDraftWrite();

    const allContextItems = [...contextItems, ...inlineImageItems, ...mentionContextItems];
    const workspaceContextStr = buildWorkspaceContextString(allContextItems);
    const noteIds = currentMainPanelContext?.noteId ? [currentMainPanelContext.noteId] : undefined;

    const { imageBlocks, fileBlocks } = extractAttachmentBlocks(allContextItems);
    const userAppMessageId = prepareMessageSendTransition(text, {
      enabled: !$agentIsResponding$ && imageBlocks.length === 0 && fileBlocks.length === 0,
      followBottom: true,
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
      followBottom: true,
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

  // Handle retrying from a stalled turn: cancel it and re-send the same input
  // (monorepo#3402). The saga no-ops if the stall cleared before it runs.
  function handleStalledRetry() {
    if (!workspace) return;
    appStore.dispatch(agentSessionRetryFromStalledRequested(agentId, workspace.id));
  }

  // Retired sessions (PROTOCOL §5.5) are read-only: withhold the mutating
  // retry callbacks so StreamingStatus never renders Retry/Retry-with-model
  // or stalled-retry affordances that would hit the daemon's retired-session
  // guard.
  const gatedRetry = $derived(isRetiredSession ? undefined : handleRetry);
  const gatedRetryWithModel = $derived(isRetiredSession ? undefined : handleRetryWithModel);
  const gatedStalledRetry = $derived(isRetiredSession ? undefined : handleStalledRetry);

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

    // Persist only the specialist fields resolved by this picker change.
    const saveAction = saveAgentSessionRequested(workspace.id, agentId, true, {
      specialistUpdate: {
        specialist: specialistId,
        ...(specialistId && newModel !== undefined ? { model: newModel } : {}),
        ...(specialistId === null
          ? { systemPrompt: null }
          : behaviorPrompt !== undefined
            ? { systemPrompt: behaviorPrompt }
            : {}),
      },
      specialistRollback: { metadata: session.metadata, model: session.model },
    });
    appStore.dispatch(saveAction);
    // The mutation saga owns rollback and the user-visible error; observe the
    // rejection here so this component dispatch is not an unhandled promise.
    void saveAction.promise.catch((error) => {
      logger.error('Failed to persist agent specialist change', { agentId, error });
    });
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
    flushPendingDraftWrite();

    logger.info('Force submit triggered', { agentId });

    const allContextItems = [...contextItems, ...inlineImageItems, ...mentionContextItems];
    const workspaceContextStr = buildWorkspaceContextString(allContextItems);
    const noteIds = currentMainPanelContext?.noteId ? [currentMainPanelContext.noteId] : undefined;

    const { imageBlocks, fileBlocks } = extractAttachmentBlocks(allContextItems);
    const userAppMessageId = prepareMessageSendTransition(text, {
      enabled: imageBlocks.length === 0 && fileBlocks.length === 0,
      followBottom: true,
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
      followBottom: true,
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
      imageBlocks?: Array<{
        type: 'image';
        data?: string;
        mimeType?: string;
        attachmentId?: string;
      }>;
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
    // No launch-bubble transition on this path (there is no composer origin);
    // just re-engage auto-follow and scroll so the regeneration is visible.
    void performLocalSendCleanup({ followBottom: true });
  }

  // Handle regenerating from a specific assistant message
  function handleRegenerateFromMessage(assistantMessageId: string) {
    if (!workspace) return;
    appStore.dispatch(
      agentSessionRegenerateFromMessageRequested(agentId, workspace.id, assistantMessageId),
    );
  }

  // Handle selecting a suggested prompt - sends immediately
  function handleSelectSuggestedPrompt(prompt: string) {
    handleSend(prompt);
  }

  // Handle editing a suggested prompt - loads into input without sending
  async function handleEditSuggestedPrompt(prompt: string) {
    if (!isActive) return;
    inputValue = prompt;
    await inputComponent?.setContent?.(prompt);
    if (!isActive) return;
    inputComponent?.focus?.();
  }

  // Export functions for parent components
  export function focusPrompt(): boolean {
    if (!isActive) return false;
    const result = inputComponent?.focus?.() ?? false;
    if (result && typeof result === 'boolean') {
      onFocus?.();
      return result;
    }
    return false;
  }

  export function scrollToTop() {
    if (!isActive) return;
    smoothScrollToPosition(0);
  }

  export function scrollToBottom() {
    if (!isActive) return;
    const container = scrollContainer;
    if (!container) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      shouldFollowBottom = true;
      followToBottom(container);
      return;
    }
    shouldFollowBottom = false;
    animateScrollTo(
      () => (isActive && scrollContainer === container ? container : null),
      Math.max(0, container.scrollHeight - container.clientHeight),
      150,
      () => {
        if (!isActive || scrollContainer !== container) return;
        shouldFollowBottom = true;
        followToBottom(container);
      },
    );
  }

  export async function navigateToUserMessage(messageId: string): Promise<boolean> {
    if (!isActive) return false;
    if (!userMessageNavigationItems.some((message) => message.id === messageId)) return false;
    // Index-only row: the message is outside the loaded transcript (neither
    // the loaded scrollback nor the live tail — messageIdToTurnKey spans
    // both). Seek the page containing it (§5.5 aroundMessageId) and replace
    // the session, same as the deep-open helper; on failure (message deleted
    // / seek rejected) the helper logs and we bail, leaving the conversation
    // where it is. Resident rows scroll directly, keeping the tail intact.
    if (agentId && !messageIdToTurnKey.has(messageId)) {
      if (!(await seekConversationToMessage(agentId, messageId))) return false;
    }
    const targetElement = await forceRenderAndFindMessage(messageId);
    if (!isActive || !targetElement) return false;
    currentMessageIndex = getMessageIndex(messageId);
    smoothScrollTo(targetElement, 'start');
    targetElement.classList.add('message-highlight-flash');
    scheduleHighlightRemoval(targetElement, 'message-highlight-flash', 600);
    scheduleDeepOpenRelease();
    return true;
  }

  /**
   * Refresh the full-history user-message index (called when the navigator
   * popover opens). Single-flight; a daemon that predates the method
   * (unsupported) is remembered so reopen stays tail-only without refetching.
   * Other failures keep the cached index (or tail-only) silently.
   */
  export function refreshUserMessageIndex(): void {
    if (!isActive || userMessageIndexUnsupported || userMessageIndexFetchInFlight || !agentId)
      return;
    userMessageIndexFetchInFlight = true;
    void appClient.agents
      .listUserMessages(agentId)
      .then((result) => {
        if (!isActive) return;
        if (result.ok) {
          userMessageIndexItems = getUserMessageNavigationItemsFromIndex(result.items);
        } else if (result.unsupported) {
          userMessageIndexUnsupported = true;
        } else {
          logger.debug('Failed to refresh user-message index', { error: result.error });
        }
      })
      .finally(() => {
        userMessageIndexFetchInFlight = false;
      });
  }

  export function getMessages() {
    return $agentMessages$;
  }

  export function getNavigationState() {
    if (!isActive) {
      return {
        userMessageCount: $agentMessages$.filter((message) => message.role === 'user').length,
        currentMessageIndex: -1,
        isAtTop: false,
        isAtBottom: false,
      };
    }
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
    if (!isActive || typeof window === 'undefined') return;

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
    if (!isActive) return;
    const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
    if (
      isPanelFocused &&
      !isFocusInEditableElement(e.target as Element | null) &&
      matchesShortcut(e, getEffectiveShortcut('chat.focus-input'), isMac)
    ) {
      e.preventDefault();
      focusPrompt();
      return;
    }
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
    // While the switch-back reveal is deferred the chips are hidden, so their
    // shortcuts are inert too.
    if (isActive && isChatFocused && suggestedPrompts.length > 0 && !deferTranscriptReveal) {
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
  class="chat-panel-container group/panel flex flex-col h-full w-full min-w-0 relative z-20"
  role="region"
  aria-label={agentName}
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
  <!-- The regular Aurora belongs to the complete chat surface, not the inset
       composer lane. It inherits the real Panel radius for its own bottom clip. -->
  {#if isActive && $chatAuroraEnabled$ && $agentSessionIsStreaming$ && !isChiefWorkspace}
    <div
      class="composer-aurora-host regular-panel-aurora-host pointer-events-none absolute inset-x-0 bottom-0 z-0 overflow-hidden"
      style:height={`calc(${composerHeight}px + 10rem)`}
      data-testid="composer-aurora-host"
      transition:fade
    >
      <AuroraBackground {agentId} />
    </div>
  {/if}

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
      <!-- Gated behind the switch-back reveal deferral: `pinnedPrompt` is
           retained state from the pre-switch transcript (trackPinnedPrompt only
           clears it on a later animation frame after the turns unmount), so it
           would otherwise paint stale message content above the skeleton. -->
      {#if pinnedPrompt && !deferTranscriptReveal}
        <!-- Mirror the conversation column's horizontal padding plus the chief
             variant's user-row inset so the pinned bubble aligns with
             in-conversation user bubbles. -->
        <div
          class="chat-content-measure mx-auto w-full min-w-0 {isChiefWorkspace
            ? 'px-0'
            : 'px-4 sm:px-6'}"
          class:regular-chat-content-inset={!isChiefWorkspace}
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
    <!-- followBottom, native anchoring, and the LazyTurn ledger own scroll compensation. -->
    <div
      bind:this={scrollContainer}
      use:trackPinnedPrompt={{
        enabled: isActive && containerHeight >= 400,
        onChange: setPinnedPrompt,
      }}
      use:followBottom={{
        enabled: isActive,
        // While search is open we drive our own programmatic scrolls (to the
        // current match), so we drop `follow` to keep the mutation/resize
        // observers from yanking the viewport to the bottom when a LazyTurn
        // placeholder expands between us computing and applying the match's
        // scroll target.
        follow: shouldFollowBottom && !showSearch && $agentMessages$.length > 0,
        threshold: 100,
        layoutNeutralBottomAnchor: true,
        onFollowChange: (f) => {
          shouldFollowBottom = f;
        },
        onScrollStateChange: handleBottomStateChange,
      }}
      class="flex-1 {CHAT_TRANSCRIPT_OVERFLOW_CLASS}"
      class:agent-font-monospace={$isAgentMonospace}
      style="scrollbar-gutter: stable;"
      data-testid="chat-transcript-scroll-viewport"
    >
      <div
        class="conversation-column chat-content-measure mx-auto flex min-h-full w-full min-w-0 flex-col {isChiefWorkspace
          ? 'px-0'
          : 'px-4 pt-8 sm:px-6'} {transcriptBottomInsetClass}"
        class:regular-chat-content-inset={!isChiefWorkspace}
        data-testid="chat-transcript-inner"
        data-structural-recompute-count={transcriptStructure.recomputeCount}
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

        <!-- Indeterminate transcript skeleton rows — shared by the first-hydration
             branch and the switch-back reveal deferral so both windows paint the
             exact same visual. -->
        {#snippet transcriptSkeletonRows()}
          <div class="flex flex-col gap-4 p-4 w-full" data-testid="chat-transcript-skeleton">
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
        {/snippet}

        {#if transcriptHydrationFailed && $agentMessages$.length === 0}
          <div class="flex min-h-48 flex-col items-center justify-center gap-3 p-6 text-center">
            <p class="text-sm text-muted-foreground">{m.chat_shared_actionFailed_label()}</p>
            <Button variant="outline" onclick={handleRetryTranscriptHydration}>
              {m.chat_shared_retry_label()}
            </Button>
          </div>
        {:else if deferTranscriptReveal}
          <!-- Switch-back reveal deferral: the retained transcript may be stale
               while the re-opened subscription's seq-0 snapshot is in flight —
               hold the indeterminate skeleton so the transcript reveals in one
               paint (snapshot applied, subscription closed, or bounded fallback). -->
          {@render transcriptSkeletonRows()}
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
          <div class="workspace-setup-card-alignment pt-16 pb-6">
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
          <!-- Skeleton: initial newest-window hydration is unresolved (session
               not yet initialized or transcript still loading). -->
          {@render transcriptSkeletonRows()}
        {:else}
          <!-- Pending initial prompt - shown as optimistic UI immediately -->
          <!-- FIX: Keep showing pendingMessage until a USER message arrives in $agentMessages$ -->
          <!-- This prevents the flash where pendingMessage disappears but only assistant streaming content has arrived -->
          {@const hasUserMessage = transcriptStructure.hasUserMessage}
          {@const pendingCondition = pendingMessage && !hasUserMessage}
          {@const messagesCondition = hasUserMessage || $agentMessages$.length > 0}
          {#if pendingCondition}
            <!-- Get any streaming assistant messages to render alongside the pending user message -->
            {@const streamingAssistantMessageIds = transcriptStructure.assistantMessageIds}
            {#if initialPromptProp}
              <!-- No animation - parent already showed optimistic message, but we need to keep showing it -->
              <div class="w-full">
                {#if isInitialWorkspaceAgent && onboardingContext}
                  <div class="workspace-setup-card-alignment pt-16 pb-6">
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
                  <div class="message-nav-target z-10 mb-8 bg-transparent">
                    <ChatMessage
                      message={pendingMessage}
                      {workspace}
                      backendSessionId={auggieSessionId}
                    />
                  </div>

                  <!-- Render any streaming assistant messages -->
                  {#each streamingAssistantMessageIds as messageId, index (messageId)}
                    {@const isLastMessage = index === streamingAssistantMessageIds.length - 1}
                    {@const isCurrentlyStreaming = isLastMessage && $agentSessionIsStreaming$}
                    <div
                      data-message-id={messageId}
                      data-message-role="assistant"
                      class="message-nav-target"
                    >
                      <ChatMessage
                        {agentId}
                        {messageId}
                        ownsMessageIdentity={false}
                        {workspace}
                        isStreaming={isCurrentlyStreaming}
                        isLastConversationMessage={isLastMessage}
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
                          authGuidance={chatAuthGuidance}
                          sessionCorrupted={effectiveSessionCorrupted}
                          failedAt={effectiveFailedAt}
                          modelUnavailable={$chatModelUnavailable$}
                          {hasPendingPermission}
                          onRetry={gatedRetry}
                          onRetryWithModel={gatedRetryWithModel}
                          onStop={handleStop}
                          onStalledRetry={gatedStalledRetry}
                          seed={agentId}
                          statusEvents={$chatStatusEvents$}
                          streamingStartTime={$chatStreamingStartTime$}
                        />
                      </div>
                    {/if}
                  {/each}

                  <!-- Show streaming status while waiting for first assistant message -->
                  {#if streamingAssistantMessageIds.length === 0}
                    <div class="mb-4">
                      <StreamingStatus
                        isStreaming={$agentSessionIsStreaming$}
                        isProcessing={$agentIsResponding$}
                        lastChunkTime={$chatLastChunkTime$}
                        receivedFirstChunk={$chatReceivedFirstChunk$}
                        streamingContentLength={$chatStreamingContent$?.length ?? 0}
                        error={effectiveError}
                        authGuidance={chatAuthGuidance}
                        sessionCorrupted={effectiveSessionCorrupted}
                        failedAt={effectiveFailedAt}
                        modelUnavailable={$chatModelUnavailable$}
                        {hasPendingPermission}
                        onRetry={gatedRetry}
                        onRetryWithModel={gatedRetryWithModel}
                        onStop={handleStop}
                        onStalledRetry={gatedStalledRetry}
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
                  <div class="workspace-setup-card-alignment pt-16 pb-6">
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
                  <div class="message-nav-target z-10 mb-8">
                    <ChatMessage
                      message={pendingMessage}
                      {workspace}
                      backendSessionId={auggieSessionId}
                    />
                  </div>

                  <!-- Render any streaming assistant messages -->
                  {#each streamingAssistantMessageIds as messageId, index (messageId)}
                    {@const isLastMessage = index === streamingAssistantMessageIds.length - 1}
                    {@const isCurrentlyStreaming = isLastMessage && $agentSessionIsStreaming$}
                    <div
                      data-message-id={messageId}
                      data-message-role="assistant"
                      class="message-nav-target"
                    >
                      <ChatMessage
                        {agentId}
                        {messageId}
                        ownsMessageIdentity={false}
                        {workspace}
                        isStreaming={isCurrentlyStreaming}
                        isLastConversationMessage={isLastMessage}
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
                          authGuidance={chatAuthGuidance}
                          sessionCorrupted={effectiveSessionCorrupted}
                          failedAt={effectiveFailedAt}
                          modelUnavailable={$chatModelUnavailable$}
                          {hasPendingPermission}
                          onRetry={gatedRetry}
                          onRetryWithModel={gatedRetryWithModel}
                          onStop={handleStop}
                          onStalledRetry={gatedStalledRetry}
                          seed={agentId}
                          statusEvents={$chatStatusEvents$}
                          streamingStartTime={$chatStreamingStartTime$}
                        />
                      </div>
                    {/if}
                  {/each}

                  <!-- Show streaming status while waiting for first assistant message -->
                  {#if streamingAssistantMessageIds.length === 0}
                    <div class="mb-4">
                      <StreamingStatus
                        isStreaming={$agentSessionIsStreaming$}
                        isProcessing={$agentIsResponding$}
                        lastChunkTime={$chatLastChunkTime$}
                        receivedFirstChunk={$chatReceivedFirstChunk$}
                        streamingContentLength={$chatStreamingContent$?.length ?? 0}
                        error={effectiveError}
                        authGuidance={chatAuthGuidance}
                        sessionCorrupted={effectiveSessionCorrupted}
                        failedAt={effectiveFailedAt}
                        modelUnavailable={$chatModelUnavailable$}
                        {hasPendingPermission}
                        onRetry={gatedRetry}
                        onRetryWithModel={gatedRetryWithModel}
                        onStop={handleStop}
                        onStalledRetry={gatedStalledRetry}
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
                  authGuidance={chatAuthGuidance}
                  sessionCorrupted={effectiveSessionCorrupted}
                  failedAt={effectiveFailedAt}
                  modelUnavailable={$chatModelUnavailable$}
                  {hasPendingPermission}
                  onRetry={gatedRetry}
                  onRetryWithModel={gatedRetryWithModel}
                  onStop={handleStop}
                  onStalledRetry={gatedStalledRetry}
                  seed={agentId}
                  statusEvents={$chatStatusEvents$}
                  streamingStartTime={$chatStreamingStartTime$}
                  class={effectiveError ? 'mt-0' : undefined}
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
              <!-- Virtual scrollback spacer: estimated extent of the unloaded
                   rows above the resident window, so the scrollbar represents
                   the full conversation (see estimateVirtualSpacerHeight).
                   Shrinks as real rows land; absent when everything is
                   resident or totalMessages is unknown. -->
              {#if virtualSpacerHeight > 0}
                <div
                  style="height: {virtualSpacerHeight}px;"
                  data-testid="chat-virtual-scrollback-spacer"
                  aria-hidden="true"
                ></div>
              {/if}
              <!-- Workspace intro card: conversation-start chrome. Gated on
                   the TRUE START being resident — mid-history (older rows
                   still above the resident window) it must not render, or it
                   falsely signals the beginning of the conversation; the
                   older-history loading affordance below renders instead. -->
              {#if isInitialWorkspaceAgent && onboardingContext && conversationStartLoaded}
                <div class="workspace-setup-card-alignment pt-16 pb-6">
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
              <!-- Older-history loading affordance: small top indicator while
                   the on-demand scrollback walk is active. Chain-scoped, not
                   per-fetch: it stays up across the settle-chain gaps between
                   pages and hides after a short quiet window once the walk
                   stops (see syncOlderHistoryIndicator). -->
              {#if olderHistoryIndicatorVisible}
                <div
                  class="flex items-center justify-center gap-2 py-2 text-xs text-muted-foreground"
                  data-testid="chat-older-history-loading"
                  aria-live="polite"
                >
                  <Fa icon={faSpinner} class="animate-spin" size="xs" />
                  <span>{m.chat_chatPanel_loadingOlderMessages_label()}</span>
                </div>
              {/if}
              <!-- PERF: Use keyed each blocks for efficient list diffing.
                   Group key is the composition's stable segment+day key
                   (falling back to the calendar day) so a same-day
                   older-history prepend (which changes the group's first
                   message) does not destroy and recreate the group's
                   rendered turns. -->
              {#each conversationTurnIndex.groups as indexedGroup, groupIndex (indexedGroup.group.groupKey ?? dateGroupKeys[groupIndex] ?? groupIndex)}
                {@const turns = indexedGroup.turns}
                <!-- History→tail hole: affordance renders between the last
                     history group and the first tail group. The sentinel
                     dispatches a gap-refill page when scrolled near, and the
                     button is the click-to-load fallback. -->
                {#if groupIndex === historyGapBeforeGroupIndex}
                  <div
                    bind:this={historyGapSentinel}
                    class="flex items-center justify-center py-3"
                    data-testid="chat-history-gap"
                  >
                    {#if $fetchingGapFill$}
                      <div
                        class="flex items-center gap-2 text-xs text-muted-foreground"
                        aria-live="polite"
                      >
                        <Fa icon={faSpinner} class="animate-spin" size="xs" />
                        <span>{m.chat_chatPanel_historyGapLoading_label()}</span>
                      </div>
                    {:else}
                      <Button
                        variant="outline"
                        size="sm"
                        class="text-xs text-muted-foreground"
                        data-testid="chat-history-gap-load-button"
                        onclick={requestHistoryGapFill}
                      >
                        {m.chat_chatPanel_historyGapLoad_label()}
                      </Button>
                    {/if}
                  </div>
                  <!-- Virtual below-spacer: estimated extent of the unloaded
                       rows inside the history→tail hole (seek-seeded
                       segments), so the scrollbar keeps representing the
                       full conversation after a far-flick landing. Renders
                       AFTER the gap affordance: walking down from the
                       landing refills via the sentinel above, while a far
                       position inside this spacer re-seeks. -->
                  {#if virtualSpacerBelowHeight > 0}
                    <div
                      bind:this={belowSpacerEl}
                      style="height: {virtualSpacerBelowHeight}px;"
                      data-testid="chat-virtual-scrollback-spacer-below"
                      aria-hidden="true"
                    ></div>
                  {/if}
                {/if}
                {#each turns as turn, turnIndex (turn.userMessage?.id ?? `turn-${turnIndex}`)}
                  {@const turnKey =
                    turn.userMessage?.id ??
                    `group-${indexedGroup.group.groupKey ?? groupIndex}-turn-${turnIndex}`}
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
                  {@const nextTurnHasUserMessage = Boolean(
                    nextTurn?.userMessage && !nextTurnIsEventNotification,
                  )}
                  {@const isLastTurnInConversation =
                    globalTurnIndexMap.get(turnKey) === globalTurnIndexMap.size - 1}
                  {@const compactOperationalTurnBoundary = hasOperationalAssistantTurnBoundary(
                    turn,
                    nextTurn,
                  )}
                  {@const zeroOperationalTurnBoundary = compactOperationalTurnBoundary}
                  {@const attentionQuestionAnswerTurnSeam = isAttentionQuestionAnswerSeam(
                    turn,
                    nextTurn,
                  )}
                  <!-- Adjacent user rows sharing queueInfo.batchId (one batch
                       flush) get a compact seam — covers plain user messages
                       AND wake/event-notification cards on either side. The
                       structured attention-to-answer flow has its own rhythm. -->
                  {@const batchedDeliveryTurnSeam =
                    !attentionQuestionAnswerTurnSeam && isBatchedDeliverySeam(turn, nextTurn)}
                  <!-- Seam BEFORE this turn: the same batch test against the
                       previous rendered turn (crossing group boundaries like
                       nextTurn). When true, the preceding h-2 gap owns the
                       seam and this turn's rows drop their own top margins. -->
                  {@const prevTurn =
                    turns[turnIndex - 1] ??
                    conversationTurnIndex.groups[groupIndex - 1]?.turns.at(-1)}
                  {@const batchedSeamBefore = Boolean(
                    prevTurn &&
                    !isAttentionQuestionAnswerSeam(prevTurn, turn) &&
                    isBatchedDeliverySeam(prevTurn, turn),
                  )}
                  <!-- Conversation turn container - constrains sticky behavior -->
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
                        class="message-nav-target relative z-10 {eventCardAssistantMarginClass(
                          message,
                          turn.assistantMessages.length > 0,
                        )}"
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
                          suppressTopGap={batchedSeamBefore}
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
                      <!-- Outer div stays always mounted: it carries the nav/
                           pinned-prompt/send-transition anchors (data attributes
                           and geometry) that scroll restoration and the pinned
                           prompt overlay query even while the row's content is a
                           virtualized placeholder. Only the inner ChatMessage
                           goes through LazyTurn. -->
                      <div
                        data-message-id={message.id}
                        data-message-role="user"
                        data-pinnable-user-prompt={!isAutomatedMessage(message) ? '' : undefined}
                        data-pinned-prompt-id={message.id}
                        data-send-app-message-id={message.appMessageId}
                        data-message-index={globalIndex}
                        class="message-nav-target relative z-20"
                        class:mb-0={batchedDeliveryTurnSeam}
                        class:mb-5={!batchedDeliveryTurnSeam && isAutomatedMessage(message)}
                        class:mb-7={!batchedDeliveryTurnSeam && !isAutomatedMessage(message)}
                        class:invisible={pendingSendMessageIds.has(
                          String(message.appMessageId ?? ''),
                        )}
                        use:attachPinnedPromptMessage={message}
                      >
                        <LazyTurn
                          turnKey={message.id}
                          scrollRoot={scrollContainer}
                          heightCache={lazyTurnHeightCache}
                          hydrationController={messageHydrationPolicy}
                          hydrated={hydratedMessageIds.has(message.id)}
                          forceVisible={isMessageForceVisible(message.id)}
                          estimatedHeight={USER_ROW_ESTIMATED_HEIGHT}
                        >
                          {#snippet children()}
                            <div class={isChiefWorkspace ? 'mx-1 sm:mx-2' : ''}>
                              <ChatMessage
                                {agentId}
                                messageId={message.id}
                                ownsMessageIdentity={false}
                                {workspace}
                                onEditSubmit={isRetiredSession
                                  ? undefined
                                  : (newText, model, blocks) =>
                                      handleEditMessage(message.id, newText, model, blocks)}
                                onEditStateChange={(isEditing) =>
                                  handleTurnEditStateChange(turnKey, isEditing)}
                                editModel={turn.assistantMessages[0]?.metadata?.model ??
                                  hydratedInputModel}
                                onScrollToPrevious={() => scrollToPreviousUserMessage(message.id)}
                                backendSessionId={auggieSessionId}
                                suppressAutomatedWakeTopSpacing={batchedSeamBefore}
                              />
                            </div>
                          {/snippet}
                        </LazyTurn>
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
                        {@render newMessagesDividerAfter(noticeMessage.id, dividerAtTurnBoundary)}
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
                          authGuidance={chatAuthGuidance}
                          sessionCorrupted={effectiveSessionCorrupted}
                          failedAt={effectiveFailedAt}
                          modelUnavailable={$chatModelUnavailable$}
                          {hasPendingPermission}
                          onRetry={gatedRetry}
                          onRetryWithModel={gatedRetryWithModel}
                          onStop={handleStop}
                          onStalledRetry={gatedStalledRetry}
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
                        groupIndex === groupedMessages.length - 1 && turnIndex === turns.length - 1}
                      {@const isLastAssistant =
                        assistantIndex === turn.assistantMessages.length - 1}
                      {@const isLastMessage = isLastTurn && isLastAssistant}
                      {@const isCurrentlyStreaming = isLastMessage && $agentSessionIsStreaming$}
                      {@const compactPreviousMessageBoundary =
                        hasOperationalAssistantMessageBoundary(
                          turn.assistantMessages[assistantIndex - 1],
                          message,
                        )}
                      {@const compactNextMessageBoundary = hasOperationalAssistantMessageBoundary(
                        message,
                        turn.assistantMessages[assistantIndex + 1],
                      )}
                      {@const turnNumber = getMessageTurnNumber(message.id)}
                      {@const globalIndex = getMessageIndex(message.id)}
                      <LazyTurn
                        turnKey={message.id}
                        scrollRoot={scrollContainer}
                        heightCache={lazyTurnHeightCache}
                        hydrationController={messageHydrationPolicy}
                        hydrated={hydratedMessageIds.has(message.id)}
                        forceVisible={isMessageForceVisible(message.id)}
                      >
                        {#snippet children()}
                          <div
                            data-message-id={message.id}
                            data-message-role="assistant"
                            data-message-index={globalIndex}
                            data-turn-number={turnNumber}
                            class="message-nav-target"
                            data-operational-message-seam={compactPreviousMessageBoundary
                              ? 'true'
                              : undefined}
                          >
                            <ChatMessage
                              {agentId}
                              messageId={message.id}
                              ownsMessageIdentity={false}
                              {workspace}
                              isStreaming={isCurrentlyStreaming}
                              isLastConversationMessage={isLastMessage}
                              onEditSubmit={isRetiredSession
                                ? undefined
                                : (newText, model, blocks) =>
                                    handleEditMessage(message.id, newText, model, blocks)}
                              onRegenerate={isRetiredSession
                                ? undefined
                                : () => handleRegenerateFromMessage(message.id)}
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
                                authGuidance={chatAuthGuidance}
                                sessionCorrupted={effectiveSessionCorrupted}
                                failedAt={effectiveFailedAt}
                                modelUnavailable={$chatModelUnavailable$}
                                {hasPendingPermission}
                                onRetry={gatedRetry}
                                onRetryWithModel={gatedRetryWithModel}
                                onStop={handleStop}
                                onStalledRetry={gatedStalledRetry}
                                seed={agentId}
                                statusEvents={$chatStatusEvents$}
                                streamingStartTime={$chatStreamingStartTime$}
                              />
                            </div>
                          {/if}
                          <!-- Show file changes after each assistant turn -->
                          <div
                            class="w-full"
                            class:mb-1={!compactNextMessageBoundary &&
                              !(isLastAssistant && compactOperationalTurnBoundary) &&
                              !(isLastAssistant && nextTurnHasUserMessage)}
                            data-after-assistant-message={message.id}
                          >
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
                        {/snippet}
                      </LazyTurn>
                      {@render newMessagesDividerAfter(message.id, dividerAtTurnBoundary)}
                    {/each}
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
                      nextHasUserMessage={nextTurnHasUserMessage}
                      compactOperationalSeam={compactOperationalTurnBoundary}
                      zeroToolSeam={zeroOperationalTurnBoundary}
                      batchedDeliverySeam={batchedDeliveryTurnSeam}
                      attentionQuestionAnswerSeam={attentionQuestionAnswerTurnSeam}
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
                <div
                  class="pt-1 {isCompactMode ? 'mb-2' : 'mb-16'}"
                  data-testid="end-of-list-streaming-status"
                >
                  <StreamingStatus
                    isStreaming={$agentSessionIsStreaming$}
                    isProcessing={$agentIsResponding$}
                    lastChunkTime={$chatLastChunkTime$}
                    receivedFirstChunk={$chatReceivedFirstChunk$}
                    streamingContentLength={$chatStreamingContent$?.length ?? 0}
                    error={effectiveError}
                    authGuidance={chatAuthGuidance}
                    sessionCorrupted={effectiveSessionCorrupted}
                    failedAt={effectiveFailedAt}
                    modelUnavailable={$chatModelUnavailable$}
                    {hasPendingPermission}
                    onRetry={gatedRetry}
                    onRetryWithModel={gatedRetryWithModel}
                    onStop={handleStop}
                    onStalledRetry={gatedStalledRetry}
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
        {#if showAggregateFileChangesSummary && !deferTranscriptReveal}
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
        {#if suggestedPrompts.length > 0 && !deferTranscriptReveal}
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
             preventing stale utility UI from leaking across switches.
             Hidden until transcript hydration settles; the workspace-task
             task progress is routed to the panel header instead. -->
          {#if workspace?.id && showTranscriptUtilityCard}
            {#key `${workspace.id}::${agentId}`}
              <EventSubscriptionsCard
                workspaceId={workspace.id}
                {agentId}
                compact={isCompactMode}
                bind:visible={hasVisibleTranscriptUtility}
              />
            {/key}
          {/if}

          <!-- Queued messages remain in the same scroll/follow surface.
               Hidden on retired sessions: the queue's edit/remove/send-now
               controls all mutate daemon state a retired agent rejects. -->
          {#if queuedMessagesVisibility.showQueue && !isRetiredSession}
            <div
              class="relative z-20 mt-6 {isChiefWorkspace ? 'mx-1 sm:mx-2' : 'w-full'}"
              data-testid="queued-message-utility-area"
            >
              <QueuedMessageList
                bind:this={queuedMessageListRef}
                messages={visibleQueuedMessages}
                onedit={handleEditQueuedMessage}
                onremove={handleRemoveQueuedMessage}
                onsendnow={handleSendQueuedMessageNow}
                ondone={() => inputComponent?.focus?.()}
              />
            </div>
          {/if}
        </div>

        <!-- Zero-size semantic end marker; followBottom owns exact bottom anchoring. -->
        <div class={CHAT_SCROLL_END_MARKER_CLASS} data-testid="chat-scroll-end-marker"></div>
      </div>
    </div>
    {#if showLockConfirmation}
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
    class="conversation-composer relative z-10 w-full"
    class:chief-composer={isChiefWorkspace}
    class:input-flash={showInputFlash}
    data-streaming={$agentSessionIsStreaming$}
    data-testid="chat-composer-shell"
  >
    <!-- Aurora northern lights effect during streaming. The regular host is owned
         by the complete chat surface above. The chief variant remains composer-owned
         and bleeds further left/bottom so the shader crosses the
         ChiefCard px-2 inset and the sidebar frame's pl-2/pb-2 window inset (the
         ancestors clip with an 8px overflow-clip-margin), touching the app window's
         left/bottom edges. -->
    {#if isActive && $chatAuroraEnabled$ && $agentSessionIsStreaming$ && isChiefWorkspace}
      <div
        class="composer-aurora-host pointer-events-none absolute -left-4 -right-2 -bottom-4 z-0 overflow-hidden"
        style="height: calc(100% + 10rem);"
        data-testid="composer-aurora-host"
        transition:fade
      >
        <AuroraBackground {agentId} />
      </div>
    {/if}

    <div
      class="composer-prompt-layer relative z-10 w-full"
      style:padding-inline-end="{scrollbarGutterWidth}px"
      data-testid="composer-prompt-layer"
      data-has-transcript-utility={hasVisibleTranscriptUtility}
    >
      <div
        class="composer-prompt-lane chat-content-measure mx-auto w-full min-w-0"
        data-testid="chat-composer-lane"
      >
        <div
          class="w-full min-w-0"
          data-testid="chat-composer-controls-inner"
          onfocusout={flushPendingDraftWrite}
        >
          {#if isRetiredSession}
            <div
              class="flex w-full items-center justify-between gap-3 px-4 py-3 text-sm text-muted-foreground sm:px-6"
              data-testid="chat-retired-banner"
            >
              <span class="min-w-0 truncate">{m.chat_chatPanel_retiredReadOnly_label()}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="chat-retired-restore"
                onclick={() => {
                  if (workspace?.id && agentId) {
                    appStore.dispatch(restoreRetiredAgentRequested(workspace.id, agentId));
                  }
                }}
              >
                {m.workspace_agentsList_restoreRetired_button()}
              </Button>
            </div>
          {:else}
            {#if offscreenPendingProposalMessageId}
              <div
                class="flex w-full justify-center px-4 pb-2"
                data-testid="pending-proposal-chip-slot"
              >
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  class="h-7 rounded-full bg-background px-3 type-caption shadow-sm"
                  data-testid="pending-proposal-chip"
                  onclick={scrollToPendingProposal}
                >
                  {m.chat_proposalTray_title()}
                </Button>
              </div>
            {/if}
            {#if pendingQuestions}
              {#key pendingQuestions.messageId}
                <div class="w-full" data-testid="question-wizard-slot">
                  <QuestionWizard
                    questions={pendingQuestions.questions}
                    draftKey={wizardDraftKey(agentId, pendingQuestions.messageId)}
                    collapsed={questionWizardCollapsed}
                    onToggleCollapsed={(collapsed) => {
                      // Can be invoked around the teardown frame after the
                      // pending-questions source is already nulled.
                      if (!pendingQuestions) return;
                      questionWizardCollapsedOverride = {
                        messageId: pendingQuestions.messageId,
                        collapsed,
                      };
                      saveWizardCollapsed(
                        wizardDraftKey(agentId, pendingQuestions.messageId),
                        collapsed,
                      );
                    }}
                    onComplete={handleQuestionWizardComplete}
                    onDismiss={handleQuestionWizardDismiss}
                  />
                </div>
              {/key}
            {/if}
            {#if (!pendingQuestions && !pendingQuestionRecoveryLoading) || questionWizardCollapsed}
              {#if draftManager.gateVisible}
                <ChatDraftLoadingGate />
              {/if}
              <SimpleRichInput
                bind:this={inputComponent}
                bind:contextItems
                bind:value={inputValue}
                onvaluechange={(value) => {
                  scheduleDraftWrite(value);
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
                editorClassName={isChiefWorkspace
                  ? 'w-full px-3!'
                  : 'regular-composer-content-inset w-full'}
                contentInsetClassName={isChiefWorkspace
                  ? 'w-full px-3'
                  : 'regular-composer-content-inset w-full'}
                actionBarEndClassName={isChiefWorkspace
                  ? 'pr-3!'
                  : 'regular-composer-content-inset'}
                edgeDocked
                externalDropTarget
                requiresModelSwitchConfirmation={!canChangeProvider}
                providerId={inputProviderId}
              />
            {/if}
          {/if}
        </div>
      </div>
    </div>
  </div>
</div>

<style>
  .chat-panel-container {
    container: chat-panel / inline-size;
  }

  .regular-chat-content-inset {
    padding-left: 1rem;
    padding-right: 1rem;
  }

  :global(.regular-composer-content-inset) {
    padding-right: 1rem !important;
    padding-left: 1rem !important;
  }

  .workspace-setup-card-alignment {
    --chat-operational-row-inline-padding: 0.5rem;
    --chat-operational-leading-gap: 0.5rem;
    margin-left: -0.5rem;
    text-align: left;
  }

  @container chat-panel (max-width: 639.98px) {
    .regular-chat-content-inset {
      --chat-operational-row-inline-padding: 0.125rem;
      --chat-operational-leading-gap: 0.625rem;
    }

    .workspace-setup-card-alignment {
      margin-left: 1.5rem;
    }
  }

  @container chat-panel (min-width: 640px) {
    .regular-chat-content-inset {
      padding-left: 3.1rem;
      padding-right: 3.1rem;
    }

    :global(.regular-composer-content-inset) {
      padding-right: 1.5rem !important;
      padding-left: 1.5rem !important;
    }
  }

  .regular-panel-aurora-host {
    border-bottom-left-radius: var(--panel-shell-radius);
    border-bottom-right-radius: var(--panel-shell-radius);
  }

  .chat-content-measure {
    max-width: 140em;
  }

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

  .conversation-composer {
    --composer-lane-inset-x: 1rem;
    --composer-lane-inset-bottom: 1rem;
  }

  .conversation-composer.chief-composer {
    --composer-lane-inset-x: 0;
    --composer-lane-inset-bottom: 0.25rem;
  }

  .composer-prompt-lane {
    padding: 0.5rem var(--composer-lane-inset-x) var(--composer-lane-inset-bottom);
  }

  @container chat-panel (min-width: 640px) {
    .conversation-composer {
      --composer-lane-inset-x: 1.5rem;
      --composer-lane-inset-bottom: 1.5rem;
    }

    .conversation-composer.chief-composer {
      --composer-lane-inset-x: 0;
      --composer-lane-inset-bottom: 0.5rem;
    }
  }

  /* The prompt lane owns the outer inset around the nested composer surface. */
  .composer-prompt-layer :global(.rich-input-container) {
    border-top-width: 0;
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
