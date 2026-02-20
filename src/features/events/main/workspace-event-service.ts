/**
 * Workspace Event Service
 *
 * Main service for initializing and managing the workspace event system.
 * Integrates with existing systems and provides a unified API.
 */

import { v4 as uuidv4 } from 'uuid';
import { WorkspaceEventBus, getWorkspaceEventBus } from './workspace-event-bus';
import { AgentEventTools } from './agent-event-tools';
import { ChangeDetectorRefactored as ChangeDetector } from '../../workspace/main/change-detector-refactored';
import { RemoteChangeDetector } from '../../workspace/main/remote-change-detector';
import { getProvenanceContextManager } from '../../workspace/main/provenance/provenance-context-manager';
import { Logger } from '../../../shared/logger';
import { EventEmitter } from '../../../shared/event-emitter';
import { unifiedEventBus } from './unified-event-bus';
import type {
  WorkspaceEvent,
  FileChangedEvent,
  AgentToolCallEvent,
  EventActor,
  ActorType,
  NoteChangedEvent,
} from '../types';

const logger = new Logger('WorkspaceEventService');

export interface WorkspaceEventServiceOptions {
  workspaceId: string;
  changeDetector?: ChangeDetector | RemoteChangeDetector;
  enableHistoricalSync?: boolean;
  maxEvents?: number;
  eventBus?: WorkspaceEventBus;
}

// Debounce time for coalescing repeated note:updated events
const NOTE_UPDATE_DEBOUNCE_MS = 5000; // 5 seconds - coalesce rapid updates

/**
 * Main service for workspace events
 */
export class WorkspaceEventService extends EventEmitter {
  private eventBus: WorkspaceEventBus;
  private agentTools: AgentEventTools;
  private isInitialized = false;
  private changeDetectorListenersSetup = false;
  private currentChangeDetector?: ChangeDetector | RemoteChangeDetector;
  private eventBusListener?: (event: WorkspaceEvent) => void;
  private changeDetectorListener?: (event: WorkspaceEvent) => void;

  // Debounce timers for note:updated events to coalesce rapid updates
  private noteUpdateTimers: Map<string, NodeJS.Timeout> = new Map();
  private pendingNoteUpdates: Map<string, NoteChangedEvent> = new Map();

  // Store note event listeners so they can be removed in dispose()
  // Without this, listeners leak on the global unifiedEventBus singleton when a workspace is deleted
  private noteCreatedListener?: (data: any) => void;
  private noteUpdatedListener?: (data: any) => void;
  private noteDeletedListener?: (data: any) => void;

  // Batching for activity-log-events to reduce logging overhead
  private pendingActivityLogEvents: WorkspaceEvent[] = [];
  private activityLogBatchTimer: NodeJS.Timeout | null = null;
  private readonly ACTIVITY_LOG_BATCH_INTERVAL_MS = 50; // Batch events for 50ms

  constructor(private options: WorkspaceEventServiceOptions) {
    super();

    // Use the provided event bus or get the singleton instance
    // IMPORTANT: Always use getWorkspaceEventBus() to ensure singleton pattern
    this.eventBus = options.eventBus || getWorkspaceEventBus(options.workspaceId);

    // Initialize agent tools
    this.agentTools = new AgentEventTools(this.eventBus);

    logger.info('WorkspaceEventService created', {
      workspaceId: options.workspaceId,
    });
  }

  /**
   * Initialize the event service
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.debug('Event service already initialized', {
        workspaceId: this.options.workspaceId,
      });
      return;
    }

    try {
      // Initialize the event bus (loads existing events from disk)
      await this.eventBus.initialize();

      // Set up change detector integration
      if (this.options.changeDetector) {
        this.setupChangeDetectorIntegration(this.options.changeDetector);
      }

      // Set up note event integration
      this.setupNoteEventIntegration();

      // Forward events to parent emitter
      // Store the listener function so we can remove it later
      this.eventBusListener = (event: WorkspaceEvent) => {
        this.emit('workspace:event', event);
      };
      this.eventBus.on('event', this.eventBusListener);

      this.isInitialized = true;
      logger.info('WorkspaceEventService initialized successfully', {
        workspaceId: this.options.workspaceId,
        eventCount: await this.eventBus.getEventCount(),
      });
    } catch (error) {
      logger.error('Failed to initialize event service', {
        workspaceId: this.options.workspaceId,
        error,
      });
      // Don't throw - allow graceful degradation
      this.isInitialized = true; // Mark as initialized to prevent retry loops
    }
  }

  /**
   * Initialize the event service with a change detector
   */
  async initializeWithChangeDetector(
    changeDetector: ChangeDetector | RemoteChangeDetector,
  ): Promise<void> {
    // Store the change detector in options for later use
    this.options.changeDetector = changeDetector;

    // If already initialized, just set up the change detector integration
    if (this.isInitialized) {
      logger.debug('Event service already initialized, setting up change detector integration', {
        workspaceId: this.options.workspaceId,
      });
      this.setupChangeDetectorIntegration(changeDetector);
      return;
    }

    // Otherwise, call the regular initialize method
    await this.initialize();
  }

