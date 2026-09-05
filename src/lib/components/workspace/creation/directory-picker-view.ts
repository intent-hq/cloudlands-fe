import type { IconDefinition } from '@fortawesome/fontawesome-common-types';

import type {
  DirectoryPickerEntry,
  DirectoryPickerListing,
} from '$store/renderer/slices/directory-picker/directory-picker-slice';

export interface DirectoryPickerFavorite {
  id: string;
  label: string;
  path: string;
  icon?: IconDefinition;
}

export interface DirectoryPickerBreadcrumb {
  label: string;
  path: string;
}

export interface DirectoryPickerFavoriteLabels {
  home: string;
  desktop: string;
  documents: string;
  downloads: string;
  computer: string;
}

function normalizePath(path: string): string {
  if (path === '/') return path;
  return path.replace(/\/+$/, '');
}

function isPathWithin(path: string, parent: string): boolean {
  return parent === '/' ? path.startsWith('/') : path === parent || path.startsWith(`${parent}/`);
}

function joinPath(parent: string, child: string): string {
  return parent === '/' ? `/${child}` : `${parent}/${child}`;
}

export function collapseDirectoryPickerPath(path: string, home?: string): string {
  const current = normalizePath(path);
  const normalizedHome = home ? normalizePath(home) : '';
  if (!normalizedHome || !isPathWithin(current, normalizedHome)) return current;
  return current === normalizedHome ? '~' : `~${current.slice(normalizedHome.length)}`;
}

export function buildDirectoryPickerBreadcrumbs(
  path: string,
  home?: string,
): DirectoryPickerBreadcrumb[] {
  const current = normalizePath(path);
  const normalizedHome = home ? normalizePath(home) : '';
  const underHome = normalizedHome && isPathWithin(current, normalizedHome);
  const basePath = underHome ? normalizedHome : current.startsWith('/') ? '/' : '';
  const baseLabel = underHome ? '~' : basePath || current;
  const remainder = underHome
    ? current.slice(normalizedHome.length)
    : current.startsWith('/')
      ? current.slice(1)
      : '';
  const breadcrumbs: DirectoryPickerBreadcrumb[] = [
    { label: baseLabel, path: basePath || current },
  ];

  for (const segment of remainder.split('/').filter(Boolean)) {
    const previous = breadcrumbs.at(-1)?.path ?? '';
    breadcrumbs.push({
      label: segment,
      path: previous === '/' ? `/${segment}` : `${previous}/${segment}`,
    });
  }

  return breadcrumbs;
}

export function filterDirectoryPickerEntries(
  entries: DirectoryPickerEntry[],
  query: string,
  showFiles = false,
): DirectoryPickerEntry[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return entries.filter(
    (entry) =>
      (showFiles || entry.isDirectory) &&
      (!normalizedQuery || entry.name.toLocaleLowerCase().includes(normalizedQuery)),
  );
}

export function favoritesFromHome(
  home: string | undefined,
  labels: DirectoryPickerFavoriteLabels,
): DirectoryPickerFavorite[] {
  const normalizedHome = home ? normalizePath(home) : '';
  const favorites: DirectoryPickerFavorite[] = normalizedHome
    ? [
        { id: 'home', label: labels.home, path: normalizedHome },
        { id: 'desktop', label: labels.desktop, path: joinPath(normalizedHome, 'Desktop') },
        { id: 'documents', label: labels.documents, path: joinPath(normalizedHome, 'Documents') },
        { id: 'downloads', label: labels.downloads, path: joinPath(normalizedHome, 'Downloads') },
      ]
    : [];

  return [...favorites, { id: 'computer', label: labels.computer, path: '/' }];
}

/**
 * Sidebar favorites for a listing. When the listing carries the
 * daemon-validated `favorites` field, render exactly those (localized labels
 * keyed by `id`) so favorites that do not exist on the daemon host are never
 * offered; `Computer` (`/`) is always appended. Older daemons omit the field,
 * so fall back to the conventional home-derived favorites.
 */
export function directoryPickerFavorites(
  listing: Pick<DirectoryPickerListing, 'home' | 'favorites'> | null | undefined,
  labels: DirectoryPickerFavoriteLabels,
): DirectoryPickerFavorite[] {
  const reported = listing?.favorites;
  if (!reported) return favoritesFromHome(listing?.home, labels);

  const labelById: Partial<Record<string, string>> = {
    home: labels.home,
    desktop: labels.desktop,
    documents: labels.documents,
    downloads: labels.downloads,
  };
  const favorites = reported.map(({ id, path }) => {
    const normalized = normalizePath(path);
    return {
      id,
      label: labelById[id] ?? normalized.split('/').filter(Boolean).at(-1) ?? normalized,
      path: normalized,
    };
  });

  return [...favorites, { id: 'computer', label: labels.computer, path: '/' }];
}

export function findActiveFavoriteId(
  path: string | undefined,
  favorites: DirectoryPickerFavorite[],
): string | null {
  if (!path) return null;
  const current = normalizePath(path);
  return (
    favorites
      .filter((favorite) => isPathWithin(current, normalizePath(favorite.path)))
      .sort((left, right) => normalizePath(right.path).length - normalizePath(left.path).length)[0]
      ?.id ?? null
  );
}
