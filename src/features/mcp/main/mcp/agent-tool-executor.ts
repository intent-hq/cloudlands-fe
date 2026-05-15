/**
 * Agent Tool Executor
 *
 * Executes tool calls from agent responses through MCP
 */

import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import { MCPServer } from './server';
import {
  extractToolCalls,
  hasToolCalls,
  ExtractedToolCall,
} from './tool-call-extractor';
import { AgentMessage } from '$features/agent/main/agent-providers/base-provider';
import {
  getPendingFileOperations,
  clearPendingFileOperations,
} from './workspace-tools';
import { getProvenanceContextManager } from '$features/workspace/main/provenance/provenance-context-manager';
import { Logger } from '$shared/logger';
import { execFileAsync } from '../../../../shared/git/git-env';

const logger = new Logger('AgentToolExecutor');

export interface ToolExecutionResult {
  toolName: string;
  success: boolean;
  result?: any;
  error?: string;
}

export interface ToolExecutionContext {
  workspaceId: string;
  agentId: string;
  agentName?: string;
  sessionId?: string;
  turnNumber?: number;
  mcpServer: MCPServer;
  changeDetectorManager?: any; // Will be injected
}

/**
 * Execute tool calls from agent response
 */
export async function executeToolCalls(
  response: string,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult[]> {
  const results: ToolExecutionResult[] = [];

  if (!hasToolCalls(response)) {
    return results;
  }

  const toolCalls = extractToolCalls(response);
  logger.debug('Found tool calls to execute', { count: toolCalls.length });

  // Create provenance context for this agent execution
  const provenanceManager = getProvenanceContextManager();
  const contextId = provenanceManager.createAgentContext({
    agentId: context.agentId,
    agentName: context.agentName || context.agentId,
    messageId: `msg-${uuidv4()}`, // Will be set by caller if available
    sessionId: context.sessionId,
    turnNumber: context.turnNumber,
  });

  // Note: recordAgentActivity is deprecated. Agent file writes are now tracked
  // via content-based attribution in acp-provider-streaming.ts when tool_use blocks
  // are received for file-editing tools (save-file, str_replace_editor, etc.)

  logger.debug('Created provenance context for agent', {
    contextId,
    agentId: context.agentId,
    agentName: context.agentName || context.agentId,
  });

  try {
    // Before executing any tools, capture snapshots of files that might be modified
    await captureFileSnapshotsBeforeExecution(toolCalls, context);

    // Mark the agent as active in the change detector BEFORE executing tools
    // This prevents the file watcher from attributing changes to "user"
    if (context.changeDetectorManager) {
      const detector = (context.changeDetectorManager as any).detectors?.get(context.workspaceId);
      if (detector) {
        // Mark active for longer to ensure all file changes are captured
        // Each tool call extends the active period
        detector.markAgentActive(
          context.agentName || context.agentId,
          60000, // 60 seconds per tool call
          context.sessionId,
          context.turnNumber,
        );
        logger.debug('Marked agent as active', {
          agentName: context.agentName || context.agentId,
          duration: '60s',
          sessionId: context.sessionId,
          turnNumber: context.turnNumber,
        });
      }
    }

    for (const toolCall of toolCalls) {
      try {
        logger.debug('Executing tool', {
          toolName: toolCall.name,
          arguments: toolCall.arguments,
        });

        const result = await context.mcpServer.handleMessage({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: toolCall.name,
            arguments: toolCall.arguments,
          },
        });

        if (!result) {
          logger.error('Tool returned null', undefined, { toolName: toolCall.name });
          results.push({
            toolName: toolCall.name,
            success: false,
            error: 'Tool returned null result',
          });
        } else if (result.error) {
          logger.error('Tool error', undefined, {
            toolName: toolCall.name,
            error: result.error,
          });
          results.push({
            toolName: toolCall.name,
            success: false,
            error: result.error.message,
          });
        } else {
          logger.debug('Tool success', {
            toolName: toolCall.name,
            result: result.result,
          });
          results.push({
            toolName: toolCall.name,
            success: true,
            result: result.result,
          });
        }
      } catch (error) {
        logger.error('Tool execution failed', error as Error, {
          toolName: toolCall.name,
        });
        results.push({
          toolName: toolCall.name,
          success: false,
          error: (error as Error).message || 'Unknown error',
        });
      }
    }

    // After all tools are executed, track any file changes
    await trackAgentFileChanges(context);

    return results;
  } finally {
    // Always pop the context when done, even if there was an error
    provenanceManager.popContext();
    logger.debug('Popped provenance context', { contextId });
  }
}

