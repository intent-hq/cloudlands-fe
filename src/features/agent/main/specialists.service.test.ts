/**
 * Specialists Service Tests
 *
 * Focused on D1(B) coding-agent resolution: `resolveSpecialistCodingAgent`
 * (via the exported `getEffectiveSpecialist` / `resolveSpecialistForAgent`)
 * must never fall back to the hardcoded default provider
 * (`getDefaultProviderId()` = Auggie) when no explicit/fallback coding agent
 * is available.
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  vi,
} from 'vitest';
import type { SpecialistFilesResult } from '../../../shared/specialist-file-types';

const loadBundledSpecialistFiles = vi.fn<() => Promise<SpecialistFilesResult>>();
const loadSpecialistFiles = vi.fn<() => Promise<SpecialistFilesResult>>();
const loadProjectSpecialistFiles = vi.fn<() => Promise<SpecialistFilesResult>>();

vi.mock('../../specialists/main/specialist-file-loader', () => ({
  loadBundledSpecialistFiles: (...args: unknown[]) => loadBundledSpecialistFiles(...(args as [])),
  loadSpecialistFiles: (...args: unknown[]) => loadSpecialistFiles(...(args as [])),
  loadProjectSpecialistFiles: (...args: unknown[]) => loadProjectSpecialistFiles(...(args as [])),
}));

vi.mock('../../../main/utils/github-auth-status', () => ({
  isGitHubConfigured: vi.fn().mockResolvedValue(false),
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

      const { refreshSpecialistsFromFiles, getEffectiveSpecialist } = await import(
        './specialists.service'
      );
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

      const { refreshSpecialistsFromFiles, getEffectiveSpecialist } = await import(
        './specialists.service'
      );
      await refreshSpecialistsFromFiles();

      expect(getEffectiveSpecialist('custom-spec', 'claude-code')?.codingAgent).toBe(
        'claude-code',
      );
      expect(getEffectiveSpecialist('custom-spec')?.codingAgent).toBe('');
    });
  });
});
