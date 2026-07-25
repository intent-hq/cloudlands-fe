/**
 * Instruction Service Tests
 *
 * Tests the ONLY service for loading agent instruction content.
 * Verifies 3-tier fallback, caching, file watching, and workspace path handling.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { InstructionService } from '../../main/instruction-service';
import { EndUserRulesManager } from '../../../rules/user-rules.service';
import type { ConfigManager } from '../../../../shared/services/config-manager';
import * as appSettingsService from '../../../workspace/main/app-settings.service';

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

// Mock the GitHub auth-status probe (pulled in via specialists.service)
vi.mock('../../../../main/utils/github-auth-status', () => ({
  isGitHubConfigured: vi.fn().mockResolvedValue(false),
}));

vi.mock('../../../workspace/main/app-settings.service', () => ({
  initAppSettingsService: vi.fn(async () => {}),
  getBranchPrefix: vi.fn(() => ''),
  getWorktreesLocation: vi.fn(() => ''),
  getSshKeyPath: vi.fn(() => ''),
}));


// Mock Logger
vi.mock('$shared/logger', () => ({
  Logger: class MockLogger {
    constructor() {}
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
    vi.mocked(appSettingsService.getBranchPrefix).mockReturnValue('feature/');

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
    // Small delay to allow pending fs operations to settle
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
      expect(prompt).toContain('Intent Agent'); // Base system prompt should mention Intent Agent
    });

    it('should append EndUserRulesManager override (base-system-prompt type) to bundled default', () => {
      // Setup user override
      const customPrompt = '# Custom Base System Prompt\n\nYou are a custom assistant.';
      const endUserRulesManager = EndUserRulesManager.getInstance();
      endUserRulesManager.updateRulesByType('base-system-prompt', customPrompt);

      const prompt = service.getBaseSystemPrompt();

      // Should contain both bundled default AND user customization
      expect(prompt).toContain('Intent Agent'); // Bundled default
      expect(prompt).toContain(customPrompt); // User customization appended
    });

    it('should append EndUserRulesManager override (system type - legacy) to bundled default', () => {
      // Setup legacy user override
      const legacyPrompt = '# Legacy System Prompt\n\nYou are a legacy assistant.';
      const endUserRulesManager = EndUserRulesManager.getInstance();
      endUserRulesManager.updateRulesByType('system', legacyPrompt);

      const prompt = service.getBaseSystemPrompt();

      // Should contain both bundled default AND legacy customization
      expect(prompt).toContain('Intent Agent'); // Bundled default
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
      expect(prompt).toContain('Intent Agent'); // Bundled default
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
      expect(rules).toContain('ws.agent.delegate');

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

    it('should include user rules and workspace context in correct order', async () => {
      await fs.writeFile(path.join(workspacePath, 'AGENTS.md'), '# Project Rules\n\nAlways test changes.');

      const prompt = await service.buildSystemPrompt({
        agentType: 'debug',
        workspacePath,
        workspaceContext: {
          openPanels: [{ type: 'note', title: 'Spec', id: 'spec' }],
          linkedReferences: [],
        },
      });

      const userRulesIndex = prompt.indexOf('## User Rules & Guidelines');
      const workspaceIndex = prompt.indexOf('## Workspace Context');

      expect(userRulesIndex).toBeGreaterThanOrEqual(0);
      expect(workspaceIndex).toBeGreaterThan(userRulesIndex);
      // Skills catalog is now daemon-owned (PROTOCOL §5.34), not in FE prompt.
      expect(prompt).not.toContain('<available_skills>');
    });

    it('should place behavior instructions after shared layers by default', async () => {
      await fs.writeFile(path.join(workspacePath, 'AGENTS.md'), '# Project Rules\n\nAlways test changes.');

      const specializationRules = await service.getSpecializationRules('task-loop', workspacePath);
      const specializationMarker = specializationRules.split('\n')[0];
      const behaviorMarker = '## Specialist Behavior\n\nStay laser-focused.';

      const prompt = await service.buildSystemPrompt({
        agentType: 'task-loop',
        workspacePath,
        behaviorPrompt: behaviorMarker,
        specialistName: 'Implementor',
        roleReminder: 'Stay within task scope.',
        workspaceContext: {
          openPanels: [{ type: 'note', title: 'Spec', id: 'spec' }],
          linkedReferences: [],
        },
      });

      const baseIndex = prompt.indexOf('Intent Agent');
      const specializationIndex = prompt.indexOf(specializationMarker);
      const userRulesIndex = prompt.indexOf('## User Rules & Guidelines');
      const behaviorIndex = prompt.indexOf(behaviorMarker);
      const workspaceIndex = prompt.indexOf('## Workspace Context');

      expect(baseIndex).toBeGreaterThanOrEqual(0);
      expect(specializationIndex).toBeGreaterThan(baseIndex);
      expect(userRulesIndex).toBeGreaterThan(specializationIndex);
      expect(behaviorIndex).toBeGreaterThan(userRulesIndex);
      expect(workspaceIndex).toBeGreaterThan(behaviorIndex);
      // Skills catalog is now daemon-owned (PROTOCOL §5.34), not in FE prompt.
      expect(prompt).not.toContain('<available_skills>');
    });

    it('should share an identical parent/sub-agent prefix up to the behavior boundary', async () => {
      await fs.writeFile(path.join(workspacePath, 'AGENTS.md'), '# Project Rules\n\nAlways test changes.');

      const parentPrompt = await service.buildSystemPrompt({
        agentType: 'task-loop',
        workspacePath,
        behaviorPrompt: '## Specialist Behavior\n\nParent behavior.',
        specialistName: 'Coordinator',
        roleReminder: 'Coordinate carefully.',
      });

      const subAgentPrompt = await service.buildSystemPrompt({
        agentType: 'task-loop',
        workspacePath,
        behaviorPrompt: '## Specialist Behavior\n\nSub-agent behavior.',
        specialistName: 'Implementor',
        roleReminder: 'Stay within task scope.',
        isSubAgent: true,
      });

      const behaviorSectionMarker = '# Your Specialist Role';
      const parentBehaviorIndex = parentPrompt.indexOf(behaviorSectionMarker);
      const subAgentBehaviorIndex = subAgentPrompt.indexOf(behaviorSectionMarker);
      const parentPrefix = parentPrompt.slice(0, parentBehaviorIndex);
      const subAgentPrefix = subAgentPrompt.slice(0, subAgentBehaviorIndex);

      expect(parentBehaviorIndex).toBeGreaterThanOrEqual(0);
      expect(subAgentBehaviorIndex).toBeGreaterThanOrEqual(0);
      expect(parentPrefix).toBe(subAgentPrefix);
      expect(parentPrefix).toContain('Intent Agent');
      expect(parentPrefix).toContain('## User Rules & Guidelines');
      // Skills catalog is now daemon-owned (PROTOCOL §5.34), not in FE prompt.
      expect(parentPrefix).not.toContain('<available_skills>');
    });

    describe('prompt prefix consistency', () => {
      const getCommonPrefix = (left: string, right: string): string => {
        let index = 0;

        while (index < left.length && index < right.length && left[index] === right[index]) {
          index += 1;
        }

        return left.slice(0, index);
      };

      it('should keep the full parent/sub-agent prefix identical until the behavior prompts begin', async () => {
        await fs.writeFile(path.join(workspacePath, 'AGENTS.md'), '# Project Rules\n\nAlways test changes.');

        const agentType = 'task-loop';
        const specializationRules = await service.getSpecializationRules(agentType, workspacePath);
        const specializationMarker = specializationRules
          .split('\n')
          .find((line) => line.trim().length > 0);
        const parentBehaviorPrompt = 'PARENT_ONLY_BEHAVIOR\nCoordinate parent execution.';
        const subAgentBehaviorPrompt = 'SUBAGENT_ONLY_BEHAVIOR\nExecute the delegated task.';

        expect(specializationMarker).toBeTruthy();

        const parentPrompt = await service.buildSystemPrompt({
          agentType,
          workspacePath,
          behaviorPrompt: parentBehaviorPrompt,
          specialistName: 'Implementor',
          roleReminder: 'Stay within task scope.',
        });

        const subAgentPrompt = await service.buildSystemPrompt({
          agentType,
          workspacePath,
          behaviorPrompt: subAgentBehaviorPrompt,
          specialistName: 'Implementor',
          roleReminder: 'Stay within task scope.',
          isSubAgent: true,
        });

        const parentBehaviorIndex = parentPrompt.indexOf(parentBehaviorPrompt);
        const subAgentBehaviorIndex = subAgentPrompt.indexOf(subAgentBehaviorPrompt);
        const parentPrefix = parentPrompt.slice(0, parentBehaviorIndex);
        const subAgentPrefix = subAgentPrompt.slice(0, subAgentBehaviorIndex);
        const commonPrefix = getCommonPrefix(parentPrompt, subAgentPrompt);

        expect(parentBehaviorIndex).toBeGreaterThanOrEqual(0);
        expect(subAgentBehaviorIndex).toBeGreaterThanOrEqual(0);
        expect(parentPrefix).toBe(subAgentPrefix);
        expect(commonPrefix).toBe(parentPrefix);
        expect(commonPrefix.length).toBeGreaterThan(1000);
        expect(commonPrefix).toContain('Intent Agent');
        expect(commonPrefix).toContain(specializationMarker!);
        expect(commonPrefix).toContain('## User Rules & Guidelines');
        // Skills catalog is now daemon-owned (PROTOCOL §5.34), not in FE prompt.
        expect(commonPrefix).not.toContain('<available_skills>');
      });

    });

    it('should not include skills catalog (daemon-owned)', async () => {
      const prompt = await service.buildSystemPrompt({
        agentType: 'task-loop',
        workspacePath,
        isSubAgent: true,
      });

      // Skills catalog is now daemon-owned (PROTOCOL §5.34), not in FE prompt.
      expect(prompt).not.toContain('<available_skills>');
      expect(prompt).toContain('Intent Agent');
    });

    it('should handle missing agentType gracefully', async () => {
      const prompt = await service.buildSystemPrompt({
        workspacePath,
      });

      // Should still return base system prompt
      expect(prompt).toBeDefined();
      expect(prompt.length).toBeGreaterThan(0);
    });

    it('should not include skills catalog (daemon-owned)', async () => {
      const prompt = await service.buildSystemPrompt({
        agentType: 'debug',
      });

      // Skills catalog is now daemon-owned (PROTOCOL §5.34), not in FE prompt.
      expect(prompt).not.toContain('<available_skills>');
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

    it('should cache prompts with behavior instructions and keep parent/sub-agent keys distinct', async () => {
      const buildConfig = {
        agentType: 'task-loop',
        workspacePath,
        behaviorPrompt: '## Specialist Behavior\n\nCache me.',
        specialistName: 'Implementor',
        roleReminder: 'Stay within task scope.',
      };

      const parentPrompt = await service.buildSystemPrompt(buildConfig);
      const cachedParentPrompt = await service.buildSystemPrompt(buildConfig);
      const subAgentPrompt = await service.buildSystemPrompt({
        ...buildConfig,
        isSubAgent: true,
      });

      const systemPromptCache = (service as any).systemPromptCache as {
        size: number;
        keys(): string[];
        get(key: string): { content: string; hits: number } | undefined;
      };

      expect(cachedParentPrompt).toBe(parentPrompt);
      expect(subAgentPrompt).not.toBe(parentPrompt);
      expect(systemPromptCache.size).toBe(2);

      const hitCounts = systemPromptCache
        .keys()
        .map((key) => systemPromptCache.get(key)?.hits ?? 0);
      expect(Math.max(...hitCounts)).toBeGreaterThan(0);
    });

    it('should reuse a single cache entry for repeated cacheable prompts without behavior prompts', async () => {
      await fs.writeFile(path.join(workspacePath, 'AGENTS.md'), '# Project Rules\n\nAlways test changes.');

      const skillDir = path.join(workspacePath, '.agents', 'skills', 'cache-ordering-skill');
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(
        path.join(skillDir, 'SKILL.md'),
        `---\nname: cache-ordering-skill\ndescription: Verifies ordering cache keys.\n---\n# Cache Ordering Skill\nUse this skill for cache ordering tests.\n`,
      );

      const firstPrompt = await service.buildSystemPrompt({
        agentType: 'task-loop',
        workspacePath,
      });

      const secondPrompt = await service.buildSystemPrompt({
        agentType: 'task-loop',
        workspacePath,
      });

      const systemPromptCache = (service as any).systemPromptCache as {
        size: number;
        keys(): string[];
        get(key: string): { content: string; hits: number } | undefined;
      };
      const hitCounts = systemPromptCache
        .keys()
        .map((key) => systemPromptCache.get(key)?.hits ?? 0);

      expect(secondPrompt).toBe(firstPrompt);
      expect(systemPromptCache.size).toBe(1);
      expect(Math.max(...hitCounts)).toBeGreaterThan(0);
    });

    it('should truncate layers by priority before dropping behavior instructions', () => {
      const makeLayer = (
        name: string,
        marker: string,
        repeatCount: number,
        priority: number,
        canTruncate: boolean,
      ) => ({
        name,
        content: `${marker}\n${'x'.repeat(repeatCount)}`,
        priority,
        canTruncate,
      });

      const layers = [
        makeLayer('base-system-prompt', 'BASE_SYSTEM_PROMPT', 80, 1, false),
        makeLayer('specialization-rules', 'SPECIALIZATION_RULES', 80, 1, false),
        makeLayer('user-rules', 'USER_RULES', 50, 2, true),
        makeLayer('skills-catalog', 'SKILLS_CATALOG', 50, 3, true),
        makeLayer('behavior-prompt', 'BEHAVIOR_PROMPT', 70, 1, false),
        makeLayer('team-context', 'TEAM_CONTEXT', 40, 3, true),
        makeLayer('workspace-context', 'WORKSPACE_CONTEXT', 60, 4, true),
        makeLayer('runtime-context', 'RUNTIME_CONTEXT', 60, 4, true),
        makeLayer('mandatory-actions-footer', 'MANDATORY_ACTIONS_FOOTER', 30, 2, true),
      ];

      const prompt = (service as any).truncatePromptToFit(layers, 520) as string;

      expect(prompt.length).toBeLessThanOrEqual(520);
      expect(prompt).toContain('BASE_SYSTEM_PROMPT');
      expect(prompt).toContain('SPECIALIZATION_RULES');
      expect(prompt).toContain('BEHAVIOR_PROMPT');
      expect(prompt).toContain('USER_RULES');
      expect(prompt).toContain('MANDATORY_ACTIONS_FOOTER');
      expect(prompt).not.toContain('WORKSPACE_CONTEXT');
      expect(prompt).not.toContain('RUNTIME_CONTEXT');

      expect(prompt.indexOf('USER_RULES')).toBeLessThan(prompt.indexOf('BEHAVIOR_PROMPT'));
      expect(prompt.indexOf('BEHAVIOR_PROMPT')).toBeLessThan(
        prompt.indexOf('MANDATORY_ACTIONS_FOOTER'),
      );
    });

    describe('suggested-prompts footer placement', () => {
      it('includes suggested-prompts section for top-level agent when auto-commit is off', async () => {
        const prompt = await service.buildSystemPrompt({
          agentType: 'workspace',
          workspacePath,
          specialistName: 'Coordinator',
          roleReminder: 'Test reminder.',
          isSubAgent: false,
          autoCommitEnabled: false,
        });

        expect(prompt).toContain('## Suggested Next Steps');
        expect(prompt).toContain('<!-- suggested-prompts');
        expect(prompt.indexOf('## Suggested Next Steps')).toBeGreaterThan(
          prompt.indexOf('## Role Reminder'),
        );
        expect(prompt).not.toContain('Auto-commit is enabled');
      });

      it('includes auto-commit warning when auto-commit is enabled', async () => {
        const prompt = await service.buildSystemPrompt({
          agentType: 'workspace',
          workspacePath,
          specialistName: 'Coordinator',
          roleReminder: 'Test reminder.',
          isSubAgent: false,
          autoCommitEnabled: true,
        });

        expect(prompt).toContain('## Suggested Next Steps');
        expect(prompt).toContain('<!-- suggested-prompts');
        expect(prompt.indexOf('## Suggested Next Steps')).toBeGreaterThan(
          prompt.indexOf('## Role Reminder'),
        );
        expect(prompt).toContain('Auto-commit is enabled');
      });

      it('omits suggested-prompts section for sub-agents', async () => {
        const prompt = await service.buildSystemPrompt({
          agentType: 'workspace',
          workspacePath,
          specialistName: 'Coordinator',
          roleReminder: 'Test reminder.',
          isSubAgent: true,
          autoCommitEnabled: false,
        });

        expect(prompt).not.toContain('## Suggested Next Steps');
        expect(prompt).not.toContain('<!-- suggested-prompts');
        expect(prompt).toContain('## Role Reminder');
      });

      it('includes the suggested-prompts section exactly once for top-level agents', async () => {
        const prompt = await service.buildSystemPrompt({
          agentType: 'workspace',
          workspacePath,
          specialistName: 'Coordinator',
          roleReminder: 'Test reminder.',
          isSubAgent: false,
          autoCommitEnabled: false,
        });

        const matches = prompt.match(/## Suggested Next Steps/g);
        expect(matches).toHaveLength(1);
      });

      it('includes "Review changes before committing." example when auto-commit is off', async () => {
        const prompt = await service.buildSystemPrompt({
          agentType: 'workspace',
          workspacePath,
          specialistName: 'Coordinator',
          roleReminder: 'Test reminder.',
          isSubAgent: false,
          autoCommitEnabled: false,
        });

        expect(prompt).toContain('Review changes before committing.');
      });

      it('omits "Review changes before committing." example when auto-commit is on', async () => {
        const prompt = await service.buildSystemPrompt({
          agentType: 'workspace',
          workspacePath: path.join(tempDir, 'workspace-autocommit-on'),
          specialistName: 'Coordinator',
          roleReminder: 'Test reminder.',
          isSubAgent: false,
          autoCommitEnabled: true,
        });

        expect(prompt).not.toContain('Review changes before committing.');
        expect(prompt).toContain('Check the changes in the diff view.');
      });

      it('produces different prompts for different autoCommitEnabled values (no cache collision)', async () => {
        // Use the same workspacePath to maximize cache-key overlap;
        // if autoCommitEnabled is not part of the cache key, these would collide.
        const autoCommitOff = await service.buildSystemPrompt({
          agentType: 'workspace',
          workspacePath,
          specialistName: 'Coordinator',
          roleReminder: 'Test reminder.',
          isSubAgent: false,
          autoCommitEnabled: false,
        });

        const autoCommitOn = await service.buildSystemPrompt({
          agentType: 'workspace',
          workspacePath,
          specialistName: 'Coordinator',
          roleReminder: 'Test reminder.',
          isSubAgent: false,
          autoCommitEnabled: true,
        });

        expect(autoCommitOff).not.toBe(autoCommitOn);
        expect(autoCommitOff).toContain('Review changes before committing.');
        expect(autoCommitOff).not.toContain('Auto-commit is enabled');
        expect(autoCommitOn).not.toContain('Review changes before committing.');
        expect(autoCommitOn).toContain('Auto-commit is enabled');
      });
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
      await service.buildSystemPrompt({ agentType: 'debug', workspacePath });

      // Verify cached
      const stats1 = service.getStats();
      expect(stats1.size).toBeGreaterThan(0);
      expect((service as any).systemPromptCache.size).toBeGreaterThan(0);

      // Invalidate
      service.invalidate('debug', workspacePath);

      // Cache should be smaller
      const stats2 = service.getStats();
      expect(stats2.size).toBeLessThan(stats1.size);
      expect((service as any).systemPromptCache.size).toBe(0);
    });

    it('should clear entire cache', async () => {
      // Load multiple rules
      await service.getSpecializationRules('debug');
      await service.getSpecializationRules('workspace');
      await service.getSpecializationRules('task-loop');
      await service.buildSystemPrompt({ agentType: 'debug', workspacePath });

      // Verify cached
      const stats1 = service.getStats();
      expect(stats1.size).toBeGreaterThan(0);
      expect((service as any).systemPromptCache.size).toBeGreaterThan(0);

      // Clear cache
      service.clearCache();

      // Cache should be empty
      const stats2 = service.getStats();
      expect(stats2.size).toBe(0);
      expect((service as any).systemPromptCache.size).toBe(0);
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

  describe('Cache Invalidation', () => {
    it('should clear full prompt cache when workspace rules are invalidated', async () => {
      const rulesDir = path.join(workspacePath, '.augment', 'agent-rules');
      await fs.mkdir(rulesDir, { recursive: true });
      const rulesPath = path.join(rulesDir, 'debug.md');
      await fs.writeFile(rulesPath, '# Rules');

      await service.getSpecializationRules('debug', workspacePath);
      await service.buildSystemPrompt({ agentType: 'debug', workspacePath });
      expect((service as any).systemPromptCache.size).toBeGreaterThan(0);

      service.invalidate('debug', workspacePath);

      expect((service as any).systemPromptCache.size).toBe(0);
    });

    it('should clear caches on destroy', async () => {
      // Create workspace rules file
      const rulesDir = path.join(workspacePath, '.augment', 'agent-rules');
      await fs.mkdir(rulesDir, { recursive: true });
      const rulesPath = path.join(rulesDir, 'debug.md');
      await fs.writeFile(rulesPath, '# Rules');

      await service.getSpecializationRules('debug', workspacePath);
      await service.buildSystemPrompt({ agentType: 'debug', workspacePath });
      expect((service as any).systemPromptCache.size).toBeGreaterThan(0);

      // Destroy service
      service.destroy();

      // Caches should be cleared
      const stats2 = service.getStats();
      expect(stats2.size).toBe(0);
      expect((service as any).systemPromptCache.size).toBe(0);
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
