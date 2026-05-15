import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  getBranchNameValidationError,
  isValidProjectName,
  isValidWorkspaceIdFormat,
  sanitizePath,
  validateBranchName,
  validateProjectName,
  validateRepositoryPath,
  validateWorkspaceId,
} from '../utils/workspace-validation';

describe('main workspace-validation', () => {
  it('preserves workspace id validation contracts', () => {
    expect(validateWorkspaceId('valid-id_123')).toEqual([]);
    expect(validateWorkspaceId('bad id')).toEqual(['Workspace ID contains invalid characters']);
    expect(isValidWorkspaceIdFormat('valid-id_123')).toBe(true);
    expect(isValidWorkspaceIdFormat('bad id')).toBe(false);
  });

  it('preserves branch validation helpers', () => {
    expect(validateBranchName('feature/test-branch')).toEqual([]);
    expect(getBranchNameValidationError('bad branch')).toBe('Branch name cannot contain spaces');
  });

  it('sanitizes unsafe path characters', () => {
    expect(sanitizePath('..\\repo/<unsafe>?name')).toBe('/repo/unsafename');
  });

  describe('validateRepositoryPath', () => {
    it('rejects paths with directory traversal', () => {
      const errors = validateRepositoryPath('/home/../etc/passwd');
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('..');
    });

    it('rejects paths with null bytes', () => {
      const errors = validateRepositoryPath('/home/user\0/project');
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('null');
    });

    it('accepts valid absolute paths', () => {
      expect(validateRepositoryPath('/home/user/project')).toEqual([]);
    });

    it('rejects empty path', () => {
      expect(validateRepositoryPath('')).toEqual(['Repository path is required']);
    });
  });

  describe('validateProjectName', () => {
    it('accepts valid project names', () => {
      expect(validateProjectName('my-project')).toEqual([]);
      expect(validateProjectName('my_project_123')).toEqual([]);
      expect(validateProjectName('CoolApp')).toEqual([]);
      expect(validateProjectName('project.name')).toEqual([]);
    });

    it('rejects names with forward slashes', () => {
      const errors = validateProjectName('path/traversal');
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('path separators');
    });

    it('rejects names with backslashes', () => {
      const errors = validateProjectName('path\\traversal');
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('path separators');
    });

    it('rejects ".." as project name', () => {
      const errors = validateProjectName('..');
      expect(errors.length).toBeGreaterThan(0);
    });

    it('rejects "." as project name', () => {
      const errors = validateProjectName('.');
      expect(errors.length).toBeGreaterThan(0);
    });

    it('rejects names with null bytes', () => {
      const errors = validateProjectName('project\0name');
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('null');
    });

    it('rejects names with unsafe path characters', () => {
      expect(validateProjectName('project<name')).not.toEqual([]);
      expect(validateProjectName('project>name')).not.toEqual([]);
      expect(validateProjectName('project:name')).not.toEqual([]);
      expect(validateProjectName('project"name')).not.toEqual([]);
      expect(validateProjectName('project|name')).not.toEqual([]);
      expect(validateProjectName('project?name')).not.toEqual([]);
      expect(validateProjectName('project*name')).not.toEqual([]);
    });

    it('rejects names that are only dots', () => {
      expect(validateProjectName('...')).not.toEqual([]);
      expect(validateProjectName('....')).not.toEqual([]);
    });

    it('rejects empty or whitespace-only names', () => {
      expect(validateProjectName('')).not.toEqual([]);
      expect(validateProjectName('   ')).not.toEqual([]);
    });

    it('rejects names longer than 255 characters', () => {
      const longName = 'a'.repeat(256);
      expect(validateProjectName(longName)).not.toEqual([]);
    });

    it('accepts names exactly 255 characters', () => {
      const exactName = 'a'.repeat(255);
      expect(validateProjectName(exactName)).toEqual([]);
    });
  });

  describe('isValidProjectName', () => {
    it('returns true for valid names', () => {
      expect(isValidProjectName('my-project')).toBe(true);
    });

    it('returns false for invalid names', () => {
      expect(isValidProjectName('../escape')).toBe(false);
      expect(isValidProjectName('bad/name')).toBe(false);
      expect(isValidProjectName('..')).toBe(false);
    });
  });
});
