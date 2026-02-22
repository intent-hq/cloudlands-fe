/**
 * First Visit Manager
 *
 * Centralized state management for first-time workspace visits.
 * Eliminates prop drilling by providing a reactive store that components can subscribe to.
 * Handles agent creation, panel visibility coordination, and state persistence.
 *
 * Progressive Reveal System:
 * Each UI subsection (Notes, Code Changes, Activity Log, Files, Agents, Terminals) has a
 * criterion for when it should appear. Listeners are always active and automatically show
 * subsections when criteria are met. Parent rails (Content Nav Rail, Workspace Dock) cascade
 * visibility when any child subsection becomes visible.
 */

import { createLogger } from '$lib/utils/client-logger';
import { agentService } from '$features/agent/agent.service';
import { sessionStore } from '$features/agent/browser';
import { notesStateManager } from '$features/notes/notes.store.svelte';
import { SPEC_NOTE_ID } from '$shared/constants/notes';
import { queryEvents } from '$features/events/events.client';
import { diffStore } from '$features/diffs/diffs.store.svelte';
import { listenSync } from '$lib/electron-bridge';
import type { Workspace, FirstVisitState, WorkspaceId, NoteId } from '$shared/types';
import { WorkspaceId as WorkspaceIdFn, NoteId as NoteIdFn } from '$shared/types/branded-ids';
import { firstVisitStateClient } from './first-visit-state.client';
import type { PanelVisibilityManager } from './panel-visibility-manager.svelte';

const logger = createLogger('FirstVisitManager');

/**
 * Subsection visibility criteria
 * Each subsection has a criterion for when it should be revealed
 */
interface SubsectionCriterion {
  name: string;
  parentRail: 'contentNavRail' | 'workspaceDock';
  showEvent: string; // Event to dispatch when showing this subsection
  showParentEvent: string; // Event to dispatch to show parent rail
  stateKey: keyof FirstVisitState; // Key in FirstVisitState to track if shown
}

export interface FirstVisitAgent {
  id: string;
  type: 'agent';
  name: string;
  isFirstVisit: true;
  sessionId: string;
  messages: any[];
}

/**
 * Subsection registry - defines when each UI subsection should appear
 *
 * Each subsection has:
 * - A clear appearance criterion (e.g., "2+ agents", "1+ code change")
 * - Parent rail for cascade visibility
 * - Events to dispatch when revealed
 * - State key for persistence
 */
const SUBSECTION_CRITERIA: Record<string, SubsectionCriterion> = {
  // Workspace Dock subsections
  agents: {
    name: 'Agents',
    parentRail: 'workspaceDock',
    showEvent: 'panelVisibility:showAgentNavRail',
    showParentEvent: 'panelVisibility:showWorkspaceDock',
    stateKey: 'workspaceDockRevealed',
  },
  terminals: {
    name: 'Terminals',
    parentRail: 'workspaceDock',
    showEvent: 'panelVisibility:showTerminalNavRail',
    showParentEvent: 'panelVisibility:showWorkspaceDock',
    stateKey: 'workspaceDockRevealed',
  },

  // Content Nav Rail subsections
  // Note: For now, all content nav rail subsections map to navigationRailRevealed
  // In the future, we may want more granular state tracking
  notes: {
    name: 'Context',
    parentRail: 'contentNavRail',
    showEvent: 'panelVisibility:showNotes',
    showParentEvent: 'panelVisibility:showNavigationRail',
    stateKey: 'navigationRailRevealed',
  },
  codeChanges: {
    name: 'Code Changes',
    parentRail: 'contentNavRail',
    showEvent: 'panelVisibility:showCodeChanges',
    showParentEvent: 'panelVisibility:showNavigationRail',
    stateKey: 'navigationRailRevealed',
  },
  activityLog: {
    name: 'Activity Log',
    parentRail: 'contentNavRail',
    showEvent: 'panelVisibility:showActivityLog',
    showParentEvent: 'panelVisibility:showNavigationRail',
    stateKey: 'navigationRailRevealed',
  },
  files: {
    name: 'Files',
    parentRail: 'contentNavRail',
    showEvent: 'panelVisibility:showFiles',
    showParentEvent: 'panelVisibility:showNavigationRail',
    stateKey: 'navigationRailRevealed',
  },
};

export class FirstVisitManager {
  // Core state
  #workspaceId: string | null = $state(null);
  #firstVisitAgent: FirstVisitAgent | null = $state(null);
  #isInitialized = $state(false);

  // Track whether we've shown main content in this session
  // This is separate from the persisted mainContentRevealed state
  #hasShownMainContent = $state(false);

  // Reference to PanelVisibilityManager for checking current visibility state
  #panelVisibilityManager: PanelVisibilityManager | null = null;

  // Event listener cleanup
  #eventUnsubscribers: Array<() => void> = [];
  #subsectionUnsubscribers: Map<string, () => void> = new Map();

