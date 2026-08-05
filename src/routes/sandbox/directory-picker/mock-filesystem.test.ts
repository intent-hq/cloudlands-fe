import { describe, expect, it } from 'vitest';

import { getMockDirectoryListing, MOCK_HOME } from './mock-filesystem';

describe('directory picker mock filesystem', () => {
  it('provides the expected home directories, files, and git repositories', () => {
    const home = getMockDirectoryListing();
    const projects = getMockDirectoryListing(`${MOCK_HOME}/Projects`);

    expect(home?.entries.map((entry) => entry.name)).toEqual([
      'Desktop',
      'Documents',
      'Downloads',
      'Projects',
      'welcome.txt',
    ]);
    expect(projects?.entries.filter((entry) => entry.isGitRepo).map((entry) => entry.name)).toEqual(
      ['cloudlands-fe', 'intentd'],
    );
  });

  it('supports empty folders and rejects paths outside the fixture', () => {
    expect(getMockDirectoryListing(`${MOCK_HOME}/Documents/Empty Folder`)?.entries).toEqual([]);
    expect(getMockDirectoryListing(`${MOCK_HOME}/Missing`)).toBeNull();
  });
});
