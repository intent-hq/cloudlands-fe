/**
 * Workspace Factory Tests
 *
 * Tests for workspace factory functions.
 */

import {
  describe,
  it,
  expect,
} from 'vitest';
import {
  createTestWorkspaceId,
  createTestAgentId,
  createTestSessionId,
  createTestMessageId,
  createTestThreadId,
  createTestWorkspaceName,
  createTestFilePath,
  createTestDirectoryPath,
} from '../workspace.factory';

describe('Workspace Factory', () => {
  describe('ID factories', () => {
    it('should create workspace IDs', () => {
      const id = createTestWorkspaceId();

      expect(id).toBeDefined();
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });

    it('should create agent IDs', () => {
      const id = createTestAgentId();

      expect(id).toBeDefined();
      expect(typeof id).toBe('string');
    });

    it('should create session IDs with correct prefix', () => {
      const id = createTestSessionId();

      expect(id).toMatch(/^sess_/);
    });

    it('should create message IDs with correct prefix', () => {
      const id = createTestMessageId();

      expect(id).toMatch(/^msg_/);
    });

    it('should create thread IDs with correct prefix', () => {
      const id = createTestThreadId();

      expect(id).toMatch(/^thread_/);
    });

    it('should generate unique IDs', () => {
      const id1 = createTestWorkspaceId();
      const id2 = createTestWorkspaceId();

      expect(id1).not.toBe(id2);
    });
  });

  describe('Name factories', () => {
    it('should create workspace names', () => {
      const name = createTestWorkspaceName();

      expect(name).toBeDefined();
      expect(name).toContain('Workspace');
      expect(name.length).toBeGreaterThan(0);
    });
  });

  describe('Path factories', () => {
    it('should create file paths', () => {
      const path = createTestFilePath();

      expect(path).toBeDefined();
      expect(path).toMatch(/^\//);
      expect(path.length).toBeGreaterThan(1);
    });

    it('should create directory paths', () => {
      const path = createTestDirectoryPath();

      expect(path).toBeDefined();
      expect(path).toMatch(/^\//);
    });

    it('should generate different paths', () => {
      const path1 = createTestFilePath();
      const path2 = createTestFilePath();

      expect(path1).not.toBe(path2);
    });
  });
});
