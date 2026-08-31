/**
 * Specialists Service Tests
 *
 * Focused on startup cache initialization and D1(B) coding-agent resolution.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SpecialistFilesResult } from '../../../shared/specialist-file-types';

const loadBundledSpecialistFiles = vi.fn<() => Promise<SpecialistFilesResult>>();
const loadSpecialistFiles = vi.fn<() => Promise<SpecialistFilesResult>>();
const loadProjectSpecialistFiles = vi.fn<() => Promise<SpecialistFilesResult>>();
const mockIsGitHubConfigured = vi.fn<() => Promise<boolean>>();

vi.mock('../../specialists/main/specialist-file-loader', () => ({
  loadBundledSpecialistFiles: (...args: unknown[]) => loadBundledSpecialistFiles(...(args as [])),
  loadSpecialistFiles: (...args: unknown[]) => loadSpecialistFiles(...(args as [])),
  loadProjectSpecialistFiles: (...args: unknown[]) => loadProjectSpecialistFiles(...(args as [])),
}));

vi.mock('../../../main/utils/github-auth-status', () => ({
  isGitHubConfigured: () => mockIsGitHubConfigured(),
}));

vi.mock('$shared/logger', () => ({
  Logger: class MockLogger {
    info = vi.fn();
    debug = vi.fn();
    warn = vi.fn();
    error = vi.fn();
  },
}));

const emptyResult: SpecialistFilesResult = { specialists: [], errors: [] };

describe('specialists.service — coding agent resolution (D1-B)', () => {
  beforeEach(async () => {
    vi.resetModules();
    loadBundledSpecialistFiles.mockReset().mockResolvedValue(emptyResult);
    loadSpecialistFiles.mockReset().mockResolvedValue(emptyResult);
    loadProjectSpecialistFiles.mockReset().mockResolvedValue(emptyResult);
    mockIsGitHubConfigured.mockReset().mockResolvedValue(false);
  });

  describe('startup initialization', () => {
    it('primes the file cache without waiting for GitHub authentication', async () => {
      loadBundledSpecialistFiles.mockResolvedValue({
        specialists: [
          {
            id: 'startup-specialist',
            filePath: '/bundled/startup-specialist.md',
            frontmatter: { name: 'Startup', description: 'ready' },
            behaviorPrompt: 'prompt',
            rawContent: '',
            source: 'bundled' as const,
          },
        ],
        errors: [],
      });

      const { getEffectiveSpecialist, initSpecialistsService } =
        await import('./specialists.service');
      await initSpecialistsService();

      expect(mockIsGitHubConfigured).not.toHaveBeenCalled();
      expect(getEffectiveSpecialist('startup-specialist')?.name).toBe('Startup');
    });

    it('keeps GitHub specialists hidden until the deferred refresh updates the cache', async () => {
      mockIsGitHubConfigured.mockResolvedValue(true);
      const { getAllEffectiveSpecialists, initSpecialistsService, refreshGitHubAuthStatus } =
        await import('./specialists.service');

      await initSpecialistsService();
      expect(getAllEffectiveSpecialists().map(({ id }) => id)).not.toContain('pr-reviewer');

      await refreshGitHubAuthStatus();

      expect(mockIsGitHubConfigured).toHaveBeenCalledOnce();
      const specialistIds = getAllEffectiveSpecialists().map(({ id }) => id);
      expect(specialistIds).toContain('pr-reviewer');
      expect(specialistIds).not.toContain('pr-shepherd');
    });
  });

  describe('hardcoded fallback specialists (no file override)', () => {
    it('uses the threaded fallback provider when the specialist has no explicit codingAgent', async () => {
      const { getEffectiveSpecialist } = await import('./specialists.service');
      const result = getEffectiveSpecialist('implementor', 'claude-code');
      expect(result?.codingAgent).toBe('claude-code');
    });

    it('lets Vulnerability Scanner inherit the threaded provider and daemon-resolved model', async () => {
      const { getEffectiveSpecialist } = await import('./specialists.service');
      const result = getEffectiveSpecialist('vulnerability-scanner', 'claude-code');

      expect(result).toMatchObject({ codingAgent: 'claude-code', model: '' });
    });

    it('never falls back to the hardcoded default provider (Auggie) when nothing is threaded', async () => {
      const { getEffectiveSpecialist } = await import('./specialists.service');
      const result = getEffectiveSpecialist('implementor');
      expect(result?.codingAgent).toBe('');
      expect(result?.codingAgent).not.toBe('auggie');
    });
  });

  describe('replacement mode (loaded set is authoritative)', () => {
    const replacementResult: SpecialistFilesResult = {
      specialists: [
        {
          id: 'replacement-one',
          filePath: '/bundled/replacement-one.md',
          frontmatter: { name: 'Replacement One', description: 'first' },
          behaviorPrompt: 'prompt one',
          rawContent: '',
          source: 'bundled' as const,
        },
        {
          id: 'replacement-two',
          filePath: '/bundled/replacement-two.md',
          frontmatter: { name: 'Replacement Two', description: 'second' },
          behaviorPrompt: 'prompt two',
          rawContent: '',
          source: 'bundled' as const,
        },
      ],
      errors: [],
    };

    it('does not resurrect hardcoded specialists once file specialists loaded', async () => {
      loadBundledSpecialistFiles.mockResolvedValue(replacementResult);
      const { refreshSpecialistsFromFiles, getAllEffectiveSpecialists, getEffectiveSpecialist } =
        await import('./specialists.service');
      await refreshSpecialistsFromFiles();

      const ids = getAllEffectiveSpecialists().map(({ id }) => id);
      expect(ids).toEqual(['replacement-one', 'replacement-two']);
      expect(getEffectiveSpecialist('implementor')).toBeNull();
      expect(getEffectiveSpecialist('verifier')).toBeNull();
    });

    it('formatSpecialistsForPrompt uses ids from the resolved list, not literal implementor/verifier', async () => {
      loadBundledSpecialistFiles.mockResolvedValue(replacementResult);
      const { refreshSpecialistsFromFiles, formatSpecialistsForPrompt } =
        await import('./specialists.service');
      await refreshSpecialistsFromFiles();

      const prompt = await formatSpecialistsForPrompt();
      expect(prompt).toContain('specialist: "replacement-one"');
      expect(prompt).toContain('specialist: "replacement-two"');
      expect(prompt).not.toContain('"implementor"');
      expect(prompt).not.toContain('"verifier"');
    });

    it('formatSpecialistsForPrompt prefers implementor/verifier when actually present', async () => {
      const { formatSpecialistsForPrompt } = await import('./specialists.service');
      const prompt = await formatSpecialistsForPrompt();
      expect(prompt).toContain('specialist: "implementor"');
      expect(prompt).toContain('specialist: "verifier"');
    });
  });

  describe('file-based specialists', () => {
    it('honors an explicit frontmatter codingAgent over the threaded fallback', async () => {
      loadBundledSpecialistFiles.mockResolvedValue({
        specialists: [
          {
            id: 'custom-spec',
            filePath: '/bundled/custom-spec.md',
            frontmatter: { name: 'Custom', description: 'd', codingAgent: 'codex' },
            behaviorPrompt: 'prompt',
            rawContent: '',
            source: 'bundled' as const,
          },
        ],
        errors: [],
      });

      const { refreshSpecialistsFromFiles, getEffectiveSpecialist } =
        await import('./specialists.service');
      await refreshSpecialistsFromFiles();

      const result = getEffectiveSpecialist('custom-spec', 'claude-code');
      expect(result?.codingAgent).toBe('codex');
    });

    it('falls back to the threaded provider when the file specialist has no explicit codingAgent', async () => {
      loadBundledSpecialistFiles.mockResolvedValue({
        specialists: [
          {
            id: 'custom-spec',
            filePath: '/bundled/custom-spec.md',
            frontmatter: { name: 'Custom', description: 'd' },
            behaviorPrompt: 'prompt',
            rawContent: '',
            source: 'bundled' as const,
          },
        ],
        errors: [],
      });

      const { refreshSpecialistsFromFiles, getEffectiveSpecialist } =
        await import('./specialists.service');
      await refreshSpecialistsFromFiles();

      expect(getEffectiveSpecialist('custom-spec', 'claude-code')?.codingAgent).toBe('claude-code');
      expect(getEffectiveSpecialist('custom-spec')?.codingAgent).toBe('');
    });
  });
});
