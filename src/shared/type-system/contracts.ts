/**
 * Type Contracts System
 *
 * Defines the single source of truth for all data types shared between
 * backend and frontend. All types must be defined here to ensure consistency.
 */

import { z } from 'zod';
import type {
  WorkspaceId,
  AgentId,
  MessageId,
  NoteId,
  ThreadId,
} from '../types/branded-ids';

// ============================================================================
// Core Entity Schemas
// ============================================================================

/**
 * Workspace Schema - Single source of truth for Workspace type
 */
export const WorkspaceSchema = z.object({
  id: z.string() as unknown as z.ZodType<WorkspaceId>,
  name: z.string().optional(),
  title: z.string(),
  branch: z.string(),
  baseRef: z.string().optional(),
  baseCommitSha: z.string().optional(),
  initialPrompt: z.string().optional(), // Initial user message for commit/PR generation
  status: z.enum(['active', 'archived', 'deleted', 'initializing']),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastActivity: z.string().optional(),
  tags: z.array(z.string()).optional(),
  path: z.string().optional(),
  repositoryPath: z.string().optional(),
  repositoryOwner: z.string().optional(),
  repositoryName: z.string().optional(),
  worktreePath: z.string().optional(),
  scope: z.string().optional(), // Optional relative path within worktreePath
  isRemote: z.boolean().optional(),
  prUrl: z.string().optional(),
  prNumber: z.number().optional(),
  prStatus: z.enum(['open', 'closed', 'merged', 'draft']).optional(),
  /** CoW filesystem capability of the workspaces root (PROTOCOL §5.1). */
  cowSupported: z.boolean().optional(),
  /** How the checkout was provisioned (PROTOCOL §5.1); omitted for rows without a daemon-provisioned checkout. `direct` = standalone local clone. */
  checkoutMode: z.enum(['cow', 'worktree', 'direct']).optional(),
});

export type Workspace = z.infer<typeof WorkspaceSchema>;

/**
 * Agent Schema - Single source of truth for Agent type
 */
export const AgentSchema = z.object({
  id: z.string() as unknown as z.ZodType<AgentId>,
  workspaceId: z.string() as unknown as z.ZodType<WorkspaceId>,
  name: z.string(),
  model: z.string().optional(),
  systemPrompt: z.string().optional(),
  status: z.enum(['initializing', 'ready', 'busy', 'error', 'stopped']),
  provider: z.literal('augment'),
  createdAt: z.string(),
  updatedAt: z.string(),
  metadata: z.record(z.any()).optional(),
});

export type Agent = z.infer<typeof AgentSchema>;

/**
 * Note Schema - Single source of truth for Note type
 */
export const NoteSchema = z.object({
  id: z.string() as unknown as z.ZodType<NoteId>,
  workspaceId: z.string() as unknown as z.ZodType<WorkspaceId>,
  title: z.string(),
  content: z.string(),
  contentType: z.enum(['markdown', 'plaintext', 'code']),
  visibility: z.enum(['private', 'workspace', 'public']),
  author: z.string(),
  authorType: z.enum(['user', 'agent', 'system']),
  createdAt: z.string(),
  updatedAt: z.string(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.any()).optional(),
  parentId: z.string().optional() as z.ZodType<NoteId | undefined>,
  threadId: z.string().optional() as z.ZodType<ThreadId | undefined>,
});

export type Note = z.infer<typeof NoteSchema>;

/**
 * Message Schema - Single source of truth for Message type
 */
export const MessageSchema = z.object({
  id: z.string() as unknown as z.ZodType<MessageId>,
  appMessageId: z.string().optional(),
  sessionId: z.string() as unknown as z.ZodType<AgentId>,
  agentId: z.string() as unknown as z.ZodType<AgentId>,
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.union([
    z.string(),
    z.array(z.any()), // ContentBlock[]
  ]),
  timestamp: z.string(),
  metadata: z.record(z.any()).optional(),
  toolCalls: z.array(z.any()).optional(),
  parentMessageId: z.string().optional() as z.ZodType<MessageId | undefined>,
});

export type Message = z.infer<typeof MessageSchema>;

/**
 * KnownRepo Schema - mirrors KnownRepo in src/shared/types/known-repo.ts
 */
