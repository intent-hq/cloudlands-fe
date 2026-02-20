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

    it('ui-designer uses fast tier for quick iteration', () => {
      const specialist = getSpecialistById('ui-designer');
      expect(specialist!.defaultModelTier).toBe('fast');
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
});
