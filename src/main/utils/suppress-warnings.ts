/**
 * Suppress Development Warnings
 *
 * Utilities to suppress known development-only warnings that add noise
 * to the console output.
 */

/**
 * Suppress Electron security warnings in development
 *
 * These warnings are important for production but add noise during development.
 * They will still appear in production builds.
 */
export function suppressElectronSecurityWarnings(): void {
  // Only suppress in development
  if (process.env.NODE_ENV !== 'development') {
    return;
  }

  // Suppress the CSP warning by setting the environment variable
  // This is the official way to disable the warning per Electron docs
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';
}

/**
 * Initialize warning suppression
 *
 * Call this early in the main process initialization
 */
export function initializeWarningSuppression(): void {
  suppressElectronSecurityWarnings();

  // Add other warning suppressions here as needed
  // For example, deprecation warnings that are known and being addressed
}
