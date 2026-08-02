/**
 * Specialist Configuration Tests
 *
 * Tests for the specialist configuration resolution system.
 * Ensures specialists are correctly configured with models and behavior prompts.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import {
  SPECIALISTS,
  getSpecialistById,
  GITHUB_DEPENDENT_SPECIALIST_IDS,
} from '../../src/lib/constants/specialists';
import {
  MODEL_DEFAULTS,
  MODEL_IDS,
  DEFAULT_AGENT_MODEL,
} from '../../src/shared/constants/agent-services';
import { MOCK_PROVIDER_CATALOG } from '../../src/test/fixtures/provider-catalog.fixture';
import { getModelTierFromCatalog } from '../../src/shared/provider-catalog';
import {
  writeSpecialistFile,
  ensureSpecialistsDirectory,
} from '../../src/features/specialists/main/specialist-file-loader';
import {
  initSpecialistsService,
  refreshSpecialistsFromFiles,
  getEffectiveSpecialist,
} from '../../src/features/agent/main/specialists.service';

const { mockSettingsData } = vi.hoisted(() => ({
  mockSettingsData: {} as Record<string, unknown>,
}));

// Tier/default-provider helpers over the §5.38-shaped mock catalog, replacing
// the deleted provider-config lookups (the registry now lives in the daemon).
function getDefaultModelForProvider(providerId: string, tier: 'fast' | 'balanced' | 'smart') {
  const tiers = MOCK_PROVIDER_CATALOG.providers.find((p) => p.id === providerId)?.modelTiers;
  if (!tiers) throw new Error(`no tier table for ${providerId}`);
  return tiers[tier];
}
function getModelTierFromModel(modelId: string, preferredProviderId?: string) {
  return getModelTierFromCatalog(MOCK_PROVIDER_CATALOG.providers, modelId, preferredProviderId);
}
function getDefaultProviderId() {
  return MOCK_PROVIDER_CATALOG.defaultProviderId;
}

const TEST_HOME = '/tmp/augment-specialist-config-test';
let originalHome: string | undefined;

// Mock electron-store for getEffectiveSpecialist
vi.mock('electron-store', () => ({
  default: class MockStore {
    get(key: string) {
      return mockSettingsData[key];
    }
    set(key: string, value: unknown) {
      mockSettingsData[key] = value;
    }
    delete(key: string) {
      delete mockSettingsData[key];
    }
  },
}));

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/test-augment',
    isPackaged: false,
  },
}));

// Mock the GitHub auth-status probe — controls whether GitHub-dependent
// specialists are visible
const mockIsAuthenticated = vi.fn().mockResolvedValue(false);
vi.mock('../../src/main/utils/github-auth-status', () => ({
  isGitHubConfigured: (...args: unknown[]) => mockIsAuthenticated(...args),
}));
describe('Specialist Configuration', () => {
  beforeAll(async () => {
    originalHome = process.env.HOME;
    process.env.HOME = TEST_HOME;
    await fs.rm(TEST_HOME, { recursive: true, force: true });
    // specialists.service resolves tiers via the main-process catalog cache;
    // seed it directly (no live daemon in unit tests).
    const accessor = await import('../../src/main/utils/provider-catalog-accessor');
    accessor.setProviderCatalogCacheForTests(MOCK_PROVIDER_CATALOG);
    await initSpecialistsService();
    await refreshSpecialistsFromFiles();
  });

  describe('getSpecialistById', () => {
    it('should return spec-writer specialist', () => {
      const specialist = getSpecialistById('spec-writer');
      expect(specialist).toBeDefined();
      expect(specialist!.id).toBe('spec-writer');
      expect(specialist!.name).toBe('Coordinator');
    });

    it('should return implementor specialist', () => {
      const specialist = getSpecialistById('implementor');
      expect(specialist).toBeDefined();
      expect(specialist!.id).toBe('implementor');
      expect(specialist!.name).toBe('Implementor');
    });

    it('should return verifier specialist', () => {
      const specialist = getSpecialistById('verifier');
      expect(specialist).toBeDefined();
      expect(specialist!.id).toBe('verifier');
      expect(specialist!.name).toBe('Verifier');
    });

    it('should return undefined for unknown specialist', () => {
      const specialist = getSpecialistById('unknown');
      expect(specialist).toBeUndefined();
    });
  });

  beforeEach(async () => {
    Object.keys(mockSettingsData).forEach((key) => delete mockSettingsData[key]);
    await fs.rm(path.join(TEST_HOME, '.augment'), { recursive: true, force: true });
    await refreshSpecialistsFromFiles();
  });

  afterAll(async () => {
    await fs.rm(TEST_HOME, { recursive: true, force: true });
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
  });

  describe('Specialist Model Assignments', () => {
    it('orchestrator uses smart tier for planning', () => {
      const specialist = getSpecialistById('spec-writer');
      expect(specialist!.defaultModelTier).toBe('smart');
    });

    it('implementor uses smart tier for execution', () => {
      const specialist = getSpecialistById('implementor');
      expect(specialist!.defaultModelTier).toBe('smart');
    });

    it('verifier uses smart tier for thorough review', () => {
      const specialist = getSpecialistById('verifier');
      expect(specialist!.defaultModelTier).toBe('smart');
    });

    it('pr-reviewer uses smart tier for thorough review', () => {
      const specialist = getSpecialistById('pr-reviewer');
      expect(specialist!.defaultModelTier).toBe('smart');
    });

    it('ui-designer uses smart tier like other specialists', () => {
      const specialist = getSpecialistById('ui-designer');
      expect(specialist!.defaultModelTier).toBe('smart');
    });
  });

  describe('Specialist Behavior Prompts', () => {
    it('spec-writer has delegation-focused behavior', () => {
      const specialist = getSpecialistById('spec-writer');
      const prompt = specialist!.defaultBehaviorPrompt;

      // Should focus on planning and delegation - tests updated to match optimized content
      expect(prompt).toContain('Coordinator');
      expect(prompt).toContain('delegate');
      expect(prompt).toMatch(/wave/i);

      // Should NOT implement code - tests updated to match optimized content
      expect(prompt).toContain('do NOT implement code yourself');
    });

    it('implementor has execution-focused behavior', () => {
      const specialist = getSpecialistById('implementor');
      const prompt = specialist!.defaultBehaviorPrompt;

      // Should focus on assigned task only - tests updated to match optimized content
      expect(prompt).toContain('assigned task');
      expect(prompt).toContain('nothing more');

      // Should avoid scope creep - tests updated to match optimized content
      expect(prompt).toContain('No scope creep');
      expect(prompt).toContain('No refactors');
    });

    it('verifier has verification-focused behavior', () => {
      const specialist = getSpecialistById('verifier');
      const prompt = specialist!.defaultBehaviorPrompt;

      // Should focus on verification - tests updated to match current content
      expect(prompt).toContain('verify');
      expect(prompt).toContain('Acceptance Criteria');
      expect(prompt).toContain('edge cases');

      // Should provide evidence with structured output format
      expect(prompt).toContain('VERIFIED');
      expect(prompt).toContain('DEVIATION');
      expect(prompt).toContain('MISSING');
    });
  });

  describe('Specialist Wave Execution', () => {
    it('spec-writer should contain wave execution instructions', () => {
      const specialist = getSpecialistById('spec-writer');
      const prompt = specialist!.defaultBehaviorPrompt;

      // Wave structure - tests updated to match optimized content
      expect(prompt).toMatch(/wave/i);

      // Wait mode
      expect(prompt).toContain('waitMode: "after_all"');

      // Workflow instructions
      expect(prompt).toContain('Workflow');
    });
  });

  describe('Specialist ID Validation', () => {
    it('all specialists have valid IDs matching type constraints', () => {
      const validIds = [
        'spec-writer',
        'implementor',
        'verifier',
        'pr-reviewer',
        'ui-designer',
        'developer',
        'chief-of-staff',
        'pr-shepherd',
        'ralph',
      ];

      for (const specialist of SPECIALISTS) {
        expect(validIds).toContain(specialist.id);
      }
    });

    it('each specialist has required fields', () => {
      for (const specialist of SPECIALISTS) {
        expect(specialist.id).toBeDefined();
        expect(specialist.name).toBeDefined();
        expect(specialist.description).toBeDefined();
        // Most specialists pin a model tier/model. Chief intentionally uses the user's default model.
        if (specialist.id === 'chief-of-staff') {
          expect(specialist.defaultModelTier || specialist.defaultModel).toBeUndefined();
        } else {
          expect(
            specialist.defaultModelTier || specialist.defaultModel,
            `Specialist ${specialist.id} must have either defaultModelTier or defaultModel`,
          ).toBeDefined();
        }
        expect(specialist.defaultBehaviorPrompt).toBeDefined();
      }
    });
  });

  // ==========================================================================
  // Regression: Auggie default model is Opus 4.7
  // These tests lock in the opus4.7 default so a revert to opus4.6/gpt5.4
  // would be caught immediately.
  // ==========================================================================

  describe('Auggie Default Model Regression (opus4.7)', () => {
    it('MODEL_DEFAULTS.AGENT_MODEL is opus4.7', () => {
      expect(MODEL_DEFAULTS.AGENT_MODEL).toBe('opus4.7');
    });

    it('MODEL_DEFAULTS.UI_INITIAL_MODEL is opus4.7', () => {
      expect(MODEL_DEFAULTS.UI_INITIAL_MODEL).toBe('opus4.7');
    });

    it('MODEL_DEFAULTS.UI_MODEL_PREFERENCE has opus4.7 first', () => {
      expect(MODEL_DEFAULTS.UI_MODEL_PREFERENCE[0]).toBe('opus4.7');
    });

    it('deprecated DEFAULT_AGENT_MODEL alias is opus4.7', () => {
      expect(DEFAULT_AGENT_MODEL).toBe('opus4.7');
    });

    it('MODEL_IDS.GPT_5_4 is the canonical gpt5.4 string', () => {
      expect(MODEL_IDS.GPT_5_4).toBe('gpt5.4');
    });
  });

  describe('Auggie Provider Tier Regression (opus4.7)', () => {
    it('auggie smart tier resolves to opus4.7', () => {
      expect(getDefaultModelForProvider('auggie', 'smart')).toBe('opus4.7');
    });

    it('getDefaultModelForProvider(auggie, smart) returns opus4.7', () => {
      expect(getDefaultModelForProvider('auggie', 'smart')).toBe('opus4.7');
    });

    it('getModelTierFromModel(opus4.7) returns smart', () => {
      expect(getModelTierFromModel('opus4.7')).toBe('smart');
    });

    it('getModelTierFromModel(opus4.7, auggie) returns smart', () => {
      expect(getModelTierFromModel('opus4.7', 'auggie')).toBe('smart');
    });

    it('default provider is auggie', () => {
      expect(getDefaultProviderId()).toBe('auggie');
    });

    it('smart-tier specialists resolve to opus4.7 for auggie', () => {
      const smartSpecialists = SPECIALISTS.filter((s) => s.defaultModelTier === 'smart');
      expect(smartSpecialists.length).toBeGreaterThan(0);
      for (const s of smartSpecialists) {
        const resolved = getDefaultModelForProvider('auggie', s.defaultModelTier!);
        expect(resolved).toBe('opus4.7');
      }
    });

    it('non-auggie provider tiers are NOT opus4.7', () => {
      // Ensure the change is scoped to auggie only
      expect(getDefaultModelForProvider('claude-code', 'smart')).not.toBe('opus4.7');
    });
  });

  describe('GitHub-dependent Specialist Gating', () => {
    // These tests verify that pr-shepherd and pr-reviewer are hidden
    // when GitHub is not connected, using the backend specialists service.

    // Lazy-import so mocks are applied before the module loads
    let getAllEffectiveSpecialists: typeof import('../../src/features/agent/main/specialists.service').getAllEffectiveSpecialists;
    let initSpecialistsService: typeof import('../../src/features/agent/main/specialists.service').initSpecialistsService;
    let refreshGitHubAuthStatus: typeof import('../../src/features/agent/main/specialists.service').refreshGitHubAuthStatus;

    beforeAll(async () => {
      const mod = await import('../../src/features/agent/main/specialists.service');
      getAllEffectiveSpecialists = mod.getAllEffectiveSpecialists;
      initSpecialistsService = mod.initSpecialistsService;
      refreshGitHubAuthStatus = mod.refreshGitHubAuthStatus;
      await initSpecialistsService();
    });

    it('GITHUB_DEPENDENT_SPECIALIST_IDS contains pr-shepherd and pr-reviewer', () => {
      expect(GITHUB_DEPENDENT_SPECIALIST_IDS.has('pr-shepherd')).toBe(true);
      expect(GITHUB_DEPENDENT_SPECIALIST_IDS.has('pr-reviewer')).toBe(true);
    });

    it('should hide pr-shepherd and pr-reviewer when GitHub is not authenticated', async () => {
      mockIsAuthenticated.mockResolvedValue(false);
      await refreshGitHubAuthStatus();

      const specialists = getAllEffectiveSpecialists();
      const ids = specialists.map((s) => s.id);

      expect(ids).not.toContain('pr-shepherd');
      expect(ids).not.toContain('pr-reviewer');
      // Other specialists should still be present
      expect(ids).toContain('spec-writer');
      expect(ids).toContain('implementor');
      expect(ids).toContain('verifier');
    });

    it('should show pr-shepherd and pr-reviewer when GitHub is authenticated', async () => {
      mockIsAuthenticated.mockResolvedValue(true);
      await refreshGitHubAuthStatus();

      const specialists = getAllEffectiveSpecialists();
      const ids = specialists.map((s) => s.id);

      expect(ids).toContain('pr-shepherd');
      expect(ids).toContain('pr-reviewer');
    });

  });

  describe('getEffectiveSpecialist coding agent resolution', () => {
    // Tier→model resolution is daemon-owned: the main process passes the
    // frontmatter model/modelTier through verbatim ('' when no model).
    it('falls back to the caller coding agent for built-in specialists without an explicit codingAgent', () => {
      const resolved = getEffectiveSpecialist('implementor', 'codex');

      expect(resolved).not.toBeNull();
      expect(resolved?.codingAgent).toBe('codex');
      expect(resolved?.modelTier).toBe('smart');
      // No tier→model synthesis in the main process
      expect(resolved?.model).toBe('');
    });

    it('uses an explicit file specialist codingAgent when present', async () => {
      await writeSpecialistFile({
        id: 'file-specialist',
        name: 'File Specialist',
        description: 'File-backed specialist',
        codingAgent: 'codex',
        modelTier: 'fast',
        behaviorPrompt: 'Focus on file-backed work.',
      });
      await refreshSpecialistsFromFiles();

      const resolved = getEffectiveSpecialist('file-specialist', 'auggie');

      expect(resolved).not.toBeNull();
      expect(resolved?.codingAgent).toBe('codex');
      expect(resolved?.modelTier).toBe('fast');
      expect(resolved?.model).toBe('');
    });

    // Wave 2: Legacy custom specialists from electron-store are no longer resolved.
    // They should have been migrated to files on startup.
    it('does not resolve legacy custom specialists from electron-store (Wave 2)', () => {
      mockSettingsData['custom-specialists'] = [
        {
          id: 'legacy-custom',
          name: 'Legacy Custom',
          description: 'Legacy specialist from settings',
          model: 'sonnet4.5',
          behaviorPrompt: 'Legacy custom prompt',
        },
      ];

      const resolved = getEffectiveSpecialist('legacy-custom', 'codex');
      // Legacy custom specialists are no longer loaded from electron-store
      expect(resolved).toBeNull();
    });

    // Wave 2: Electron-store overrides are no longer applied.
    // Overrides are now file-based (user specialist files override bundled).
    it('does not apply electron-store overrides (Wave 2)', () => {
      mockSettingsData['specialists-overrides'] = {
        codingAgentOverrides: {
          implementor: 'codex',
        },
      };

      const resolved = getEffectiveSpecialist('implementor', 'auggie');

      expect(resolved).not.toBeNull();
      // Override from electron-store is no longer applied
      expect(resolved?.codingAgent).toBe('auggie');
      expect(resolved?.modelTier).toBe('smart');
      expect(resolved?.model).toBe('');
    });

    // Regression (monorepo#944): the explicit model in the file is passed
    // through verbatim, even when modelTier is also declared.
    it('keeps the explicit model when a file declares BOTH model and modelTier', async () => {
      const dir = await ensureSpecialistsDirectory();
      const content = [
        '---',
        'name: "Both Fields"',
        'description: "Declares both model and modelTier"',
        'codingAgent: "auggie"',
        'model: "sonnet4.5"',
        'modelTier: "smart"',
        '---',
        '',
        'Behavior prompt.',
      ].join('\n');
      await fs.writeFile(path.join(dir, 'both-fields.md'), content, 'utf-8');
      await refreshSpecialistsFromFiles();

      const resolved = getEffectiveSpecialist('both-fields', 'auggie');

      expect(resolved).not.toBeNull();
      expect(resolved?.model).toBe('sonnet4.5');
      // The declared tier is still surfaced on the output field
      expect(resolved?.modelTier).toBe('smart');
    });

    it('does NOT tier-resolve when a file declares only modelTier (daemon-owned)', async () => {
      await writeSpecialistFile({
        id: 'tier-only',
        name: 'Tier Only',
        description: 'Declares only modelTier',
        codingAgent: 'auggie',
        modelTier: 'fast',
        behaviorPrompt: 'Behavior prompt.',
      });
      await refreshSpecialistsFromFiles();

      const resolved = getEffectiveSpecialist('tier-only', 'auggie');

      expect(resolved).not.toBeNull();
      expect(resolved?.model).toBe('');
      expect(resolved?.modelTier).toBe('fast');
    });

    it('getAllEffectiveSpecialists keeps the explicit model when both fields are declared', async () => {
      const dir = await ensureSpecialistsDirectory();
      const content = [
        '---',
        'name: "Both Fields List"',
        'description: "Declares both model and modelTier"',
        'codingAgent: "auggie"',
        'model: "sonnet4.5"',
        'modelTier: "smart"',
        '---',
        '',
        'Behavior prompt.',
      ].join('\n');
      await fs.writeFile(path.join(dir, 'both-fields-list.md'), content, 'utf-8');
      await refreshSpecialistsFromFiles();

      const mod = await import('../../src/features/agent/main/specialists.service');
      const all = mod.getAllEffectiveSpecialists('auggie');
      const found = all.find((s) => s.id === 'both-fields-list');

      expect(found).toBeDefined();
      expect(found?.model).toBe('sonnet4.5');
      expect(found?.modelTier).toBe('smart');
    });

    it('resolves file-based specialist overrides correctly', async () => {
      // Write a user file that overrides the bundled implementor specialist
      await ensureSpecialistsDirectory();
      await writeSpecialistFile({
        id: 'implementor',
        name: 'Implementor',
        description: 'Custom override',
        codingAgent: 'codex',
        modelTier: 'smart',
        behaviorPrompt: 'Custom prompt.',
      });
      await refreshSpecialistsFromFiles();

      const resolved = getEffectiveSpecialist('implementor', 'auggie');

      expect(resolved).not.toBeNull();
      expect(resolved?.codingAgent).toBe('codex');
      expect(resolved?.modelTier).toBe('smart');
      expect(resolved?.model).toBe('');
    });
  });
});
