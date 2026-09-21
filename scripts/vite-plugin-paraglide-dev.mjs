import { realpathSync } from 'node:fs';
import { normalizePath, transformWithEsbuild } from 'vite';

const toPrefix = (dir) => `${normalizePath(dir.replace(/\\/g, '/')).replace(/\/$/, '')}/`;

/** Keep generated translation documentation and maps off the dev startup path. */
export function compactParaglideDevPlugin(generatedRoot) {
  const prefixes = [toPrefix(generatedRoot)];
  // Vite hands transform hooks the realpath of each module, so a generated root
  // reached through a symlink (macOS `/var/folders` -> `/private/var/folders`, a
  // symlinked checkout) never matches the configured path. The directory may not
  // exist yet when the config is evaluated, so resolve it on first use.
  let realPrefix;
  const isGenerated = (file) => {
    if (realPrefix === undefined) {
      try {
        realPrefix = toPrefix(realpathSync.native(generatedRoot));
        if (!prefixes.includes(realPrefix)) prefixes.push(realPrefix);
      } catch {
        // Not generated yet; retry on the next module.
      }
    }
    return prefixes.some((prefix) => file.startsWith(prefix));
  };
  return {
    name: 'compact-paraglide-dev',
    apply: 'serve',
    enforce: 'pre',
    async transform(source, id) {
      const file = normalizePath(id.split('?')[0].replace(/\\/g, '/'));
      if (!file.endsWith('.js') || !isGenerated(file)) return null;

      // These files are compiler output, not authored code. Keep names and ESM
      // imports intact (including the shared locale runtime and Vite HMR graph),
      // but omit repeated JSDoc and whitespace. Application maps are untouched.
      const { code } = await transformWithEsbuild(source, file, {
        loader: 'js',
        minifyWhitespace: true,
        legalComments: 'none',
        sourcemap: false,
      });
      // An explicit empty map prevents Vite composing an inline identity map
      // containing the original multi-megabyte generated documentation.
      return { code, map: { mappings: '' } };
    },
  };
}
