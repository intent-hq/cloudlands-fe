/**
 * Specialist Prompts Verification Tests
 *
 * These tests verify that specialist prompts contain required behavioral patterns.
 * They import actual prompts from the codebase, so tests automatically update
 * when the code changes - ensuring prompts don't accidentally break expected behavior.
 *
 * PURPOSE:
 * 1. Ensure specialist agents have proper behavioral constraints
 * 2. Verify delegation instructions are present and correct
 * 3. Catch accidental prompt regressions
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { SPECIALISTS, getSpecialistById } from '../../src/lib/constants/specialists';
import { common, taskBreakdown, workspace } from '../../src/features/agent/instructions';
import {
  formatSpecialistsForPrompt,
  initSpecialistsService,
} from '../../src/features/agent/main/specialists.service';

// Mock electron-store for initSpecialistsService
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

// Mock electron app for file paths
vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/test-augment',
    isPackaged: false,
  },
}));

vi.mock('../../src/features/github-auth/main/github-auth.service', () => ({
  githubAuthService: {
    isAuthenticated: vi.fn().mockResolvedValue(false),
  },
}));

describe('Specialist Prompts Verification', () => {
  // Initialize the specialists service to populate the file cache with bundled specialists
  beforeAll(async () => {
    await initSpecialistsService();
  });

  describe('Specialist Definitions', () => {
    it('should have exactly 9 specialists defined', () => {
      expect(SPECIALISTS).toHaveLength(9);
      expect(SPECIALISTS.map((s) => s.id)).toEqual([
        'spec-writer',
        'implementor',
        'verifier',
        'pr-reviewer',
        'pr-shepherd',
        'ui-designer',
        'developer',
        'chief-of-staff',
        'ralph',
      ]);
    });

    it('spec-writer should have coordinator behavior', () => {
      const specWriter = getSpecialistById('spec-writer');
      expect(specWriter).toBeDefined();
      expect(specWriter!.defaultBehaviorPrompt).toContain('Coordinator');
      expect(specWriter!.defaultBehaviorPrompt).toContain('delegate');
      expect(specWriter!.defaultBehaviorPrompt).toContain('do NOT implement code yourself');
    });

    it('implementor should be constrained to assigned tasks only', () => {
      const implementor = getSpecialistById('implementor');
      expect(implementor).toBeDefined();
      // Tests updated to match optimized specialists.ts content
      expect(implementor!.defaultBehaviorPrompt).toContain('assigned task');
      expect(implementor!.defaultBehaviorPrompt).toContain('nothing more');
      expect(implementor!.defaultBehaviorPrompt).toContain('No scope creep');
      expect(implementor!.defaultBehaviorPrompt).toContain('No refactors');
    });

    it('verifier should focus on thorough verification', () => {
      const verifier = getSpecialistById('verifier');
      expect(verifier).toBeDefined();
      // Tests updated to match current specialists.ts content
      expect(verifier!.defaultBehaviorPrompt).toContain('verify');
      expect(verifier!.defaultBehaviorPrompt).toContain('Acceptance Criteria');
      expect(verifier!.defaultBehaviorPrompt).toContain('VERIFIED');
    });

    it('should use appropriate model tiers for each specialist', () => {
      const specWriter = getSpecialistById('spec-writer');
      const implementor = getSpecialistById('implementor');
      const verifier = getSpecialistById('verifier');
      const prReviewer = getSpecialistById('pr-reviewer');
      const uiDesigner = getSpecialistById('ui-designer');

      // spec-writer needs high capability for planning
      expect(specWriter!.defaultModelTier).toBe('smart');

      // implementor uses smart model to match coordinator
      expect(implementor!.defaultModelTier).toBe('smart');

      // verifier needs high capability for thorough review
      expect(verifier!.defaultModelTier).toBe('smart');

      // pr-reviewer needs high capability for thorough review
      expect(prReviewer!.defaultModelTier).toBe('smart');

      // ui-designer uses smart model like other specialists
      expect(uiDesigner!.defaultModelTier).toBe('smart');
    });

    it('chief-of-staff should use the user default model and document app workflows', () => {
      const chief = getSpecialistById('chief-of-staff');
      expect(chief).toBeDefined();
      expect(chief!.defaultModelTier).toBeUndefined();
      expect(chief!.defaultModel).toBeUndefined();
      expect(chief!.defaultBehaviorPrompt).toContain('Chief of Staff');
      expect(chief!.defaultBehaviorPrompt).toContain('ws.app.workspaces.*');
      expect(chief!.defaultBehaviorPrompt).toContain('proposal cards');
      expect(chief!.defaultBehaviorPrompt).toContain('confirmation cards');
      expect(chief!.defaultBehaviorPrompt).toContain('NavLink');
    });
  });

  describe('Delegation Instructions in Prompts', () => {
    it('common instructions should contain delegation guidance', () => {
      expect(common).toContain('Before delegating');
      expect(common).toContain('list the tasks');
      expect(common).toContain('ws.agent.delegate');
      expect(common).toContain('Never use `ws.agent.create` for tasks that already have IDs');
    });

    it('common instructions should contain waitMode examples', () => {
      expect(common).toContain('waitMode: "after_all"');
    });

    // Note: implement instruction tests removed - implement.ts was deleted as unused
  });

  describe('Task Block and Delegation Patterns', () => {
    it('task breakdown should use task blocks, not checkbox lists', () => {
      expect(taskBreakdown).toContain('Do not use markdown checkbox lists');
      expect(taskBreakdown).toContain('task block');
    });

    it('workspace instructions should contain core workspace concepts', () => {
      // Tests updated to match current workspace.ts content
      expect(workspace).toContain('Space');
      expect(workspace).toContain('notes');
      expect(workspace).toContain('ws.agent.delegate');
      expect(workspace).toContain('ws.note.read');
    });
  });

  describe('formatSpecialistsForPrompt', () => {
    it('should format specialists table correctly', async () => {
      const formatted = await formatSpecialistsForPrompt();

      expect(formatted).toContain('## Agent Specialists');
      expect(formatted).toContain('Implementor');
      expect(formatted).toContain('Verifier');
      expect(formatted).toContain('implementor');
      expect(formatted).toContain('verifier');
      // All specialists should be included so agents know about them
      expect(formatted).toContain('Coordinator');
      expect(formatted).toContain('spec-writer');
    });

    it('should include usage examples', async () => {
      const formatted = await formatSpecialistsForPrompt();

      expect(formatted).toContain('ws.agent.delegate');
      expect(formatted).toContain('specialist:');
      expect(formatted).toContain('Examples');
    });
  });

  describe('Prompt Content Quality', () => {
    it('prompts should not have common typos or issues', () => {
      const allPrompts = SPECIALISTS.map((s) => s.defaultBehaviorPrompt).join('\n');

      // Check for common issues
      // Note: Double spaces are allowed in formatted prompts (after em-dashes, etc.)
      expect(allPrompts).not.toMatch(/\n{4,}/); // No excessive blank lines
    });

    it('each specialist prompt should be substantial', () => {
      for (const specialist of SPECIALISTS) {
        // Ralph gets its prompt via ralph-loop agentType instruction, not defaultBehaviorPrompt
        if (specialist.id === 'ralph') continue;
        expect(specialist.defaultBehaviorPrompt.length).toBeGreaterThan(100);
        expect(specialist.description.length).toBeGreaterThan(10);
        expect(specialist.name.length).toBeGreaterThan(3);
      }
    });
  });
});
