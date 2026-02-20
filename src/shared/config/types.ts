/**
 * Configuration Type Definitions
 *
 * Comprehensive type definitions for all configuration aspects of the agent system.
 * These types ensure type safety and consistency across configuration management.
 *
 * NOTE: This module exports an `AppConfig` type for agent/streaming/persistence configuration.
 * This is distinct from the `AppConfig` type in `src/shared/services/config-manager.ts`,
 * which is for UI/appearance/editor configuration. When importing, be explicit about which
 * config type you need to avoid confusion.
 */

import type { SessionId, AgentId } from '../types';

// ============================================================================
// Agent Configuration
// ============================================================================

/**
 * Core agent configuration
 * Defines the settings for an individual agent instance
 */
export interface AgentConfig {
  /** Agent name for display */
  name: string;

  /** LLM model identifier (e.g., 'claude-3-opus', 'gpt-4') */
  model?: string;

  /** System prompt for the agent */
  systemPrompt?: string;

  /** User-defined rules for agent behavior */
  rules?: string;

  /** Temperature for LLM sampling (0-2) */
  temperature?: number;

  /** Maximum tokens for LLM response */
  maxTokens?: number;

  /** Custom metadata for the agent */
  metadata?: Record<string, any>;
}

// ============================================================================
// Streaming Configuration
// ============================================================================

/**
 * Configuration for streaming operations
 * Controls how agent responses are streamed to the client
 */
export interface StreamConfig {
  /** Session ID for the streaming session */
  sessionId: AgentId;

  /** Agent ID performing the streaming */
  agentId: AgentId;

  /** Backpressure threshold (number of chunks) */
  backpressureThreshold?: number;

  /** Timeout for individual chunks (ms) */
  chunkTimeout?: number;

  /** Maximum queue size for buffered chunks */
  maxQueueSize?: number;
}

// ============================================================================
// Persistence Configuration
// ============================================================================

/**
 * Configuration for data persistence
 * Controls how agent data is saved and backed up
 */
export interface PersistenceConfig {
  /** Base path for storing persistent data */
  basePath: string;

  /** Enable automatic backups */
  backupEnabled?: boolean;

  /** Enable compression for stored data */
  compressionEnabled?: boolean;

  /** Maximum number of backup files to retain */
  maxBackups?: number;

  /** Auto-save interval in milliseconds */
  autoSaveInterval?: number;
}

// ============================================================================
// Application Configuration
// ============================================================================

/**
 * Overall application configuration
 * Combines all configuration aspects
 */
export interface AppConfig {
  /** Agent configuration */
  agent: AgentConfig;

  /** Streaming configuration */
  streaming: StreamConfig;

  /** Persistence configuration */
  persistence: PersistenceConfig;

  /** Additional application-level settings */
  app?: {
    /** Debug mode flag */
    debugMode?: boolean;

    /** Enable experimental features */
    enableExperimental?: boolean;

    /** Custom metadata */
    metadata?: Record<string, any>;
  };
}

// ============================================================================
// Configuration Validation Result
// ============================================================================

/**
 * Result of configuration validation
 */
export interface ConfigValidationResult {
  /** Whether validation passed */
  valid: boolean;

  /** Validation errors if any */
  errors?: string[];

  /** Warnings if any */
  warnings?: string[];
}
