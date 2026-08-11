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

    it('never falls back to the hardcoded default provider (Auggie) when nothing is threaded', async () => {
      const { getEffectiveSpecialist } = await import('./specialists.service');
      const result = getEffectiveSpecialist('implementor');
      expect(result?.codingAgent).toBe('');
      expect(result?.codingAgent).not.toBe('auggie');
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
