/**
 * Error Module Exports
 *
 * Central export point for all error-related functionality.
 * Includes messages, recovery suggestions, and localization.
 */

// Re-export from messages module
export { formatErrorMessage, getUserFriendlyMessage, getHelpLink } from './messages';

// Re-export recovery suggestions
export { getRecoverySuggestions } from './recovery';

// Re-export localization utilities

// Re-export structured error classes and helpers
