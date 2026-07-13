/**
 * Test Factories
 *
 * Centralized test data creation for consistent test setup.
 * Includes factory functions and builder patterns.
 */

// Agent factory functions
export {
  createTestAgent,
  createTestMessage,
  createTestContentBlock,
  createTestToolUseBlock,
  createTestToolResultBlock,
} from './agent.factory';

// Builder patterns
export { AgentBuilder, MessageBuilder } from './builders';

// Scenario factories
export {
  createAgentWithConversation,
  createErrorAgent,
  createStreamingAgent,
  createInitialAgent,
  createBackgroundAgent,
  createPendingAgent,
  createMultipleAgents,
} from './scenarios.factory';

// Workspace factories
export {
  createTestWorkspaceId,
  createTestAgentId,
  createTestSessionId,
  createTestMessageId,
  createTestThreadId,
  createTestWorkspaceName,
  createTestFilePath,
  createTestDirectoryPath,
} from './workspace.factory';
