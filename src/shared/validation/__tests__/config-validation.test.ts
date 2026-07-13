/**
 * Configuration Validation Tests
 */

import {
  describe,
  it,
  expect,
} from 'vitest';
import {
  validateAgentConfig,
  validateStreamConfig,
  validatePersistenceConfig,
  hasRequiredFields,
  validateObjectTypes,
} from '../config-validation';

describe('Agent Configuration Validation', () => {
  it('should accept valid agent config', () => {
    const config = {
      name: 'Test Agent',
      model: 'claude-sonnet-4-5',
      temperature: 0.7,
      maxTokens: 4096,
    };
    const result = validateAgentConfig(config);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should reject config without name', () => {
    const config = { model: 'claude-sonnet-4-5' };
    const result = validateAgentConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('name'))).toBe(true);
  });

  it('should reject config with invalid temperature', () => {
    const config = {
      name: 'Test Agent',
      temperature: 5,
    };
    const result = validateAgentConfig(config);
    expect(result.warnings.some((w) => w.includes('Temperature'))).toBe(true);
  });

  it('should reject config with negative maxTokens', () => {
    const config = {
      name: 'Test Agent',
      maxTokens: -100,
    };
    const result = validateAgentConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Max tokens'))).toBe(true);
  });

  it('should reject non-object config', () => {
    const result = validateAgentConfig(null);
    expect(result.valid).toBe(false);
  });
});

describe('Stream Configuration Validation', () => {
  it('should accept valid stream config', () => {
    const config = {
      sessionId: 'session-123',
      agentId: 'agent-456',
      backpressureThreshold: 100,
      chunkTimeout: 1000,
    };
    const result = validateStreamConfig(config);
    expect(result.valid).toBe(true);
  });

  it('should reject config without sessionId', () => {
    const config = { agentId: 'agent-456' };
    const result = validateStreamConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Session ID'))).toBe(true);
  });

  it('should reject config without agentId', () => {
    const config = { sessionId: 'session-123' };
    const result = validateStreamConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Agent ID'))).toBe(true);
  });

  it('should reject invalid backpressureThreshold', () => {
    const config = {
      sessionId: 'session-123',
      agentId: 'agent-456',
      backpressureThreshold: -10,
    };
    const result = validateStreamConfig(config);
    expect(result.valid).toBe(false);
  });
});

describe('Persistence Configuration Validation', () => {
  it('should accept valid persistence config', () => {
    const config = {
      basePath: '/home/user/intent',
      backupEnabled: true,
      compressionEnabled: false,
      maxBackups: 5,
      autoSaveInterval: 60000,
    };
    const result = validatePersistenceConfig(config);
    expect(result.valid).toBe(true);
  });

  it('should reject config without basePath', () => {
    const config = { backupEnabled: true };
    const result = validatePersistenceConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Base path'))).toBe(true);
  });

  it('should reject invalid backupEnabled', () => {
    const config = {
      basePath: '/path',
      backupEnabled: 'yes',
    };
    const result = validatePersistenceConfig(config);
    expect(result.valid).toBe(false);
  });

  it('should reject negative maxBackups', () => {
    const config = {
      basePath: '/path',
      maxBackups: -1,
    };
    const result = validatePersistenceConfig(config);
    expect(result.valid).toBe(false);
  });
});

describe('Data Integrity Checks', () => {
  describe('hasRequiredFields', () => {
    it('should return true when all required fields present', () => {
      const obj = { name: 'Test', id: '123', status: 'active' };
      expect(hasRequiredFields(obj, ['name', 'id'])).toBe(true);
    });

    it('should return false when required field missing', () => {
      const obj = { name: 'Test' };
      expect(hasRequiredFields(obj, ['name', 'id'])).toBe(false);
    });

    it('should return false for null/undefined values', () => {
      const obj = { name: 'Test', id: null };
      expect(hasRequiredFields(obj, ['name', 'id'])).toBe(false);
    });

    it('should return false for non-object input', () => {
      expect(hasRequiredFields(null, ['name'])).toBe(false);
    });
  });

  describe('validateObjectTypes', () => {
    it('should validate correct types', () => {
      const obj = { name: 'Test', count: 42, active: true };
      const schema = { name: 'string', count: 'number', active: 'boolean' };
      const result = validateObjectTypes(obj, schema);
      expect(result.valid).toBe(true);
    });

    it('should detect type mismatches', () => {
      const obj = { name: 'Test', count: '42' };
      const schema = { name: 'string', count: 'number' };
      const result = validateObjectTypes(obj, schema);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should handle non-object input', () => {
      const result = validateObjectTypes(null, {});
      expect(result.valid).toBe(false);
    });
  });
});