export const KnownRepoSchema = z.object({
  path: z.string(),
  name: z.string(),
  owner: z.string().optional(),
  githubUrl: z.string().optional(),
  addedAt: z.string(),
  lastUsedAt: z.string(),
});

// ============================================================================
// IPC Contract Schemas
// ============================================================================

/**
 * Define schemas for all IPC request/response pairs
 */
export const IpcContracts = {
  'agent:create': {
    request: z.object({
      workspaceId: z.string() as unknown as z.ZodType<WorkspaceId>,
      workspacePath: z.string(),
      name: z.string(),
      agentId: z.string().optional() as unknown as z.ZodType<AgentId | undefined>,
      model: z.string().optional(),
      provider: z.string().optional(), // Provider ID (e.g., 'auggie', 'claude-code', 'codex')
      agentType: z.string().optional(), // Agent type for specialization rules
      behaviorPrompt: z.string().optional(), // Custom behavior instructions for the agent (from specialist)
      specialistName: z.string().optional(), // Display name of the specialist (e.g., "Coordinator")
      roleReminder: z.string().optional(), // Critical constraints reminder for the specialist
      systemPrompt: z.string().optional(), // DEPRECATED: Backend builds from agentType
      rules: z.string().optional(), // DEPRECATED: Backend builds from agentType
      initialMessage: z.string().optional(),
      contextReferences: z.array(z.any()).optional(),
      metadata: z.record(z.any()).optional(),
    }),
    response: z.object({
      agent: z.any(), // AgentSession type
      sessionId: z.string() as unknown as z.ZodType<AgentId>,
    }),
  },

  'agent:send-message': {
    request: z.object({
      agentId: z.string() as unknown as z.ZodType<AgentId>,
      content: z.string(),
      contextReferences: z.array(z.any()).optional(),
      metadata: z.record(z.any()).optional(),
    }),
    response: z.object({
      messageId: z.string() as unknown as z.ZodType<MessageId>,
      status: z.enum(['sent', 'queued', 'failed']),
    }),
  },

  'workspace:create': {
    request: z.object({
      title: z.string(),
      branch: z.string().optional(),
      baseRef: z.string().optional(),
      tags: z.array(z.string()).optional(),
    }),
    response: z.object({
      workspace: WorkspaceSchema,
    }),
  },

  'note:create': {
    request: z.object({
      workspaceId: z.string() as unknown as z.ZodType<WorkspaceId>,
      title: z.string(),
      content: z.string(),
      contentType: z.enum(['markdown', 'plaintext', 'code']).optional(),
      tags: z.array(z.string()).optional(),
      metadata: z.record(z.any()).optional(),
    }),
    response: z.object({
      note: NoteSchema,
    }),
  },

  // Agent context channels
  'agent:context:update': {
    request: z.object({
      sessionId: z.string() as unknown as z.ZodType<AgentId>,
      context: z.record(z.any()),
    }),
    response: z.object({
      success: z.boolean(),
    }),
  },

  'agent:context:getByWorkspace': {
    request: z.object({
      workspaceId: z.string() as unknown as z.ZodType<WorkspaceId>,
    }),
    response: z.object({
      context: z.record(z.any()),
    }),
  },

  'agent:context:getBySession': {
    request: z.object({
      sessionId: z.string() as unknown as z.ZodType<AgentId>,
    }),
    response: z.object({
      context: z.record(z.any()),
    }),
  },

  // Workspace channels
  'workspace:list': {
    request: z.object({}),
    response: z.object({
      success: z.boolean(),
      data: z.array(WorkspaceSchema).optional(),
      error: z.string().optional(),
    }),
  },

  'workspace:get': {
    request: z.union([
      z.string(),
      z.object({ id: z.string() as unknown as z.ZodType<WorkspaceId> }),
    ]),
    response: z.object({
      success: z.boolean(),
      data: WorkspaceSchema.optional(),
      error: z.string().optional(),
    }),
  },

  'workspace:get-by-id': {
    request: z.object({
      workspaceId: z.string() as unknown as z.ZodType<WorkspaceId>,
    }),
    response: z.object({
      success: z.boolean(),
      data: WorkspaceSchema.optional(),
      error: z.string().optional(),
    }),
  },

  'workspace:update': {
    request: z.object({
      id: z.string() as unknown as z.ZodType<WorkspaceId>,
      title: z.string().optional(),
      baseCommitSha: z.string().optional(),
      worktreePath: z.string().optional(),
      gitInfo: z
        .object({
          branch: z.string().optional(),
          remote: z.string().optional(),
        })
        .optional(),
    }),
    response: z.object({
      success: z.boolean(),
      data: WorkspaceSchema.optional(),
      error: z.string().optional(),
    }),
  },

  'workspace:delete': {
    request: z.object({
      id: z.string() as unknown as z.ZodType<WorkspaceId>,
    }),
    response: z.object({
      success: z.boolean(),
      error: z.string().optional(),
    }),
  },

  'workspace:open': {
    request: z.object({
      id: z.string() as unknown as z.ZodType<WorkspaceId>,
    }),
    response: z.object({
      success: z.boolean(),
      data: WorkspaceSchema.optional(),
      error: z.string().optional(),
    }),
  },

  'workspace:close': {
    request: z.object({
      id: z.string() as unknown as z.ZodType<WorkspaceId>,
    }),
    response: z.object({
      success: z.boolean(),
      error: z.string().optional(),
    }),
  },

  'workspace:get-root': {
    request: z.object({
      workspaceId: z.string() as unknown as z.ZodType<WorkspaceId>,
    }),
    response: z.object({
      success: z.boolean(),
      data: z.string().optional(),
      error: z.string().optional(),
    }),
  },

  'workspace:get-recent-repositories': {
    request: z.object({
      limit: z.number().optional(),
    }),
    response: z.object({
      success: z.boolean(),
      data: z.array(KnownRepoSchema),
      error: z.string().optional(),
    }),
  },

  'workspace:add-recent-repository': {
    request: z.object({
      repository: z.string(),
      name: z.string().optional(),
      owner: z.string().optional(),
      githubUrl: z.string().optional(),
    }),
    response: z.object({
      success: z.boolean(),
    }),
  },

  'workspace:clear-recent-repositories': {
    request: z.object({}),
    response: z.object({
      success: z.boolean(),
    }),
  },

  'workspace:update_git_info': {
    request: z.object({
      workspaceId: z.string() as unknown as z.ZodType<WorkspaceId>,
      gitInfo: z.object({
        branch: z.string().optional(),
        remote: z.string().optional(),
        status: z.string().optional(),
      }),
    }),
    response: z.object({
      success: z.boolean(),
    }),
  },

  'workspace:getSettings': {
    request: z.object({
      workspaceId: z.string() as unknown as z.ZodType<WorkspaceId>,
    }),
    response: z.object({
      settings: z.record(z.any()),
    }),
  },

  'workspace:updateSettings': {
    request: z.object({
      workspaceId: z.string() as unknown as z.ZodType<WorkspaceId>,
      settings: z.record(z.any()),
    }),
    response: z.object({
      success: z.boolean(),
    }),
  },

  'workspace:load-rules': {
    request: z.object({
      workspaceId: z.string() as unknown as z.ZodType<WorkspaceId>,
    }),
    response: z.object({
      rules: z.string(),
    }),
  },

  // File channels
  'file:read': {
    request: z.object({
      path: z.string(),
      encoding: z.string().optional(),
    }),
    response: z.object({
      success: z.boolean(),
      data: z.string().optional(),
      error: z.string().optional(),
    }),
  },

  'file:write': {
    request: z.object({
      path: z.string(),
      content: z.string(),
      encoding: z.string().optional(),
    }),
    response: z.object({
      success: z.boolean(),
      error: z.string().optional(),
    }),
  },

  'file:exists': {
    request: z.object({
      path: z.string(),
    }),
    response: z.object({
      success: z.boolean(),
      exists: z.boolean().optional(),
      error: z.string().optional(),
    }),
  },

  'file:list': {
    request: z.object({
      path: z.string(),
      recursive: z.boolean().optional(),
    }),
    response: z.object({
      success: z.boolean(),
      files: z.array(z.string()).optional(),
      error: z.string().optional(),
    }),
  },

  // System channels
  'system:get-info': {
    request: z.object({}),
    response: z.object({
      platform: z.string(),
      version: z.string(),
      arch: z.string(),
    }),
  },

  'app:version': {
    request: z.object({}),
    response: z.object({
      version: z.string(),
    }),
  },
} as const;

export type IpcContractKey = keyof typeof IpcContracts;
