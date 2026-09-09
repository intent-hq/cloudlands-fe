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
import { m } from '$shared/paraglide/messages.js';
import { overwriteGetLocale } from '$shared/paraglide/runtime.js';
import {
  chooseDefaultSetupScript,
  fetchGitHubRepoConfigSetupScript,
  fetchRepoConfigSetupScript,
  parseRepoConfigSetupScript,
  resolveSetupScriptParam,
  setupScriptDisplayName,
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
    expect(choice).toEqual({
      content: 'echo repo-config',
      name: REPO_CONFIG_SCRIPT_NAME,
      source: 'repo-config',
    });
  });

  it('falls back to the last-used script when no repo config script exists', () => {
    const choice = chooseDefaultSetupScript({
      repoConfigScript: null,
      lastUsed,
      genericTemplate,
    });
    expect(choice).toEqual({
      content: 'echo last-used',
      name: 'My saved script',
      source: 'named',
    });
  });

  it('falls back to the generic template when neither exists', () => {
    const choice = chooseDefaultSetupScript({
      repoConfigScript: null,
      lastUsed: undefined,
      genericTemplate,
    });
    expect(choice).toEqual({
      content: 'echo template',
      name: 'Copy config files only',
      source: 'named',
    });
  });

  it('falls back to empty custom when nothing is available', () => {
    const choice = chooseDefaultSetupScript({
      repoConfigScript: null,
      lastUsed: undefined,
      genericTemplate: undefined,
    });
    expect(choice).toEqual({ content: '', name: 'Custom', source: 'custom' });
  });

  it('tags a last-used script named like a sentinel as named, not a sentinel source', () => {
    const choice = chooseDefaultSetupScript({
      repoConfigScript: null,
      lastUsed: { name: 'Custom', content: 'echo saved' },
      genericTemplate,
    });
    expect(choice).toEqual({ content: 'echo saved', name: 'Custom', source: 'named' });
  });

  it('honors the persisted nameSource of a last-used entry', () => {
    // An edited repo-config script recorded as last-used keeps its sentinel
    // identity, so its restore renders localized.
    const choice = chooseDefaultSetupScript({
      repoConfigScript: null,
      lastUsed: {
        name: REPO_CONFIG_SCRIPT_NAME,
        content: 'echo edited',
        nameSource: 'repo-config',
      },
      genericTemplate,
    });
    expect(choice).toEqual({
      content: 'echo edited',
      name: REPO_CONFIG_SCRIPT_NAME,
      source: 'repo-config',
    });
  });
});

describe('resolveSetupScriptParam (monorepo#1862)', () => {
  const base = {
    setupScript: 'echo default',
    setupScriptName: 'Copy config files only',
    repoPath: '/repo/a',
    repoConfigScript: null as string | null,
    repoConfigScriptRepo: null as string | null,
  };

  it('sends the shown script (trimmed), touched or not', () => {
    expect(resolveSetupScriptParam(base)).toBe('echo default');
    expect(resolveSetupScriptParam({ ...base, setupScript: 'echo edited\n' })).toBe('echo edited');
  });

  it('omits an empty/blank script', () => {
    expect(resolveSetupScriptParam({ ...base, setupScript: '  \n ' })).toBeUndefined();
    expect(resolveSetupScriptParam({ ...base, setupScript: '' })).toBeUndefined();
  });

  it('omits the unedited repo-config script', () => {
    expect(
      resolveSetupScriptParam({
        ...base,
        setupScript: 'echo repo-config\n',
        setupScriptName: REPO_CONFIG_SCRIPT_NAME,
        repoConfigScript: 'echo repo-config',
        repoConfigScriptRepo: '/repo/a',
      }),
    ).toBeUndefined();
  });

  it('sends an edited repo-config script', () => {
    expect(
      resolveSetupScriptParam({
        ...base,
        setupScript: 'echo repo-config && echo edited',
        setupScriptName: REPO_CONFIG_SCRIPT_NAME,
        repoConfigScript: 'echo repo-config',
        repoConfigScriptRepo: '/repo/a',
      }),
    ).toBe('echo repo-config && echo edited');
  });

  it("does not treat another repo's cached config script as the repo-config default", () => {
    // Same content but cached for a different repo — the "unedited repo
    // config" carve-out does not apply, so the script is sent.
    expect(
      resolveSetupScriptParam({
        ...base,
        setupScript: 'echo repo-config',
        setupScriptName: REPO_CONFIG_SCRIPT_NAME,
        repoConfigScript: 'echo repo-config',
        repoConfigScriptRepo: '/repo/b',
      }),
    ).toBe('echo repo-config');
  });
});

describe('setupScriptDisplayName', () => {
  afterEach(() => overwriteGetLocale(() => 'en'));

  it('maps the repo-config source to the localized label', () => {
    overwriteGetLocale(() => 'fr');
    expect(setupScriptDisplayName(REPO_CONFIG_SCRIPT_NAME, 'repo-config')).toBe(
      m.workspace_setupScriptEditor_fromRepoConfig_name(),
    );
    expect(setupScriptDisplayName(REPO_CONFIG_SCRIPT_NAME, 'repo-config')).not.toBe(
      REPO_CONFIG_SCRIPT_NAME,
    );
  });

  it('maps the custom source to the localized label', () => {
    overwriteGetLocale(() => 'de');
    expect(setupScriptDisplayName('Custom', 'custom')).toBe(
      m.workspace_setupScriptEditor_custom_name(),
    );
    expect(setupScriptDisplayName('Custom', 'custom')).not.toBe('Custom');
  });

  it('renders the English labels in the base locale', () => {
    overwriteGetLocale(() => 'en');
    expect(setupScriptDisplayName(REPO_CONFIG_SCRIPT_NAME, 'repo-config')).toBe('From repo config');
    expect(setupScriptDisplayName('Custom', 'custom')).toBe('Custom');
  });

  it('passes through named scripts unchanged', () => {
    overwriteGetLocale(() => 'ja');
    expect(setupScriptDisplayName('My saved script', 'named')).toBe('My saved script');
    expect(setupScriptDisplayName('Copy config files only', 'named')).toBe(
      'Copy config files only',
    );
  });

  it('keeps a saved script literally named like a sentinel un-localized', () => {
    overwriteGetLocale(() => 'fr');
    // A user-saved script named "Custom" or "From repo config" is a named
    // script — its name must pass through, never be relabeled as a sentinel.
    expect(setupScriptDisplayName('Custom', 'named')).toBe('Custom');
    expect(setupScriptDisplayName(REPO_CONFIG_SCRIPT_NAME, 'named')).toBe(REPO_CONFIG_SCRIPT_NAME);
  });
});
