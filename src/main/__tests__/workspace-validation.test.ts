import { describe, expect, it } from 'vitest';

import {
  getBranchNameValidationError,
  isValidWorkspaceIdFormat,
  sanitizePath,
  validateBranchName,
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
});
