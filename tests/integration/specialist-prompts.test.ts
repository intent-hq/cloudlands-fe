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

describe('Specialist Prompts Verification', () => {
  // Initialize the specialists service to populate the file cache with bundled specialists
  beforeAll(async () => {
    await initSpecialistsService();
  });

  describe('Specialist Definitions', () => {
    it('should have exactly 8 specialists defined', () => {
      expect(SPECIALISTS).toHaveLength(8);
      expect(SPECIALISTS.map((s) => s.id)).toEqual([
        'spec-writer',
        'implementor',
        'verifier',
        'pr-reviewer',
        'ui-designer',
        'vulnerability-scanner',
        'developer',
        'chief-of-staff',
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

    it('should not pin a model on any built-in specialist', () => {
      // Absent defaultModel means inherit the global default.
      const specWriter = getSpecialistById('spec-writer');
      const implementor = getSpecialistById('implementor');
      const verifier = getSpecialistById('verifier');
      const prReviewer = getSpecialistById('pr-reviewer');
      const uiDesigner = getSpecialistById('ui-designer');

      expect(specWriter!.defaultModel).toBeUndefined();
      expect(implementor!.defaultModel).toBeUndefined();
      expect(verifier!.defaultModel).toBeUndefined();
      expect(prReviewer!.defaultModel).toBeUndefined();
      expect(uiDesigner!.defaultModel).toBeUndefined();
    });

    it('chief-of-staff should use the user default model and document app workflows', () => {
      const chief = getSpecialistById('chief-of-staff');
      expect(chief).toBeDefined();
      expect(chief!.defaultModel).toBeUndefined();
      expect(chief!.defaultBehaviorPrompt).toContain('Chief of Staff');
      expect(chief!.defaultBehaviorPrompt).toContain('ws.app.workspaces.*');
      expect(chief!.defaultBehaviorPrompt).toContain('proposal cards');
      expect(chief!.defaultBehaviorPrompt).toContain('confirmation cards');
      expect(chief!.defaultBehaviorPrompt).toContain('NavLink');
    });

    it('chief-of-staff should document positional completion-only messaging', () => {
      const prompt = getSpecialistById('chief-of-staff')!.defaultBehaviorPrompt;

      expect(prompt).toContain('ws.app.agents.send(agentId, message, priority?)');
      expect(prompt).toContain('ws.app.agents.ask(agentId, message, priority?)');
      expect(prompt).toContain('one wake only when the target completes');
      expect(prompt).toContain('readConversation(asked.send.workspaceId, asked.send.agentId');
      expect(prompt).toContain(
        'const finalAssistant = [...conversation.messages].reverse().find((message) => message.role === "assistant" && typeof message.id === "string" && message.id.length > 0)',
      );
      expect(prompt).toContain(
        '[${conversation.workspaceTitle}](intent://local/${conversation.workspaceId}/agent/${conversation.agentId}/message/${finalAssistant.id})',
      );
      expect(prompt).toContain('Build this URL only from the `readConversation` result');
      expect(prompt).toContain('Use `conversation.workspaceTitle` as the visible link label');
      expect(prompt).toContain(
        'Never use `asked.send.workspaceId`, `asked.send.agentId`, `asked.send.messageId`',
      );
      expect(prompt).toContain('a `chief_message` source ID');
      expect(prompt).toContain('a user-role message ID');
      expect(prompt).toContain(
        'Never expose a raw workspace ID or agent ID in relay prose or link text',
      );
      expect(prompt).not.toContain(
        'Resolve the live workspace title with `ws.app.workspaces.list({ filter: {}, sort: {} })`',
      );
      expect(prompt).not.toContain('"/agent/" + asked.send.agentId');
      expect(prompt).not.toContain('ws.app.agents.send({ agentId, message, priority? })');
      expect(prompt).not.toContain('ws.app.agents.ask({ agentId, message, priority? })');
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
      expect(formatted).toContain(
        '| **Vulnerability Scanner** | `vulnerability-scanner` | Finds real, exploitable security vulnerabilities in code |',
      );
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
        expect(specialist.defaultBehaviorPrompt.length).toBeGreaterThan(100);
        expect(specialist.description.length).toBeGreaterThan(10);
        expect(specialist.name.length).toBeGreaterThan(3);
      }
    });
  });
});
