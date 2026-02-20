/**
 * Test Persistence Setup Helper
 *
 * Configures persistence services to use test directories
 * instead of the user's home directory.
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { vi } from 'vitest';
import type { AgentId, WorkspaceId } from '../../src/shared/types/branded-ids';

export interface TestPersistenceConfig {
  baseDir?: string;
  workspaceId?: string;
  cleanup?: boolean;
}

/**
 * Setup test persistence environment
 */
export async function setupTestPersistence(config: TestPersistenceConfig = {}) {
  const baseDir = config.baseDir || path.join(tmpdir(), 'augment-test', Date.now().toString());
  const workspaceId = config.workspaceId || `test-workspace-${  Date.now()}`;

  // Set environment variable to override the default workspace root
  process.env.WORKSPACES_BASE_DIR = baseDir;
  process.env.AUGMENT_WORKSPACES_ROOT = baseDir;

  // Create test directories
  const workspacePath = path.join(baseDir, workspaceId);
  const metadataPath = path.join(workspacePath, '.workspace');
  const agentsPath = path.join(metadataPath, 'agents');

  await fs.mkdir(agentsPath, { recursive: true });

  return {
    baseDir,
    workspaceId,
    workspacePath,
    metadataPath,
    agentsPath,

    // Helper to get agent file path
    getAgentPath: (agentId: AgentId | string) => path.join(agentsPath, `${agentId}.json`),

    // Helper to clean up test directories
    cleanup: async () => {
      if (config.cleanup !== false) {
        try {
          await fs.rm(baseDir, { recursive: true, force: true });
        } catch (error) {
          console.warn('Failed to cleanup test directory:', error);
        }
      }
    },

    // Reset environment variables
    reset: () => {
      delete process.env.WORKSPACES_BASE_DIR;
      delete process.env.AUGMENT_WORKSPACES_ROOT;
    },
  };
}

/**
 * Mock file system operations for testing
 */
export function mockFileSystem() {
  const mockFs = {
    files: new Map<string, string>(),

    readFile: vi.fn(async (path: string) => {
      if (mockFs.files.has(path)) {
        return mockFs.files.get(path)!;
      }
      throw new Error(`ENOENT: no such file or directory, open '${path}'`);
    }),

    writeFile: vi.fn(async (path: string, data: string) => {
      mockFs.files.set(path, data);
    }),

    access: vi.fn(async (path: string) => {
      if (!mockFs.files.has(path)) {
        throw new Error(`ENOENT: no such file or directory, access '${path}'`);
      }
    }),

    mkdir: vi.fn(async () => {}),

    readdir: vi.fn(async (dir: string) => {
      const files: string[] = [];
      for (const [filePath] of mockFs.files) {
        if (filePath.startsWith(`${dir  }/`)) {
          const relativePath = filePath.slice(dir.length + 1);
          const fileName = relativePath.split('/')[0];
          if (fileName && !files.includes(fileName)) {
            files.push(fileName);
          }
        }
      }
      return files;
    }),

    rename: vi.fn(async (oldPath: string, newPath: string) => {
      if (mockFs.files.has(oldPath)) {
        const data = mockFs.files.get(oldPath)!;
        mockFs.files.delete(oldPath);
        mockFs.files.set(newPath, data);
      }
    }),

    rm: vi.fn(async (path: string) => {
      mockFs.files.delete(path);
    }),

    stat: vi.fn(async (path: string) => {
      if (mockFs.files.has(path)) {
        return {
          size: mockFs.files.get(path)!.length,
          isFile: () => true,
          isDirectory: () => false,
        };
      }
      throw new Error(`ENOENT: no such file or directory, stat '${path}'`);
    }),

    // Helper methods for testing
    setFile: (path: string, content: string) => {
      mockFs.files.set(path, content);
    },

    getFile: (path: string) => mockFs.files.get(path),

    hasFile: (path: string) => mockFs.files.has(path),

    clear: () => {
      mockFs.files.clear();
    },

    getAllFiles: () => Array.from(mockFs.files.entries()),
  };

  return mockFs;
}
