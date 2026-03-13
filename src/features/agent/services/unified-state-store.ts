/**
 * Unified State Store - Extended Version
 *
 * Single source of truth for ALL application state.
 * Consolidates:
 * - Agent state (sessions, messages, streaming)
 * - Workspace state (current workspace, panels, drawer)
 * - Context state (selections, items)
 * - Model state (selected model, available models)
 * - UI state (sidebar, theme, etc.)
 *
 * Uses Svelte 5 runes for reactive state management.
 *
 * Key principles:
 * - Single store for all state
 * - Reactive updates with $state
 * - Derived values with $derived
 * - No duplicate state
 * - Automatic persistence
 * - Backward compatibility through adapters
 */

import { v4 as uuidv4 } from 'uuid';
import { Logger } from '$shared/logger';
import type { AgentId, WorkspaceId, MessageId } from '$shared/types/branded-ids';
import type {
  Workspace,
  AgentSession,
  ContentBlock,
  AgentMessage,
  QueuedMessage,
} from '$shared/types';
import { AgentStatus } from '$shared/types';
import type { AuggieModel } from '$features/auggie/auggie-models.client';
import { MODEL_IDS, MODEL_DEFAULTS } from '$shared/constants/agent-services';

const logger = new Logger('UnifiedStateStore');

/**
 * Agent state change types for event-driven updates.
 * Used to notify subscribers about specific changes to agent state,
 * enabling efficient event-driven updates instead of polling.
 *
 * @remarks
 * - `message_added`: A new message was added to the agent's conversation
 * - `status_changed`: The agent's status changed (idle, processing, etc.)
 * - `streaming_started`: The agent started streaming a response
 * - `streaming_stopped`: The agent stopped streaming a response
 * - `session_updated`: The agent session was updated (existing agent)
 * - `agent_created`: A new agent was created in the workspace
 * - `agent_removed`: An agent was removed from the workspace
 */
export type AgentStateChangeType =
  | 'message_added'
  | 'status_changed'
  | 'streaming_started'
  | 'streaming_stopped'
  | 'session_updated'
  | 'agent_created'
  | 'agent_removed';

// Context item type
export interface ContextItem {
  id: string;
  type: 'selection' | 'file' | 'note' | 'memory' | 'rule' | string;
  label?: string;
  content?: string;
  path?: string;
  description?: string;
  metadata?: Record<string, any>;
}

// Extended agent state with streaming and UI
export interface AgentState {
  session: AgentSession;
  messages: AgentMessage[];
  /** Set of message IDs for O(1) duplicate checking - performance optimization */
  messageIdSet: Set<string>;
  streaming: {
    active: boolean;
    buffer: string; // Keep for backward compatibility
    contentBlocks: ContentBlock[]; // Keep for backward compatibility
    orderedContentBlocks: ContentBlock[]; // New: preserves order of all content blocks
    messageId?: string; // ID of the temporary streaming message
  };
  ui: {
    isExpanded: boolean;
    scrollPosition: number;
    searchQuery: string;
    selectedMessageId?: string;
    isAtTop: boolean;
    isAtBottom: boolean;
    showScrollToBottom: boolean;
  };
  errors: Error[];
  metadata: {
    source?: string;
    isInitialAgent?: boolean;
    specialist?: string;
    contextReferences?: any[];
    recovered?: boolean;
    recoveredAt?: string;
  };
  queuedMessages: QueuedMessage[];
  lastActivity: number;
  lastModified?: number;
}

// Task-agent association
export interface TaskAgentAssociation {
  taskId: string; // Unique identifier for the task (e.g., noteId:position)
  agentId: string;
  noteId: string;
  taskPosition: number;
  taskText: string;
  createdAt: number;
}

// Extended workspace state with UI panels
export interface WorkspaceState {
  workspace: Workspace;
  agents: Map<string, AgentState>;
  activeAgentId: AgentId | null;
  isLoading: boolean;
  mainPanel: {
    type: string;
    selectedFile?: string;
    selectedNoteId?: string;
    selectedChangeId?: string;
  };
  drawer: {
    open: boolean;
    type: 'agent' | 'terminal' | 'overview' | null;
    itemId: string | null;
  };
  navigation: {
    history: Array<{
      type: string;
      id: string;
      label: string;
      timestamp: number;
    }>;
    currentIndex: number;
  };
  // Task-agent associations for this workspace
  taskAgentAssociations: Map<string, TaskAgentAssociation>;
  // Flag to indicate the initial spec-writer agent is actively writing the spec
  // This is used to lock the spec document during initial spec generation
  isInitialSpecWriteInProgress: boolean;
}

// Context state
export interface ContextState {
  items: ContextItem[];
  currentSelection: {
    text: string;
    file?: string;
    language?: string;
    range?: any;
  } | null;
  workspaceId: string | null;
}

// Model state
export interface ModelState {
  selectedModel: string;
  availableModels: AuggieModel[];
  isLoadingModels: boolean;
  modelsLoaded: boolean;
}

// UI state
export interface UIState {
  sidebarOpen: boolean;
  theme: 'dark' | 'light';
  fontSize: 'small' | 'medium' | 'large';
}

/**
 * Unified State Store - Single source of truth for ALL application state.
 * Consolidates agent, workspace, context, model, and UI state management.
 * Uses Svelte 5 runes for reactive state management when in .svelte.ts context.
 *
 * @class UnifiedStateStore
 * @example
 * ```typescript
 * const store = UnifiedStateStore.getInstance();
 *
 * // Get current workspace
 * const workspace = store.getCurrentWorkspace();
 *
 * // Update agent state
 * store.updateAgentState(agentId, { streaming: { active: true } });
 *
 * // Add context item
 * store.addContextItem({ type: 'file', path: '/src/app.ts' });
 * ```
 */
