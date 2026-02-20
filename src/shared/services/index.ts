/**
 * Shared Services Index
 *
 * Central export point for all shared services that can be used in both main and renderer processes
 */

// Export ID Generator (safe for both main and renderer)
export { IdGenerator, idGenerator } from './id-generator';

// NOTE: ConfigManager and WindowManager are Node.js-only modules and should not be exported here
// They should only be imported directly in main process code, never in renderer/frontend code
// Frontend code should use IPC channels to access config and window management functionality
