/**
 * Workspace Event System
 *
 * Provides typed, filterable event management for workspace components.
 */

export {
  WorkspaceEventBus,
  EventFilterBuilder,
  getWorkspaceEventBus,
  disposeWorkspaceEventBus,
} from './workspace-event-bus';
export { EventStore } from './event-store';
export { EventFilterEngine } from '../event-filter-engine';
export { EventQueryEngine } from './event-query-engine';
export { AgentEventTools, workspaceEventTools } from './agent-event-tools';
export {
  WorkspaceEventService,
  type WorkspaceEventServiceOptions,
} from './workspace-event-service';
export {
  eventHandlerRegistry,
  type EventHandler,
  type RegisterHandlerOptions,
} from './event-handler-registry';
export { registerEventTriggeredAgents } from './event-triggered-agents';
export {
  AgentEventSubscriptionService,
  getAgentEventSubscriptionService,
  disposeAgentEventSubscriptionService,
  type AgentEventFilter,
  type AgentSubscription,
  type AgentStatus as AgentEventStatus,
} from './agent-event-subscription.service';

export * from '../types';

// Re-export commonly used types for convenience
export type {
  WorkspaceEvent,
  WorkspaceEventType,
  EventActor,
  ActorType,
  EventFilter,
  FilterOperator,
  EventSubscription,
  SubscribeOptions,
  FileChangedEvent,
  AgentToolCallEvent,
  AgentMessageEvent,
  GitOperationEvent,
  NoteChangedEvent,
} from '../types';

// Singleton management for workspace event services
import { WorkspaceEventService, WorkspaceEventServiceOptions } from './workspace-event-service';
import { Logger } from '../../../shared/logger';

const logger = new Logger('EventSystem');
const eventServiceInstances = new Map<string, WorkspaceEventService>();

/**
 * Get or create a workspace event service instance
 * @param workspaceIdOrOptions - The workspace ID string or full options object
 * @returns The event service instance for the workspace
 */
export function getWorkspaceEventService(
  workspaceIdOrOptions: string | WorkspaceEventServiceOptions,
): WorkspaceEventService {
  const workspaceId =
    typeof workspaceIdOrOptions === 'string'
      ? workspaceIdOrOptions
      : workspaceIdOrOptions.workspaceId;

  // Check if we already have an instance
  const existingService = eventServiceInstances.get(workspaceId);
  if (existingService) {
    // If we have an existing service but new options include a changeDetector, update it
    if (typeof workspaceIdOrOptions === 'object' && workspaceIdOrOptions.changeDetector) {
      const currentOptions = existingService.getOptions();
      // Only update if the change detector is different
      if (
        !currentOptions.changeDetector ||
        currentOptions.changeDetector !== workspaceIdOrOptions.changeDetector
      ) {
        logger.info('Updating existing event service with new change detector', { workspaceId });
        existingService.updateChangeDetector(workspaceIdOrOptions.changeDetector);
      } else {
        logger.info('Event service already has this change detector, skipping update', {
          workspaceId,
        });
      }
    } else {
      logger.info('Returning existing event service (no change detector provided)', {
        workspaceId,
      });
    }
    return existingService;
  }

  // Create new instance
  logger.info('Creating new event service instance', { workspaceId });
  const options =
    typeof workspaceIdOrOptions === 'string'
      ? { workspaceId: workspaceIdOrOptions }
      : workspaceIdOrOptions;
  const service = new WorkspaceEventService(options);
  eventServiceInstances.set(workspaceId, service);
  return service;
}

/**
 * Clean up a workspace event service instance
 * @param workspaceId - The workspace ID to clean up
 */
export async function cleanupWorkspaceEventService(workspaceId: string): Promise<void> {
  const service = eventServiceInstances.get(workspaceId);
  if (service) {
    logger.debug('Cleaning up event service instance', { workspaceId });
    eventServiceInstances.delete(workspaceId);
    // Dispose the service to clean up listeners and resources
    await service.dispose();
    logger.info('Event service instance disposed', { workspaceId });
  }
}
