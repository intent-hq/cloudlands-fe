/**
 * Consolidated Agent State Management
 *
 * Single source of truth for all agent-related state.
 * Merges functionality from sessionStore and unifiedAgentStateStore.
 *
 * Features:
 * - Reactive state management using Svelte 5 runes
 * - Memory-efficient LRU cache for sessions
 * - Comprehensive state change logging
 * - Built-in validation and error handling
 * - Memory leak prevention
 * - Performance monitoring
 */

import type { AgentSession, AgentMessage, ContentBlock } from '$shared/types';
import { AgentStatus } from '$shared/types';
import { Logger } from '$shared/logger';
import { LIMITS } from '$shared/constants';
import type { AgentListItem } from '$shared/types/agent.types';
import { unifiedStateStore } from './unified-state-store';
import type { WorkspaceId, AgentId } from '$shared/types/branded-ids';

const logger = new Logger('ConsolidatedAgentState');

// ============================================================================
// Types
// ============================================================================

export interface StreamingState {
  active: boolean;
  sessionId?: string;
  startTime?: number;
  lastChunkTime?: number;
  buffer: string;
  contentBlocks: ContentBlock[];
  error?: Error;
}

export interface UIState {
  isExpanded: boolean;
  scrollPosition: number;
  searchQuery: string;
  selectedMessageId?: string;
  isAtTop: boolean;
  isAtBottom: boolean;
  showScrollToBottom: boolean;
}

export interface AgentState {
  session: AgentSession;
  streaming: StreamingState;
  ui: UIState;
  errors: Error[];
  metadata: {
    source?: string;
    isInitialAgent?: boolean;
    contextReferences?: any[];
    recovered?: boolean;
    recoveredAt?: string;
  };
  lastAccess: number; // For LRU tracking
  lastModified?: number; // For tracking last modification time
}

export interface StateChangeEvent {
  type: 'create' | 'update' | 'delete' | 'streaming' | 'error' | 'message-updated';
  agentId: string;
  timestamp: number;
  changes?: Partial<AgentState>;
  error?: Error;
  metadata?: Record<string, any>;
  data?: Record<string, any>;
}

export interface StateValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// ============================================================================
// Consolidated Agent State Store
// ============================================================================

class ConsolidatedAgentState {
  // State management - using regular properties with change tracking
  private agents: Map<string, AgentState> = new Map();
  private activeAgentId: string | null = null;
  private stateHistory: StateChangeEvent[] = [];
  private performanceMetrics = {
    operationCount: 0,
    averageOperationTime: 0,
    memoryUsage: 0,
    lastGC: Date.now(),
  };

  // Change listeners for reactivity
  private listeners = new Set<() => void>();

  // Configuration
  private readonly MAX_SESSIONS = LIMITS.MAX_SESSIONS || 50;
  private readonly MAX_HISTORY_SIZE = 1000;
  private readonly MEMORY_CHECK_INTERVAL = 60000; // 1 minute
  private readonly VALIDATION_ENABLED = true;

  // Memory management
  private memoryCheckTimer?: NodeJS.Timeout;
  private lastMemoryCheck = Date.now();

  constructor() {
    this.initialize();
  }

  private initialize() {
    // Start memory monitoring
    if (typeof window !== 'undefined') {
      this.startMemoryMonitoring();
    }

    // Log initialization
    logger.info('ConsolidatedAgentState initialized', {
      maxSessions: this.MAX_SESSIONS,
      validationEnabled: this.VALIDATION_ENABLED,
    });
  }

  // Notify listeners of state changes
  private notifyListeners() {
    this.listeners.forEach((listener) => listener());
  }

