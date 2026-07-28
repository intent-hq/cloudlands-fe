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
   * - agentModel: AI model to use (default: DEFAULT_AGENT_MODEL)
   * - isInitialWorkspaceAgent: Whether this is the first agent in a new workspace
   * - isNewWorkspace: Whether this is a newly created workspace
   * - onClose: Callback when chat is closed
   * - onFocus: Callback when chat gains focus
   * - onChatUpdate: Callback for chat state updates
   */

  import {
  onMount,
  onDestroy,
  untrack,
  tick,
} from 'svelte';
  import { writable } from 'svelte/store';
  import { WorkspaceRebindTracker } from './workspace-rebind-tracker';
  import type { AgentMessage } from '$shared/types';
  import { saveAgentSessionRequested } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
  import {
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
  selectTranscriptHydration,
} from '$store/renderer/slices/chat-state/chat-state-selectors';
  import { selectWorkspaceNavigationMainPanel } from '$store/renderer/slices/workspace-navigation/workspace-navigation-selectors';
  import { appClient } from '$lib/client';

  import { selectTasksForAgent } from '$store/renderer/slices/task-agent-associations/task-agent-associations-selectors';
  import type { TaskAgentAssociation } from '$store/renderer/slices/task-agent-associations/task-agent-associations-types';
  import type { Workspace, AgentMetadata } from '$shared/types';
  import {
  extractAllContent,
  type SuggestedPrompt,
  AgentStatus,
} from '$shared/types';
  import { DEFAULT_AGENT_MODEL } from '$shared/constants/agent-services';
  import type { ContextItem } from './input/context-api';
  import {
    deserializeDraftAttachments,
    serializeDraftAttachments,
  } from './chat-draft-attachments';
  import SimpleRichInput from './input/SimpleRichInput.svelte';
  import ChatMessage from './ChatMessage.svelte';
  import DateSeparator from './DateSeparator.svelte';
  import EventWakeupBanner from './EventWakeupBanner.svelte';
  import { parseAgentEvents } from './event-wake-summary';
  import AgentCard from './AgentCard.svelte';
  import { toast } from 'svelte-sonner';
  import { m } from '$shared/paraglide/messages.js';
  import { isDelegatedBackgroundTaskSession } from '$shared/utils/agent-session-metadata';
  import StreamingStatus from './StreamingStatus.svelte';
  import RegularAgentWelcome from './RegularAgentWelcome.svelte';
  import ChiefChatEmptyState from './ChiefChatEmptyState.svelte';

  import SuggestedPrompts from './SuggestedPrompts.svelte';
  import QuestionWizard, {
  type QuestionAnswer,
} from './questions/QuestionWizard.svelte';
  import { deriveWizardPendingQuestions } from './questions/wizard-gate';
  import { flattenAnswersToMessage } from './questions/answer-message';
  import { groupMessagesByDate } from '$lib/utils/timeFormatting';
  import {
  followBottom,
  scrollToBottom as scrollToBottomUtil,
} from '$lib/utils/smartScroll';
  import { createLogger } from '$lib/utils/client-logger';
  import { isFocusInTerminal } from '$lib/utils/keyboardShortcuts';
  import Fa from 'svelte-fa';
  import { formatDistanceToNow } from '$lib/utils/date';
  import {
  faArrowDown,
  faSquareCheck,
  faLock,
  faLockOpen,
} from '@fortawesome/free-solid-svg-icons';
  import {
  fade,
  slide,
} from 'svelte/transition';
  import { navigateToTask } from '$lib/utils/workspace-navigation';
  import { openTerminalTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
  import ChatFileChangesSummary from './ChatFileChangesSummary.svelte';
  import AutoCommitStatus, { type CommitStatus } from './AutoCommitStatus.svelte';
  import QueuedMessageList from './QueuedMessageList.svelte';
  import Button from '../ui/button/button.svelte';
  import { PanelFindBar } from '$lib/components/ui/panel-find-bar';
  import { getSelectedTextWithinSurface } from '$lib/utils/selected-text';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import AgentSubscriptions from './AgentSubscriptions.svelte';
  import {
  groupContentBlocks,
  parseSuggestedPrompts,
} from '$lib/utils/messageParser';

  import LazyTurn from './LazyTurn.svelte';
  import InlinePermissionRequest from './InlinePermissionRequest.svelte';
  import { selectPermissionRequests } from '$store/renderer/slices/permission/permission-selectors';
  import { selectIsAgentMonospace } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import {
  markAgentAsViewed,
  clearCurrentlyViewedAgent,
} from '$store/renderer/slices/unread-tracking/unread-tracking-slice';
  import AuroraBackground from './AuroraBackground.svelte';
  import {
  invoke,
  listenSync,
} from '$lib/electron-bridge';
  import {
  selectSpecialists,
  selectEffectiveBehaviorPrompt,
  selectEffectiveModel,
} from '$store/renderer/slices/specialists/specialists-selectors';

  import { getAgentProvider } from '$shared/types/agent-session';
  import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
  import { canChangeAgentProvider as resolveCanChangeAgentProvider } from './provider-lock';
  import ModelChangeNotice from './ModelChangeNotice.svelte';
  import { getModelChangeNotice } from './model-change-notice';
  import { resolveHydratedInputModel } from './input-hydration';
  import {
  shouldShowEndOfListStreamingStatus,
  shouldShowPendingAssistantStatus,
} from './chat-panel-visibility';
  import WorkspaceSetupCard from '$features/onboarding/messages/WorkspaceSetupCard.svelte';
  import { store as appStore } from '$store/renderer/store';

  const logger = createLogger('ChatPanel');

  const isAgentMonospace = selectIsAgentMonospace();

  // Constants
  const SCROLL_BOTTOM_THRESHOLD = 30; // pixels from bottom to consider "at bottom"
  /** PERF: Number of recent turns to always render (for streaming and smooth UX) */
  const FORCE_VISIBLE_TURN_COUNT = 3;
  /** PERF: Minimum turns before enabling lazy loading (overhead not worth it for small conversations) */
  const LAZY_TURN_THRESHOLD = 10;

  /**
   * Format message content for sticky header display.
   * Extracts context reference labels and cleans up raw @context[...] patterns.
   */
  function formatMessageForStickyHeader(message: AgentMessage): string {
    const rawText = extractAllContent(message);

    // Get context references from metadata
    const contextRefs = message.metadata?.contextReferences as
      | Array<{ provider?: string; identifier?: string; title?: string }>
      | undefined;

    // Build labels from context references
    const pillLabels: string[] = [];
    if (contextRefs && contextRefs.length > 0) {
      for (const ref of contextRefs) {
        const label = ref.title || ref.identifier || m.chat_shared_context_fallback();
        pillLabels.push(`🔗 ${label}`);
      }
    }

    // Strip out @context[...] patterns from raw text
    const cleanText = rawText.replace(/@context\[[^\]]*\]/g, '').trim();

    // Combine pills and clean text
    if (pillLabels.length > 0 && cleanText) {
      return `${pillLabels.join(' ')} — ${cleanText}`;
    } else if (pillLabels.length > 0) {
      return pillLabels.join(' ');
    } else {
      return cleanText || rawText;
    }
  }

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
    agentModel = DEFAULT_AGENT_MODEL,
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

  // True when this panel is rendering the Chief of Staff workspace, which uses a
  // dedicated empty state instead of the specialist picker welcome.
  const isChiefWorkspace = $derived(workspace?.id === CHIEF_WORKSPACE_ID);

  // Writable store mirroring workspace.id so Redux selectors re-evaluate reactively
  const workspaceIdStore = writable(workspace?.id ?? '');
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
  const isDelegatedBackgroundTaskAgent = $derived(
    isDelegatedBackgroundTaskSession($agentSession$),
  );

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
  logger.debug('[ChatPanel] INSTANCE CREATED', { instanceId, agentId });

  let scrollContainer = $state<HTMLDivElement>();
  let inputComponent = $state<SimpleRichInput>();
  let shouldFollowBottom = $state(true);
  let isScrollUnlocked = $state(false); // User manually unlocked auto-scroll while at bottom
  let distanceFromBottom = $state(0); // Track actual scroll distance from bottom

  // Track which message is currently "sticky" (scrolled past its natural position)
  let stickyMessageId = $state<string | null>(null);

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
    const setupTerminal = selectWorkspaceSetupTerminal.select(
      appStore.state,
      workspace.id,
    );
    if (setupTerminal) {
      appStore.dispatch(
        openTerminalTabRequested(workspace.id, { terminalId: setupTerminal.id }),
      );
    }
  }

  // CRITICAL: Destruction flag to prevent async callbacks from accessing reactive state after destruction.
  // This prevents "N is not a function" errors when Svelte's reactive system tries to call
  // nullified internal functions. This MUST be set FIRST in onDestroy, before any other cleanup.
  // This is NOT reactive ($state) intentionally - we want to read it without triggering reactive tracking.
  let isComponentDestroyed = false;

  // Track container height for compact mode (line clamp 1 when short)
  // Use hysteresis to prevent flickering at the threshold boundary
  let containerHeight = $state(0);
  const COMPACT_HEIGHT_ENTER = 500; // Enter compact mode below this
  const COMPACT_HEIGHT_EXIT = 540; // Exit compact mode above this
  let isCompactMode = $state(false);

  // Track whether sticky positioning should be enabled
  // Disable sticky when panel is too short (< 400px) to avoid awkward UX
  const STICKY_HEIGHT_ENABLE = 420; // Enable sticky above this
  const STICKY_HEIGHT_DISABLE = 400; // Disable sticky below this
  let shouldEnableSticky = $state(true);

  $effect(() => {
    if (containerHeight > 0) {
      if (!isCompactMode && containerHeight < COMPACT_HEIGHT_ENTER) {
        isCompactMode = true;
      } else if (isCompactMode && containerHeight > COMPACT_HEIGHT_EXIT) {
        isCompactMode = false;
      }

      // Track sticky enable/disable with hysteresis
      if (shouldEnableSticky && containerHeight < STICKY_HEIGHT_DISABLE) {
        shouldEnableSticky = false;
      } else if (!shouldEnableSticky && containerHeight > STICKY_HEIGHT_ENABLE) {
        shouldEnableSticky = true;
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
    // answering (or any superseding user message) brings them back.
    if (pendingQuestions) {
      return [];
    }
    const messageContent = extractAllContent(lastAssistantMessage);
    const { prompts } = parseSuggestedPrompts(messageContent);
    return prompts;
  });

  // Agent Q&A: question blocks on the LAST assistant message with NO later
  // user message (and not streaming) replace the composer with the sequential
  // wizard. Derivation is purely transcript-based (wire contract), so
  // restored sessions re-surface unanswered questions automatically.
  // The gate (own active turn, NOT the broad running gate — an agent paused
  // on delegated agents has ended its turn and its questions must surface)
  // lives in deriveWizardPendingQuestions so the regression suite exercises
  // the real production gate.
  const pendingQuestions = $derived.by(() => {
    const hasUserMessage = $agentMessages$.some((m) => m.role === 'user');
    const showingPendingUserMessage = !!pendingMessage && !hasUserMessage;
    // Reading $agentIsResponding$ keeps this $derived reactive to gate flips
    // that do not change the transcript; the shared helper re-reads the same
    // value from store state.
    void $agentIsResponding$;
    return deriveWizardPendingQuestions(
      appStore.state,
      agentId,
      $agentMessages$,
      showingPendingUserMessage,
    );
  });

  // Ignore = collapse, not dismiss — transient component state, never
  // persisted; resets whenever a different question-bearing message pends.
  let questionWizardCollapsed = $state(false);
  let questionWizardMessageId = $state<string | null>(null);
  $effect(() => {
    const id = pendingQuestions?.messageId ?? null;
    if (id !== questionWizardMessageId) {
      questionWizardMessageId = id;
      questionWizardCollapsed = false;
    }
  });

  // Completing the wizard flattens all answers into ONE plain-text user
  // message of `Q:`/`A:` pairs (wire contract — no messageMetadata) sent
  // through the ordinary send path. The resulting user message supersedes
  // the questions, so the wizard unmounts, the composer restores, and the
  // in-transcript cards render resolved.
  function handleQuestionWizardComplete(answers: QuestionAnswer[]) {
    if (!workspace || !isActive) return;
    const text = flattenAnswersToMessage(answers);
    logger.info('Question wizard completed', { answerCount: answers.length });
    appStore.dispatch(
      sendMessage(agentId, {
        wsId: workspace.id,
        text,
        agentName,
        agentModel,
        isInitialWorkspaceAgent,
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
  function extractSearchableContent(msg: AgentMessage): string {
    const blocks = msg.contentBlocks;
    if (!blocks || blocks.length === 0) return '';
    if (msg.role === 'user') {
      if (msg.metadata?.type === 'event_notification') return '';
      if (extractAllContent(msg).trimStart().startsWith('[WORKSPACE EVENTS]')) return '';
    }
    const grouped = groupContentBlocks(blocks, !!msg.isStreaming);
    const lastIndex = grouped.length - 1;
    const parts: string[] = [];
    const pushText = (text: string) => parts.push(parseSuggestedPrompts(text).cleanedContent);
    grouped.forEach((block, i) => {
      if (block.type === 'text') {
        pushText(block.text || block.content || '');
      } else if (block.type === 'content_group' && i === lastIndex) {
        for (const child of block.children) {
          if (child.type === 'text') pushText(child.text || child.content || '');
        }
      }
    });
    return parts.join('');
  }

  // Derive all individual match positions: { messageId, matchIndex (within message), turnKey }
  // turnKey ties each match back to its enclosing conversation turn so that the
  // current-match turn (and its neighbors) can be force-rendered through the
  // LazyTurn virtualization while searching.
  const allSearchMatches = $derived.by(() => {
    if (!debouncedSearchQuery.trim()) {
      return [];
    }
    const query = debouncedSearchQuery.toLowerCase();
    const turnKeyMap = messageIdToTurnKey;
    const matches: Array<{
      messageId: string;
      matchIndexInMessage: number;
      turnKey: string;
    }> = [];

    for (const msg of $agentMessages$) {
      const content = extractSearchableContent(msg);
      const lowerContent = content.toLowerCase();
      const turnKey = turnKeyMap.get(msg.id) ?? msg.id;
      let index = 0;
      let matchIndexInMessage = 0;
      while ((index = lowerContent.indexOf(query, index)) !== -1) {
        matches.push({ messageId: msg.id, matchIndexInMessage, turnKey });
        index += query.length;
        matchIndexInMessage++;
      }
    }

    return matches;
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
    matches: Array<{ messageId: string; matchIndexInMessage: number; turnKey: string }>,
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

  // Locate the text node containing a given absolute offset in the concatenated
  // fullText, and the local offset within that node. Uses binary search over the
  // precomputed cumulative-start table so per-match lookup is O(log N).
  function locateOffset(
    textNodes: Text[],
    nodeStarts: number[],
    absoluteOffset: number,
  ): { nodeIndex: number; localOffset: number } | null {
    if (textNodes.length === 0) return null;
    let lo = 0;
    let hi = textNodes.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (nodeStarts[mid] <= absoluteOffset) lo = mid;
      else hi = mid - 1;
    }
    const nodeLen = (textNodes[lo].textContent ?? '').length;
    const localOffset = Math.min(absoluteOffset - nodeStarts[lo], nodeLen);
    return { nodeIndex: lo, localOffset };
  }

  // Build a DOM Range spanning [start, end) in the concatenated fullText.
  // Supports multi-node ranges natively via Range.setStart/setEnd on different
  // nodes, which is required for matches that cross text-node boundaries.
  function createRangeForSpan(
    textNodes: Text[],
    nodeStarts: number[],
    start: number,
    end: number,
  ): Range | null {
    const startLoc = locateOffset(textNodes, nodeStarts, start);
    const endLoc = locateOffset(textNodes, nodeStarts, end);
    if (!startLoc || !endLoc) return null;
    const range = document.createRange();
    range.setStart(textNodes[startLoc.nodeIndex], startLoc.localOffset);
    range.setEnd(textNodes[endLoc.nodeIndex], endLoc.localOffset);
    return range;
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
  let inputValue = $state('');

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

  // Restore draft from backend on mount
  let draftRestored = $state(false);
  $effect(() => {
    if (draftRestored || !workspace || !agentId) return;

    untrack(async () => {
      const draft = await appClient.drafts.get(workspace.id, agentId);
      if (!draft) return;
      if (draft.attachments?.length && contextItems.length === 0) {
        contextItems = deserializeDraftAttachments(draft.attachments);
      }
      if (draft.text && !inputValue) {
        inputValue = draft.text;
        setTimeout(() => {
          inputComponent?.setContent?.(draft.text);
        }, 50);
      }
    });

    draftRestored = true;
  });

  // Save draft to backend (debounced)
  let saveTimeoutId: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    if (!workspace || !agentId) return;
    const currentValue = inputValue;
    const currentAttachments = serializeDraftAttachments(contextItems);

    if (saveTimeoutId) clearTimeout(saveTimeoutId);

    saveTimeoutId = setTimeout(() => {
      appClient.drafts
        .set(
          workspace.id,
          agentId,
          currentValue,
          currentAttachments.length > 0 ? currentAttachments : undefined,
        )
        .catch((err) => {
          logger.warn('[ChatPanel] Failed to save draft', { error: String(err) });
        });
    }, 500); // 500ms debounce
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

  // Derive available panel contexts from all open tabs (excluding agent tabs and this agent's tab)
  // Reading $allPanelLayoutTabs$ creates a reactive dependency on Redux panel-layout state,
  // so this derived recomputes whenever tabs are added, removed, or reordered.
  let availablePanelContexts = $derived.by((): PanelContextItem[] => {
    void $allPanelLayoutTabs$; // reactive dependency on panel layout tab changes
    if (!panelLayoutManager || !workspace?.id) return [];

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
            label: tab.title || (isSpec ? m.chat_shared_spec_label() : m.chat_shared_note_fallback()),
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
    return panels.sort((a, b) => {
      if (a.isActive && !b.isActive) return -1;
      if (!a.isActive && b.isActive) return 1;
      return a.label.localeCompare(b.label);
    });
  });

  // Update the multi-panel context store when available panels change
  // Use untrack to prevent infinite loop - we only care about the value, not reactivity of the update
  $effect(() => {
    if (workspace?.id) {
      const panels = availablePanelContexts;
      untrack(() => {
        appStore.dispatch(setMultiPanelWorkspace(workspace.id));
        appStore.dispatch(updateMultiPanels(panels));
      });
    }
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

  // Once the conversation has started, provider/model switches require a
  // confirmation dialog (mid-conversation switch warning) instead of a lock.
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

  // Provider ID for the input — resolved from the agent session
  let inputProviderId = $derived.by(() => {
    if (!$agentSession$) return undefined;
    return getAgentProvider($agentSession$);
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
  const shouldUseLazyLoading = $derived(totalTurnCount > LAZY_TURN_THRESHOLD);

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
    const shouldScroll =
      currentCount > previousMessageCount &&
      (isFirstMessage || (shouldFollowBottom && !isScrollUnlocked));
    if (shouldScroll) {
      // New message added - scroll to bottom after DOM updates
      // Re-enable auto-follow when first message is added
      if (isFirstMessage) {
        shouldFollowBottom = true;
        isScrollUnlocked = false;
      }
      tick().then(() => {
        // Guard against component destruction during tick
        if (isComponentDestroyed) return;
        if (scrollContainer) scrollToBottomUtil(scrollContainer);
      });
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

  // Group messages into conversation turns (user message + following assistant response)
  // This allows sticky behavior to be constrained within each turn
  interface ConversationTurn {
    userMessage: AgentMessage | null;
    assistantMessages: AgentMessage[];
    /** Daemon-persisted model-change notice rows (after the user row, before assistant output) */
    noticeMessages: AgentMessage[];
  }

  function groupIntoTurns(messages: AgentMessage[]): ConversationTurn[] {
    const turns: ConversationTurn[] = [];
    let currentTurn: ConversationTurn | null = null;

    for (const message of messages) {
      if (message.role === 'user') {
        // Start a new turn
        if (currentTurn) {
          turns.push(currentTurn);
        }
        currentTurn = { userMessage: message, assistantMessages: [], noticeMessages: [] };
      } else if (message.role === 'assistant') {
        if (currentTurn) {
          currentTurn.assistantMessages.push(message);
        } else {
          // Orphan assistant message (no preceding user message)
          turns.push({ userMessage: null, assistantMessages: [message], noticeMessages: [] });
        }
      } else if (getModelChangeNotice(message)) {
        // Model-change transcript notice (non-user/non-assistant role) —
        // rendered inline within its turn as a centered divider
        if (currentTurn) {
          currentTurn.noticeMessages.push(message);
        } else {
          turns.push({ userMessage: null, assistantMessages: [], noticeMessages: [message] });
        }
      }
    }

    // Push final turn
    if (currentTurn) {
      turns.push(currentTurn);
    }

    return turns;
  }

  const lastConversationTurn = $derived.by((): ConversationTurn | null => {
    const lastGroup = groupedMessages[groupedMessages.length - 1];
    if (!lastGroup) return null;

    const turns = groupIntoTurns(lastGroup.messages);
    return turns[turns.length - 1] ?? null;
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
  const globalTurnIndexMap = $derived.by(() => {
    const map = new Map<string, number>();
    let globalIndex = 0;
    for (let groupIndex = 0; groupIndex < groupedMessages.length; groupIndex++) {
      const turns = groupIntoTurns(groupedMessages[groupIndex].messages);
      for (let turnIndex = 0; turnIndex < turns.length; turnIndex++) {
        const turn = turns[turnIndex];
        const turnKey = turn.userMessage?.id ?? `group-${groupIndex}-turn-${turnIndex}`;
        map.set(turnKey, globalIndex);
        globalIndex++;
      }
    }
    return map;
  });

  // Map each messageId to its enclosing turnKey. Used by allSearchMatches so that
  // matches in virtualized LazyTurn placeholders can be force-rendered during search.
  const messageIdToTurnKey = $derived.by(() => {
    const map = new Map<string, string>();
    for (let groupIndex = 0; groupIndex < groupedMessages.length; groupIndex++) {
      const turns = groupIntoTurns(groupedMessages[groupIndex].messages);
      for (let turnIndex = 0; turnIndex < turns.length; turnIndex++) {
        const turn = turns[turnIndex];
        const turnKey = turn.userMessage?.id ?? `group-${groupIndex}-turn-${turnIndex}`;
        if (turn.userMessage) map.set(turn.userMessage.id, turnKey);
        for (const assistantMessage of turn.assistantMessages) {
          map.set(assistantMessage.id, turnKey);
        }
      }
    }
    return map;
  });

  // Helper to check if a turn should be force-visible (recent or streaming)
  function isTurnForceVisible(turnKey: string): boolean {
    if (!shouldUseLazyLoading) return true; // Always visible if lazy loading is disabled
    const globalIndex = globalTurnIndexMap.get(turnKey);
    if (globalIndex === undefined) return true; // Unknown turn, render it
    const totalTurns = globalTurnIndexMap.size;
    // Force visible if it's in the last N turns
    return globalIndex >= totalTurns - FORCE_VISIBLE_TURN_COUNT;
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
  onMount(async () => {
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
    requestAnimationFrame(() => {
      if (scrollContainer) {
        if ($agentMessages$.length > 0) {
          // Scroll to bottom if there are messages
          scrollToBottomUtil(scrollContainer);
        } else {
          // Scroll to top for empty panel (shows specialist switcher)
          scrollContainer.scrollTop = 0;
          // Don't auto-follow until user sends a message
          shouldFollowBottom = false;
        }
      }
    });
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

    const startScrollTop = scrollContainer.scrollTop;
    const distance = targetScrollTop - startScrollTop;
    const startTime = performance.now();

    function easeOutCubic(t: number): number {
      return 1 - Math.pow(1 - t, 3);
    }

    function animate(currentTime: number) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);

      scrollContainer!.scrollTop = startScrollTop + distance * easeOutCubic(progress);

      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    }

    requestAnimationFrame(animate);
  }

  /**
   * Smoothly scroll to a specific position with 150ms animation.
   */
  function smoothScrollToPosition(top: number, duration: number = 150) {
    if (!scrollContainer) return;

    const startScrollTop = scrollContainer.scrollTop;
    const distance = top - startScrollTop;
    const startTime = performance.now();

    function easeOutCubic(t: number): number {
      return 1 - Math.pow(1 - t, 3);
    }

    function animate(currentTime: number) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);

      scrollContainer!.scrollTop = startScrollTop + distance * easeOutCubic(progress);

      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    }

    requestAnimationFrame(animate);
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

  // Listen for panel:focus-content events (from panel keyboard navigation)
  $effect(() => {
    if (typeof window === 'undefined') return;

    const handlePanelFocusContent = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      // Only focus if this event is for our agent
      if (detail?.tabType === 'agent' && detail?.agentId === agentId) {
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
  let distanceScrollCleanup: (() => void) | null = null;
  onMount(() => {
    const handleScroll = () => {
      if (!scrollContainer) return;
      const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
      const newDistance = scrollHeight - scrollTop - clientHeight;
      // Only update if changed to avoid unnecessary re-renders
      if (newDistance !== distanceFromBottom) {
        distanceFromBottom = newDistance;
      }
    };

    // Wait for scrollContainer to be bound, then set up
    const setupWhenReady = () => {
      if (!scrollContainer) {
        requestAnimationFrame(setupWhenReady);
        return;
      }
      scrollContainer.addEventListener('scroll', handleScroll, { passive: true });
      // Initial calculation (deferred to avoid effect loops)
      requestAnimationFrame(handleScroll);
      distanceScrollCleanup = () => {
        scrollContainer?.removeEventListener('scroll', handleScroll);
      };
    };
    setupWhenReady();

    return () => {
      distanceScrollCleanup?.();
    };
  });

  // Track sticky state for user messages
  // Use onMount pattern to avoid effect loops - scrollContainer binding can cause
  // effects to re-run when state changes trigger re-renders
  let stickyScrollCleanup: (() => void) | null = null;
  onMount(() => {
    const handleScroll = () => {
      if (!scrollContainer) return;

      // Find all user message containers (they have data-message-id and are sticky)
      const messageContainers = scrollContainer.querySelectorAll(
        '.message-nav-target[data-message-id]',
      );

      let foundSticky: string | null = null;

      // Check each message to see if it's in sticky position
      for (const container of messageContainers) {
        // For EventWakeupBanner, the sticky element is inside the container
        // For regular messages, the container itself is sticky
        const stickyElement =
          container.querySelector('.sticky') ??
          (container.classList.contains('sticky') ? container : null);
        if (!stickyElement) continue;

        const rect = stickyElement.getBoundingClientRect();
        const scrollRect = scrollContainer.getBoundingClientRect();

        // A message is sticky when its top is at (or very close to) the scroll container top
        // The sticky offset is -top-px which is -1px, so check if within a few pixels
        const stickyThreshold = 20; // pixels
        const isAtStickyPosition = Math.abs(rect.top - scrollRect.top + 1) < stickyThreshold;

        // Also check that we've scrolled past the message's natural position
        // by checking if the turn's top is above the scroll container's top
        const conversationTurn = container.closest('.conversation-turn');
        if (conversationTurn && isAtStickyPosition) {
          const turnRect = conversationTurn.getBoundingClientRect();
          // The element is sticky if:
          // 1. It's at the sticky position (near the top)
          // 2. The turn's top is above the viewport (we've scrolled into the turn)
          // 3. The turn's bottom is still below the sticky element (the turn hasn't scrolled past)
          const scrolledPastTurnStart = turnRect.top < scrollRect.top;
          const turnStillVisible = turnRect.bottom > rect.bottom;
          if (scrolledPastTurnStart && turnStillVisible) {
            foundSticky = container.getAttribute('data-message-id');
            break;
          }
        }
      }

      // Only update if changed to avoid unnecessary re-renders
      if (foundSticky !== stickyMessageId) {
        stickyMessageId = foundSticky;
      }
    };

    // Throttle the scroll handler for performance
    let ticking = false;
    const throttledHandler = () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          handleScroll();
          ticking = false;
        });
        ticking = true;
      }
    };

    // Wait for scrollContainer to be bound, then set up
    const setupWhenReady = () => {
      if (!scrollContainer) {
        requestAnimationFrame(setupWhenReady);
        return;
      }
      scrollContainer.addEventListener('scroll', throttledHandler, { passive: true });
      // Initial check (deferred to avoid effect loops)
      requestAnimationFrame(handleScroll);
      stickyScrollCleanup = () => {
        scrollContainer?.removeEventListener('scroll', throttledHandler);
      };
    };
    setupWhenReady();

    return () => {
      stickyScrollCleanup?.();
    };
  });

  // Track container height for compact mode using ResizeObserver
  let resizeObserverCleanup: (() => void) | null = null;
  onMount(() => {
    const setupWhenReady = () => {
      if (!scrollContainer) {
        requestAnimationFrame(setupWhenReady);
        return;
      }
      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const newHeight = entry.contentRect.height;
          if (newHeight !== containerHeight) {
            containerHeight = newHeight;
          }
        }
      });
      observer.observe(scrollContainer);
      resizeObserverCleanup = () => observer.disconnect();
    };
    setupWhenReady();

    return () => {
      resizeObserverCleanup?.();
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
    lastViewedAgentId = agentId;
    lastIsActive = isActive;
    if (agentId && isActive) {
      appStore.dispatch(markAgentAsViewed(agentId));
    } else {
      // Panel is no longer active (user switched to another tab) —
      // clear so new messages for this agent are properly marked as unread.
      appStore.dispatch(clearCurrentlyViewedAgent());
    }
  });

  onDestroy(() => {
    // CRITICAL: Set destruction flag FIRST, before any other cleanup.
    // This prevents async callbacks (like appClient.agents.* promises resolving
    // late) from accessing reactive state after destruction, which would cause
    // "N is not a function" errors in Svelte's reactive system.
    isComponentDestroyed = true;

    // Clear currently viewed agent so other agents can properly be marked as unread
    if (agentId) {
      appStore.dispatch(clearCurrentlyViewedAgent());
    }

    logger.info('ChatPanel destroyed', { instanceId, agentId });
    // Clean up subscriptions and scroll manager
    if (searchDebounceTimer !== null) {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = null;
    }
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

  // Handle editing a queued message. `agents.editQueued` never throws — the
  // seam folds transport/daemon errors (raw BackendError) into
  // `{ success: false, error }`, so branching on `result.success` is safe.
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
    // If there are queued messages and we're not already navigating history,
    // edit the last queued message instead of cycling through sent history
    if ($queuedMessages$.length > 0 && historyIndex === -1 && !inputValue.trim()) {
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
      isScrollUnlocked = false;
      if (scrollContainer) scrollToBottomUtil(scrollContainer);
    }
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

    // Extract imageBlocks from any context item with imageData/imageMimeType
    // Works for both file-type attachments and legacy inline-image items
    const imageBlocks = allContextItems
      .filter((item) => item.imageData && item.imageMimeType)
      .map((item) => ({
        type: 'image' as const,
        data: item.imageData!,
        mimeType: item.imageMimeType!,
      }));

    // Dispatch all orchestration to the send-message saga
    appStore.dispatch(
      sendMessage(agentId, {
        wsId: workspace.id,
        text,
        contextItems: allContextItems,
        workspaceContextStr,
        noteIds,
        ...(imageBlocks.length > 0 ? { imageBlocks } : {}),
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

    // Extract imageBlocks from any context item with imageData/imageMimeType
    // Works for both file-type attachments and legacy inline-image items
    const imageBlocks = allContextItems
      .filter((item) => item.imageData && item.imageMimeType)
      .map((item) => ({
        type: 'image' as const,
        data: item.imageData!,
        mimeType: item.imageMimeType!,
      }));

    appStore.dispatch(
      sendMessage(agentId, {
        wsId: workspace.id,
        text,
        contextItems: allContextItems,
        workspaceContextStr,
        noteIds,
        ...(imageBlocks.length > 0 ? { imageBlocks } : {}),
        skipQueueCheck: true,
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
  // already confirmed the destructive truncation.
  function handleEditMessage(messageId: string, newText: string, model?: string) {
    if (!workspace) return;
    const action = agentSessionEditAndRegenerateRequested(
      agentId,
      workspace.id,
      messageId,
      newText,
      model ? { model } : undefined,
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
      agentSessionRegenerateFromMessageRequested(
        agentId,
        workspace.id,
        assistantMessageId,
      ),
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
>
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
    <div
      bind:this={scrollContainer}
      use:followBottom={{
        // While search is open we drive our own programmatic scrolls (to the
        // current match), so we drop `follow` to keep the mutation/resize
        // observers from yanking the viewport to the bottom when a LazyTurn
        // placeholder expands between us computing and applying the match's
        // scroll target.
        follow:
          shouldFollowBottom && !isScrollUnlocked && !showSearch && $agentMessages$.length > 0,
        threshold: 100,
        onFollowChange: (f) => {
          shouldFollowBottom = f;
          // When user scrolls up, clear unlocked state
          if (!f) {
            isScrollUnlocked = false;
          }
        },
      }}
      class="flex-1 overflow-y-auto {isChiefWorkspace ? 'px-0' : 'px-[5%]'}"
      class:agent-font-monospace={$isAgentMonospace}
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

      {#if !isInitialWorkspaceAgent && $agentMessages$.length === 0 && !$agentSessionIsStreaming$ && $agentSession$ && !pendingInitialPrompt && $transcriptHydration$ === 'settled' && $agentSession$.backendSessionId === null}
        <!-- Welcome page: settled hydration + zero messages + never-used session (backendSessionId === null) -->
        {#if isChiefWorkspace}
          <ChiefChatEmptyState onSelect={handleSelectSuggestedPrompt} />
        {:else}
          <div class="mt-16"></div>
          <RegularAgentWelcome onSpecialistChange={handleSpecialistChange} session={$agentSession$} />
        {/if}
      {:else if isInitialWorkspaceAgent && onboardingContext && !onboardingContext.prompt?.trim() && $agentMessages$.length === 0 && !$agentSessionIsStreaming$ && !pendingInitialPrompt}
        <!-- Initial workspace agent with no prompt — show setup card only, no skeletons -->
        <div class="pt-16 pb-6">
          <WorkspaceSetupCard
            repoName={onboardingContext.projectName ||
              onboardingContext.projectPath?.split('/').pop() ||
              m.chat_chatPanel_yourProject_fallback()}
            repoPath={onboardingContext.repoPath || onboardingContext.projectPath}
            worktreePath={onboardingContext.worktreePath}
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
      {:else if (!$agentSession$ || $transcriptHydration$ !== 'settled' || $agentSession$.backendSessionId !== null) && $agentMessages$.length === 0 && !$agentSessionIsStreaming$ && !pendingInitialPrompt}
        <!-- Skeleton: hydration not settled OR existing session (covers failed-hydration case: settled + empty + backendSessionId !== null) -->
        {#if isInitialWorkspaceAgent && onboardingContext}
          <div class="pt-16 pb-6">
            <WorkspaceSetupCard
              repoName={onboardingContext.projectName ||
                onboardingContext.projectPath?.split('/').pop() ||
                m.chat_chatPanel_yourProject_fallback()}
              repoPath={onboardingContext.repoPath || onboardingContext.projectPath}
              worktreePath={onboardingContext.worktreePath}
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
              <DateSeparator label="Just now" />
              <!-- Conversation turn container - constrains sticky behavior -->
              <div class="conversation-turn">
                <div class="message-nav-target z-10 bg-sidebar mb-9">
                  <ChatMessage
                    message={pendingMessage}
                    showTimestamp={false}
                    enableSticky={shouldEnableSticky}
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
                    <div class="mb-16">
                      <StreamingStatus
                        isStreaming={$agentSessionIsStreaming$}
                        isProcessing={$agentIsResponding$}
                        lastChunkTime={$chatLastChunkTime$}
                        receivedFirstChunk={$chatReceivedFirstChunk$}
                        streamingContentLength={$chatStreamingContent$?.length ?? 0}
                        error={effectiveError}
                        sessionCorrupted={effectiveSessionCorrupted}
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
              <DateSeparator label="Just now" />
              <!-- Conversation turn container - constrains sticky behavior -->
              <div class="conversation-turn">
                <div class="message-nav-target z-10 mb-9">
                  <ChatMessage
                    message={pendingMessage}
                    enableSticky={shouldEnableSticky}
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
                    <div class="mb-16">
                      <StreamingStatus
                        isStreaming={$agentSessionIsStreaming$}
                        isProcessing={$agentIsResponding$}
                        lastChunkTime={$chatLastChunkTime$}
                        receivedFirstChunk={$chatReceivedFirstChunk$}
                        streamingContentLength={$chatStreamingContent$?.length ?? 0}
                        error={effectiveError}
                        sessionCorrupted={effectiveSessionCorrupted}
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
            <!-- PERF: Use keyed each blocks for efficient list diffing -->
            {#each groupedMessages as group, groupIndex (group.messages[0]?.id ?? groupIndex)}
              <DateSeparator label={formatDistanceToNow(group.date)} />
              {@const turns = groupIntoTurns(group.messages)}
              {#each turns as turn, turnIndex (turn.userMessage?.id ?? `turn-${turnIndex}`)}
                {@const turnKey = turn.userMessage?.id ?? `group-${groupIndex}-turn-${turnIndex}`}
                {@const isLastTurnInConversation =
                  groupIndex === groupedMessages.length - 1 && turnIndex === turns.length - 1}
                <!-- Conversation turn container - constrains sticky behavior -->
                <!-- PERF: LazyTurn defers rendering of off-screen turns -->
                <!-- PERF: Only force-visible the last turn during streaming, not all turns -->
                {@const turnMessageText = turn.userMessage
                  ? extractAllContent(turn.userMessage)
                  : ''}
                <div class="conversation-turn">
                  <LazyTurn
                    {turnKey}
                    scrollRoot={scrollContainer}
                    forceVisible={isTurnForceVisible(turnKey) ||
                      ($agentSessionIsStreaming$ && isLastTurnInConversation) ||
                      visibleSearchTurnKeys.has(turnKey)}
                  >
                    {#snippet children()}
                      <!-- Event wakeup banner - shown when agent is woken by a subscription -->
                      <!-- Also detect [WORKSPACE EVENTS] messages as a fallback in case metadata is missing -->
                      {@const hasEventMetadata =
                        turn.userMessage?.metadata?.type === 'event_notification' &&
                        turn.userMessage?.metadata?.eventTypes}
                      {@const hasEventContent = turnMessageText
                        .trim()
                        .startsWith('[WORKSPACE EVENTS]')}
                      {#if turn.userMessage && (hasEventMetadata || hasEventContent)}
                        {@const message = turn.userMessage}
                        {@const globalIndex = getMessageIndex(message.id)}
                        {@const messageText = extractAllContent(message)}
                        {@const agentEventsForCards = parseAgentEvents(
                          messageText,
                          message.metadata as {
                            events?: Array<{
                              type: string;
                              data: Record<string, unknown>;
                              timestamp: string;
                            }>;
                          },
                        )}
                        <!-- Sticky summary header (z-10 to stay above scrolling content) -->
                        <div
                          data-message-id={message.id}
                          data-message-index={globalIndex}
                          class="message-nav-target z-10"
                          class:sticky={shouldEnableSticky}
                          class:-top-px={shouldEnableSticky}
                          transition:slide={{ axis: 'y', duration: 200 }}
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
                            isSticky={stickyMessageId === message.id}
                            onScrollToPrevious={() => scrollToPreviousUserMessage(message.id)}
                            showAgentCards={false}
                            {workspace}
                          />
                        </div>
                        <!-- Agent cards - NOT inside sticky div, so they scroll normally -->
                        {#if agentEventsForCards.length > 0 && !isDelegatedBackgroundTaskAgent}
                          <div class="mt-1 pb-13 flex flex-col gap-0.5 px-2 relative z-0">
                            {#each agentEventsForCards.slice(0, 5) as event (event.agentId)}
                              <AgentCard
                                agentId={event.agentId}
                                agentName={event.agentName}
                                completionReport={event.completionReport}
                                lastResponseSummary={event.lastResponseSummary}
                                {workspace}
                              />
                            {/each}
                            {#if agentEventsForCards.length > 5}
                              <div class="text-ui text-subtle text-center py-1">
                                +{agentEventsForCards.length - 5} more agents
                              </div>
                            {/if}
                          </div>
                        {/if}
                      {/if}
                      <!-- User message (sticky within this turn) - skip for event notifications (already shown above) -->
                      <!-- Also skip messages starting with [WORKSPACE EVENTS] as a fallback in case metadata is missing -->
                      {@const isEventNotification =
                        turn.userMessage?.metadata?.type === 'event_notification' ||
                        (turn.userMessage &&
                          extractAllContent(turn.userMessage)
                            .trim()
                            .startsWith('[WORKSPACE EVENTS]'))}
                      <!-- Sticky compact user message header - shows when scrolled past expanded message -->
                      <!-- Positioned BEFORE expanded message in DOM so it's naturally behind it -->
                      {#if shouldEnableSticky && turn.userMessage && !isEventNotification}
                        <div class="sticky -top-px w-full z-10 h-0 overflow-visible">
                          <div
                            class="h-fit min-w-0 px-2 pt-2 pb-2 text-subtle whitespace-nowrap text-ellipsis leading-normal bg-sidebar rounded-xs w-full max-w-full truncate"
                          >
                            {formatMessageForStickyHeader(turn.userMessage)}
                          </div>
                        </div>
                      {/if}

                      {#if turn.userMessage && !isEventNotification}
                        {@const message = turn.userMessage}
                        {@const globalIndex = getMessageIndex(message.id)}
                        <!-- z-20 and bg-sidebar to cover the sticky compact header when in view -->
                        <div
                          data-message-id={message.id}
                          data-message-role="user"
                          data-message-index={globalIndex}
                          class="message-nav-target z-20 mb-9 bg-sidebar relative"
                        >
                          <ChatMessage
                            {agentId}
                            messageId={message.id}
                            {workspace}
                            onEditSubmit={(newText, model) =>
                              handleEditMessage(message.id, newText, model)}
                            editModel={turn.assistantMessages[0]?.metadata?.model ??
                              hydratedInputModel}
                            enableSticky={shouldEnableSticky}
                            onScrollToPrevious={() => scrollToPreviousUserMessage(message.id)}
                            backendSessionId={auggieSessionId}
                          />
                        </div>
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
                        {/if}
                      {/each}

                      <!-- Show status when active but no assistant message yet, or when there's an error/modelUnavailable -->
                      {#if groupIndex === groupedMessages.length - 1 && turnIndex === turns.length - 1 && turn.assistantMessages.length === 0 && shouldShowPendingAssistantStatus( { isStreaming: $agentSessionIsStreaming$, isProcessing: $agentIsResponding$, error: effectiveError, modelUnavailable: $chatModelUnavailable$ }, )}
                        <div class="mb-8">
                          <StreamingStatus
                            isStreaming={$agentSessionIsStreaming$}
                            isProcessing={$agentIsResponding$}
                            lastChunkTime={$chatLastChunkTime$}
                            receivedFirstChunk={$chatReceivedFirstChunk$}
                            streamingContentLength={$chatStreamingContent$?.length ?? 0}
                            error={effectiveError}
                            sessionCorrupted={effectiveSessionCorrupted}
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
                            onEditSubmit={(newText, model) =>
                              handleEditMessage(message.id, newText, model)}
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
                          <div class="mb-16">
                            <StreamingStatus
                              isStreaming={$agentSessionIsStreaming$}
                              isProcessing={$agentIsResponding$}
                              lastChunkTime={$chatLastChunkTime$}
                              receivedFirstChunk={$chatReceivedFirstChunk$}
                              streamingContentLength={$chatStreamingContent$?.length ?? 0}
                              error={effectiveError}
                              sessionCorrupted={effectiveSessionCorrupted}
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
                      {/each}
                    {/snippet}
                  </LazyTurn>
                </div>
                <!-- Dividing line between turns (not after the last one) -->
                {#if !(groupIndex === groupedMessages.length - 1 && turnIndex === turns.length - 1)}
                  <hr class="border-t border-border/50 mb-3" />
                {/if}
              {/each}
            {/each}
            {#if showEndOfListStreamingStatus}
              <div class="mb-16">
                <StreamingStatus
                  isStreaming={$agentSessionIsStreaming$}
                  isProcessing={$agentIsResponding$}
                  lastChunkTime={$chatLastChunkTime$}
                  receivedFirstChunk={$chatReceivedFirstChunk$}
                  streamingContentLength={$chatStreamingContent$?.length ?? 0}
                  error={effectiveError}
                  sessionCorrupted={effectiveSessionCorrupted}
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
      <!-- Aggregate File Changes Summary (show if more than one assistant message, updates during streaming) -->
      {#if $agentMessages$.filter((m) => m.role === 'assistant').length > 1}
        <div class="w-full">
          <ChatFileChangesSummary
            messages={$agentMessages$}
            suffix="in conversation"
            isAggregate={true}
            isStreaming={$agentSessionIsStreaming$}
            {agentId}
          />
        </div>
      {/if}

      <!-- Show suggested prompts for the last message only, when not streaming -->
      {#if suggestedPrompts.length > 0}
        <div class="w-full pt-8 pb-12">
          <SuggestedPrompts
            prompts={suggestedPrompts}
            onSelect={handleSelectSuggestedPrompt}
            onEdit={handleEditSuggestedPrompt}
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
          />
        </div>
      {/if}

      <!-- Agent Subscriptions (shows what events agent is waiting for) -->
      <!-- {#key} forces a full remount when workspace or agent changes,
           preventing stale "Waiting for N agents" UI from leaking across switches -->
      {#if workspace?.id}
        {#key `${workspace.id}::${agentId}`}
          <div class="w-full pb-6" transition:slide={{ axis: 'y', duration: 200 }}>
            <AgentSubscriptions workspaceId={workspace.id} {agentId} />
          </div>
        {/key}
      {/if}

      <!-- Scroll anchor - ensures proper scroll to absolute bottom -->
      <div class="min-h-px min-w-6 shrink-0"></div>
    </div>
    <!-- Scroll Lock/Unlock Button -->
    {#if $agentMessages$.length > 0}
      {@const isAtBottom = distanceFromBottom <= SCROLL_BOTTOM_THRESHOLD}
      {@const showLock = isAtBottom && !isScrollUnlocked}
      {@const showUnlock = isAtBottom && isScrollUnlocked}
      {@const showArrow = !isAtBottom}
      <Button
        variant="outline"
        size="icon-xs"
        onclick={() => {
          if (showArrow) {
            // Scrolled up - click to scroll to bottom and re-lock
            isScrollUnlocked = false;
            scrollToBottom();
          } else if (showLock) {
            // At bottom and locked - click to unlock (stop auto-scroll)
            isScrollUnlocked = true;
          } else if (showUnlock) {
            // At bottom and unlocked - click to re-lock (resume auto-scroll)
            isScrollUnlocked = false;
          }
        }}
        class="absolute bottom-2 right-2 text-muted-foreground bg-sidebar rounded-sm transition-all opacity-0 group-hover/panel:opacity-100 active:scale-95 {showLock
          ? 'opacity-0!'
          : ''}"
        title={showLock
          ? m.chat_chatPanel_autoScrollLocked_tooltip()
          : showUnlock
            ? m.chat_chatPanel_autoScrollUnlocked_tooltip()
            : m.chat_chatPanel_scrollToBottom_tooltip()}
      >
        <Fa icon={showArrow ? faArrowDown : showLock ? faLock : faLockOpen} class="w-3! h-3!" />
      </Button>
    {/if}
  </div>

  <!-- Queued Messages -->
  {#if $queuedMessages$.length > 0}
    <QueuedMessageList
      bind:this={queuedMessageListRef}
      messages={$queuedMessages$}
      onedit={handleEditQueuedMessage}
      onremove={handleRemoveQueuedMessage}
      onsendnow={handleSendQueuedMessageNow}
      ondone={() => inputComponent?.focus?.()}
    />
  {/if}

  <!-- Message Input with Aurora Background -->
  <div
    class="relative w-full {isChiefWorkspace ? 'px-0' : 'px-2'} z-0"
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

    <!-- Agent Q&A: pending questions replace the composer with the sequential
         wizard; Ignore collapses it to a banner and the composer returns
         underneath. {#key} remounts (fresh wizard state) per question-bearing
         message. -->
    {#if pendingQuestions}
      {#key pendingQuestions.messageId}
        <div class="pb-2">
          <QuestionWizard
            questions={pendingQuestions.questions}
            collapsed={questionWizardCollapsed}
            onToggleCollapsed={(c) => (questionWizardCollapsed = c)}
            onComplete={handleQuestionWizardComplete}
          />
        </div>
      {/key}
    {/if}
    {#if !pendingQuestions || questionWizardCollapsed}
      <SimpleRichInput
        bind:this={inputComponent}
        bind:contextItems
        bind:value={inputValue}
        onsubmit={handleSend}
        onforcesubmit={handleForceSubmit}
        onstop={handleStop}
        onHistoryPrev={handleHistoryPrev}
        onHistoryNext={handleHistoryNext}
        disabled={!workspace || !$agentSession$}
        isStreaming={$agentSessionIsStreaming$}
        isResponding={$agentIsResponding$}
        {workspace}
        currentContext={currentMainPanelContext}
        {agentId}
        selectedModel={hydratedInputModel}
        compactMode={isCompactMode}
        editorClassName={isChiefWorkspace ? 'px-1.5!' : 'px-2!'}
        requiresModelSwitchConfirmation={!canChangeProvider}
        providerId={inputProviderId}
      />
    {/if}
  </div>
</div>

<style>
  /* PERF: Conversation turn containers use CSS containment */
  /* NOTE: Using 'style paint' instead of 'layout style' to allow position:sticky to work */
  :global(.conversation-turn) {
    contain: style paint;
  }

  /* PERF: Message navigation targets use containment */
  /* NOTE: Using 'style paint' instead of 'layout style' to allow position:sticky to work */
  :global(.message-nav-target) {
    contain: style paint;
  }

  /* Flash animation for message navigation */
  :global(.message-highlight-flash) {
    animation: message-flash 0.6s ease-out;
  }

  /* Flash animation for scroll-to-turn navigation */
  :global(.highlight-flash) {
    animation: highlight-flash 1.5s ease-out;
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

  /* CSS Custom Highlight API styles for search */
  ::highlight(search-results) {
    background-color: hsl(var(--primary) / 0.2);
    color: inherit;
  }

  ::highlight(current-search-result) {
    background-color: hsl(var(--primary));
    color: hsl(var(--primary-foreground));
  }
</style>
