import type { DesktopPermissionRequest, DesktopPermissionState } from '$shared/types/desktop';
export const permission: DesktopPermissionState = {
  computerId: 'computer',
  computerName: 'Windows workstation',
  allowed: false,
};
export const request: DesktopPermissionRequest = {
  workspaceId: 'workspace',
  agentId: 'agent',
  agentName: 'Implementor',
  requestId: 'request',
  computerId: permission.computerId,
  computerName: permission.computerName,
  expiresAt: new Date(Date.now() + 300_000).toISOString(),
  options: [
    { id: 'allow_once', label: 'Allow once' },
    { id: 'allow_future', label: 'Allow future sessions for this agent' },
    { id: 'deny', label: 'Deny' },
  ],
};
