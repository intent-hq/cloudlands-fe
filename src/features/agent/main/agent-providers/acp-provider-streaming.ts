/**
 * ACP Provider Streaming Module
 *
 * Refactored streaming logic using the new services for better reliability.
 * This module handles all streaming-related functionality for the ACP provider.
 */

import { Logger } from '../../../../shared/logger';
import { unifiedIdService } from '$shared/services/unified-id.service';
import { EventEmitter } from '$shared/utils/event-emitter';
import { messageAccumulator } from '../../services/message-accumulator.service';
import type { ContentBlock } from '../../../../shared/types';
import { changeDetectorManager } from '../../../workspace/main/change-detector-manager';
import { getAttributionEngine } from '../../../workspace/main/provenance/attribution-engine';
import { readFile } from 'fs/promises';
import { join, isAbsolute } from 'path';
import { AGENT_STREAMING_CONFIG } from '$shared/constants/agent-streaming';
import * as Diff from 'diff';
import { getWorkspaceEventService } from '../../../events/main';
import { consumeMcpToolParams } from '../../../../shared/services/mcp-tool-params-cache';
import { sendToWorkspaceWindows } from '../../../system/main/system.ipc';

const logger = new Logger('ACPProviderStreaming');

/**
 * Patterns that match common dev server commands.
 * When an agent runs one of these via launch-process, we append a soft hint
 * suggesting the scripts system instead.
 */
const DEV_SERVER_PATTERNS: RegExp[] = [
  /\b(npm|yarn|pnpm)\s+run\s+(dev|start|serve)\b/,
  /\b(npm|yarn|pnpm)\s+(start|dev)\b/,
  /\bnpx\s+(vite|next|nuxt|remix)\b/,
  /\bnode\s+.*server/,
  /\bpython\s+.*manage\.py\s+runserver/,
  /\bcargo\s+run/,
  /\bgo\s+run/,
];

const DEV_SERVER_HINT =
  '\n\nHint: This looks like a dev server command. Consider using `create_script` + `run_script` MCP tools instead for better process management, auto-restart, and URL detection.';

/**
 * Check if a command looks like a dev server command and return the hint if so.
 * Returns empty string if no match.
 */
function getDevServerHint(command: string | undefined): string {
  if (!command || typeof command !== 'string') return '';
  return DEV_SERVER_PATTERNS.some((pattern) => pattern.test(command)) ? DEV_SERVER_HINT : '';
}

// Track tool kinds for pending tool calls to know when file edits complete
// Key: toolId, Value: { kind: string, agentId: string, timestamp: number }
interface PendingToolKind {
  kind: string;
  agentId: string;
  timestamp: number;
}
const pendingToolKinds = new Map<string, PendingToolKind>();

// Track pending file edit tool calls for attribution
interface PendingFileEdit {
  toolId: string;
  toolName: string;
  filePath: string;
  content?: string; // For save-file, we have the content immediately
  agentId: string;
  agentName?: string;
  sessionId?: string;
  workspacePath?: string;
  workspaceId?: string;
  timestamp: number; // For TTL-based cleanup
  oldContent?: string; // Content before the edit, for diff generation
}
const pendingFileEdits = new Map<string, PendingFileEdit>();

// TTL for pending tool state (5 minutes)
const PENDING_TOOL_TTL_MS = 5 * 60 * 1000;

// Cache for note titles to avoid repeated lookups during a session
const noteTitleCache = new Map<string, string>();

/**
 * Clean up pending tool state for a specific agent
 * Called when a stream completes or errors
 */
function cleanupPendingToolState(agentId: string): void {
  // Clean up pendingToolKinds for this agent
  for (const [toolId, entry] of pendingToolKinds.entries()) {
    if (entry.agentId === agentId) {
      pendingToolKinds.delete(toolId);
    }
  }

  // Clean up pendingFileEdits for this agent
  for (const [toolId, entry] of pendingFileEdits.entries()) {
    if (entry.agentId === agentId) {
      pendingFileEdits.delete(toolId);
    }
  }
}

/**
 * Clean up stale pending tool state based on TTL
 * Called periodically to prevent memory leaks from orphaned entries
 */
function cleanupStalePendingToolState(): void {
  const now = Date.now();

  // Clean up stale pendingToolKinds
  for (const [toolId, entry] of pendingToolKinds.entries()) {
    if (now - entry.timestamp > PENDING_TOOL_TTL_MS) {
      logger.debug('Cleaning up stale pendingToolKind', { toolId, agentId: entry.agentId });
      pendingToolKinds.delete(toolId);
    }
  }

  // Clean up stale pendingFileEdits
  for (const [toolId, entry] of pendingFileEdits.entries()) {
    if (now - entry.timestamp > PENDING_TOOL_TTL_MS) {
      logger.debug('Cleaning up stale pendingFileEdit', { toolId, agentId: entry.agentId });
      pendingFileEdits.delete(toolId);
    }
  }
}

// Run stale cleanup every minute
// NOTE: This interval runs for the lifetime of the main process (intentional).
// It cleans up stale pending tool state to prevent memory leaks from abandoned operations.
// The interval itself is lightweight (just iterating Maps) and the Maps are bounded by TTL.
let cleanupIntervalId: NodeJS.Timeout | null = null;

function startCleanupInterval(): void {
  if (cleanupIntervalId === null) {
    cleanupIntervalId = setInterval(cleanupStalePendingToolState, 60 * 1000);
  }
}

/**
 * Stop the cleanup interval (for testing or graceful shutdown)
 */
export function stopCleanupInterval(): void {
  if (cleanupIntervalId !== null) {
    clearInterval(cleanupIntervalId);
    cleanupIntervalId = null;
  }
}

// Start cleanup interval on module load
startCleanupInterval();

// File-editing tool names that we need to track for attribution
const FILE_EDIT_TOOLS = new Set([
  'save-file',
  'save_file',
  'str-replace-editor',
  'str_replace_editor',
  'apply_patch',
  'write_file',
  'create_file',
]);

export interface StreamingOptions {
  workspaceId: string;
  workspacePath?: string; // Path to the git worktree for file operations
  frontendSessionId?: string;
  onChunk?: (chunk: string) => void;
  onContentBlocks?: (blocks: ContentBlock[]) => void;
  onComplete?: (message: any) => void;
  onError?: (error: Error) => void;
  onCleanup?: (sessionId: string) => void; // Called before cleanup to allow parent to clean up its own state
}

/**
 * StreamUpdate matches what agents actually send.
 *
 * NOTE: There are two format variations we need to support:
 * 1. Auggie sends: { update: { sessionUpdate: "agent_message_chunk", ... } }
 * 2. ACP spec says: { sessionUpdate: { type: "agent_message_chunk", ... } }
 *
 * Within the update object itself, the update type is identified by:
 * - Auggie: sessionUpdate property (e.g., sessionUpdate: "agent_message_chunk")
 * - OpenCode (ACP spec): type property (e.g., type: "agent_message_chunk")
 */
export interface StreamUpdate {
  sessionId: string;
  // Auggie sends 'update' but ACP spec says 'sessionUpdate' - support both
  update?: {
    // Auggie uses 'sessionUpdate', OpenCode/ACP spec uses 'type'
    sessionUpdate?: string;
    type?: string;
    content?: any;
    stopReason?: string;
    // Tool call fields
    toolCallId?: string;
    title?: string;
    name?: string;
    kind?: string;
    status?: string;
    rawInput?: any;
    rawOutput?: any;
  };
  sessionUpdate?: {
    // Auggie uses 'sessionUpdate', OpenCode/ACP spec uses 'type'
    sessionUpdate?: string;
    type?: string;
    content?: any;
    stopReason?: string;
    // Tool call fields
    toolCallId?: string;
    title?: string;
    name?: string;
    kind?: string;
    status?: string;
    rawInput?: any;
    rawOutput?: any;
  };
}

/**
 * Simple backend streaming manager for ACP provider
 */
class BackendStreamManager extends EventEmitter {
  private static instance: BackendStreamManager;
  private sessions = new Map<string, any>();
  private callbacks = new Map<string, StreamingOptions>();

  static getInstance(): BackendStreamManager {
    if (!BackendStreamManager.instance) {
      BackendStreamManager.instance = new BackendStreamManager();
    }
    return BackendStreamManager.instance;
  }

  /**
   * Start a new backend streaming session
   *
   * Uses agentId as the canonical key (consistent with frontend StreamManager).
   * Since only ONE stream per agent is allowed at a time (enforced by cleanup),
   * we use agentId directly as the session key.
   *
   * Returns agentId as the stream identifier.
   */
  startStream(config: any, callbacks: StreamingOptions): string {
    if (!config.agentId) {
      logger.error('startStream called without agentId - this is required');
      throw new Error('agentId is required for startStream');
    }

    // Generate internal streamId for logging/metadata (not used as primary key)
    // IMPORTANT: Use generateMessageId() to ensure the ID starts with 'msg_' for Zod validation
    const streamId = unifiedIdService.generateMessageId();

    // Clean up any existing session for this agent BEFORE creating a new one
    // This prevents callback/session accumulation across multiple messages
    const existingSession = this.sessions.get(config.agentId);
    if (existingSession) {
      logger.debug('Cleaning up existing session before starting new stream', {
        agentId: config.agentId,
      });
      this.sessions.delete(config.agentId);
      this.callbacks.delete(config.agentId);
    }

    const session = {
      streamId, // Keep for logging/metadata purposes
      ...config,
      startTime: Date.now(),
      lastActivity: Date.now(),
      contentBlocks: [],
      healthStatus: 'healthy',
      sessionId: config.sessionId,
      agentId: config.agentId,
      frontendSessionId: config.frontendSessionId,
    };

    // Store session by agentId only (canonical key)
    this.sessions.set(config.agentId, session);

    // Store callbacks by agentId only
    this.callbacks.set(config.agentId, callbacks);

    // INFO-level log to trace streaming issues
    logger.info('[BackendStreamManager] Started backend stream', {
      agentId: config.agentId,
      sessionId: config.sessionId,
      frontendSessionId: config.frontendSessionId,
      streamId, // For logging only
      totalSessions: this.sessions.size,
      totalCallbacks: this.callbacks.size,
      hasOnChunk: !!callbacks?.onChunk,
      hasOnComplete: !!callbacks?.onComplete,
      hasOnContentBlocks: !!callbacks?.onContentBlocks,
    });

    // Return agentId as the stream identifier (canonical key)
    return config.agentId;
  }

