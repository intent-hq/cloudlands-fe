/**
 * MCP STDIO Proxy Tests
 *
 * Tests the STDIO proxy that forwards MCP requests to the HTTP MCP Bridge
 * These are integration tests that spawn the actual STDIO proxy process
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { spawn, ChildProcess } from 'child_process';
import { HttpMcpBridge } from '../http-mcp-bridge';
import path from 'path';
import fs from 'fs/promises';

// Mock electron-store
vi.mock('electron-store', () => ({
  __esModule: true,
  default: vi.fn().mockImplementation(() => ({
    set: vi.fn(),
    get: vi.fn(),
    store: {},
  })),
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
  const testPort = 3003; // Use different port to avoid conflicts
  const testWorkspaceId = 'test-workspace';
  const testWorkspacePath = '/tmp/test-workspace';

  beforeAll(async () => {
    // Create test workspace directory
    await fs.mkdir(testWorkspacePath, { recursive: true });

    // Start the HTTP MCP Bridge first
    bridge = new HttpMcpBridge(testPort);
    await bridge.start();

    // Wait for HTTP server to be ready
    await new Promise((resolve) => setTimeout(resolve, 200));
  });

  afterAll(async () => {
    // Clean up STDIO process
    if (stdioProcess && !stdioProcess.killed) {
      stdioProcess.kill();
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
      // Find the compiled STDIO server
      const stdioServerPath = path.join(process.cwd(), 'dist/main/mcp-stdio-server.js');

      // Check if compiled version exists
      let serverExists = false;
      try {
        await fs.access(stdioServerPath);
        serverExists = true;
      } catch  {
        // Will use TypeScript version with tsx
      }

      const command = serverExists ? 'node' : 'npx';
      const args = serverExists
        ? [stdioServerPath, testWorkspaceId, testWorkspacePath]
        : ['tsx', 'src/main/mcp-stdio-server.ts', testWorkspaceId, testWorkspacePath];

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
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('STDIO proxy failed to start within timeout'));
        }, 10000);

        let stderrData = '';
        let stdoutData = '';

        const checkForReadyMessage = (text: string) => {
          if (
            text.includes('HTTP MCP server is available') ||
            text.includes('MCP STDIO proxy ready')
          ) {
            clearTimeout(timeout);
            resolve(void 0);
          }
        };

        stdioProcess.stderr?.on('data', (data) => {
          const text = data.toString();
          stderrData += text;
          checkForReadyMessage(text);
        });

        stdioProcess.stdout?.on('data', (data) => {
          const text = data.toString();
          stdoutData += text;
          checkForReadyMessage(text);
        });

        stdioProcess.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });

        stdioProcess.on('exit', (code) => {
          if (code !== 0) {
            clearTimeout(timeout);
            reject(
              new Error(
                `STDIO proxy exited with code ${code}. stderr: ${stderrData}, stdout: ${stdoutData}`,
              ),
            );
          }
        });
      });

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
      const response = await new Promise<any>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('No response received within timeout'));
        }, 5000);

        let buffer = '';
        const onData = (data: Buffer) => {
          buffer += data.toString();
          let idx: number;
          while ((idx = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, idx).trim();
            buffer = buffer.slice(idx + 1);
            if (!line) continue;
            try {
              const responseObj = JSON.parse(line);
              clearTimeout(timeout);
              stdioProcess.stdout?.off('data', onData);
              resolve(responseObj);
              return;
            } catch {
              // not a complete JSON line yet, continue accumulating
            }
          }
        };

        stdioProcess.stdout?.on('data', onData);
      });

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
      const response = await new Promise<any>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('No response received within timeout'));
        }, 5000);

        let buffer = '';
        const onData = (data: Buffer) => {
          buffer += data.toString();
          let idx: number;
          while ((idx = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, idx).trim();
            buffer = buffer.slice(idx + 1);
            if (!line) continue;
            try {
              const responseObj = JSON.parse(line);
              clearTimeout(timeout);
              stdioProcess.stdout?.off('data', onData);
              resolve(responseObj);
              return;
            } catch {
              // not a complete JSON line yet, continue accumulating
            }
          }
        };

        stdioProcess.stdout?.on('data', onData);
      });

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
  });
});
