/**
 * Builder for the `ws.event` JavaScript API surface.
 */

import { AgentEventTools, type AgentEventFilter } from '../../../events/main';
import { agentSubscribe, agentUnsubscribe } from '../../../events/main/agent-subscription-ops';
import { EventStore } from '../../../events/main/event-store';
import { EventQueryEngine } from '../../../events/main/event-query-engine';
import type { EventFilter } from '../../../events/types';
import { Logger } from '../../../../shared/logger';
import { WorkspaceConfig } from '../../../../shared/main/config';
import { getOrCreateEventStore } from '../../../../store/main/slices/workspace-events/sagas/persistence-saga';
import type { ToolCall } from './protocol';

const logger = new Logger('WsEventApi');

export interface EventQueryOptions {
  eventType?: string;
  actorType?: string;
  actorId?: string;
  path?: string;
  minutesAgo?: number;
  limit?: number;
}

export interface EventSubscribeOptions {
  excludeSelf?: boolean;
  batchWindow?: number;
}

export const VALID_EVENT_CATEGORY_WILDCARDS = [
  'agent:*', 'file:*', 'task:*', 'git:*', 'note:*',
  'terminal:*', 'test:*', 'build:*', 'workspace:*',
  'spec:*', 'goal:*', 'comment:*',
] as const;

function getRequiredAgentContext(call: ToolCall): { agentId: string; agentName: string } {
  const agentId = call.context?.agentId;
  if (!agentId) {
    throw new Error('Could not determine agent ID from request context');
  }

  return {
    agentId,
    agentName: call.context?.agentName || agentId,
  };
}

function buildQueryFilters(options: EventQueryOptions = {}): EventFilter[] {
  const filters: EventFilter[] = [];

  if (options.eventType) {
    filters.push({ field: 'type', operator: 'equals', value: options.eventType });
  }
  if (options.actorType) {
    filters.push({ field: 'actor.type', operator: 'equals', value: options.actorType });
  }
  if (options.actorId) {
    filters.push({ field: 'actor.id', operator: 'equals', value: options.actorId });
  }
  if (options.path) {
    filters.push({ field: 'data.path', operator: 'starts_with', value: options.path });
  }
  if (options.minutesAgo) {
    const since = new Date(Date.now() - options.minutesAgo * 60 * 1000).toISOString();
    filters.push({ field: 'timestamp', operator: 'greater_than', value: since });
  }

  filters.push({ field: '_limit', operator: 'equals', value: options.limit || 50 });
  return filters;
}

function resolveSubscriptionEventTypes(eventTypes: string[]): string[] {
  if (!eventTypes || eventTypes.length === 0) {
    throw new Error(
      'eventTypes is required. Specify category wildcards like "agent:*", "file:*" or specific types like "agent:idle".',
    );
  }

  const resolvedTypes: string[] = [];
  for (const eventType of eventTypes) {
    if (eventType === '*') {
      resolvedTypes.push(...VALID_EVENT_CATEGORY_WILDCARDS);
      continue;
    }
    resolvedTypes.push(eventType);
  }

  return resolvedTypes;
}

export function buildWsEventApi(workspaceId: string, call: ToolCall) {
  const storageDir = WorkspaceConfig.paths.metadata(workspaceId);
  const store = getOrCreateEventStore(workspaceId, storageDir, EventStore);
  const queryEngine = new EventQueryEngine(store);
  const agentTools = new AgentEventTools(queryEngine);

  return {
    async recentFiles(limit?: number) {
      logger.debug('ws.event.recentFiles', { workspaceId, limit: limit || 10 });
      await store.initialize();
      return agentTools.getRecentFiles(limit || 10);
    },

    async agentActivity(agentId?: string, minutesAgo?: number) {
      logger.debug('ws.event.agentActivity', { workspaceId, agentId, minutesAgo: minutesAgo || 30 });
      await store.initialize();
      if (agentId) {
        return agentTools.getAgentFiles(agentId, 100);
      }
      return agentTools.getAgentActivity(minutesAgo || 30);
    },

    async workspaceSummary(minutesAgo?: number) {
      logger.debug('ws.event.workspaceSummary', { workspaceId, minutesAgo: minutesAgo || 60 });
      await store.initialize();
      return agentTools.getWorkspaceSummary(minutesAgo || 60);
    },

    async directoryChanges(dir: string, limit?: number) {
      if (!dir) {
        throw new Error('Directory path is required');
      }
      logger.debug('ws.event.directoryChanges', { workspaceId, dir, limit: limit || 20 });
      await store.initialize();
      return agentTools.getDirectoryChanges(dir, limit || 20);
    },

    async query(options: EventQueryOptions = {}) {
      logger.debug('ws.event.query', { workspaceId, options });
      await store.initialize();
      return queryEngine.query(buildQueryFilters(options));
    },

    async subscribe(eventTypes: string[], options: EventSubscribeOptions = {}) {
      const { agentId, agentName } = getRequiredAgentContext(call);
      const resolvedTypes = resolveSubscriptionEventTypes(eventTypes);

      logger.info('ws.event.subscribe', { workspaceId, agentId, eventTypes: resolvedTypes });

      const filter: AgentEventFilter = {
        eventTypes: resolvedTypes,
        excludeActorIds: options.excludeSelf !== false ? [agentId] : undefined,
        batchWindow: options.batchWindow || 500,
      };

      const subscriptionId = agentSubscribe(workspaceId, agentId, agentName, filter);
      return { subscriptionId, eventTypes: resolvedTypes };
    },

    async unsubscribe(subscriptionId: string) {
      if (!subscriptionId) {
        throw new Error('subscriptionId is required');
      }

      logger.info('ws.event.unsubscribe', { workspaceId, subscriptionId });

      const success = agentUnsubscribe(workspaceId, subscriptionId);

      if (!success) {
        throw new Error('Subscription not found');
      }

      return { ok: true, subscriptionId };
    },
  };
}

export type WsEventApi = ReturnType<typeof buildWsEventApi>;