  /**
   * Get the current options
   */
  getOptions(): WorkspaceEventServiceOptions {
    return this.options;
  }

  /**
   * Update the change detector for this service
   */
  updateChangeDetector(changeDetector: ChangeDetector | RemoteChangeDetector): void {
    // Only update if it's a different change detector
    if (this.currentChangeDetector === changeDetector) {
      logger.debug('Same change detector instance, skipping update', {
        workspaceId: this.options.workspaceId,
      });
      return;
    }

    logger.info('Updating change detector for event service', {
      workspaceId: this.options.workspaceId,
      isInitialized: this.isInitialized,
      hadPreviousDetector: !!this.currentChangeDetector,
    });

    this.options.changeDetector = changeDetector;
    if (this.isInitialized) {
      this.setupChangeDetectorIntegration(changeDetector);
    } else {
      logger.warn('Event service not initialized, change detector will be set up on initialize', {
        workspaceId: this.options.workspaceId,
      });
    }
  }

  /**
   * Set up integration with change detector
   */
  private setupChangeDetectorIntegration(
    changeDetector: ChangeDetector | RemoteChangeDetector,
  ): void {
    // Prevent duplicate listeners on the same instance
    if (this.changeDetectorListenersSetup && this.currentChangeDetector === changeDetector) {
      logger.debug('Change detector listeners already set up for this instance, skipping');
      return;
    }

    logger.info('Setting up change detector integration', {
      workspaceId: this.options.workspaceId,
      hadPreviousDetector: !!this.currentChangeDetector,
    });

    // Remove our own listener from the previous change detector (if any)
    if (this.currentChangeDetector && this.changeDetectorListener) {
      this.currentChangeDetector.off('activity-log-event', this.changeDetectorListener);
    }

    // Store reference to current change detector
    this.currentChangeDetector = changeDetector;

    // Create and store the listener so we can remove it later
    // Use batching to reduce logging overhead when many events arrive in quick succession
    this.changeDetectorListener = (event: WorkspaceEvent) => {
      // Ensure event is for this workspace
      if (event.workspaceId !== this.options.workspaceId) {
        logger.warn('Ignoring event for different workspace', {
          eventWorkspaceId: event.workspaceId,
          currentWorkspaceId: this.options.workspaceId,
        });
        return;
      }

      // Add to pending batch
      this.pendingActivityLogEvents.push(event);

      // Schedule batch flush if not already scheduled
      if (!this.activityLogBatchTimer) {
        this.activityLogBatchTimer = setTimeout(() => {
          this.flushActivityLogEvents();
        }, this.ACTIVITY_LOG_BATCH_INTERVAL_MS);
      }
    };

    // Listen for activity-log-event from change detector
    // These events are already fully formed WorkspaceEvent objects from EventCoordinator
    changeDetector.on('activity-log-event', this.changeDetectorListener);

    this.changeDetectorListenersSetup = true;
    logger.info('Change detector integration set up successfully', {
      workspaceId: this.options.workspaceId,
    });
  }

  /**
   * Flush batched activity log events to the event bus
   */
  private flushActivityLogEvents(): void {
    const events = this.pendingActivityLogEvents;
    this.pendingActivityLogEvents = [];
    this.activityLogBatchTimer = null;

    if (events.length === 0) return;

    // Emit all events
    for (const event of events) {
      this.eventBus.emitEvent(event);
    }

    // Log a single summary instead of per-event logging
    logger.info('Forwarded activity-log-events to event bus (batch)', {
      workspaceId: this.options.workspaceId,
      count: events.length,
      eventTypes: [...new Set(events.map((e) => e.type))],
    });
  }

