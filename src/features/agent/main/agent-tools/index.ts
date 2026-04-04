import { Tool } from '../agent-providers/base-provider';
import { remoteRPCManager } from '$shared/main/remote-rpc-manager';
import { RemoteRPCError } from '$shared/main/remote-rpc-client';
import * as fs from 'fs/promises';
import { execAsync } from '../../../../shared/git/git-env';

// Track file operations for agent provenance
interface FileOperation {
  path: string;
  operation: 'write' | 'delete' | 'mkdir';
  timestamp: string;
}

// Store pending file operations per agent session
const pendingFileOperations = new Map<string, FileOperation[]>();

/**
 * Track a file operation for agent provenance tracking.
 * Records file operations performed by an agent for audit and rollback purposes.
 *
 * @param agentId - Unique identifier of the agent performing the operation
 * @param filePath - Path to the file being operated on
 * @param operation - Type of file operation being performed
 * @example
 * ```typescript
 * trackFileOperation('agent-123', '/path/to/file.ts', 'write');
 * ```
 */
export function trackFileOperation(
  agentId: string,
  filePath: string,
  operation: 'write' | 'delete' | 'mkdir',
) {
  if (!pendingFileOperations.has(agentId)) {
    pendingFileOperations.set(agentId, []);
  }
  pendingFileOperations.get(agentId)!.push({
    path: filePath,
    operation,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Get all pending file operations for a specific agent.
 * Useful for reviewing changes before committing or for rollback operations.
 *
 * @param agentId - Unique identifier of the agent
 * @returns Array of file operations performed by the agent
 * @example
 * ```typescript
 * const operations = getPendingFileOperations('agent-123');
 * console.log(`Agent performed ${operations.length} file operations`);
 * ```
 */
export function getPendingFileOperations(agentId: string): FileOperation[] {
  return pendingFileOperations.get(agentId) || [];
}

/**
 * Clear all pending file operations for a specific agent.
 * Should be called after operations are committed or when resetting agent state.
 *
 * @param agentId - Unique identifier of the agent
 * @example
 * ```typescript
 * // After committing changes
 * clearPendingFileOperations('agent-123');
 * ```
 */
export function clearPendingFileOperations(agentId: string) {
  pendingFileOperations.delete(agentId);
}

/**
 * File system tool - read, write, list files
 */
export const fileSystemTool: Tool = {
  name: 'file_system',
  description: 'Perform file system operations like reading, writing, and listing files',
  parameters: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['read', 'write', 'list', 'delete', 'mkdir'],
        description: 'The operation to perform',
      },
      path: {
        type: 'string',
        description: 'The file or directory path',
      },
      content: {
        type: 'string',
        description: 'Content to write (for write operation)',
      },
    },
    required: ['operation', 'path'],
  },
  execute: async (params: any) => {
    const { operation, path: filePath, content } = params;

    switch (operation) {
      case 'read':
        return await fs.readFile(filePath, 'utf-8');

      case 'write':
        await fs.writeFile(filePath, content || '', 'utf-8');
        return `File written successfully: ${filePath}`;

      case 'list':
        const files = await fs.readdir(filePath);
        return files;

      case 'delete':
        await fs.unlink(filePath);
        return `File deleted: ${filePath}`;

      case 'mkdir':
        await fs.mkdir(filePath, { recursive: true });
        return `Directory created: ${filePath}`;

      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
  },
};

/**
 * Check if a command is a disallowed git staging/commit-all command.
 * Prevents agents from accidentally committing changes they didn't make.
 */
function isDisallowedGitCommand(command: string): { disallowed: boolean; reason?: string } {
  const trimmed = command.trim().toLowerCase();

  // Check for git add with wildcards or all flags
  if (trimmed.startsWith('git add') || trimmed.startsWith('git stage')) {
    if (
      trimmed.includes(' .') ||
      trimmed.includes(' -a') ||
      trimmed.includes(' --all') ||
      trimmed.includes(' -u') ||
      trimmed.includes(' *')
    ) {
      return {
        disallowed: true,
        reason: 'Staging all files is not allowed. Please specify individual file paths. ' +
          'Use "git status" to see which files you have modified, then stage only those specific files.',
      };
    }
  }

  // Check for git commit -a (stages and commits all)
  if (trimmed.startsWith('git commit')) {
    if (trimmed.includes(' -a') || trimmed.includes(' --all')) {
      return {
        disallowed: true,
        reason: 'Using "git commit -a" is not allowed. Please stage specific files first using "git add <file>", then commit.',
      };
    }
  }

  return { disallowed: false };
}

/**
 * Command execution tool - run shell commands
 *
 * IMPORTANT: Certain git commands that stage/commit all files are blocked
 * to prevent agents from accidentally committing changes they didn't make.
 */
export const commandTool: Tool = {
  name: 'execute_command',
  description: 'Execute shell commands in the workspace. Note: git add/commit commands that stage all files are not allowed.',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The command to execute',
      },
      cwd: {
        type: 'string',
        description: 'Working directory for the command',
      },
      workspaceId: {
        type: 'string',
        description: 'Workspace ID for remote execution (optional)',
      },
    },
    required: ['command'],
  },
  execute: async (params: any) => {
    const { command, cwd, workspaceId } = params;

    // Check for disallowed git commands
    const gitCheck = isDisallowedGitCommand(command);
    if (gitCheck.disallowed) {
      return {
        stdout: '',
        stderr: gitCheck.reason || 'Command not allowed',
        exitCode: 1,
      };
    }

    // Block git commit commands when auto-commit is disabled
    if (workspaceId && command.trim().toLowerCase().startsWith('git commit')) {
      const { assertAgentCommitAllowed } = await import(
        '../../../workspace/main/workspace-settings.service'
      );
      const commitCheck = assertAgentCommitAllowed(workspaceId);
      if (!commitCheck.allowed) {
        return {
          stdout: '',
          stderr: commitCheck.reason,
          exitCode: 1,
        };
      }
    }

    if (workspaceId) {
      // Execute remotely via RPC
      try {
        const rpcClient = await remoteRPCManager.getClient(workspaceId);
        const result = await rpcClient.exec({ command, cwd });
        return {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: 0,
        };
      } catch (error) {
        if (error instanceof RemoteRPCError && error.data) {
          const data = error.data as { stdout?: string; stderr?: string; exitCode?: number };
          return {
            stdout: data.stdout || '',
            stderr: data.stderr || error.message,
            exitCode: data.exitCode || 1,
          };
        }
        throw error;
      }
    } else {
      // Execute locally
      try {
        const { stdout, stderr } = await execAsync(command, { cwd });
        return {
          stdout,
          stderr,
          exitCode: 0,
        };
      } catch (error) {
        const execError = error as Error & { stdout?: string; stderr?: string; code?: number };
        return {
          stdout: execError.stdout || '',
          stderr: execError.stderr || execError.message,
          exitCode: execError.code || 1,
        };
      }
    }
  },
};

