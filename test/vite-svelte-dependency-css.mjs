/**
 * Opt-in workaround for unbundled Svelte dependencies in Vite 6 harnesses.
 * Vite adds an optimizer version to their IDs; vite-plugin-svelte 6 caches CSS
 * on that ID but looks it up by filename. Fixed upstream in plugin 7.1.2
 * (https://github.com/sveltejs/vite-plugin-svelte/pull/1342), which requires Vite 8.
 * Keep this out of the production config; remove when harnesses use that fix.
 *
 * @returns {import('vite').Plugin}
 */
export function svelteDependencyCss() {
  return {
    name: 'harness-svelte-dependency-css',
    apply: 'serve',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      // Resolve first: Vite can add v even when the original import has no query.
      // Limit the extra resolution to explicit component imports used by harnesses.
      if (!source.split('?', 1)[0].endsWith('.svelte')) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (!resolved || resolved.external) return resolved;
      return { ...resolved, id: canonicalSvelteDependencyId(resolved.id) };
    },
  };
}

/** Remove only the optimizer v field, preserving all other query bytes. */
export function canonicalSvelteDependencyId(id) {
  const queryIndex = id.indexOf('?');
  if (queryIndex < 0 || id.startsWith('\0')) return id;
  const filename = id.slice(0, queryIndex);
  if (!filename.replaceAll('\\', '/').includes('/node_modules/') || !filename.endsWith('.svelte')) {
    return id;
  }
  const hashIndex = id.indexOf('#', queryIndex);
  const query = id.slice(queryIndex + 1, hashIndex < 0 ? undefined : hashIndex);
  const fragment = hashIndex < 0 ? '' : id.slice(hashIndex);
  // Raw/URL imports do not use the compiled CSS cache.
  if (/(?:^|&)(?:raw|url)(?:=|&|$)/.test(query)) return id;
  const parts = query.split('&');
  const kept = parts.filter((part) => !/^v=/.test(part));
  if (parts.length === kept.length) return id;
  return filename + (kept.length ? `?${kept.join('&')}` : '') + fragment;
}
