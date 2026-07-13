/**
 * Configuration Validation Schemas
 *
 * Zod schemas for validating configuration objects.
 * Ensures type safety and runtime validation.
 */

import { z } from 'zod';
import type {
  AgentConfig,
  StreamConfig,
  PersistenceConfig,
  AppConfig,
  ConfigValidationResult,
} from './types';

// ============================================================================
// Agent Configuration Schema
// ============================================================================

export const AgentConfigSchema = z.object({
  name: z.string().min(1, 'Agent name is required').max(100, 'Agent name too long'),
  model: z.string().optional(),
  systemPrompt: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().min(1).max(32000).optional(),
  metadata: z.record(z.any()).optional(),
}) as z.ZodType<AgentConfig>;

// ============================================================================
// Streaming Configuration Schema
// ============================================================================

export const StreamConfigSchema = z.object({
  sessionId: z.string().min(1, 'Session ID is required'),
  agentId: z.string().min(1, 'Agent ID is required'),
  backpressureThreshold: z.number().min(1).optional(),
  chunkTimeout: z.number().min(100).optional(),
  maxQueueSize: z.number().min(1).optional(),
}) as unknown as z.ZodType<StreamConfig>;

// ============================================================================
// Persistence Configuration Schema
// ============================================================================

export const PersistenceConfigSchema = z.object({
  basePath: z.string().min(1, 'Base path is required'),
  backupEnabled: z.boolean().optional(),
  compressionEnabled: z.boolean().optional(),
  maxBackups: z.number().min(1).optional(),
  autoSaveInterval: z.number().min(100).optional(),
}) as z.ZodType<PersistenceConfig>;

// ============================================================================
// Application Configuration Schema
// ============================================================================

export const AppConfigSchema = z.object({
  agent: AgentConfigSchema,
  streaming: StreamConfigSchema,
  persistence: PersistenceConfigSchema,
  app: z
    .object({
      debugMode: z.boolean().optional(),
      enableExperimental: z.boolean().optional(),
      metadata: z.record(z.any()).optional(),
    })
    .optional(),
}) as z.ZodType<AppConfig>;

// ============================================================================
// Validation Helper
// ============================================================================

/**
 * Helper function to validate using a Zod schema
 * @param schema The Zod schema to validate against
 * @param config The configuration to validate
 * @returns Validation result with errors if validation fails
 */
function validateWithSchema<T>(schema: z.ZodType<T>, config: unknown): ConfigValidationResult {
  try {
    schema.parse(config);
    return { valid: true };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        valid: false,
        errors: error.errors.map((e) => `${e.path.join('.')}: ${e.message}`),
      };
    }
    return { valid: false, errors: ['Unknown validation error'] };
  }
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate agent configuration
 */
export function validateAgentConfig(config: unknown): ConfigValidationResult {
  return validateWithSchema(AgentConfigSchema, config);
}

/**
 * Validate streaming configuration
 */
export function validateStreamConfig(config: unknown): ConfigValidationResult {
  return validateWithSchema(StreamConfigSchema, config);
}

/**
 * Validate persistence configuration
 */
export function validatePersistenceConfig(config: unknown): ConfigValidationResult {
  return validateWithSchema(PersistenceConfigSchema, config);
}

/**
 * Validate complete application configuration
 */
export function validateAppConfig(config: unknown): ConfigValidationResult {
  return validateWithSchema(AppConfigSchema, config);
}
