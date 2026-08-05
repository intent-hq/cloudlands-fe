/**
 * IPC Request Validation
 *
 * Provides Zod schemas for validating IPC requests at runtime.
 * Ensures all IPC payloads conform to their contracts before processing.
 *
 * Usage:
 *   const validated = validateIpcRequest('agent:create', request);
 *   // validated is type-safe and guaranteed to match AgentIpc.CreateRequest
 */

import { z } from 'zod';
import type { IpcContractMap } from './contracts';

// ============================================================================
// UUID and ID Schemas
// ============================================================================

const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;



// Workspace IDs can be:
// 1. New slug format: word-word (e.g., "amber-forest", "auth-refactor")
// 2. New slug with collision suffix: word-word-N (e.g., "amber-forest-2")
// 3. Legacy slug format: word-word-xxxx (e.g., "amber-forest-a7x2") for backward compatibility
// 4. Legacy UUID format for backward compatibility
const WORKSPACE_SLUG_PATTERN = /^[a-z]{2,15}-[a-z]{2,15}(-[0-9]+)?$/;
const LEGACY_WORKSPACE_SLUG_PATTERN = /^[a-z]{2,15}-[a-z]{2,15}-[a-z0-9]{4}$/;
const WorkspaceIdSchema = z
  .string()
  .refine(
    (id) =>
      WORKSPACE_SLUG_PATTERN.test(id) ||
      LEGACY_WORKSPACE_SLUG_PATTERN.test(id) ||
      UUID_PATTERN.test(id),
    'Invalid workspace ID format (expected slug like "amber-forest" or "amber-forest-2" or UUID)',
  );

// Agent IDs can be UUIDs or custom format with prefix (e.g., "agent_123", "agt_abc", or just UUID)
const AgentIdSchema = z.string().regex(/^[a-zA-Z0-9_-]+$/i, 'Invalid agent ID format');

// Note: SessionIdSchema, MessageIdSchema, and StreamIdSchema are not needed for request validation
// as these IDs are generated server-side and only appear in responses

// ============================================================================
// Agent IPC Schemas
// ============================================================================

export const AgentCreateRequestSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  // workspacePath and name are optional - handler can derive them from workspace and instruction
  workspacePath: z.string().optional(),
  name: z.string().max(100, 'Agent name too long').optional(),
  agentId: AgentIdSchema.optional(),
  nameExplicitlySet: z.boolean().optional(), // Strict boolean on the wire (PROTOCOL §5.5) — non-boolean values must fail validation
  model: z.string().optional(),
  provider: z.string().optional(), // Provider ID (e.g., 'auggie', 'claude-code', 'codex')
  agentType: z.string().optional(), // Agent type for specialization rules
  behaviorPrompt: z.string().optional(), // Custom behavior instructions for the agent (from specialist)
  specialistName: z.string().optional(), // Display name of the specialist (e.g., "Coordinator")
  roleReminder: z.string().optional(), // Critical constraints reminder for the specialist
  systemPrompt: z.string().optional(), // DEPRECATED: Backend builds from agentType
  rules: z.string().optional(), // DEPRECATED: Backend builds from agentType
  initialMessage: z.string().optional(),
  instruction: z.string().optional(), // Used to derive name if not provided
  contextReferences: z.array(z.any()).optional(),
  contextRefs: z.array(z.any()).optional(), // Alias for contextReferences
  config: z.record(z.any()).optional(), // Nested config object from frontend
  metadata: z.record(z.any()).optional(),
});

export const AgentGetRequestSchema = z.object({
  agentId: AgentIdSchema,
  workspaceId: WorkspaceIdSchema,
});

export const AgentSendMessageRequestSchema = z.object({
  agentId: AgentIdSchema,
  content: z.string().min(1, 'Message content is required'),
  contextReferences: z.array(z.any()).optional(),
  metadata: z.record(z.any()).optional(),
});

export const AgentListRequestSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  includeDeleted: z.boolean().optional(),
});

