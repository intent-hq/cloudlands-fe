/**
 * MCP STDIO Proxy Tests
 *
 * Tests the STDIO proxy that forwards MCP requests to the HTTP MCP Bridge
 * These are integration tests that spawn the actual STDIO proxy process
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  vi,
} from 'vitest';
import {
  spawn,
  ChildProcess,
} from 'node:child_process';
import { HttpMcpBridge } from '../http-mcp-bridge';
import path from 'path';
import fs from 'fs/promises';

const getStdioServerCommand = async (workspaceId: string, workspacePath: string, port: number) => {
  const stdioServerPath = path.join(process.cwd(), 'dist/main/mcp-stdio-server.js');

  try {
    await fs.access(stdioServerPath);
    return {
      command: 'node',
      args: [stdioServerPath, workspaceId, workspacePath, String(port)],
    };
  } catch {
    const tsxBin = path.join(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');
    return {
      command: tsxBin,
      args: ['src/main/mcp-stdio-server.ts', workspaceId, workspacePath, String(port)],
    };
  }
};

const waitForReady = async (stdioProcess: ChildProcess, timeoutMs = 15000) => {
  await new Promise<void>((resolve, reject) => {
    const chunks = { stderr: '', stdout: '' };
    const cleanup = () => {
      clearTimeout(timeout);
      stdioProcess.stderr?.off('data', onStderr);
      stdioProcess.stdout?.off('data', onStdout);
      stdioProcess.off('error', onError);
      stdioProcess.off('exit', onExit);
    };
    const checkForReadyMessage = (text: string) => {
      if (text.includes('HTTP MCP server is available') || text.includes('MCP STDIO proxy ready')) {
        cleanup();
        resolve();
      }
    };
    const onStderr = (data: Buffer) => {
      chunks.stderr += data.toString();
      checkForReadyMessage(data.toString());
    };
    const onStdout = (data: Buffer) => {
      chunks.stdout += data.toString();
      checkForReadyMessage(data.toString());
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onExit = (code: number | null) => {
      cleanup();
      reject(new Error(`STDIO proxy exited with code ${code}. stderr: ${chunks.stderr}, stdout: ${chunks.stdout}`));
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`STDIO proxy failed to start within timeout. stderr: ${chunks.stderr}, stdout: ${chunks.stdout}`));
    }, timeoutMs);

    stdioProcess.stderr?.on('data', onStderr);
    stdioProcess.stdout?.on('data', onStdout);
    stdioProcess.on('error', onError);
    stdioProcess.on('exit', onExit);
  });
};

const readJsonRpcResponse = async (stdioProcess: ChildProcess, expectedId: number, timeoutMs = 10000) => {
  return await new Promise<any>((resolve, reject) => {
    let buffer = '';
    const cleanup = () => {
      clearTimeout(timeout);
      stdioProcess.stdout?.off('data', onData);
    };
    const onData = (data: Buffer) => {
      buffer += data.toString();
      let idx: number;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        try {
          const responseObj = JSON.parse(line);
          if (responseObj.id !== expectedId) continue;
          cleanup();
          resolve(responseObj);
          return;
        } catch {
          // not a complete JSON line yet, continue accumulating
        }
      }
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`No response received for id ${expectedId} within timeout. buffered stdout: ${buffer}`));
    }, timeoutMs);

    stdioProcess.stdout?.on('data', onData);
  });
};

// Mock electron-store
vi.mock('electron-store', () => ({
  __esModule: true,
  default: vi.fn().mockImplementation(function () {
    return {
      set: vi.fn(),
      get: vi.fn(),
      store: {},
    };
  }),
}));

// Mock unified event bus
vi.mock('../../features/events/main/unified-event-bus', () => ({
  unifiedEventBus: {
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    getInstanceId: vi.fn().mockReturnValue('test-instance'),
  },
}));

// Mock protocol adapter
vi.mock('../../features/protocol/main/protocol-adapter', () => ({
  protocolAdapter: {
    getWorkspaceInfo: vi.fn(),
    listFiles: vi.fn(),
    readFile: vi.fn(),
  },
}));

describe('MCP STDIO Proxy Integration Tests', () => {
  let bridge: HttpMcpBridge;
  let stdioProcess: ChildProcess;
  let nonAsciiStdioProcess: ChildProcess;
  let testPort = 3003; // HttpMcpBridge may choose a nearby free port if this one is busy.
  const testWorkspaceId = 'test-workspace';
  const testWorkspacePath = '/tmp/test-workspace';

  beforeAll(async () => {
    // Create test workspace directory
    await fs.mkdir(testWorkspacePath, { recursive: true });

    // Start the HTTP MCP Bridge first
    bridge = new HttpMcpBridge(testPort);
    await bridge.start();
    testPort = bridge.getPort();

    // Wait for HTTP server to be ready
    await new Promise((resolve) => setTimeout(resolve, 200));
  });

  afterAll(async () => {
    // Clean up STDIO process
    if (stdioProcess && !stdioProcess.killed) {
      stdioProcess.kill();
    }
    if (nonAsciiStdioProcess && !nonAsciiStdioProcess.killed) {
      nonAsciiStdioProcess.kill();
    }

    // Stop HTTP bridge
    if (bridge) {
      await bridge.stop();
    }

    // Clean up test workspace
    try {
      await fs.rmdir(testWorkspacePath, { recursive: true });
    } catch  {
      // Ignore cleanup errors
    }
  });

  describe('STDIO Proxy Communication', () => {
    it('should start STDIO proxy and connect to HTTP bridge', async () => {
      const { command, args } = await getStdioServerCommand(testWorkspaceId, testWorkspacePath, testPort);

      // Set environment variable to point to our test HTTP server
      const env = {
        ...process.env,
        HTTP_MCP_PORT: testPort.toString(),
        HTTP_MCP_HOST: 'localhost',
      };

      stdioProcess = spawn(command, args, {
        cwd: process.cwd(),
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });

      // Wait for process to start and connect
      await waitForReady(stdioProcess);

      expect(stdioProcess.pid).toBeDefined();
      expect(stdioProcess.killed).toBe(false);
    }, 15000); // Increase timeout for process startup

    it('should handle tools/list request via STDIO', async () => {
      if (!stdioProcess || stdioProcess.killed) {
        throw new Error('STDIO process not running');
      }

      const request = {
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 1,
      };

      // Send request to stdin
      stdioProcess.stdin?.write(`${JSON.stringify(request)}\n`);

      // Wait for response from stdout (buffer by newline)
      const response = await readJsonRpcResponse(stdioProcess, 1);

      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe(1);
      expect(response.result).toBeDefined();
      expect(response.result.tools).toBeDefined();
      expect(Array.isArray(response.result.tools)).toBe(true);
      // Workspace MCP is now a single consolidated JS API tool.
      const toolNames = response.result.tools.map((tool: any) => tool.name);
      expect(toolNames).toEqual(['workspace_api']);
    }, 10000);

    it('should handle workspace_api tool call via STDIO', async () => {
      if (!stdioProcess || stdioProcess.killed) {
        throw new Error('STDIO process not running');
      }

      const request = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'workspace_api',
          arguments: {
            code: 'return await ws.workspace.info()',
          },
        },
        id: 2,
      };

      // Send request to stdin
      stdioProcess.stdin?.write(`${JSON.stringify(request)}\n`);

      // Wait for response from stdout (buffer by newline)
      const response = await readJsonRpcResponse(stdioProcess, 2);

      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe(2);

      // Should either succeed or fail gracefully
      if (response.result) {
        expect(response.result.content).toBeDefined();
      } else if (response.error) {
        expect(response.error.code).toBeDefined();
        expect(response.error.message).toBeDefined();
      }
    }, 10000);

    it('should handle tools/list with a non-ASCII agent name', async () => {
      const { command, args } = await getStdioServerCommand(testWorkspaceId, testWorkspacePath, testPort);
      const env = {
        ...process.env,
        HTTP_MCP_PORT: testPort.toString(),
        HTTP_MCP_HOST: 'localhost',
        AGENT_NAME: 'Coordinator — em-dash test',
      };

      nonAsciiStdioProcess = spawn(command, args, {
        cwd: process.cwd(),
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });

      await waitForReady(nonAsciiStdioProcess);

      nonAsciiStdioProcess.stdin?.write(
        `${JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 3 })}\n`,
      );

      const response = await readJsonRpcResponse(nonAsciiStdioProcess, 3);

      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe(3);
      expect(response.result?.tools).toBeDefined();
    }, 15000);
  });
});