  constructor() {
    logger.info('[FirstVisitManager] Created');
  }

  // Getters for reactive access
  get workspaceId() {
    return this.#workspaceId;
  }

  get firstVisitAgent() {
    return this.#firstVisitAgent;
  }

  get isInitialized() {
    return this.#isInitialized;
  }

  /**
   * Initialize for a workspace - sets up progressive reveal system
   *
   * This method now:
   * 1. Initializes for EVERY workspace (first visit or not)
   * 2. Sets up subsection listeners that check PanelVisibilityManager state
   * 3. Only creates first-visit agent and hides panels on actual first visits
   *
   * IMPORTANT: Always cleans up previous state before initializing to prevent duplicate listeners
   */
  async initialize(workspaceId: string, workspace: Workspace): Promise<boolean> {
    logger.info(`[FirstVisitManager] Initializing for workspace: ${workspaceId}`);

    // CRITICAL: Clean up any previous state before initializing
    // This prevents duplicate listeners from being set up
    if (this.#isInitialized) {
      logger.info('[FirstVisitManager] Cleaning up previous state before re-initializing');
      this.cleanup();
    }

    this.#workspaceId = workspaceId;
    this.#isInitialized = true;

    // Load first visit state from repository
    const state = await this.#loadState(workspaceId);

    // Check if first visit setup is needed
    // Setup is needed if: no state exists OR firstVisitSetupReady is false
    const needsFirstVisitSetup = !state || !state.firstVisitSetupReady;

    if (needsFirstVisitSetup) {
      // First visit setup needed - create agent and hide panels
      logger.info(`[FirstVisitManager] First visit setup needed for workspace: ${workspaceId}`);
      this.#hasShownMainContent = state?.mainContentRevealed || false;

      // Create default state if it doesn't exist
      if (!state) {
        const defaultState: FirstVisitState = {
          version: 1,
          workspaceId: WorkspaceIdFn(workspaceId),
          firstVisitSetupReady: false, // Setup not done yet
          mainContentRevealed: false,
          navigationRailRevealed: false,
          workspaceDockRevealed: false,
          lastUpdated: new Date().toISOString(),
        };
        await this.#saveState(defaultState);
      }

      try {
        // Create the first visit agent (only once)
        logger.info(`[FirstVisitManager] Creating first visit agent for workspace: ${workspaceId}`);
        this.#firstVisitAgent = await this.#createFirstVisitAgent(workspace);

        if (!this.#firstVisitAgent) {
          logger.error('[FirstVisitManager] Failed to create first visit agent - agent is null');
        } else {
          logger.info(
            `[FirstVisitManager] First visit agent created successfully: ${this.#firstVisitAgent.id}`,
          );
        }

        // Trigger panel hiding
        logger.info('[FirstVisitManager] Hiding panels for first visit experience');
        this.#hideFirstVisitPanels();

        // Mark setup as ready - agent created, panels hidden
        const updatedState = await this.#loadState(workspaceId);
        if (updatedState) {
          updatedState.firstVisitSetupReady = true;
          updatedState.lastUpdated = new Date().toISOString();
          await this.#saveState(updatedState);
          logger.info('[FirstVisitManager] First visit setup complete - marked as ready');
        }
      } catch (error) {
        logger.error('[FirstVisitManager] Error during first visit setup:', error);
        // Still mark as ready to prevent infinite retries
        const updatedState = await this.#loadState(workspaceId);
        if (updatedState) {
          updatedState.firstVisitSetupReady = true;
          updatedState.lastUpdated = new Date().toISOString();
          await this.#saveState(updatedState);
        }
      }
    } else {
      // First visit setup already done
      logger.info(
        `[FirstVisitManager] First visit setup already complete for workspace: ${workspaceId}`,
      );
      this.#hasShownMainContent = state.mainContentRevealed;

      // Check if we should auto-complete the first visit experience
      // If the workspace is empty (no spec content, no code changes), consider it complete
      if (!state.mainContentRevealed) {
        const shouldAutoComplete = await this.#shouldAutoCompleteFirstVisit(workspaceId);
        if (shouldAutoComplete) {
          logger.info('[FirstVisitManager] Auto-completing first visit - workspace is empty');
          state.mainContentRevealed = true;
          state.navigationRailRevealed = true;
          state.workspaceDockRevealed = true;
          state.lastUpdated = new Date().toISOString();
          await this.#saveState(state);
          this.#hasShownMainContent = true;
          this.#firstVisitAgent = null;
        } else {
          // Still in first visit experience - need to get the agent for drawer
          logger.info(
            '[FirstVisitManager] Still in first visit experience - loading agent for drawer',
          );

          // If we already have a first visit agent from a previous initialization, keep it
          if (!this.#firstVisitAgent) {
            const agents = await agentService.getAgentsList(workspaceId);
            if (agents && agents.length > 0) {
              const agent = agents[0];
              this.#firstVisitAgent = {
                id: agent.id,
                type: 'agent' as const,
                name: agent.name,
                isFirstVisit: true as const,
                sessionId: agent.id || agent.id,
                messages: agent.messages || [],
              };
              logger.info(
                `[FirstVisitManager] Loaded first visit agent for drawer: ${this.#firstVisitAgent?.id}`,
              );
            } else {
              logger.warn('[FirstVisitManager] No agents found for workspace in first visit state');
              this.#firstVisitAgent = null;
            }
          } else {
            logger.info(
              `[FirstVisitManager] Using existing first visit agent: ${this.#firstVisitAgent.id}`,
            );
          }
        }
      } else {
        // Main content already revealed - first visit is complete
        this.#firstVisitAgent = null;
      }
    }

