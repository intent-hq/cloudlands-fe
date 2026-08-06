/**
 * Workspace Script Zod Schemas
 *
 * Validation schemas for workspace script types.
 * Uses .passthrough() on non-critical fields for forward compatibility.
 */

import { z } from 'zod';

// ============================================================================
// Enum Schemas
// ============================================================================

export const ScriptModeSchema = z.enum(['service', 'command']);

export const ScriptCategorySchema = z.enum([
  'dev',
  'build',
  'test',
  'lint',
  'typecheck',
  'format',
  'storybook',
  'other',
]);

export const ScriptSourceSchema = z.enum(['auto-detected', 'user']);

export const ScriptStatusSchema = z.enum(['idle', 'running', 'restarting', 'exited']);

// ============================================================================
// Core Schemas
// ============================================================================

/**
 * Schema for a workspace script definition.
 * Uses .passthrough() so unknown fields from newer versions are preserved.
 */
export const WorkspaceScriptSchema = z
  .object({
    // i18n-ignore (IPC payload validation, developer-facing)
    id: z.string().min(1, 'Script ID is required'),
    // i18n-ignore (IPC payload validation, developer-facing)
    workspaceId: z.string().min(1, 'Workspace ID is required'),
    // i18n-ignore (IPC payload validation, developer-facing)
    name: z.string().min(1, 'Script name is required'),
    // i18n-ignore (IPC payload validation, developer-facing)
    command: z.string().min(1, 'Script command is required'),
    cwd: z.string().optional(),
    env: z.record(z.string()).optional(),
    mode: ScriptModeSchema,
    category: ScriptCategorySchema.optional(),
    source: ScriptSourceSchema,
    autoStart: z.boolean().optional(),
    createdAt: z.string(),
    updatedAt: z.string().optional(),
  })
  .passthrough();

/**
 * Schema for script runtime state (in-memory only, not persisted).
 */
export const ScriptRuntimeStateSchema = z
  .object({
    status: ScriptStatusSchema,
    pid: z.number().optional(),
    exitCode: z.number().nullable().optional(),
    startedAt: z.string().optional(),
    stoppedAt: z.string().optional(),
    restartCount: z.number().default(0),
    error: z.string().optional(),
    detectedUrl: z.string().optional(),
    previouslyRunning: z.boolean().optional(),
  })
  .passthrough();

/**
 * Schema for the scripts.json persistence file.
 */
export const ScriptsFileFormatSchema = z
  .object({
    version: z.number().int().positive(),
    scripts: z.array(WorkspaceScriptSchema),
  })
  .passthrough();

/**
 * Schema for creating a new script (subset of WorkspaceScript).
 */
export const CreateScriptSchema = z.object({
  // i18n-ignore (IPC payload validation, developer-facing)
  name: z.string().min(1, 'Script name is required'),
  // i18n-ignore (IPC payload validation, developer-facing)
  command: z.string().min(1, 'Script command is required'),
  cwd: z.string().optional(),
  env: z.record(z.string()).optional(),
  mode: ScriptModeSchema,
  category: ScriptCategorySchema.optional(),
  source: ScriptSourceSchema.default('user'),
  autoStart: z.boolean().optional(),
});

/**
 * Schema for updating an existing script.
 */
export const UpdateScriptSchema = z.object({
  name: z.string().min(1).optional(),
  command: z.string().min(1).optional(),
  cwd: z.string().optional(),
  env: z.record(z.string()).optional(),
  mode: ScriptModeSchema.optional(),
  category: ScriptCategorySchema.optional(),
  autoStart: z.boolean().optional(),
});
