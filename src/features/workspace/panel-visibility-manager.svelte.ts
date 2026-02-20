/**
 * Panel Visibility Manager
 *
 * Centralized state management for controlling the visibility of workspace panels.
 * Manages the ContentNavigationRail and its individual panels with simple boolean controls.
 */

import { Logger } from '../../shared/logger';
import { firstVisitStateClient } from './first-visit-state.client';
import { WorkspaceId } from '$shared/types/branded-ids';

const logger = new Logger('PanelVisibilityManager');

export class PanelVisibilityManager {
  // Core visibility state - default to showing panels
  #showNavigationRail = $state(true);
  #showNotesPanel = $state(true);
  #showCodeChangesPanel = $state(true); // Default to showing, will be hidden if no changes
  #showFilesPanel = $state(true); // Default to showing, will be hidden for remote workspaces
  #showActivityLogPanel = $state(true); // Show activity log panel by default

  // Dock visibility state
  #showWorkspaceDock = $state(true);
  #showAgentNavRail = $state(true); // Default to showing
  #showTerminalNavRail = $state(true); // Default to showing

  // Workspace context
  #workspaceId: string | null = $state(null);
  #isInitialized = $state(false);
  #eventListenersAttached = $state(false);
  #isChatFocusedMode = $state(false);
  #showMainContent = $state(true);
  #showChatHeader = $state(true);

  constructor(workspaceId?: string) {
    if (workspaceId) {
      this.#workspaceId = workspaceId;
      logger.info(`[PanelVisibilityManager] Created for workspace: ${workspaceId}`);
    }
    // Only set up event listeners once, they're global anyway
    this.#setupEventListeners();
  }

  // Getters for reactive access
  get showNavigationRail() {
    return this.#showNavigationRail;
  }

  get showNotesPanel() {
    return this.#showNotesPanel;
  }

  get showCodeChangesPanel() {
    return this.#showCodeChangesPanel;
  }

  get showFilesPanel() {
    return this.#showFilesPanel;
  }

  get showActivityLogPanel() {
    return this.#showActivityLogPanel;
  }

  get showWorkspaceDock() {
    return this.#showWorkspaceDock;
  }

  get showAgentNavRail() {
    return this.#showAgentNavRail;
  }

  get showTerminalNavRail() {
    return this.#showTerminalNavRail;
  }

  get workspaceId() {
    return this.#workspaceId;
  }

  get isInitialized() {
    return this.#isInitialized;
  }

  get isChatFocusedMode() {
    return this.#isChatFocusedMode;
  }

  get showMainContent() {
    return this.#showMainContent;
  }

  get showChatHeader() {
    return this.#showChatHeader;
  }

  // Individual panel control methods
  setNavigationRailVisibility(visible: boolean) {
    logger.debug(`[PanelVisibilityManager] Setting navigation rail visibility: ${visible}`);
    this.#showNavigationRail = visible;
  }

  setNotesPanelVisibility(visible: boolean) {
    logger.debug(`[PanelVisibilityManager] Setting notes panel visibility:${visible}`);
    this.#showNotesPanel = visible;
  }

  setCodeChangesPanelVisibility(visible: boolean) {
    logger.debug(`[PanelVisibilityManager] Setting code changes panel visibility: ${visible}`);
    this.#showCodeChangesPanel = visible;
  }

  setFilesPanelVisibility(visible: boolean) {
    logger.debug(`[PanelVisibilityManager] Setting files panel visibility: ${visible}`);
    this.#showFilesPanel = visible;
  }

  setActivityLogPanelVisibility(visible: boolean) {
    logger.debug(`[PanelVisibilityManager] Setting activity log panel visibility: ${visible}`);
    this.#showActivityLogPanel = visible;
  }

  setWorkspaceDockVisibility(visible: boolean) {
    logger.debug(`[PanelVisibilityManager] Setting workspace dock visibility: ${visible}`);
    this.#showWorkspaceDock = visible;
  }

  setAgentNavRailVisibility(visible: boolean) {
    logger.debug(`[PanelVisibilityManager] Setting agent nav rail visibility: ${visible}`);
    this.#showAgentNavRail = visible;
  }

  setTerminalNavRailVisibility(visible: boolean) {
    logger.debug(`[PanelVisibilityManager] Setting terminal nav rail visibility: ${visible}`);
    this.#showTerminalNavRail = visible;
  }

  setChatFocusedMode(visible: boolean) {
    logger.debug(`[PanelVisibilityManager] Setting chat focused mode: ${visible}`);
    this.#isChatFocusedMode = visible;
  }

  setMainContentVisibility(visible: boolean) {
    logger.debug(`[PanelVisibilityManager] Setting main content visibility: ${visible}`);
    this.#showMainContent = visible;
  }

  setChatHeaderVisibility(visible: boolean) {
    logger.debug(`[PanelVisibilityManager] Setting chat header visibility: ${visible}`);
    this.#showChatHeader = visible;
  }

