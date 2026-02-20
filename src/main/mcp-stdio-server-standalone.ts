/**
 * Standalone MCP STDIO Server
 *
 * Provides MCP tools directly without requiring HTTP MCP Bridge
 */

import * as fs from 'fs';
import * as path from 'path';

// Handle EPIPE errors on stdout/stderr to prevent uncaught exceptions
process.stdout.on('error', (err) => {
  if (err && 'code' in err && (err as NodeJS.ErrnoException).code === 'EPIPE') {
    process.exit(0);
  }
});
process.stderr.on('error', (err) => {
  if (err && 'code' in err && (err as NodeJS.ErrnoException).code === 'EPIPE') {
    process.exit(0);
  }
});

/**
 * Safe wrapper for process.stdout.write that handles EPIPE gracefully.
 */
function safeStdoutWrite(data: string): boolean {
  try {
    if (process.stdout.writable) {
      return process.stdout.write(data);
    }
    return false;
  } catch {
    return false;
  }
}

// Override console to write to stderr
console.log = (...args) => { try { process.stderr.write(`[LOG] ${args.join(' ')}\n`); } catch { /* ignore */ } };
console.error = (...args) => { try { process.stderr.write(`[ERROR] ${args.join(' ')}\n`); } catch { /* ignore */ } };

const logToStderr = (level: string, message: string, context?: any) => {
  const timestamp = new Date().toISOString();
  const contextStr = context ? ` ${JSON.stringify(context)}` : '';
  try { process.stderr.write(`[${timestamp}] [${level}] [MCPStandalone] ${message}${contextStr}\n`); } catch { /* ignore EPIPE */ }
};

// Get workspace info from environment
const WORKSPACE_ID = process.env.WORKSPACE_ID || '';
const WORKSPACE_PATH = process.env.WORKSPACE_PATH || '';

// Simple MCP tools implementation
const tools = {
  read_file: {
    description: 'Read a file from the workspace',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file relative to workspace root' },
      },
      required: ['path'],
    },
  },
  write_file: {
    description: 'Write a file to the workspace',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file relative to workspace root' },
        content: { type: 'string', description: 'Content to write to the file' },
      },
      required: ['path', 'content'],
    },
  },
  list_files: {
    description: 'List files in a directory',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the directory relative to workspace root' },
      },
      required: ['path'],
    },
  },
  rename_workspace: {
    description: 'Rename the workspace',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'New name for the workspace' },
      },
      required: ['name'],
    },
  },
};

async function handleToolCall(toolName: string, args: any): Promise<any> {
  try {
    switch (toolName) {
      case 'read_file': {
        const filePath = path.join(WORKSPACE_PATH, args.path);
        const content = fs.readFileSync(filePath, 'utf8');
        return { content };
      }
      case 'write_file': {
        const filePath = path.join(WORKSPACE_PATH, args.path);
        fs.writeFileSync(filePath, args.content, 'utf8');
        return { success: true };
      }
      case 'list_files': {
        const dirPath = path.join(WORKSPACE_PATH, args.path || '.');
        const files = fs.readdirSync(dirPath);
        return { files };
      }
      case 'rename_workspace': {
        // Update .workspace file
        const workspaceFile = path.join(WORKSPACE_PATH, '.workspace');
        if (fs.existsSync(workspaceFile)) {
          const config = { name: args.name };
          fs.writeFileSync(workspaceFile, JSON.stringify(config, null, 2));
          return { success: true, message: `Workspace renamed to "${args.name}"` };
        }
        return { error: 'Workspace configuration file not found' };
      }
      default:
        return { error: `Unknown tool: ${toolName}` };
    }
  } catch (error) {
    return { error: (error as Error).message };
  }
}

async function handleRequest(request: any): Promise<any> {
  const { method, params, id } = request;

  switch (method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '1.0',
          serverInfo: { name: 'Workspace MCP Server', version: '1.0.0' },
          capabilities: { tools: true },
        },
      };

    case 'tools/list':
      return {
        jsonrpc: '2.0',
        id,
        result: Object.entries(tools).map(([name, tool]) => ({
          name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      };

    case 'tools/call':
      const result = await handleToolCall(params.name, params.arguments || {});
      return {
        jsonrpc: '2.0',
        id,
        result,
      };

    default:
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      };
  }
}

// Main
async function main() {
  logToStderr('INFO', 'Starting standalone MCP server', { WORKSPACE_ID, WORKSPACE_PATH });

  process.stdin.setEncoding('utf8');
  let buffer = '';

  process.stdin.on('data', async (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const request = JSON.parse(line);
        const response = await handleRequest(request);
        safeStdoutWrite(`${JSON.stringify(response)}\n`);
      } catch (error) {
        logToStderr('ERROR', 'Failed to process request', { error: (error as Error).message });
      }
    }
  });
}

main().catch((error) => {
  logToStderr('ERROR', 'Fatal error', { error: error.message });
  process.exit(1);
});
