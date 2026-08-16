import { describe, expect, it } from 'vitest';

import type { DirectoryPickerEntry } from '$store/renderer/slices/directory-picker/directory-picker-slice';

import {
  buildDirectoryPickerBreadcrumbs,
  collapseDirectoryPickerPath,
  directoryPickerFavorites,
  favoritesFromHome,
  filterDirectoryPickerEntries,
  findActiveFavoriteId,
} from './directory-picker-view';

const favoriteLabels = {
  home: 'Home',
  desktop: 'Desktop',
  documents: 'Documents',
  downloads: 'Downloads',
  computer: 'Computer',
};

const entries: DirectoryPickerEntry[] = [
  { name: 'Projects', path: '/Users/me/Projects', isDirectory: true, isGitRepo: false },
  { name: 'intent', path: '/Users/me/intent', isDirectory: true, isGitRepo: true },
  { name: 'notes.txt', path: '/Users/me/notes.txt', isDirectory: false, isGitRepo: false },
];

describe('directory picker view helpers', () => {
  it('collapses home and builds navigable breadcrumb paths', () => {
    expect(collapseDirectoryPickerPath('/Users/me/Projects/demo', '/Users/me')).toBe(
      '~/Projects/demo',
    );
    expect(collapseDirectoryPickerPath('/Volumes/work', '/Users/me')).toBe('/Volumes/work');
    expect(buildDirectoryPickerBreadcrumbs('/Users/me/Projects/demo', '/Users/me')).toEqual([
      { label: '~', path: '/Users/me' },
      { label: 'Projects', path: '/Users/me/Projects' },
      { label: 'demo', path: '/Users/me/Projects/demo' },
    ]);
    expect(buildDirectoryPickerBreadcrumbs('/Volumes/work')).toEqual([
      { label: '/', path: '/' },
      { label: 'Volumes', path: '/Volumes' },
      { label: 'work', path: '/Volumes/work' },
    ]);
  });

  it('filters names case-insensitively and includes files only when requested', () => {
    expect(filterDirectoryPickerEntries(entries, '').map((entry) => entry.name)).toEqual([
      'Projects',
      'intent',
    ]);
    expect(filterDirectoryPickerEntries(entries, 'PRO').map((entry) => entry.name)).toEqual([
      'Projects',
    ]);
    expect(filterDirectoryPickerEntries(entries, 'notes', true).map((entry) => entry.name)).toEqual(
      ['notes.txt'],
    );
  });

  it('derives conventional favorites and chooses the most specific active path', () => {
    const favorites = favoritesFromHome('/Users/me/', favoriteLabels);

    expect(favorites.map(({ id, path }) => ({ id, path }))).toEqual([
      { id: 'home', path: '/Users/me' },
      { id: 'desktop', path: '/Users/me/Desktop' },
      { id: 'documents', path: '/Users/me/Documents' },
      { id: 'downloads', path: '/Users/me/Downloads' },
      { id: 'computer', path: '/' },
    ]);
    expect(findActiveFavoriteId('/Users/me/Documents/work', favorites)).toBe('documents');
    expect(findActiveFavoriteId('/Volumes/work', favorites)).toBe('computer');
  });

  it('renders exactly the daemon-reported favorites plus Computer', () => {
    const favorites = directoryPickerFavorites(
      {
        home: '/home/user',
        favorites: [
          { id: 'home', path: '/home/user' },
          { id: 'downloads', path: '/home/user/Téléchargements/' },
        ],
      },
      favoriteLabels,
    );

    expect(favorites).toEqual([
      { id: 'home', label: 'Home', path: '/home/user' },
      { id: 'downloads', label: 'Downloads', path: '/home/user/Téléchargements' },
      { id: 'computer', label: 'Computer', path: '/' },
    ]);
  });

  it('labels an unknown daemon favorite id with its folder name', () => {
    const favorites = directoryPickerFavorites(
      {
        home: '/home/user',
        favorites: [
          { id: 'home', path: '/home/user' },
          { id: 'music', path: '/home/user/Music' },
        ],
      },
      favoriteLabels,
    );

    expect(favorites.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: 'home', label: 'Home' },
      { id: 'music', label: 'Music' },
      { id: 'computer', label: 'Computer' },
    ]);
  });

  it('falls back to conventional favorites when the listing has no favorites field', () => {
    const listing = { home: '/Users/me' };
    expect(directoryPickerFavorites(listing, favoriteLabels)).toEqual(
      favoritesFromHome('/Users/me', favoriteLabels),
    );
    expect(directoryPickerFavorites(null, favoriteLabels)).toEqual(
      favoritesFromHome(undefined, favoriteLabels),
    );
  });
});