/**
 * Capture file snapshots before executing file-modifying tools
 */
async function captureFileSnapshotsBeforeExecution(
  toolCalls: ExtractedToolCall[],
  context: ToolExecutionContext,
): Promise<void> {
  if (!context.changeDetectorManager) {
    return;
  }

  const filesToSnapshot: string[] = [];

  for (const toolCall of toolCalls) {
    // Check if this is a file-modifying tool
    if (
      toolCall.name === 'str_replace_editor' ||
      toolCall.name === 'str-replace-editor' ||
      toolCall.name === 'write_file' ||
      toolCall.name === 'write-file'
    ) {
      // Extract the file path from arguments
      const filePath = toolCall.arguments?.path;
      if (filePath && !filesToSnapshot.includes(filePath)) {
        filesToSnapshot.push(filePath);
      }
    }
  }

  if (filesToSnapshot.length > 0) {
    logger.debug('Capturing snapshots for files before modifications', {
      fileCount: filesToSnapshot.length,
    });

    // Get the detector and capture snapshots
    const detector = (context.changeDetectorManager as any).detectors?.get(context.workspaceId);
    if (detector && detector.captureFileSnapshots) {
      await detector.captureFileSnapshots(filesToSnapshot);
    }
  }
}

/**
 * Track agent file changes after tool execution
 */
