/**
 * Workspace Factory
 *
 * Creates test data for workspace-related tests.
 */

import { v4 as uuidv4 } from 'uuid';
import { ThreadId } from '$shared/types/branded-ids';
import { faker } from '@faker-js/faker';
import { unifiedIdService } from '$shared/services/unified-id.service';
import type { WorkspaceId, AgentId, SessionId, Workspace } from '$shared/types';
import type { MessageId } from '$shared/types/branded-ids';
import { WorkspaceStatus } from '$shared/types';

/**
 * Creates a test workspace ID
 */
export function createTestWorkspaceId(): WorkspaceId {
  return unifiedIdService.generateWorkspaceId();
}

/**
 * Creates a test agent ID
 */
export function createTestAgentId(): AgentId {
  return unifiedIdService.generateAgentId();
}

/**
 * Creates a test session ID
 */
export function createTestSessionId(): SessionId {
  return unifiedIdService.generateSessionId();
}

/**
 * Creates a test message ID
 */
export function createTestMessageId(): MessageId {
  return unifiedIdService.generateMessageId();
}

/**
 * Creates a test thread ID
 */
export function createTestThreadId(): ThreadId {
  return ThreadId(`thread_${uuidv4()}`);
}

/**
 * Creates a test workspace name
 */
export function createTestWorkspaceName(): string {
  return `${faker.company.name()} Space`;
}

/**
 * Creates a test file path
 */
export function createTestFilePath(): string {
  return `/${faker.system.directoryPath()}/${faker.system.fileName()}`;
}

/**
 * Creates a test directory path
 */
export function createTestDirectoryPath(): string {
  return `/${faker.system.directoryPath()}`;
}

/**
 * Creates a mock workspace for testing
 */
export function createMockWorkspace(): Workspace {
  const workspaceId = createTestWorkspaceId();
  const now = new Date().toISOString();
  return {
    id: workspaceId,
    title: createTestWorkspaceName(),
    branch: 'main',
    changesets: [] as any[],
    timeline: [] as any[],
    conversationInfo: [] as any[],
    status: WorkspaceStatus.Active,
    repositoryPath: createTestDirectoryPath(),
    worktreePath: createTestDirectoryPath(),
    createdAt: now,
    updatedAt: now,
  };
}
