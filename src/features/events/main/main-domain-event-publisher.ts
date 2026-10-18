import { sendToWorkspaceWindows } from '$features/system/main/system.ipc';
import { ANY_HOST } from '$features/system/main/window-workspace-tracking';
import type { DomainEvent, DomainEventPayloads } from '../types';

/**
 * Publish a main-process-owned domain event to the matching workspace windows.
 * ANY_HOST: main-owned events carry no host today, so they reach every host's
 * windows holding `workspaceId` (unchanged behaviour).
 */
export function publishMainDomainEvent<E extends DomainEvent>(
  workspaceId: string | undefined,
  type: E,
  payload: DomainEventPayloads[E],
): void {
  sendToWorkspaceWindows(workspaceId, type, payload, ANY_HOST);
}
