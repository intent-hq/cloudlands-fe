/**
 * Error Module Exports
 *
 * Central export point for all error-related functionality.
 * Includes messages, recovery suggestions, and localization.
 */

// Re-export from messages module
export {
  HELP_LINKS,
  ERROR_MESSAGE_TEMPLATES,
  USER_FRIENDLY_MESSAGES,
  LOCALE_MESSAGES,
  formatErrorMessage,
  cleanErrorMessage,
  getUserFriendlyMessage,
  getHelpLink,
  getLocalizedMessage,
  type SupportedLocale,
} from './messages';

// Re-export recovery suggestions
export {
  RECOVERY_SUGGESTIONS,
  getRecoverySuggestions,
  getRecoveryHints,
  type RecoverySuggestion,
  type RecoveryHint,
} from './recovery';

// Re-export localization utilities
export {
  setLocale,
  getLocale,
  translateError,
  detectLocale,
  initializeLocalization,
  addTranslations,
  getTranslations,
  getSupportedLocales,
  LOCALE_DISPLAY_NAMES,
  type ErrorTranslation,
} from './localization';

// Re-export structured error classes and helpers
export {
  AppError,
  WorkspaceError,
  WorkspaceNotFoundError,
  WorkspaceValidationError,
  WorkspaceAlreadyExistsError,
  NoteError,
  NoteNotFoundError,
  NoteValidationError,
  CommentError,
  CommentNotFoundError,
  CommentValidationError,
  FileSystemError,
  FileNotFoundError,
  FileReadError,
  FileWriteError,
  ValidationError,
  GitError,
  GitWorktreeError,
  PermissionError,
  PathSecurityError,
  isAppError,
  toAppError,
} from '../errors.js';
