/**
 * Tests for AgentTypeId type safety
 *
 * Ensures that the AgentTypeId type union stays in sync with the actual
 * instruction IDs available in the instruction registry.
 */

import { describe, it, expect } from 'vitest';
import { getAvailableInstructionIds } from '../../../features/agent/instructions';
import type { AgentTypeId } from '../agent.types';

describe('AgentTypeId', () => {
  it('should include all agent type instruction IDs', () => {
    // Get the actual instruction IDs from the registry
    const availableIds = getAvailableInstructionIds();

    // Define the expected type union members
    // This should match the AgentTypeId type definition
    const expectedTypeIds: AgentTypeId[] = [
      'chat',
      'code-review',
      'code-walkthrough',
      'commit-message',
      'common',
      'debug',
      'pr-description',
      'ralph-loop',
      'setup-script-generator',
      'task-breakdown',
      'task-debug',
      'task-focused',
      'task-loop',
      'workspace',
      'workspace-agent',
    ];

    // Shared documentation files that are NOT agent types
    const sharedDocs = ['notes-system-guide'];

    // Check that every available instruction ID (except shared docs) is in the type union
    for (const id of availableIds) {
      if (sharedDocs.includes(id)) {
        continue; // Skip shared documentation
      }
      expect(
        expectedTypeIds.includes(id as AgentTypeId),
        `Instruction ID "${id}" is available but not in AgentTypeId type union. ` +
          'Please add it to the AgentTypeId type in src/shared/types/agent.types.ts',
      ).toBe(true);
    }

    // Check that every type union member has a corresponding instruction
    for (const typeId of expectedTypeIds) {
      expect(
        availableIds.includes(typeId),
        `AgentTypeId "${typeId}" is in the type union but has no corresponding instruction. ` +
          'Please remove it from the AgentTypeId type or add the instruction file.',
      ).toBe(true);
    }

    // Ensure counts match (excluding shared docs)
    const agentTypeCount = availableIds.length - sharedDocs.length;
    expect(
      expectedTypeIds.length,
      `AgentTypeId type union has ${expectedTypeIds.length} members but ` +
        `${agentTypeCount} agent type instructions are available (${availableIds.length} total, ${sharedDocs.length} shared docs). Please sync them.`,
    ).toBe(agentTypeCount);
  });

  it('should not include notes-system-guide in AgentTypeId', () => {
    // notes-system-guide is a shared documentation file, not an agent type
    const availableIds = getAvailableInstructionIds();
    const expectedTypeIds: AgentTypeId[] = [
      'chat',
      'code-review',
      'code-walkthrough',
      'commit-message',
      'common',
      'debug',
      'pr-description',
      'ralph-loop',
      'setup-script-generator',
      'task-breakdown',
      'task-debug',
      'task-focused',
      'task-loop',
      'workspace',
      'workspace-agent',
    ];

    // notes-system-guide should be in available IDs but not in type union
    expect(availableIds.includes('notes-system-guide')).toBe(true);
    expect(expectedTypeIds.includes('notes-system-guide' as AgentTypeId)).toBe(false);
  });
});
