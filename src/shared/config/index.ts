/**
 * Configuration Module
 *
 * Central export point for all configuration types, defaults, and validation.
 *
 * This module provides configuration management for agent, streaming, and persistence
 * operations. It is distinct from the UI configuration in `src/shared/services/config-manager.ts`.
 *
 * Usage:
 * ```typescript
 * import {
  AppConfig,
  DEFAULT_APP_CONFIG,
  validateAppConfig,
} from '$shared/config';
 * ```
 */

// ============================================================================
// Type Exports
// ============================================================================

export type {
  AgentConfig,
  StreamConfig,
  PersistenceConfig,
  AppConfig,
  ConfigValidationResult,
} from './types';

// ============================================================================
// Default Exports
// ============================================================================

export {
  DEFAULT_AGENT_CONFIG,
  DEFAULT_STREAM_CONFIG,
  DEFAULT_PERSISTENCE_CONFIG,
  DEFAULT_APP_CONFIG,
  CONFIG_CONSTANTS,
} from './defaults';

// GitHub OAuth configuration
export { GITHUB_CONFIG } from './github-config';

// ============================================================================
// Schema Exports
// ============================================================================

export {
  AgentConfigSchema,
  StreamConfigSchema,
  PersistenceConfigSchema,
  AppConfigSchema,
  validateAgentConfig,
  validateStreamConfig,
  validatePersistenceConfig,
  validateAppConfig,
} from './schemas';
