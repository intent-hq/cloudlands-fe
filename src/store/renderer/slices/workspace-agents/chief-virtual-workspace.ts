import { WorkspaceStatus } from '$shared/types';
import type { Workspace } from '$shared/types';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import { m } from '$shared/paraglide/messages.js';

const CHIEF_WORKSPACE_TIMESTAMP = '2026-01-01T00:00:00.000Z';

export function createChiefVirtualWorkspace(): Workspace {
  return {
    id: CHIEF_WORKSPACE_ID,
    title: m.workspace_chiefVirtual_title(),
    branch: '',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: WorkspaceStatus.Active,
    createdAt: CHIEF_WORKSPACE_TIMESTAMP,
    updatedAt: CHIEF_WORKSPACE_TIMESTAMP,
    lastActivity: CHIEF_WORKSPACE_TIMESTAMP,
  };
}