class UnifiedStateStore {
  /** @property {UnifiedStateStore} instance - Singleton instance */
  private static instance: UnifiedStateStore;

  // Core state - using regular properties for now
  // Note: Could be converted to Svelte 5 runes when moved to .svelte.ts file
  /** @property {Map<string, WorkspaceState>} workspaces - Map of workspace ID to workspace state */
  private workspaces: Map<string, WorkspaceState> = new Map();
  /** @property {WorkspaceId | null} currentWorkspaceId - ID of the currently active workspace */
  private currentWorkspaceId: WorkspaceId | null = null;

  // Context state
  /** @property {ContextState} contextState - Current context state including items and selection */
  private contextState: ContextState = {
    items: [],
    currentSelection: null,
    workspaceId: null,
  };

  // Model state
  /** @property {ModelState} modelState - Current model selection and availability state */
  private modelState: ModelState = {
    selectedModel: MODEL_DEFAULTS.UI_INITIAL_MODEL,
    availableModels: [],
    isLoadingModels: false,
    modelsLoaded: false,
  };

  // UI state
  /** @property {UIState} uiState - Current UI state including sidebar, theme, and font size */
  private uiState: UIState = {
    sidebarOpen: true,
    theme: 'dark',
    fontSize: 'medium',
  };

  // Performance metrics
  /** @property {Object} performanceMetrics - Performance tracking metrics */
  private performanceMetrics = {
    operationCount: 0,
    averageOperationTime: 0,
    memoryUsage: 0,
    lastGC: Date.now(),
  };

  // Streaming state change listeners
  private streamingListeners: Set<(agentId: AgentId, isStreaming: boolean) => void> = new Set();

  // Agent state change listeners (for status, messages, etc.)
  private agentStateListeners: Set<
    (workspaceId: WorkspaceId, agentId: AgentId, changeType: AgentStateChangeType) => void
  > = new Set();

  // Initial spec write state listeners
  // These are notified when the initial spec-writer agent starts/stops writing the spec
  private initialSpecWriteListeners: Set<(workspaceId: WorkspaceId, isWriting: boolean) => void> =
    new Set();

  // Derived values - Workspace
  /**
   * Gets the current workspace state.
   * @returns {WorkspaceState | null} Current workspace or null if none selected
   */
  get currentWorkspace(): WorkspaceState | null {
    return this.currentWorkspaceId ? this.workspaces.get(this.currentWorkspaceId) || null : null;
  }

  /**
   * Gets the current workspace state (method version for backward compatibility).
   * @returns {WorkspaceState | null} Current workspace or null if none selected
   */
  getCurrentWorkspace(): WorkspaceState | null {
    return this.currentWorkspace;
  }

  /**
   * Gets the currently active agent state.
   * @returns {AgentState | null} Current agent or null if none active
   */
  get currentAgent(): AgentState | null {
    const workspace = this.currentWorkspace;
    if (!workspace?.activeAgentId) return null;
    return workspace.agents.get(workspace.activeAgentId) || null;
  }

  /**
   * Gets all agent sessions across all workspaces.
   * @returns {AgentSession[]} Array of all agent sessions
   */
  get allAgents(): AgentSession[] {
    const agents: AgentSession[] = [];
    this.workspaces.forEach((workspace) => {
      workspace.agents.forEach((agentState) => {
        agents.push(agentState.session);
      });
    });
    return agents;
  }

  // Derived values - Context
  get contextItems(): ContextItem[] {
    return this.contextState.items;
  }

  get currentSelection() {
    return this.contextState.currentSelection;
  }

  // Add selectionContext as an alias for currentSelection for backward compatibility
  get selectionContext() {
    return this.contextState.currentSelection;
  }

  set selectionContext(selection: any) {
    this.setSelection(selection);
  }

  get hasSelection(): boolean {
    return !!this.contextState.currentSelection?.text?.trim();
  }

  get hasMemories(): boolean {
    return this.contextState.items.some((item) => item.type === 'memory');
  }

  get hasRules(): boolean {
    return this.contextState.items.some((item) => item.type === 'rule');
  }

  // Derived values - Model
  get selectedModel(): string {
    return this.modelState.selectedModel;
  }

  // Add setter for selectedModel for backward compatibility
  set selectedModel(model: string) {
    this.selectModel(model);
  }

  get availableModels(): AuggieModel[] {
    return this.modelState.availableModels;
  }

  get isLoadingModels(): boolean {
    return this.modelState.isLoadingModels;
  }

  // Derived values - UI
  get sidebarOpen(): boolean {
    return this.uiState.sidebarOpen;
  }

  get theme(): UIState['theme'] {
    return this.uiState.theme;
  }

  /**
   * Private constructor for singleton pattern.
   * Initializes state and sets up persistence.
   *
   * @private
   */
  private constructor() {
    logger.info('UnifiedStateStore initialized');

    // Load persisted state from localStorage
    this.loadPersistedState();

    // Set up auto-persistence
    this.setupAutoPersistence();
  }

  /**
   * Gets the singleton instance of UnifiedStateStore.
   *
   * @static
   * @returns {UnifiedStateStore} The singleton instance
   * @example
   * ```typescript
   * const store = UnifiedStateStore.getInstance();
   * ```
   */
  static getInstance(): UnifiedStateStore {
    if (!UnifiedStateStore.instance) {
      UnifiedStateStore.instance = new UnifiedStateStore();
    }
    return UnifiedStateStore.instance;
  }

