/**
 * Agent Client Protocol (ACP)
 *
 * Official implementation following the ACP specification
 * from https://agentclientprotocol.com
 *
 * NOTE: This module exports ONLY browser-safe code.
 * Server-only code (ACPServer, SessionManager, handlers) must be imported
 * directly from './main/server/...' paths in main process code.
 *
 * This separation is required because Vite's excludeNodeModules plugin
 * replaces /main/ directory imports with empty modules in the browser bundle,
 * and re-exports from this index.ts would fail since the empty module
 * doesn't provide the named exports.
 */

// Export types (browser-safe)
export * from './types';

// Export parsers (browser-safe)
export {
  parseACPMessage,
  ACPStreamParser,
  extractACPToolCalls,
} from './parsers/acp-message-parser';

// ============================================================================
// Server-only exports are NOT included here to avoid browser bundle errors.
// Import directly from specific paths in main process code:
//
//   import { ACPServer } from './features/acp-official/main/server/acp-server';
//   import type { ACPServerConfig } from './features/acp-official/main/server/acp-server';
//   import { SessionManager } from './features/acp-official/main/server/session-manager';
//   import type { ACPSession } from './features/acp-official/main/server/session-manager';
//   import { FileSystemHandler } from './features/acp-official/main/server/handlers/file-system';
//   import { TerminalHandler } from './features/acp-official/main/server/handlers/terminal';
// ============================================================================