  // Workspace lifecycle methods
  async initialize(workspaceId: string) {
    logger.info(`[PanelVisibilityManager] Initializing for workspace: ${workspaceId}`);
    this.#workspaceId = workspaceId;
    this.#isInitialized = true;

    // Load first visit state from repository
    const state = await this.#loadFirstVisitState(workspaceId);

    if (state) {
      // State exists - restore panel visibility from saved state
      // The persisted state is the single source of truth, regardless of hasVisited flag
      logger.info('[PanelVisibilityManager] Restoring panel visibility from saved state');

      this.#showNavigationRail = state.navigationRailRevealed;
      this.#showNotesPanel = true; // Always show notes panel
      this.#showCodeChangesPanel = true; // Default to showing, will be updated if no changes
      this.#showFilesPanel = true; // Default to showing, will be updated based on workspace type
      this.#showActivityLogPanel = true; // Show activity log panel by default
      this.#showWorkspaceDock = state.workspaceDockRevealed;
      this.#showAgentNavRail = true; // Default to showing
      this.#showTerminalNavRail = true; // Default to showing
      this.#showMainContent = state.mainContentRevealed;
      this.#showChatHeader = state.mainContentRevealed; // Sync with main content
      this.#isChatFocusedMode = !state.mainContentRevealed; // Chat-focused when main content is hidden

      logger.info(
        `[PanelVisibilityManager] Panel visibility restored: mainContent=${state.mainContentRevealed}, navRail=${state.navigationRailRevealed}, dock=${state.workspaceDockRevealed}`,
      );
    } else {
      // No state found - this is a brand new workspace, show panels by default
      logger.info('[PanelVisibilityManager] No state found - setting defaults to show panels');
      this.#showNavigationRail = true; // Show by default
      this.#showNotesPanel = true; // Show notes panel by default
      this.#showCodeChangesPanel = true; // Default to showing, will be updated if no changes
      this.#showFilesPanel = true; // Default to showing, will be updated based on workspace type
      this.#showActivityLogPanel = true; // Show activity log panel by default
      this.#showWorkspaceDock = true; // Show by default
      this.#showAgentNavRail = true; // Show by default
      this.#showTerminalNavRail = true; // Show by default
      this.#showMainContent = true; // Show by default
      this.#showChatHeader = true; // Show by default
      this.#isChatFocusedMode = false; // Not in chat-focused mode by default
    }
  }

