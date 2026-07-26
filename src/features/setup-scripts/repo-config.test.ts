/**
 * Tests for the repo-committed setup script helpers: the tolerant
 * `.intent/config.json` parse (mirrors intentd's `read_repo_config`), the
 * IPC-backed fetch, and the initializer's default-selection priority
 * (repo config > last-used > generic template).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/electron-bridge', () => ({
  invoke: vi.fn(),
}));

const githubRepoConfig = vi.hoisted(() => vi.fn());
vi.mock('$lib/client', () => ({
  appClient: { integrations: { githubRepoConfig } },
}));

import { invoke } from '$lib/electron-bridge';
import {
  chooseDefaultSetupScript,
  fetchGitHubRepoConfigSetupScript,
  fetchRepoConfigSetupScript,
  parseRepoConfigSetupScript,
  toRepoConfigSubset,
  REPO_CONFIG_SCRIPT_NAME,
} from './repo-config';
import { IPC_CHANNELS } from '$shared/ipc-registry';

const mockedInvoke = vi.mocked(invoke);

afterEach(() => vi.clearAllMocks());

describe('parseRepoConfigSetupScript', () => {
  it('returns the setupScript from a valid config object', () => {
    const raw = JSON.stringify({ setupScript: 'npm ci', branchPrefix: 'feat' });
    expect(parseRepoConfigSetupScript(raw)).toBe('npm ci');
  });

  it('returns null for invalid JSON', () => {
    expect(parseRepoConfigSetupScript('{ not json')).toBeNull();
  });

  it.each([
    ['array root', '["setupScript"]'],
    ['string root', '"setupScript"'],
    ['number root', '42'],
    ['null root', 'null'],
  ])('returns null for a non-object root (%s)', (_label, raw) => {
    expect(parseRepoConfigSetupScript(raw)).toBeNull();
  });

  it('returns null when setupScript is missing', () => {
    expect(parseRepoConfigSetupScript(JSON.stringify({ branchPrefix: 'x' }))).toBeNull();
  });

  it('returns null when setupScript is blank or not a string', () => {
    expect(parseRepoConfigSetupScript(JSON.stringify({ setupScript: '   ' }))).toBeNull();
    expect(parseRepoConfigSetupScript(JSON.stringify({ setupScript: 7 }))).toBeNull();
    expect(parseRepoConfigSetupScript(JSON.stringify({ setupScript: null }))).toBeNull();
  });
});

describe('toRepoConfigSubset', () => {
  it('extracts a valid setupScript from a config object', () => {
    expect(toRepoConfigSubset({ setupScript: 'npm ci', other: 1 })).toEqual({
      setupScript: 'npm ci',
    });
  });

  it.each([
    ['null', null],
    ['array', ['setupScript']],
    ['string', 'setupScript'],
    ['number', 42],
  ])('folds a non-object config (%s) to a null setupScript', (_label, config) => {
    expect(toRepoConfigSubset(config)).toEqual({ setupScript: null });
  });

  it('folds a missing, blank, or non-string setupScript to null', () => {
    expect(toRepoConfigSubset({})).toEqual({ setupScript: null });
    expect(toRepoConfigSubset({ setupScript: '   ' })).toEqual({ setupScript: null });
    expect(toRepoConfigSubset({ setupScript: 7 })).toEqual({ setupScript: null });
  });
});

describe('fetchRepoConfigSetupScript', () => {
  it('invokes setup-scripts:read-repo-config and parses the content', async () => {
    mockedInvoke.mockResolvedValueOnce({
      success: true,
      data: { content: JSON.stringify({ setupScript: 'pnpm install' }) },
    });

    const script = await fetchRepoConfigSetupScript('/repo');

    expect(mockedInvoke).toHaveBeenCalledWith(IPC_CHANNELS.SETUP_SCRIPTS.READ_REPO_CONFIG, {
      repoPath: '/repo',
    });
    expect(script).toBe('pnpm install');
  });

  it('resolves null when no config file exists (content null)', async () => {
    mockedInvoke.mockResolvedValueOnce({ success: true, data: { content: null } });
    expect(await fetchRepoConfigSetupScript('/repo')).toBeNull();
  });

  it('resolves null for invalid JSON content', async () => {
    mockedInvoke.mockResolvedValueOnce({ success: true, data: { content: '{ nope' } });
    expect(await fetchRepoConfigSetupScript('/repo')).toBeNull();
  });

  it('resolves null on a failure envelope', async () => {
    mockedInvoke.mockResolvedValueOnce({ success: false, error: 'boom' });
    expect(await fetchRepoConfigSetupScript('/repo')).toBeNull();
  });

  it('resolves null when the invoke rejects (never throws)', async () => {
    mockedInvoke.mockRejectedValueOnce(new Error('transport down'));
    await expect(fetchRepoConfigSetupScript('/repo')).resolves.toBeNull();
  });

  it('resolves null without invoking for an empty repoPath', async () => {
    expect(await fetchRepoConfigSetupScript('')).toBeNull();
    expect(mockedInvoke).not.toHaveBeenCalled();
  });
});

describe('fetchGitHubRepoConfigSetupScript', () => {
  it('reads the setupScript through appClient.integrations.githubRepoConfig', async () => {
    githubRepoConfig.mockResolvedValueOnce({
      config: { setupScript: 'pnpm install' },
      exists: true,
    });

    const script = await fetchGitHubRepoConfigSetupScript('octo', 'intent');

    expect(githubRepoConfig).toHaveBeenCalledWith('octo', 'intent', undefined);
    expect(script).toBe('pnpm install');
  });

  it('forwards the ref when provided', async () => {
    githubRepoConfig.mockResolvedValueOnce({ config: null, exists: false });

    await fetchGitHubRepoConfigSetupScript('octo', 'intent', 'release-1.x');

    expect(githubRepoConfig).toHaveBeenCalledWith('octo', 'intent', 'release-1.x');
  });

  it('resolves null when the file is missing (config null)', async () => {
    githubRepoConfig.mockResolvedValueOnce({ config: null, exists: false });
    expect(await fetchGitHubRepoConfigSetupScript('octo', 'intent')).toBeNull();
  });

  it('resolves null for a config without a usable setupScript', async () => {
    githubRepoConfig.mockResolvedValueOnce({ config: {}, exists: true });
    expect(await fetchGitHubRepoConfigSetupScript('octo', 'intent')).toBeNull();

    githubRepoConfig.mockResolvedValueOnce({ config: { setupScript: '   ' }, exists: true });
    expect(await fetchGitHubRepoConfigSetupScript('octo', 'intent')).toBeNull();

    githubRepoConfig.mockResolvedValueOnce({ config: { setupScript: 7 }, exists: true });
    expect(await fetchGitHubRepoConfigSetupScript('octo', 'intent')).toBeNull();
  });

  it('resolves null when the RPC rejects (never throws)', async () => {
    githubRepoConfig.mockRejectedValueOnce(new Error('GitHub is not configured.'));
    await expect(fetchGitHubRepoConfigSetupScript('octo', 'intent')).resolves.toBeNull();
  });

  it('resolves null without calling the daemon for missing owner/repo', async () => {
    expect(await fetchGitHubRepoConfigSetupScript('', 'intent')).toBeNull();
    expect(await fetchGitHubRepoConfigSetupScript('octo', '')).toBeNull();
    expect(githubRepoConfig).not.toHaveBeenCalled();
  });
});

describe('chooseDefaultSetupScript', () => {
  const lastUsed = { name: 'My saved script', content: 'echo last-used' };
  const genericTemplate = { name: 'Copy config files only', content: 'echo template' };

  it('prefers the repo config script over last-used and template', () => {
    const choice = chooseDefaultSetupScript({
      repoConfigScript: 'echo repo-config',
      lastUsed,
      genericTemplate,
    });
    expect(choice).toEqual({ content: 'echo repo-config', name: REPO_CONFIG_SCRIPT_NAME });
  });

  it('falls back to the last-used script when no repo config script exists', () => {
    const choice = chooseDefaultSetupScript({
      repoConfigScript: null,
      lastUsed,
      genericTemplate,
    });
    expect(choice).toEqual({ content: 'echo last-used', name: 'My saved script' });
  });

  it('falls back to the generic template when neither exists', () => {
    const choice = chooseDefaultSetupScript({
      repoConfigScript: null,
      lastUsed: undefined,
      genericTemplate,
    });
    expect(choice).toEqual({ content: 'echo template', name: 'Copy config files only' });
  });

  it('falls back to empty custom when nothing is available', () => {
    const choice = chooseDefaultSetupScript({
      repoConfigScript: null,
      lastUsed: undefined,
      genericTemplate: undefined,
    });
    expect(choice).toEqual({ content: '', name: 'Custom' });
  });
});
