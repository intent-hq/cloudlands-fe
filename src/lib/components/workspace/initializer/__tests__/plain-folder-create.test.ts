import { describe, expect, it, vi } from 'vitest';
import { parseProtocolVersion } from '$shared/protocol-version';
import type { ContextLink } from '$shared/types';
import {
  INITIALIZE_GIT_CHOICE_STORAGE_KEY,
  buildPlainFolderCreateRequest,
  hasGitWorkspace,
  newProjectDefaultParent,
  readRememberedInitializeGit,
  resolveInitializeGitDefault,
  supportsPlainFolderCreate,
  workspacesUsingFolder,
  writeRememberedInitializeGit,
  type InitializeGitDefaultInput,
} from '../plain-folder-create';

const loadedNoForge: InitializeGitDefaultInput = {
  rememberedChoice: null,
  workspacesLoaded: true,
  hasGitWorkspace: false,
  githubConnected: false,
  githubSettled: true,
  gitlabConnected: false,
  gitlabSettled: true,
};

describe('resolveInitializeGitDefault', () => {
  it('defaults off for a fresh install with no forge and no git workspaces', () => {
    expect(resolveInitializeGitDefault(loadedNoForge)).toBe(false);
  });

  it.each([
    ['GitHub (incl. a gh-only daemon login)', { githubConnected: true }],
    ['GitLab', { gitlabConnected: true }],
    ['an existing git workspace', { hasGitWorkspace: true }],
  ])('defaults on with %s', (_label, overrides) => {
    expect(resolveInitializeGitDefault({ ...loadedNoForge, ...overrides })).toBe(true);
  });

  it('decides on as soon as a forge is known connected, before everything loads', () => {
    expect(
      resolveInitializeGitDefault({
        ...loadedNoForge,
        githubConnected: true,
        gitlabSettled: false,
        workspacesLoaded: false,
      }),
    ).toBe(true);
  });

  it.each([
    ['GitHub status', { githubSettled: false }],
    ['GitLab status', { gitlabSettled: false }],
    ['workspace list', { workspacesLoaded: false }],
  ])('stays undecided while the %s has not loaded', (_label, overrides) => {
    expect(resolveInitializeGitDefault({ ...loadedNoForge, ...overrides })).toBeNull();
  });

  it.each([true, false])('uses the remembered choice (%s) over every other rule', (choice) => {
    expect(
      resolveInitializeGitDefault({
        ...loadedNoForge,
        rememberedChoice: choice,
        githubConnected: !choice,
        hasGitWorkspace: !choice,
        githubSettled: false,
      }),
    ).toBe(choice);
  });
});

describe('remembered choice storage', () => {
  it('round-trips the last explicit choice', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    };
    expect(readRememberedInitializeGit(storage)).toBeNull();
    writeRememberedInitializeGit(storage, false);
    expect(values.get(INITIALIZE_GIT_CHOICE_STORAGE_KEY)).toBe('false');
    expect(readRememberedInitializeGit(storage)).toBe(false);
    writeRememberedInitializeGit(storage, true);
    expect(readRememberedInitializeGit(storage)).toBe(true);
  });

  it('treats unknown values and storage failures as no choice', () => {
    expect(readRememberedInitializeGit({ getItem: () => 'yes' })).toBeNull();
    expect(
      readRememberedInitializeGit({
        getItem: () => {
          throw new Error('denied');
        },
      }),
    ).toBeNull();
    expect(() =>
      writeRememberedInitializeGit(
        {
          setItem: vi.fn(() => {
            throw new Error('quota');
          }),
        },
        true,
      ),
    ).not.toThrow();
    expect(readRememberedInitializeGit(null)).toBeNull();
  });
});

describe('hasGitWorkspace', () => {
  it('counts every workspace that is not a plain folder', () => {
    expect(hasGitWorkspace([])).toBe(false);
    expect(hasGitWorkspace([{ plainFolder: true }])).toBe(false);
    expect(hasGitWorkspace([{ plainFolder: true }, {}])).toBe(true);
    expect(hasGitWorkspace([{ plainFolder: false }])).toBe(true);
  });
});

describe('supportsPlainFolderCreate', () => {
  it.each([
    ['15.3', true],
    ['15.10', true],
    ['16.0', true],
    ['15.2', false],
    ['14.9', false],
  ])('protocol %s → %s', (version, expected) => {
    expect(supportsPlainFolderCreate(parseProtocolVersion(version))).toBe(expected);
  });

  it('is false for an unknown protocol version', () => {
    expect(supportsPlainFolderCreate(null)).toBe(false);
    expect(supportsPlainFolderCreate(undefined)).toBe(false);
  });
});

describe('newProjectDefaultParent', () => {
  it('keeps a saved parent and otherwise picks the mode fallback', () => {
    expect(newProjectDefaultParent('/work', true)).toBe('/work');
    expect(newProjectDefaultParent(null, true)).toBe('~/Documents');
    expect(newProjectDefaultParent('', false)).toBe('~/Developer');
    // The store default is the git fallback, not a user choice.
    expect(newProjectDefaultParent('~/Developer', true)).toBe('~/Documents');
    expect(newProjectDefaultParent('~/Developer', false)).toBe('~/Developer');
  });
});

describe('workspacesUsingFolder', () => {
  it('matches repository, checkout or path ignoring trailing separators', () => {
    const rows = [
      { id: 'a', repositoryPath: '/Users/me/notes/' },
      { id: 'b', worktreePath: '/Users/me/notes' },
      { id: 'c', repositoryPath: '/Users/me/other' },
      { id: 'd', path: '/Users/me/notes' },
    ];
    expect(workspacesUsingFolder(rows, '/Users/me/notes').map((row) => row.id)).toEqual([
      'a',
      'b',
      'd',
    ]);
    expect(workspacesUsingFolder(rows, '')).toEqual([]);
  });
});

describe('buildPlainFolderCreateRequest', () => {
  const issue: ContextLink = {
    kind: 'issue',
    url: 'https://github.com/a/b/issues/1',
    owner: 'a',
    repo: 'b',
    number: 1,
  };
  const pr: ContextLink = {
    kind: 'pr',
    url: 'https://github.com/a/b/pull/2',
    owner: 'a',
    repo: 'b',
    number: 2,
  };

  it('sends only the plain-folder fields', () => {
    expect(
      buildPlainFolderCreateRequest({
        title: 'Notes',
        repositoryPath: '/Users/me/notes',
        initialAgent: { prompt: 'hi' },
      }),
    ).toEqual({
      title: 'Notes',
      repositoryPath: '/Users/me/notes',
      plainFolder: true,
      initialAgent: { prompt: 'hi' },
    });
  });

  it('drops pr-kind context links (they would make the create PR-aware)', () => {
    expect(
      buildPlainFolderCreateRequest({ repositoryPath: '/f', contextLinks: [issue, pr] })
        .contextLinks,
    ).toEqual([issue]);
    expect(
      buildPlainFolderCreateRequest({ repositoryPath: '/f', contextLinks: [pr] }),
    ).not.toHaveProperty('contextLinks');
  });

  it('never carries git-only options even if the caller passes them', () => {
    const request = buildPlainFolderCreateRequest({
      repositoryPath: '/f',
      ...({ branch: 'main', baseRef: 'main', isNewRepo: true, githubUrl: 'x' } as object),
    } as Parameters<typeof buildPlainFolderCreateRequest>[0]);
    for (const key of ['branch', 'baseRef', 'isNewRepo', 'githubUrl', 'setupScript', 'scope']) {
      expect(request).not.toHaveProperty(key);
    }
  });
});
