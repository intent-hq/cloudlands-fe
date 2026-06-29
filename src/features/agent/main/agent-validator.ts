/**
 * Agent Validator Service
 *
 * Centralized validation for agent configurations and messages.
 * Ensures data integrity and consistency.
 */

import { Logger } from '$shared/logger';
import { unifiedIdService } from '$shared/services/unified-id.service';
import { MODEL_IDS } from '$shared/constants/agent-services';

const logger = new Logger('AgentValidator');

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings?: string[];
  sanitized?: any;
}

export interface MessageValidationOptions {
  maxLength?: number;
  allowEmpty?: boolean;
  sanitize?: boolean;
}

/**
 * Comprehensive validation service for agents
 */
export class AgentValidator {
  private static instance: AgentValidator;

  // Validation constants
  private static readonly MAX_NAME_LENGTH = 100;
  private static readonly MAX_MESSAGE_LENGTH = 1000000;
  // System prompts can be quite large when built with all layers
  // (base prompt, specialization rules, user rules, workspace context, etc.)
  // 200k chars is roughly 50k tokens, which is reasonable for modern models
  private static readonly MAX_PROMPT_LENGTH = 200000;
  // Use MODEL_IDS for validation - all known model IDs are valid
  private static readonly VALID_MODELS = Object.values(MODEL_IDS);

  private constructor() {}

  static getInstance(): AgentValidator {
    if (!AgentValidator.instance) {
      AgentValidator.instance = new AgentValidator();
    }
    return AgentValidator.instance;
  }

  /**
   * Validate agent configuration
   */
  validateConfig(config: any): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Required fields
    if (!config.name || typeof config.name !== 'string' || config.name.trim().length === 0) {
      errors.push('Agent name is required');
    } else if (config.name.length > AgentValidator.MAX_NAME_LENGTH) {
      errors.push(`Agent name must be less than ${AgentValidator.MAX_NAME_LENGTH} characters`);
    } else if (!this.isValidName(config.name)) {
      errors.push('Agent name contains invalid characters');
    }

    // Workspace ID is not required in config - it's passed separately
    // Remove this validation as workspaceId is provided at the API level

    // Optional fields
    if (config.model && !AgentValidator.VALID_MODELS.includes(config.model)) {
      warnings.push(`Unknown model: ${config.model}. Using default.`);
    }

    if (config.systemPrompt && config.systemPrompt.length > AgentValidator.MAX_PROMPT_LENGTH) {
      const excess = config.systemPrompt.length - AgentValidator.MAX_PROMPT_LENGTH;
      const percentOver = Math.round((excess / AgentValidator.MAX_PROMPT_LENGTH) * 100);
      errors.push(
        `System prompt exceeds maximum length of ${AgentValidator.MAX_PROMPT_LENGTH} characters ` +
          `(current: ${config.systemPrompt.length}, ${percentOver}% over limit). ` +
          'This may be caused by large user rules files (.augment/rules/, CLAUDE.md) or many context references. ' +
          'Try reducing the size of custom rules or removing some context references.',
      );
      logger.warn('System prompt validation failed - too long', {
        currentLength: config.systemPrompt.length,
        maxLength: AgentValidator.MAX_PROMPT_LENGTH,
        excess,
        percentOver,
      });
    }

    if (config.initialMessage && config.initialMessage.length > AgentValidator.MAX_MESSAGE_LENGTH) {
      errors.push(`Initial message exceeds maximum length of ${AgentValidator.MAX_MESSAGE_LENGTH}`);
    }

    // Validate context references
    if (config.contextReferences && Array.isArray(config.contextReferences)) {
      for (const ref of config.contextReferences) {
        const refValidation = this.validateContextReference(ref);
        if (!refValidation.valid) {
          errors.push(...refValidation.errors);
        }
      }
    }

