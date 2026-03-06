/**
 * Specialist Configuration Tests
 *
 * Tests for the specialist configuration resolution system.
 * Ensures specialists are correctly configured with models and behavior prompts.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SPECIALISTS,
  getSpecialistById,
  type Specialist,
} from '../../src/lib/constants/specialists';
import {
  MODEL_DEFAULTS,
  MODEL_IDS,
  DEFAULT_AGENT_MODEL,
} from '../../src/shared/constants/agent-services';
import {
  PROVIDER_MODEL_TIERS,
  getDefaultModelForProvider,
  getModelTierFromModel,
  getDefaultProviderId,
} from '../../src/shared/config/provider-config';

// Mock electron-store for getEffectiveSpecialist
vi.mock('electron-store', () => ({
  default: class MockStore {
    private data: Record<string, unknown> = {};
    get(key: string) {
      return this.data[key];
    }
    set(key: string, value: unknown) {
      this.data[key] = value;
    }
  },
}));

describe('Specialist Configuration', () => {
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
      expect(prompt).toContain('wait_mode="after_all"');

      // Workflow instructions
      expect(prompt).toContain('Workflow');
    });
  });

  describe('Specialist ID Validation', () => {
    it('all specialists have valid IDs matching type constraints', () => {
      const validIds = ['spec-writer', 'implementor', 'verifier', 'pr-reviewer', 'ui-designer', 'developer', 'pr-shepherd'];

      for (const specialist of SPECIALISTS) {
        expect(validIds).toContain(specialist.id);
      }
    });

    it('each specialist has required fields', () => {
      for (const specialist of SPECIALISTS) {
        expect(specialist.id).toBeDefined();
        expect(specialist.name).toBeDefined();
        expect(specialist.description).toBeDefined();
        // Specialists use either defaultModelTier (provider-aware) or defaultModel (hardcoded)
        expect(
          specialist.defaultModelTier || specialist.defaultModel,
          `Specialist ${specialist.id} must have either defaultModelTier or defaultModel`,
        ).toBeDefined();
        expect(specialist.defaultBehaviorPrompt).toBeDefined();
      }
    });
  });

  // ==========================================================================
  // Regression: Auggie default model is GPT-5.4
  // These tests lock in the gpt5.4 default so a revert to opus4.5/opus4.6
  // would be caught immediately.
  // ==========================================================================

  describe('Auggie Default Model Regression (gpt5.4)', () => {
    it('MODEL_DEFAULTS.AGENT_MODEL is gpt5.4', () => {
      expect(MODEL_DEFAULTS.AGENT_MODEL).toBe('gpt5.4');
    });

    it('MODEL_DEFAULTS.UI_INITIAL_MODEL is gpt5.4', () => {
      expect(MODEL_DEFAULTS.UI_INITIAL_MODEL).toBe('gpt5.4');
    });

    it('MODEL_DEFAULTS.UI_MODEL_PREFERENCE has gpt5.4 first', () => {
      expect(MODEL_DEFAULTS.UI_MODEL_PREFERENCE[0]).toBe('gpt5.4');
    });

    it('deprecated DEFAULT_AGENT_MODEL alias is gpt5.4', () => {
      expect(DEFAULT_AGENT_MODEL).toBe('gpt5.4');
    });

    it('MODEL_IDS.GPT_5_4 is the canonical gpt5.4 string', () => {
      expect(MODEL_IDS.GPT_5_4).toBe('gpt5.4');
    });
  });

  describe('Auggie Provider Tier Regression (gpt5.4)', () => {
    it('auggie smart tier resolves to gpt5.4', () => {
      expect(PROVIDER_MODEL_TIERS['auggie'].smart).toBe('gpt5.4');
    });

    it('getDefaultModelForProvider(auggie, smart) returns gpt5.4', () => {
      expect(getDefaultModelForProvider('auggie', 'smart')).toBe('gpt5.4');
    });

    it('getModelTierFromModel(gpt5.4) returns smart', () => {
      expect(getModelTierFromModel('gpt5.4')).toBe('smart');
    });

    it('getModelTierFromModel(gpt5.4, auggie) returns smart', () => {
      expect(getModelTierFromModel('gpt5.4', 'auggie')).toBe('smart');
    });

    it('default provider is auggie', () => {
      expect(getDefaultProviderId()).toBe('auggie');
    });

    it('smart-tier specialists resolve to gpt5.4 for auggie', () => {
      const smartSpecialists = SPECIALISTS.filter((s) => s.defaultModelTier === 'smart');
      expect(smartSpecialists.length).toBeGreaterThan(0);
      for (const s of smartSpecialists) {
        const resolved = getDefaultModelForProvider('auggie', s.defaultModelTier!);
        expect(resolved).toBe('gpt5.4');
      }
    });

    it('non-auggie provider tiers are NOT gpt5.4', () => {
      // Ensure the change is scoped to auggie only
      const claudeCode = PROVIDER_MODEL_TIERS['claude-code'];
      expect(claudeCode.smart).not.toBe('gpt5.4');
    });
  });
});
