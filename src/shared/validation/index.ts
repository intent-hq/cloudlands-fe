/**
 * Validation Utilities
 *
 * Comprehensive input validation and sanitization functions for the agent system.
 * Provides security-focused validation for user inputs, file paths, and configuration.
 */

import { LIMITS, PATTERNS } from '../constants';

// ============================================================================
// Input Sanitization
// ============================================================================

/**
 * Sanitize user input by removing potentially dangerous characters
 * and enforcing length limits
 *
 * Note: This function removes `<>` characters globally as a basic XSS prevention measure.
 * For more complex content (e.g., code snippets, mathematical expressions), consider
 * using context-aware sanitization or HTML escaping instead.
 */
export function sanitizeInput(input: string, maxLength = LIMITS.MAX_MESSAGE_LENGTH): string {
  if (typeof input !== 'string') {
    return '';
  }

  return input
    .trim()
    .replace(/[<>]/g, '') // Remove potential XSS vectors
    .slice(0, maxLength);
}

/**
 * Sanitize message content for display
 * Removes control characters and normalizes whitespace
 */
export function sanitizeMessage(message: string): string {
  if (typeof message !== 'string') {
    return '';
  }

  // Remove control characters except newlines and tabs
  let sanitized = message.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // Normalize whitespace
  sanitized = sanitized.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Trim excessive blank lines
  sanitized = sanitized.replace(/\n{4,}/g, '\n\n\n');

  return sanitized.trim();
}

// ============================================================================
// Name Validation
// ============================================================================

/**
 * Validate agent name format and length
 */
export function validateAgentName(name: string): boolean {
  if (typeof name !== 'string') {
    return false;
  }

  const trimmed = name.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length <= LIMITS.MAX_NAME_LENGTH &&
    PATTERNS.AGENT_NAME.test(trimmed)
  );
}

/**
 * Validate workspace name
 */
export function validateWorkspaceName(name: string): boolean {
  if (typeof name !== 'string') {
    return false;
  }

  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed.length <= 255;
}

// ============================================================================
// Path Validation
// ============================================================================

/**
 * Validate workspace path for directory traversal attacks
 */
export function validateWorkspacePath(path: string): boolean {
  if (typeof path !== 'string') {
    return false;
  }

  // Prevent directory traversal
  if (path.includes('..') || path.includes('~')) {
    return false;
  }

  // Must be absolute or relative without dangerous patterns
  return !path.includes('\x00'); // Null byte injection
}

/**
 * Validate file path safety
 */
export function validateFilePath(path: string): boolean {
  if (typeof path !== 'string' || path.length === 0) {
    return false;
  }

  // Check for directory traversal
  if (path.includes('..')) {
    return false;
  }

  // Check for null bytes
  if (path.includes('\x00')) {
    return false;
  }

  return true;
}

// ============================================================================
// Message Validation
// ============================================================================

/**
 * Validate message content
 */
export function validateMessage(message: string, maxLength = LIMITS.MAX_MESSAGE_LENGTH): boolean {
  if (typeof message !== 'string') {
    return false;
  }

  const trimmed = message.trim();
  return trimmed.length > 0 && trimmed.length <= maxLength;
}

// ============================================================================
// ID Validation
// ============================================================================

/**
 * Validate UUID format
 */
export function isValidUUID(value: string): boolean {
  if (typeof value !== 'string') {
    return false;
  }

  return PATTERNS.UUID.test(value);
}

/**
 * Validate email format
 * Uses a more comprehensive regex that handles most common email formats
 */
export function isValidEmail(value: string): boolean {
  if (typeof value !== 'string') {
    return false;
  }

  // RFC 5322 simplified regex - handles most common email formats
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // Additional checks for common issues
  if (!emailRegex.test(value)) {
    return false;
  }

  // Check for consecutive dots
  if (value.includes('..')) {
    return false;
  }

  // Check for leading/trailing dots
  const [localPart, domain] = value.split('@');
  if (localPart.startsWith('.') || localPart.endsWith('.')) {
    return false;
  }
  if (domain.startsWith('.') || domain.endsWith('.')) {
    return false;
  }

  return true;
}