  /**
   * Set up integration with note events
   */
  private setupNoteEventIntegration(): void {
    // Listen for note:created events
    this.noteCreatedListener = (data: any) => {
      if (data.workspaceId !== this.options.workspaceId) {
        return; // Ignore events for other workspaces
      }

      // Guard: Skip re-forwarded WorkspaceEvents. When WorkspaceEventBus.emitEvent()
      // forwards a WorkspaceEvent to UnifiedEventBus via emit(event.type, event),
      // this listener fires again with the full WorkspaceEvent object where noteId
      // is nested inside data.data, not at the top level. Skip these to prevent
      // ghost duplicate events with missing fields.
      if (!data.noteId) {
        return;
      }

      logger.info('WorkspaceEventService received note:created', {
        workspaceId: data.workspaceId,
        noteId: data.noteId,
        actor: data.actor,
        hasActor: !!data.actor,
        actorType: data.actor?.type,
        actorName: data.actor?.name,
      });

      // Use actor information from the event data (captured at emission time)
      const actor = data.actor ? this.convertActor(data.actor) : null;

      const event: NoteChangedEvent = {
        id: `note-${uuidv4()}`,
        workspaceId: this.options.workspaceId,
        timestamp: new Date().toISOString(),
        type: 'note:created',
        actor: actor || {
          type: 'user' as ActorType,
          id: 'user',
          name: 'User',
        },
        sessionId: data.sessionId,
        data: {
          noteId: data.noteId,
          title: data.note?.title,
          path: `notes/${data.noteId}`,
          action: 'create',
          tags: data.note?.tags || [],
        },
        metadata: {
          source: 'notes-service',
          ...(actor &&
            actor.type === 'agent' && {
              agentId: actor.id,
              agentName: actor.name,
              turnNumber: (actor.metadata as any)?.turnNumber,
            }),
        },
      };

      // Emit through WorkspaceEventBus (which forwards to UnifiedEventBus automatically)
      this.eventBus.emitEvent(event);
      logger.debug('Note created event emitted', {
        noteId: data.noteId,
        actor: actor?.name || 'User',
        turnNumber: (actor?.metadata as any)?.turnNumber,
      });
    };
    unifiedEventBus.onDomainEvent('note:created', this.noteCreatedListener);

    // Listen for note:updated events (debounced to coalesce rapid updates)
    this.noteUpdatedListener = (data: any) => {
      if (data.workspaceId !== this.options.workspaceId) {
        return; // Ignore events for other workspaces
      }

      // Guard: Skip re-forwarded WorkspaceEvents. When WorkspaceEventBus.emitEvent()
      // forwards a WorkspaceEvent to UnifiedEventBus via emit(event.type, event),
      // this listener fires again with the full WorkspaceEvent object where noteId
      // is nested inside data.data, not at the top level. Without this guard,
      // a ghost event with undefined title gets created, showing "User updated note"
      // instead of the actual note title.
      if (!data.noteId) {
        return;
      }

      // Use actor information from the event data (captured at emission time)
      const actor = data.actor ? this.convertActor(data.actor) : null;

      const event: NoteChangedEvent = {
        id: `note-${uuidv4()}`,
        workspaceId: this.options.workspaceId,
        timestamp: new Date().toISOString(),
        type: 'note:updated',
        actor: actor || {
          type: 'user' as ActorType,
          id: 'user',
          name: 'User',
        },
        sessionId: data.sessionId,
        data: {
          noteId: data.noteId,
          title: data.title || data.changes?.title,
          path: `notes/${data.noteId}`,
          action: 'update',
          sections: data.changes?.sections,
          tags: data.changes?.tags,
        },
        metadata: {
          source: 'notes-service',
          changes: data.changes,
          ...(actor &&
            actor.type === 'agent' && {
              agentId: actor.id,
              agentName: actor.name,
              turnNumber: (actor.metadata as any)?.turnNumber,
            }),
        },
      };

      // Debounce note:updated events to prevent flooding the Activity Log
      // Coalesce rapid updates to the same note into a single event
      const noteKey = data.noteId;

      // Clear existing timer for this note
      const existingTimer = this.noteUpdateTimers.get(noteKey);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }

      // Store the latest event (keeps updating with latest timestamp)
      this.pendingNoteUpdates.set(noteKey, event);

      // Schedule emission after debounce period
      const timer = setTimeout(() => {
        const pendingEvent = this.pendingNoteUpdates.get(noteKey);
        if (pendingEvent) {
          // Emit through WorkspaceEventBus (which forwards to UnifiedEventBus automatically)
          this.eventBus.emitEvent(pendingEvent);
          logger.debug('Note updated event emitted (debounced)', {
            noteId: data.noteId,
            actor: actor?.name || 'User',
          });
          this.pendingNoteUpdates.delete(noteKey);
        }
        this.noteUpdateTimers.delete(noteKey);
      }, NOTE_UPDATE_DEBOUNCE_MS);

      this.noteUpdateTimers.set(noteKey, timer);
    };
    unifiedEventBus.onDomainEvent('note:updated', this.noteUpdatedListener);

