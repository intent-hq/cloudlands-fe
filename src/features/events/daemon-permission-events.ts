import type { WorkspaceEvent } from './types';
import type { PermissionRequest } from '../../store/renderer/slices/permission/permission-types';
import {
  permissionRequestReceived,
  removePermissionRequest,
} from '../../store/renderer/slices/permission/permission-slice';

/**
 * `agent:permission:request` (PROTOCOL §8) carries the normalized
 * `PermissionRequestData` -- `{ requestId, sessionId, title, description?,
 * options[], agentName?, riskLevel?, timestamp }` -- exactly the shape the
 * `PermissionRequest` slice type declares. Coerce the wire payload into the
 * slice type and dispatch `permissionRequestReceived` so the inline chat
 * prompt renders. The BE is the source of truth for `requestId` (used by
 * `agent.respondPermission` to route the answer back).
 */
export function handlePermissionRequestEvent(
  event: WorkspaceEvent,
  dispatch: (action: ReturnType<typeof permissionRequestReceived>) => unknown,
): void {
  const data = (event as { data?: Record<string, unknown> }).data;
  if (!data) return;
  const requestId = data.requestId;
  const sessionId = data.sessionId;
  const title = data.title;
  if (
    typeof requestId !== 'string' ||
    requestId.length === 0 ||
    typeof sessionId !== 'string' ||
    sessionId.length === 0 ||
    typeof title !== 'string'
  ) {
    return;
  }
  const rawOptions = Array.isArray(data.options) ? data.options : [];
  const options: PermissionRequest['options'] = [];
  for (const raw of rawOptions) {
    if (!raw || typeof raw !== 'object') continue;
    const id = (raw as { id?: unknown }).id;
    const label = (raw as { label?: unknown }).label;
    if (typeof id !== 'string' || typeof label !== 'string') continue;
    const description = (raw as { description?: unknown }).description;
    const destructive = (raw as { destructive?: unknown }).destructive;
    options.push({
      id,
      label,
      ...(typeof description === 'string' ? { description } : {}),
      ...(typeof destructive === 'boolean' ? { destructive } : {}),
    });
  }
  const description = data.description;
  const agentName = data.agentName;
  const riskLevelRaw = data.riskLevel;
  const timestamp = data.timestamp;
  const request: PermissionRequest = {
    requestId,
    ...(event.workspaceId ? { workspaceId: event.workspaceId } : {}),
    sessionId,
    title,
    description: typeof description === 'string' || description === null ? description : undefined,
    options,
    ...(typeof agentName === 'string' ? { agentName } : {}),
    ...(riskLevelRaw === 'low' || riskLevelRaw === 'medium' || riskLevelRaw === 'high'
      ? { riskLevel: riskLevelRaw }
      : {}),
    timestamp: typeof timestamp === 'number' ? timestamp : Date.now(),
  };
  dispatch(permissionRequestReceived(request));
}

/**
 * `agent:permission:resolved` (PROTOCOL §8) carries `{ requestId, outcome }`
 * once the BE has forwarded the chosen outcome to the blocked provider (either
 * because a client answered via `agent.respondPermission` or because the
 * 5-minute timeout elapsed and cancelled the prompt). Clear the local entry so
 * the inline prompt disappears; a reducer no-op is safe if the FE already
 * removed it optimistically.
 */
export function handlePermissionResolvedEvent(
  event: WorkspaceEvent,
  dispatch: (action: ReturnType<typeof removePermissionRequest>) => unknown,
): void {
  const data = (event as { data?: Record<string, unknown> }).data;
  if (!data) return;
  const requestId = data.requestId;
  if (typeof requestId !== 'string' || requestId.length === 0) return;
  dispatch(removePermissionRequest(requestId));
}
