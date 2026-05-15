/**
 * Configuration Tests
 *
 * Tests for configuration types, defaults, and validation.
 */

import {
  describe,
  it,
  expect,
} from 'vitest';
import {
  DEFAULT_AGENT_CONFIG,
  DEFAULT_STREAM_CONFIG,
  DEFAULT_PERSISTENCE_CONFIG,
  DEFAULT_APP_CONFIG,
  CONFIG_CONSTANTS,
} from '../defaults';
import {
  validateAgentConfig,
  validateStreamConfig,
  validatePersistenceConfig,
  validateAppConfig,
} from '../schemas';
import type { AgentConfig, StreamConfig, PersistenceConfig, AppConfig } from '../types';

describe('Configuration Defaults', () => {
  it('should have valid default agent config', () => {
    expect(DEFAULT_AGENT_CONFIG.name).toBe('Assistant');
    expect(DEFAULT_AGENT_CONFIG.model).toBe('opus4.5'); // Short model ID format
    expect(DEFAULT_AGENT_CONFIG.temperature).toBe(0.7);
    expect(DEFAULT_AGENT_CONFIG.maxTokens).toBe(4096);
  });

  it('should have valid default streaming config', () => {
    expect(DEFAULT_STREAM_CONFIG.backpressureThreshold).toBe(100);
    expect(DEFAULT_STREAM_CONFIG.chunkTimeout).toBe(5000);
    expect(DEFAULT_STREAM_CONFIG.maxQueueSize).toBe(1000);
  });

  it('should have valid default persistence config', () => {
    expect(DEFAULT_PERSISTENCE_CONFIG.basePath).toBe('.workspace/agents');
    expect(DEFAULT_PERSISTENCE_CONFIG.backupEnabled).toBe(true);
    expect(DEFAULT_PERSISTENCE_CONFIG.maxBackups).toBe(5);
  });

  it('should have valid default app config', () => {
    expect(DEFAULT_APP_CONFIG.agent).toBeDefined();
    expect(DEFAULT_APP_CONFIG.streaming).toBeDefined();
    expect(DEFAULT_APP_CONFIG.persistence).toBeDefined();
  });

  it('should have reasonable config constants', () => {
    expect(CONFIG_CONSTANTS.AGENT_RESPONSE_TIMEOUT).toBe(30000);
    expect(CONFIG_CONSTANTS.MAX_MESSAGE_LENGTH).toBe(500000);
    expect(CONFIG_CONSTANTS.MAX_AGENTS_PER_WORKSPACE).toBe(50);
  });
});

describe('Agent Config Validation', () => {
  it('should validate valid agent config', () => {
    const config: AgentConfig = {
      name: 'Test Agent',
      model: 'gpt-4',
      temperature: 0.5,
    };
    const result = validateAgentConfig(config);
    expect(result.valid).toBe(true);
    expect(result.errors).toBeUndefined();
  });

  it('should reject agent config with empty name', () => {
    const config = { name: '', model: 'gpt-4' };
    const result = validateAgentConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
  });

  it('should reject agent config with invalid temperature', () => {
    const config = { name: 'Test', temperature: 3 };
    const result = validateAgentConfig(config);
    expect(result.valid).toBe(false);
  });
});

describe('Stream Config Validation', () => {
  it('should validate valid stream config', () => {
    const config: StreamConfig = {
      sessionId: 'session-123',
      agentId: 'agent-456',
      backpressureThreshold: 100,
    };
    const result = validateStreamConfig(config);
    expect(result.valid).toBe(true);
  });

  it('should reject stream config without sessionId', () => {
    const config = { agentId: 'agent-456' };
    const result = validateStreamConfig(config);
    expect(result.valid).toBe(false);
  });
});

describe('Persistence Config Validation', () => {
  it('should validate valid persistence config', () => {
    const config: PersistenceConfig = {
      basePath: '/data/agents',
      backupEnabled: true,
      maxBackups: 5,
    };
    const result = validatePersistenceConfig(config);
    expect(result.valid).toBe(true);
  });

  it('should reject persistence config without basePath', () => {
    const config = { backupEnabled: true };
    const result = validatePersistenceConfig(config);
    expect(result.valid).toBe(false);
  });
});

describe('App Config Validation', () => {
  it('should validate valid app config', () => {
    const config: AppConfig = DEFAULT_APP_CONFIG;
    const result = validateAppConfig(config);
    expect(result.valid).toBe(true);
  });

  it('should validate app config with custom values', () => {
    const config: AppConfig = {
      agent: { name: 'Custom Agent', model: 'gpt-4' },
      streaming: {
        sessionId: 'session-123',
        agentId: 'agent-456',
      },
      persistence: { basePath: '/custom/path' },
    };
    const result = validateAppConfig(config);
    expect(result.valid).toBe(true);
  });

  it('should reject app config with missing agent', () => {
    const config = {
      streaming: {
        sessionId: 'session-123',
        agentId: 'agent-456',
      },
      persistence: { basePath: '/custom/path' },
    };
    const result = validateAppConfig(config);
    expect(result.valid).toBe(false);
  });

  it('should reject app config with missing streaming', () => {
    const config = {
      agent: { name: 'Test Agent' },
      persistence: { basePath: '/custom/path' },
    };
    const result = validateAppConfig(config);
    expect(result.valid).toBe(false);
  });

  it('should reject app config with missing persistence', () => {
    const config = {
      agent: { name: 'Test Agent' },
      streaming: {
        sessionId: 'session-123',
        agentId: 'agent-456',
      },
    };
    const result = validateAppConfig(config);
    expect(result.valid).toBe(false);
  });
});