/**
 * Git tool - perform git operations
 *
 * IMPORTANT: For 'add' operations, agents must specify individual file paths.
 * Staging all files (using "." or "-A" or "--all") is not allowed to prevent
 * accidentally committing changes made by setup scripts or other non-agent sources.
 */
export const gitTool: Tool = {
  name: 'git',
  description: 'Perform git operations like status, diff, commit, etc. For add operations, you must specify individual file paths.',
  parameters: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['status', 'diff', 'add', 'commit', 'push', 'pull', 'branch', 'checkout'],
        description: 'The git operation to perform',
      },
      args: {
        type: 'array',
        items: { type: 'string' },
        description: 'Additional arguments for the git command. For add, must be specific file paths.',
      },
      cwd: {
        type: 'string',
        description: 'Working directory for the git command',
      },
    },
    required: ['operation'],
  },
  execute: async (params: any) => {
    const { operation, args = [], cwd } = params;

    // Prevent staging all files - agents should only stage specific files they've modified
    if (operation === 'add') {
      if (args.length === 0 || args.includes('.') || args.includes('-A') || args.includes('--all') || args.includes('-u')) {
        return {
          success: false,
          error: 'Staging all files is not allowed. Please specify individual file paths to stage. ' +
            'Use "git status" to see which files you have modified, then stage only those specific files.',
        };
      }
    }

    // Prevent commit -a which stages and commits all modified files
    if (operation === 'commit') {
      if (args.includes('-a') || args.includes('--all')) {
        return {
          success: false,
          error: 'Using "git commit -a" is not allowed. Please stage specific files first using "git add <file>", then commit.',
        };
      }

      // Check auto-commit setting - block commits when auto-commit is disabled
      if (params.workspaceId) {
        const { assertAgentCommitAllowed } = await import(
          '../../../workspace/main/workspace-settings.service'
        );
        const commitCheck = assertAgentCommitAllowed(params.workspaceId);
        if (!commitCheck.allowed) {
          return {
            success: false,
            error: commitCheck.reason,
          };
        }
      }
    }

    const command = `git ${operation} ${args.join(' ')}`.trim();

    try {
      const { stdout, stderr } = await execAsync(command, { cwd });
      return {
        success: true,
        output: stdout || stderr,
      };
    } catch (error) {
      const execError = error as Error & { stderr?: string };
      return {
        success: false,
        error: execError.stderr || execError.message,
      };
    }
  },
};

/**
 * Web search tool - search the web for information
 */
export const webSearchTool: Tool = {
  name: 'web_search',
  description: 'Search the web for information',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query',
      },
      numResults: {
        type: 'number',
        description: 'Number of results to return',
        default: 5,
      },
    },
    required: ['query'],
  },
  execute: async (params: any) => {
    const { query } = params;

    // Placeholder implementation
    // Future: Integrate with search API (Google, Bing, etc.)
    return {
      results: [
        {
          title: 'Search result 1',
          url: 'https://example.com/1',
          snippet: `Result for "${query}"`,
        },
      ],
    };
  },
};

/**
 * Code analysis tool - analyze code structure and dependencies
 */