// Delete agent schema
export const AgentDeleteRequestSchema = z.object({
  agentId: AgentIdSchema,
  workspaceId: WorkspaceIdSchema,
});

// Cancel agent subscriptions (`agent.cancelSubscriptions`, PROTOCOL §5.5).
// Unscoped (neither optional id) cancels everything the agent registered;
// `subscriptionId` cancels exactly one completion watch, `groupId` one
// delegation group plus its grouped watches; both may be combined. The ids
// must be strings when present — the daemon rejects non-string ids with
// -32602 rather than coercing to an unscoped cancel.
export const AgentCancelSubscriptionsRequestSchema = z.object({
  agentId: AgentIdSchema,
  workspaceId: WorkspaceIdSchema,
  subscriptionId: z.string().min(1, 'subscriptionId must be a non-empty string').optional(),
  groupId: z.string().min(1, 'groupId must be a non-empty string').optional(),
});

// ============================================================================
// Workspace IPC Schemas
// ============================================================================

export const WorkspaceCreateRequestSchema = z.object({
  title: z.string().optional(), // Title is optional - workspaces can start with blank titles
  path: z.string().optional(),
  template: z.string().optional(),
  metadata: z.record(z.any()).optional(),
});

export const WorkspaceGetRequestSchema = z.object({
  workspaceId: WorkspaceIdSchema,
});

// ============================================================================
// File IPC Schemas
// ============================================================================

export const FileReadRequestSchema = z.object({
  path: z.string().min(1, 'File path is required'),
  encoding: z.enum(['utf8', 'ascii', 'base64']).optional(),
});

export const FileWriteRequestSchema = z.object({
  path: z.string().min(1, 'File path is required'),
  content: z.string(),
  encoding: z.enum(['utf8', 'ascii', 'base64']).optional(),
});

// ============================================================================
// Terminal IPC Schemas
// ============================================================================

export const TerminalCreateRequestSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  cwd: z.string().min(1, 'Working directory is required'),
  shell: z.string().optional(),
});

export const TerminalWriteRequestSchema = z.object({
  terminalId: z.string().min(1, 'Terminal ID is required'),
  data: z.string(),
});

// ============================================================================
// Schema Registry
// ============================================================================

// Use Record<string, any> to avoid type conflicts with branded types
const schemas: Record<string, z.ZodSchema<any>> = {
  'agent:create': AgentCreateRequestSchema,
  'agent:get': AgentGetRequestSchema,
  'agent:send-message': AgentSendMessageRequestSchema,
  'agent:list': AgentListRequestSchema,
  'agent:delete': AgentDeleteRequestSchema,
  'agent:cancel-subscriptions': AgentCancelSubscriptionsRequestSchema,
  'workspace:create': WorkspaceCreateRequestSchema,
  'workspace:get': WorkspaceGetRequestSchema,
  'file:read': FileReadRequestSchema,
  'file:write': FileWriteRequestSchema,
  'terminal:create': TerminalCreateRequestSchema,
  'terminal:write': TerminalWriteRequestSchema,
};

// ============================================================================
// Validation Function
// ============================================================================

/**
 * Validate an IPC request against its schema
 *
 * @param channel - The IPC channel name
 * @param request - The request to validate
 * @returns Validated request (type-safe)
 * @throws ZodError if validation fails
 */
export function validateIpcRequest<K extends keyof IpcContractMap>(
  channel: K,
  request: unknown,
): IpcContractMap[K][0] {
  const schema = schemas[channel];

  if (!schema) {
    throw new Error(`No validation schema for channel: ${String(channel)}`);
  }

  return schema.parse(request);
}

/**
 * Safely validate an IPC request, returning null on error
 */
export function tryValidateIpcRequest<K extends keyof IpcContractMap>(
  channel: K,
  request: unknown,
): IpcContractMap[K][0] | null {
  try {
    return validateIpcRequest(channel, request);
  } catch {
    return null;
  }
}
