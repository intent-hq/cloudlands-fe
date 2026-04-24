/**
 * Branded IDs Usage Examples
 *
 * This file demonstrates how to use branded IDs throughout the application.
 * These are examples only - not meant to be executed.
 */

import { v4 as uuidv4 } from 'uuid';
import { createMessageId } from '$shared/types/branded-ids';
import { IdGenerator } from '../services/id-generator';
import { unifiedIdService } from '$shared/services/unified-id.service';
import type { AgentId, WorkspaceId } from './branded-ids';
import * as BrandedIds from './branded-ids';
import * as Migration from './branded-ids.migration';

// ============================================================================
// Example 1: Creating IDs
// ============================================================================

export function exampleCreatingIds() {
  // Generate new IDs
  const agentId = unifiedIdService.generateAgentId();
  const sessionId = unifiedIdService.generateAgentId();
  const messageId = createMessageId(uuidv4());
  const workspaceId = unifiedIdService.generateWorkspaceId();

  // IDs are typed at compile time
  // agentId has type AgentId
  // sessionId has type SessionId
  // etc.

  console.log('Generated IDs:', { agentId, sessionId, messageId, workspaceId });
}

// ============================================================================
// Example 2: Type-Safe Function Signatures
// ============================================================================

// Example interfaces (not exported to avoid duplication)
interface Agent {
  id: AgentId;
  name: string;
  workspaceId: WorkspaceId;
}

// Type-safe function - can only accept AgentId
 
export function getAgent(_id: AgentId): Agent | null {
  // Implementation
  return null;
}

// Type-safe function - can only accept SessionId
 
export function getSession(_id: AgentId): any {
  // Implementation
  return null;
}

// ============================================================================
// Example 3: Validation and Type Guards
// ============================================================================

export function exampleValidation(someString: string) {
  // Check if string is valid AgentId
  if (BrandedIds.isValidAgentId(someString)) {
    const agentId = BrandedIds.AgentId(someString);
    // Now agentId has type AgentId
    getAgent(agentId);
  }

  // Assert that string is valid AgentId
  try {
    BrandedIds.assertAgentId(someString);
    // If we get here, someString is a valid AgentId
  } catch (error) {
    console.error('Invalid agent ID:', error);
  }
}

// ============================================================================
// Example 4: Safe ID Creation with Validation
// ============================================================================

export function exampleSafeCreation(someString: string) {
  try {
    // This will throw if the string is not a valid AgentId
    const agentId = BrandedIds.createAgentId(someString);
    getAgent(agentId);
  } catch (error) {
    console.error('Failed to create agent ID:', error);
  }
}

// ============================================================================
// Example 5: Batch Generation
// ============================================================================

export function exampleBatchGeneration() {
  // Generate multiple IDs at once
  const agentIds = IdGenerator.generateAgentIdBatch(10);
  const sessionIds = IdGenerator.generateSessionIdBatch(5);
  const messageIds = IdGenerator.generateMessageIdBatch(20);

  console.log('Generated batches:', {
    agentCount: agentIds.length,
    sessionCount: sessionIds.length,
    messageCount: messageIds.length,
  });
}

// ============================================================================
// Example 6: Migration from String IDs
// ============================================================================

export function exampleMigration() {
  // Old data with string IDs
  const oldAgent = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    name: 'Test Agent',
    workspaceId: '550e8400-e29b-41d4-a716-446655440001',
  };

  // Migrate to branded IDs
  const migratedAgent = Migration.migrateToBrandedIds(oldAgent);
  // Now migratedAgent.id has type AgentId
  // And migratedAgent.workspaceId has type WorkspaceId

  // Validate the migration
  if (Migration.validateBrandedIds(migratedAgent)) {
    console.log('Migration successful');
  }
}

// ============================================================================
// Example 7: Deep Migration for Nested Structures
// ============================================================================

export function exampleDeepMigration() {
  const oldWorkspace = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    agents: [
      {
        id: '550e8400-e29b-41d4-a716-446655440001',
        messages: [
          { id: 'msg_550e8400-e29b-41d4-a716-446655440002' },
          { id: 'msg_550e8400-e29b-41d4-a716-446655440003' },
        ],
      },
    ],
  };

  // Deep migration handles nested structures
  Migration.migrateToBrandedIdsDeep(oldWorkspace);
  // Now all IDs at all levels are branded
}

// ============================================================================
// Example 8: Type Safety Prevents Errors
// ============================================================================

export function exampleTypeSafety() {
  const agentId = unifiedIdService.generateAgentId();
  unifiedIdService.generateAgentId();

  // ✅ Correct - types match
  getAgent(agentId);

  // ❌ Compile error - types don't match
  // getAgent(sessionId); // Error: AgentId is not assignable to AgentId

  // This error is caught at compile time, not runtime!
}