    // Validate metadata
    if (config.metadata && typeof config.metadata !== 'object') {
      errors.push('Metadata must be an object');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  /**
   * Validate agent name - just check it's a non-empty string
   */
  private isValidName(name: string): boolean {
    // Agent names can be any string - no character restrictions
    // Length is already validated in validateConfig
    return typeof name === 'string' && name.trim().length > 0;
  }

  /**
   * Validate context reference
   */
  validateContextReference(ref: any): ValidationResult {
    const errors: string[] = [];

    if (!ref || typeof ref !== 'object') {
      errors.push('Context reference must be an object');
      return { valid: false, errors };
    }

    // Valid context types: file, selection, task, note, spec, code_chunk
    const validTypes = ['file', 'selection', 'task', 'note', 'spec', 'code_chunk'];
    if (!ref.type || !validTypes.includes(ref.type)) {
      errors.push(
        `Context reference must have a valid type. Valid types: ${validTypes.join(', ')}`,
      );
    }

    // Note: We allow context references without path/content because:
    // 1. Some references (like "spec" or "note") may be fetched by the agent via MCP tools
    // 2. References can be pointers (file, spec, note) that the agent will fetch
    // 3. References can be content (selection, task, code_chunk) that are included directly
    // The agent will handle missing content appropriately.

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate URL format
   */
  private isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Validate message
   */
  validateMessage(message: string, options: MessageValidationOptions = {}): ValidationResult {
    const errors: string[] = [];
    const maxLength = options.maxLength || AgentValidator.MAX_MESSAGE_LENGTH;

    if (!message || typeof message !== 'string') {
      if (!options.allowEmpty) {
        errors.push('Message is required');
      }
    } else {
      if (message.length > maxLength) {
        errors.push(`Message exceeds maximum length of ${maxLength}`);
      }

      if (message.trim().length === 0 && !options.allowEmpty) {
        errors.push('Message cannot be empty');
      }
    }

    const result: ValidationResult = {
      valid: errors.length === 0,
      errors,
    };

    if (options.sanitize && message) {
      result.sanitized = this.sanitizeMessage(message);
    }

    return result;
  }

  /**
   * Sanitize message content
   */
  sanitizeMessage(message: string): string {
    if (!message || typeof message !== 'string') {
      return '';
    }

    // Remove control characters except newlines and tabs
    // Note: \x00 is null character, we want to preserve spaces
    let sanitized = message.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ');

    // Normalize whitespace
    sanitized = sanitized.replace(/\r\n/g, '\n'); // Normalize line endings
    sanitized = sanitized.replace(/\t/g, '  '); // Convert tabs to spaces

    // Trim excessive whitespace
    sanitized = sanitized.replace(/\n{3,}/g, '\n\n'); // Max 2 consecutive newlines
    sanitized = sanitized.replace(/ {3,}/g, '  '); // Max 2 consecutive spaces

    return sanitized.trim();
  }

  /**
   * Validate agent ID
   */
  validateAgentId(id: string): ValidationResult {
    const errors: string[] = [];

    if (!id || typeof id !== 'string') {
      errors.push('Agent ID is required');
    } else if (!unifiedIdService.isValidAgentId(id)) {
      errors.push('Invalid agent ID format');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate session ID
   */
  validateSessionId(id: string): ValidationResult {
    const errors: string[] = [];

    if (!id || typeof id !== 'string') {
      errors.push('Session ID is required');
    } else if (!id.startsWith('session-')) {
      errors.push('Invalid session ID format');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate workspace ID
   */
  validateWorkspaceId(id: string): ValidationResult {
    const errors: string[] = [];

    if (!id || typeof id !== 'string') {
      errors.push('Workspace ID is required');
    } else if (id.length < 10 || id.length > 100) {
      errors.push('Invalid workspace ID length');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate model name
   */
  validateModel(model: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!model || typeof model !== 'string') {
      errors.push('Model is required');
    } else if (!(AgentValidator.VALID_MODELS as readonly string[]).includes(model)) {
      warnings.push(`Unknown model: ${model}`);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  /**
   * Batch validate multiple items
   */
  batchValidate<T>(items: T[], validator: (item: T) => ValidationResult): ValidationResult {
    const allErrors: string[] = [];
    const allWarnings: string[] = [];

    for (let i = 0; i < items.length; i++) {
      const result = validator(items[i]);
      if (!result.valid) {
        allErrors.push(`Item ${i + 1}: ${result.errors.join(', ')}`);
      }
      if (result.warnings) {
        allWarnings.push(`Item ${i + 1}: ${result.warnings.join(', ')}`);
      }
    }

    return {
      valid: allErrors.length === 0,
      errors: allErrors,
      warnings: allWarnings.length > 0 ? allWarnings : undefined,
    };
  }
}

// Export singleton instance
export const agentValidator = AgentValidator.getInstance();
