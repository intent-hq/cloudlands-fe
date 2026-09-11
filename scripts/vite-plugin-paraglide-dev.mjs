import { normalizePath, transformWithEsbuild } from 'vite';

/** Keep generated translation documentation and maps off the dev startup path. */
export function compactParaglideDevPlugin(generatedRoot) {
  const prefix = `${normalizePath(generatedRoot.replace(/\\/g, '/')).replace(/\/$/, '')}/`;
  return {
    name: 'compact-paraglide-dev',
    apply: 'serve',
    enforce: 'pre',
    async transform(source, id) {
      const file = normalizePath(id.split('?')[0].replace(/\\/g, '/'));
      if (!file.startsWith(prefix) || !file.endsWith('.js')) return null;

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
