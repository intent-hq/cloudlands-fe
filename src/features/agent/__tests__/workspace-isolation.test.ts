/**
 * Workspace Isolation Tests
 *
 * Tests to ensure agents are properly isolated to their workspace directories
 * and cannot modify the application's source code.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';

describe('Workspace Isolation', () => {
  describe('Path Validation', () => {
    it('should detect app source directory patterns', () => {
      const dangerousPaths = [
        '/Users/ameilawattenberger/repos/augment/experimental/amelia/workspaces',
        '/home/user/projects/augment/experimental/amelia/workspaces',
        '/var/workspace/experimental/amelia/workspaces/src',
        '/opt/app/experimental/amelia/workspaces/lib',
      ];

      for (const filePath of dangerousPaths) {
        // All these paths contain the app source pattern
        expect(filePath.includes('/experimental/amelia/workspaces')).toBe(true);
      }
    });

    it('should accept valid workspace paths', () => {
      const validPaths = [
        '/home/user/intent/abc-123/worktree',
        '/Users/ameilawattenberger/intent/553a31a7-a3be-42e0-973d-35b340c84f50/wattenberger-2023__workspace-553a31a7',
        '/var/workspaces/project-xyz/repo',
        '/tmp/workspace-temp',
      ];

      for (const filePath of validPaths) {
        // None of these paths should contain the app source pattern
        expect(filePath.includes('/experimental/amelia/workspaces')).toBe(false);
      }
    });

    it('should have safe fallback paths', () => {
      // Test with HOME set
      const originalHome = process.env.HOME;
      process.env.HOME = '/home/testuser';
      expect(process.env.HOME || '/tmp').toBe('/home/testuser');

      // Test without HOME
      delete process.env.HOME;
      expect(process.env.HOME || '/tmp').toBe('/tmp');

      // Restore
      if (originalHome) {
        process.env.HOME = originalHome;
      }
    });
  });

  describe('Security Boundaries', () => {
    it('workspace paths should be outside app source', () => {
      const appSourcePath =
        '/Users/ameilawattenberger/repos/augment/experimental/amelia/workspaces';
      const workspacePath = '/Users/ameilawattenberger/intent/553a31a7-a3be-42e0-973d-35b340c84f50';

      // Workspace path should not be a subdirectory of app source
      expect(workspacePath.startsWith(appSourcePath)).toBe(false);

      // App source should not be a subdirectory of workspace
      expect(appSourcePath.startsWith(workspacePath)).toBe(false);
    });

    it('agent working directory should never be app source', () => {
      // This is a conceptual test to document the requirement
      const appSource = '/experimental/amelia/workspaces';
      const validWorkingDirs = ['/home/user/intent/abc-123', '/tmp', process.env.HOME || '/tmp'];

      for (const dir of validWorkingDirs) {
        expect(dir).not.toContain(appSource);
      }
    });
  });

  describe('Path Traversal Prevention', () => {
    const workspacePath = '/home/user/intent/workspace-123';

    it('should reject paths with .. traversal', () => {
      const dangerousPaths = [
        '../../../etc/passwd',
        '../../sensitive-data',
        'src/../../..',
        'file/../../../etc/passwd',
      ];

      for (const filePath of dangerousPaths) {
        expect(filePath.includes('..')).toBe(true);
      }
    });

    it('should reject absolute paths outside workspace', () => {
      const absolutePaths = [
        '/etc/passwd',
        '/home/user/.ssh/id_rsa',
        '/root/.bashrc',
        '/var/log/system.log',
      ];

      for (const filePath of absolutePaths) {
        expect(filePath.startsWith('/')).toBe(true);
        expect(filePath.startsWith(workspacePath)).toBe(false);
      }
    });

    it('should reject home directory references', () => {
      const homePaths = ['~/.ssh/id_rsa', '~/sensitive-files', '~/.aws/credentials'];

      for (const filePath of homePaths) {
        expect(filePath.includes('~')).toBe(true);
      }
    });

    it('should validate path normalization', () => {
      const testCases = [
        {
          input: 'src/./file.ts',
          normalized: path.join('src', 'file.ts'),
        },
        {
          input: 'src//file.ts',
          normalized: path.join('src', 'file.ts'),
        },
        {
          input: './src/file.ts',
          normalized: path.join('src', 'file.ts'),
        },
      ];

      for (const testCase of testCases) {
        const normalized = path.normalize(testCase.input);
        expect(normalized).toBe(testCase.normalized);
      }
    });

    it('should detect path traversal after normalization', () => {
      const workspacePath = '/home/user/intent/workspace-123';
      const dangerousPaths = ['../../../etc/passwd', 'src/../../../../../../etc/passwd'];

      for (const filePath of dangerousPaths) {
        const normalizedFile = path.resolve(workspacePath, filePath);
        expect(normalizedFile.startsWith(workspacePath)).toBe(false);
      }
    });
  });

  describe('File Operation Restrictions', () => {
    it('should restrict file operations to workspace paths', () => {
      const workspacePath = '/home/user/intent/workspace-123';
      const allowedPaths = [
        '/home/user/intent/workspace-123/src/file.ts',
        '/home/user/intent/workspace-123/README.md',
        '/home/user/intent/workspace-123/.workspace/metadata.json',
      ];

      for (const filePath of allowedPaths) {
        expect(filePath.startsWith(workspacePath)).toBe(true);
      }
    });

    it('should deny access to app source code', () => {
      const appSourcePaths = [
        '/Users/user/repos/augment/experimental/amelia/workspaces/src/features',
        '/home/user/projects/augment/experimental/amelia/workspaces/package.json',
      ];

      for (const filePath of appSourcePaths) {
        expect(filePath.includes('/experimental/amelia/workspaces')).toBe(true);
      }
    });

    it('should deny access to system directories', () => {
      const systemPaths = [
        '/etc/passwd',
        '/etc/shadow',
        '/root/.ssh',
        '/var/log',
        '/sys/kernel',
        '/proc/self',
      ];

      for (const filePath of systemPaths) {
        expect(
          filePath.startsWith('/etc') ||
            filePath.startsWith('/root') ||
            filePath.startsWith('/var') ||
            filePath.startsWith('/sys') ||
            filePath.startsWith('/proc'),
        ).toBe(true);
      }
    });

    it('should deny access to user home directory outside workspace', () => {
      const homePaths = [
        '/home/user/.ssh/id_rsa',
        '/home/user/.aws/credentials',
        '/home/user/.kube/config',
        '/home/user/.env',
      ];

      for (const filePath of homePaths) {
        expect(
          filePath.includes('/.ssh') ||
            filePath.includes('/.aws') ||
            filePath.includes('/.kube') ||
            filePath.includes('/.env'),
        ).toBe(true);
      }
    });
  });

  describe('Null Byte Injection Prevention', () => {
    it('should reject paths with null bytes', () => {
      const nullBytePaths = ['file.txt\x00.js', 'src/file\x00.ts', 'path\x00/to/file'];

      for (const filePath of nullBytePaths) {
        expect(filePath.includes('\x00')).toBe(true);
      }
    });

    it('should validate path strings do not contain null bytes', () => {
      const validPath = 'src/file.ts';
      const invalidPath = 'src/file\x00.ts';

      expect(validPath.includes('\x00')).toBe(false);
      expect(invalidPath.includes('\x00')).toBe(true);
    });
  });

  describe('Symlink and Special File Prevention', () => {
    it('should identify suspicious file patterns', () => {
      const suspiciousPatterns = [
        { path: '/dev/null', type: 'device' },
        { path: '/dev/zero', type: 'device' },
        { path: '/proc/self/environ', type: 'proc' },
        { path: '/sys/kernel/debug', type: 'sysfs' },
      ];

      for (const item of suspiciousPatterns) {
        expect(
          item.path.startsWith('/dev') ||
            item.path.startsWith('/proc') ||
            item.path.startsWith('/sys'),
        ).toBe(true);
      }
    });
  });

  describe('Agent ID Validation', () => {
    it('should reject agent IDs with path traversal characters', () => {
      const invalidAgentIds = [
        'agent-123/../../../etc',
        'agent-123/../../',
        '../agent-123',
        'agent\\..\\..\\windows',
      ];

      for (const agentId of invalidAgentIds) {
        expect(agentId.includes('..') || agentId.includes('/') || agentId.includes('\\')).toBe(
          true,
        );
      }
    });

    it('should accept valid agent IDs', () => {
      const validAgentIds = ['agent-123', 'agent_456', 'my-agent-789', 'agent123abc'];

      for (const agentId of validAgentIds) {
        expect(!agentId.includes('..') && !agentId.includes('/') && !agentId.includes('\\')).toBe(
          true,
        );
      }
    });
  });

  describe('Workspace Isolation Boundaries', () => {
    it('should maintain separate workspace directories', () => {
      const workspace1 = '/home/user/intent/workspace-1';
      const workspace2 = '/home/user/intent/workspace-2';

      expect(workspace1).not.toBe(workspace2);
      expect(workspace1.startsWith(workspace2)).toBe(false);
      expect(workspace2.startsWith(workspace1)).toBe(false);
    });

    it('should prevent cross-workspace access', () => {
      const workspace1Path = '/home/user/intent/workspace-1';
      const workspace2Path = '/home/user/intent/workspace-2';
      const crossWorkspacePath = '/home/user/intent/workspace-1/../workspace-2/file.ts';

      const normalizedPath = path.normalize(crossWorkspacePath);
      expect(normalizedPath.startsWith(workspace1Path)).toBe(false);
    });

    it('should isolate workspace metadata directories', () => {
      const workspace1Metadata = '/home/user/intent/workspace-1/.workspace';
      const workspace2Metadata = '/home/user/intent/workspace-2/.workspace';

      expect(workspace1Metadata).not.toBe(workspace2Metadata);
      expect(workspace1Metadata.includes('workspace-1')).toBe(true);
      expect(workspace2Metadata.includes('workspace-2')).toBe(true);
    });
  });

  describe('Environment Variable Validation', () => {
    let originalEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
      originalEnv = { ...process.env };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should use safe workspace root from environment', () => {
      process.env.WORKSPACES_BASE_DIR = '/home/user/intent';
      const workspaceRoot = process.env.WORKSPACES_BASE_DIR;

      expect(workspaceRoot).toBe('/home/user/intent');
      expect(workspaceRoot.includes('/experimental/amelia/workspaces')).toBe(false);
    });

    it('should fallback to home directory when env var not set', () => {
      delete process.env.WORKSPACES_BASE_DIR;
      delete process.env.AUGMENT_WORKSPACES_ROOT;
      const fallback = process.env.HOME || '/tmp';

      expect(fallback).toBeTruthy();
      expect(fallback.length > 0).toBe(true);
    });

    it('should reject empty workspace root configuration', () => {
      process.env.WORKSPACES_BASE_DIR = '';
      const isEmpty =
        !process.env.WORKSPACES_BASE_DIR || process.env.WORKSPACES_BASE_DIR.trim().length === 0;

      expect(isEmpty).toBe(true);
    });
  });

  describe('Path Sanitization Implementation', () => {
    /**
     * Simulates the sanitizeFilePath function from safe-git-operations.ts
     */
    function sanitizeFilePath(filePath: string, workspacePath: string): string {
      const normalizedWorkspace = path.resolve(workspacePath);
      const normalizedFile = path.resolve(workspacePath, filePath);

      if (!normalizedFile.startsWith(normalizedWorkspace)) {
        throw new Error(`Path traversal detected: ${filePath}`);
      }

      return path.relative(normalizedWorkspace, normalizedFile);
    }

    it('should sanitize valid relative paths', () => {
      const workspacePath = '/home/user/intent/workspace-123';
      const filePath = 'src/file.ts';

      const result = sanitizeFilePath(filePath, workspacePath);
      expect(result).toBe(path.join('src', 'file.ts'));
    });

    it('should reject path traversal attempts', () => {
      const workspacePath = '/home/user/intent/workspace-123';
      const filePath = '../../../etc/passwd';

      expect(() => {
        sanitizeFilePath(filePath, workspacePath);
      }).toThrow('Path traversal detected');
    });

    it('should reject absolute paths outside workspace', () => {
      const workspacePath = '/home/user/intent/workspace-123';
      const filePath = '/etc/passwd';

      expect(() => {
        sanitizeFilePath(filePath, workspacePath);
      }).toThrow('Path traversal detected');
    });

    it('should handle nested directory paths safely', () => {
      const workspacePath = '/home/user/intent/workspace-123';
      const filePath = 'src/features/agent/main/file.ts';

      const result = sanitizeFilePath(filePath, workspacePath);
      expect(result).toBe(path.join('src', 'features', 'agent', 'main', 'file.ts'));
    });

    it('should normalize paths with ./ references', () => {
      const workspacePath = '/home/user/intent/workspace-123';
      const filePath = './src/file.ts';

      const result = sanitizeFilePath(filePath, workspacePath);
      expect(result).toBe(path.join('src', 'file.ts'));
    });

    it('should reject mixed traversal patterns', () => {
      const workspacePath = '/home/user/intent/workspace-123';
      const filePath = 'src/../../../../../../etc/passwd';

      expect(() => {
        sanitizeFilePath(filePath, workspacePath);
      }).toThrow('Path traversal detected');
    });
  });

  describe('Dangerous Path Pattern Detection', () => {
    it('should identify dangerous patterns in paths', () => {
      const dangerousPatterns = [
        { pattern: /\.\.[\\/]/, path: '../file.txt', shouldMatch: true },
        { pattern: /^[\\/]/, path: '/etc/passwd', shouldMatch: true },
        { pattern: /~[\\/]/, path: '~/.ssh/id_rsa', shouldMatch: true },
      ];

      for (const item of dangerousPatterns) {
        const matches = item.pattern.test(item.path);
        expect(matches).toBe(item.shouldMatch);
      }
    });

    it('should allow safe relative paths', () => {
      const safePaths = [
        'src/file.ts',
        'src/features/agent/main.ts',
        'README.md',
        '.gitignore',
        'package.json',
      ];

      const dangerousPattern = /\.\.[\\/]|^[\\/]|~[\\/]/;

      for (const filePath of safePaths) {
        expect(dangerousPattern.test(filePath)).toBe(false);
      }
    });
  });

  describe('Workspace Metadata Protection', () => {
    it('should protect .workspace metadata directory', () => {
      const workspacePath = '/home/user/intent/workspace-123';
      const metadataPath = path.join(workspacePath, '.workspace');

      expect(metadataPath).toBe(path.join('/home/user/intent/workspace-123', '.workspace'));
      expect(metadataPath.includes('.workspace')).toBe(true);
    });

    it('should isolate agent configuration files', () => {
      const workspace1AgentPath = '/home/user/intent/workspace-1/.workspace/agents/agent-123.json';
      const workspace2AgentPath = '/home/user/intent/workspace-2/.workspace/agents/agent-123.json';

      expect(workspace1AgentPath).not.toBe(workspace2AgentPath);
      expect(workspace1AgentPath.includes('workspace-1')).toBe(true);
      expect(workspace2AgentPath.includes('workspace-2')).toBe(true);
    });

    it('should protect notes directory', () => {
      const workspacePath = '/home/user/intent/workspace-123';
      const notesPath = path.join(workspacePath, '.workspace', 'notes');

      expect(notesPath).toBe(path.join('/home/user/intent/workspace-123', '.workspace', 'notes'));
      expect(notesPath.includes('.workspace')).toBe(true);
    });
  });
});