  /**
   * Get session by ID (agentId is the canonical key)
   *
   * Performs direct lookup by id (expected to be agentId).
   * For backward compatibility, also searches by sessionId or streamId.
   */
  getSession(id: string): any {
    // Direct lookup by id (agentId is expected)
    const session = this.sessions.get(id);
    if (session) {
      // Only log at debug level to avoid excessive logging during streaming
      logger.debug('[BackendStreamManager] getSession - direct lookup found', { id });
      return session;
    }

    // Fallback: search by sessionId or streamId for backward compatibility
    for (const s of this.sessions.values()) {
      if (s.sessionId === id || s.streamId === id) {
        // Log fallback at debug level - this is expected behavior
        logger.debug('[BackendStreamManager] getSession - fallback search found', {
          id,
          matchedBy: s.sessionId === id ? 'sessionId' : 'streamId',
        });
        return s;
      }
    }

    // Only log "not found" at debug level - caller will handle appropriately
    logger.debug('[BackendStreamManager] getSession - not found', { id });
    return undefined;
  }

  addTextChunk(id: string, text: string): void {
    const session = this.getSession(id);
    if (!session) {
      logger.warn('[BackendStreamManager] addTextChunk - no session found', {
        id,
        textLength: text.length,
        availableSessions: Array.from(this.sessions.keys()),
      });
      return;
    }

    // Update last activity for stall detection
    session.lastActivity = Date.now();
    session.healthStatus = 'healthy';

    // Get callbacks - use agentId as the canonical key
    const callbacks = this.callbacks.get(session.agentId);

    // Only log at debug level to avoid excessive logging during streaming
    logger.debug('[BackendStreamManager] addTextChunk', {
      id,
      textLength: text.length,
    });

    // Use the agentId as the primary key (canonical key)
    const accumulatorId = session.agentId;

    logger.debug('[BackendStreamManager] addTextChunk called', {
      accumulatorId,
      textLength: text.length,
      sessionId: session.sessionId,
    });

    try {
      // Initialize accumulator if needed
      if (!messageAccumulator.getAccumulated(accumulatorId)) {
        logger.debug('[BackendStreamManager] Starting new accumulation', {
          accumulatorId,
        });
        messageAccumulator.startAccumulation(accumulatorId, {
          sessionId: session.sessionId,
          agentId: session.agentId,
          frontendSessionId: session.frontendSessionId,
        });
      }

      // Add the chunk to the accumulator
      messageAccumulator.addChunk(accumulatorId, text);
      logger.debug('[BackendStreamManager] Successfully added chunk to accumulator', {
        accumulatorId,
        textLength: text.length,
      });
    } catch (error) {
      logger.error('[BackendStreamManager] Error adding chunk to accumulator', {
        accumulatorId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (callbacks?.onChunk) {
      try {
        callbacks.onChunk(text);
      } catch (error) {
        logger.error('[BackendStreamManager] Error calling onChunk callback', {
          id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  addContentBlock(id: string, block: ContentBlock): void {
    const session = this.getSession(id);
    if (session) {
      // Add to message accumulator (single source of truth for content blocks)
      const accumulatorId = session.agentId || id;
      try {
        // Initialize accumulator if needed
        if (!messageAccumulator.getAccumulated(accumulatorId)) {
          messageAccumulator.startAccumulation(accumulatorId, {
            sessionId: session.sessionId,
            agentId: session.agentId,
            frontendSessionId: session.frontendSessionId,
          });
        }
        messageAccumulator.addContentBlock(accumulatorId, block);
      } catch (error) {
        logger.error('[BackendStreamManager] Error adding content block to accumulator', {
          accumulatorId,
          blockType: block.type,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      // Get callbacks - use agentId as the canonical key
      const callbacks = this.callbacks.get(session.agentId);

      // Only log at debug level to reduce log spam
      logger.debug('[BackendStreamManager] addContentBlock', {
        id,
        blockType: block.type,
        callbacksFound: !!callbacks,
      });

      if (callbacks?.onContentBlocks) {
        // IMPORTANT: Send only the new block, not the entire accumulated array
        // This prevents duplication on the frontend
        callbacks.onContentBlocks([block]);
      }
    }
  }

  /**
   * Update an existing content block by ID (e.g., replace a skeleton with a follow-up).
   * If no block with the matching ID is found, falls back to addContentBlock.
   */
  updateContentBlock(id: string, block: ContentBlock): void {
    const session = this.getSession(id);
    if (session) {
      const accumulatorId = session.agentId || id;
      try {
        if (!messageAccumulator.getAccumulated(accumulatorId)) {
          // No accumulator — fall back to add
          this.addContentBlock(id, block);
          return;
        }
        const updated = messageAccumulator.updateContentBlock(accumulatorId, block);
        if (!updated) {
          // Block not found — fall back to add
          this.addContentBlock(id, block);
          return;
        }
      } catch (error) {
        logger.error('[BackendStreamManager] Error updating content block in accumulator', {
          accumulatorId,
          blockType: block.type,
          blockId: block.id,
          error: error instanceof Error ? error.message : String(error),
        });
        // Fall back to add
        this.addContentBlock(id, block);
        return;
      }

      // Get callbacks - use agentId as the canonical key
      const callbacks = this.callbacks.get(session.agentId);

      logger.info('[BackendStreamManager] updateContentBlock', {
        id,
        blockType: block.type,
        blockId: block.id,
      });

      if (callbacks?.onContentBlocks) {
        // Send the updated block — the frontend will need to replace the existing one
        callbacks.onContentBlocks([block]);
      }
    }
  }

  completeStream(id: string, message?: any): void {
    const session = this.getSession(id);
    if (session) {
      // Get callbacks - use agentId as the canonical key
      const callbacks = this.callbacks.get(session.agentId);

      if (callbacks?.onComplete) {
        // Get accumulated content from the message accumulator
        const accumulatorId = session.agentId;
        let finalContent = '';
        let contentBlocks: ContentBlock[] = [];

        try {
          // IMPORTANT: Use getPartialContent which properly builds ordered content blocks
          // that include both text and tool_use blocks in the correct order.
          // getAccumulated().contentBlocks only contains tool_use blocks, NOT text blocks.
          const partial = messageAccumulator.getPartialContent(accumulatorId);
          finalContent = partial.content || '';
          contentBlocks = partial.contentBlocks || [];

          logger.debug('[BackendStreamManager] completeStream got accumulated content', {
            accumulatorId,
            contentLength: finalContent.length,
            contentBlockCount: contentBlocks.length,
            blockTypes: contentBlocks.map((b) => b.type),
            hasTextBlock: contentBlocks.some((b) => b.type === 'text'),
          });
        } catch (error) {
          logger.warn('Could not get accumulated content', { error });
        }

        // Format the final message with all required properties
        // IMPORTANT: Message IDs must start with 'msg_' for Zod validation
        const finalMessage = message || {
          id: session.streamId || `msg_${Date.now()}`,
          role: 'assistant',
          content: finalContent,
          contentBlocks:
            contentBlocks.length > 0
              ? contentBlocks
              : finalContent
                ? [{ type: 'text', text: finalContent }]
                : [],
          timestamp: new Date().toISOString(),
          metadata: {
            stopReason: 'end_turn',
            sessionId: session.sessionId,
            agentId: session.agentId,
          },
        };

        // Ensure the message has an id (must start with 'msg_' for Zod validation)
        if (!finalMessage.id) {
          finalMessage.id = session.streamId || `msg_${Date.now()}`;
        }

        callbacks.onComplete(finalMessage);
      }

      // Call onCleanup callback BEFORE cleaning up BackendStreamManager's own state
      // This allows the parent (ACPProvider) to clean up its streamingCallbacks entry
      // so the subsequent stopReason-based handleStreamCompletion becomes a no-op
      // Pass the actual session identifier the parent uses for its callback map
      if (callbacks?.onCleanup) {
        try {
          callbacks.onCleanup(session.frontendSessionId || session.sessionId);
        } catch (error) {
          logger.error('Error in onCleanup callback', {
            agentId: session.agentId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // Cleanup messageAccumulator for this session
      try {
        messageAccumulator.clear(session.agentId);
        logger.debug('Cleared messageAccumulator on stream complete', {
          agentId: session.agentId,
        });
      } catch (error) {
        logger.warn('Could not clear messageAccumulator', {
          agentId: session.agentId,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      // Cleanup session and callbacks (agentId is the only key now)
      this.sessions.delete(session.agentId);
      this.callbacks.delete(session.agentId);
    }
  }

  handleError(id: string, error: Error): void {
    const session = this.getSession(id);
    if (session) {
      // Get callbacks - use agentId as the canonical key
      const callbacks = this.callbacks.get(session.agentId);
      if (callbacks?.onError) {
        callbacks.onError(error);
      }

      // Cleanup messageAccumulator on error too
      try {
        messageAccumulator.clear(session.agentId);
        logger.debug('Cleared messageAccumulator on stream error', {
          agentId: session.agentId,
        });
      } catch (cleanupError) {
        logger.warn('Could not clear messageAccumulator on error', {
          agentId: session.agentId,
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        });
      }

      // Cleanup session and callbacks
      this.sessions.delete(session.agentId);
      this.callbacks.delete(session.agentId);
    }
  }

  cancelStream(id: string): void {
    this.completeStream(id);
  }

  cleanupAll(): void {
    // Clear messageAccumulator for all sessions first
    for (const session of this.sessions.values()) {
      try {
        messageAccumulator.clear(session.agentId);
      } catch (error) {
        // Ignore errors during cleanup
      }
    }

    // Clear all sessions and callbacks
    this.sessions.clear();
    this.callbacks.clear();
  }
}

const streamSessionManager = BackendStreamManager.getInstance();

// Export for testing purposes
export const testStreamManager = streamSessionManager;

/**
 * Handles streaming for ACP provider with improved reliability
 */
export class ACPProviderStreaming {
  private agentId: string;
  private internalSessionId?: string;
  private frontendSessionId?: string;
  private aliasedSessionIds = new Set<string>(); // Track which session IDs we've already aliased
  // Track cancelled session IDs to reject stale events that arrive after session/cancel
  // but before internalSessionId is updated to the new session.
  private cancelledSessionIds = new Set<string>();
  // Track the last pending tool call ID so we can auto-complete it when a new tool_call arrives.
  // This handles ACP providers (like Codex) that send tool_call events but never send
  // tool_call_update completion events.
  private lastPendingToolId?: string;

  // DUAL TOOL_CALL MERGE: ACP protocol sends two tool_call events per tool invocation:
  // 1st: "skeleton" with tool name/title but empty rawInput
  // 2nd: "follow-up" with the real rawInput parameters
  // We defer the skeleton (don't create a block) and wait for the follow-up to create
  // a single block with full input so the UI classifier can produce detailed display text.
  //
  // TIMEOUT FALLBACK: Providers like OpenCode send a SINGLE tool_call event with no rawInput
  // and no follow-up. A 300ms timer auto-emits the skeleton if no follow-up arrives.
  private pendingSkeleton?: {
    toolName: string;
    toolId: string;
    acpTitle?: string;
  };
  private pendingSkeletonTimer?: ReturnType<typeof setTimeout>;
  private pendingSkeletonSession?: any;

  // Track skeleton tool IDs that were emitted via timeout (before follow-up arrived).
  // When the follow-up arrives later, we update the existing block instead of creating
  // a duplicate. This prevents vague "Search", "Read file" labels from persisting
  // alongside the descriptive follow-up block.
  private emittedSkeletonToolId?: string;

  constructor(agentId: string) {
    this.agentId = agentId;
  }

  /**
   * Emit a deferred skeleton as a tool_use block when no follow-up arrives.
   * Called by the skeleton timer for providers (like OpenCode) that send a single
   * tool_call event with no rawInput and no follow-up.
   */
  private async emitDeferredSkeleton(): Promise<void> {
    if (!this.pendingSkeleton || !this.pendingSkeletonSession) return;

    const skeleton = this.pendingSkeleton;
    const session = this.pendingSkeletonSession;
    this.pendingSkeleton = undefined;
    this.pendingSkeletonSession = undefined;
    this.pendingSkeletonTimer = undefined;

    // Try to enrich the skeleton with actual MCP tool parameters.
    // For providers like OpenCode, the MCP HTTP bridge receives the full tool arguments
    // ~6ms after the skeleton is deferred, well within the 300ms timer window.
    const mcpParams = consumeMcpToolParams(session.agentId, skeleton.toolName);
    const enrichedInput: Record<string, any> = {
      _acpTitle: skeleton.acpTitle || skeleton.toolName,
      ...(mcpParams || {}),
    };

    // Resolve note title for enriched workspace-mcp tools so the UI shows
    // human-readable names instead of raw UUIDs like "01c148a4-..."
    const lookupNoteId = enrichedInput.noteId || enrichedInput.taskNoteId;
    if (lookupNoteId && session?.workspaceId) {
      const noteIdStr = String(lookupNoteId);
      const cachedTitle = noteTitleCache.get(`${session.workspaceId}:${noteIdStr}`);
      if (cachedTitle) {
        enrichedInput._noteTitle = cachedTitle;
      } else {
        try {
          const { notesService } = await import('../../../notes/main/notes.service');
          const noteResult = await notesService.getNote(session.workspaceId as any, noteIdStr as any);
          if (noteResult.ok && noteResult.data?.title) {
            enrichedInput._noteTitle = noteResult.data.title;
            noteTitleCache.set(`${session.workspaceId}:${noteIdStr}`, noteResult.data.title);
          }
        } catch {
          // Silently skip — noteId will be used as fallback in classifier
        }
      }
    }

    // Create the tool_use block with the skeleton's tool name.
    // The classifier's cleanToolName() will strip workspace-mcp_ prefixes/suffixes.
    const toolUseBlock: ContentBlock = {
      type: 'tool_use',
      id: skeleton.toolId,
      name: skeleton.toolName,
      input: enrichedInput,
    };
    streamSessionManager.addContentBlock(session.agentId, toolUseBlock);

    // Track as pending so we can auto-complete when the next tool_call or stream completion arrives
    this.lastPendingToolId = skeleton.toolId;

    // Track that this skeleton was emitted so the follow-up can update it
    this.emittedSkeletonToolId = skeleton.toolId;

    logger.info(
      `[ACPProviderStreaming] Emitted deferred skeleton (no follow-up within timeout): "${skeleton.toolName}" id=${skeleton.toolId} enriched=${!!mcpParams}${mcpParams ? ` keys=[${Object.keys(mcpParams).join(',')}]` : ''} noteTitle=${enrichedInput._noteTitle || 'none'}`,
    );
  }

  /**
   * Clear the pending skeleton timer if active.
   */
  private clearSkeletonTimer(): void {
    if (this.pendingSkeletonTimer) {
      clearTimeout(this.pendingSkeletonTimer);
      this.pendingSkeletonTimer = undefined;
    }
  }

  /**
   * Set the internal session ID
   */
  setInternalSessionId(sessionId: string): void {
    this.internalSessionId = sessionId;
    // Safety: ensure the new active session isn't blocked by a stale cancel entry.
    // This is normally a no-op (UUIDs don't collide) but prevents a theoretical issue
    // if a provider ever reuses session IDs.
    this.cancelledSessionIds.delete(sessionId);
  }

  /**
   * Check if a session ID has been cancelled.
   */
  isSessionCancelled(sessionId: string): boolean {
    return this.cancelledSessionIds.has(sessionId);
  }

  /**
   * Mark a session ID as cancelled so that stale events from it are rejected.
   * This must be called BEFORE createSession() to close the race window where
   * internalSessionId still holds the old value during the async session creation.
   */
  markSessionCancelled(sessionId: string): void {
    this.cancelledSessionIds.add(sessionId);
    logger.debug('[ACPProviderStreaming] Marked session as cancelled', {
      sessionId,
      cancelledCount: this.cancelledSessionIds.size,
    });
    // Cap the set size to prevent unbounded growth — keep only the last 20
    if (this.cancelledSessionIds.size > 20) {
      const first = this.cancelledSessionIds.values().next().value;
      if (first) this.cancelledSessionIds.delete(first);
    }
  }

  /**
   * Start a streaming session
   */
  startStreaming(options: StreamingOptions): void {
    if (!this.internalSessionId) {
      throw new Error('No internal session ID set');
    }

    // Clear stale tool/skeleton state from the previous session.
    // Without this, a pending skeleton timer from a cancelled session could fire and
    // inject a stale tool_use block into the new session's BackendStreamManager data.
    // Similarly, lastPendingToolId from the old session could cause the first tool_call
    // in the new session to auto-complete a stale tool_use_id.
    this.clearSkeletonTimer();
    this.pendingSkeleton = undefined;
    this.pendingSkeletonSession = undefined;
    this.lastPendingToolId = undefined;
    this.emittedSkeletonToolId = undefined;

    // Store frontend session ID if provided
    this.frontendSessionId = options.frontendSessionId;

    // Start stream with StreamManager
    streamSessionManager.startStream(
      {
        agentId: this.agentId,
        sessionId: this.internalSessionId,
        workspaceId: options.workspaceId,
        workspacePath: options.workspacePath, // Path to git worktree for file operations
        frontendSessionId: options.frontendSessionId,
      },
      options,
    );

    // NOTE: Do NOT initialize accumulator here - the backend handles all accumulation
    // The backend starts accumulation in streamMessage

    logger.debug('Started streaming session', {
      agentId: this.agentId,
      internalSessionId: this.internalSessionId,
      frontendSessionId: this.frontendSessionId,
    });
  }

  /**
   * Handle a session update from the agent
   * NOTE: Auggie sends 'update' but ACP protocol spec says 'sessionUpdate' - support both
   */
  async handleSessionUpdate(params: StreamUpdate): Promise<void> {
    // Auggie sends 'update' but ACP spec says 'sessionUpdate' - normalize to 'update'
    const update = params?.update || params?.sessionUpdate;

    if (!update) {
      logger.warn('Received invalid session update - missing update/sessionUpdate property', {
        hasParams: !!params,
        paramKeys: params ? Object.keys(params) : [],
      });
      return;
    }

    const { sessionId } = params;
    // CRITICAL: Support both Auggie's format and the official ACP protocol format.
    // - Auggie sends: { sessionUpdate: "agent_message_chunk", content: {...} }
    // - ACP spec says: { type: "agent_message_chunk", content: {...} }
    // We normalize to 'updateType' for internal use.
    const updateType = update.sessionUpdate || update.type;

    // Use debug for frequent update events, info only for lifecycle events
    logger.debug('[ACPProviderStreaming] handleSessionUpdate called', {
      sessionId,
      updateType,
      hasContent: !!update.content,
    });

    // CRITICAL FIX FOR DOUBLE-STREAMING / INTERLEAVING:
    // When an error occurs (like "agent.name undefined"), the old session may still
    // be sending chunks while we've already created a new session for the retry.
    // We MUST ignore chunks from old sessions to prevent double-streaming.
    // The sessionId in params is the provider's session ID (e.g., "ses_XXXX").
    // If it doesn't match our current internalSessionId, it's from an old session.
    //
    // Also check cancelledSessionIds: after session/cancel is sent but before
    // createSession() completes, internalSessionId still holds the OLD value.
    // Without the cancelledSessionIds check, stale chunks pass through because
    // sessionId === internalSessionId (both are the old ID), causing interleaved text.
    if (sessionId && this.cancelledSessionIds.has(sessionId)) {
      logger.debug('[ACPProviderStreaming] Ignoring chunk from cancelled session', {
        incomingSessionId: sessionId,
        currentSessionId: this.internalSessionId,
        updateType,
      });
      return;
    }
    if (sessionId && this.internalSessionId && sessionId !== this.internalSessionId) {
      logger.debug('[ACPProviderStreaming] Ignoring chunk from old session', {
        incomingSessionId: sessionId,
        currentSessionId: this.internalSessionId,
        updateType,
      });
      return;
    }

    // CRITICAL: Create an alias for the backend session ID immediately
    // The backend (auggie) sends its own session ID which is different from our agent ID
    // The accumulator was created with the agent ID by the caller
    // We must create the alias BEFORE processing any chunks to avoid "No accumulator found" errors
    if (
      sessionId &&
      this.agentId &&
      sessionId !== this.agentId &&
      !this.aliasedSessionIds.has(sessionId)
    ) {
      // Mark this session ID as processed to avoid duplicate logging
      this.aliasedSessionIds.add(sessionId);

      logger.debug('Tracking auggie session ID', {
        auggieSessionId: sessionId,
        agentId: this.agentId,
        frontendSessionId: this.frontendSessionId,
      });
    }

    // Get session to find callbacks
    // Try multiple IDs since the session could be registered under any of them
    const session =
      streamSessionManager.getSession(sessionId) ||
      streamSessionManager.getSession(this.internalSessionId || '') ||
      streamSessionManager.getSession(this.agentId || '') ||
      streamSessionManager.getSession(this.frontendSessionId || '');

    if (!session) {
      logger.warn('[ACPProviderStreaming] No session found for update', {
        sessionId,
        agentId: this.agentId,
        frontendSessionId: this.frontendSessionId,
        internalSessionId: this.internalSessionId,
        updateType,
      });
      return;
    }

    if (updateType === 'agent_message_chunk' || updateType === 'agent_message') {
      logger.debug('[ACPProviderStreaming] Found session for update', {
        sessionId,
        sessionAgentId: session.agentId,
        updateType,
      });
    }

    // Only log at debug level to avoid excessive logging during streaming
    logger.debug('[ACPProviderStreaming] Processing session update', {
      updateType,
      agentId: session?.agentId,
    });

    try {
      switch (updateType) {
        case 'agent_message_chunk':
          await this.handleMessageChunk(update.content, session);
          break;

        case 'tool_call':
          await this.handleToolCall(update, session);
          break;

        case 'tool_call_update':
          await this.handleToolCallUpdate(update, session);
          break;

        case 'done':
        case 'agent_message_complete':
          await this.handleComplete(update, session);
          break;

        default:
          logger.debug('Unhandled update type', { updateType });
      }
    } catch (error) {
      logger.error('Error handling session update', {
        updateType,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });

      // Notify stream manager of the error - use agentId as the canonical key
      if (session?.agentId) {
        streamSessionManager.handleError(session.agentId, error as Error);
      }
    }
  }

  /**
   * Handle a message chunk
   */
  private async handleMessageChunk(content: any, session: any): Promise<void> {
    // Only log at debug level to avoid excessive logging during streaming
    logger.debug('[ACPProviderStreaming] handleMessageChunk called', {
      hasContent: !!content,
      agentId: session?.agentId,
    });

    if (!content) {
      logger.debug('[ACPProviderStreaming] handleMessageChunk - no content');
      return;
    }

    let text = '';

    if (typeof content === 'object' && content.type === 'text') {
      text = content.text || '';
    } else if (typeof content === 'string') {
      text = content;
    }

    if (text) {
      // Use agentId as the canonical key
      streamSessionManager.addTextChunk(session.agentId, text);
    }
  }

  private async processPendingFileEdit(
    toolCallId: string,
    status: string,
    isError: boolean,
    session: any,
  ): Promise<void> {
    if (!toolCallId) {
      return;
    }

    const pendingEdit = pendingFileEdits.get(toolCallId);
    pendingFileEdits.delete(toolCallId);

    if (!pendingEdit || status !== 'completed' || isError) {
      return;
    }

    // Check if this is a recognized file edit tool
    // Include 'file-edit' as a fallback for title-based detection (e.g., "Edit path/to/file.ts")
    const isFileEditTool =
      pendingEdit.toolName === 'str-replace-editor' ||
      pendingEdit.toolName === 'str_replace_editor' ||
      pendingEdit.toolName === 'save-file' ||
      pendingEdit.toolName === 'file-edit';

    if (!isFileEditTool) {
      return;
    }

    // Read the file to get the final content after the edit
    try {
      const fullPath =
        pendingEdit.workspacePath && !isAbsolute(pendingEdit.filePath)
          ? join(pendingEdit.workspacePath, pendingEdit.filePath)
          : pendingEdit.filePath;

      const content = await readFile(fullPath, 'utf-8');
      const attributionEngine = getAttributionEngine();

      // Pass workspacePath and workspaceId for path normalization and persistence
      attributionEngine.recordAgentWrite(
        {
          agentId: pendingEdit.agentId,
          agentName: pendingEdit.agentName || pendingEdit.agentId,
          sessionId: pendingEdit.sessionId,
        },
        fullPath,
        content,
        pendingEdit.workspacePath,
        pendingEdit.workspaceId,
      );

      logger.info('Recorded agent write for file edit tool', {
        toolName: pendingEdit.toolName,
        agentId: pendingEdit.agentId,
        sessionAgentId: session?.agentId,
        filePath: fullPath,
        workspacePath: pendingEdit.workspacePath,
        workspaceId: pendingEdit.workspaceId,
        contentLength: content.length,
      });

      // Emit file:content-changed event to renderer so open editors refresh content
      // This ensures files open in panels update immediately when agents edit them
      if (pendingEdit.workspaceId) {
        try {
          sendToWorkspaceWindows(
            pendingEdit.workspaceId,
            `file:content-changed:${pendingEdit.workspaceId}`,
            {
              path: fullPath,
              relativePath: pendingEdit.filePath,
              content,
              source: 'agent',
              workspaceId: pendingEdit.workspaceId,
            },
          );

          // Also emit file-tracking:agent-file-changed for components that listen to that
          sendToWorkspaceWindows(
            pendingEdit.workspaceId,
            'file-tracking:agent-file-changed',
            {
              workspaceId: pendingEdit.workspaceId,
              filePath: pendingEdit.filePath,
              source: 'agent',
            },
          );

          logger.debug('Emitted file content change events to renderer for agent edit', {
            filePath: pendingEdit.filePath,
            workspaceId: pendingEdit.workspaceId,
          });
        } catch (emitError) {
          logger.warn('Failed to emit file content change events', {
            error: emitError instanceof Error ? emitError.message : String(emitError),
            filePath: pendingEdit.filePath,
          });
        }
      }

      // Emit file:changed event to activity log with diff data
      if (pendingEdit.workspaceId) {
        try {
          const oldContent = pendingEdit.oldContent ?? '';
          const patch = Diff.createPatch(pendingEdit.filePath, oldContent, content, '', '', {
            context: 3,
          });

          // Count additions and deletions from the patch
          let additions = 0;
          let deletions = 0;
          for (const line of patch.split('\n')) {
            if (line.startsWith('@@') || line.startsWith('---') || line.startsWith('+++'))
              continue;
            if (line.startsWith('+')) additions++;
            else if (line.startsWith('-')) deletions++;
          }

          const action = oldContent === '' ? 'create' : 'modify';
          const eventService = getWorkspaceEventService(pendingEdit.workspaceId);
          eventService.emitFileChange(pendingEdit.filePath, action, {
            diff: patch,
            additions,
            deletions,
            actor: {
              type: 'agent',
              id: pendingEdit.agentId,
              name: pendingEdit.agentName || 'Agent',
            },
          });

          logger.info('Emitted file:changed event with diff to activity log', {
            filePath: pendingEdit.filePath,
            action,
            additions,
            deletions,
            workspaceId: pendingEdit.workspaceId,
          });
        } catch (diffError) {
          logger.warn('Failed to emit file change event with diff', {
            error: diffError instanceof Error ? diffError.message : String(diffError),
            filePath: pendingEdit.filePath,
          });
        }
      }
    } catch (error) {
      logger.warn('Failed to record agent write for file edit tool', {
        toolName: pendingEdit.toolName,
        sessionAgentId: session?.agentId,
        error: error instanceof Error ? error.message : String(error),
        filePath: pendingEdit.filePath,
      });
    }
  }

  /**
   * Handle a tool call
   */
  private async handleToolCall(update: any, session: any): Promise<void> {
    logger.info('[ACPProviderStreaming] handleToolCall invoked', {
      updateType: update?.sessionUpdate,
      hasContent: !!update?.content,
      title: update?.title,
      hasName: !!update?.name,
      hasStatus: !!update?.status,
      agentId: session?.agentId,
      rawInputKeys: update?.rawInput && typeof update.rawInput === 'object' ? Object.keys(update.rawInput) : 'none',
      rawInputPath: (update?.rawInput as any)?.path || 'none',
      locationsCount: Array.isArray(update?.locations) ? update.locations.length : 0,
    });

    // DUAL TOOL_CALL MERGE: Detect whether this is a skeleton (no real rawInput) or
    // a follow-up with real parameters. Skeletons are deferred; follow-ups create the block.
    const rawInputFromUpdate = update?.rawInput || update?.input;

    // Defensive: if rawInput is a JSON string (e.g., from transports that stringify), parse it
    let parsedRawInput = rawInputFromUpdate;
    if (typeof rawInputFromUpdate === 'string' && rawInputFromUpdate.length > 0) {
      try {
        const parsed = JSON.parse(rawInputFromUpdate);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          parsedRawInput = parsed;
        }
      } catch {
        // Not valid JSON, leave as-is (will be treated as skeleton)
      }
    }

    const hasRealInput =
      parsedRawInput &&
      typeof parsedRawInput === 'object' &&
      !Array.isArray(parsedRawInput) &&
      Object.keys(parsedRawInput).length > 0;

    if (!hasRealInput) {
      // Skeleton call (no real input) — auto-complete the previous REAL tool, then defer.
      if (this.lastPendingToolId) {
        const completedToolId = this.lastPendingToolId;
        const syntheticResult: ContentBlock = {
          type: 'tool_result',
          tool_use_id: completedToolId,
          content: '',
          is_error: false,
        };
        streamSessionManager.addContentBlock(session.agentId, syntheticResult);
        await this.processPendingFileEdit(completedToolId, 'completed', false, session);
        logger.debug('[ACPProviderStreaming] Auto-completed previous tool on skeleton tool_call', {
          previousToolId: completedToolId,
          agentId: session.agentId,
        });
        this.lastPendingToolId = undefined;
      }

      // Clear any existing skeleton timer (e.g., if previous skeleton is being replaced)
      this.clearSkeletonTimer();
      // If there was a previous skeleton that never got a follow-up, emit it now
      // (this handles the case where multiple skeletons arrive in sequence, e.g. OpenCode)
      if (this.pendingSkeleton && this.pendingSkeletonSession) {
        await this.emitDeferredSkeleton();
      }

      // Store skeleton info — the follow-up call with real input will create the block
      const skeletonToolId =
        update?.toolCallId || update?.id || `tool_${Date.now()}`;
      const skeletonTitle = update?.title || update?.name || 'unknown';
      this.pendingSkeleton = {
        toolName: update?.name || update?.title || 'unknown',
        toolId: skeletonToolId,
        acpTitle: skeletonTitle,
      };
      this.pendingSkeletonSession = session;

      // TIMEOUT FALLBACK: Providers like OpenCode send a single tool_call event
      // with no rawInput and no follow-up. If no follow-up arrives within 300ms,
      // emit the skeleton directly so tool calls appear in the UI.
      // For Claude Code, the follow-up arrives within milliseconds, so this timer
      // is always cancelled before it fires.
      this.pendingSkeletonTimer = setTimeout(async () => {
        await this.emitDeferredSkeleton();
      }, 300);

      logger.info(
        `[ACPProviderStreaming] Deferring skeleton tool_call (no rawInput): "${this.pendingSkeleton.toolName}" id=${skeletonToolId}`,
      );
      return;
    }

    // If we have a pending skeleton, this is the follow-up with real input.
    // Discard the skeleton and proceed to create a single block with full input.
    let isFollowUpForEmittedSkeleton = false;
    if (this.pendingSkeleton) {
      this.clearSkeletonTimer();
      logger.info(
        `[ACPProviderStreaming] Merging follow-up with skeleton: skeleton="${this.pendingSkeleton.toolName}" follow-up="${update?.title || update?.name}"`,
      );
      this.pendingSkeleton = undefined;
      this.pendingSkeletonSession = undefined;
      // No auto-complete needed — the skeleton was never created as a block
    } else if (this.emittedSkeletonToolId) {
      // The skeleton was already emitted via timeout before this follow-up arrived.
      // We need to UPDATE the existing skeleton block instead of creating a duplicate.
      const followUpToolId = update?.toolCallId || update?.id;
      if (followUpToolId === this.emittedSkeletonToolId) {
        isFollowUpForEmittedSkeleton = true;
        this.emittedSkeletonToolId = undefined;
        logger.info(
          `[ACPProviderStreaming] Follow-up arrived for already-emitted skeleton: id=${followUpToolId} follow-up="${update?.title || update?.name}"`,
        );
      } else {
        // Different tool ID — this is a new tool, not a follow-up
        this.emittedSkeletonToolId = undefined;
        // Normal tool_call — auto-complete previous tool
        if (this.lastPendingToolId) {
          const completedToolId = this.lastPendingToolId;
          const syntheticResult: ContentBlock = {
            type: 'tool_result',
            tool_use_id: completedToolId,
            content: '',
            is_error: false,
          };
          streamSessionManager.addContentBlock(session.agentId, syntheticResult);
          await this.processPendingFileEdit(completedToolId, 'completed', false, session);
          logger.debug('[ACPProviderStreaming] Auto-completed previous tool on new tool_call', {
            previousToolId: completedToolId,
            agentId: session.agentId,
          });
          this.lastPendingToolId = undefined;
        }
      }
    } else {
      // Normal tool_call (not a follow-up) — auto-complete previous tool
      if (this.lastPendingToolId) {
        const completedToolId = this.lastPendingToolId;
        const syntheticResult: ContentBlock = {
          type: 'tool_result',
          tool_use_id: completedToolId,
          content: '',
          is_error: false,
        };
        streamSessionManager.addContentBlock(session.agentId, syntheticResult);
        await this.processPendingFileEdit(completedToolId, 'completed', false, session);
        logger.debug('[ACPProviderStreaming] Auto-completed previous tool on new tool_call', {
          previousToolId: completedToolId,
          agentId: session.agentId,
        });
        this.lastPendingToolId = undefined;
      }
    }

    // The backend sends the tool information in different ways:
    // 1. In the content object (for tests)
    // 2. In the title/name field directly (for production)
    let toolName = 'unknown';
    let toolTitle = 'unknown';
    let toolInput = {};
    let toolId = `tool_${Date.now()}`;

    if (update?.content && typeof update.content === 'object' && !Array.isArray(update.content)) {
      // Test format: tool info is in content (object, not array)
      toolName = update.content.name || update.content.title || 'unknown';
      toolTitle = update.content.title || update.content.name || 'unknown';
      toolInput = update.content.input || update.content.rawInput || {};
      toolId = update.content.id || update.content.toolCallId || toolId;
    } else {
      // Production format: tool info is in update directly
      toolName = update?.name || update?.title || 'unknown';
      toolTitle = update?.title || update?.name || 'unknown';
      toolInput = update?.rawInput || update?.input || {};
      toolId = update?.toolCallId || update?.id || toolId;
    }

    // Safety: if toolInput is a JSON string (can happen with some transports), parse it
    if (typeof toolInput === 'string') {
      try {
        toolInput = JSON.parse(toolInput);
      } catch {
        toolInput = {};
      }
    }

    // Ensure toolInput is always an object
    if (!toolInput || typeof toolInput !== 'object' || Array.isArray(toolInput)) {
      toolInput = {};
    }

    // Codex format detection: Codex sends tool calls with nested arguments:
    //   { arguments: { noteId: "spec", ... }, server: "workspace-mcp", tool: "read_note" }
    // Unwrap to top level so all downstream logic (derivation, note title lookup, classifier) works.
    const codexInput = toolInput as Record<string, any>;
    let isCodexWorkspaceMcp = false;
    let codexResolvedToolName = '';
    if (
      codexInput.arguments &&
      typeof codexInput.arguments === 'object' &&
      !Array.isArray(codexInput.arguments) &&
      typeof codexInput.tool === 'string' &&
      typeof codexInput.server === 'string'
    ) {
      const codexToolName = codexInput.tool;
      const codexServer = codexInput.server;

      // Track Codex workspace-mcp tools so we can proactively fetch results later
      // (Codex never sends tool_call_update events, so read-only tools would show "Completed")
      isCodexWorkspaceMcp = codexServer === 'workspace-mcp';
      codexResolvedToolName = codexToolName;

      // Unwrap arguments to top level (preserve _acpTitle if already set)
      const preservedAcpTitle = codexInput._acpTitle;
      toolInput = { ...codexInput.arguments };
      if (preservedAcpTitle) {
        (toolInput as Record<string, any>)._acpTitle = preservedAcpTitle;
      }

      // Set toolName to server_tool format (e.g., "workspace-mcp_read_note")
      // so the derivation logic and classifier routing work correctly
      toolName = `${codexServer}_${codexToolName}`;

      logger.info(
        `[ACPProviderStreaming] Codex format detected: unwrapped arguments for tool="${codexToolName}" server="${codexServer}" -> toolName="${toolName}" argKeys=[${Object.keys(codexInput.arguments).join(',')}]`,
      );
    }

    // If tool name is still 'unknown', try to extract from toolId
    if (toolName === 'unknown' && toolId) {
      // Try to extract tool name from toolId if it follows a pattern
      // e.g., "tool_read_file_123" -> "read_file"
      if (toolId.startsWith('tool_')) {
        const parts = toolId.split('_');
        if (parts.length > 2) {
          // Remove 'tool' prefix and last part (usually ID)
          const extracted = parts.slice(1, -1).join('_');
          if (extracted) {
            toolName = extracted;
          }
        }
      }
    }

    // IMPORTANT: The ACP protocol sends a human-readable "title" (e.g., "Read", "Edit file.ts")
    // but the UI classifier needs the actual tool name (e.g., "str-replace-editor", "view")
    // to correctly classify and display tool calls. We derive the actual tool name from the
    // input parameters which are more reliable.
    const input = toolInput as Record<string, any>;
    let actualToolName = toolName;

    // Derive actual tool name from input parameters when the title is misleading.
    // We only override for specific, unambiguous input patterns to avoid false positives.
    // The classifier (tool-classifier.ts) also uses input parameters as a fallback,
    // so we focus on the most critical cases here.
    if (input.command === 'str_replace' || input.command === 'insert' || input.command === 'create') {
      // str-replace-editor is the only tool with command='str_replace' or 'insert'
      actualToolName = 'str-replace-editor';
    } else if (
      input.file_content !== undefined &&
      input.path &&
      input.instructions_reminder !== undefined
    ) {
      // save-file has file_content, path, AND instructions_reminder (unique combination)
      actualToolName = 'save-file';
    } else if (input.path && input.view_range !== undefined) {
      // view tool with explicit line range - unambiguous
      actualToolName = 'view';
    } else if (input.information_request !== undefined) {
      // Both codebase-retrieval and conversation-retrieval use information_request.
      // Distinguish by checking the ACP title for "conversation".
      if (typeof toolName === 'string' && toolName.toLowerCase().includes('conversation')) {
        actualToolName = 'conversation-retrieval';
      } else {
        actualToolName = 'codebase-retrieval';
      }
    } else if (input.file_paths !== undefined && Array.isArray(input.file_paths)) {
      // remove-files is the only tool with file_paths array parameter
      actualToolName = 'remove-files';
    } else if (typeof input.input === 'string' && input.input.includes('*** Begin Patch')) {
      // apply_patch sends V4A patch content in input.input
      actualToolName = 'apply_patch';
    }
    // Workspace MCP tool name derivation:
    // When the ACP title is vague (e.g., "Read note", "Edit", "Replace note"),
    // derive the actual workspace tool name from input parameters so the UI
    // classifier can produce detailed display text.
    // ORDER MATTERS: more specific parameter combinations must come first.
    else if (input.noteId !== undefined && input.old_text !== undefined && input.new_text !== undefined) {
      // edit_note: has noteId + old_text + new_text
      actualToolName = 'workspace-mcp_edit_note';
    } else if (input.noteId !== undefined && input.start_line !== undefined && input.new_content !== undefined) {
      // edit_note_lines: has noteId + start_line + new_content
      actualToolName = 'workspace-mcp_edit_note_lines';
    } else if (input.noteId !== undefined && input.content !== undefined && input.confirm_replacement !== undefined) {
      // set_note_content with explicit confirm: has noteId + content + confirm_replacement
      actualToolName = 'workspace-mcp_set_note_content';
    } else if (input.noteId !== undefined && input.heading !== undefined && input.content !== undefined) {
      // add_to_note: has noteId + heading + content (param is 'heading', not 'section_heading')
      actualToolName = 'workspace-mcp_add_to_note';
    } else if (input.noteId !== undefined && input.content !== undefined && !input.old_text && !input.start_line && !input.heading) {
      // set_note_content (without confirm): has noteId + content, but NOT old_text/start_line/heading
      actualToolName = 'workspace-mcp_set_note_content';
    } else if (input.noteId !== undefined && input.lineNumber !== undefined && input.status !== undefined) {
      // update_task: has noteId + lineNumber + status (updates a task line within a note)
      actualToolName = 'workspace-mcp_update_task';
    } else if (input.noteId !== undefined && input.status !== undefined && !input.content && !input.old_text && !input.lineNumber) {
      // update_note_task_status: has noteId + status but NO content/old_text/lineNumber
      actualToolName = 'workspace-mcp_update_note_task_status';
    } else if (input.noteId !== undefined && !input.content && !input.old_text && !input.start_line && !input.status && !input.lineNumber) {
      // read_note: has noteId but NO editing/status params
      actualToolName = 'workspace-mcp_read_note';
    } else if (input.taskNoteId !== undefined && !toolName.includes('get_my_task') && (input.agentInstructions !== undefined || input.specialist !== undefined)) {
      // delegate_task: has taskNoteId + agentInstructions/specialist, but NOT get_my_task
      actualToolName = 'workspace-mcp_delegate_task';
    } else if (input.taskNoteId !== undefined && !input.agentInstructions && !input.specialist) {
      // get_my_task or similar read-only task tool: has taskNoteId but no delegation params
      actualToolName = 'workspace-mcp_get_my_task';
    } else if (input.report !== undefined && !input.path && !input.file_path) {
      // report_to_parent: has report but no file path
      actualToolName = 'workspace-mcp_report_to_parent';
    }
    // Note: We intentionally don't override for:
    // - launch-process: command+cwd could match other terminal tools
    // - web-search: query could match many API tools (Linear, GitHub, etc.)
    // - view without view_range: path+type could match workspace tools
    // The classifier handles these cases using its own input-based detection.

    // When rawInput doesn't have a path, try to extract from ACP protocol fields.
    // The ACP protocol provides alternative sources of file path info:
    // 1. locations[] - file paths being accessed/modified (ToolCallLocation[])
    // 2. content[] - diffs with file paths (ToolCallContent[])
    // 3. title - human-readable title like "Edit file.ts" or "Save path/to/file.ts"
    if (!input.path && !input.file_path) {
      let extractedPath: string | undefined;

      // 1. Try locations (ACP provides file paths being accessed/modified)
      const locations = update?.locations;
      if (Array.isArray(locations) && locations.length > 0 && locations[0]?.path) {
        extractedPath = locations[0].path;
      }

      // 2. Try content diffs (type: 'diff' has a path field)
      if (!extractedPath && Array.isArray(update?.content)) {
        const diff = update.content.find(
          (c: any) => c?.type === 'diff' && typeof c?.path === 'string',
        );
        if (diff) {
          extractedPath = diff.path;
        }
      }

      // 3. Try extracting from human-readable title (e.g., "Edit file.ts", "Read `src/lib/App.svelte`")
      if (!extractedPath && typeof toolTitle === 'string') {
        const filePathMatch = toolTitle.match(
          /^(?:Edit|Save|Read|Write|Delete|View|Create)\s+(.+)/i,
        );
        if (filePathMatch) {
          // Strip surrounding backticks that ACP titles use for formatting
          const candidate = filePathMatch[1].trim().replace(/^`|`$/g, '');
          // Only use it if it looks like a file path (has extension or path separator)
          if (candidate.includes('.') || candidate.includes('/')) {
            extractedPath = candidate;
          }
        }
      }

      if (extractedPath) {
        (toolInput as Record<string, any>).path = extractedPath;
        logger.debug('[ACPProviderStreaming] Extracted file path from ACP fields', {
          extractedPath,
          source: update?.locations?.length
            ? 'locations'
            : Array.isArray(update?.content)
              ? 'content'
              : 'title',
        });
      }
    }

    // Extract command from ACP title for terminal tools (e.g., "Run `cd experimental/amelia && npx vitest ...`")
    // The ACP backend sends the command backtick-wrapped in the title, but rawInput may be empty.
    if (!input.command && typeof toolTitle === 'string') {
      const cmdMatch = toolTitle.match(/^(?:Run|Launch)\s+`(.+)`\s*$/i);
      if (cmdMatch) {
        (toolInput as Record<string, any>).command = cmdMatch[1];
      }
    }

    // Store the original ACP title in toolInput so the UI classifier can use it as a fallback
    // to extract file paths. When we derive actualToolName (e.g., "str-replace-editor") from
    // input parameters, the original human-readable title (e.g., "Edit src/foo.ts") is lost.
    // The classifier needs this to show file names when rawInput doesn't contain a path field.
    if (typeof toolTitle === 'string' && toolTitle !== 'unknown') {
      (toolInput as Record<string, any>)._acpTitle = toolTitle;
    }

    // Look up note title from notesService so the UI can show human-readable names
    // instead of UUIDs like "#bef103b5". Cache results to avoid repeated lookups.
    // Supports both noteId (most workspace tools) and taskNoteId (delegate_task, get_my_task).
    const lookupNoteId = input.noteId || input.taskNoteId;
    if (lookupNoteId && actualToolName.startsWith('workspace-mcp_') && session?.workspaceId) {
      const noteIdStr = String(lookupNoteId);
      const cachedTitle = noteTitleCache.get(`${session.workspaceId}:${noteIdStr}`);
      if (cachedTitle) {
        (toolInput as Record<string, any>)._noteTitle = cachedTitle;
      } else {
        try {
          const { notesService } = await import('../../../notes/main/notes.service');
          const noteResult = await notesService.getNote(session.workspaceId as any, noteIdStr as any);
          if (noteResult.ok && noteResult.data?.title) {
            (toolInput as Record<string, any>)._noteTitle = noteResult.data.title;
            noteTitleCache.set(`${session.workspaceId}:${noteIdStr}`, noteResult.data.title);
          }
        } catch {
          // Silently skip — noteId will be used as fallback in classifier
        }
      }
    }

    // Use string interpolation so actual values are visible in logs (object logging truncates)
    const inputKeysList = Object.keys(input).join(',');
    logger.info(
      `[ACPProviderStreaming] Tool derivation: title="${toolName}" -> name="${actualToolName}" inputKeys=[${inputKeysList}] noteId=${input.noteId || 'none'} rawInputType=${typeof update?.rawInput}`,
    );

    const toolBlock: ContentBlock = {
      type: 'tool_use',
      id: toolId, // Must be 'id' to match ToolUseBlock interface
      name: actualToolName,
      input: toolInput,
    };

    // Store tool kind for later use when handling tool_call_update
    // This allows us to trigger git refresh after file edits
    const toolKind = update?.kind || update?.content?.kind;
    if (toolKind && toolId) {
      pendingToolKinds.set(toolId, {
        kind: toolKind,
        agentId: session.agentId,
        timestamp: Date.now(),
      });
      logger.debug('Stored tool kind for pending tool call', {
        toolId,
        toolKind,
        agentId: session.agentId,
      });
    }

    // Track file-editing tools for attribution
    // This is critical for proper agent attribution when Auggie writes files
    //
    // ACP protocol sends tool info as:
    // - title: Human-readable like "Save file.ts" or "Edit path/to/file.ts"
    // - rawInput.command: "str_replace" for str-replace-editor
    // - rawInput.file_content: exists for save-file
    // - kind: "edit" for ANY editing tool (not just file edits!)
    //
    // We detect file edits by checking:
    // 1. rawInput.command === 'str_replace' (str-replace-editor)
    // 2. rawInput.file_content exists (save-file)
    // 3. title starts with "Save " or "Edit " (fallback for title-based detection)
    // 4. Tool name is in FILE_EDIT_TOOLS set
    //
    // NOTE: We intentionally do NOT use kind === 'edit' because it matches
    // non-file tools like task management ("Add 1 task") which also have kind: "edit"
    // Note: 'input' was already defined above for tool name derivation
    const isFileEdit =
      input.command === 'str_replace' ||
      input.file_content !== undefined ||
      (typeof toolName === 'string' &&
        (
          toolName.startsWith('Save ') ||
          toolName.startsWith('Edit ') ||
          toolName.startsWith('Update ') ||
          toolName.startsWith('Apply patch')
        )) ||
      FILE_EDIT_TOOLS.has(actualToolName);

    logger.info('[ACPProviderStreaming] File edit detection', {
      toolName,
      actualToolName,
      isFileEdit,
      hasCommand: input.command === 'str_replace',
      hasFileContent: input.file_content !== undefined,
      startsWithSaveOrEdit:
        typeof toolName === 'string' &&
        (
          toolName.startsWith('Save ') ||
          toolName.startsWith('Edit ') ||
          toolName.startsWith('Update ') ||
          toolName.startsWith('Apply patch')
        ),
      inFileEditTools: FILE_EDIT_TOOLS.has(actualToolName),
      toolId,
    });

    if (isFileEdit) {
      const filePath = input.path;

      // Determine the actual tool type for logging
      const actualToolType =
        input.command === 'str_replace'
          ? 'str-replace-editor'
          : input.file_content !== undefined
            ? 'save-file'
            : 'file-edit';

      logger.debug('Detected file edit tool', {
        toolId,
        toolName,
        actualToolType,
        toolKind,
        hasCommand: !!input.command,
        hasFileContent: input.file_content !== undefined,
        filePath,
      });

      if (filePath) {
        const pendingEdit: PendingFileEdit = {
          toolId,
          toolName: actualToolType,
          filePath,
          agentId: session.agentId,
          agentName: session.agentName,
          sessionId: session.sessionId,
          workspacePath: session.workspacePath,
          workspaceId: session.workspaceId,
          timestamp: Date.now(),
        };

        // NOTE: For both save-file and str_replace_editor, we defer recording the agent write
        // until the tool completes successfully. This is because:
        // 1. The content the agent sends may differ from what's actually written to disk
        //    (e.g., Augment's backend may add a trailing newline)
        // 2. We need to hash the actual file content to match what git will see
        // The toolResultBlock handler below will read the file and record the write.

        // Read old content BEFORE the edit for diff generation
        try {
          const fullPath =
            session.workspacePath && !isAbsolute(filePath)
              ? join(session.workspacePath, filePath)
              : filePath;
          pendingEdit.oldContent = await readFile(fullPath, 'utf-8');
        } catch {
          pendingEdit.oldContent = ''; // New file - no previous content
        }

        // Store pending edit (we'll read file after completion)
        pendingFileEdits.set(toolId, pendingEdit);
        logger.info('Stored pending file edit for attribution', {
          toolId,
          actualToolType,
          filePath,
          agentId: session.agentId,
          workspacePath: session.workspacePath,
        });
      }
    }

    // Use agentId as the canonical key.
    // If this is a follow-up for an already-emitted skeleton, update the existing block
    // instead of creating a duplicate. This prevents vague skeleton labels from persisting.
    if (isFollowUpForEmittedSkeleton) {
      streamSessionManager.updateContentBlock(session.agentId, toolBlock);
    } else {
      streamSessionManager.addContentBlock(session.agentId, toolBlock);
    }

    // Check if this tool_call already has a terminal status (some ACP providers send
    // a single tool_call event with status:"completed" instead of a separate tool_call_update)
    const status = update?.status || update?.content?.status;
    if (status === 'completed' || status === 'failed') {
      let output = update?.rawOutput?.output || update?.result || update?.content?.result || '';
      // When a tool fails with an empty result, extract the error message so the UI
      // shows a meaningful error instead of a blank "Tool Error:" line
      if (!output && status === 'failed') {
        const errorMsg = update?.error?.message || update?.content?.error?.message
          || update?.error || update?.content?.error;
        if (errorMsg) {
          try {
            output = typeof errorMsg === 'string' ? errorMsg : JSON.stringify(errorMsg);
          } catch {
            output = String(errorMsg);
          }
        }
      }
      // Append dev server hint for launch-process commands that match common patterns
      const devServerHint = getDevServerHint(input.command);
      if (devServerHint) {
        output = (typeof output === 'string' ? output : '') + devServerHint;
      }

      const resultBlock: ContentBlock = {
        type: 'tool_result',
        tool_use_id: toolId,
        content: output,
        is_error: status === 'failed',
      };
      streamSessionManager.addContentBlock(session.agentId, resultBlock);
      await this.processPendingFileEdit(toolId, status, Boolean(resultBlock.is_error), session);
      logger.debug('[ACPProviderStreaming] tool_call had terminal status, emitted tool_result', {
        toolId,
        status,
        hasOutput: !!output,
        agentId: session.agentId,
      });
      this.lastPendingToolId = undefined;
    } else {
      // For Codex workspace-mcp read-only tools, proactively fetch the result from notesService.
      // Codex never sends tool_call_update events, so without this the auto-complete mechanism
      // would create a synthetic empty tool_result and the UI would show "Completed" instead of
      // the actual note content / note list / task data.
      const CODEX_READABLE_TOOLS = new Set(['read_note', 'list_notes', 'list_note_tasks', 'get_my_task']);
      let fetchedResult = false;

      if (isCodexWorkspaceMcp && session?.workspaceId && CODEX_READABLE_TOOLS.has(codexResolvedToolName)) {
        try {
          const { notesService } = await import('../../../notes/main/notes.service');
          let resultContent = '';

          if (codexResolvedToolName === 'read_note' && input.noteId) {
            const noteResult = await notesService.getNote(session.workspaceId as any, String(input.noteId) as any);
            if (noteResult.ok && noteResult.data) {
              const note = noteResult.data;
              const contentWithLineNumbers = (note.content || '')
                .split('\n')
                .map((line: string, i: number) => `${String(i + 1).padStart(4, ' ')} | ${line}`)
                .join('\n');
              resultContent = `Note: ${note.title || input.noteId}\n\n${contentWithLineNumbers}`;
              if (note.metadata?.task) {
                resultContent += `\n\n--- Task Metadata ---\nStatus: ${note.metadata.task.status}`;
              }
            }
          } else if (codexResolvedToolName === 'list_notes') {
            const listResult = await notesService.listNotes(session.workspaceId as any);
            if (listResult.ok && listResult.data) {
              const notesList = listResult.data.notes.map((n: any) => ({
                id: n.id,
                title: n.title || 'Untitled',
                tags: n.tags || [],
                created_at: n.created_at || n.createdAt,
                updated_at: n.updated_at || n.updatedAt,
              }));
              resultContent = JSON.stringify(notesList, null, 2);
            }
          } else if (codexResolvedToolName === 'list_note_tasks' && input.noteId) {
            const noteResult = await notesService.getNote(session.workspaceId as any, String(input.noteId) as any);
            if (noteResult.ok && noteResult.data) {
              const note = noteResult.data;
              const content = note.content || '';
              const lines = content.split('\n');
              const TASK_LINE_REGEX = /^(\s*[-*]\s*)\[([ xX\/])\]\s*(.+)$/;
              const TASK_LINK_PATTERN = /\[([^\]]+)\]\(intent:\/\/local\/task\/([a-f0-9-]+)\)/;
              const tasks: Array<{ lineNumber: number; text: string; status: string; taskNoteId: string | null }> = [];
              for (let i = 0; i < lines.length; i++) {
                const match = lines[i].match(TASK_LINE_REGEX);
                if (!match) continue;
                const [, , checkbox, taskText] = match;
                const status = checkbox === 'x' || checkbox === 'X' ? 'done' : checkbox === '/' ? 'in-progress' : 'todo';
                const linkMatch = taskText.match(TASK_LINK_PATTERN);
                const taskNoteId = linkMatch ? linkMatch[2] : null;
                const cleanText = linkMatch ? linkMatch[1] : taskText.replace(/<!--agent:[^>]+-->/g, '').trim();
                tasks.push({ lineNumber: i + 1, text: cleanText, status, taskNoteId });
              }
              let text = `Tasks in "${note.title || input.noteId}" (${tasks.length} task${tasks.length !== 1 ? 's' : ''}):\n`;
              for (const task of tasks) {
                const cb = task.status === 'done' ? '[x]' : task.status === 'in-progress' ? '[/]' : '[ ]';
                const linkInfo = task.taskNoteId ? ` → task note: ${task.taskNoteId}` : '';
                text += `\n  Line ${task.lineNumber}: ${cb} ${task.text}${linkInfo}`;
              }
              resultContent = text;
            }
          } else if (codexResolvedToolName === 'get_my_task' && input.taskNoteId) {
            const taskResult = await notesService.getNote(session.workspaceId as any, String(input.taskNoteId) as any);
            if (taskResult.ok && taskResult.data) {
              const note = taskResult.data;
              resultContent = JSON.stringify({
                title: note.title,
                status: note.metadata?.task?.status || 'unknown',
                content: note.content,
              });
            }
          }

          if (resultContent) {
            const resultBlock: ContentBlock = {
              type: 'tool_result',
              tool_use_id: toolId,
              content: resultContent,
              is_error: false,
            };
            streamSessionManager.addContentBlock(session.agentId, resultBlock);
            logger.info('[ACPProviderStreaming] Fetched result for Codex read-only tool', {
              tool: codexResolvedToolName,
              toolId,
              resultLength: resultContent.length,
            });
            fetchedResult = true;
          }
        } catch (err) {
          logger.warn('[ACPProviderStreaming] Failed to fetch result for Codex read-only tool', {
            tool: codexResolvedToolName,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      if (!fetchedResult) {
        // Track this tool as pending so we can auto-complete it when the next tool_call arrives
        this.lastPendingToolId = toolId;
      }
    }
  }

  /**
   * Handle a tool call update
   */
  private async handleToolCallUpdate(update: any, session: any): Promise<void> {
    // The backend sends the result in different formats
    // Test format: update.content.result
    // Production format: update.rawOutput.output
    let output = '';
    let toolCallId = '';

    if (update?.content) {
      // Test format
      output = update.content.result || '';
      toolCallId = update.content.toolCallId || '';
    } else {
      // Production format
      output = update?.rawOutput?.output || update?.result || '';
      toolCallId = update?.toolCallId || '';
    }

    // When output is empty but the update carries an error (e.g., MCP connection lost,
    // timeout, bridge unavailable), extract the error message so the UI shows something
    // meaningful instead of a blank "Tool Error:" line
    const isError = update?.status === 'failed' || update?.isError;
    if (!output && isError) {
      const errorMsg = update?.error?.message || update?.content?.error?.message
        || update?.error || update?.content?.error;
      if (errorMsg) {
        try {
          output = typeof errorMsg === 'string' ? errorMsg : JSON.stringify(errorMsg);
        } catch {
          output = String(errorMsg);
        }
      }
    }

    // Clear lastPendingToolId since we received a proper tool_call_update
    if (toolCallId && toolCallId === this.lastPendingToolId) {
      this.lastPendingToolId = undefined;
    }

    // Backfill missing input fields on the existing tool_use block from the update's rawInput.
    // The tool_use block is stored by reference in the accumulator, so mutating it here
    // ensures the data is available for attribution, classification, and final message assembly.
    // We merge ALL missing fields (not just path) so the tool classifier can show details
    // like command, file type, etc.
    if (toolCallId) {
      const partial = messageAccumulator.getPartialContent(session.agentId);
      const existingBlock = partial.contentBlocks.find(
        (b: ContentBlock) => b.type === 'tool_use' && b.id === toolCallId,
      );
      if (existingBlock && existingBlock.input) {
        const existingInput = existingBlock.input as Record<string, any>;
        let backfilledFields: string[] = [];

        // Merge all missing fields from rawInput (command, cwd, type, path, etc.)
        const rawInput = update?.rawInput as Record<string, any> | undefined;
        if (rawInput && typeof rawInput === 'object') {
          for (const [key, value] of Object.entries(rawInput)) {
            if (value !== undefined && value !== null && existingInput[key] === undefined) {
              existingInput[key] = value;
              backfilledFields.push(key);
            }
          }
        }

        // Also try to extract path from locations/content if still missing
        if (!existingInput.path && !existingInput.file_path) {
          let extractedPath: string | undefined;

          // Try locations from the update
          if (Array.isArray(update?.locations) && update.locations[0]?.path) {
            extractedPath = update.locations[0].path;
          }

          // Try content diffs from the update
          if (!extractedPath && Array.isArray(update?.content)) {
            const diff = update.content.find(
              (c: any) => c?.type === 'diff' && typeof c?.path === 'string',
            );
            if (diff) {
              extractedPath = diff.path;
            }
          }

          if (extractedPath) {
            existingInput.path = extractedPath;
            backfilledFields.push('path(from locations/content)');
          }
        }

        if (backfilledFields.length > 0) {
          logger.info('[ACPProviderStreaming] Backfilled input fields on tool_use from tool_call_update', {
            toolCallId,
            backfilledFields,
          });
        }
      }
    }

    // Detect error from content text (e.g., "Error:" prefix or "Tool Error:")
    // Note: We no longer check for ❌ emoji as it may be used as a visual indicator in content
    const hasErrorInContent =
      typeof output === 'string' && (output.startsWith('Error:') || output.includes('Tool Error:'));

    // Append dev server hint for launch-process commands that match common patterns
    if (toolCallId && typeof output === 'string') {
      const partial = messageAccumulator.getPartialContent(session.agentId);
      const toolUseBlock = partial.contentBlocks.find(
        (b: ContentBlock) => b.type === 'tool_use' && b.id === toolCallId,
      );
      const toolCommand = (toolUseBlock?.input as Record<string, any> | undefined)?.command;
      const devServerHint = getDevServerHint(toolCommand);
      if (devServerHint) {
        output += devServerHint;
      }
    }

    const toolResultBlock: ContentBlock = {
      type: 'tool_result',
      tool_use_id: toolCallId,
      content: output,
      is_error: update?.status === 'failed' || update?.isError || hasErrorInContent || false,
    };

    // Use debug level for tool result operations (can be frequent)
    logger.debug('Handling tool call update', {
      toolId: toolResultBlock.tool_use_id,
      hasOutput: !!output,
      outputLength: typeof output === 'string' ? output.length : 0,
      isError: toolResultBlock.is_error,
      agentId: session.agentId,
    });

    // Use agentId as the canonical key
    streamSessionManager.addContentBlock(session.agentId, toolResultBlock);

    // Check if this was a file edit tool and trigger immediate git check
    // This ensures the CodeChangesPanel updates immediately when agents edit files
    const pendingToolKind = pendingToolKinds.get(toolCallId);
    const toolKind = pendingToolKind?.kind;
    // Use explicit null/undefined check to allow empty string workspaceId
    if (
      toolKind === 'edit' &&
      update?.status === 'completed' &&
      session.workspaceId !== undefined &&
      session.workspaceId !== null
    ) {
      logger.info('Agent file edit completed, triggering immediate git check', {
        toolCallId,
        toolKind,
        workspaceId: session.workspaceId,
      });
      try {
        changeDetectorManager.triggerImmediateCheck(session.workspaceId, 'agent-file-edit');
      } catch (error) {
        logger.warn('Failed to trigger git check after agent edit', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    await this.processPendingFileEdit(toolCallId, update?.status || '', Boolean(toolResultBlock.is_error), session);

    // Clean up pending tool kind and file edit
    if (toolCallId) {
      pendingToolKinds.delete(toolCallId);
    }
  }

  /**
   * Handle stream completion
   */
  private async handleComplete(update: any, session: any): Promise<void> {
    // Emit any remaining deferred skeleton — stream is done, no follow-up will arrive
    this.clearSkeletonTimer();
    if (this.pendingSkeleton) {
      await this.emitDeferredSkeleton();
    }

    // AUTO-COMPLETE LAST PENDING TOOL: If the stream is completing and there's still a
    // pending tool without a tool_call_update, emit a synthetic tool_result so the UI
    // transitions it to completed immediately (rather than waiting for the fallback).
    if (this.lastPendingToolId) {
      const completedToolId = this.lastPendingToolId;
      const syntheticResult: ContentBlock = {
        type: 'tool_result',
        tool_use_id: completedToolId,
        content: '',
        is_error: false,
      };
      streamSessionManager.addContentBlock(session.agentId, syntheticResult);
      await this.processPendingFileEdit(completedToolId, 'completed', false, session);
      logger.debug('[ACPProviderStreaming] Auto-completed last pending tool on stream complete', {
        toolId: completedToolId,
        agentId: session.agentId,
      });
      this.lastPendingToolId = undefined;
    }

    // Get accumulated content from the message accumulator
    // NOTE: Content blocks are ONLY stored in the accumulator - do NOT merge session.contentBlocks
    // to avoid duplicates (content blocks are added to accumulator via addContentBlock)
    const accumulatorId = session.agentId || this.agentId;
    let finalContent = '';
    let contentBlocks: ContentBlock[] = [];

    try {
      // IMPORTANT: Use getPartialContent which properly builds ordered content blocks
      // that include both text and tool_use blocks in the correct order.
      // getAccumulated().contentBlocks only contains tool_use blocks, NOT text blocks.
      const partial = messageAccumulator.getPartialContent(accumulatorId);
      finalContent = partial.content || '';
      contentBlocks = partial.contentBlocks || [];

      logger.info('[ACPProviderStreaming] handleComplete got accumulated content', {
        accumulatorId,
        contentLength: finalContent.length,
        contentBlockCount: contentBlocks.length,
        blockTypes: contentBlocks.map((b) => b.type),
        hasTextBlock: contentBlocks.some((b) => b.type === 'text'),
      });
    } catch (error) {
      logger.warn('Could not get accumulated content on complete', { error });
    }

    // Create the final message with proper format
    const finalMessage = {
      id: session.streamId || `msg_${Date.now()}`,
      role: 'assistant',
      content: finalContent,
      contentBlocks:
        contentBlocks.length > 0
          ? contentBlocks
          : finalContent
            ? [{ type: 'text', text: finalContent }]
            : [],
      timestamp: new Date().toISOString(),
      metadata: {
        stopReason: update?.stopReason || 'end_turn',
        sessionId: session.sessionId,
        agentId: session.agentId,
      },
    };

    // Complete the stream with the formatted message
    const sessionIdForComplete = session?.agentId || this.agentId || '';
    streamSessionManager.completeStream(sessionIdForComplete, finalMessage);

    // NOTE: We intentionally do NOT clear agent file operations here.
    // Agent writes need to persist until git polling detects the changes and
    // can match them for proper attribution. The TTL-based cleanup (5 minutes)
    // in the attribution engine handles memory management.

    // Clean up
    this.cleanup();
  }

  /**
   * Handle streaming error
   */
  async handleError(error: Error): Promise<void> {
    logger.error('Streaming error', {
      agentId: this.agentId,
      error: error.message,
    });

    // Handle error through StreamManager
    streamSessionManager.handleError(this.agentId || '', error);

    // NOTE: We intentionally do NOT clear agent file operations here.
    // Even on error, agent writes should persist for attribution.
    // The TTL-based cleanup handles memory management.

    this.cleanup();
  }

  /**
   * Check if stream is stalled
   */
  isStalled(): boolean {
    const session = streamSessionManager.getSession(this.agentId || '');
    if (!session) return false;

    // Use shared constant for stall detection threshold, with environment variable override
    // This matches the behavior in acp-provider.ts for consistency
    const STALL_THRESHOLD =
      parseInt(process.env.STALLED_STREAM_TIMEOUT_MS || '', 10) ||
      AGENT_STREAMING_CONFIG.COMPLETION_DETECTION_MS;
    const timeSinceLastActivity =
      Date.now() - (session.lastActivity || session.startTime || Date.now());

    // Mark as stalled if no activity for threshold time
    if (timeSinceLastActivity > STALL_THRESHOLD) {
      session.healthStatus = 'stalled';
      return true;
    }

    return session.healthStatus === 'stalled';
  }

  /**
   * Clean up streaming resources
   */
  cleanup(): void {
    // Reset pending tool tracking to prevent stale state
    this.clearSkeletonTimer();
    this.lastPendingToolId = undefined;
    this.pendingSkeleton = undefined;
    this.pendingSkeletonSession = undefined;

    // Clean up pending tool state for this agent to prevent memory leaks
    if (this.agentId) {
      cleanupPendingToolState(this.agentId);
    }

    // StreamManager handles all cleanup internally
    // Just ensure the session is cleaned up by ID
    if (this.internalSessionId) {
      // The cleanup is handled by StreamManager's internal cleanup
      // We don't need to call anything here as it's automatic
    }

    logger.debug('Cleaned up streaming session', {
      agentId: this.agentId,
    });
  }

  /**
   * Dispose of all resources
   */
  dispose(): void {
    // Clean up the session from BackendStreamManager using agentId (canonical key)
    if (this.agentId) {
      streamSessionManager.completeStream(this.agentId);
      // Also clear from message accumulator
      try {
        messageAccumulator.clear(this.agentId);
      } catch (error) {
        // Ignore if not found
      }
    }

    this.cleanup();
    this.internalSessionId = undefined;
    this.frontendSessionId = undefined;
  }
}