    // Listen for note:deleted events
    this.noteDeletedListener = (data: any) => {
      if (data.workspaceId !== this.options.workspaceId) {
        return; // Ignore events for other workspaces
      }

      // Guard: Skip re-forwarded WorkspaceEvents (see note:created guard for details)
      if (!data.noteId) {
        return;
      }

      // Use actor information from the event data (captured at emission time)
      const actor = data.actor ? this.convertActor(data.actor) : null;

      const event: NoteChangedEvent = {
        id: `note-${uuidv4()}`,
        workspaceId: this.options.workspaceId,
        timestamp: new Date().toISOString(),
        type: 'note:deleted',
        actor: actor || {
          type: 'user' as ActorType,
          id: 'user',
          name: 'User',
        },
        sessionId: data.sessionId,
        data: {
          noteId: data.noteId,
          title: data.title,
          path: `notes/${data.noteId}`,
          action: 'delete',
        },
        metadata: {
          source: 'notes-service',
          ...(actor &&
            actor.type === 'agent' && {
              agentId: actor.id,
              agentName: actor.name,
              turnNumber: (actor.metadata as any)?.turnNumber,
            }),
        },
      };

      // Emit through WorkspaceEventBus (which forwards to UnifiedEventBus automatically)
      this.eventBus.emitEvent(event);
      logger.debug('Note deleted event emitted', {
        noteId: data.noteId,
        actor: actor?.name || 'User',
        turnNumber: (actor?.metadata as any)?.turnNumber,
      });
    };
    unifiedEventBus.onDomainEvent('note:deleted', this.noteDeletedListener);

