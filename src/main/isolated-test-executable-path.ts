import * as fs from 'node:fs';
import * as path from 'node:path';

/** Read install directories only: never source host shell files or load host credentials. */
export function isolatedExecutableDirectories(originalHome: string): readonly string[] {
  const directories = ['.local/bin', '.npm-global/bin', '.npm-packages/bin'].map((name) =>
    path.join(originalHome, name),
  );
  // Concrete nvm installations contain sibling node/npx executables. HOME-dependent
  // manager shims (for example asdf/Volta) cannot be made usable by PATH alone.
  const versions = path.join(originalHome, '.nvm', 'versions', 'node');
  try {
    const names = fs.readdirSync(versions).filter((name) => /^v\d+\.\d+\.\d+$/.test(name));
    names.sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
    directories.push(...names.map((name) => path.join(versions, name, 'bin')));
  } catch {
    // Optional host tool installations may be absent or unreadable.
  }
  return Object.freeze(
    directories.filter((directory) => {
      try {
        // Preserve the directory spelling, including symlinks used by CLI wrappers.
        return fs.statSync(directory).isDirectory();
      } catch {
        return false;
      }
    }),
  );
}
