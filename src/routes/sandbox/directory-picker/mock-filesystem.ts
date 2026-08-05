import type {
  DirectoryPickerEntry,
  DirectoryPickerListing,
} from '$store/renderer/slices/directory-picker/directory-picker-slice';

export const MOCK_HOME = '/Users/amelia';

function directory(path: string, isGitRepo = false): DirectoryPickerEntry {
  return { name: path.split('/').at(-1) ?? path, path, isDirectory: true, isGitRepo };
}

function file(path: string): DirectoryPickerEntry {
  return { name: path.split('/').at(-1) ?? path, path, isDirectory: false, isGitRepo: false };
}

const mockDirectories: Record<string, DirectoryPickerEntry[]> = {
  '/': [directory('/Users')],
  '/Users': [directory(MOCK_HOME)],
  [MOCK_HOME]: [
    directory(`${MOCK_HOME}/Desktop`),
    directory(`${MOCK_HOME}/Documents`),
    directory(`${MOCK_HOME}/Downloads`),
    directory(`${MOCK_HOME}/Projects`),
    file(`${MOCK_HOME}/welcome.txt`),
  ],
  [`${MOCK_HOME}/Desktop`]: [
    directory(`${MOCK_HOME}/Desktop/Screenshots`),
    file(`${MOCK_HOME}/Desktop/design-notes.md`),
  ],
  [`${MOCK_HOME}/Desktop/Screenshots`]: [
    file(`${MOCK_HOME}/Desktop/Screenshots/picker-dark.png`),
    file(`${MOCK_HOME}/Desktop/Screenshots/picker-light.png`),
  ],
  [`${MOCK_HOME}/Documents`]: [
    directory(`${MOCK_HOME}/Documents/Empty Folder`),
    directory(`${MOCK_HOME}/Documents/Notes`),
    file(`${MOCK_HOME}/Documents/roadmap.pdf`),
  ],
  [`${MOCK_HOME}/Documents/Empty Folder`]: [],
  [`${MOCK_HOME}/Documents/Notes`]: [
    directory(`${MOCK_HOME}/Documents/Notes/Archive`),
    file(`${MOCK_HOME}/Documents/Notes/ideas.txt`),
  ],
  [`${MOCK_HOME}/Documents/Notes/Archive`]: [file(`${MOCK_HOME}/Documents/Notes/Archive/2025.txt`)],
  [`${MOCK_HOME}/Downloads`]: [
    directory(`${MOCK_HOME}/Downloads/Samples`),
    file(`${MOCK_HOME}/Downloads/cloudlands-beta.zip`),
  ],
  [`${MOCK_HOME}/Downloads/Samples`]: [file(`${MOCK_HOME}/Downloads/Samples/example.json`)],
  [`${MOCK_HOME}/Projects`]: [
    directory(`${MOCK_HOME}/Projects/cloudlands-fe`, true),
    directory(`${MOCK_HOME}/Projects/intentd`, true),
    directory(`${MOCK_HOME}/Projects/scratch`),
  ],
  [`${MOCK_HOME}/Projects/cloudlands-fe`]: [
    directory(`${MOCK_HOME}/Projects/cloudlands-fe/src`),
    directory(`${MOCK_HOME}/Projects/cloudlands-fe/static`),
    file(`${MOCK_HOME}/Projects/cloudlands-fe/package.json`),
  ],
  [`${MOCK_HOME}/Projects/cloudlands-fe/src`]: [
    directory(`${MOCK_HOME}/Projects/cloudlands-fe/src/features`),
    directory(`${MOCK_HOME}/Projects/cloudlands-fe/src/routes`),
  ],
  [`${MOCK_HOME}/Projects/cloudlands-fe/src/features`]: [],
  [`${MOCK_HOME}/Projects/cloudlands-fe/src/routes`]: [],
  [`${MOCK_HOME}/Projects/cloudlands-fe/static`]: [],
  [`${MOCK_HOME}/Projects/intentd`]: [
    directory(`${MOCK_HOME}/Projects/intentd/crates`),
    file(`${MOCK_HOME}/Projects/intentd/Cargo.toml`),
  ],
  [`${MOCK_HOME}/Projects/intentd/crates`]: [
    directory(`${MOCK_HOME}/Projects/intentd/crates/intentd`),
  ],
  [`${MOCK_HOME}/Projects/intentd/crates/intentd`]: [
    file(`${MOCK_HOME}/Projects/intentd/crates/intentd/main.rs`),
  ],
  [`${MOCK_HOME}/Projects/scratch`]: [],
};

function normalizePath(path: string): string {
  if (path === '/') return path;
  return path.replace(/\/+$/, '');
}

function parentPath(path: string): string | null {
  if (path === '/') return null;
  const parent = path.slice(0, path.lastIndexOf('/'));
  return parent || '/';
}

export function getMockDirectoryListing(path = MOCK_HOME): DirectoryPickerListing | null {
  const normalizedPath = normalizePath(path);
  const entries = mockDirectories[normalizedPath];
  if (!entries) return null;

  return {
    path: normalizedPath,
    parent: parentPath(normalizedPath),
    home: MOCK_HOME,
    entries,
  };
}
