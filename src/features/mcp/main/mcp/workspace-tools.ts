/**
 * Workspace file-operation utilities.
 *
 * Re-exports the file-tracking helpers (trackFileOperation, emitAgentFileChange, etc.)
 * used by the agent tool executor and MCP bridge.
 * Tool classes have been consolidated into workspace-js-api-tool.ts.
 */

export * from './workspace-file-tools';
