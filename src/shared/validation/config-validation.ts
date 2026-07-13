/**
 * Configuration Validation
 *
 * Validates configuration objects and ensures data integrity
 */

import { LIMITS } from '../constants';

// ============================================================================
// Validation Result Types
// ============================================================================

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// ============================================================================
// Agent Configuration Validation
// ============================================================================

/**
 * Validate agent configuration object
 */
export function validateAgentConfig(config: any): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!config || typeof config !== 'object') {
    errors.push('Configuration must be an object');
    return { valid: false, errors, warnings };
  }

  // Validate name
  if (!config.name || typeof config.name !== 'string') {
    errors.push('Agent name is required and must be a string');
  } else if (config.name.length > LIMITS.MAX_NAME_LENGTH) {
    errors.push(`Agent name exceeds maximum length of ${LIMITS.MAX_NAME_LENGTH}`);
  }

  // Validate model
  if (config.model && typeof config.model !== 'string') {
    errors.push('Model must be a string');
  }

  // Validate temperature
  if (config.temperature !== undefined) {
    if (typeof config.temperature !== 'number') {
      errors.push('Temperature must be a number');
    } else if (config.temperature < 0 || config.temperature > 2) {
      warnings.push(`Temperature ${config.temperature} is outside recommended range (0-2)`);
    }
  }

  // Validate maxTokens
  if (config.maxTokens !== undefined) {
    if (typeof config.maxTokens !== 'number' || config.maxTokens <= 0) {
      errors.push('Max tokens must be a positive number');
    } else if (config.maxTokens > 200000) {
      warnings.push('Max tokens is very high and may cause performance issues');
    }
  }

  // Validate systemPrompt
  if (config.systemPrompt && typeof config.systemPrompt !== 'string') {
    errors.push('System prompt must be a string');
  } else if (config.systemPrompt && config.systemPrompt.length > LIMITS.MAX_PROMPT_LENGTH) {
    errors.push(`System prompt exceeds maximum length of ${LIMITS.MAX_PROMPT_LENGTH}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ============================================================================
// Stream Configuration Validation
// ============================================================================

/**
 * Validate streaming configuration
 */
export function validateStreamConfig(config: any): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!config || typeof config !== 'object') {
    errors.push('Stream configuration must be an object');
    return { valid: false, errors, warnings };
  }

  // Validate sessionId
  if (!config.sessionId || typeof config.sessionId !== 'string') {
    errors.push('Session ID is required');
  }

  // Validate agentId
  if (!config.agentId || typeof config.agentId !== 'string') {
    errors.push('Agent ID is required');
  }

  // Validate backpressureThreshold
  if (config.backpressureThreshold !== undefined) {
    if (typeof config.backpressureThreshold !== 'number' || config.backpressureThreshold <= 0) {
      errors.push('Backpressure threshold must be a positive number');
    }
  }

  // Validate chunkTimeout
  if (config.chunkTimeout !== undefined) {
    if (typeof config.chunkTimeout !== 'number' || config.chunkTimeout <= 0) {
      errors.push('Chunk timeout must be a positive number');
    }
  }

  // Validate maxQueueSize
  if (config.maxQueueSize !== undefined) {
    if (typeof config.maxQueueSize !== 'number' || config.maxQueueSize <= 0) {
      errors.push('Max queue size must be a positive number');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ============================================================================
// Persistence Configuration Validation
// ============================================================================

/**
 * Validate persistence configuration
 */
export function validatePersistenceConfig(config: any): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!config || typeof config !== 'object') {
    errors.push('Persistence configuration must be an object');
    return { valid: false, errors, warnings };
  }

  // Validate basePath
  if (!config.basePath || typeof config.basePath !== 'string') {
    errors.push('Base path is required and must be a string');
  }

  // Validate backupEnabled
  if (config.backupEnabled !== undefined && typeof config.backupEnabled !== 'boolean') {
    errors.push('Backup enabled must be a boolean');
  }

  // Validate compressionEnabled
  if (config.compressionEnabled !== undefined && typeof config.compressionEnabled !== 'boolean') {
    errors.push('Compression enabled must be a boolean');
  }

  // Validate maxBackups
  if (config.maxBackups !== undefined) {
    if (typeof config.maxBackups !== 'number' || config.maxBackups <= 0) {
      errors.push('Max backups must be a positive number');
    }
  }

  // Validate autoSaveInterval
  if (config.autoSaveInterval !== undefined) {
    if (typeof config.autoSaveInterval !== 'number' || config.autoSaveInterval <= 0) {
      errors.push('Auto save interval must be a positive number');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ============================================================================
// Data Integrity Checks
// ============================================================================

/**
 * Check if object has required fields
 */
export function hasRequiredFields(obj: any, requiredFields: string[]): boolean {
  if (!obj || typeof obj !== 'object') {
    return false;
  }

  return requiredFields.every(
    (field) => field in obj && obj[field] !== undefined && obj[field] !== null,
  );
}

/**
 * Check if all values in object are of expected type
 */
export function validateObjectTypes(obj: any, schema: Record<string, string>): ValidationResult {
  const errors: string[] = [];

  if (!obj || typeof obj !== 'object') {
    errors.push('Object must be an object');
    return { valid: false, errors, warnings: [] };
  }

  for (const [key, expectedType] of Object.entries(schema)) {
    if (key in obj) {
      const actualType = typeof obj[key];
      if (actualType !== expectedType) {
        errors.push(`Field "${key}" must be of type ${expectedType}, got ${actualType}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings: [],
  };
}

export default {
  validateAgentConfig,
  validateStreamConfig,
  validatePersistenceConfig,
  hasRequiredFields,
  validateObjectTypes,
};