  /**
   * Load first visit state from client
   */
  async #loadFirstVisitState(workspaceId: string) {
    return await firstVisitStateClient.load(WorkspaceId(workspaceId));
  }

  reset() {
    logger.info('[PanelVisibilityManager] Resetting state');

    // Clean up event listeners
    this.#removeEventListeners();

    // Reset state
    this.#workspaceId = null;
    this.#isInitialized = false;
    this.#showNavigationRail = true;
    this.#showNotesPanel = true;
    this.#showCodeChangesPanel = true; // Default to showing
    this.#showFilesPanel = true; // Default to showing
    this.#showActivityLogPanel = true; // Show activity log panel by default
    this.#showWorkspaceDock = true;
    this.#showAgentNavRail = true;
    this.#showTerminalNavRail = true;
    this.#showMainContent = true;
    this.#showChatHeader = true;
    this.#isChatFocusedMode = false;
  }

  // Cleanup method for proper disposal
  destroy() {
    logger.info('[PanelVisibilityManager] Destroying instance');
    this.#removeEventListeners();
    this.#workspaceId = null;
    this.#isInitialized = false;
  }

  // Event handling
  #handlePanelVisibilityEvent = (event: Event) => {
    const eventType = event.type;
    logger.debug(`[PanelVisibilityManager] Panel visibility event received: ${eventType}`);

    switch (eventType) {
      case 'panelVisibility:showNotes':
        this.setNotesPanelVisibility(true);
        break;
      case 'panelVisibility:hideNotes':
        this.setNotesPanelVisibility(false);
        break;
      case 'panelVisibility:showCodeChanges':
        this.setCodeChangesPanelVisibility(true);
        break;
      case 'panelVisibility:hideCodeChanges':
        this.setCodeChangesPanelVisibility(false);
        break;
      case 'panelVisibility:showFiles':
        this.setFilesPanelVisibility(true);
        break;
      case 'panelVisibility:hideFiles':
        this.setFilesPanelVisibility(false);
        break;
      case 'panelVisibility:showActivityLog':
        this.setActivityLogPanelVisibility(true);
        break;
      case 'panelVisibility:hideActivityLog':
        this.setActivityLogPanelVisibility(false);
        break;
      case 'panelVisibility:showNavigationRail':
        this.setNavigationRailVisibility(true);
        break;
      case 'panelVisibility:hideNavigationRail':
        this.setNavigationRailVisibility(false);
        break;
      case 'panelVisibility:showWorkspaceDock':
        this.setWorkspaceDockVisibility(true);
        break;
      case 'panelVisibility:hideWorkspaceDock':
        this.setWorkspaceDockVisibility(false);
        break;
      case 'panelVisibility:showAgentNavRail':
        this.setAgentNavRailVisibility(true);
        break;
      case 'panelVisibility:hideAgentNavRail':
        this.setAgentNavRailVisibility(false);
        break;
      case 'panelVisibility:showTerminalNavRail':
        this.setTerminalNavRailVisibility(true);
        break;
      case 'panelVisibility:hideTerminalNavRail':
        this.setTerminalNavRailVisibility(false);
        break;
      case 'panelVisibility:chatFocusedModeTrue':
        this.setChatFocusedMode(true);
        break;
      case 'panelVisibility:chatFocusedModeFalse':
        this.setChatFocusedMode(false);
        break;
      case 'panelVisibility:showMainContent':
        this.setMainContentVisibility(true);
        break;
      case 'panelVisibility:hideMainContent':
        this.setMainContentVisibility(false);
        break;
      case 'panelVisibility:showChatHeader':
        this.setChatHeaderVisibility(true);
        break;
      case 'panelVisibility:hideChatHeader':
        this.setChatHeaderVisibility(false);
        break;
    }
  };

  #setupEventListeners() {
    if (this.#eventListenersAttached) {
      return;
    }

    const events = [
      'panelVisibility:showNotes',
      'panelVisibility:hideNotes',
      'panelVisibility:showCodeChanges',
      'panelVisibility:hideCodeChanges',
      'panelVisibility:showFiles',
      'panelVisibility:hideFiles',
      'panelVisibility:showActivityLog',
      'panelVisibility:hideActivityLog',
      'panelVisibility:showNavigationRail',
      'panelVisibility:hideNavigationRail',
      'panelVisibility:showWorkspaceDock',
      'panelVisibility:hideWorkspaceDock',
      'panelVisibility:showAgentNavRail',
      'panelVisibility:hideAgentNavRail',
      'panelVisibility:showTerminalNavRail',
      'panelVisibility:hideTerminalNavRail',
      'panelVisibility:chatFocusedModeTrue',
      'panelVisibility:chatFocusedModeFalse',
      'panelVisibility:showMainContent',
      'panelVisibility:hideMainContent',
      'panelVisibility:showChatHeader',
      'panelVisibility:hideChatHeader',
    ];

    events.forEach((eventName) => {
      window.addEventListener(eventName, this.#handlePanelVisibilityEvent);
    });

    this.#eventListenersAttached = true;
    logger.debug('[PanelVisibilityManager] Event listeners attached');
  }

  #removeEventListeners() {
    if (!this.#eventListenersAttached) {
      return;
    }

    const events = [
      'panelVisibility:showNotes',
      'panelVisibility:hideNotes',
      'panelVisibility:showCodeChanges',
      'panelVisibility:hideCodeChanges',
      'panelVisibility:showFiles',
      'panelVisibility:hideFiles',
      'panelVisibility:showActivityLog',
      'panelVisibility:hideActivityLog',
      'panelVisibility:showNavigationRail',
      'panelVisibility:hideNavigationRail',
      'panelVisibility:showWorkspaceDock',
      'panelVisibility:hideWorkspaceDock',
      'panelVisibility:showAgentNavRail',
      'panelVisibility:hideAgentNavRail',
      'panelVisibility:showTerminalNavRail',
      'panelVisibility:hideTerminalNavRail',
      'panelVisibility:chatFocusedModeTrue',
      'panelVisibility:chatFocusedModeFalse',
      'panelVisibility:showMainContent',
      'panelVisibility:hideMainContent',
      'panelVisibility:showChatHeader',
      'panelVisibility:hideChatHeader',
    ];

    events.forEach((eventName) => {
      window.removeEventListener(eventName, this.#handlePanelVisibilityEvent);
    });

    this.#eventListenersAttached = false;
    logger.info('[PanelVisibilityManager] Event listeners removed');
  }

  // Debug helper
  logCurrentState() {
    logger.info(
      `[PanelVisibilityManager] Current state: workspaceId=${this.#workspaceId}, isInitialized=${this.#isInitialized}, showNavigationRail=${this.#showNavigationRail}, showNotesPanel=${this.#showNotesPanel}, showCodeChangesPanel=${this.#showCodeChangesPanel}, showFilesPanel=${this.#showFilesPanel}, showActivityLogPanel=${this.#showActivityLogPanel}, showWorkspaceDock=${this.#showWorkspaceDock}, showAgentNavRail=${this.#showAgentNavRail}, showTerminalNavRail=${this.#showTerminalNavRail}, isChatFocusedMode=${this.#isChatFocusedMode}, showMainContent=${this.#showMainContent}, showChatHeader=${this.#showChatHeader}`,
    );
  }
}

/**
 * Factory function to create a PanelVisibilityManager instance
 */
export function createPanelVisibilityManager(workspaceId?: string): PanelVisibilityManager {
  return new PanelVisibilityManager(workspaceId);
}
