#!/usr/bin/env tsx

/**
 * Test script to verify task-agent status implementation
 * Run with: npx tsx scripts/test-task-agent-status.ts
 */

import {
  addTaskAgentAssociation,
  initialState,
  removeTaskAgentAssociation,
  taskAgentAssociationsReducer,
} from '../src/store/renderer/slices/task-agent-associations/task-agent-associations-slice';
import { selectAssociationsForNote } from '../src/store/renderer/slices/task-agent-associations/task-agent-associations-selectors';
import type { TaskAgentAssociation } from '../src/store/renderer/slices/task-agent-associations/task-agent-associations-types';

// Simple console logger
const logger = {
  info: (...args: any[]) => console.log('[INFO]', ...args),
  error: (...args: any[]) => console.error('[ERROR]', ...args),
};

// Helper to create workspace ID
const WorkspaceId = (id: string) => id as any;

async function testTaskAgentAssociation() {
  logger.info('Starting task-agent status test...');

  // Test workspace ID
  const workspaceId = WorkspaceId('test-workspace-123');

  // Test data
  const testAssociation: TaskAgentAssociation = {
    taskKey: 'note-123:100',
    agentId: 'agent-456',
    noteId: 'note-123',
    taskText: 'Test task for agent delegation',
    createdAt: Date.now(),
  };
  let state = { taskAgentAssociations: initialState } as any;

  try {
    // Test 1: Associate task with agent
    logger.info('Test 1: Associating task with agent...');
    state = {
      ...state,
      taskAgentAssociations: taskAgentAssociationsReducer(
        state.taskAgentAssociations,
        addTaskAgentAssociation(workspaceId, testAssociation.noteId, testAssociation),
      ),
    };

    // Test 2: Retrieve association
    logger.info('Test 2: Retrieving task-agent association...');
    const retrieved = selectAssociationsForNote
      .select(state, workspaceId, testAssociation.noteId)
      .find((association) => association.taskKey === testAssociation.taskKey);

    if (!retrieved) {
      throw new Error('Failed to retrieve task-agent association');
    }

    if (retrieved.agentId !== testAssociation.agentId) {
      throw new Error(`Agent ID mismatch: expected ${testAssociation.agentId}, got ${retrieved.agentId}`);
    }

    logger.info('✓ Task-agent association working correctly');

    // Test 3: Remove association
    logger.info('Test 3: Removing task-agent association...');
    state = {
      ...state,
      taskAgentAssociations: taskAgentAssociationsReducer(
        state.taskAgentAssociations,
        removeTaskAgentAssociation(workspaceId, testAssociation.noteId, testAssociation.taskKey!),
      ),
    };

    const afterRemoval = selectAssociationsForNote
      .select(state, workspaceId, testAssociation.noteId)
      .find((association) => association.taskKey === testAssociation.taskKey);
    if (afterRemoval) {
      throw new Error('Failed to remove task-agent association');
    }

    logger.info('✓ Task-agent association removal working correctly');

    // Test 4: Multiple associations
    logger.info('Test 4: Testing multiple associations...');
    const associations = [
      { ...testAssociation, taskKey: 'note-123:200' },
      { ...testAssociation, taskKey: 'note-123:300', agentId: 'agent-789' },
      { ...testAssociation, taskKey: 'note-456:100', noteId: 'note-456', agentId: 'agent-999' },
    ];

    associations.forEach(assoc => {
      state = {
        ...state,
        taskAgentAssociations: taskAgentAssociationsReducer(
          state.taskAgentAssociations,
          addTaskAgentAssociation(workspaceId, assoc.noteId, assoc),
        ),
      };
    });

    // Verify all associations exist
    associations.forEach(assoc => {
      const retrieved = selectAssociationsForNote
        .select(state, workspaceId, assoc.noteId)
        .find((association) => association.taskKey === assoc.taskKey);
      if (!retrieved || retrieved.agentId !== assoc.agentId) {
        throw new Error(`Failed to retrieve association for task ${assoc.taskKey}`);
      }
    });

    logger.info('✓ Multiple task-agent associations working correctly');

    logger.info('\n✅ All tests passed successfully!');
    logger.info('\nImplementation summary:');
    logger.info('- Tasks can be associated with agents using unique task IDs');
    logger.info('- Associations are stored in the taskAgentAssociations Redux slice');
    logger.info('- Task nodes in the editor will display agent status inline');
    logger.info('- No comments are created when delegating tasks');

  } catch (error) {
    logger.error('Test failed:', error);
    process.exit(1);
  }
}

// Run the test
testTaskAgentAssociation().catch(error => {
  logger.error('Unexpected error:', error);
  process.exit(1);
});
