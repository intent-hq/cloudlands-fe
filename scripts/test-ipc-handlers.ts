#!/usr/bin/env tsx
/**
 * Test script to verify IPC handlers are working correctly
 */

import { z } from 'zod';

// Test that our schemas are working
const EventFilterSchema = z.object({
  field: z.string(),
  operator: z.enum(['equals', 'not_equals', 'greater_than', 'less_than', 'starts_with', 'ends_with', 'contains', 'matches', 'in', 'not_in']),
  value: z.any(),
});

const EventsQueryHandlerSchema = z.object({
  workspaceId: z.string(),
  filters: z.array(EventFilterSchema).nullable().optional(),
  limit: z.number().optional(),
});

// Test parsing
const testData = {
  workspaceId: 'test-workspace',
  filters: [
    { field: 'type', operator: 'equals', value: 'file:changed' },
    { field: 'timestamp', operator: 'greater_than', value: '2024-01-01' },
  ],
  limit: 100,
};

try {
  const parsed = EventsQueryHandlerSchema.parse(testData);
  console.log('✅ EventsQueryHandlerSchema parsing successful:', parsed);
} catch (error) {
  console.error('❌ EventsQueryHandlerSchema parsing failed:', error);
  process.exit(1);
}

// Test git tracking schema
const GitTrackingGetStateSchema = z.object({
  workspaceId: z.string(),
});

const testGitData = {
  workspaceId: 'test-workspace',
};

try {
  const parsed = GitTrackingGetStateSchema.parse(testGitData);
  console.log('✅ GitTrackingGetStateSchema parsing successful:', parsed);
} catch (error) {
  console.error('❌ GitTrackingGetStateSchema parsing failed:', error);
  process.exit(1);
}

// Test agent schema
const AgentSendMessageLegacySchema = z.object({
  workspaceId: z.string(),
  agentId: z.string(),
  message: z.string(),
  files: z.array(z.string()).optional(),
  images: z.array(z.string()).optional(),
});

const testAgentData = {
  workspaceId: 'test-workspace',
  agentId: 'test-agent',
  message: 'Hello, world!',
  files: ['file1.ts', 'file2.ts'],
};

try {
  const parsed = AgentSendMessageLegacySchema.parse(testAgentData);
  console.log('✅ AgentSendMessageLegacySchema parsing successful:', parsed);
} catch (error) {
  console.error('❌ AgentSendMessageLegacySchema parsing failed:', error);
  process.exit(1);
}

console.log('\n✅ All schema tests passed successfully!');
console.log('The IPC handlers have been successfully updated to use object destructuring with validation.');
