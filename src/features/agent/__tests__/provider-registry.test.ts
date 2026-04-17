import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProviderRegistry } from '../main/provider-registry';
import type { BaseAgentProvider, AgentConfig } from '../main/agent-providers/base-provider';
import { ACP_PROVIDERS } from '$shared/config/provider-config';
import { featureCodesService } from '../../feature-codes/main/feature-codes.service';

// Mock the ACP provider module - path is relative to the file being mocked (provider-registry.ts in main/)
vi.mock('../main/agent-providers/acp-provider.js', () => {
  class MockACPProvider {
    type = 'acp';
    config: any;

    constructor(config: any) {
      this.config = config;
    }

    async initialize() {
      // Mock implementation
      return Promise.resolve();
    }
  }

  return { ACPProvider: MockACPProvider };
});

describe('ProviderRegistry', () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    registry = new ProviderRegistry();
  });

  describe('register', () => {
    it('should register a provider factory', () => {
      const mockProvider = {} as BaseAgentProvider;
      const factory = vi.fn().mockReturnValue(mockProvider);

      registry.register('test-provider', factory);

      expect(registry.has('test-provider')).toBe(true);
    });

    it('should handle case-insensitive provider IDs', () => {
      const mockProvider = {} as BaseAgentProvider;
      const factory = vi.fn().mockReturnValue(mockProvider);

      registry.register('Test-Provider', factory);

      expect(registry.has('test-provider')).toBe(true);
      expect(registry.has('TEST-PROVIDER')).toBe(true);
      expect(registry.has('Test-Provider')).toBe(true);
    });
  });

  describe('create', () => {
    it('should create a provider instance using the factory', async () => {
      const mockProvider = { id: 'test' } as unknown as BaseAgentProvider;
      const factory = vi.fn().mockReturnValue(mockProvider);
      const config: AgentConfig = {
        provider: 'test-provider',
        model: 'test-model',
      };

      registry.register('test-provider', factory);
      const provider = await registry.create('test-provider', config);

      expect(factory).toHaveBeenCalledTimes(1);
      expect(factory).toHaveBeenCalledWith(config, true);
      expect(provider).toBe(mockProvider);
    });

    it('should fall back to ACP for unknown provider', async () => {
      const config: AgentConfig = {
        provider: 'unknown',
        model: 'test-model',
      };

      const provider = await registry.create('unknown', config);
      expect(provider).toBeDefined();
      expect(provider).toBeInstanceOf(Object);
    });

    it('should handle case-insensitive provider creation', async () => {
      const mockProvider = { id: 'test' } as unknown as BaseAgentProvider;
      const factory = vi.fn().mockReturnValue(mockProvider);
      const config: AgentConfig = {
        provider: 'test-provider',
        model: 'test-model',
      };

      registry.register('test-provider', factory);
      const provider = await registry.create('TEST-PROVIDER', config);

      expect(provider).toBe(mockProvider);
    });
  });

  describe('list', () => {
    it('should list all registered provider IDs', () => {
      const factory1 = vi.fn();
      const factory2 = vi.fn();
      const factory3 = vi.fn();

      registry.register('provider1', factory1);
      registry.register('provider2', factory2);
      registry.register('provider3', factory3);

      const providers = registry.list();

      expect(providers).toHaveLength(3);
      expect(providers).toContain('provider1');
      expect(providers).toContain('provider2');
      expect(providers).toContain('provider3');
    });

    it('should return empty array when no providers registered', () => {
      expect(registry.list()).toEqual([]);
    });
  });

  describe('createDefault', () => {
    // Activate the cortex feature code so createDefault registers everything
    beforeAll(() => {
      featureCodesService.activateCode('cortex-enable');
    });
    afterAll(() => {
      featureCodesService.clearAllCodes();
    });

    it('should create a registry with ACP providers', () => {
      const defaultRegistry = ProviderRegistry.createDefault();

      // All known ACP providers are supported (skip those gated by env vars)
      const activeProviders = Object.entries(ACP_PROVIDERS).filter(
        ([, config]) => !config.requiresEnvVar || process.env[config.requiresEnvVar],
      );
      for (const [providerId] of activeProviders) {
        expect(defaultRegistry.has(providerId)).toBe(true);
      }

      // Default aliases are supported
      expect(defaultRegistry.has('acp')).toBe(true);
      expect(defaultRegistry.has('augment')).toBe(true);
      expect(defaultRegistry.has('default')).toBe(true);

      // Should include all active providers plus aliases
      expect(defaultRegistry.list()).toHaveLength(activeProviders.length + 3);
    });

    it('should use ACP for any unknown provider', async () => {
      const defaultRegistry = ProviderRegistry.createDefault();

      const config: AgentConfig = {
        provider: 'unknown-provider',
        model: 'some-model',
      };

      // Should fall back to ACP instead of throwing
      const provider = await defaultRegistry.create('unknown-provider', config);
      expect(provider).toBeDefined();
      expect(provider).toBeInstanceOf(Object);
    });

    it('should use ACP for Augment provider', async () => {
      const defaultRegistry = ProviderRegistry.createDefault();

      const config: AgentConfig = {
        provider: 'augment',
        model: 'test-model',
        workspaceId: 'workspace-123',
      };

      const provider = await defaultRegistry.create('augment', config);
      expect(provider).toBeDefined();
      expect(provider).toBeInstanceOf(Object);
    });

    it('should list all providers and aliases', () => {
      const defaultRegistry = ProviderRegistry.createDefault();
      const providers = defaultRegistry.list();

      // Includes provider IDs and default aliases (skip env-gated providers)
      const activeProviders = Object.entries(ACP_PROVIDERS).filter(
        ([, config]) => !config.requiresEnvVar || process.env[config.requiresEnvVar],
      );
      for (const [providerId] of activeProviders) {
        expect(providers).toContain(providerId);
      }
      expect(providers).toContain('acp');
      expect(providers).toContain('augment');
      expect(providers).toContain('default');
    });
  });
});