    // CRITICAL: Always set up spec change listener if main content hasn't been revealed yet
    // This ensures that even if the workspace is closed and reopened before writing to spec,
    // the listener is still active and will show main content on first write
    if (!this.#hasShownMainContent) {
      logger.info(
        '[FirstVisitManager] Main content not yet revealed - setting up spec change listener',
      );
      this.#setupSpecChangeListener(workspaceId);
    } else {
      logger.info(
        '[FirstVisitManager] Main content already revealed - skipping spec change listener',
      );
    }

    // ALWAYS set up subsection listeners for progressive reveal
    // This ensures subsections appear when criteria are met, regardless of visit status
    logger.info(
      `[FirstVisitManager] Setting up subsection listeners for workspace: ${workspaceId}`,
    );
    this.#setupSubsectionListeners(workspaceId);

    // Return true if we're still in the first visit experience (have an agent to show)
    // This ensures the drawer state gets applied in the page component
    const stillInFirstVisit = needsFirstVisitSetup || !!this.#firstVisitAgent;
    logger.info(
      `[FirstVisitManager] Initialize complete - stillInFirstVisit: ${stillInFirstVisit}, needsSetup: ${needsFirstVisitSetup}, hasAgent: ${!!this.#firstVisitAgent}`,
    );
    return stillInFirstVisit;
  }

  /**
   * Get drawer state for first visit (used by drawer state management)
   * Modified to NOT open drawer automatically - instead we'll show spec + agent side by side
   */
  getFirstVisitDrawerState() {
    // Return null to not open the drawer automatically
    // The workspace will handle opening spec and agent side by side
    return null;
  }

  /**
   * Set up workspace state coordination with PanelVisibilityManager
   * This is the MAIN coordinator that reacts to workspace events and updates panel visibility
   *
   * @param panelVisibilityManager - The panel visibility manager to coordinate with
   * @param workspace - The workspace object containing paths and configuration
   * @param hasCodeChanges - Reactive value indicating if there are uncommitted code changes
   * @param hasActivityEvents - Reactive value indicating if there are activity log events
   * @param loading - Reactive value indicating if workspace is loading
   */
  setupWorkspaceStateCoordination(
    panelVisibilityManager: PanelVisibilityManager,
    workspace: Workspace,
    hasCodeChanges: boolean,
    hasActivityEvents: boolean,
    loading: boolean,
  ): void {
    logger.info('[FirstVisitManager] Setting up workspace state coordination');

    // Store reference to PanelVisibilityManager for criteria checks
    this.#panelVisibilityManager = panelVisibilityManager;

    // Update code changes panel visibility
    panelVisibilityManager.setCodeChangesPanelVisibility(!!hasCodeChanges);
    logger.info(`[FirstVisitManager] Code changes panel visibility: ${!!hasCodeChanges}`);

    // Update activity log panel visibility
    panelVisibilityManager.setActivityLogPanelVisibility(!!(hasActivityEvents || loading));
    logger.info(
      `[FirstVisitManager] Activity log panel visibility: ${!!(hasActivityEvents || loading)}`,
    );

    // Update files panel visibility based on workspace paths (works for both local and remote)
    const shouldShowFiles = !!(workspace && (workspace.worktreePath || workspace.repositoryPath));
    panelVisibilityManager.setFilesPanelVisibility(shouldShowFiles);
    logger.info(`[FirstVisitManager] Files panel visibility: ${shouldShowFiles}`);
  }

  /**
   * Clean up when switching workspaces
   */
  cleanup(): void {
    logger.info(
      `[FirstVisitManager] Cleaning up (hasShownMainContent: ${this.#hasShownMainContent}, hasAgent: ${!!this.#firstVisitAgent})`,
    );

    // Clean up event listeners
    this.#eventUnsubscribers.forEach((unsub) => unsub());
    this.#eventUnsubscribers = [];

    // Clean up subsection listeners
    for (const unsubscribe of this.#subsectionUnsubscribers.values()) {
      unsubscribe();
    }
    this.#subsectionUnsubscribers.clear();

    // Don't clear the first visit agent or hasShownMainContent if we're still in first visit mode
    // They need to persist across re-initializations for the drawer to work
    const shouldKeepFirstVisitState = this.#firstVisitAgent && !this.#hasShownMainContent;
    if (shouldKeepFirstVisitState) {
      logger.info(
        `[FirstVisitManager] Keeping first visit state during cleanup: agent=${this.#firstVisitAgent?.id}, hasShownMainContent=${this.#hasShownMainContent}`,
      );
    }

    this.#workspaceId = null;
    if (!shouldKeepFirstVisitState) {
      this.#firstVisitAgent = null;
      this.#hasShownMainContent = false;
    }
    this.#isInitialized = false;
    this.#panelVisibilityManager = null;
  }

  // Private methods

  /**
   * Load first visit state from client
   */
  async #loadState(workspaceId: string): Promise<FirstVisitState | null> {
    return await firstVisitStateClient.load(WorkspaceIdFn(workspaceId));
  }

  /**
   * Save first visit state via client
   */
  async #saveState(state: FirstVisitState): Promise<void> {
    const success = await firstVisitStateClient.save(state.workspaceId, state);
    if (success) {
      logger.info(`[FirstVisitManager] State saved for workspace: ${state.workspaceId}`);
    } else {
      logger.error(`[FirstVisitManager] Failed to save state for workspace: ${state.workspaceId}`);
    }
  }

  /**
   * Load workspace data
   */
  async #loadWorkspace(workspaceId: string): Promise<Workspace | null> {
    try {
      const result = await window.electronAPI.invoke('workspace:get', { id: workspaceId });
      return result.success ? result.data : null;
    } catch (error) {
      logger.error('[FirstVisitManager] Failed to load workspace:', error);
      return null;
    }
  }

  /**
   * Check if we should auto-complete the first visit experience
   * Returns true if the workspace is essentially empty (no meaningful content)
   */
  async #shouldAutoCompleteFirstVisit(workspaceId: string): Promise<boolean> {
    try {
      // Check if spec has any content
      const spec = notesStateManager.notes.get(SPEC_NOTE_ID);
      const hasSpecContent = spec && spec.content && spec.content.trim().length > 0;

      // Check if there are any code changes
      const hasCodeChanges = diffStore.hasDiffs;

      // Check if there are any other notes besides spec
      const hasOtherNotes = Array.from(notesStateManager.notes.keys()).some(
        (id) => id !== SPEC_NOTE_ID,
      );

      // Auto-complete if workspace is empty
      const shouldAutoComplete = !hasSpecContent && !hasCodeChanges && !hasOtherNotes;

      logger.info('[FirstVisitManager] Auto-complete check:', {
        hasSpecContent,
        hasCodeChanges,
        hasOtherNotes,
        shouldAutoComplete,
      });

      return shouldAutoComplete;
    } catch (error) {
      logger.error('[FirstVisitManager] Error checking auto-complete conditions:', error);
      // If we can't determine, don't auto-complete
      return false;
    }
  }

  /**
   * Creates a real agent session for first-visit experience (called only once)
   *
   * IMPORTANT: Only creates an agent if there are NO existing agents for this workspace.
   * This prevents duplicate agent creation on workspace re-initialization.
   */
  async #createFirstVisitAgent(workspace: Workspace): Promise<FirstVisitAgent> {
    logger.info('[FirstVisitManager] Creating first visit agent session');

    // CRITICAL: Check if any agents already exist for this workspace
    const existingAgents = agentService.getSessionsForWorkspace(workspace.id);
    logger.info(`[FirstVisitManager] Existing agents check: ${existingAgents.length} agents found`);

    if (existingAgents.length > 0) {
      logger.info(
        `[FirstVisitManager] Agents already exist for workspace (${existingAgents.length}), skipping first visit agent creation`,
      );

      // Return the first existing agent as the first visit agent
      const firstAgent = existingAgents[0];
      return {
        id: firstAgent.id,
        type: 'agent',
        name: firstAgent.name || 'Agent',
        isFirstVisit: true,
        sessionId: firstAgent.id || '',
        messages: firstAgent.messages || [],
      };
    }

    logger.info(
      `[FirstVisitManager] No existing agents, creating new agent for workspace: ${workspace.id}`,
    );

    try {
      // Check if there's an initial prompt from workspace creation
      const initialPrompt = (workspace as any).initialPrompt;
      const initialMessage =
        initialPrompt || "Welcome to your new workspace! I'm here to help you get started.";

      const session = await agentService.createAgent(workspace, {
        name: 'Agent',
        initialMessage,
      });

      if (!session) {
        logger.error(
          '[FirstVisitManager] Failed to create agent session - createAgent returned null',
        );
        throw new Error('Failed to create first-visit agent session');
      }

      logger.info(`[FirstVisitManager] Created agent session: ${session.id}`);
      return {
        id: session.id,
        type: 'agent',
        name: session.name || 'Agent',
        isFirstVisit: true,
        sessionId: session.id || '',
        messages: session.messages || [],
      };
    } catch (error) {
      logger.error('[FirstVisitManager] Error creating agent:', error);
      throw error;
    }
  }

  /**
   * Hides panels for first-visit experience using PanelVisibilityManager events
   */
  #hideFirstVisitPanels(): void {
    logger.info('[FirstVisitManager] Hiding panels for clean first-visit experience');

    // Hide navigation rail panels
    window.dispatchEvent(new CustomEvent('panelVisibility:hideNotes'));
    window.dispatchEvent(new CustomEvent('panelVisibility:hideCodeChanges'));
    window.dispatchEvent(new CustomEvent('panelVisibility:hideFiles'));
    // Don't hide activity log - we want it visible by default
    // window.dispatchEvent(new CustomEvent("panelVisibility:hideActivityLog"));

    // Hide dock navigation rails
    window.dispatchEvent(new CustomEvent('panelVisibility:hideAgentNavRail'));
    window.dispatchEvent(new CustomEvent('panelVisibility:hideTerminalNavRail'));
    window.dispatchEvent(new CustomEvent('panelVisibility:hideWorkspaceDock'));
    window.dispatchEvent(new CustomEvent('panelVisibility:hideNavigationRail'));
    window.dispatchEvent(new CustomEvent('panelVisibility:hideMainContent'));
    window.dispatchEvent(new CustomEvent('panelVisibility:hideChatHeader'));

    // Enable chat-focused mode
    window.dispatchEvent(new CustomEvent('panelVisibility:chatFocusedModeTrue'));
  }

  /**
   * Shows panels after first-visit experience using PanelVisibilityManager events
   */
  #showFirstVisitPanels(): void {
    logger.info('[FirstVisitManager] Restoring panels after first interaction');

    // Show the main navigation rail
    window.dispatchEvent(new CustomEvent('panelVisibility:showNavigationRail'));

    // Show navigation rail panels
    window.dispatchEvent(new CustomEvent('panelVisibility:showNotes'));
    window.dispatchEvent(new CustomEvent('panelVisibility:showCodeChanges'));
    window.dispatchEvent(new CustomEvent('panelVisibility:showFiles'));
    window.dispatchEvent(new CustomEvent('panelVisibility:showActivityLog'));

    // Show dock navigation rails
    window.dispatchEvent(new CustomEvent('panelVisibility:showAgentNavRail'));
    window.dispatchEvent(new CustomEvent('panelVisibility:showTerminalNavRail'));
    window.dispatchEvent(new CustomEvent('panelVisibility:showWorkspaceDock'));
    window.dispatchEvent(new CustomEvent('panelVisibility:showMainContent'));
    window.dispatchEvent(new CustomEvent('panelVisibility:showChatHeader'));

    // Disable chat-focused mode
    window.dispatchEvent(new CustomEvent('panelVisibility:chatFocusedModeFalse'));
  }

  /**
   * Set up listener for spec changes to show main content on first write
   * Uses listenSync for synchronous cleanup - no race conditions on unmount
   */
  #setupSpecChangeListener(workspaceId: string): void {
    logger.info(
      `[FirstVisitManager] Setting up spec change listener for workspace: ${workspaceId}`,
    );

    const unlistenSpecUpdated = listenSync('note:updated', (event: any) => {
      const payload = event.payload || {};
      // noteId can be at top level (domain events) or inside data (workspace events)
      const noteId = payload.noteId || payload.data?.noteId;
      const content = payload.content || payload.changes?.content;
      const eventWorkspaceId = payload.workspaceId;

      logger.info('[FirstVisitManager] note:updated event received', {
        noteId,
        eventWorkspaceId,
        expectedWorkspaceId: workspaceId,
        hasContent: !!(content && content.trim().length > 0),
        hasShownMainContent: this.#hasShownMainContent,
      });

      // Only process updates for the spec note in this workspace
      if (noteId !== 'spec' || eventWorkspaceId !== workspaceId) {
        return;
      }

      // Check if this is the first time content is being added (was empty, now has content)
      const hasContent = content && content.trim().length > 0;

      // CRITICAL: Don't check this.#isFirstVisit here!
      // The listener should trigger whenever main content hasn't been shown yet,
      // regardless of whether first visit setup is complete
      if (hasContent && !this.#hasShownMainContent) {
        logger.info('[FirstVisitManager] First spec write detected - showing main content area');

        // Mark that we've shown the main content
        this.#hasShownMainContent = true;

        // Save state to persist that main content has been revealed
        void this.#loadState(workspaceId).then((state) => {
          if (state) {
            state.mainContentRevealed = true;
            state.lastUpdated = new Date().toISOString();
            void this.#saveState(state);
          }
        });

        // Show the main content area
        window.dispatchEvent(new CustomEvent('panelVisibility:showMainContent'));

        logger.info('[FirstVisitManager] Main content area is now visible');
      }
    });

    this.#eventUnsubscribers.push(unlistenSpecUpdated);
    logger.info('[FirstVisitManager] Spec change listener set up successfully');
  }

  /**
   * Set up listeners for all subsections
   * Each subsection has a criterion for when it should appear
   *
   * Listeners check PanelVisibilityManager state to determine if panel is currently visible.
   * If panel is already visible, listener returns early.
   * If criterion is met and panel is hidden, listener reveals the panel.
   */
  #setupSubsectionListeners(workspaceId: string): void {
    // Workspace Dock subsections
    this.#setupAgentsListener(workspaceId); // Criterion: 2+ agents
    this.#setupTerminalsListener(workspaceId); // Criterion: 1+ terminals (event-driven)

    // Content Nav Rail subsections
    this.#setupNotesListener(workspaceId); // Criterion: 2+ notes (excluding spec)
    this.#setupCodeChangesListener(workspaceId); // Criterion: 1+ code change/diff (event-driven)
    this.#setupActivityLogListener(workspaceId); // Criterion: 2+ activity events (event-driven)
    void this.#setupFilesListener(workspaceId); // Criterion: workspace has files (async for workspace load)
  }

  /**
   * Set up listener for agents subsection
   * Criterion: Show when 2+ agents exist
   *
   * Checks PanelVisibilityManager state to determine if panel is currently visible.
   */
  #setupAgentsListener(workspaceId: string): void {
    const subsectionKey = 'agents';

    const unsubscribe = sessionStore.getStore().subscribe((state: any) => {
      // Skip if panel is already visible (check PanelVisibilityManager state)
      if (this.#panelVisibilityManager?.showAgentNavRail) {
        return;
      }

      // Count agents for this workspace
      const workspaceAgents = Array.from(state.sessions?.values() || []).filter(
        (session: any) => session.workspaceId === workspaceId,
      );

      // Criterion: 2+ agents
      if (workspaceAgents.length > 1) {
        logger.info(
          `[FirstVisitManager] Agents criterion met (${workspaceAgents.length} agents) - revealing agents subsection`,
        );
        this.#revealSubsection(subsectionKey);
      }
    });

    this.#subsectionUnsubscribers.set(subsectionKey, unsubscribe);
  }

  /**
   * Set up listener for terminals subsection
   * Criterion: Show when 1+ terminals exist
   *
   * Checks PanelVisibilityManager state to determine if panel is currently visible.
   * PERF: Uses event-driven approach instead of polling for better performance.
   * Uses listenSync for synchronous cleanup - no race conditions on unmount
   */
  #setupTerminalsListener(workspaceId: string): void {
    const subsectionKey = 'terminals';

    // Check for terminals via IPC
    const checkTerminals = async () => {
      // Skip if panel is already visible (check PanelVisibilityManager state)
      if (this.#panelVisibilityManager?.showTerminalNavRail) {
        return;
      }

      try {
        // Check if there are any terminals for this workspace
        const result = await window.electronAPI.invoke('terminal:professional:list', {
          workspaceId,
        });

        // Criterion: 1+ terminals
        if (result && result.terminals && result.terminals.length >= 1) {
          logger.info(
            `[FirstVisitManager] Terminals criterion met (${result.terminals.length} terminals) - revealing terminals subsection`,
          );
          this.#revealSubsection(subsectionKey);
        }
      } catch (error) {
        // Terminal list not available, skip
      }
    };

    // Check immediately
    void checkTerminals();

    // Listen for terminal:created events instead of polling
    const unlistenTerminalCreated = listenSync('terminal:created', (event: any) => {
      const payload = event.payload || {};
      const eventWorkspaceId = payload.workspaceId;

      // Only process events for this workspace
      if (eventWorkspaceId !== workspaceId) {
        return;
      }

      // Terminal created - reveal subsection
      if (!this.#panelVisibilityManager?.showTerminalNavRail) {
        logger.info('[FirstVisitManager] terminal:created event - revealing terminals subsection');
        this.#revealSubsection(subsectionKey);
      }
    });

    this.#subsectionUnsubscribers.set(subsectionKey, unlistenTerminalCreated);
  }

  /**
   * Set up listener for notes subsection
   * Criterion: Show when 2+ notes exist (excluding spec)
   *
   * Checks PanelVisibilityManager state to determine if panel is currently visible.
   * Uses listenSync for synchronous cleanup - no race conditions on unmount
   */
  #setupNotesListener(workspaceId: string): void {
    const subsectionKey = 'notes';

    logger.info(`[FirstVisitManager] Setting up notes listener for workspace: ${workspaceId}`);

    // Check notes count whenever a note is created
    const checkNotes = () => {
      // Skip if panel is already visible (check PanelVisibilityManager state)
      if (this.#panelVisibilityManager?.showNotesPanel) {
        return;
      }

      // Get notes for this workspace, excluding the spec note
      const workspaceNotes = Array.from(notesStateManager.notes.values()).filter(
        (note) => note.workspaceId === workspaceId,
      );

      logger.info(
        `[FirstVisitManager] Notes check: ${workspaceNotes.length} notes for workspace ${workspaceId}`,
      );

      // Criterion: 2+ notes (excluding spec)
      if (workspaceNotes.length >= 2) {
        logger.info(
          `[FirstVisitManager] Notes criterion met (${workspaceNotes.length} notes) - revealing notes subsection`,
        );
        this.#revealSubsection(subsectionKey);
      }
    };

    // Check immediately
    checkNotes();

    // Listen for note creation events
    const unsubscribe = listenSync('note:created', (event: any) => {
      logger.info('[FirstVisitManager] note:created event received', {
        event,
        payload: event.payload,
        expectedWorkspaceId: workspaceId,
      });

      const { workspaceId: eventWorkspaceId } = event.payload || {};

      // Only check if it's for this workspace
      if (eventWorkspaceId === workspaceId) {
        logger.info(
          `[FirstVisitManager] Note created event received for workspace: ${workspaceId}`,
        );
        checkNotes();
      } else {
        logger.info(
          `[FirstVisitManager] Note created event for different workspace: ${eventWorkspaceId} (expected: ${workspaceId})`,
        );
      }
    });

    this.#subsectionUnsubscribers.set(subsectionKey, unsubscribe);
  }

  /**
   * Set up listener for code changes subsection
   * Criterion: Show when 1+ code change/diff exists
   *
   * Checks PanelVisibilityManager state to determine if panel is currently visible.
   * PERF: Uses event-driven approach instead of polling for better performance.
   * Uses listenSync for synchronous cleanup - no race conditions on unmount
   */
  #setupCodeChangesListener(workspaceId: string): void {
    const subsectionKey = 'codeChanges';

    // Check diffs
    const checkDiffs = () => {
      // Skip if panel is already visible (check PanelVisibilityManager state)
      if (this.#panelVisibilityManager?.showCodeChangesPanel) {
        return;
      }

      // Get diffs for this workspace
      const workspaceDiffs = diffStore.diffs.get(WorkspaceIdFn(workspaceId)) || [];

      // Criterion: 1+ diffs
      if (workspaceDiffs.length >= 1) {
        logger.info(
          `[FirstVisitManager] Code changes criterion met (${workspaceDiffs.length} diffs) - revealing code changes subsection`,
        );
        this.#revealSubsection(subsectionKey);
      }
    };

    // Check immediately
    checkDiffs();

    // Listen for workspace:updated events with diffs changes instead of polling
    const unlistenWorkspaceUpdated = listenSync('workspace:updated', (event: any) => {
      const payload = event.payload || {};
      const eventWorkspaceId = payload.workspaceId;
      const changes = payload.changes || {};

      // Only process events for this workspace with diffs changes
      if (eventWorkspaceId !== workspaceId || !changes.diffs) {
        return;
      }

      // Check diffs on update
      checkDiffs();
    });

    this.#subsectionUnsubscribers.set(subsectionKey, unlistenWorkspaceUpdated);
  }

  /**
   * Set up listener for activity log subsection
   * Criterion: Show when 2+ activity events exist
   *
   * Checks PanelVisibilityManager state to determine if panel is currently visible.
   * PERF: Uses event-driven approach instead of polling for better performance.
   * Uses listenSync for synchronous cleanup - no race conditions on unmount
   */
  #setupActivityLogListener(workspaceId: string): void {
    const subsectionKey = 'activityLog';

    // Track event count to avoid repeated queries
    let eventCount = 0;

    // Check activity log entries
    const checkActivityLog = async () => {
      // Skip if panel is already visible (check PanelVisibilityManager state)
      if (this.#panelVisibilityManager?.showActivityLogPanel) {
        return;
      }

      try {
        // Get events from the new event system
        const events = await queryEvents(workspaceId, [], 10);
        eventCount = events.length;

        // Criterion: 2+ activity events
        if (eventCount >= 2) {
          logger.info(
            `[FirstVisitManager] Activity log criterion met (${eventCount} events) - revealing activity log subsection`,
          );
          this.#revealSubsection(subsectionKey);
        }
      } catch (error) {
        logger.error('[FirstVisitManager] Failed to query events:', error);
      }
    };

    // Check immediately
    void checkActivityLog();

    // Listen for new events instead of polling
    // Uses listenSync for synchronous cleanup - no race conditions on unmount
    const unlistenEvent = listenSync('event', (event: any) => {
      const payload = event.payload || {};
      const eventWorkspaceId = payload.workspaceId;

      // Only process events for this workspace
      if (eventWorkspaceId !== workspaceId) {
        return;
      }

      // Increment count and check if we've reached threshold
      eventCount++;
      if (eventCount >= 2 && !this.#panelVisibilityManager?.showActivityLogPanel) {
        logger.info(
          `[FirstVisitManager] Activity log criterion met via event (${eventCount} events) - revealing activity log subsection`,
        );
        this.#revealSubsection(subsectionKey);
      }
    });

    this.#subsectionUnsubscribers.set(subsectionKey, unlistenEvent);
  }

  /**
   * Set up listener for files subsection
   * Criterion: Show when workspace has files (worktree or repository path exists)
   *
   * Checks PanelVisibilityManager state to determine if panel is currently visible.
   */
  async #setupFilesListener(workspaceId: string): Promise<void> {
    const subsectionKey = 'files';

    // Skip if panel is already visible (check PanelVisibilityManager state)
    if (this.#panelVisibilityManager?.showFilesPanel) {
      return;
    }

    // Check if workspace has files
    // This is a one-time check since workspace paths don't change
    const workspace = await this.#loadWorkspace(workspaceId);
    if (!workspace) {
      return;
    }

    // Criterion: workspace has worktree or repository path
    const hasFiles = !!(workspace.worktreePath || workspace.repositoryPath);

    if (hasFiles) {
      logger.info(
        '[FirstVisitManager] Files criterion met (workspace has files) - revealing files subsection',
      );
      await this.#revealSubsection(subsectionKey);
    }
  }

  /**
   * Reveal a subsection and its parent rail
   *
   * This method:
   * 1. Dispatches events to show the subsection and parent rail
   * 2. Saves state to persist the reveal
   * 3. Does NOT unsubscribe from the listener (listeners stay active to re-reveal if needed)
   */
  async #revealSubsection(subsectionKey: string): Promise<void> {
    const criterion = SUBSECTION_CRITERIA[subsectionKey];
    if (!criterion) {
      logger.error(`[FirstVisitManager] Unknown subsection: ${subsectionKey}`);
      return;
    }

    logger.info(`[FirstVisitManager] Revealing subsection: ${subsectionKey}`);

    // Show the subsection
    window.dispatchEvent(new CustomEvent(criterion.showEvent));

    // Show the parent rail (cascade)
    window.dispatchEvent(new CustomEvent(criterion.showParentEvent));

    // Save state to persist
    if (this.#workspaceId) {
      let state = await this.#loadState(this.#workspaceId);

      // Create state if it doesn't exist (for workspaces that predate the first visit system)
      if (!state) {
        state = {
          version: 1,
          workspaceId: WorkspaceIdFn(this.#workspaceId),
          firstVisitSetupReady: true, // Setup already done if we're revealing subsections
          mainContentRevealed: true,
          navigationRailRevealed: true,
          workspaceDockRevealed: false,
          lastUpdated: new Date().toISOString(),
        };
      }

      // Update the state key for this subsection
      // Use type assertion since we know the key is valid
      (state as any)[criterion.stateKey] = true;
      state.lastUpdated = new Date().toISOString();

      await this.#saveState(state);
    }

    // NOTE: We do NOT unsubscribe from the listener here
    // Listeners remain active to re-reveal panels if they are manually hidden
    // and the criterion is still met
  }

  /**
   * Clean up all resources for a workspace
   */
  cleanupWorkspace(workspaceId: string): void {
    logger.info(`[FirstVisitManager] Cleaning up workspace: ${workspaceId}`);

    // Clean up subsection listeners
    for (const [key, unsubscriber] of this.#subsectionUnsubscribers.entries()) {
      if (key.startsWith(`${workspaceId}:`)) {
        try {
          unsubscriber();
        } catch (error) {
          logger.error(`[FirstVisitManager] Error cleaning up subsection ${key}:`, error);
        }
        this.#subsectionUnsubscribers.delete(key);
      }
    }

    // If this is the current workspace, clear it
    if (this.#workspaceId === workspaceId) {
      this.#workspaceId = null;
      this.#firstVisitAgent = null;
      this.#isInitialized = false;
      this.#hasShownMainContent = false;
    }
  }

  /**
   * Clean up all resources
   */
  dispose(): void {
    logger.info('[FirstVisitManager] Disposing all resources');

    // Clean up all subsection listeners
    for (const [key, unsubscriber] of this.#subsectionUnsubscribers.entries()) {
      try {
        unsubscriber();
      } catch (error) {
        logger.error(`[FirstVisitManager] Error cleaning up subsection ${key}:`, error);
      }
    }
    this.#subsectionUnsubscribers.clear();

    // Clean up event listeners
    for (const unsubscriber of this.#eventUnsubscribers) {
      try {
        unsubscriber();
      } catch (error) {
        logger.error('[FirstVisitManager] Error cleaning up event listener:', error);
      }
    }
    this.#eventUnsubscribers = [];

    // Clear current workspace state
    this.#workspaceId = null;
    this.#firstVisitAgent = null;
    this.#isInitialized = false;
    this.#hasShownMainContent = false;
    this.#panelVisibilityManager = null;
  }
}

// Create a singleton instance
export const firstVisitManager = new FirstVisitManager();