/**
 * Validate URL format
 */
export function isValidURL(value: string): boolean {
  if (typeof value !== 'string') {
    return false;
  }

  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Additional Validation Functions
// ============================================================================

/**
 * Sanitize HTML content to prevent XSS attacks
 */
export function sanitizeHTML(html: string): string {
  if (typeof html !== 'string') {
    return '';
  }

  const sanitized = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Remove script tags
    .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '') // Remove event handlers
    .replace(/javascript:/gi, ''); // Remove javascript: protocol

  return sanitized.trim();
}

/**
 * Sanitize file paths to prevent directory traversal attacks
 */
export function sanitizePath(inputPath: string): string {
  if (typeof inputPath !== 'string') {
    return '';
  }

  return inputPath
    .replace(/\.\./g, '') // Remove ..
    .replace(/[<>:"|?*]/g, '') // Remove invalid path chars
    .replace(/\\/g, '/') // Normalize slashes
    .trim();
}

/**
 * Sanitize branch names for git operations
 *
 * Note: This function converts branch names to lowercase for consistency.
 * Git branch names are case-sensitive, but this normalization ensures
 * consistent branch naming across the system.
 */
export function sanitizeBranchName(branch: string): string {
  if (typeof branch !== 'string') {
    return '';
  }

  return branch
    .trim()
    .replace(/[\s~^:?*\[\]\\]/g, '-') // Replace invalid chars
    .replace(/\.{2,}/g, '-') // Replace consecutive dots
    .replace(/\/{2,}/g, '/') // Replace consecutive slashes
    .replace(/^\/|\/$/g, '') // Remove leading/trailing slashes
    .replace(/\.lock$/, '') // Remove .lock suffix
    .replace(/-{2,}/g, '-') // Replace multiple hyphens
    .toLowerCase();
}

/**
 * Validate system prompt
 */
export function validateSystemPrompt(prompt: string): boolean {
  if (prompt && typeof prompt !== 'string') {
    return false;
  }

  return !prompt || prompt.length <= LIMITS.MAX_PROMPT_LENGTH;
}

/**
 * Validate temperature value
 */
export function validateTemperature(temp: number): boolean {
  return typeof temp === 'number' && temp >= 0 && temp <= 2;
}

/**
 * Validate max tokens value
 */
export function validateMaxTokens(tokens: number): boolean {
  return typeof tokens === 'number' && tokens >= 1 && tokens <= 200000;
}

/**
 * Check if text contains suspicious patterns (potential XSS)
 */
export function containsSuspiciousPatterns(text: string): boolean {
  if (typeof text !== 'string') {
    return false;
  }

  const suspiciousPatterns = [
    PATTERNS.SCRIPT_TAG,
    /<iframe/i,
    /javascript:/i,
    PATTERNS.EVENT_HANDLER,
    /<embed/i,
    /<object/i,
  ];

  return suspiciousPatterns.some((pattern) => pattern.test(text));
}

/**
 * Validate optimistic ID format
 */
export function isValidOptimisticId(id: string): boolean {
  if (typeof id !== 'string') {
    return false;
  }

  return PATTERNS.OPTIMISTIC_ID.test(id);
}

export default {
  sanitizeInput,
  sanitizeMessage,
  sanitizeHTML,
  sanitizePath,
  sanitizeBranchName,
  validateAgentName,
  validateWorkspaceName,
  validateWorkspacePath,
  validateFilePath,
  validateMessage,
  validateSystemPrompt,
  validateTemperature,
  validateMaxTokens,
  isValidUUID,
  isValidEmail,
  isValidURL,
  isValidOptimisticId,
  containsSuspiciousPatterns,
};
