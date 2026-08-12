import { sendToWorkspaceWindows } from '$features/system/main/system.ipc';
import type { DomainEvent, DomainEventPayloads } from '../types';

/** Publish a main-process-owned domain event to the matching workspace windows. */
export function publishMainDomainEvent<E extends DomainEvent>(
  workspaceId: string | undefined,
  type: E,
  payload: DomainEventPayloads[E],
): void {
  sendToWorkspaceWindows(workspaceId, type, payload);
}
