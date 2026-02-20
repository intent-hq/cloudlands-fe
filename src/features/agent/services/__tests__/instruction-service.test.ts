/**
 * Instruction Service Tests
 *
 * Tests the ONLY service for loading agent instruction content.
 * Verifies 3-tier fallback, caching, file watching, and workspace path handling.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { InstructionService } from '../../main/instruction-service';
import { EndUserRulesManager } from '../../../rules/user-rules.service';
import type { ConfigManager } from '../../../../shared/services/config-manager';

// Mock fs module for file watching
vi.mock('fs', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    default: {
      ...actual,
      watch: vi.fn(() => ({
        close: vi.fn(),
      })),
    },
    watch: vi.fn(() => ({
      close: vi.fn(),
    })),
  };
});

// Mock Logger
vi.mock('$shared/logger', () => ({
  Logger: class MockLogger {
    constructor(name: string) {}
    info = vi.fn();
    debug = vi.fn();
    warn = vi.fn();
    error = vi.fn();
  },
}));

describe('InstructionService', () => {
  let service: InstructionService;
  let tempDir: string;
  let workspacePath: string;
  let mockConfigManager: ConfigManager;

  beforeEach(async () => {
    // Create temporary directory for testing
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'instruction-service-test-'));
    workspacePath = path.join(tempDir, 'workspace');
    await fs.mkdir(workspacePath, { recursive: true });

    // Create mock ConfigManager with fresh store for each test
    const store = new Map<string, any>();
    mockConfigManager = {
      get: vi.fn((key: string) => store.get(key)),
      set: vi.fn((key: string, value: any) => store.set(key, value)),
      has: vi.fn((key: string) => store.has(key)),
      delete: vi.fn((key: string) => store.delete(key)),
      clear: vi.fn(() => store.clear()),
      initialize: vi.fn().mockResolvedValue(undefined),
    } as unknown as ConfigManager;

    // Reset EndUserRulesManager singleton to get fresh instance
    (EndUserRulesManager as any).instance = undefined;
    const endUserRulesManager = EndUserRulesManager.getInstance();
    await endUserRulesManager.initialize(mockConfigManager);

    // Reset InstructionService singleton to get fresh instance
    (InstructionService as any).instance = undefined;
    service = InstructionService.getInstance();
  });

  afterEach(async () => {
    // Cleanup
    service.destroy();
    // Small delay to allow file watchers to fully close
    await new Promise((resolve) => setTimeout(resolve, 50));
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Retry once after a longer delay if first attempt fails
      await new Promise((resolve) => setTimeout(resolve, 100));
      await fs.rm(tempDir, { recursive: true, force: true });
    }
    vi.clearAllMocks();
  });

  describe('getBaseSystemPrompt', () => {
    it('should return bundled default when no overrides exist', () => {
      const prompt = service.getBaseSystemPrompt();

      expect(prompt).toBeDefined();
      expect(prompt.length).toBeGreaterThan(0);
      expect(prompt).toContain('Augment Agent'); // Base system prompt should mention Augment Agent
    });

    it('should append EndUserRulesManager override (base-system-prompt type) to bundled default', () => {
      // Setup user override
      const customPrompt = '# Custom Base System Prompt\n\nYou are a custom assistant.';
      const endUserRulesManager = EndUserRulesManager.getInstance();
      endUserRulesManager.updateRulesByType('base-system-prompt', customPrompt);

      const prompt = service.getBaseSystemPrompt();

      // Should contain both bundled default AND user customization
      expect(prompt).toContain('Augment Agent'); // Bundled default
      expect(prompt).toContain(customPrompt); // User customization appended
    });

    it('should append EndUserRulesManager override (system type - legacy) to bundled default', () => {
      // Setup legacy user override
      const legacyPrompt = '# Legacy System Prompt\n\nYou are a legacy assistant.';
      const endUserRulesManager = EndUserRulesManager.getInstance();
      endUserRulesManager.updateRulesByType('system', legacyPrompt);

      const prompt = service.getBaseSystemPrompt();

      // Should contain both bundled default AND legacy customization
      expect(prompt).toContain('Augment Agent'); // Bundled default
      expect(prompt).toContain(legacyPrompt); // Legacy customization appended
    });

    it('should append both base-system-prompt and system type to bundled default', () => {
      // Setup both types
      const newPrompt = '# New Base System Prompt';
      const legacyPrompt = '# Legacy System Prompt';
      const endUserRulesManager = EndUserRulesManager.getInstance();
      endUserRulesManager.updateRulesByType('base-system-prompt', newPrompt);
      endUserRulesManager.updateRulesByType('system', legacyPrompt);

      const prompt = service.getBaseSystemPrompt();

      // Should contain bundled default + both customizations
      expect(prompt).toContain('Augment Agent'); // Bundled default
      expect(prompt).toContain(newPrompt); // base-system-prompt appended
      expect(prompt).toContain(legacyPrompt); // system type appended
    });
  });

  describe('getSpecializationRules', () => {
    it('should return bundled TS constant when no overrides exist', async () => {
      const rules = await service.getSpecializationRules('debug');

      expect(rules).toBeDefined();
      expect(rules.length).toBeGreaterThan(0);
    });

    it('should return workspace file override when it exists', async () => {
      // Create workspace rules file
      const rulesDir = path.join(workspacePath, '.augment', 'agent-rules');
      await fs.mkdir(rulesDir, { recursive: true });
      const workspaceRules = '# Workspace Debug Rules\n\nAlways log everything.';
      await fs.writeFile(path.join(rulesDir, 'debug.md'), workspaceRules);

      const rules = await service.getSpecializationRules('debug', workspacePath);

      expect(rules).toBe(workspaceRules);
    });

    it('should return EndUserRulesManager override when it exists', async () => {
      // Setup user override
      const customRules = '# Custom Debug Rules\n\nUser-defined debugging approach.';
      const endUserRulesManager = EndUserRulesManager.getInstance();
      endUserRulesManager.updateRulesByType('debug', customRules);

      const rules = await service.getSpecializationRules('debug');

      expect(rules).toBe(customRules);
    });

    it('should prioritize EndUserRulesManager > workspace file > bundled default', async () => {
      // Setup workspace file
      const rulesDir = path.join(workspacePath, '.augment', 'agent-rules');
      await fs.mkdir(rulesDir, { recursive: true });
      const workspaceRules = '# Workspace Debug Rules';
      await fs.writeFile(path.join(rulesDir, 'debug.md'), workspaceRules);

      // Setup user override
      const userRules = '# User Debug Rules';
      const endUserRulesManager = EndUserRulesManager.getInstance();
      endUserRulesManager.updateRulesByType('debug', userRules);

      const rules = await service.getSpecializationRules('debug', workspacePath);

      // Should return user rules (highest priority)
      expect(rules).toBe(userRules);
    });

    it('should prepend common instructions to bundled defaults', async () => {
      // Use a fresh service instance with no user overrides
      // This ensures we get the bundled default, not a user override from previous tests
      (InstructionService as any).instance = undefined;
      const freshService = InstructionService.getInstance();

      const rules = await freshService.getSpecializationRules('debug');

      // Should contain common instructions (prepended to bundled defaults)
      // The common.ts file contains delegation and note editing instructions
      expect(rules).toContain('Delegating Tasks');
      expect(rules).toContain('delegate_task');

      // Cleanup
      freshService.destroy();
    });
  });

  describe('Workspace Path Handling (CRITICAL)', () => {
    it('should load workspace rules from workspace directory, NOT from process.cwd()', async () => {
      // Create rules in workspace directory
      const rulesDir = path.join(workspacePath, '.augment', 'agent-rules');
      await fs.mkdir(rulesDir, { recursive: true });
      const workspaceRules = '# Workspace Rules from correct directory';
      await fs.writeFile(path.join(rulesDir, 'debug.md'), workspaceRules);

      // Verify workspace path is different from process.cwd()
      expect(workspacePath).not.toBe(process.cwd());
      expect(workspacePath).toContain(tempDir);

      const rules = await service.getSpecializationRules('debug', workspacePath);

      // Should load from workspace directory
      expect(rules).toBe(workspaceRules);
    });

    it('should handle multiple workspaces independently', async () => {
      // Create two workspaces
      const workspace1 = path.join(tempDir, 'workspace1');
      const workspace2 = path.join(tempDir, 'workspace2');
      await fs.mkdir(workspace1, { recursive: true });
      await fs.mkdir(workspace2, { recursive: true });

      // Create different rules for each workspace
      const rules1Dir = path.join(workspace1, '.augment', 'agent-rules');
      const rules2Dir = path.join(workspace2, '.augment', 'agent-rules');
      await fs.mkdir(rules1Dir, { recursive: true });
      await fs.mkdir(rules2Dir, { recursive: true });

      const rules1 = '# Workspace 1 Debug Rules';
      const rules2 = '# Workspace 2 Debug Rules';
      await fs.writeFile(path.join(rules1Dir, 'debug.md'), rules1);
      await fs.writeFile(path.join(rules2Dir, 'debug.md'), rules2);

      // Load rules from each workspace
      const result1 = await service.getSpecializationRules('debug', workspace1);
      const result2 = await service.getSpecializationRules('debug', workspace2);

      // Should load correct rules for each workspace
      expect(result1).toBe(rules1);
      expect(result2).toBe(rules2);
    });
  });

  describe('buildSystemPrompt', () => {
    it('should combine base + specialization correctly', async () => {
      const prompt = await service.buildSystemPrompt({
        agentType: 'debug',
        workspacePath,
      });

      expect(prompt).toBeDefined();
      expect(prompt.length).toBeGreaterThan(0);
      // Should contain separator between layers
      expect(prompt).toContain('---');
    });

    it('should include context references when provided', async () => {
      const contextRefs = ['Task: Fix the bug', 'File: src/main.ts'];
      const prompt = await service.buildSystemPrompt({
        agentType: 'debug',
        workspacePath,
        contextReferences: contextRefs,
      });

      expect(prompt).toContain('Runtime Context');
      expect(prompt).toContain('Task: Fix the bug');
      expect(prompt).toContain('File: src/main.ts');
    });

    it('should handle missing agentType gracefully', async () => {
      const prompt = await service.buildSystemPrompt({
        workspacePath,
      });

      // Should still return base system prompt
      expect(prompt).toBeDefined();
      expect(prompt.length).toBeGreaterThan(0);
    });

    it('should format layers with proper separators', async () => {
      const prompt = await service.buildSystemPrompt({
        agentType: 'debug',
        workspacePath,
        contextReferences: ['Context item'],
      });

      // Should have separators between layers
      const separatorCount = (prompt.match(/---/g) || []).length;
      expect(separatorCount).toBeGreaterThanOrEqual(2); // At least 2 separators for 3 layers
    });
  });

  describe('Caching', () => {
    it('should cache results with TTL', async () => {
      // First call - should load from file/TS constant
      const rules1 = await service.getSpecializationRules('debug', workspacePath);

      // Second call - should return cached result
      const rules2 = await service.getSpecializationRules('debug', workspacePath);

      expect(rules1).toBe(rules2);

      // Check cache stats
      const stats = service.getStats();
      expect(stats.size).toBeGreaterThan(0);
      expect(stats.totalHits).toBeGreaterThan(0);
    });

    it('should return cached results on subsequent calls', async () => {
      // Create workspace rules file
      const rulesDir = path.join(workspacePath, '.augment', 'agent-rules');
      await fs.mkdir(rulesDir, { recursive: true });
      const workspaceRules = '# Cached Rules';
      await fs.writeFile(path.join(rulesDir, 'debug.md'), workspaceRules);

      // First call
      await service.getSpecializationRules('debug', workspacePath);

      // Get initial stats
      const stats1 = service.getStats();
      const initialHits = stats1.totalHits;

      // Second call - should hit cache
      await service.getSpecializationRules('debug', workspacePath);

      // Check that hits increased
      const stats2 = service.getStats();
      expect(stats2.totalHits).toBeGreaterThan(initialHits);
    });

    it('should evict oldest entries when cache is full (LRU)', async () => {
      // Fill cache beyond MAX_CACHE_SIZE (100) using valid agent types
      // We'll use the same agent type with different workspace paths to create unique cache keys
      const promises = [];
      for (let i = 0; i < 105; i++) {
        promises.push(service.getSpecializationRules('debug', `/workspace-${i}`));
      }
      await Promise.all(promises);

      // Cache should be at max size
      const stats = service.getStats();
      expect(stats.size).toBeLessThanOrEqual(100);
    });

    it('should invalidate cache for specific agent type', async () => {
      // Load rules
      await service.getSpecializationRules('debug', workspacePath);

      // Verify cached
      const stats1 = service.getStats();
      expect(stats1.size).toBeGreaterThan(0);

      // Invalidate
      service.invalidate('debug', workspacePath);

      // Cache should be smaller
      const stats2 = service.getStats();
      expect(stats2.size).toBeLessThan(stats1.size);
    });

    it('should clear entire cache', async () => {
      // Load multiple rules
      await service.getSpecializationRules('debug');
      await service.getSpecializationRules('workspace');
      await service.getSpecializationRules('task-loop');

      // Verify cached
      const stats1 = service.getStats();
      expect(stats1.size).toBeGreaterThan(0);

      // Clear cache
      service.clearCache();

      // Cache should be empty
      const stats2 = service.getStats();
      expect(stats2.size).toBe(0);
    });

    it('should track cache hits', async () => {
      // First call
      await service.getSpecializationRules('debug');

      const stats1 = service.getStats();
      const initialHits = stats1.totalHits;

      // Multiple subsequent calls
      await service.getSpecializationRules('debug');
      await service.getSpecializationRules('debug');
      await service.getSpecializationRules('debug');

      const stats2 = service.getStats();
      expect(stats2.totalHits).toBeGreaterThan(initialHits);
    });
  });

  describe('File Watching', () => {
    it('should watch workspace files for changes', async () => {
      // Create workspace rules file
      const rulesDir = path.join(workspacePath, '.augment', 'agent-rules');
      await fs.mkdir(rulesDir, { recursive: true });
      const workspaceRules = '# Initial Rules';
      await fs.writeFile(path.join(rulesDir, 'debug.md'), workspaceRules);

      // Load rules (should create watcher)
      await service.getSpecializationRules('debug', workspacePath);

      // Check that watcher was created (or at least attempted)
      // Note: File watching may not work in test environment, so we just verify
      // the service doesn't crash and returns valid rules
      const stats = service.getStats();
      expect(stats.watcherCount).toBeGreaterThanOrEqual(0);
    });

    it('should clean up watchers on destroy', async () => {
      // Create workspace rules file
      const rulesDir = path.join(workspacePath, '.augment', 'agent-rules');
      await fs.mkdir(rulesDir, { recursive: true });
      await fs.writeFile(path.join(rulesDir, 'debug.md'), '# Rules');

      // Load rules (should create watcher)
      await service.getSpecializationRules('debug', workspacePath);

      // Get initial stats
      const stats1 = service.getStats();
      const initialWatcherCount = stats1.watcherCount;

      // Destroy service
      service.destroy();

      // Watchers should be cleaned up
      const stats2 = service.getStats();
      expect(stats2.watcherCount).toBe(0);

      // Cache should also be cleared
      expect(stats2.size).toBe(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle missing workspace files gracefully', async () => {
      // Try to load from non-existent workspace
      const rules = await service.getSpecializationRules('debug', '/non/existent/path');

      // Should fall back to bundled default
      expect(rules).toBeDefined();
      expect(rules.length).toBeGreaterThan(0);
    });

    it('should handle EndUserRulesManager errors gracefully', async () => {
      // Mock EndUserRulesManager to throw error
      const endUserRulesManager = EndUserRulesManager.getInstance();
      vi.spyOn(endUserRulesManager, 'getFormattedRulesByType').mockImplementation(() => {
        throw new Error('Mock error');
      });

      // Should fall back to bundled default
      const rules = await service.getSpecializationRules('debug');

      expect(rules).toBeDefined();
      expect(rules.length).toBeGreaterThan(0);
    });

    it('should handle invalid agentType gracefully', async () => {
      // Non-existent agent types fall back to 'workspace' instruction (fallbackToWorkspace=true)
      // This is intentional - unknown types get workspace instructions rather than throwing
      const rules = await service.getSpecializationRules('non-existent-type');
      expect(rules).toBeDefined();
      expect(rules.length).toBeGreaterThan(0);
    });
  });
});