async function trackAgentFileChanges(context: ToolExecutionContext): Promise<void> {
  const fileOps = getPendingFileOperations(context.workspaceId);

  logger.debug('trackAgentFileChanges called', {
    operationCount: fileOps.length,
    workspaceId: context.workspaceId,
  });

  if (fileOps.length === 0) {
    logger.debug('No pending file operations to track', {
      workspaceId: context.workspaceId,
    });
    return; // No file operations to track
  }

  logger.debug('Tracking file operations for agent', {
    operationCount: fileOps.length,
    agentName: context.agentName || context.agentId,
  });

  try {
    // Get the change detector manager from context
    if (!context.changeDetectorManager) {
      logger.error('No changeDetectorManager in context, cannot track agent changes');
      clearPendingFileOperations(context.workspaceId);
      return;
    }

    // Convert file operations to FileChange format
    logger.debug('Converting file operations to FileChange format', {
      operationCount: fileOps.length,
    });

    const fileChanges = await Promise.all(
      fileOps.map(async (op) => {
        let action: 'Create' | 'Modify' | 'Delete';
        if (op.operation === 'delete') {
          action = 'Delete';
        } else if (op.operation === 'write') {
          // For write operations, we need to determine if it's a create or modify
          // Check if the file exists in git to determine if it's new
          try {
            const workspacePath = context.changeDetectorManager?.getWorkspacePath?.(
              context.workspaceId,
            );
            if (workspacePath) {
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              const fullPath = path.join(workspacePath, op.path);
              // Try to check git status to see if file is untracked (new)
              try {
                // Use execFileAsync to safely pass the file path without shell interpretation
                await execFileAsync('git', ['ls-files', '--error-unmatch', '--', op.path], {
                  cwd: workspacePath,
                });
                // File is tracked in git, so it's a modification
                action = 'Modify';
                logger.debug('File is tracked in git - marking as Modify', {
                  filePath: op.path,
                });
              } catch {
                // File is not tracked in git, so it's new
                action = 'Create';
                logger.debug('File is not tracked in git - marking as Create', {
                  filePath: op.path,
                });
              }
            } else {
              // Can't determine, default to Modify
              action = 'Modify';
              logger.debug('Could not determine workspace path - defaulting to Modify', {
                filePath: op.path,
              });
            }
          } catch (err) {
            // If any error, default to Modify
            action = 'Modify';
            logger.debug('Error determining action - defaulting to Modify', {
              filePath: op.path,
              error: String(err),
            });
          }
        } else {
          // Unknown operation, default to Modify
          action = 'Modify';
          logger.debug('Unknown operation type - defaulting to Modify', {
            filePath: op.path,
          });
        }

        const fileChange = {
          path: op.path,
          action,
          additions: 0, // Will be calculated by ChangeDetector if needed
          deletions: 0,
          timestamp: op.timestamp,
        };

        logger.debug('Converted file operation', {
          filePath: op.path,
          action,
        });
        return fileChange;
      }),
    );

    logger.debug('Successfully converted file operations', {
      count: fileChanges.length,
    });

    // Track the changes with provenance
    const diffChunk = await context.changeDetectorManager.trackAgentChanges(
      context.workspaceId,
      fileChanges,
      context.agentName || context.agentId,
      undefined, // messageId
      undefined, // threadId
      context.turnNumber,
      context.agentId, // sessionId
      undefined, // model
      undefined, // temperature
      undefined, // reasoning
    );

    logger.debug('trackAgentChanges returned diffChunk', { diffChunkId: diffChunk?.id });

    // Add a single timeline entry for the agent action with all file changes
    // This replaces the per-file entries to avoid duplication
    const fileCount = fileChanges.length;
    const fileList = fileChanges.map((f) => f.path).join(', ');

    logger.debug('Adding timeline entry for file changes', {
      fileCount,
      fileList,
    });

    context.changeDetectorManager.addTimelineEntry(
      context.workspaceId,
      'DiffCreated',
      `Agent modified ${fileCount} file${fileCount !== 1 ? 's' : ''}: ${fileList}`,
      { type: 'agent', id: context.agentId, name: context.agentName },
      {
        diffId: diffChunk?.id,
        fileCount,
        files: fileChanges.map((f) => ({
          path: f.path,
          action: f.action,
          additions: f.additions || 0,
          deletions: f.deletions || 0,
        })),
        agentId: context.agentId,
        agentName: context.agentName,
        turnNumber: context.turnNumber,
        sessionId: context.agentId,
      },
    );

    logger.debug('Successfully tracked and logged agent file changes', {
      count: fileChanges.length,
    });
  } catch (error) {
    logger.error(
      'Failed to track agent file changes',
      error instanceof Error ? error : new Error(String(error)),
    );
  } finally {
    // Clear pending operations
    logger.debug('Clearing pending file operations', {
      workspaceId: context.workspaceId,
    });
    clearPendingFileOperations(context.workspaceId);
  }
}

/**
 * Format tool execution results for agent
 */
export function formatToolResults(results: ToolExecutionResult[]): string {
  if (results.length === 0) {
    return '';
  }

  const parts: string[] = [];

  for (const result of results) {
    if (result.success) {
      parts.push(`✓ ${result.toolName}: ${JSON.stringify(result.result)}`);
    } else {
      parts.push(`✗ ${result.toolName}: ${result.error}`);
    }
  }

  return `\n\nTool Results:\n${parts.join('\n')}`;
}

/**
 * Create a follow-up message with tool results
 */
export function createToolResultMessage(results: ToolExecutionResult[]): AgentMessage {
  const successCount = results.filter((r) => r.success).length;
  const failureCount = results.filter((r) => !r.success).length;

  const summary = `Tool execution completed: ${successCount} succeeded, ${failureCount} failed.`;
  const details = formatToolResults(results);

  return {
    role: 'user',
    contentBlocks: [{ type: 'text' as const, text: `${summary}${details}` }],
  };
}

/**
 * Check if all tool executions were successful
 */
export function allToolsSucceeded(results: ToolExecutionResult[]): boolean {
  return results.length > 0 && results.every((r) => r.success);
}

/**
 * Get failed tool results
 */
export function getFailedTools(results: ToolExecutionResult[]): ToolExecutionResult[] {
  return results.filter((r) => !r.success);
}

/**
 * Get successful tool results
 */
export function getSuccessfulTools(results: ToolExecutionResult[]): ToolExecutionResult[] {
  return results.filter((r) => r.success);
}