  // Persistence methods
  /**
   * Loads persisted state from localStorage.
   * Restores model selection and UI preferences.
   *
   * @private
   * @returns {void}
   */
  private loadPersistedState(): void {
    // Skip localStorage access in Node.js environment
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
      logger.debug('Skipping localStorage load - not in browser environment');
      return;
    }

    try {
      // Load model selection
      const savedModel = localStorage.getItem('workspaces-selected-model');
      if (savedModel) {
        this.modelState.selectedModel = savedModel;
      }

      // Load UI preferences
      const savedUI = localStorage.getItem('workspaces-ui-state');
      if (savedUI) {
        try {
          const uiData = JSON.parse(savedUI);
          Object.assign(this.uiState, uiData);
        } catch (parseError) {
          logger.warn('Failed to parse saved UI state', parseError);
          localStorage.removeItem('workspaces-ui-state');
        }
      }

      logger.debug('Loaded persisted state');
    } catch (error) {
      logger.error('Failed to load persisted state', error as Error);
    }
  }

  private setupAutoPersistence(): void {
    // For now, we'll save on each change manually
    // Note: Could use $effect when converted to .svelte.ts
    logger.debug('Auto-persistence setup (manual mode)');
  }

  // Workspace operations
  /**
   * Sets up a new workspace state.
   *
   * @public
   * @param {Workspace} workspace - The workspace to set up
   * @returns {void}
   * @example
   * ```typescript
   * store.setWorkspace({ id: 'workspace-123', name: 'My Workspace', path: '/path' });
   * ```
   */
  setWorkspace(workspace: Workspace): void {
    // Check if workspace already exists - if so, preserve agents and other state
    const existing = this.workspaces.get(workspace.id);
    if (existing) {
      // Update the workspace object but preserve agents and other state
      existing.workspace = workspace;
      logger.debug('Workspace updated (preserving existing agents)', {
        id: workspace.id,
        agentCount: existing.agents.size,
        agentIds: Array.from(existing.agents.keys()),
      });
      return;
    }

    // Log all existing workspaces for debugging
    logger.debug('Creating new workspace state', {
      newWorkspaceId: workspace.id,
      existingWorkspaceIds: Array.from(this.workspaces.keys()),
      existingWorkspaceCount: this.workspaces.size,
    });

    // Create new workspace state
    const state: WorkspaceState = {
      workspace,
      agents: new Map(),
      activeAgentId: null,
      isLoading: false,
      mainPanel: {
        type: 'welcome',
      },
      drawer: {
        open: false,
        type: null,
        itemId: null,
      },
      navigation: {
        history: [],
        currentIndex: -1,
      },
      taskAgentAssociations: new Map(),
      isInitialSpecWriteInProgress: false,
    };
    this.workspaces.set(workspace.id, state);
    logger.debug('Workspace set (new)', { id: workspace.id });
  }

  /**
   * Sets the current active workspace.
   *
   * @public
   * @param {WorkspaceId} workspaceId - The ID of the workspace to make active
   * @returns {void}
   */
  setCurrentWorkspace(workspaceId: WorkspaceId): void {
    this.currentWorkspaceId = workspaceId;
    this.contextState.workspaceId = workspaceId;
    logger.debug('Current workspace set', { workspaceId });
  }

  /**
   * Gets a workspace by ID.
   *
   * @public
   * @param {WorkspaceId} workspaceId - The ID of the workspace to get
   * @returns {WorkspaceState | undefined} The workspace state if found
   */
  getWorkspace(workspaceId: WorkspaceId): WorkspaceState | undefined {
    return this.workspaces.get(workspaceId);
  }

  /**
   * Gets all workspaces.
   *
   * @public
   * @returns {WorkspaceState[]} Array of all workspace states
   */
  getAllWorkspaces(): WorkspaceState[] {
    return Array.from(this.workspaces.values());
  }

  /**
   * Gets all agent sessions for a specific workspace.
   * Unlike currentWorkspace.agents, this doesn't rely on currentWorkspaceId being set.
   *
   * @public
   * @param {WorkspaceId} workspaceId - The workspace ID to get agents for
   * @returns {AgentSession[]} Array of agent sessions for the workspace
   */
  getAgentsForWorkspace(workspaceId: WorkspaceId): AgentSession[] {
    const workspace = this.workspaces.get(workspaceId);

    // Debug: Log workspace lookup
    logger.debug('[getAgentsForWorkspace] Looking up workspace', {
      requestedId: workspaceId,
      found: !!workspace,
      allWorkspaceIds: Array.from(this.workspaces.keys()),
      currentWorkspaceId: this.currentWorkspaceId,
    });

    if (!workspace) return [];
    const sessions: AgentSession[] = [];
    const skippedAgents: string[] = [];
    workspace.agents.forEach((agent, agentId) => {
      if (agent.session) {
        // Merge the messages from AgentState with the session
        // Use agent.streaming.active as authoritative source for isStreaming.
        // This prevents stale isStreaming state from blocking message sends.
        const isStreaming = agent.streaming?.active ?? agent.session.isStreaming ?? false;
        const sessionWithMessages = {
          ...agent.session,
          isStreaming,
          messages: agent.messages || agent.session.messages || [],
        };
        sessions.push(sessionWithMessages);
      } else {
        // Track agents that were skipped due to missing session
        skippedAgents.push(agentId);
      }
    });

    logger.debug('[getAgentsForWorkspace] Found agents', {
      workspaceId,
      totalAgentsInMap: workspace.agents.size,
      agentCount: sessions.length,
      agentIds: sessions.map((s) => s.id),
      skippedAgentCount: skippedAgents.length,
      skippedAgentIds: skippedAgents,
    });

    return sessions;
  }

  /**
   * Gets all agent sessions from all workspaces.
   * Used by sessionStoreData to provide a complete list of agents for filtering.
   *
   * @public
   * @returns {AgentSession[]} Array of all agent sessions across all workspaces
   */
  getAllAgents(): AgentSession[] {
    const allSessions: AgentSession[] = [];
    this.workspaces.forEach((workspace, workspaceId) => {
      workspace.agents.forEach((agent) => {
        if (agent.session) {
          // Merge the messages from AgentState with the session
          // Use agent.streaming.active as authoritative source for isStreaming.
          const isStreaming = agent.streaming?.active ?? agent.session.isStreaming ?? false;
          const sessionWithMessages = {
            ...agent.session,
            isStreaming,
            messages: agent.messages || agent.session.messages || [],
          };
          allSessions.push(sessionWithMessages);
        }
      });
    });

    logger.debug('[getAllAgents] Collected agents from all workspaces', {
      totalAgents: allSessions.length,
      workspaceCount: this.workspaces.size,
      agentsByWorkspace: Array.from(this.workspaces.entries()).map(([id, ws]) => ({
        workspaceId: id,
        agentCount: ws.agents.size,
      })),
    });

    return allSessions;
  }

  // Agent operations
  /**
   * Sets or updates an agent in a workspace.
   *
   * @public
   * @param {WorkspaceId} workspaceId - The workspace ID
   * @param {any} agentOrSession - The agent or session data to set
   * @returns {void}
   */
  setAgent(workspaceId: WorkspaceId, agentOrSession: any): void {
    let workspace = this.workspaces.get(workspaceId);
    if (!workspace) {
      // Create a minimal workspace state if it doesn't exist
      // This can happen during initialization or when agents are created before workspace is fully set up
      logger.warn('Workspace not found, creating minimal state', { workspaceId });

      const minimalWorkspace: WorkspaceState = {
        workspace: {
          id: workspaceId,
          name: 'Workspace',
          path: '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        } as Workspace,
        agents: new Map(),
        activeAgentId: null,
        isLoading: false,
        mainPanel: {
          type: 'welcome',
        },
        drawer: {
          open: false,
          type: null,
          itemId: null,
        },
        navigation: {
          history: [],
          currentIndex: -1,
        },
        taskAgentAssociations: new Map(),
        isInitialSpecWriteInProgress: false,
      };

      this.workspaces.set(workspaceId, minimalWorkspace);
      workspace = minimalWorkspace;
    }

    // Handle both Agent and AgentSession types
    // First check if agentOrSession is an object (not a string or null)
    const session =
      typeof agentOrSession === 'object' && agentOrSession !== null && 'status' in agentOrSession
        ? {
            ...agentOrSession,
            // CRITICAL: Always ensure workspaceId matches the target workspace
            workspaceId,
          }
        : ({
            id: agentOrSession.id,
            workspaceId,
            status: AgentStatus.Idle,
            messages: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            backendSessionId: agentOrSession.id, // Use same ID for backend
            name: 'Agent',
          } as AgentSession);

    // Check if agent already exists to preserve streaming state
    const existingAgent = workspace.agents.get(session.id);

    // Build message ID set for O(1) duplicate checking
    // IMPORTANT: Create a COPY of the messages array to avoid shared references
    // between agentState.messages and agentState.session.messages.
    // If they share the same array reference, addMessage() will duplicate entries.
    // FIX: Check for array length, not just truthiness, because empty arrays are truthy
    // and would overwrite existing messages when session.messages is []
    // FIX: When agent is actively streaming, preserve existing messages ONLY if they have
    // more or equal messages than the session. If session has MORE messages, it means
    // a new message was added (e.g., streaming assistant message) and we should use it.
    const isActivelyStreaming = existingAgent?.streaming?.active === true;
    const existingMessageCount = existingAgent?.messages?.length || 0;
    const sessionMessageCount = session.messages?.length || 0;

    // Only preserve existing messages if streaming AND existing has more or equal content.
    // FIX: Compare both message count AND content block count in the last message.
    // This prevents losing new content blocks (like tool calls) when they're added to an
    // existing message without changing the message count.
    const existingLastMsg = existingAgent?.messages?.[existingAgent.messages.length - 1];
    const sessionLastMsg = session.messages?.[session.messages.length - 1];
    const existingLastMsgBlockCount = existingLastMsg?.contentBlocks?.length || 0;
    const sessionLastMsgBlockCount = sessionLastMsg?.contentBlocks?.length || 0;

    // Preserve existing messages ONLY if:
    // 1. Streaming is active
    // 2. Existing has messages
    // 3. Existing has more messages OR (same message count AND more/equal content blocks)
    // If session has more content blocks in the last message, use session.messages
    const preserveStreamingMessages =
      isActivelyStreaming &&
      existingMessageCount > 0 &&
      existingMessageCount >= sessionMessageCount &&
      // FIX: Also check content blocks - if session has MORE blocks, don't preserve stale data
      (existingMessageCount > sessionMessageCount ||
        existingLastMsgBlockCount >= sessionLastMsgBlockCount);

    let sourceMessages: AgentMessage[];
    if (preserveStreamingMessages) {
      // CRITICAL FIX: When preserving streaming messages, MERGE unique messages
      // from session.messages into the existing messages. This prevents losing
      // user messages or earlier responses that exist in disk data but not in
      // the existing streaming state. Without this, switching workspaces during
      // streaming drops the user prompt because the existing store only has the
      // streaming assistant message, and the disk data (with the user message)
      // is ignored entirely.
      const existingIds = new Set(existingAgent.messages.map((m: AgentMessage) => m.id));
      const missingMessages = (session.messages || []).filter(
        (m: AgentMessage) => !existingIds.has(m.id),
      );
      if (missingMessages.length > 0) {
        logger.info('[setAgent] Merging missing messages during active streaming', {
          agentId: session.id,
          existingCount: existingAgent.messages.length,
          sessionCount: session.messages?.length || 0,
          missingCount: missingMessages.length,
          missingIds: missingMessages.map((m: AgentMessage) => m.id),
        });
        // Prepend missing messages (typically user messages that come before the streaming response)
        // Sort by timestamp to maintain correct order
        sourceMessages = [...missingMessages, ...existingAgent.messages].sort((a, b) => {
          const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
          const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
          return timeA - timeB;
        });
      } else {
        sourceMessages = existingAgent.messages;
      }
    } else {
      sourceMessages = session.messages && session.messages.length > 0
        ? session.messages
        : existingAgent?.messages || [];
    }

    // CRITICAL FIX: Deduplicate messages to prevent duplicate message IDs in the state.
    // Persisted session data may contain duplicates due to race conditions during saving.
    // Without this deduplication, ChatPanel will log "DUPLICATE MESSAGE IDS DETECTED!" warnings.
    const seenIds = new Set<string>();
    const deduplicatedMessages: AgentMessage[] = [];
    for (const msg of sourceMessages) {
      if (!seenIds.has(msg.id)) {
        seenIds.add(msg.id);
        deduplicatedMessages.push(msg);
      } else {
        logger.debug('[setAgent] Filtering duplicate message', {
          agentId: session.id,
          messageId: msg.id,
        });
      }
    }
    const messages: AgentMessage[] = deduplicatedMessages;

    if (isActivelyStreaming) {
      logger.debug('[setAgent] Streaming message decision', {
        agentId: session.id,
        isActivelyStreaming,
        existingMessageCount,
        sessionMessageCount,
        existingLastMsgBlockCount,
        sessionLastMsgBlockCount,
        preserveStreamingMessages,
        usingSource: preserveStreamingMessages ? 'existing' : 'session',
      });
    }
    // Rebuild messageIdSet from the final deduplicated messages to stay in sync.
    // Previously this reused existingAgent.messageIdSet when preserveStreamingMessages was true,
    // but since we now merge missing messages, we always need a fresh set.
    const messageIdSet = new Set<string>(messages.map((m: AgentMessage) => m.id));

    // For the session, also ensure messages is a separate array
    // Use deduplicatedMessages (not sourceMessages) to prevent duplicates in session.messages
    const sessionMessages: AgentMessage[] = [...deduplicatedMessages];

    const agentState: AgentState = {
      // Merge session data, preserving existing data when new data is not provided
      session: existingAgent
        ? {
            ...existingAgent.session,
            ...session,
            // Preserve specific fields that shouldn't be overwritten
            // Use a copy to avoid shared reference with agentState.messages
            messages: sessionMessages,
            status: session.status || existingAgent.session.status,
          }
        : {
            ...session,
            // Create a copy for new sessions to avoid shared reference
            messages: sessionMessages,
            // The stored session copy always has isStreaming: false.
            // Actual streaming state is tracked separately in streaming.active below,
            // which reads the ORIGINAL session.isStreaming from the caller.
            // getSession() in browser/index.ts uses streaming.active as authoritative.
            isStreaming: false,
          },
      // Preserve existing messages if they exist and session doesn't have messages
      // This is important when updating the session without messages (e.g., during streaming)
      messages,
      // Set of message IDs for O(1) duplicate checking
      messageIdSet,
      // Preserve existing streaming state if agent exists, otherwise initialize
      streaming: existingAgent
        ? {
            ...existingAgent.streaming,
            // Only update specific streaming fields if provided
            // CRITICAL FIX: Don't turn off streaming based on stale session data.
            // When resumeSession() loads from disk, session.isStreaming is set to false
            // because disk data doesn't have streaming messages. But the ChatService
            // singleton may be actively streaming. Only setStreaming() should turn off
            // streaming — not stale disk data flowing through setAgent().
            active:
              session.isStreaming === true
                ? true
                : session.isStreaming === false && !existingAgent.streaming.active
                  ? false
                  : existingAgent.streaming.active,
            buffer: existingAgent.streaming.buffer || '',
            contentBlocks: existingAgent.streaming.contentBlocks || [],
            orderedContentBlocks: existingAgent.streaming.orderedContentBlocks || [],
          }
        : {
            // For NEW agents, streaming.active reads the ORIGINAL session.isStreaming
            // (from the caller, before the session copy override above).
            // - Agents loaded from persistence: isStreaming is false → streaming.active = false
            // - Backend-initiated agents (delegation, wake): isStreaming is true → streaming.active = true
            // - User-created agents: isStreaming is false → streaming.active = false
            // Note: session.isStreaming here refers to the local `session` variable (line ~664),
            // NOT the stored copy (which is always false for new agents).
            active: session.isStreaming === true,
            buffer: '',
            contentBlocks: [],
            orderedContentBlocks: [],
          },
      // Preserve existing UI state if agent exists, otherwise initialize
      ui: existingAgent?.ui || {
        isExpanded: false,
        scrollPosition: 0,
        searchQuery: '',
        isAtTop: true,
        isAtBottom: true,
        showScrollToBottom: false,
      },
      errors: existingAgent?.errors || [],
      metadata: existingAgent
        ? {
            ...existingAgent.metadata,
            ...(session.metadata || {}),
          }
        : session.metadata || {},
      queuedMessages: existingAgent?.queuedMessages || [],
      lastActivity: Date.now(),
      lastModified: Date.now(),
    };

    workspace.agents.set(session.id, agentState);
    logger.debug('[setAgent] Agent set', {
      workspaceId,
      agentId: session.id,
      preservedStreaming: !!existingAgent?.streaming,
      preservedUI: !!existingAgent?.ui,
      totalAgentsInWorkspace: workspace.agents.size,
      sessionWorkspaceId: session.workspaceId,
      streamingActive: agentState.streaming.active,
      sessionIsStreaming: session.isStreaming,
      isNewAgent: !existingAgent,
    });

    // Notify listeners of agent state change
    const changeType: AgentStateChangeType = existingAgent ? 'session_updated' : 'agent_created';
    this.notifyAgentStateChange(workspaceId, session.id, changeType);
  }

  setActiveAgent(workspaceId: WorkspaceId, agentId: AgentId): void {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) return;

    workspace.activeAgentId = agentId;
    logger.debug('Active agent set', { workspaceId, agentId });
  }

  // Message operations
  // Maximum messages per agent to prevent memory bloat
  private readonly MAX_MESSAGES_PER_AGENT = 500;

  addMessage(workspaceId: WorkspaceId, agentId: AgentId, message: AgentMessage): void {
    const workspace = this.workspaces.get(workspaceId);
    const agentState = workspace?.agents.get(agentId);
    if (!agentState) return;

    // O(1) duplicate check using Set instead of O(n) find()
    if (!agentState.messageIdSet.has(message.id)) {
      agentState.messages.push(message);
      agentState.messageIdSet.add(message.id);

      // Prune old messages if over limit
      if (agentState.messages.length > this.MAX_MESSAGES_PER_AGENT) {
        const pruneCount = agentState.messages.length - this.MAX_MESSAGES_PER_AGENT;
        // Remove IDs from set for pruned messages
        for (let i = 0; i < pruneCount; i++) {
          agentState.messageIdSet.delete(agentState.messages[i].id);
        }
        agentState.messages.splice(0, pruneCount);
        logger.debug('Pruned old messages', { workspaceId, agentId, pruneCount });
      }

      // Keep session.messages in sync - only add if message was new (we're inside the if block)
      if (agentState.session) {
        agentState.session.messages.push(message);

        // Prune session messages too
        if (agentState.session.messages.length > this.MAX_MESSAGES_PER_AGENT) {
          const pruneCount = agentState.session.messages.length - this.MAX_MESSAGES_PER_AGENT;
          agentState.session.messages.splice(0, pruneCount);
        }
      }
    }

    agentState.lastActivity = Date.now();
    agentState.lastModified = Date.now();
    logger.debug('Message added', { workspaceId, agentId, messageId: message.id });

    // Notify listeners of message added (only if message was new)
    if (agentState.messageIdSet.has(message.id)) {
      this.notifyAgentStateChange(workspaceId, agentId, 'message_added');
    }
  }

  // Streaming operations
  setStreaming(workspaceId: WorkspaceId, agentId: AgentId, isStreaming: boolean): void {
    const workspace = this.workspaces.get(workspaceId);
    const agentState = workspace?.agents.get(agentId);
    if (!agentState) return;

    agentState.streaming.active = isStreaming;
    // Also update the session's isStreaming property if it exists
    if (agentState.session) {
      agentState.session.isStreaming = isStreaming;
    }
    if (!isStreaming) {
      agentState.streaming.buffer = '';
      agentState.streaming.contentBlocks = [];
      agentState.streaming.orderedContentBlocks = [];
    }
    logger.debug('Streaming state updated', { workspaceId, agentId, isStreaming });

    // Check if this is the initial spec-writer agent starting/stopping
    // The flag is set when:
    // 1. Agent has isInitialAgent metadata flag (set when workspace is created with a prompt)
    // 2. Agent has specialist: 'spec-writer' in metadata or config
    const isInitialSpecWriter =
      agentState.metadata?.isInitialAgent === true &&
      (agentState.metadata?.specialist === 'spec-writer' ||
        agentState.session?.metadata?.specialist === 'spec-writer');

    if (isInitialSpecWriter) {
      if (isStreaming) {
        // Starting to stream - set the flag
        this.setInitialSpecWriteInProgress(workspaceId, true);
      } else {
        // Stopped streaming - clear the flag
        this.setInitialSpecWriteInProgress(workspaceId, false);
      }
    }

    // Notify streaming listeners
    this.streamingListeners.forEach((listener) => {
      try {
        listener(agentId, isStreaming);
      } catch (e) {
        logger.error('Error in streaming listener', e as Error, { agentId, isStreaming });
      }
    });

    // Notify agent state listeners
    this.notifyAgentStateChange(
      workspaceId,
      agentId,
      isStreaming ? 'streaming_started' : 'streaming_stopped',
    );
  }

  /**
   * Subscribe to streaming state changes.
   * @returns Unsubscribe function
   */
  onStreamingChange(listener: (agentId: AgentId, isStreaming: boolean) => void): () => void {
    this.streamingListeners.add(listener);
    return () => {
      this.streamingListeners.delete(listener);
    };
  }

  /**
   * Subscribe to agent state changes (status, messages, etc.).
   * This enables event-driven updates instead of polling.
   * @returns Unsubscribe function
   */
  onAgentStateChange(
    listener: (
      workspaceId: WorkspaceId,
      agentId: AgentId,
      changeType: AgentStateChangeType,
    ) => void,
  ): () => void {
    this.agentStateListeners.add(listener);
    return () => {
      this.agentStateListeners.delete(listener);
    };
  }

  /**
   * Notify all agent state listeners of a change.
   * @private
   */
  private notifyAgentStateChange(
    workspaceId: WorkspaceId,
    agentId: AgentId,
    changeType: AgentStateChangeType,
  ): void {
    this.agentStateListeners.forEach((listener) => {
      try {
        listener(workspaceId, agentId, changeType);
      } catch (e) {
        logger.error('Error in agent state listener', e as Error, {
          workspaceId,
          agentId,
          changeType,
        });
      }
    });
  }

  updateStreamBuffer(workspaceId: WorkspaceId, agentId: AgentId, buffer: string): void {
    const workspace = this.workspaces.get(workspaceId);
    const agentState = workspace?.agents.get(agentId);
    if (!agentState) return;

    agentState.streaming.buffer = buffer;
  }

  /**
   * Update the agent's digest - a short summary or question for display in task status
   * Agents can set this via <agent_digest>...</agent_digest> tags
   */
  updateAgentDigest(workspaceId: WorkspaceId, agentId: AgentId, digest: string | null): void {
    const workspace = this.workspaces.get(workspaceId);
    const agentState = workspace?.agents.get(agentId);
    if (!agentState) return;

    if (agentState.session) {
      agentState.session.digest = digest ?? undefined;
      agentState.lastModified = Date.now();
      logger.debug('Agent digest updated', { workspaceId, agentId, digest });
    }
  }

  // Context operations
  addContextItem(item: ContextItem): void {
    // Don't add duplicates
    if (
      this.contextState.items.some(
        (existing) => existing.type === item.type && existing.content === item.content,
      )
    ) {
      return;
    }

    this.contextState.items.push(item);
    logger.debug('Context item added', { type: item.type, id: item.id });
  }

  removeContextItem(id: string): void {
    this.contextState.items = this.contextState.items.filter((item) => item.id !== id);
    logger.debug('Context item removed', { id });
  }

  setSelection(selection: ContextState['currentSelection']): void {
    // Remove any existing selection items
    this.contextState.items = this.contextState.items.filter((item) => item.type !== 'selection');

    if (!selection || !selection.text?.trim()) {
      this.contextState.currentSelection = null;
      return;
    }

    // Create new selection item
    const selectionItem: ContextItem = {
      id: `selection-${uuidv4()}`,
      type: 'selection',
      label: selection.file
        ? `Selection from ${selection.file.split('/').pop()}`
        : 'Current Selection',
      content: selection.text,
      path: selection.file,
      description: selection.language ? `${selection.language} code` : 'Selected text',
      metadata: {
        range: selection.range,
        language: selection.language,
        autoAdded: true,
      },
    };

    this.contextState.currentSelection = selection;
    this.contextState.items.push(selectionItem);
  }

  clearContextItems(type?: string): void {
    if (type) {
      this.contextState.items = this.contextState.items.filter((item) => item.type !== type);
      if (type === 'selection') {
        this.contextState.currentSelection = null;
      }
    } else {
      this.contextState.items = [];
      this.contextState.currentSelection = null;
    }
  }

  // Model operations
  selectModel(model: string): void {
    this.modelState.selectedModel = model;
    // Manual persistence - only in browser environment
    if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
      localStorage.setItem('workspaces-selected-model', model);
    }
    logger.debug('Model selected', { model });
  }

  setAvailableModels(models: AuggieModel[]): void {
    this.modelState.availableModels = models;
    this.modelState.modelsLoaded = true;
    logger.debug('Available models set', { count: models.length });
  }

  setModelsLoading(loading: boolean): void {
    this.modelState.isLoadingModels = loading;
  }

  // UI operations
  setSidebarOpen(open: boolean): void {
    this.uiState.sidebarOpen = open;
    this.persistUIState();
  }

  setTheme(theme: UIState['theme']): void {
    this.uiState.theme = theme;
    this.persistUIState();
  }

  setFontSize(size: UIState['fontSize']): void {
    this.uiState.fontSize = size;
    this.persistUIState();
  }

  private persistUIState(): void {
    // Only persist in browser environment
    if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
      localStorage.setItem('workspaces-ui-state', JSON.stringify(this.uiState));
    }
  }

  // Panel operations
  setMainPanel(workspaceId: WorkspaceId, panel: Partial<WorkspaceState['mainPanel']>): void {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) return;

    Object.assign(workspace.mainPanel, panel);
    logger.debug('Main panel updated', { workspaceId, panel });
  }

  setDrawer(workspaceId: WorkspaceId, drawer: Partial<WorkspaceState['drawer']>): void {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) return;

    Object.assign(workspace.drawer, drawer);
    logger.debug('Drawer updated', { workspaceId, drawer });
  }

  // Task-agent association operations
  /**
   * Associates a task with an agent.
   *
   * @param {WorkspaceId} workspaceId - The workspace ID
   * @param {TaskAgentAssociation} association - The task-agent association
   * @returns {void}
   */
  associateTaskWithAgent(workspaceId: WorkspaceId, association: TaskAgentAssociation): void {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) {
      logger.warn('Cannot associate task with agent: workspace not found', { workspaceId });
      return;
    }

    workspace.taskAgentAssociations.set(association.taskId, association);
    logger.debug('Task associated with agent', {
      workspaceId,
      taskId: association.taskId,
      agentId: association.agentId,
    });
  }

  /**
   * Gets the agent associated with a task.
   *
   * @param {WorkspaceId} workspaceId - The workspace ID
   * @param {string} taskId - The task ID
   * @returns {TaskAgentAssociation | undefined} The association if found
   */
  getTaskAgentAssociation(
    workspaceId: WorkspaceId,
    taskId: string,
  ): TaskAgentAssociation | undefined {
    const workspace = this.workspaces.get(workspaceId);
    return workspace?.taskAgentAssociations.get(taskId);
  }

  /**
   * Removes a task-agent association.
   *
   * @param {WorkspaceId} workspaceId - The workspace ID
   * @param {string} taskId - The task ID
   * @returns {void}
   */
  removeTaskAgentAssociation(workspaceId: WorkspaceId, taskId: string): void {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) return;

    workspace.taskAgentAssociations.delete(taskId);
    logger.debug('Task-agent association removed', { workspaceId, taskId });
  }

  /**
   * Gets all task-agent associations for a workspace.
   *
   * @param {WorkspaceId} workspaceId - The workspace ID
   * @returns {Map<string, TaskAgentAssociation>} The associations map
   */
  getTaskAgentAssociations(workspaceId: WorkspaceId): Map<string, TaskAgentAssociation> {
    const workspace = this.workspaces.get(workspaceId);
    return workspace?.taskAgentAssociations || new Map();
  }

  /**
   * Gets all tasks assigned to a specific agent.
   * This is a reverse lookup from agent ID to tasks.
   *
   * @param {WorkspaceId} workspaceId - The workspace ID
   * @param {string} agentId - The agent ID to find tasks for
   * @returns {TaskAgentAssociation[]} Array of task associations for this agent
   */
  getTasksForAgent(workspaceId: WorkspaceId, agentId: string): TaskAgentAssociation[] {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) return [];

    const tasks: TaskAgentAssociation[] = [];
    for (const association of workspace.taskAgentAssociations.values()) {
      if (association.agentId === agentId) {
        tasks.push(association);
      }
    }
    return tasks;
  }

  // ============================================================================
  // Message Queue Operations
  // ============================================================================

  /**
   * Sets the queued messages for an agent.
   * Called when receiving queue updates from the backend.
   */
  setQueuedMessages(workspaceId: WorkspaceId, agentId: string, messages: QueuedMessage[]): void {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) return;

    const agent = workspace.agents.get(agentId);
    if (!agent) return;

    agent.queuedMessages = messages;
    logger.debug('Queued messages updated', { workspaceId, agentId, count: messages.length });
  }

  /**
   * Gets the queued messages for an agent.
   */
  getQueuedMessages(workspaceId: WorkspaceId, agentId: string): QueuedMessage[] {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) return [];

    const agent = workspace.agents.get(agentId);
    return agent?.queuedMessages || [];
  }

  // ============================================================================
  // Initial Spec Write State Operations
  // ============================================================================

  /**
   * Sets the initial spec write state for a workspace.
   * This flag indicates that the initial spec-writer agent is actively writing the spec.
   * Used to lock the spec document during initial spec generation.
   */
  setInitialSpecWriteInProgress(workspaceId: WorkspaceId, isWriting: boolean): void {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) return;

    // Only update if the value actually changed
    if (workspace.isInitialSpecWriteInProgress === isWriting) return;

    workspace.isInitialSpecWriteInProgress = isWriting;
    logger.debug('Initial spec write state updated', { workspaceId, isWriting });

    // Notify listeners
    this.initialSpecWriteListeners.forEach((listener) => {
      try {
        listener(workspaceId, isWriting);
      } catch (e) {
        logger.error('Error in initial spec write listener', e as Error, {
          workspaceId,
          isWriting,
        });
      }
    });
  }

  /**
   * Gets the initial spec write state for a workspace.
   */
  getInitialSpecWriteInProgress(workspaceId: WorkspaceId): boolean {
    const workspace = this.workspaces.get(workspaceId);
    return workspace?.isInitialSpecWriteInProgress ?? false;
  }

  /**
   * Subscribe to initial spec write state changes.
   * @returns Unsubscribe function
   */
  onInitialSpecWriteChange(
    listener: (workspaceId: WorkspaceId, isWriting: boolean) => void,
  ): () => void {
    this.initialSpecWriteListeners.add(listener);
    return () => {
      this.initialSpecWriteListeners.delete(listener);
    };
  }

  // Clear operations

  /**
   * Remove a specific workspace and all its agent state from the store.
   * Call this when a workspace is deleted to prevent stale agents from lingering in memory.
   */
  removeWorkspace(workspaceId: WorkspaceId): void {
    const existed = this.workspaces.delete(workspaceId);
    if (this.currentWorkspaceId === workspaceId) {
      this.currentWorkspaceId = null;
    }
    logger.debug('Workspace removed from state store', { workspaceId, existed });
  }

  clear(): void {
    this.workspaces.clear();
    this.currentWorkspaceId = null;
    this.contextState.items = [];
    this.contextState.currentSelection = null;
    logger.debug('State cleared');
  }
}

export const unifiedStateStore = UnifiedStateStore.getInstance();