export const codeAnalysisTool: Tool = {
  name: 'analyze_code',
  description: 'Analyze code structure, find definitions, references, etc.',
  parameters: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['find_definition', 'find_references', 'get_symbols', 'get_dependencies'],
        description: 'The analysis operation to perform',
      },
      filePath: {
        type: 'string',
        description: 'Path to the file to analyze',
      },
      symbol: {
        type: 'string',
        description: 'Symbol name to search for',
      },
    },
    required: ['operation'],
  },
  execute: async (params: any) => {
    const { operation, filePath, symbol } = params;

    // Simple grep-based implementation
    // Future: Use language-specific parsers (tree-sitter, etc.)
    switch (operation) {
      case 'find_definition':
        const defCommand = `grep -n "function ${symbol}\\|class ${symbol}\\|const ${symbol}\\|let ${symbol}\\|var ${symbol}" ${filePath}`;
        try {
          const { stdout } = await execAsync(defCommand);
          return stdout.split('\n').filter((line) => line.trim());
        } catch {
          return [];
        }

      case 'find_references':
        const refCommand = `grep -n "${symbol}" ${filePath}`;
        try {
          const { stdout } = await execAsync(refCommand);
          return stdout.split('\n').filter((line) => line.trim());
        } catch {
          return [];
        }

      default:
        return [];
    }
  },
};

/**
 * Environment detection tool
 */
export const environmentTool: Tool = {
  name: 'detect_environment',
  description: 'Detect the development environment, languages, and tools',
  parameters: {
    type: 'object',
    properties: {
      workspaceId: {
        type: 'string',
        description: 'Workspace ID for remote detection (optional)',
      },
    },
  },
  execute: async (params: any) => {
    const { workspaceId } = params;

    if (workspaceId) {
      const rpcClient = await remoteRPCManager.getClient(workspaceId);
      const checks = [
        { command: 'node --version', name: 'Node.js' },
        { command: 'python --version', name: 'Python' },
        { command: 'ruby --version', name: 'Ruby' },
        { command: 'go version', name: 'Go' },
        { command: 'cargo --version', name: 'Rust' },
        { command: 'java -version', name: 'Java' },
      ];
      const detected = [];
      for (const check of checks) {
        try {
          await rpcClient.exec({ command: check.command });
          detected.push(check.name);
        } catch {
          // Not installed or command failed
        }
      }
      // Get OS info
      let os = 'unknown';
      try {
        const osResult = await rpcClient.exec({ command: 'uname -s' });
        os = osResult.stdout.trim().toLowerCase();
      } catch {
        // fallback
      }
      return { os, languages: detected, tools: [] };
    }

    // Local environment detection
    const checks = [
      { command: 'node --version', name: 'Node.js' },
      { command: 'python --version', name: 'Python' },
      { command: 'ruby --version', name: 'Ruby' },
      { command: 'go version', name: 'Go' },
      { command: 'cargo --version', name: 'Rust' },
      { command: 'java -version', name: 'Java' },
    ];

    const detected = [];
    for (const check of checks) {
      try {
        await execAsync(check.command);
        detected.push(check.name);
      } catch {
        // Not installed
      }
    }

    return {
      os: process.platform,
      languages: detected,
      tools: [],
    };
  },
};

/**
 * Get all available agent tools.
 * Returns the complete set of built-in tools that agents can use.
 *
 * @returns Array of all available Tool instances
 * @example
 * ```typescript
 * const tools = getAllTools();
 * console.log(`${tools.length} tools available`);
 * ```
 */
export function getAllTools(): Tool[] {
  return [fileSystemTool, commandTool, gitTool, webSearchTool, codeAnalysisTool, environmentTool];
}

/**
 * Get specific tools by their names.
 * Filters the available tools to only return those matching the provided names.
 *
 * @param names - Array of tool names to retrieve
 * @returns Array of Tool instances matching the provided names
 * @example
 * ```typescript
 * const tools = getToolsByNames(['file_system', 'git']);
 * // Returns only file system and git tools
 * ```
 */
export function getToolsByNames(names: string[]): Tool[] {
  const allTools = getAllTools();
  return allTools.filter((tool) => names.includes(tool.name));
}

/**
 * Create a custom tool with specified behavior.
 * Allows extending the agent's capabilities with domain-specific tools.
 *
 * @param name - Unique name for the tool
 * @param description - Human-readable description of what the tool does
 * @param execute - Async function that implements the tool's behavior
 * @param parameters - Optional JSON schema defining the tool's parameters
 * @returns A new Tool instance
 * @example
 * ```typescript
 * const customTool = createCustomTool(
 *   'database_query',
 *   'Execute database queries',
 *   async (params) => {
 *     const result = await db.query(params.query);
 *     return result;
 *   },
 *   {
 *     type: 'object',
 *     properties: {
 *       query: { type: 'string', description: 'SQL query to execute' }
 *     },
 *     required: ['query']
 *   }
 * );
 * ```
 */
export function createCustomTool(
  name: string,
  description: string,
  execute: (params: any) => Promise<any>,
  parameters?: any,
): Tool {
  return {
    name,
    description,
    parameters,
    execute,
  };
}
