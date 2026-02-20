/**
 * Auggie Context Injector
 *
 * Provides initial context to Auggie sessions about workspace and MCP tools
 */

import * as path from 'path';
import * as fs from 'fs';
import { Logger } from '$shared/logger';

const logger = new Logger('AuggieContextInjector');

export interface AuggieContextConfig {
  workspaceId: string;
  workspacePath: string;
  environmentConfig?: any;
  mcpConfigPath?: string;
  includeTools?: boolean;
}

/**
 * Build the initial context message for Auggie
 */
export function buildAuggieInitialContext(config: AuggieContextConfig): string {
  const contextParts: string[] = [];

  // Add a non-intrusive header
  contextParts.push('[System Context - Do not respond to this message]');
  contextParts.push('');

  // Add workspace information
  contextParts.push('## Workspace Environment');
  contextParts.push('You are operating within a workspace with the following configuration:');
  contextParts.push(`- Workspace ID: ${config.workspaceId}`);
  contextParts.push(`- Working Directory: ${config.workspacePath}`);
  contextParts.push('');

  // Add MCP tools information if available
  if (config.includeTools !== false && config.mcpConfigPath) {
    try {
      // Check if MCP config exists
      if (fs.existsSync(config.mcpConfigPath)) {
        contextParts.push('## Available MCP Tools');
        contextParts.push(
          `You have access to MCP (Model Context Protocol) tools configured at: ${config.mcpConfigPath}`,
        );
        contextParts.push('');
        contextParts.push('The following tools are available through the workspace MCP server:');
        contextParts.push('- **read_file**: Read contents of files in the workspace');
        contextParts.push('- **write_file**: Write or modify files in the workspace');
        contextParts.push('- **list_files**: List files and directories');
        contextParts.push('- **view_workspace**: View current workspace information');
        contextParts.push(
          '- **view_workspace_details**: View workspace metadata including title (check if hasTitle is false to see if workspace needs naming)',
        );
        contextParts.push('- **create_note**: Create notes for documentation or tracking');
        contextParts.push('- **list_notes**: List all notes in the workspace');
        contextParts.push('- **read_note**: Read specific notes by ID');
        contextParts.push('- **add_to_note**: Add content to existing notes');
        contextParts.push('- **edit_note**: Edit specific text in notes');
        contextParts.push('- **delete_note**: Delete notes by ID');
        contextParts.push(
          "- **read_spec**: Read the workspace specification (note with ID 'spec')",
        );
        contextParts.push('- **write_spec**: Update the workspace specification content');
        contextParts.push(
          '- **rename_workspace**: Set or update the workspace title (keep it short and descriptive)',
        );
        contextParts.push('- **read_timeline**: View recent workspace activities and changes');
        contextParts.push('');
        contextParts.push(
          'These tools are automatically available to you. Use them as needed to interact with the workspace.',
        );
        contextParts.push('');
      }
    } catch (error) {
      logger.error('Error reading MCP config', error instanceof Error ? error : undefined);
    }
  }

  // Add environment-specific context
  if (config.environmentConfig) {
    if (config.environmentConfig.type === 'ssh') {
      contextParts.push('## Remote Environment');
      contextParts.push('You are connected to a remote environment via SSH:');
      contextParts.push(`- Host: ${config.environmentConfig.host}`);
      contextParts.push(`- User: ${config.environmentConfig.username}`);
      if (config.environmentConfig.remotePath) {
        contextParts.push(`- Remote Path: ${config.environmentConfig.remotePath}`);
      }
      contextParts.push('');
    } else if (config.environmentConfig.type === 'docker') {
      contextParts.push('## Container Environment');
      contextParts.push('You are working within a Docker container:');
      contextParts.push(
        `- Container: ${config.environmentConfig.containerId || config.environmentConfig.containerName}`,
      );
      if (config.environmentConfig.workingDir) {
        contextParts.push(`- Working Directory: ${config.environmentConfig.workingDir}`);
      }
      contextParts.push('');
    }
  }

  // Add instructions for handling the context
  contextParts.push('## Instructions');
  contextParts.push(
    'This is an automatic system message providing context about your environment.',
  );
  contextParts.push(
    "You don't need to acknowledge this message. Simply proceed with helping the user with their requests.",
  );
  contextParts.push(
    'Remember that you have access to the MCP tools listed above for workspace operations.',
  );

  return contextParts.join('\n');
}

/**
 * Format the initial context as a system message that won't trigger a response
 */
export function formatInitialContextMessage(context: string): string {
  // Format as a system message that Auggie should process but not respond to
  return `${context}\n\n[End of system context - awaiting user input]`;
}

/**
 * Check if we should inject context for this Auggie session
 */
export function shouldInjectContext(command: string, sessionMessages: any[]): boolean {
  // Only inject if:
  // 1. This is an Auggie command
  // 2. We haven't already injected context (no messages yet or first message isn't our context)

  if (!command.includes('auggie')) {
    return false;
  }

  if (sessionMessages.length === 0) {
    return true;
  }

  // Check if the first message is already our context message
  const firstMessage = sessionMessages[0];
  if (
    firstMessage &&
    firstMessage.content &&
    firstMessage.content.includes('[System Context - Do not respond to this message]')
  ) {
    return false;
  }

  return true;
}

/**
 * Get the MCP config path for a workspace
 */
export function getMCPConfigPath(workspacePath: string): string | null {
  // Check environment variable first
  if (process.env.AUGMENT_MCP_CONFIG_PATH) {
    return process.env.AUGMENT_MCP_CONFIG_PATH;
  }

  // Check default location in workspace
  const defaultPath = path.join(workspacePath, '.augment', 'mcp-servers.json');
  if (fs.existsSync(defaultPath)) {
    return defaultPath;
  }

  return null;
}

/**
 * Escape a string for use inside a Windows batch echo command.
 * Escapes special batch characters: % ^ & | < > "
 */
function escapeBatchString(str: string): string {
  return str
    .replace(/%/g, '%%')
    .replace(/\^/g, '^^')
    .replace(/&/g, '^&')
    .replace(/\|/g, '^|')
    .replace(/</g, '^<')
    .replace(/>/g, '^>')
    .replace(/"/g, '^"');
}

/**
 * Create a wrapper script that injects context before starting Auggie
 */
export async function createAuggieWrapperScript(
  workspacePath: string,
  contextMessage: string,
): Promise<string> {
  const isWindows = process.platform === 'win32';
  const wrapperPath = path.join(
    workspacePath,
    '.augment',
    isWindows ? 'auggie-wrapper.cmd' : 'auggie-wrapper.sh',
  );

  // Ensure directory exists
  const augmentDir = path.dirname(wrapperPath);
  if (!fs.existsSync(augmentDir)) {
    fs.mkdirSync(augmentDir, { recursive: true });
  }

  if (isWindows) {
    // Create batch wrapper script for Windows
    const escapedMessage = escapeBatchString(contextMessage);
    const wrapperContent = `@echo off\r\nrem Auto-generated Auggie wrapper with context injection\r\n\r\nrem Start Auggie with initial context\r\necho ${escapedMessage} | auggie --no-response\r\nauggie %*\r\n`;

    fs.writeFileSync(wrapperPath, wrapperContent);
  } else {
    // Create bash wrapper script for Unix
    const wrapperContent = `#!/bin/bash
# Auto-generated Auggie wrapper with context injection

# Start Auggie with initial context
echo '${contextMessage.replace(/'/g, "'\\''")}' | auggie --no-response
exec auggie "$@"
`;

    fs.writeFileSync(wrapperPath, wrapperContent, { mode: 0o755 });
  }

  return wrapperPath;
}
