/**
 * Unit tests for EndUserRulesManager
 *
 * Tests the CRUD interface for user-defined rules stored in electron-store.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  EndUserRulesManager,
  type EndUserRulesConfig,
  type RuleTypeConfig,
} from '../user-rules.service';
import type { ConfigManager } from '../../../shared/services/config-manager';

// Mock ConfigManager
const createMockConfigManager = () => {
  const store = new Map<string, any>();

  return {
    get: vi.fn((key: string) => store.get(key)),
    set: vi.fn((key: string, value: any) => store.set(key, value)),
    has: vi.fn((key: string) => store.has(key)),
    delete: vi.fn((key: string) => store.delete(key)),
    clear: vi.fn(() => store.clear()),
    initialize: vi.fn().mockResolvedValue(undefined),
  } as unknown as ConfigManager;
};

// Mock Logger
vi.mock('../../../shared/logger', () => ({
  Logger: class MockLogger {
    constructor(name: string) {}
    info = vi.fn();
    debug = vi.fn();
    warn = vi.fn();
    error = vi.fn();
  },
}));

describe('EndUserRulesManager', () => {
  let manager: EndUserRulesManager;
  let mockConfigManager: ConfigManager;

  beforeEach(async () => {
    // Reset singleton
    (EndUserRulesManager as any).instance = undefined;

    // Create mock config manager
    mockConfigManager = createMockConfigManager();

    // Create new instance
    manager = EndUserRulesManager.getInstance();
    await manager.initialize(mockConfigManager);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Per-Type Storage', () => {
    it('should store rules by type', () => {
      manager.updateRulesByType('debug', 'Always log everything');

      expect(mockConfigManager.set).toHaveBeenCalledWith(
        'endUserRules',
        expect.objectContaining({
          debug: expect.objectContaining({
            content: 'Always log everything',
            enabled: true,
          }),
        }),
      );
    });

    it('should retrieve rules by type', () => {
      // Setup
      const mockRules: EndUserRulesConfig = {
        debug: {
          enabled: true,
          content: 'Debug rules content',
          updatedAt: new Date().toISOString(),
        },
      };
      vi.mocked(mockConfigManager.get).mockReturnValue(mockRules);

      // Test
      const rules = manager.getRulesByType('debug');

      expect(rules).toEqual(mockRules.debug);
    });

    it('should return null for non-existent type', () => {
      vi.mocked(mockConfigManager.get).mockReturnValue({});

      const rules = manager.getRulesByType('nonexistent');

      expect(rules).toBeNull();
    });

    it('should support multiple rule types', () => {
      manager.updateRulesByType('debug', 'Debug rules');
      manager.updateRulesByType('workspace', 'Workspace rules');
      manager.updateRulesByType('task-loop', 'Task loop rules');

      const allRules = manager.getAllRules();

      expect(allRules).toHaveProperty('debug');
      expect(allRules).toHaveProperty('workspace');
      expect(allRules).toHaveProperty('task-loop');
    });
  });

  describe('Per-Type Enable/Disable', () => {
    it('should enable rules for specific type', () => {
      manager.setRulesEnabledByType('debug', true);

      expect(mockConfigManager.set).toHaveBeenCalledWith(
        'endUserRules',
        expect.objectContaining({
          debug: expect.objectContaining({
            enabled: true,
          }),
        }),
      );
    });

    it('should disable rules for specific type', () => {
      // Setup existing rules
      const mockRules: EndUserRulesConfig = {
        debug: {
          enabled: true,
          content: 'Debug rules',
          updatedAt: new Date().toISOString(),
        },
      };
      vi.mocked(mockConfigManager.get).mockReturnValue(mockRules);

      // Disable
      manager.setRulesEnabledByType('debug', false);

      expect(mockConfigManager.set).toHaveBeenCalledWith(
        'endUserRules',
        expect.objectContaining({
          debug: expect.objectContaining({
            enabled: false,
          }),
        }),
      );
    });

    it('should not return disabled rules in formatted output', () => {
      const mockRules: EndUserRulesConfig = {
        debug: {
          enabled: false,
          content: 'Debug rules',
          updatedAt: new Date().toISOString(),
        },
      };
      vi.mocked(mockConfigManager.get).mockReturnValue(mockRules);

      const formatted = manager.getFormattedRulesByType('debug');

      expect(formatted).toBeNull();
    });
  });

  describe('Delete Rules', () => {
    it('should delete rules by type', () => {
      const mockRules: EndUserRulesConfig = {
        debug: {
          enabled: true,
          content: 'Debug rules',
          updatedAt: new Date().toISOString(),
        },
        workspace: {
          enabled: true,
          content: 'Workspace rules',
          updatedAt: new Date().toISOString(),
        },
      };
      vi.mocked(mockConfigManager.get).mockReturnValue(mockRules);

      manager.deleteRulesByType('debug');

      expect(mockConfigManager.set).toHaveBeenCalledWith(
        'endUserRules',
        expect.not.objectContaining({
          debug: expect.anything(),
        }),
      );
    });
  });

  describe('Import/Export', () => {
    it('should export all rules as JSON', () => {
      const mockRules: EndUserRulesConfig = {
        debug: {
          enabled: true,
          content: 'Debug rules',
          updatedAt: '2025-01-01T00:00:00.000Z',
        },
      };
      vi.mocked(mockConfigManager.get).mockReturnValue(mockRules);

      const json = manager.exportAllRules();
      const parsed = JSON.parse(json);

      expect(parsed).toEqual(mockRules);
    });

    it('should export rules by type', () => {
      const mockRules: EndUserRulesConfig = {
        debug: {
          enabled: true,
          content: 'Debug rules',
          updatedAt: '2025-01-01T00:00:00.000Z',
        },
      };
      vi.mocked(mockConfigManager.get).mockReturnValue(mockRules);

      const json = manager.exportRulesByType('debug');
      const parsed = JSON.parse(json);

      expect(parsed).toEqual(mockRules.debug);
    });

    it('should import new format (per-type)', () => {
      const newFormatRules: EndUserRulesConfig = {
        debug: {
          enabled: true,
          content: 'Debug rules',
          updatedAt: '2025-01-01T00:00:00.000Z',
        },
        workspace: {
          enabled: false,
          content: 'Workspace rules',
          updatedAt: '2025-01-01T00:00:00.000Z',
        },
      };

      manager.importRules(JSON.stringify(newFormatRules));

      expect(mockConfigManager.set).toHaveBeenCalledWith('endUserRules', newFormatRules);
    });

    it('should migrate old format to system type', () => {
      const oldFormatRules = {
        enabled: true,
        content: 'Old rules content',
        updatedAt: '2025-01-01T00:00:00.000Z',
      };

      manager.importRules(JSON.stringify(oldFormatRules));

      expect(mockConfigManager.set).toHaveBeenCalledWith(
        'endUserRules',
        expect.objectContaining({
          system: expect.objectContaining({
            content: 'Old rules content',
            enabled: true,
          }),
        }),
      );
    });

    it('should handle string format', () => {
      manager.importRules(JSON.stringify('Plain string rules'));

      expect(mockConfigManager.set).toHaveBeenCalledWith(
        'endUserRules',
        expect.objectContaining({
          system: expect.objectContaining({
            content: 'Plain string rules',
          }),
        }),
      );
    });
  });

  describe('Available Rule Types', () => {
    it('should list types with content', () => {
      const mockRules: EndUserRulesConfig = {
        debug: {
          enabled: true,
          content: 'Debug rules',
          updatedAt: '2025-01-01T00:00:00.000Z',
        },
        workspace: {
          enabled: true,
          content: '',
          updatedAt: '2025-01-01T00:00:00.000Z',
        },
        'task-loop': {
          enabled: true,
          content: 'Task loop rules',
          updatedAt: '2025-01-01T00:00:00.000Z',
        },
      };
      vi.mocked(mockConfigManager.get).mockReturnValue(mockRules);

      const types = manager.getAvailableRuleTypes();

      expect(types).toContain('debug');
      expect(types).toContain('task-loop');
      expect(types).not.toContain('workspace'); // Empty content
    });
  });

  describe('Formatted Rules', () => {
    it('should return formatted rules for enabled type', () => {
      const mockRules: EndUserRulesConfig = {
        debug: {
          enabled: true,
          content: 'Always log everything',
          updatedAt: '2025-01-01T00:00:00.000Z',
        },
      };
      vi.mocked(mockConfigManager.get).mockReturnValue(mockRules);

      const formatted = manager.getFormattedRulesByType('debug');

      expect(formatted).toBe('Always log everything');
    });

    it('should return null for empty content', () => {
      const mockRules: EndUserRulesConfig = {
        debug: {
          enabled: true,
          content: '',
          updatedAt: '2025-01-01T00:00:00.000Z',
        },
      };
      vi.mocked(mockConfigManager.get).mockReturnValue(mockRules);

      const formatted = manager.getFormattedRulesByType('debug');

      expect(formatted).toBeNull();
    });
  });
});
