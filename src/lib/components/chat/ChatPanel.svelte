<script lang="ts">
  /**
   * Chat Panel Component
   *
   * A clean, focused chat interface that delegates all logic to the ChatService.
   * This component is purely presentational with minimal state management.
   *
   * @component
   * @description Primary chat interface for interacting with AI agents in the workspace.
   * Manages the full chat lifecycle including initialization, message sending/receiving,
   * streaming responses, and error handling through the ChatService.
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

  import { onMount, onDestroy, untrack, tick } from 'svelte';
  import { writable } from 'svelte/store';
  import { getChatService, type ChatState } from '$features/agent/services/chat.service';
  import { WorkspaceRebindTracker } from './workspace-rebind-tracker';
  import { agentService, type AgentMessage } from '$features/agent/agent-ipc-bridge';
  import { browser } from '$app/environment';
  import { setAgentStreaming } from '$lib/store/slices/workspace-agents/workspace-agents-slice';
  import {
    selectAgentSession,
    selectAgentMessages,
  } from '$lib/store/slices/agent-session/agent-session-selectors';
  import {
    addMessage as addAgentSessionMessage,
    updateMessage as updateAgentSessionMessage,
    updateSession as updateAgentSessionFields,
  } from '$lib/store/slices/agent-session/agent-session-slice';
  import { selectNoteById } from '$lib/store/slices/workspace-notes/workspace-notes-selectors';
  import { getPanelLayoutManager } from '$features/layout/panel-layout-adapter';
  import { selectAllTabs as selectPanelLayoutAllTabs } from '$lib/store/slices/panel-layout/panel-layout-selectors';
  import {
    setWorkspace as setMultiPanelWorkspace,
    updatePanels as updateMultiPanels,
    setSelection as setMultiPanelSelection,
    clearSelection as clearMultiPanelSelection,
    uncheckAllSelections,
    type PanelContextItem,
  } from '$lib/store/slices/multi-panel-context/multi-panel-context-slice';
  import {
    selectCheckedPanels,
    selectPanels,
    selectCheckedSelections,
  } from '$lib/store/slices/multi-panel-context/multi-panel-context-selectors';
  import { getDispatch } from '$lib/store/utils/svelte-context';
  import { getReduxStore } from '$lib/store/redux-dispatch-bridge';
  import { clearChatDraft, setChatDraft } from '$lib/store/slices/transient-ui/transient-ui-slice';
  import {
    sendMessage,
    initializeChatRequested,
    chatRebindStarted,
    chatRebindEnded,
    chatTrackedWorkspaceSet,
    chatSendStarted,
  } from '$lib/store/slices/chat-state/chat-state-slice';
  import { selectChatStateOrDefault } from '$lib/store/slices/chat-state/chat-state-selectors';
  import type { SendMessagePayload } from '$lib/store/slices/chat-state/chat-state-types';
  import { selectChatDraft } from '$lib/store/slices/transient-ui/transient-ui-selectors';
  import { selectWorkspaceNavigationMainPanel } from '$lib/store/slices/workspace-navigation/workspace-navigation-selectors';

  import {
    getTasksForAgent,
    type TaskAgentAssociation,
    TASK_ASSOCIATION_CHANGED_EVENT,
  } from '$lib/utils/task-agent-associations';
  import type { Workspace, AgentMetadata } from '$shared/types';
  import { extractAllContent } from '$shared/types';
  import { DEFAULT_AGENT_MODEL } from '$shared/constants/agent-services';
  import type { ContextItem } from './input/context-api';
  import SimpleRichInput from './input/SimpleRichInput.svelte';
  import ChatMessage from './ChatMessage.svelte';
  import DateSeparator from './DateSeparator.svelte';
  import EventWakeupBanner, { parseAgentEvents } from './EventWakeupBanner.svelte';
  import AgentCard from './AgentCard.svelte';
  import StreamingStatus from './StreamingStatus.svelte';
  import RegularAgentWelcome from './RegularAgentWelcome.svelte';
  import SuggestedPrompts from './SuggestedPrompts.svelte';
  import { groupMessagesByDate } from '$lib/utils/timeFormatting';
  import { followBottom, scrollToBottom as scrollToBottomUtil } from '$lib/utils/smartScroll';
  import { createLogger } from '$lib/utils/client-logger';
  import { isFocusInTerminal } from '$lib/utils/keyboardShortcuts';
  import { toast } from 'svelte-sonner';
  import Fa from 'svelte-fa';
  import { formatDistanceToNow } from '$lib/utils/date';
  import {
    faArrowDown,
    faSquareCheck,
    faLock,
    faLockOpen,
    faSearch,
    faTimes,
    faChevronUp,
    faChevronDown,
  } from '@fortawesome/free-solid-svg-icons';
  import { fade, slide } from 'svelte/transition';
  import { navigateToTask } from '$lib/utils/workspace-navigation';
  import ChatFileChangesSummary from './ChatFileChangesSummary.svelte';
  import AutoCommitStatus, { type CommitStatus } from './AutoCommitStatus.svelte';
  import QueuedMessageList from './QueuedMessageList.svelte';
  import { createMessageId } from '$shared/types/branded-ids';
  import { v4 as uuidv4 } from 'uuid';
  import type { QueuedMessage } from '$shared/types';
  import { unifiedOrchestrator } from '$features/agent/services/consolidated-backend.service';
  import Button from '../ui/button/button.svelte';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import AgentSubscriptions from './AgentSubscriptions.svelte';
  import { parseSuggestedPrompts } from '$lib/utils/messageParser';

  import LazyTurn from './LazyTurn.svelte';
  import InlinePermissionRequest from './InlinePermissionRequest.svelte';
  import { selectPermissionRequests } from '$lib/store/slices/permission/permission-selectors';
  import { selectIsAgentMonospace } from '$lib/store/slices/user-preferences/user-preferences-selectors';
  import {
    markAgentAsViewed,
    clearCurrentlyViewedAgent,
  } from '$lib/store/slices/unread-tracking/unread-tracking-slice';
  import AuroraBackground from './AuroraBackground.svelte';
  import { invoke, listenSync } from '$lib/electron-bridge';
  import {
    selectSpecialists,
    selectEffectiveBehaviorPrompt,
    selectEffectiveModel,
  } from '$lib/store/slices/specialists/specialists-selectors';

  import { getAgentProvider } from '$shared/types/agent-session';
  import { cleanErrorMessage } from '$shared/errors/messages';
  import { canChangeAgentProvider as resolveCanChangeAgentProvider } from './provider-lock';
  import { resolveHydratedInputModel } from './input-hydration';

  const logger = createLogger('ChatPanel');

  const multiPanelDispatch = getDispatch();
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
        const label = ref.title || ref.identifier || 'Context';
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
    /** Sandbox/preview mode - bypasses services and uses mock data */
    sandboxMode?: boolean;
    /** Mock messages to display in sandbox mode */
    sandboxMessages?: AgentMessage[];
    /** Mock streaming state in sandbox mode */
    sandboxIsStreaming?: boolean;
    /** Mock processing state in sandbox mode */
    sandboxIsProcessing?: boolean;
    /** Mock error in sandbox mode */
    sandboxError?: string | null;
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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    onClose: _onClose, // Prefix with underscore to indicate intentionally unused
    onFocus,
    onChatUpdate,
    isPanelFocused = false,
    sandboxMode = false,
    sandboxMessages = [],
    sandboxIsStreaming = false,
    sandboxIsProcessing = false,
    sandboxError = null,
  }: Props = $props();

  // Service instance — per-agent, permanently bound to this agent's ID
  const chatService = getChatService(agentId);

  // Writable store mirroring workspace.id so Redux selectors re-evaluate reactively
  const workspaceIdStore = writable(workspace?.id ?? '');
  $effect(() => {
    workspaceIdStore.set(workspace?.id ?? '');
  });

  // Reactive subscription to all panel-layout tabs — triggers availablePanelContexts recompute on tab changes
  const allPanelLayoutTabs$ = selectPanelLayoutAllTabs(workspaceIdStore);

  // Redux selectors for chat state — called at init time, reactive via Svelte store protocol
  const _chatAgentState$ = selectChatStateOrDefault(agentId ?? '');
  const _agentSession$ = selectAgentSession(agentId ?? '');
  const _agentMessages$ = selectAgentMessages(agentId ?? '');

  // Effective chat state - composes ChatAgentState + session/messages from agent-session slice
  let chatState = $derived.by((): ChatState => {
    if (sandboxMode) {
      return {
        agentId: agentId ?? '',
        session: { id: 'sandbox-session' } as ChatState['session'],
        messages: sandboxMessages,
        isStreaming: sandboxIsStreaming,
        isProcessing: sandboxIsProcessing,
        isInterrupting: false,
        streamingContent: sandboxIsStreaming ? 'Streaming content...' : '',
        error: sandboxError,
        streamingStartTime: sandboxIsStreaming ? Date.now() : null,
        lastAttemptedMessage: null,
        lastChunkTime: null,
        receivedFirstChunk: false,
        isStalled: false,
        modelUnavailable: null,
        statusEvents: [],
        trackedWorkspaceId: null,
        isRebinding: false,
        lastMessageTime: 0,
        recentSendKeys: [],
        lastChunkReceivedAt: 0,
      };
    }
    const session = $_agentSession$ ?? null;
    return {
      ...$_chatAgentState$,
      session,
      messages: $_agentMessages$,
      // isStreaming/isProcessing come from agent-session (single source of truth)
      isStreaming: session?.isStreaming ?? false,
      isProcessing: session?.isProcessing ?? false,
    };
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
  logger.debug('[ChatPanel] INSTANCE CREATED', { instanceId, agentId });

  let scrollContainer = $state<HTMLDivElement>();
  let inputComponent = $state<SimpleRichInput>();
  let shouldFollowBottom = $state(true);
  let isScrollUnlocked = $state(false); // User manually unlocked auto-scroll while at bottom
  let distanceFromBottom = $state(0); // Track actual scroll distance from bottom

  // Track which message is currently "sticky" (scrolled past its natural position)
  let stickyMessageId = $state<string | null>(null);

  let waitForSessionUnsub: (() => void) | null = null;

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
  const suggestedPrompts = $derived.by(() => {
    if (chatState.isStreaming || chatState.messages.length === 0) {
      return [] as import('$shared/types').SuggestedPrompt[];
    }
    const lastAssistantMessage = [...chatState.messages]
      .reverse()
      .find((m) => m.role === 'assistant');
    if (!lastAssistantMessage) {
      return [] as import('$shared/types').SuggestedPrompt[];
    }
    const messageContent = extractAllContent(lastAssistantMessage);
    const { prompts } = parseSuggestedPrompts(messageContent);
    return prompts;
  });

  // Alias — suggestedPrompts are displayed directly (no filtering needed)
  const visibleSuggestedPrompts = $derived(suggestedPrompts);

  // Search state
  let showSearch = $state(false);
  let searchQuery = $state('');
  let searchInputRef: HTMLInputElement | null = $state(null);
  let panelElement: HTMLElement | null = $state(null);
  let currentSearchIndex = $state(0);

  // Derive all individual match positions: { messageId, matchIndex (within message) }
  const allSearchMatches = $derived.by(() => {
    if (!searchQuery.trim()) {
      return [];
    }
    const query = searchQuery.toLowerCase();
    const matches: Array<{ messageId: string; matchIndexInMessage: number }> = [];

    for (const msg of chatState.messages) {
      const content = extractAllContent(msg);
      const lowerContent = content.toLowerCase();
      let index = 0;
      let matchIndexInMessage = 0;
      while ((index = lowerContent.indexOf(query, index)) !== -1) {
        matches.push({ messageId: msg.id, matchIndexInMessage });
        index += query.length;
        matchIndexInMessage++;
      }
    }

    return matches;
  });

  // Derive the match count from allSearchMatches
  const searchMatchCount = $derived(allSearchMatches.length);

  // Navigate to a search match (wraps around at boundaries)
  function scrollToSearchMatch(index: number) {
    if (allSearchMatches.length === 0) return;
    // Wrap around: going past the end cycles to the beginning, and vice versa
    let wrappedIndex = index % allSearchMatches.length;
    if (wrappedIndex < 0) wrappedIndex += allSearchMatches.length;
    currentSearchIndex = wrappedIndex;
    triggerHighlight();
  }

  // Trigger highlighting (called from event handlers, not effects)
  function triggerHighlight() {
    // Use untrack to read reactive values without creating dependencies
    const query = untrack(() => searchQuery);
    const index = untrack(() => currentSearchIndex);
    const isShowing = untrack(() => showSearch);
    const matches = untrack(() => allSearchMatches);
    const container = untrack(() => scrollContainer);
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
    matches: Array<{ messageId: string; matchIndexInMessage: number }>,
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

    // Find text nodes and create ranges for each match
    for (const [messageId, globalIndices] of matchesByMessage) {
      const messageEl = container.querySelector(`[data-message-id="${messageId}"]`);
      if (!messageEl) continue;

      const walker = document.createTreeWalker(messageEl, NodeFilter.SHOW_TEXT, null);
      let matchCountInMessage = 0;

      let node: Text | null;
      while ((node = walker.nextNode() as Text | null)) {
        const parent = node.parentElement;
        if (parent && !['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT'].includes(parent.tagName)) {
          const text = node.textContent || '';
          const lowerText = text.toLowerCase();
          let index = lowerText.indexOf(lowerQuery);

          while (index !== -1) {
            const globalIndex = globalIndices[matchCountInMessage];
            const range = document.createRange();
            range.setStart(node, index);
            range.setEnd(node, index + query.length);

            if (globalIndex === currentIndex) {
              currentRange = range;
            } else {
              allRanges.push(range);
            }

            matchCountInMessage++;
            index = lowerText.indexOf(lowerQuery, index + 1);
          }
        }
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

  // Handle search keyboard shortcuts
  function handleSearchKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      showSearch = false;
      searchQuery = '';
      triggerHighlight(); // Clear highlights
    } else if (e.key === 'Enter') {
      if (e.shiftKey) {
        scrollToSearchMatch(currentSearchIndex - 1);
      } else {
        scrollToSearchMatch(currentSearchIndex + 1);
      }
    }
  }

  // Handle search input changes
  function handleSearchInput() {
    currentSearchIndex = 0;
    triggerHighlight();
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
    const messages = chatState.messages;
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

  /**
   * Convert a File object to base64 data
   * Used for serializing context items before sending through IPC
   */
  async function fileToBase64(file: File): Promise<{ data: string; mimeType: string }> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // Extract base64 data from data URL (remove "data:image/png;base64," prefix)
        const base64Data = result.split(',')[1] || result;
        resolve({
          data: base64Data,
          mimeType: file.type || 'application/octet-stream',
        });
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }

  /**
   * Serialize context items for IPC transmission.
   * File objects cannot be cloned through Electron's structured clone algorithm,
   * so we convert them to base64 data before sending.
   */
  async function serializeContextItemsForIpc(
    items: ContextItem[],
  ): Promise<Omit<ContextItem, 'file'>[]> {
    const serializedItems: Omit<ContextItem, 'file'>[] = [];

    logger.info('serializeContextItemsForIpc: Starting serialization', {
      itemCount: items.length,
      items: items.map((item) => ({
        id: item.id,
        type: item.type,
        label: item.label,
        hasFile: !!item.file,
        fileName: item.file?.name,
        fileType: item.file?.type,
      })),
    });

    for (const item of items) {
      if (item.file) {
        // Convert File to base64 for both images and non-image files
        try {
          logger.info('Converting file to base64', {
            fileName: item.label,
            fileType: item.file.type,
            fileSize: item.file.size,
          });

          const { data, mimeType } = await fileToBase64(item.file);
          // Create a new object without the File property, but with base64 data
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { file: _file, ...rest } = item;

          logger.info('File converted successfully', {
            fileName: item.label,
            dataLength: data.length,
            mimeType,
          });

          if (item.file.type.startsWith('image/')) {
            // For images, use imageData and imageMimeType
            serializedItems.push({
              ...rest,
              imageData: data,
              imageMimeType: mimeType,
            });
          } else {
            // For non-image files, use fileData and fileMimeType
            serializedItems.push({
              ...rest,
              fileData: data,
              fileMimeType: mimeType,
            });
          }
        } catch (error) {
          logger.error('Failed to serialize file context item', { fileName: item.label, error });
          // Skip items that fail to serialize
        }
      } else {
        // No File property, item is already serializable
        serializedItems.push(item);
      }
    }

    logger.info('serializeContextItemsForIpc: Serialization complete', {
      originalCount: items.length,
      serializedCount: serializedItems.length,
      serializedItems: serializedItems.map((item) => ({
        id: item.id,
        type: item.type,
        label: item.label,
        hasFileData: !!(item as any).fileData,
        hasImageData: !!(item as any).imageData,
      })),
    });

    return serializedItems;
  }

  // Restore draft input from transient store on mount
  let draftRestored = $state(false);
  $effect(() => {
    if (draftRestored || !workspace || !agentId) return;
    const savedDraft = untrack(() =>
      selectChatDraft.select(getReduxStore().getState(), workspace.id, agentId),
    );
    if (savedDraft) {
      // Use untrack to avoid creating a dependency on inputValue
      const currentInputValue = untrack(() => inputValue);
      if (!currentInputValue) {
        inputValue = savedDraft;
        // Also update the input component if it exists
        setTimeout(() => {
          inputComponent?.setContent?.(savedDraft);
        }, 50);
      }
    }
    draftRestored = true;
  });

  // Sync input value to transient store when it changes
  // Use a non-reactive variable to track previous value (avoids circular dependency)
  let previousSavedDraft = '';
  $effect(() => {
    if (!workspace || !agentId) return;
    // Read inputValue to track it as a dependency
    const currentValue = inputValue;
    // Only save if it actually changed from what we last saved
    if (currentValue !== previousSavedDraft) {
      previousSavedDraft = currentValue;
      multiPanelDispatch(setChatDraft(workspace.id, agentId, currentValue));
    }
  });

  // Queued messages
  let queuedMessages = $state<QueuedMessage[]>([]);
  let queueListenerCleanup: (() => void) | null = null;
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

  const mainPanel = $derived(selectWorkspaceNavigationMainPanel(workspace.id));
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
      const note = selectNoteById.select(getReduxStore().getState(), workspace.id, noteId);
      const isSpec = noteId === 'spec';

      return {
        type: isSpec ? 'spec' : 'note',
        noteId,
        title: note?.title || (isSpec ? 'Spec' : undefined),
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
            label: tab.title || tab.filePath.split('/').pop() || 'File',
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
            label: tab.title || (isSpec ? 'Spec' : 'Note'),
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
            label: tab.title || tab.diffPath.split('/').pop() || 'Diff',
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
            label: tab.title || 'Browser',
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
            label: tab.title || 'Agent',
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
        multiPanelDispatch(setMultiPanelWorkspace(workspace.id));
        multiPanelDispatch(updateMultiPanels(panels));
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
        multiPanelDispatch(
          setMultiPanelSelection({
            panelId,
            tabId,
            sourceType: isNote ? 'note' : 'file',
            sourceLabel: file?.split('/').pop() || 'Selection',
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
        multiPanelDispatch(clearMultiPanelSelection(panelId, tabId));
      }
    };

    window.addEventListener('editor:selection-change', handleSelectionChange as EventListener);
    return () => {
      window.removeEventListener('editor:selection-change', handleSelectionChange as EventListener);
    };
  });

  // Pending initial prompt data - shown immediately as optimistic UI before the message is actually sent
  // Uses prop first (passed from parent), then falls back to sessionStorage
  // Returns both prompt text and contextReferences for proper display
  function getInitialPendingData(): { prompt: string | null; contextReferences: any[] | null } {
    // First check prop - this is the fastest path
    if (initialPromptProp) {
      logger.info('Using initial prompt from prop for optimistic display', {
        agentId,
        promptLength: initialPromptProp.length,
      });
      // When using prop, we don't have contextReferences available
      // They will be in sessionStorage if present
      if (workspace) {
        const agentConfigKey = `workspace:${workspace.id}:agent-config`;
        const agentConfigData = sessionStorage.getItem(agentConfigKey);
        if (agentConfigData) {
          try {
            const config = JSON.parse(agentConfigData);
            if (config.agentId === agentId && config.contextReferences?.length > 0) {
              return { prompt: initialPromptProp, contextReferences: config.contextReferences };
            }
          } catch {
            // Ignore parse errors
          }
        }
      }
      return { prompt: initialPromptProp, contextReferences: null };
    }

    // Fall back to sessionStorage
    if (!workspace) return { prompt: null, contextReferences: null };

    const agentConfigKey = `workspace:${workspace.id}:agent-config`;
    const agentConfigData = sessionStorage.getItem(agentConfigKey);

    if (agentConfigData) {
      try {
        const config = JSON.parse(agentConfigData);
        if (config.agentId === agentId && (config.prompt || config.contextReferences?.length > 0)) {
          logger.info('Found pending initial data from sessionStorage for optimistic display', {
            agentId,
            promptLength: config.prompt?.length || 0,
            hasContextReferences: !!config.contextReferences?.length,
            contextReferenceCount: config.contextReferences?.length || 0,
          });
          return {
            prompt: config.prompt || null,
            contextReferences: config.contextReferences || null,
          };
        }
      } catch (err) {
        logger.warn('Failed to parse agent config for optimistic display', err);
      }
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
      session: chatState.session,
      messages: chatState.messages,
      pendingInitialPrompt,
      pendingContextReferenceCount: pendingInitialData.contextReferences?.length ?? 0,
    }),
  );

  // Hydrated input model — uses session model when available, falls back to agentModel prop
  let hydratedInputModel = $derived(resolveHydratedInputModel(chatState.session, agentModel));

  // Provider ID for the input — resolved from the agent session
  let inputProviderId = $derived.by(() => {
    if (!chatState.session) return undefined;
    return getAgentProvider(chatState.session);
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
        } as import('$features/agent/agent-ipc-bridge').AgentMessage)
      : null,
  );

  // Note: pendingInitialPrompt is cleared in sendInitialMessage() after the message is sent
  // We don't need a reactive effect here as it can cause infinite loops

  function cleanupInitialAgentArtifacts() {
    if (!workspace) return;
    const pendingAgentKey = `workspace:${workspace.id}:initial-agent-pending`;
    const agentConfigKey = `workspace:${workspace.id}:agent-config`;

    sessionStorage.removeItem(pendingAgentKey);
    sessionStorage.removeItem(agentConfigKey);
  }

  async function waitForSessionReady(timeoutMs = 5000): Promise<boolean> {
    if (chatState.session) return true;

    return new Promise((resolve) => {
      const start = performance.now();

      waitForSessionUnsub?.();
      const store = getReduxStore();
      // Check agent-session slice for session readiness
      let prevSession = selectAgentSession.select(store.getState(), agentId ?? '');
      const checkReady = (session: typeof prevSession) => {
        const ready = !!session;
        const expired = performance.now() - start >= timeoutMs;

        if (ready || expired) {
          waitForSessionUnsub?.();
          waitForSessionUnsub = null;
          resolve(ready);
        }
      };
      // Check initial state immediately
      checkReady(prevSession);
      waitForSessionUnsub = store.subscribe(() => {
        const nextSession = selectAgentSession.select(store.getState(), agentId ?? '');
        if (nextSession !== prevSession) {
          prevSession = nextSession;
          checkReady(nextSession);
        }
      });
    });
  }

  // CRITICAL FIX: Deduplicate messages before grouping to prevent Svelte "duplicate key" error
  // This is a safety net that catches duplicates regardless of their source (disk, race conditions, etc.)
  let deduplicatedMessages = $derived.by(() => {
    const seen = new Set<string>();
    return chatState.messages.filter((m) => {
      if (seen.has(m.id)) {
        logger.warn('[ChatPanel] Filtering duplicate message before render', { messageId: m.id });
        return false;
      }
      seen.add(m.id);
      return true;
    });
  });

  // Grouped messages for display (include ALL messages)
  // We'll handle the streaming state when rendering
  let groupedMessages = $derived(groupMessagesByDate(deduplicatedMessages));

  // Get the auggie session ID from the most recent assistant message's metadata
  // This is the raw UUID format that auggie uses, needed for debugging/support
  let auggieSessionId = $derived.by(() => {
    // Look for auggieSessionId in assistant messages (most recent first)
    for (let i = chatState.messages.length - 1; i >= 0; i--) {
      const msg = chatState.messages[i];
      if (msg.role === 'assistant' && msg.metadata?.auggieSessionId) {
        return msg.metadata.auggieSessionId as string;
      }
    }
    return undefined;
  });

  // DEBUG: Track message changes to diagnose duplicate flash issue
  $effect(() => {
    const messageIds = chatState.messages.map((m) => m.id);
    const uniqueIds = new Set(messageIds);
    const hasDuplicateIds = messageIds.length !== uniqueIds.size;

    // Log group first message IDs to check for key stability
    const groupKeys = groupedMessages.map((g, i) => g.messages[0]?.id ?? `fallback-${i}`);

    logger.debug('[ChatPanel] DEBUG: Message state changed', {
      instanceId,
      agentId,
      messageCount: chatState.messages.length,
      hasDuplicateIds,
      isStreaming: chatState.isStreaming,
      isProcessing: chatState.isProcessing,
      messageIds: messageIds.slice(-3), // last 3 message IDs
      groupCount: groupedMessages.length,
      groupKeys,
    });

    if (hasDuplicateIds) {
      logger.warn('[ChatPanel] DUPLICATE MESSAGE IDS DETECTED!', {
        instanceId,
        agentId,
        messageIds,
        duplicates: messageIds.filter((id, i) => messageIds.indexOf(id) !== i),
      });
    }
  });

  // PERF: Pre-compute total turn count for lazy loading decisions
  // Count user messages as proxy for turns (each user message starts a turn)
  const totalTurnCount = $derived(chatState.messages.filter((m) => m.role === 'user').length);

  // PERF: Enable lazy loading only for larger conversations
  const shouldUseLazyLoading = $derived(totalTurnCount > LAZY_TURN_THRESHOLD);

  // PERF: Pre-compute message index and turn number maps for O(1) lookups
  // This avoids O(n²) complexity from indexOf/slice/filter in the render loop
  const messageIndexMap = $derived.by(() => {
    const map = new Map<string, number>();
    for (let i = 0; i < chatState.messages.length; i++) {
      map.set(chatState.messages[i].id, i);
    }
    return map;
  });

  const messageTurnNumberMap = $derived.by(() => {
    const map = new Map<string, number>();
    let turnCount = 0;
    for (const message of chatState.messages) {
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
    const currentCount = chatState.messages.length;
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
    userMessage: (typeof chatState.messages)[0] | null;
    assistantMessages: typeof chatState.messages;
  }

  function groupIntoTurns(messages: typeof chatState.messages): ConversationTurn[] {
    const turns: ConversationTurn[] = [];
    let currentTurn: ConversationTurn | null = null;

    for (const message of messages) {
      if (message.role === 'user') {
        // Start a new turn
        if (currentTurn) {
          turns.push(currentTurn);
        }
        currentTurn = { userMessage: message, assistantMessages: [] };
      } else if (message.role === 'assistant') {
        if (currentTurn) {
          currentTurn.assistantMessages.push(message);
        } else {
          // Orphan assistant message (no preceding user message)
          turns.push({ userMessage: null, assistantMessages: [message] });
        }
      }
    }

    // Push final turn
    if (currentTurn) {
      turns.push(currentTurn);
    }

    return turns;
  }

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

  // Trigger for refreshing task associations (incremented when localStorage changes)
  let taskRefreshTrigger = $state(0);

  // Get tasks assigned to this agent (reactive, updates when workspace, agent, or trigger changes)
  const agentTasks = $derived.by(() => {
    // Include taskRefreshTrigger to make this reactive to localStorage changes
    void taskRefreshTrigger;
    if (!workspace?.id || !agentId) return [];
    return getTasksForAgent(workspace.id, agentId);
  });

  // Get the current specialist ID from the session metadata
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const currentSpecialistId = $derived.by(() => {
    const session = chatState.session;
    if (!session) return null;
    return session.metadata?.specialist || session.agentMetadata?.specialist || null;
  });

  // Listen for task association changes via custom event
  $effect(() => {
    if (!browser) return;

    const handleTaskAssociationChange = () => {
      taskRefreshTrigger++;
    };

    window.addEventListener(TASK_ASSOCIATION_CHANGED_EVENT, handleTaskAssociationChange);

    return () => {
      window.removeEventListener(TASK_ASSOCIATION_CHANGED_EVENT, handleTaskAssociationChange);
    };
  });

  // Track last fetched agent to prevent duplicate queue fetches
  let lastQueueFetchAgentId: string | null = null;

  // Fetch queue when agentId changes (handles tab switching)
  $effect(() => {
    if (!browser || sandboxMode || !agentId || !workspace) return;

    // Skip if we already fetched for this agent
    if (lastQueueFetchAgentId === agentId) return;

    lastQueueFetchAgentId = agentId;

    // Fetch queue when switching agents to ensure we have the latest state
    logger.debug('Fetching queue state for agent', { agentId });

    unifiedOrchestrator
      .getQueue(agentId)
      .then((result: { success: boolean; queue?: QueuedMessage[]; error?: string }) => {
        // CRITICAL: Check destruction flag FIRST, before accessing ANY reactive state.
        // This prevents "N is not a function" errors when Svelte's reactive system
        // tries to call nullified internal functions after component destruction.
        if (isComponentDestroyed) return;

        if (result.success && result.queue) {
          queuedMessages = result.queue;
          logger.debug('Queue state fetched successfully', {
            agentId,
            count: result.queue.length,
          });
        } else {
          logger.warn('Failed to fetch queue state', { agentId, error: result.error });
        }
      })
      .catch((error) => {
        // Also check destruction to avoid logging errors for destroyed component
        if (isComponentDestroyed) return;

        logger.error('Error fetching queue state', {
          agentId,
          error: error?.message,
        });
      });
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
      sandboxMode,
    });

    // Permission store is now auto-initialized via Redux saga — no manual initialize() needed

    // Skip service initialization in sandbox mode
    if (sandboxMode) {
      logger.info('ChatPanel in sandbox mode - skipping service initialization');
      return;
    }

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
      multiPanelDispatch(chatTrackedWorkspaceSet(agentId, workspace.id));

      multiPanelDispatch(
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
    }

    // Set up queue listener using listenSync for proper cleanup without race conditions
    queueListenerCleanup = listenSync('agent:queue:updated', (event: any) => {
      const data = event.payload || event;
      if (data.agentId === agentId) {
        queuedMessages = data.queue;
        logger.debug('Queue updated via IPC event', { agentId, count: data.queue.length });
      }
    });

    // Note: Initial queue fetch is now handled by the reactive $effect above
    // This ensures the queue is refetched when switching between agents

    // Chat state is now fully reactive via the selectChatStateOrDefault selector.
    // No manual Redux store subscription needed — the selector provides always-current state.

    // Initialize chat session (skip if already done above)
    if (workspace && agentId) {
      // rebindTracker.recordMount() is already called above before dispatch

      (async () => {
        try {
          // We've already dispatched initializeChatRequested above, so just check for pending messages

          // Check for pending initial message from workspace creation
          if (workspace && agentId && chatState.messages.length === 0) {
            // Check for initial agent config
            const agentConfigKey = `workspace:${workspace.id}:agent-config`;
            const agentConfigData = sessionStorage.getItem(agentConfigKey);

            if (agentConfigData) {
              try {
                const config = JSON.parse(agentConfigData);

                // Check if this is the initial agent and has a prompt, context references, or images
                const hasPrompt = !!config.prompt;
                const hasContextReferences =
                  config.contextReferences && config.contextReferences.length > 0;
                const hasImageBlocks = config.imageBlocks && config.imageBlocks.length > 0;
                // Check if message was already sent (e.g., by CompactWorkspaceInitializer in stayOnHomePage mode)
                const alreadySent = !!config.messageSent;

                if (
                  config.agentId === agentId &&
                  (hasPrompt || hasContextReferences || hasImageBlocks)
                ) {
                  if (alreadySent) {
                    // Message was already sent by workspace initializer, just clear the config
                    logger.info('Initial message already sent by workspace initializer, skipping', {
                      agentId,
                      promptLength: config.prompt?.length || 0,
                    });

                    // IMPORTANT: Since the message was already sent, streaming should be in progress.
                    // Dispatch chatSendStarted to set streaming state in Redux immediately
                    // so the StreamingStatus indicator shows right away.
                    getReduxStore().dispatch(chatSendStarted(agentId));

                    // Clear the prompt, images, and context refs from config now that we've displayed them
                    config.prompt = null;
                    config.imageBlocks = null;
                    config.contextReferences = null;
                    config.messageSent = null;
                    sessionStorage.setItem(agentConfigKey, JSON.stringify(config));
                  } else {
                    logger.info('Found initial prompt/context from workspace creation', {
                      agentId,
                      promptLength: config.prompt?.length || 0,
                      hasImageBlocks,
                      hasContextReferences,
                      contextReferenceCount: config.contextReferences?.length || 0,
                    });

                    // Send the initial message once the session is ready, including any images and context refs
                    await sendInitialMessage(
                      config.prompt,
                      config.imageBlocks,
                      config.contextReferences,
                    );
                    // Clear the prompt, images, and context refs from config to prevent re-sending (retain other metadata)
                    config.prompt = null;
                    config.imageBlocks = null;
                    config.contextReferences = null;
                    sessionStorage.setItem(agentConfigKey, JSON.stringify(config));
                  }
                }
              } catch (err) {
                logger.warn('Failed to parse agent config', err);
              }
            }
          }
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          logger.error('Failed to initialize chat', error);
          toast.error(cleanErrorMessage(msg));
        }
      })();
    }

    // Scroll handling on mount
    requestAnimationFrame(() => {
      if (scrollContainer) {
        if ((chatState.messages?.length || 0) > 0) {
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

  // WORKSPACE REBIND FIX: Reactively re-initialize the ChatService when the workspace
  // changes underneath an already-mounted ChatPanel. Without this, the panel stays stuck
  // on the pre-send conversation snapshot because initializeChatRequested only runs on mount and
  // during workspace rebind. During workspace restore/rebind the workspace prop changes
  // but the component does not remount (AgentTabType keys by agentId only).
  $effect(() => {
    const currentWorkspaceId = workspace?.id;
    if (!currentWorkspaceId || !agentId || sandboxMode) return;

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
      multiPanelDispatch(chatTrackedWorkspaceSet(agentId, currentWorkspaceId));
    });

    // Re-initialize via saga — takeLatest automatically cancels any in-flight older init,
    // replacing the stale-result guard that used to be handled manually.
    const rebindGeneration = untrack(() => rebindTracker.startRebind());
    multiPanelDispatch(chatRebindStarted(agentId));

    multiPanelDispatch(
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
    multiPanelDispatch(chatRebindEnded(agentId));
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

    const messages = chatState.messages;
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

    const messages = chatState.messages;
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
      const allMessages = [...chatState.messages].reverse();

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
    const userMessages = chatState.messages.filter((m) => m.role === 'user');
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
    if (!chatState.session) return; // Wait for session to be ready

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
      getReduxStore().dispatch(markAgentAsViewed(agentId));
    } else {
      // Panel is no longer active (user switched to another tab) —
      // clear so new messages for this agent are properly marked as unread.
      getReduxStore().dispatch(clearCurrentlyViewedAgent());
    }
  });

  onDestroy(() => {
    // CRITICAL: Set destruction flag FIRST, before any other cleanup.
    // This prevents async callbacks (like unifiedOrchestrator.getQueue().then(...))
    // from accessing reactive state after destruction, which would cause
    // "N is not a function" errors in Svelte's reactive system.
    isComponentDestroyed = true;

    // Clear currently viewed agent so other agents can properly be marked as unread
    if (agentId) {
      getReduxStore().dispatch(clearCurrentlyViewedAgent());
    }

    logger.info('ChatPanel destroyed', { instanceId, agentId });
    // Clean up subscriptions and scroll manager
    waitForSessionUnsub?.();
    queueListenerCleanup?.();
    // Pause background timers (state reconciliation, stall detection) to prevent
    // false positives during workspace switches. The timers would otherwise keep
    // running and falsely reset streaming state when the backend query returns
    // no active streams (because the query runs in the wrong workspace context).
    chatService.pauseBackgroundTimers();
    // Note: followBottom action cleanup is handled automatically by Svelte
    // Don't clear chat data - just cleanup listeners
    // The service will persist data for when the panel is reopened
  });

  // Notify parent of chat state updates (replaces the old store subscription callback)
  $effect(() => {
    if (typeof onChatUpdate !== 'function' || chatState.messages.length === 0) return;
    const messages = chatState.messages;
    const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');
    const lastAgentMessage = [...messages].reverse().find((m) => m.role === 'assistant');

    onChatUpdate({
      lastUserMessage: lastUserMessage ? extractAllContent(lastUserMessage) : undefined,
      lastAgentResponse: lastAgentMessage ? extractAllContent(lastAgentMessage) : undefined,
      isProcessing: chatState.isProcessing,
      messageCount: messages.length,
    });
  });

  // Handle editing a queued message
  async function handleEditQueuedMessage(messageId: string, content: string) {
    const result = await unifiedOrchestrator.editQueuedMessage(agentId, messageId, content);
    if (!result.success) {
      logger.error('Failed to edit queued message', { messageId, error: result.error });
    }
  }

  // Handle removing a queued message
  async function handleRemoveQueuedMessage(messageId: string) {
    const result = await unifiedOrchestrator.removeQueuedMessage(agentId, messageId);
    if (!result.success) {
      logger.error('Failed to remove queued message', { messageId, error: result.error });
    }
  }

  // Handle sending a queued message immediately (interrupts current stream)
  async function handleSendQueuedMessageNow(messageId: string) {
    const message = queuedMessages.find((m) => m.id === messageId);
    if (!message || !workspace) return;

    logger.info('Send queued message now triggered', { messageId, agentId });

    // Remove from queue first
    const removeResult = await unifiedOrchestrator.removeQueuedMessage(agentId, messageId);
    if (!removeResult.success) {
      logger.error('Failed to remove queued message before sending', { messageId });
      return;
    }

    // Stop current streaming
    if (chatState.isStreaming || chatState.isProcessing) {
      try {
        await chatService.stopChat(agentId);
        // Wait for the interrupt to fully complete (isInterrupting becomes false)
        const maxWaitMs = 500;
        const pollIntervalMs = 25;
        let waited = 0;
        while (waited < maxWaitMs) {
          const state = chatService.getState(agentId);
          if (!state.isInterrupting) {
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
          waited += pollIntervalMs;
        }
      } catch (error) {
        logger.error('Failed to stop chat before sending queued message', error);
      }
    }

    // Send the queued message
    try {
      // Include noteIds if the current context is a note - this allows agents to "see" images in notes
      const noteIds = currentMainPanelContext?.noteId
        ? [currentMainPanelContext.noteId]
        : undefined;
      // Pass agentId to ensure message goes to the correct agent
      // Convert queued image blocks to context items so they are sent to the agent
      const imageContextItems = message.imageBlocks?.map((block, index) => ({
        id: `queued-image-${index}`,
        type: 'file' as const,
        label: `Image ${index + 1}`,
        imageData: block.data,
        imageMimeType: block.mimeType,
      }));
      const queuedContextItems = imageContextItems?.length ? imageContextItems : undefined;
      await chatService.sendMessage(message.content, workspace, agentId, {
        noteIds,
        agentId,
        contextItems: queuedContextItems,
      });
      if (scrollContainer) scrollToBottomUtil(scrollContainer);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to send message';
      const isInterrupted = errorMessage.includes('Agent interrupted');
      if (!isInterrupted) {
        logger.error('Failed to send queued message', error);
        toast.error(cleanErrorMessage(errorMessage));
      }
    }
  }

  // Build workspace context string for agent messages
  function buildWorkspaceContextString(): string {
    const parts: string[] = [];

    // Add context from checked panels in the multi-panel context store
    const storeState = getReduxStore().getState();
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
        parts.push(`[Currently viewing file: ${panel.filePath}]`);
      } else if (panel.type === 'diff' && panel.filePath) {
        parts.push(`[Currently viewing diff for: ${panel.filePath}]`);
      } else if (panel.type === 'note' && panel.noteId) {
        parts.push(
          `[Currently viewing note: "${panel.label}" (ID: ${panel.noteId}). Use read_note_space-mcp(noteId="${panel.noteId}") to read its content.]`,
        );
      } else if (panel.type === 'spec') {
        parts.push('[Currently viewing: Spec]');
      } else if (panel.type === 'browser' && panel.browserUrl) {
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
      parts.push(`[Selected text${source}:\n\`\`\`\n${displayText}\n\`\`\`]`);
    }

    return parts.join('\n');
  }

  // Input history navigation callbacks (terminal-like up/down arrow)
  function handleHistoryPrev(): string | null {
    // If there are queued messages and we're not already navigating history,
    // edit the last queued message instead of cycling through sent history
    if (queuedMessages.length > 0 && historyIndex === -1 && !inputValue.trim()) {
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

  // Handle sending messages
  async function handleSend(text: string) {
    // Gather DOM state (inline images, mentions) BEFORE clearing input
    const inlineImageItems = inputComponent?.getInlineImageContextItems?.() ?? [];
    const mentionContextItems = inputComponent?.getMentionContextItems?.() ?? [];
    const hasContent = text?.trim() || contextItems.length > 0 || inlineImageItems.length > 0;
    if (!hasContent || !workspace || !isActive) return;

    if (text?.trim()) addToInputHistory(text);

    // Merge and serialize context items (File objects → base64 for IPC)
    const allContextItems = [...contextItems, ...inlineImageItems, ...mentionContextItems];
    const serializedContext =
      allContextItems.length > 0 ? await serializeContextItemsForIpc(allContextItems) : undefined;
    const imageBlocks = serializedContext
      ?.filter((item) => item.imageData && item.imageMimeType)
      .map((item) => ({
        type: 'image' as const,
        data: item.imageData!,
        mimeType: item.imageMimeType!,
      }));
    const workspaceContextStr = buildWorkspaceContextString();
    const noteIds = currentMainPanelContext?.noteId ? [currentMainPanelContext.noteId] : undefined;

    // Clear input immediately (DOM concern — stays in component)
    contextItems = [];
    inputValue = '';
    inputComponent?.clear();
    shouldFollowBottom = true;
    isScrollUnlocked = false;

    // Dispatch all orchestration to the send-message saga
    multiPanelDispatch(
      sendMessage(agentId, {
        wsId: workspace.id,
        text,
        serializedContextItems: serializedContext as SendMessagePayload['serializedContextItems'],
        workspaceContextStr,
        noteIds,
        imageBlocks,
        agentName,
        agentModel,
        isInitialWorkspaceAgent,
      }),
    );
  }

  // Handle stopping the current generation
  async function handleStop() {
    try {
      // Per-agent ChatService: always bound to this agent, use stopChat() directly
      await chatService.stopChat(agentId);

      // FIX: Directly update the last message with interrupted flag and clear streaming state.
      // We can't rely on the backend completion event because the stream handler is cleaned up
      // by backendStop() before the completion event with stopReason arrives.
      if (workspace) {
        // Clear streaming state immediately (setAgentStreaming triggers cross-slice handler in agent-session-slice)
        getReduxStore().dispatch(setAgentStreaming(workspace.id, agentId, false));

        // Find and update the last assistant message with interrupted flag
        const messages = chatState.messages;
        const lastAssistantMessage = [...messages].reverse().find((m) => m.role === 'assistant');
        if (lastAssistantMessage) {
          const updatedMetadata = {
            ...lastAssistantMessage.metadata,
            interrupted: true,
          };
          logger.info('Setting interrupted flag on last assistant message', {
            agentId,
            messageId: lastAssistantMessage.id,
            existingMetadata: lastAssistantMessage.metadata,
            newMetadata: updatedMetadata,
          });
          getReduxStore().dispatch(
            updateAgentSessionMessage(agentId, lastAssistantMessage.id, {
              isStreaming: false,
              metadata: updatedMetadata,
            }),
          );
        } else {
          // No assistant message exists yet (user stopped before any response arrived).
          // Create a placeholder assistant message with interrupted flag so the UI shows "Stopped".
          const stoppedMessage: AgentMessage = {
            id: createMessageId(`msg_${uuidv4()}`),
            role: 'assistant',
            contentBlocks: [],
            timestamp: new Date().toISOString(),
            isStreaming: false,
            metadata: {
              interrupted: true,
            },
          };

          logger.info('Creating placeholder interrupted message (stopped before response)', {
            agentId,
            messageId: stoppedMessage.id,
          });

          // Add the message to Redux store — the reactive selector will update the UI
          getReduxStore().dispatch(addAgentSessionMessage(agentId, stoppedMessage));
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error('Failed to stop chat', error);
      toast.error(cleanErrorMessage(msg));
    }
  }

  // Handle retrying the last failed message
  async function handleRetry() {
    if (!workspace) return;
    try {
      await chatService.retryLastMessage(workspace, agentId);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Something went wrong';
      logger.error('Failed to retry message', error);
      toast.error(cleanErrorMessage(msg));
    }
  }

  // Handle retrying with a specific model (when current model is unavailable)
  async function handleRetryWithModel(model: string) {
    if (!workspace) return;
    try {
      // Retry with the specified model (this also clears modelUnavailable state)
      await chatService.retryWithModel(workspace, agentId, model);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Something went wrong';
      logger.error('Failed to retry with model', { model, error });
      toast.error(cleanErrorMessage(msg));
    }
  }

  // Handle changing the specialist for an agent
  // The specialist can be changed at any time - even after messages have been sent.
  // The new specialist behavior will apply to subsequent messages.
  async function handleSpecialistChange(specialistId: string | null) {
    if (!workspace || !agentId) return;

    const session = chatState.session;
    if (!session) return;

    logger.info('Changing agent specialist', { agentId, specialistId });

    let behaviorPrompt: string | undefined;
    let newModel: string | undefined;
    let specialistName: string | undefined;

    if (specialistId) {
      // Direct specialist selected
      const reduxState = getReduxStore().getState();
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
      getReduxStore().dispatch(
        updateAgentSessionFields(agentId, { metadata: newMetadata, model: newModel }),
      );
    }

    // Try to persist the session to disk for future sessions.
    // NOTE: This may fail for sessions with no messages (which is fine), because:
    // 1. The in-memory metadata is updated via Redux dispatch above
    // 2. When sending a message, the metadata is passed directly in the request
    // 3. The backend will read from request.metadata (priority) before disk
    // If persistence succeeds, the specialist will be remembered for future sessions.
    try {
      await agentService.saveSession(agentId, workspace.id, true);
      logger.info('Agent specialist changed and persisted', {
        agentId,
        specialistId,
        newModel,
        hasBehaviorPrompt: !!behaviorPrompt,
        behaviorPromptLength: behaviorPrompt?.length || 0,
      });
    } catch (error) {
      // Expected to fail for empty sessions - that's OK, metadata is passed in request
      logger.debug('Could not persist specialist change (expected for empty sessions)', {
        agentId,
        error,
      });
    }
  }

  // Handle force submit - interrupt streaming and send immediately (⌘Enter)
  async function handleForceSubmit(text: string) {
    // Check for content: text, context items, or inline images
    const inlineImageItems = inputComponent?.getInlineImageContextItems?.() ?? [];
    const hasContent = text?.trim() || contextItems.length > 0 || inlineImageItems.length > 0;
    if (!hasContent || !workspace) {
      return;
    }

    logger.info('Force submit triggered - stopping current stream and sending', { agentId });

    // Stop current streaming first
    if (chatState.isStreaming || chatState.isProcessing) {
      try {
        await chatService.stopChat(agentId);
        // Wait for the interrupt to fully complete (isInterrupting becomes false)
        const maxWaitMs = 500;
        const pollIntervalMs = 25;
        let waited = 0;
        while (waited < maxWaitMs) {
          const state = chatService.getState(agentId);
          if (!state.isInterrupting) {
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
          waited += pollIntervalMs;
        }
      } catch (error) {
        logger.error('Failed to stop chat before force submit', error);
      }
    }

    // Now send the message using the same logic as handleSend (but skip the queue check)
    try {
      // Extract inline images and @-mentioned files from the editor BEFORE clearing
      const inlineImageItems = inputComponent?.getInlineImageContextItems?.() ?? [];
      const mentionContextItems = inputComponent?.getMentionContextItems?.() ?? [];

      // Merge inline images and mention-derived context items with existing context items
      const allContextItems = [...contextItems, ...inlineImageItems, ...mentionContextItems];
      const contextToSend = allContextItems.length > 0 ? allContextItems : undefined;
      const workspaceContextStr = buildWorkspaceContextString();

      // Clear input immediately
      contextItems = [];
      inputValue = '';
      inputComponent?.clear();
      multiPanelDispatch(clearChatDraft(workspace.id, agentId));
      // Clear selection context - it's been captured in workspaceContextStr above
      // This prevents stale selections from being included in subsequent messages
      multiPanelDispatch(uncheckAllSelections());
      const messageWithContext = workspaceContextStr
        ? `${workspaceContextStr}\n\n${text.trim()}`
        : text.trim();

      // Include noteIds if the current context is a note - this allows agents to "see" images in notes
      const noteIds = currentMainPanelContext?.noteId
        ? [currentMainPanelContext.noteId]
        : undefined;
      // Pass agentId to ensure message goes to the correct agent
      await chatService.sendMessage(messageWithContext, workspace, agentId, {
        contextItems: contextToSend,
        noteIds,
        agentId,
      });

      if (scrollContainer) scrollToBottomUtil(scrollContainer);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to send message';
      const isInterrupted = errorMessage.includes('Agent interrupted');
      if (!isInterrupted) {
        logger.error('Failed to send message', error);
        toast.error(cleanErrorMessage(errorMessage));
      }
    }
  }

  // Handle editing a user message and regenerating
  async function handleEditMessage(messageId: string, newText: string, model?: string) {
    if (!workspace) return;
    try {
      // Per-agent ChatService: always bound to this agent, no re-acquisition needed
      await chatService.editAndRegenerate(
        messageId,
        newText,
        workspace,
        agentId,
        model ? { model } : undefined,
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Something went wrong';
      logger.error('Failed to edit message', error);
      toast.error(cleanErrorMessage(msg));
    }
  }

  // Handle regenerating from a specific assistant message
  async function handleRegenerateFromMessage(assistantMessageId: string) {
    if (!workspace) return;
    try {
      // Per-agent ChatService: always bound to this agent, no re-acquisition needed
      await chatService.regenerateFromMessage(assistantMessageId, workspace, agentId);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Something went wrong';
      logger.error('Failed to regenerate from message', error);
      toast.error(cleanErrorMessage(msg));
    }
  }

  // Handle forking the conversation from a specific message
  async function handleForkFromMessage(messageId: string) {
    if (!workspace) return;
    try {
      // Per-agent ChatService: always bound to this agent, no re-acquisition needed
      // forkSession creates the fork and opens it via workspace:open-agent event,
      // which opens the fork in its own panel tab with its own ChatService instance.
      // This preserves the parent ChatService's state.
      const forkedId = await chatService.forkSession(workspace, agentId, {
        forkFromMessageId: messageId,
      });
      toast.success('Conversation forked');
      logger.info('Forked conversation from message', { messageId, forkedId });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Something went wrong';
      logger.error('Failed to fork conversation', error);
      toast.error(cleanErrorMessage(msg));
    }
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
    return chatState.messages;
  }

  export function getNavigationState() {
    const userMessages = chatState.messages.filter((m) => m.role === 'user');
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
  async function handleResendLastMessage() {
    const messages = chatState.messages;
    if (messages.length === 0) return;

    // Find the last assistant message
    const lastAssistantMessage = [...messages].reverse().find((m) => m.role === 'assistant');
    if (lastAssistantMessage) {
      await handleRegenerateFromMessage(lastAssistantMessage.id);
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

  // Track retry attempts for initial message
  export async function sendInitialMessage(
    message: string | undefined,
    imageBlocks?: Array<{ type: 'image'; data: string; mimeType: string }>,
    contextReferences?: any[],
  ) {
    // Allow sending with just context references or images (no message text)
    const hasMessage = !!message?.trim();
    const hasContextReferences = contextReferences && contextReferences.length > 0;
    const hasImageBlocks = imageBlocks && imageBlocks.length > 0;

    if (!hasMessage && !hasContextReferences && !hasImageBlocks) {
      logger.debug('Cannot send initial message without message, context references, or images');
      return;
    }

    if (!workspace) {
      logger.debug('Cannot send initial message without workspace');
      return;
    }

    logger.info('sendInitialMessage called', {
      agentId,
      hasMessage,
      messageLength: message?.length || 0,
      hasImageBlocks,
      hasContextReferences,
      contextReferenceCount: contextReferences?.length || 0,
    });

    const ready = await waitForSessionReady(5000);

    if (!ready) {
      logger.error('Failed to send initial message - session not ready before timeout');
      toast.error('Chat session timed out — please try again.');
      return;
    }

    // Build the actual message to send
    // If no message text but we have context references (not just images), create a prompt asking about the context
    // For image-only messages, use a minimal prompt that doesn't add unnecessary text to the conversation
    let actualMessage = message?.trim() || '';

    if (!actualMessage) {
      if (hasImageBlocks && !hasContextReferences) {
        // Image-only: minimal prompt that signals the agent should look at the image
        actualMessage = '[Image attached]';
      } else if (hasContextReferences) {
        // Context references without images: explain the linked context
        actualMessage =
          'I have linked some context above. Please review it and help me with this task.';
      }
    }

    // For initial messages, don't add workspace context string
    // The workspace was just created, so "Currently viewing: Spec" is misleading -
    // the user isn't actually viewing the spec, they're just starting a new workspace
    const messageWithContext = actualMessage;

    // If we have image blocks, convert them to context items
    const imageContextItems = imageBlocks?.map((block, index) => ({
      id: `initial-image-${index}`,
      type: 'file' as const,
      label: `Image ${index + 1}`,
      imageData: block.data,
      imageMimeType: block.mimeType,
    }));

    // Pass agentId to ensure message goes to the correct agent
    await chatService.sendMessage(messageWithContext, workspace, agentId, {
      contextItems: imageContextItems,
      contextReferences,
      agentId,
    });

    // Cleanup pending artifacts now that the initial message has been sent
    cleanupInitialAgentArtifacts();
    pendingInitialData = { prompt: null, contextReferences: null };
  }
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
        showSearch = true;
        tick().then(() => searchInputRef?.focus());
      }
    }

    // Suggested prompt shortcuts: Ctrl+1/2/3 (Mac) / Alt+1/2/3 (Win/Linux)
    // Mac uses Ctrl because ⌥+number produces special chars and ⌘+number is tab switching.
    // Win/Linux uses Alt because Ctrl+number is tab switching.
    // Only fires for the active (visible) tab. If multiple visible ChatPanels have suggestions,
    // both may fire — this is an acceptable edge case since it's extremely rare.
    if (isActive && suggestedPrompts.length > 0) {
      // On macOS, Alt+number produces special characters (e.g. Alt+7 → ¶), so e.key is NOT
      // the digit. Use e.code to get the physical key when a modifier is held.
      let num = parseInt(e.key, 10);
      if (isNaN(num) && e.code.startsWith('Digit')) {
        num = parseInt(e.code.slice(5), 10);
      }
      if (num >= 1 && num <= Math.min(visibleSuggestedPrompts.length, 3)) {
        const promptIndex = num - 1;
        const isMac = navigator.platform.toUpperCase().includes('MAC');
        const hasModifier = isMac
          ? e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey // Ctrl on Mac
          : e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey; // Alt on Win/Linux
        if (hasModifier) {
          e.preventDefault();
          const prompt = visibleSuggestedPrompts[promptIndex];
          handleSelectSuggestedPrompt(prompt);
        }
      }
    }
  }}
/>

<div bind:this={panelElement} class="group/panel flex flex-col h-full w-full min-w-0 relative z-20">
  <!-- Search Bar -->
  {#if showSearch}
    <div
      class="absolute top-2 right-4 z-50 flex items-center gap-2 bg-background border border-border rounded-lg shadow-lg px-3 py-2"
      transition:fade={{ duration: 150 }}
    >
      <Fa icon={faSearch} class="w-3.5 h-3.5 text-ghost" />
      <input
        bind:this={searchInputRef}
        bind:value={searchQuery}
        type="text"
        placeholder="Search messages..."
        class="w-48 text-sm bg-transparent border-0 focus:outline-none placeholder:text-muted-foreground/50"
        onkeydown={handleSearchKeydown}
        oninput={handleSearchInput}
      />
      {#if searchMatchCount > 0}
        <span class="text-xs text-subtle whitespace-nowrap">
          {currentSearchIndex + 1} / {searchMatchCount}
        </span>
        <button
          type="button"
          class="p-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          onclick={() => scrollToSearchMatch(currentSearchIndex - 1)}
          title="Previous match (Shift+Enter)"
        >
          <Fa icon={faChevronUp} class="w-3 h-3" />
        </button>
        <button
          type="button"
          class="p-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          onclick={() => scrollToSearchMatch(currentSearchIndex + 1)}
          title="Next match (Enter)"
        >
          <Fa icon={faChevronDown} class="w-3 h-3" />
        </button>
      {:else if searchQuery}
        <span class="text-xs text-subtle">No matches</span>
      {/if}
      <button
        type="button"
        class="p-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        onclick={() => {
          showSearch = false;
          searchQuery = '';
          triggerHighlight(); // Clear highlights
        }}
        title="Close (Esc)"
      >
        <Fa icon={faTimes} class="w-3.5 h-3.5" />
      </button>
    </div>
  {/if}

  <!-- Messages Area -->
  <div class="w-full relative flex-1 flex flex-col min-h-0 z-10">
    <div
      bind:this={scrollContainer}
      use:followBottom={{
        follow: shouldFollowBottom && !isScrollUnlocked && chatState.messages.length > 0,
        threshold: 100,
        onFollowChange: (f) => {
          shouldFollowBottom = f;
          // When user scrolls up, clear unlocked state
          if (!f) {
            isScrollUnlocked = false;
          }
        },
      }}
      class="flex-1 overflow-y-auto px-[5%]"
      class:agent-font-monospace={$isAgentMonospace}
    >
      <!-- Task Assignment Pill -->
      {#if agentTasks.length > 0}
        {@const task = agentTasks[0]}
        <a
          href={getTaskUrl(task)}
          class="flex items-center gap-1.5 px-2.5 py-1 mt-2 text-xs rounded-full border border-border bg-background hover:bg-muted transition-colors w-fit cursor-pointer no-underline mb-2"
          onclick={(e) => handleTaskPillClick(e, task)}
        >
          <Fa icon={faSquareCheck} class="text-ghost opacity-50" size="w-3 h-3" />
          <span class="text-subtle truncate max-w-[200px]">
            {task.taskText || 'Assigned task'}
          </span>
        </a>
      {/if}

      {#if !isInitialWorkspaceAgent && chatState.messages.length === 0 && !chatState.isStreaming && chatState?.session && !pendingInitialPrompt}
        <div class="mt-16"></div>
        <RegularAgentWelcome
          onSpecialistChange={handleSpecialistChange}
          session={chatState.session}
        />
      {:else if !chatState?.session && chatState.messages.length === 0 && !chatState.isStreaming && !pendingInitialPrompt}
        <!-- Skeleton loading state when session is not yet initialized -->
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
        <!-- FIX: Keep showing pendingMessage until a USER message arrives in chatState.messages -->
        <!-- This prevents the flash where pendingMessage disappears but only assistant streaming content has arrived -->
        {@const hasUserMessage = chatState.messages.some((m) => m.role === 'user')}
        {@const pendingCondition = pendingMessage && !hasUserMessage}
        {@const messagesCondition = hasUserMessage || chatState.messages.length > 0}
        {#if pendingCondition}
          <!-- Get any streaming assistant messages to render alongside the pending user message -->
          {@const streamingAssistantMessages = chatState.messages.filter(
            (m) => m.role === 'assistant',
          )}
          {#if initialPromptProp}
            <!-- No animation - parent already showed optimistic message, but we need to keep showing it -->
            <div class="w-full">
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
                  {@const isCurrentlyStreaming = isLastMessage && chatState.isStreaming}
                  <div class="message-nav-target">
                    <ChatMessage
                      {message}
                      {workspace}
                      isStreaming={isCurrentlyStreaming}
                      backendSessionId={auggieSessionId}
                    />
                  </div>
                  {#if (isCurrentlyStreaming && (chatState.isProcessing || chatState.isStreaming)) || (isLastMessage && (chatState.error || chatState.modelUnavailable))}
                    <div class="mb-16">
                      <StreamingStatus
                        isStreaming={chatState.isStreaming}
                        isProcessing={chatState.isProcessing}
                        lastChunkTime={chatState.lastChunkTime}
                        receivedFirstChunk={chatState.receivedFirstChunk}
                        streamingContentLength={chatState.streamingContent?.length ?? 0}
                        error={chatState.error}
                        isStalled={chatState.isStalled}
                        modelUnavailable={chatState.modelUnavailable}
                        {hasPendingPermission}
                        onRetry={handleRetry}
                        onRetryWithModel={handleRetryWithModel}
                        onStop={handleStop}
                        seed={agentId}
                        statusEvents={chatState.statusEvents}
                        streamingStartTime={chatState.streamingStartTime}
                      />
                    </div>
                  {/if}
                {/each}

                <!-- Show streaming status while waiting for first assistant message -->
                {#if streamingAssistantMessages.length === 0}
                  <div class="mb-4">
                    <StreamingStatus
                      isStreaming={chatState.isStreaming}
                      isProcessing={chatState.isProcessing}
                      lastChunkTime={chatState.lastChunkTime}
                      receivedFirstChunk={chatState.receivedFirstChunk}
                      streamingContentLength={chatState.streamingContent?.length ?? 0}
                      error={chatState.error}
                      isStalled={chatState.isStalled}
                      modelUnavailable={chatState.modelUnavailable}
                      {hasPendingPermission}
                      onRetry={handleRetry}
                      onRetryWithModel={handleRetryWithModel}
                      onStop={handleStop}
                      seed={agentId}
                      statusEvents={chatState.statusEvents}
                      streamingStartTime={chatState.streamingStartTime}
                    />
                  </div>
                {/if}
              </div>
            </div>
          {:else}
            <!-- With animation - normal case where parent didn't show optimistic message -->
            <!-- NOTE: Removed in:fly transition to debug duplicate flash issue -->
            <div class="w-full">
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
                  {@const isCurrentlyStreaming = isLastMessage && chatState.isStreaming}
                  <div class="message-nav-target">
                    <ChatMessage
                      {message}
                      {workspace}
                      isStreaming={isCurrentlyStreaming}
                      backendSessionId={auggieSessionId}
                    />
                  </div>
                  {#if (isCurrentlyStreaming && (chatState.isProcessing || chatState.isStreaming)) || (isLastMessage && (chatState.error || chatState.modelUnavailable))}
                    <div class="mb-16">
                      <StreamingStatus
                        isStreaming={chatState.isStreaming}
                        isProcessing={chatState.isProcessing}
                        lastChunkTime={chatState.lastChunkTime}
                        receivedFirstChunk={chatState.receivedFirstChunk}
                        streamingContentLength={chatState.streamingContent?.length ?? 0}
                        error={chatState.error}
                        isStalled={chatState.isStalled}
                        modelUnavailable={chatState.modelUnavailable}
                        {hasPendingPermission}
                        onRetry={handleRetry}
                        onRetryWithModel={handleRetryWithModel}
                        onStop={handleStop}
                        seed={agentId}
                        statusEvents={chatState.statusEvents}
                        streamingStartTime={chatState.streamingStartTime}
                      />
                    </div>
                  {/if}
                {/each}

                <!-- Show streaming status while waiting for first assistant message -->
                {#if streamingAssistantMessages.length === 0}
                  <div class="mb-4">
                    <StreamingStatus
                      isStreaming={chatState.isStreaming}
                      isProcessing={chatState.isProcessing}
                      lastChunkTime={chatState.lastChunkTime}
                      receivedFirstChunk={chatState.receivedFirstChunk}
                      streamingContentLength={chatState.streamingContent?.length ?? 0}
                      error={chatState.error}
                      isStalled={chatState.isStalled}
                      modelUnavailable={chatState.modelUnavailable}
                      {hasPendingPermission}
                      onRetry={handleRetry}
                      onRetryWithModel={handleRetryWithModel}
                      onStop={handleStop}
                      seed={agentId}
                      statusEvents={chatState.statusEvents}
                      streamingStartTime={chatState.streamingStartTime}
                    />
                  </div>
                {/if}
              </div>
            </div>
          {/if}
        {/if}

        <!-- Fallback: Show streaming/processing status when no messages and no pending message -->
        <!-- This covers the window where the backend starts processing before the user message echo arrives -->
        {#if !pendingCondition && !messagesCondition && (chatState.isProcessing || chatState.isStreaming || chatState.error || chatState.modelUnavailable)}
          <div class="w-full">
            <div class="mb-4">
              <StreamingStatus
                isStreaming={chatState.isStreaming}
                isProcessing={chatState.isProcessing}
                lastChunkTime={chatState.lastChunkTime}
                receivedFirstChunk={chatState.receivedFirstChunk}
                streamingContentLength={chatState.streamingContent?.length ?? 0}
                error={chatState.error}
                isStalled={chatState.isStalled}
                modelUnavailable={chatState.modelUnavailable}
                {hasPendingPermission}
                onRetry={handleRetry}
                onRetryWithModel={handleRetryWithModel}
                onStop={handleStop}
                seed={agentId}
                statusEvents={chatState.statusEvents}
                streamingStartTime={chatState.streamingStartTime}
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
                      (chatState.isStreaming && isLastTurnInConversation)}
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
                        {#if agentEventsForCards.length > 0}
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
                          data-message-index={globalIndex}
                          class="message-nav-target z-20 mb-9 bg-sidebar relative"
                        >
                          <ChatMessage
                            {message}
                            {workspace}
                            onEditSubmit={(newText, model) =>
                              handleEditMessage(message.id, newText, model)}
                            editModel={turn.assistantMessages[0]?.metadata?.model}
                            enableSticky={shouldEnableSticky}
                            onScrollToPrevious={() => scrollToPreviousUserMessage(message.id)}
                            backendSessionId={auggieSessionId}
                          />
                        </div>
                      {/if}

                      <!-- Show streaming status when processing but no assistant message yet, or when there's an error/modelUnavailable -->
                      {#if groupIndex === groupedMessages.length - 1 && turnIndex === turns.length - 1 && turn.assistantMessages.length === 0 && (chatState.isProcessing || chatState.error || chatState.modelUnavailable)}
                        <div class="mb-8">
                          <StreamingStatus
                            isStreaming={chatState.isStreaming}
                            isProcessing={chatState.isProcessing}
                            lastChunkTime={chatState.lastChunkTime}
                            receivedFirstChunk={chatState.receivedFirstChunk}
                            streamingContentLength={chatState.streamingContent?.length ?? 0}
                            error={chatState.error}
                            isStalled={chatState.isStalled}
                            modelUnavailable={chatState.modelUnavailable}
                            {hasPendingPermission}
                            onRetry={handleRetry}
                            onRetryWithModel={handleRetryWithModel}
                            onStop={handleStop}
                            seed={agentId}
                            statusEvents={chatState.statusEvents}
                            streamingStartTime={chatState.streamingStartTime}
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
                        {@const isCurrentlyStreaming = isLastMessage && chatState.isStreaming}
                        {@const turnNumber = getMessageTurnNumber(message.id)}
                        {@const globalIndex = getMessageIndex(message.id)}
                        <div
                          data-message-id={message.id}
                          data-message-index={globalIndex}
                          data-turn-number={turnNumber}
                          class="message-nav-target"
                        >
                          <ChatMessage
                            {message}
                            {workspace}
                            isStreaming={isCurrentlyStreaming}
                            onEditSubmit={(newText, model) =>
                              handleEditMessage(message.id, newText, model)}
                            onRegenerate={() => handleRegenerateFromMessage(message.id)}
                            onFork={() => handleForkFromMessage(message.id)}
                            backendSessionId={auggieSessionId}
                          />
                        </div>
                        <!-- Show streaming status while streaming or when there's an error/modelUnavailable -->
                        {#if (isCurrentlyStreaming && (chatState.isProcessing || chatState.isStreaming)) || (isLastMessage && (chatState.error || chatState.modelUnavailable))}
                          <div class="mb-16">
                            <StreamingStatus
                              isStreaming={chatState.isStreaming}
                              isProcessing={chatState.isProcessing}
                              lastChunkTime={chatState.lastChunkTime}
                              receivedFirstChunk={chatState.receivedFirstChunk}
                              streamingContentLength={chatState.streamingContent?.length ?? 0}
                              error={chatState.error}
                              isStalled={chatState.isStalled}
                              modelUnavailable={chatState.modelUnavailable}
                              {hasPendingPermission}
                              onRetry={handleRetry}
                              onRetryWithModel={handleRetryWithModel}
                              onStop={handleStop}
                              seed={agentId}
                              statusEvents={chatState.statusEvents}
                              streamingStartTime={chatState.streamingStartTime}
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
          </div>
        {/if}
      {/if}
      <!-- Aggregate File Changes Summary (show if more than one assistant message, updates during streaming) -->
      {#if chatState.messages.filter((m) => m.role === 'assistant').length > 1}
        <div class="w-full">
          <ChatFileChangesSummary
            messages={chatState.messages}
            suffix="in conversation"
            isAggregate={true}
            isStreaming={chatState.isStreaming}
            {agentId}
          />
        </div>
      {/if}

      <!-- Show suggested prompts for the last message only, when not streaming -->
      {#if visibleSuggestedPrompts.length > 0}
        <div class="w-full pt-8 pb-12">
          <SuggestedPrompts
            prompts={visibleSuggestedPrompts}
            onSelect={handleSelectSuggestedPrompt}
            onEdit={handleEditSuggestedPrompt}
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
    {#if chatState.messages.length > 0}
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
          ? 'Auto-scroll locked (click to unlock)'
          : showUnlock
            ? 'Auto-scroll unlocked (click to lock)'
            : 'Scroll to bottom'}
      >
        <Fa icon={showArrow ? faArrowDown : showLock ? faLock : faLockOpen} class="w-3! h-3!" />
      </Button>
    {/if}
  </div>

  <!-- Queued Messages -->
  {#if queuedMessages.length > 0}
    <QueuedMessageList
      bind:this={queuedMessageListRef}
      messages={queuedMessages}
      onedit={handleEditQueuedMessage}
      onremove={handleRemoveQueuedMessage}
      onsendnow={handleSendQueuedMessageNow}
      ondone={() => inputComponent?.focus?.()}
    />
  {/if}

  <!-- Message Input with Aurora Background -->
  <div class="relative w-full px-2 z-0" class:input-flash={showInputFlash}>
    <!-- Aurora northern lights effect during streaming -->
    {#if chatState.isStreaming}
      <div
        class="absolute -inset-x-2 -bottom-2 pointer-events-none z-0 overflow-hidden"
        transition:fade
        style="height: calc(100% + 10rem);"
      >
        <AuroraBackground {agentId} />
      </div>
    {/if}

    <SimpleRichInput
      bind:this={inputComponent}
      bind:contextItems
      bind:value={inputValue}
      onsubmit={handleSend}
      onforcesubmit={handleForceSubmit}
      onstop={handleStop}
      onHistoryPrev={handleHistoryPrev}
      onHistoryNext={handleHistoryNext}
      disabled={!workspace || !chatState.session}
      isStreaming={chatState.isStreaming}
      {workspace}
      currentContext={currentMainPanelContext}
      {agentId}
      selectedModel={hydratedInputModel ?? agentModel}
      compactMode={isCompactMode}
      isProviderChangeLocked={!canChangeProvider}
      providerId={inputProviderId}
    />
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