  // Add a listener for state changes
  private addListener(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ============================================================================
  // Derived States (Reactive Getters)
  // ============================================================================

  get allAgents() {
    return Array.from(this.agents.values());
  }

  get activeAgent() {
    return this.activeAgentId ? this.agents.get(this.activeAgentId) : null;
  }

  get streamingAgents() {
    return this.allAgents.filter((a) => a.streaming.active);
  }

  get agentCount() {
    return this.agents.size;
  }

  get activeSession() {
    return this.activeAgent?.session || null;
  }

  // ============================================================================
  // Core State Management
  // ============================================================================

  /**
   * Create or update an agent state with validation and logging
   */
  setAgent(agentId: string, state: AgentState) {
    const startTime = performance.now();

    try {
      // Validate state if enabled
      if (this.VALIDATION_ENABLED) {
        const validation = this.validateAgentState(state);
        if (!validation.valid) {
          logger.error('Invalid agent state', { agentId, errors: validation.errors });
          throw new Error(`Invalid agent state: ${validation.errors.join(', ')}`);
        }
        if (validation.warnings.length > 0) {
          logger.warn('Agent state warnings', { agentId, warnings: validation.warnings });
        }
      }

      // Check memory limits
      if (this.agents.size >= this.MAX_SESSIONS && !this.agents.has(agentId)) {
        this.evictLRUAgent();
      }

      // Update last access time
      state.lastAccess = Date.now();

      // Store the state
      const isNew = !this.agents.has(agentId);
      this.agents.set(agentId, state);

      // Cleanup service removed - legacy cleanup

      // Auto-activate if it's the only agent
      if (this.agents.size === 1 && !this.activeAgentId) {
        this.activeAgentId = agentId;
      }

      // Log state change
      this.logStateChange({
        type: isNew ? 'create' : 'update',
        agentId,
        timestamp: Date.now(),
        changes: { session: state.session },
      });

      // Update performance metrics
      this.updatePerformanceMetrics(performance.now() - startTime);

      logger.debug('Agent state set', {
        agentId,
        isNew,
        sessionStatus: state.session.status,
        messageCount: state.session.messages.length,
      });

      // Notify listeners of state change
      this.notifyListeners();
    } catch (error) {
      this.logStateChange({
        type: 'error',
        agentId,
        timestamp: Date.now(),
        error: error as Error,
      });
      throw error;
    }
  }

  /**
   * Get agent state by ID
   */
  getAgent(agentId: string): AgentState | undefined {
    const state = this.agents.get(agentId);
    if (state) {
      // Update last access time for LRU
      state.lastAccess = Date.now();
    }
    return state;
  }

  /**
   * Check if an agent exists
   */
  hasAgent(agentId: string): boolean {
    return this.agents.has(agentId);
  }

  /**
   * Get session by ID (compatibility method)
   */
  getSession(agentId: string): AgentSession | null {
    return this.getAgent(agentId)?.session || null;
  }

  /**
   * Add or update a session (compatibility method from sessionStore)
   * Also syncs with unifiedStateStore for UI components that read from there
   */
  addSession(session: AgentSession): void {
    const existingState = this.agents.get(session.id);

    if (existingState) {
      // Update existing state
      existingState.session = session;
      existingState.lastAccess = Date.now();
      this.setAgent(session.id, existingState);
    } else {
      // Create new state
      const newState: AgentState = {
        session,
        streaming: {
          active: false,
          buffer: '',
          contentBlocks: [],
        },
        ui: {
          isExpanded: false,
          scrollPosition: 0,
          searchQuery: '',
          isAtTop: true,
          isAtBottom: true,
          showScrollToBottom: false,
        },
        errors: [],
        metadata: {},
        lastAccess: Date.now(),
      };
      this.setAgent(session.id, newState);
    }

    // Sync with unifiedStateStore for UI components (like UnifiedNotesPanel)
    // that read agent state from there
    if (session.workspaceId) {
      unifiedStateStore.setAgent(session.workspaceId as WorkspaceId, {
        id: session.id as AgentId,
        session,
        streaming: {
          active: false,
          buffer: '',
          contentBlocks: [],
          orderedContentBlocks: [],
        },
        ui: {
          isExpanded: false,
          scrollPosition: 0,
          searchQuery: '',
          isAtTop: true,
          isAtBottom: true,
          showScrollToBottom: false,
        },
        errors: [],
        metadata: {
          source: 'session-store-sync',
        },
        lastAccess: Date.now(),
        messageIdSet: new Set(),
        messages: session.messages || [],
      });
    }
  }

  /**
   * Remove an agent
   */
  removeAgent(agentId: string): void {
    const startTime = performance.now();

    if (!this.agents.has(agentId)) {
      logger.warn('Attempted to remove non-existent agent', { agentId });
      return;
    }

    // Clean up streaming state
    const state = this.agents.get(agentId);
    if (state?.streaming.active) {
      this.stopStreaming(agentId);
    }

    // Remove the agent
    this.agents.delete(agentId);

    // Update active agent if needed
    if (this.activeAgentId === agentId) {
      this.activeAgentId = this.agents.size > 0 ? Array.from(this.agents.keys())[0] : null;
    }

    // Log state change
    this.logStateChange({
      type: 'delete',
      agentId,
      timestamp: Date.now(),
    });

    // Update performance metrics
    this.updatePerformanceMetrics(performance.now() - startTime);

    logger.info('Agent removed', { agentId, remainingAgents: this.agents.size });

    // Notify listeners of state change
    this.notifyListeners();
  }

  /**
   * Remove session (compatibility method)
   */
  removeSession(agentId: string): void {
    this.removeAgent(agentId);
  }

  /**
   * Set active agent
   */
  setActiveAgent(agentId: string | null): void {
    if (agentId && !this.agents.has(agentId)) {
      logger.warn('Attempted to set non-existent agent as active', { agentId });
      return;
    }

    this.activeAgentId = agentId;

    if (agentId) {
      const state = this.agents.get(agentId);
      if (state) {
        state.lastAccess = Date.now();
      }
    }

    logger.debug('Active agent changed', { agentId });

    // Notify listeners of state change
    this.notifyListeners();
  }

  /**
   * Set active session (compatibility method)
   */
  setActiveSession(agentId: string | null): void {
    this.setActiveAgent(agentId);
  }

  // ============================================================================
  // Message Management
  // ============================================================================

  /**
   * Add a message to an agent's session
   */
  addMessage(agentId: string, message: AgentMessage): void {
    const state = this.getAgent(agentId);
    if (!state) {
      logger.warn('Cannot add message to non-existent agent', { agentId });
      return;
    }

    // Ensure messages array exists
    if (!state.session.messages) {
      state.session.messages = [];
    }

    // CRITICAL FIX: Check for duplicate message IDs before adding
    // This prevents the "Cannot read properties of undefined (reading 'prev')" error
    // in Svelte's keyed each blocks when duplicate IDs are rendered
    const isDuplicate = state.session.messages.some((m) => m.id === message.id);
    if (isDuplicate) {
      logger.debug('Skipping duplicate message', {
        agentId,
        messageId: message.id,
        messageRole: message.role,
      });
      return;
    }

    // Add the message
    state.session.messages.push(message);
    state.session.lastActivity = new Date();
    state.session.updatedAt = new Date();
    state.lastAccess = Date.now();

    // Log the change
    this.logStateChange({
      type: 'update',
      agentId,
      timestamp: Date.now(),
      metadata: { messageAdded: true, messageRole: message.role },
    });

    logger.debug('Message added to agent', {
      agentId,
      messageRole: message.role,
      totalMessages: state.session.messages.length,
    });

    // Notify listeners of state change
    this.notifyListeners();
  }

  /**
   * Update messages for a session
   */
  updateMessages(agentId: string, messages: AgentMessage[]): void {
    const state = this.getAgent(agentId);
    if (!state) {
      logger.warn('Cannot update messages for non-existent agent', { agentId });
      return;
    }

    state.session.messages = messages;
    state.session.lastActivity = new Date();
    state.session.updatedAt = new Date();
    state.lastAccess = Date.now();

    logger.debug('Messages updated for agent', {
      agentId,
      messageCount: messages.length,
    });
  }

  // ============================================================================
  // Streaming Management
  // ============================================================================

  /**
   * Start streaming for an agent
   */
  startStreaming(agentId: string, sessionId?: string): void {
    const state = this.getAgent(agentId);
    if (!state) {
      logger.warn('Cannot start streaming for non-existent agent', { agentId });
      return;
    }

    // Check if already streaming to prevent duplicate starts
    if (state.streaming.active) {
      logger.debug('Streaming already active, skipping duplicate start', {
        agentId,
        sessionId,
        existingSessionId: state.streaming.sessionId,
        existingStartTime: state.streaming.startTime,
      });
      return;
    }

    state.streaming = {
      active: true,
      sessionId,
      startTime: Date.now(),
      lastChunkTime: Date.now(),
      buffer: '',
      contentBlocks: [],
    };

    state.session.isStreaming = true;
    state.session.status = AgentStatus.Active;

    // Sync with unifiedStateStore so UI components (like UnifiedNotesPanel) can see streaming state
    if (state.session.workspaceId) {
      unifiedStateStore.setStreaming(
        state.session.workspaceId as WorkspaceId,
        agentId as AgentId,
        true,
      );
    }

    this.logStateChange({
      type: 'streaming',
      agentId,
      timestamp: Date.now(),
      metadata: { action: 'start', sessionId },
    });

    logger.info('Streaming started', { agentId, sessionId });
  }

  /**
   * Append to streaming buffer
   */
  appendToStream(agentId: string, chunk: string): void {
    const state = this.getAgent(agentId);
    if (!state || !state.streaming.active) {
      logger.warn('Cannot append to inactive stream', { agentId });
      return;
    }

    state.streaming.buffer += chunk;
    state.streaming.lastChunkTime = Date.now();

    // Cleanup service removed - legacy cleanup
  }

  /**
   * Stop streaming for an agent
   */
  stopStreaming(agentId: string, finalMessage?: AgentMessage): void {
    const state = this.getAgent(agentId);
    if (!state) {
      logger.warn('Cannot stop streaming for non-existent agent', { agentId });
      return;
    }

    const duration = state.streaming.startTime ? Date.now() - state.streaming.startTime : 0;

    state.streaming.active = false;
    state.session.isStreaming = false;
    state.session.status = AgentStatus.Idle;
    state.streaming.buffer = '';
    state.streaming.contentBlocks = [];

    // Sync with unifiedStateStore so UI components (like UnifiedNotesPanel) can see streaming state
    if (state.session.workspaceId) {
      unifiedStateStore.setStreaming(
        state.session.workspaceId as WorkspaceId,
        agentId as AgentId,
        false,
      );
    }

    if (finalMessage) {
      this.addMessage(agentId, finalMessage);
    }

    this.logStateChange({
      type: 'streaming',
      agentId,
      timestamp: Date.now(),
      metadata: { action: 'stop', duration },
    });

    logger.info('Streaming stopped', { agentId, duration });

    // Notify listeners to trigger UI update
    this.notifyListeners();
  }

  /**
   * Add content blocks to streaming state
   */
  addContentBlocks(agentId: string, blocks: ContentBlock[]): void {
    const state = this.getAgent(agentId);
    if (!state || !state.streaming.active) {
      logger.warn('Cannot add content blocks to inactive stream', { agentId });
      return;
    }

    // Merge text blocks if the last block and new first block are both text
    if (blocks.length > 0 && state.streaming.contentBlocks.length > 0) {
      const lastBlock = state.streaming.contentBlocks[state.streaming.contentBlocks.length - 1];
      const firstNewBlock = blocks[0];

      if (lastBlock.type === 'text' && firstNewBlock.type === 'text') {
        // Merge the text content
        lastBlock.text = (lastBlock.text || '') + (firstNewBlock.text || '');
        // Add remaining blocks (skip the first one we merged)
        state.streaming.contentBlocks.push(...blocks.slice(1));
      } else {
        // Just add all blocks
        state.streaming.contentBlocks.push(...blocks);
      }
    } else {
      // Just add all blocks
      state.streaming.contentBlocks.push(...blocks);
    }

    state.streaming.lastChunkTime = Date.now();
    this.notifyListeners();
  }

  /**
   * Set streaming state (compatibility method)
   */
  setStreaming(agentId: string, isStreaming: boolean, sessionId?: string): void {
    if (isStreaming) {
      this.startStreaming(agentId, sessionId);
    } else {
      this.stopStreaming(agentId);
    }
  }

  // ============================================================================
  // UI State Management
  // ============================================================================

  /**
   * Update UI state for an agent
   */
  updateUIState(agentId: string, updates: Partial<UIState>): void {
    const state = this.getAgent(agentId);
    if (!state) {
      logger.warn('Cannot update UI state for non-existent agent', { agentId });
      return;
    }

    Object.assign(state.ui, updates);
    state.lastAccess = Date.now();

    logger.debug('UI state updated', { agentId, updates });
  }

  // ============================================================================
  // Error Management
  // ============================================================================

  /**
   * Add an error to an agent
   */
  addError(agentId: string, error: Error): void {
    const state = this.getAgent(agentId);
    if (!state) {
      logger.warn('Cannot add error to non-existent agent', { agentId });
      return;
    }

    state.errors.push(error);
    state.session.status = AgentStatus.Error;

    this.logStateChange({
      type: 'error',
      agentId,
      timestamp: Date.now(),
      error,
      metadata: { errorCount: state.errors.length },
    });

    logger.error('Error added to agent', { agentId, error: error.message });
  }

  /**
   * Clear errors for an agent
   */
  clearErrors(agentId: string): void {
    const state = this.getAgent(agentId);
    if (!state) {
      return;
    }

    state.errors = [];
    if (state.session.status === AgentStatus.Error) {
      state.session.status = AgentStatus.Idle;
    }

    logger.debug('Errors cleared for agent', { agentId });
  }

  // ============================================================================
  // Batch Operations
  // ============================================================================

  /**
   * Batch update multiple agents
   */
  batchUpdate(updates: Map<string, Partial<AgentState>>): void {
    const startTime = performance.now();

    for (const [agentId, update] of updates) {
      const state = this.getAgent(agentId);
      if (state) {
        // Deep merge the updates
        if (update.session) {
          Object.assign(state.session, update.session);
        }
        if (update.streaming) {
          Object.assign(state.streaming, update.streaming);
        }
        if (update.ui) {
          Object.assign(state.ui, update.ui);
        }
        if (update.errors) {
          state.errors = update.errors;
        }
        if (update.metadata) {
          Object.assign(state.metadata, update.metadata);
        }
        state.lastAccess = Date.now();
      }
    }

    this.updatePerformanceMetrics(performance.now() - startTime);

    logger.debug('Batch update completed', {
      agentCount: updates.size,
      duration: performance.now() - startTime,
    });
  }

  /**
   * Get all agents as list items (for UI)
   */
  getAgentList(): AgentListItem[] {
    return Array.from(this.agents.values()).map((state) => ({
      id: state.session.id,
      name: state.session.name,
      status: state.session.status,
      createdAt: state.session.createdAt,
      lastActivity:
        typeof state.session.lastActivity === 'string'
          ? state.session.lastActivity
          : state.session.lastActivity?.toISOString?.() || undefined,
      messageCount: state.session.messages?.length || 0,
      isStreaming: state.streaming.active,
      hasErrors: state.errors.length > 0,
    }));
  }

  // ============================================================================
  // Memory Management
  // ============================================================================

  /**
   * Evict least recently used agent
   */
  private evictLRUAgent(): void {
    let lruAgent: string | null = null;
    let oldestAccess = Date.now();

    for (const [agentId, state] of this.agents) {
      // Don't evict active or streaming agents
      if (agentId === this.activeAgentId || state.streaming.active) {
        continue;
      }

      if (state.lastAccess < oldestAccess) {
        oldestAccess = state.lastAccess;
        lruAgent = agentId;
      }
    }

    if (lruAgent) {
      logger.info('Evicting LRU agent', { agentId: lruAgent, age: Date.now() - oldestAccess });
      this.removeAgent(lruAgent);
    }
  }

  /**
   * Start memory monitoring
   */
  private startMemoryMonitoring(): void {
    this.memoryCheckTimer = setInterval(() => {
      this.checkMemoryUsage();
    }, this.MEMORY_CHECK_INTERVAL);
  }

  /**
   * Check memory usage and trigger GC if needed
   */
  private checkMemoryUsage(): void {
    if (typeof performance !== 'undefined' && 'memory' in performance) {
      const memory = (performance as any).memory;
      const usedMemory = memory.usedJSHeapSize;
      const totalMemory = memory.totalJSHeapSize;
      const usage = (usedMemory / totalMemory) * 100;

      this.performanceMetrics.memoryUsage = usedMemory;

      if (usage > 90) {
        logger.warn('High memory usage detected', {
          usage: `${usage.toFixed(2)}%`,
          usedMB: (usedMemory / 1048576).toFixed(2),
          totalMB: (totalMemory / 1048576).toFixed(2),
        });

        // Trigger cleanup
        this.performGarbageCollection();
      }
    }
  }

  /**
   * Perform garbage collection
   */
  private readonly MAX_MESSAGES_PER_AGENT = 500;

  private performGarbageCollection(): void {
    const now = Date.now();
    if (now - this.performanceMetrics.lastGC < 30000) {
      // Don't GC more than once every 30 seconds
      return;
    }

    let totalPruned = 0;

    // Clear old history
    if (this.stateHistory.length > this.MAX_HISTORY_SIZE) {
      this.stateHistory = this.stateHistory.slice(-this.MAX_HISTORY_SIZE / 2);
    }

    // Clear error stacks and prune messages from agents
    for (const state of this.agents.values()) {
      if (state.errors.length > 10) {
        state.errors = state.errors.slice(-10);
      }

      // Prune old messages to prevent memory bloat
      if (state.session?.messages && state.session.messages.length > this.MAX_MESSAGES_PER_AGENT) {
        const pruneCount = state.session.messages.length - this.MAX_MESSAGES_PER_AGENT;
        state.session.messages.splice(0, pruneCount);
        totalPruned += pruneCount;
      }

      // Clean up streaming metadata from completed messages
      if (state.session?.messages) {
        for (const message of state.session.messages) {
          if (message.streamingComplete && message.metadata) {
            delete message.metadata.chunksReceived;
            delete message.metadata.firstChunkTime;
            delete message.metadata.lastChunkTime;
            delete message.metadata.totalChunkSize;
          }
        }
      }

      // Clear streaming buffer if not actively streaming
      if (!state.streaming.active && state.streaming.buffer) {
        state.streaming.buffer = '';
        state.streaming.contentBlocks = [];
      }
    }

    this.performanceMetrics.lastGC = now;
    logger.info('Garbage collection performed', { messagesPruned: totalPruned });
  }

  // ============================================================================
  // State Validation
  // ============================================================================

  /**
   * Validate agent state
   */
  private validateAgentState(state: AgentState): StateValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Required fields
    if (!state.session) {
      errors.push('Session is required');
    } else {
      if (!state.session.id) {
        errors.push('Session ID is required');
      }
      if (!state.session.name) {
        warnings.push('Session name is missing');
      }
      if (!state.session.messages) {
        warnings.push('Session messages array is not initialized');
      }
    }

    if (!state.streaming) {
      errors.push('Streaming state is required');
    }

    if (!state.ui) {
      errors.push('UI state is required');
    }

    // Check for memory leaks
    if (state.session?.messages?.length > 1000) {
      warnings.push('Session has excessive messages (>1000)');
    }

    if (state.errors?.length > 100) {
      warnings.push('Agent has excessive errors (>100)');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  // ============================================================================
  // Logging and Monitoring
  // ============================================================================

  /**
   * Log state change
   */
  private logStateChange(event: StateChangeEvent): void {
    this.stateHistory.push(event);

    // Trim history if too large
    if (this.stateHistory.length > this.MAX_HISTORY_SIZE) {
      this.stateHistory = this.stateHistory.slice(-this.MAX_HISTORY_SIZE);
    }

    // Log to console in development
    if (process.env.NODE_ENV === 'development') {
      logger.debug('State change', event);
    }
  }

  /**
   * Update performance metrics
   */
  private updatePerformanceMetrics(operationTime: number): void {
    const metrics = this.performanceMetrics;
    metrics.operationCount++;

    // Calculate running average
    metrics.averageOperationTime =
      (metrics.averageOperationTime * (metrics.operationCount - 1) + operationTime) /
      metrics.operationCount;

    if (operationTime > 100) {
      logger.warn('Slow operation detected', {
        duration: `${operationTime.toFixed(2)}ms`,
        average: `${metrics.averageOperationTime.toFixed(2)}ms`,
      });
    }
  }

  // ============================================================================
  // Export and Debug
  // ============================================================================

  /**
   * Export state for debugging
   */
  exportState() {
    return {
      agents: Array.from(this.agents.entries()).map(([id, state]) => ({
        id,
        status: state.session.status,
        messageCount: state.session.messages?.length || 0,
        isStreaming: state.streaming.active,
        errors: state.errors.length,
        lastAccess: new Date(state.lastAccess).toISOString(),
      })),
      activeAgentId: this.activeAgentId,
      totalAgents: this.agents.size,
      performanceMetrics: this.performanceMetrics,
      historySize: this.stateHistory.length,
    };
  }

  /**
   * Get state history
   */
  getStateHistory(limit: number = 100): StateChangeEvent[] {
    return this.stateHistory.slice(-limit);
  }

  /**
   * Clear all state
   */
  clearAll(): void {
    // Stop all streaming
    for (const [agentId, state] of this.agents) {
      if (state.streaming.active) {
        this.stopStreaming(agentId);
      }
    }

    // Clear all data
    this.agents.clear();
    this.activeAgentId = null;
    this.stateHistory = [];

    logger.info('All agent state cleared');
  }

  /**
   * Clear sessions (compatibility method)
   */
  clear(): void {
    this.clearAll();
  }

  /**
   * Cleanup resources
   */
  cleanup(): void {
    if (this.memoryCheckTimer) {
      clearInterval(this.memoryCheckTimer);
      this.memoryCheckTimer = undefined;
    }

    this.clearAll();
    logger.info('ConsolidatedAgentState cleaned up');
  }

  // ============================================================================
  // Additional Public Methods
  // ============================================================================

  /**
   * Get all sessions
   */
  get sessions(): AgentSession[] {
    return Array.from(this.agents.values()).map((state) => state.session);
  }

  /**
   * Get all sessions (alias for compatibility)
   */
  getAllSessions(): AgentSession[] {
    return this.sessions;
  }

  /**
   * Find sessions matching a predicate
   */
  findSessions(predicate: (session: AgentSession) => boolean): AgentSession[] {
    return this.sessions.filter(predicate);
  }

  /**
   * Get active session (alias for compatibility)
   */
  getActiveSession(): AgentSession | null {
    return this.activeSession;
  }

  /**
   * Update a single message in a session
   */
  updateMessage(agentId: string, messageId: string, updates: Partial<AgentMessage>): void {
    const state = this.agents.get(agentId);
    if (!state) {
      logger.warn('Cannot update message - agent not found', { agentId, messageId });
      return;
    }

    const messageIndex = state.session.messages.findIndex((m) => m.id === messageId);
    if (messageIndex === -1) {
      logger.warn('Cannot update message - message not found', { agentId, messageId });
      return;
    }

    // Update the message
    state.session.messages[messageIndex] = {
      ...state.session.messages[messageIndex],
      ...updates,
    };

    // Update last modified
    state.lastModified = Date.now();

    // Log the change
    this.logStateChange({
      type: 'message-updated',
      agentId,
      timestamp: Date.now(),
      data: { messageId, updates },
    });

    // Notify listeners
    this.notifyListeners();

    logger.debug('Message updated', { agentId, messageId });
  }

  /**
   * Get statistics about the state
   */
  getStats() {
    const totalAgents = this.agents.size;
    const activeAgents = Array.from(this.agents.values()).filter(
      (state) => state.session.status === AgentStatus.Active,
    ).length;
    const totalMessages = Array.from(this.agents.values()).reduce(
      (sum, state) => sum + state.session.messages.length,
      0,
    );

    return {
      totalAgents,
      activeAgents,
      totalMessages,
      memoryUsage: this.performanceMetrics.memoryUsage,
      historySize: this.stateHistory.length,
    };
  }

  // ============================================================================
  // Compatibility Methods (for sessionStore migration)
  // ============================================================================

  /**
   * Get store for reactive subscriptions (Svelte store compatibility)
   */
  getStore() {
    // Return a proxy object that mimics the old store interface
    return {
      subscribe: (callback: (state: any) => void) => {
        // Create initial state
        const getState = () => ({
          sessions: this.sessions,
          activeSessionId: this.activeAgentId,
          lastAccessOrder: Array.from(this.agents.keys()).sort((a, b) => {
            const stateA = this.agents.get(a);
            const stateB = this.agents.get(b);
            return (stateB?.lastAccess || 0) - (stateA?.lastAccess || 0);
          }),
        });

        // Call immediately with current state
        callback(getState());

        // Set up listener for state changes
        const listener = () => callback(getState());
        const unsubscribe = this.addListener(listener);

        return unsubscribe;
      },
      // Add set and update methods for Writable compatibility
      set: (value: any) => {
        // Handle setting the entire state
        if (value && typeof value === 'object') {
          if (value.sessions) {
            // Clear existing and add new sessions
            this.clearAll();
            for (const session of value.sessions) {
              this.addSession(session);
            }
          }
          if (value.activeSessionId) {
            this.setActiveAgent(value.activeSessionId);
          }
        }
      },
      update: (updater: (state: any) => any) => {
        // Handle updating the state
        const currentState = {
          sessions: this.sessions,
          activeSessionId: this.activeAgentId,
          lastAccessOrder: Array.from(this.agents.keys()),
        };
        const newState = updater(currentState);
        if (newState && typeof newState === 'object') {
          if (newState.sessions) {
            // Clear existing and add new sessions
            this.clearAll();
            for (const session of newState.sessions) {
              this.addSession(session);
            }
          }
          if (newState.activeSessionId) {
            this.setActiveAgent(newState.activeSessionId);
          }
        }
      },
    };
  }

  /**
   * Update session (compatibility method)
   */
  updateSession(agentId: string, updates: Partial<AgentSession>): void {
    const state = this.getAgent(agentId);
    if (!state) {
      logger.warn('Cannot update non-existent session', { agentId });
      return;
    }

    Object.assign(state.session, updates);
    state.session.updatedAt = new Date();
    state.lastAccess = Date.now();

    logger.debug('Session updated', { agentId, updates: Object.keys(updates) });
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

// Create and export singleton instance
export const agentState = new ConsolidatedAgentState();

// Also export as sessionStore for backward compatibility
export const sessionStore = agentState;

// Export for debugging in browser console
if (typeof window !== 'undefined') {
  (window as any).__consolidatedAgentState = agentState;
  (window as any).__agentState = agentState; // Legacy alias
  (window as any).__sessionStore = agentState; // Legacy alias
}
