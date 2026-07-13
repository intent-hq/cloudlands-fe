import type { WorkspaceEvent } from '../../../../../features/events/types';
import type { QueuedEventRecord } from '../agent-subscriptions-slice';

export function buildSweepCatchUpEventId(
  subscriptionId: string,
  actorId: string,
  eventType: string,
): string {
  return `sweep-catchup:${subscriptionId}:${actorId}:${eventType}`;
}

function parseSweepCatchUpEventId(eventId: string | undefined): {
  subscriptionId: string;
  actorId: string;
  eventType: string;
} | null {
  if (!eventId?.startsWith('sweep-catchup:')) return null;
  const [, subscriptionId, actorId, ...eventTypeParts] = eventId.split(':');
  const eventType = eventTypeParts.join(':');
  if (!subscriptionId || !actorId || !eventType) return null;
  return { subscriptionId, actorId, eventType };
}

function isSyntheticCatchUpEvent(event: WorkspaceEvent): boolean {
  return (
    event.data?.catchUp === true ||
    (typeof event.id === 'string' && event.id.startsWith('sweep-catchup:'))
  );
}

function getAgentActorId(event: WorkspaceEvent): string | undefined {
  return event.actor?.id || (event.data?.agentId as string | undefined);
}

function getQueuedSemanticKey(record: QueuedEventRecord): string | undefined {
  const event = record.event as WorkspaceEvent;
  const parsedCatchUpId = parseSweepCatchUpEventId(event.id);
  const subscriptionId = record.subscriptionId || parsedCatchUpId?.subscriptionId;
  const actorId = getAgentActorId(event) || parsedCatchUpId?.actorId;
  const eventType = event.type || parsedCatchUpId?.eventType;
  if (!subscriptionId || !actorId || !eventType?.startsWith('agent:')) return undefined;
  return `${subscriptionId}:${actorId}:${eventType}`;
}

export function deduplicateCatchUpQueuedEvents(records: QueuedEventRecord[]): QueuedEventRecord[] {
  const semanticIndexes = new Map<string, number>();
  const deduped: QueuedEventRecord[] = [];

  for (const record of records) {
    const key = getQueuedSemanticKey(record);
    if (!key) {
      deduped.push(record);
      continue;
    }

    const existingIndex = semanticIndexes.get(key);
    if (existingIndex == null) {
      semanticIndexes.set(key, deduped.length);
      deduped.push(record);
      continue;
    }

    const existing = deduped[existingIndex];
    if (
      isSyntheticCatchUpEvent(existing.event as WorkspaceEvent) &&
      !isSyntheticCatchUpEvent(record.event as WorkspaceEvent)
    ) {
      deduped[existingIndex] = record;
    }
  }

  return deduped;
}
