/**
 * Prompt Pattern Tests
 *
 * Verifies that agent instruction files contain critical patterns for:
 * - Specialist delegation
 * - Wave execution
 * - Proper tool usage
 *
 * These tests ensure prompts don't drift from expected behavior.
 * They use the actual instruction files from the codebase.
 */

import { describe, it, expect } from 'vitest';
import common from '../instructions/common';
import workspace from '../instructions/workspace';
import taskFocused from '../instructions/task-focused';
import { SPECIALISTS } from '$lib/constants/specialists';

describe('Agent Instruction Patterns', () => {
  // Note: The new-workspace instruction was removed. Orchestrator behavior is now
  // defined in SPECIALISTS[spec-writer].defaultBehaviorPrompt
  describe('spec-writer specialist behavior (coordinator role)', () => {
    const specWriter = SPECIALISTS.find((s) => s.id === 'spec-writer');
    const coordinatorPrompt = specWriter?.defaultBehaviorPrompt || '';

    it('should contain coordinator role definition', () => {
      expect(coordinatorPrompt).toContain('Coordinator');
    });

    it('should document delegate_task pattern', () => {
      expect(coordinatorPrompt).toContain('delegate_task');
    });

    it('should mention specialist types (verifier)', () => {
      expect(coordinatorPrompt).toContain('verifier');
    });

    it('should document wait_mode options', () => {
      expect(coordinatorPrompt).toContain('wait_mode');
      expect(coordinatorPrompt).toContain('after_all');
    });

    it('should document wave-based execution pattern', () => {
      expect(coordinatorPrompt).toMatch(/wave/i);
    });

    it('should emphasize not implementing code directly', () => {
      expect(coordinatorPrompt).toContain('do NOT implement code yourself');
    });
  });

  describe('common instruction', () => {
    it('should document delegation tools', () => {
      expect(common).toContain('delegate_task');
      expect(common).toContain('create_agent');
    });

    it('should explain wait_mode options', () => {
      expect(common).toContain('wait_mode="after_all"');
    });

    it('should document parallel delegation example', () => {
      expect(common).toContain('parallel delegation');
    });
  });

  describe('workspace instruction', () => {
    it('should be defined', () => {
      expect(workspace).toBeDefined();
      expect(workspace.length).toBeGreaterThan(100);
    });
  });

  describe('task-focused instruction', () => {
    it('should focus on specific task execution', () => {
      expect(taskFocused).toBeDefined();
    });

    it('should update task note with progress', () => {
      expect(taskFocused).toContain('update');
    });
  });

  describe('specialist prompts (from SPECIALISTS constant)', () => {
    it('should define spec-writer specialist', () => {
      const specWriter = SPECIALISTS.find((s) => s.id === 'spec-writer');
      expect(specWriter).toBeDefined();
      expect(specWriter?.defaultModelTier).toBe('smart');
      expect(specWriter?.defaultBehaviorPrompt).toContain('Coordinator');
    });

    it('should define implementor specialist', () => {
      const implementor = SPECIALISTS.find((s) => s.id === 'implementor');
      expect(implementor).toBeDefined();
      expect(implementor?.defaultModelTier).toBe('smart');
      expect(implementor?.defaultBehaviorPrompt).toContain('Implementor');
    });

    it('should define verifier specialist', () => {
      const verifier = SPECIALISTS.find((s) => s.id === 'verifier');
      expect(verifier).toBeDefined();
      expect(verifier?.defaultModelTier).toBe('smart');
      // Verifier prompt says "Verifier" and "Verification Process"
      expect(verifier?.defaultBehaviorPrompt).toContain('Verifier');
      expect(verifier?.defaultBehaviorPrompt).toContain('Verification');
    });

    it('implementor prompt should focus on execution', () => {
      const implementor = SPECIALISTS.find((s) => s.id === 'implementor');
      expect(implementor?.defaultBehaviorPrompt).toMatch(/execute|implement|task|specific/i);
    });

    it('verifier prompt should focus on review', () => {
      const verifier = SPECIALISTS.find((s) => s.id === 'verifier');
      expect(verifier?.defaultBehaviorPrompt).toMatch(/verify|review|check|thorough/i);
    });

    it('spec-writer prompt should focus on planning', () => {
      const specWriter = SPECIALISTS.find((s) => s.id === 'spec-writer');
      expect(specWriter?.defaultBehaviorPrompt).toMatch(/plan|coordinate|delegate|wave/i);
    });
  });
});

describe('Prompt Consistency', () => {
  describe('delegation documentation alignment', () => {
    it('spec-writer and common should use same wait_mode syntax', () => {
      const specWriter = SPECIALISTS.find((s) => s.id === 'spec-writer');
      // Both should use wait_mode="after_all" syntax
      expect(specWriter?.defaultBehaviorPrompt).toContain('wait_mode="after_all"');
      expect(common).toContain('wait_mode="after_all"');
    });

    it('spec-writer should mention verifier delegation', () => {
      const specWriter = SPECIALISTS.find((s) => s.id === 'spec-writer');
      // Should mention delegating to the verifier
      expect(specWriter?.defaultBehaviorPrompt).toMatch(/delegate.*verifier/i);
    });
  });
});