    logger.debug('Note event integration set up');
  }

  /**
   * Convert actor from provenance context
   */
  private convertActor(actor: any): EventActor {
    if (!actor) {
      return {
        type: 'system',
        id: 'system',
        name: 'System',
      };
    }

    return {
      type: actor.type || 'user',
      id: actor.id || actor.name || 'unknown',
      name: actor.name || 'Unknown',
      metadata: {
        turnNumber: actor.turnNumber,
        messageId: actor.messageId,
      },
    };
  }

  /**
   * Emit a file change event
   */
  emitFileChange(
    path: string,
    action: 'create' | 'modify' | 'delete' | 'rename',
    options: {
      oldPath?: string;
      additions?: number;
      deletions?: number;
      diff?: string;
      actor?: EventActor;
    } = {},
  ): void {
    const provenanceManager = getProvenanceContextManager();

    const event: FileChangedEvent = {
      id: `file-${uuidv4()}`,
      workspaceId: this.options.workspaceId,
      timestamp: new Date().toISOString(),
      type: 'file:changed',
      actor: options.actor || this.convertActor(provenanceManager.getCurrentActor()),
      sessionId: provenanceManager.getCurrentSessionId(),
      data: {
        path,
        relativePath: path,
        action,
        oldPath: options.oldPath,
        additions: options.additions,
        deletions: options.deletions,
        diff: options.diff,
      },
    };

    // Emit through WorkspaceEventBus (which forwards to UnifiedEventBus automatically)
    this.eventBus.emitEvent(event);
  }

  /**
   * Emit an agent tool call event
   */
  emitAgentToolCall(
    toolName: string,
    toolKind: 'file' | 'terminal' | 'search' | 'note' | 'git' | 'other',
    input: any,
    options: {
      output?: any;
      status?: 'started' | 'completed' | 'error';
      error?: string;
      duration?: number;
      filesModified?: string[];
    } = {},
  ): void {
    const provenanceManager = getProvenanceContextManager();
    const currentActor = provenanceManager.getCurrentActor();

    const event: AgentToolCallEvent = {
      id: `tool-${uuidv4()}`,
      workspaceId: this.options.workspaceId,
      timestamp: new Date().toISOString(),
      type: 'agent:tool:call',
      actor: this.convertActor(currentActor),
      sessionId: provenanceManager.getCurrentSessionId(),
      correlationId: provenanceManager.getCurrentCorrelationId(),
      data: {
        toolName,
        toolKind,
        input,
        output: options.output,
        status: options.status || 'completed',
        error: options.error,
        duration: options.duration,
        filesModified: options.filesModified,
      },
      metadata: {
        turnNumber: currentActor?.turnNumber,
        messageId: currentActor?.messageId,
      },
    };

    // Emit through WorkspaceEventBus (which forwards to UnifiedEventBus automatically)
    this.eventBus.emitEvent(event);
  }

  /**
   * Emit a note change event
   */
  emitNoteChange(
    noteId: string,
    action: 'create' | 'update' | 'delete',
    options: {
      title?: string;
      tags?: string[];
      sections?: string[];
      actor?: EventActor;
    } = {},
  ): void {
    const provenanceManager = getProvenanceContextManager();

    const eventType = `note:${action}d` as 'note:created' | 'note:updated' | 'note:deleted';

    const event: NoteChangedEvent = {
      id: `note-${uuidv4()}`,
      workspaceId: this.options.workspaceId,
      timestamp: new Date().toISOString(),
      type: eventType,
      actor: options.actor ||
        this.convertActor(provenanceManager.getCurrentActor()) || {
          type: 'user' as ActorType,
          id: 'user',
          name: 'User',
        },
      sessionId: provenanceManager.getCurrentSessionId(),
      data: {
        noteId,
        title: options.title,
        path: `notes/${noteId}`,
        action,
        sections: options.sections,
        tags: options.tags,
      },
    };

    // Emit through WorkspaceEventBus (which forwards to UnifiedEventBus automatically)
    this.eventBus.emitEvent(event);
    logger.debug(`Note ${action} event emitted`, { noteId });
  }

  /**
   * Emit multiple events at once
   * Used by EventCoordinator to emit batched events
   */
  async emitEvents(events: WorkspaceEvent[]): Promise<void> {
    for (const event of events) {
      // Ensure event has correct workspace ID
      if (event.workspaceId !== this.options.workspaceId) {
        logger.warn('Event has wrong workspace ID, correcting', {
          eventId: event.id,
          eventWorkspaceId: event.workspaceId,
          expectedWorkspaceId: this.options.workspaceId,
        });
        event.workspaceId = this.options.workspaceId;
      }

      // Emit through WorkspaceEventBus (which forwards to UnifiedEventBus automatically)
      this.eventBus.emitEvent(event);
    }

    logger.debug('Emitted batch of events', {
      workspaceId: this.options.workspaceId,
      eventCount: events.length,
    });
  }

  /**
   * Get the event bus for direct access
   */
  getEventBus(): WorkspaceEventBus {
    return this.eventBus;
  }

  /**
   * Get agent tools for querying events
   */
  getAgentTools(): AgentEventTools {
    return this.agentTools;
  }

  /**
   * Get statistics about events
   */
  async getStatistics() {
    return this.eventBus.getStatistics();
  }

  /**
   * Cleanup resources
   */
  async dispose(): Promise<void> {
    // Remove event bus listener
    if (this.eventBusListener) {
      this.eventBus.off('event', this.eventBusListener);
      this.eventBusListener = undefined;
    }

    // Remove change detector listener
    if (this.currentChangeDetector && this.changeDetectorListener) {
      this.currentChangeDetector.off('activity-log-event', this.changeDetectorListener);
      this.changeDetectorListener = undefined;
    }
    this.currentChangeDetector = undefined;
    this.changeDetectorListenersSetup = false;

    // Clear pending note update timers
    for (const timer of this.noteUpdateTimers.values()) {
      clearTimeout(timer);
    }
    this.noteUpdateTimers.clear();
    this.pendingNoteUpdates.clear();

    // Clear activity log batch timer and flush remaining events
    if (this.activityLogBatchTimer) {
      clearTimeout(this.activityLogBatchTimer);
      this.activityLogBatchTimer = null;
    }
    // Flush any remaining batched events before disposing
    if (this.pendingActivityLogEvents.length > 0) {
      this.flushActivityLogEvents();
    }

    // Remove note event listeners from global UnifiedEventBus
    // These are registered in setupNoteEventIntegration() and must be explicitly removed
    // to prevent listener leaks on the singleton when a workspace is deleted
    if (this.noteCreatedListener) {
      unifiedEventBus.offDomainEvent('note:created', this.noteCreatedListener);
      this.noteCreatedListener = undefined;
    }
    if (this.noteUpdatedListener) {
      unifiedEventBus.offDomainEvent('note:updated', this.noteUpdatedListener);
      this.noteUpdatedListener = undefined;
    }
    if (this.noteDeletedListener) {
      unifiedEventBus.offDomainEvent('note:deleted', this.noteDeletedListener);
      this.noteDeletedListener = undefined;
    }

    // Clean up event bus
    await this.eventBus.clear();

    // Remove all listeners
    this.removeAllListeners();

    logger.info('WorkspaceEventService disposed');
  }

  /**
   * Alias for dispose for compatibility
   */
  destroy(): void {
    this.dispose().catch((error) => {
      logger.error('Error during destroy', { error });
    });
  }
}

// NOTE: Singleton instance management is handled in ./index.ts
// Use getWorkspaceEventService and cleanupWorkspaceEventService from there
