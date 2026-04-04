/**
 * Tool Service Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ToolService } from '../main/tool.service';
import type { ToolContext, ToolOperation } from '../main/types';
import * as fs from 'fs/promises';
import * as path from 'path';
import { tmpdir } from 'os';

// Mock the services
vi.mock('../../workspace/workspace.service');
vi.mock('../../notes/notes.service');

describe('ToolService', () => {
  let toolService: ToolService;
  let testDir: string;
  let context: ToolContext;

  beforeEach(async () => {
    // Create test directory
    testDir = path.join(tmpdir(), `tool-service-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });

    // Create service
    toolService = new ToolService();

    // Create test context
    context = {
      workspaceId: 'test-workspace',
      agentId: 'test-agent',
      input: {},
      metadata: {},
      executor: {
        readFile: async (filePath: string) => {
          const fullPath = path.isAbsolute(filePath) ? filePath : path.join(testDir, filePath);
          return fs.readFile(fullPath, 'utf-8');
        },
        writeFile: async (filePath: string, content: string) => {
          const fullPath = path.isAbsolute(filePath) ? filePath : path.join(testDir, filePath);
          return fs.writeFile(fullPath, content, 'utf-8');
        },
        deleteFile: async (filePath: string) => {
          const fullPath = path.isAbsolute(filePath) ? filePath : path.join(testDir, filePath);
          return fs.unlink(fullPath);
        },
        listFiles: async (directory: string) => {
          const fullPath = path.isAbsolute(directory) ? directory : path.join(testDir, directory);
          const files = await fs.readdir(fullPath);
          return files;
        },
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        execute: async (command: string, options?: any) => ({
          stdout: '',
          stderr: '',
          exitCode: 0,
        }),
      },
      permissions: {
        readOnly: false,
        maxFileSize: 1024 * 1024,
        deniedTools: [],
        allowedTools: [],
        deniedPaths: ['.git', 'node_modules'],
        allowedPaths: [],
      },
      workingDirectory: testDir,
    };
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch  {
      // Ignore cleanup errors
    }
  });

  describe('File Operations', () => {
    it('should read a file', async () => {
      // Create test file
      const testFile = 'test.txt';
      const testContent = 'Hello, World!';
      await fs.writeFile(path.join(testDir, testFile), testContent);

      // Read file
      const content = await toolService.readFile(context, testFile);
      expect(content).toBe(testContent);
    });

    it('should write a file', async () => {
      const testFile = 'output.txt';
      const testContent = 'Test content';

      // Write file
      await toolService.writeFile(context, testFile, testContent);

      // Verify file was written
      const content = await fs.readFile(path.join(testDir, testFile), 'utf-8');
      expect(content).toBe(testContent);
    });

    it('should delete a file', async () => {
      // Create test file
      const testFile = 'delete-me.txt';
      await fs.writeFile(path.join(testDir, testFile), 'temp');

      // Delete file
      await toolService.deleteFile(context, testFile);

      // Verify file was deleted
      const exists = await fs
        .access(path.join(testDir, testFile))
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(false);
    });

    it('should list files in a directory', async () => {
      // Create test files
      await fs.writeFile(path.join(testDir, 'file1.txt'), 'content1');
      await fs.writeFile(path.join(testDir, 'file2.txt'), 'content2');
      await fs.mkdir(path.join(testDir, 'subdir'));

      // List files
      const files = await toolService.listFiles(context, '.');

      expect(files).toHaveLength(3);
      expect(files.map((f) => f.name)).toContain('file1.txt');
      expect(files.map((f) => f.name)).toContain('file2.txt');
      expect(files.map((f) => f.name)).toContain('subdir');
    });

    it('should enforce file size limits', async () => {
      const testFile = 'large.txt';
      const largeContent = 'x'.repeat(2 * 1024 * 1024); // 2MB

      // Try to write large file
      await expect(toolService.writeFile(context, testFile, largeContent)).rejects.toThrow(
        'exceeds limit',
      );
    });

    it('should enforce path restrictions', async () => {
      // Try to read from denied path
      await expect(toolService.readFile(context, '.git/config')).rejects.toThrow('Access denied');

      // Try to write to denied path
      await expect(
        toolService.writeFile(context, 'node_modules/test.txt', 'content'),
      ).rejects.toThrow('Access denied');
    });
  });

  describe('Tool Execution', () => {
    it('should execute a tool by name', async () => {
      const result = await toolService.executeTool('readFile', { path: 'test.txt' }, context);

      expect(result.success).toBe(false); // File doesn't exist
      expect(result.error).toBeDefined();
    });

    it('should list available tools', async () => {
      const tools = await toolService.listTools();

      expect(tools.length).toBeGreaterThan(0);
      expect(tools.map((t) => t.name)).toContain('readFile');
      expect(tools.map((t) => t.name)).toContain('writeFile');
      expect(tools.map((t) => t.name)).toContain('listFiles');
    });

    it('should get a specific tool', async () => {
      const tool = await toolService.getTool('readFile');

      expect(tool).toBeDefined();
      expect(tool?.name).toBe('readFile');
      expect(tool?.category).toBe('file');
    });

    it('should execute batch operations', async () => {
      // Create test file
      await fs.writeFile(path.join(testDir, 'batch.txt'), 'initial');

      const operations: ToolOperation[] = [
        {
          id: 'op1',
          toolId: 'readFile',
          tool: 'readFile',
          args: { path: 'batch.txt' },
          context: { ...context, workingDirectory: testDir },
          status: 'pending',
          startTime: new Date(),
        },
        {
          id: 'op2',
          toolId: 'writeFile',
          tool: 'writeFile',
          args: { path: 'batch2.txt', content: 'new content' },
          context: { ...context, workingDirectory: testDir },
          status: 'pending',
          startTime: new Date(),
        },
      ];

      const results = await toolService.executeBatch(operations, context);

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[0].data).toBe('initial');
      expect(results[1].success).toBe(true);
    });
  });

  describe('Permissions', () => {
    it('should deny tools in denylist', async () => {
      const restrictedContext: ToolContext = {
        ...context,
        permissions: {
          ...context.permissions,
          deniedTools: ['writeFile'],
        },
      };

      await expect(toolService.writeFile(restrictedContext, 'test.txt', 'content')).rejects.toThrow(
        'denied',
      );
    });

    it('should only allow tools in allowlist', async () => {
      const restrictedContext: ToolContext = {
        ...context,
        permissions: {
          ...context.permissions,
          allowedTools: ['readFile'],
        },
      };

      await expect(toolService.writeFile(restrictedContext, 'test.txt', 'content')).rejects.toThrow(
        'not allowed',
      );
    });

    it('should enforce read-only mode', async () => {
      const readOnlyContext = {
        ...context,
        permissions: {
          ...context.permissions,
          readOnly: true,
        },
      };

      await expect(toolService.writeFile(readOnlyContext, 'test.txt', 'content')).rejects.toThrow(
        'read-only mode',
      );
    });
  });
});
