import { posix } from 'node:path';

// Runtime import statements: `import x from 'y'`, `import { a, type B } from 'y'`,
// `export { a } from 'y'`. Type-only statements (`import type …`) are erased at
// compile time and load nothing, so they are skipped below.
// The clause allows only what an import/export clause can contain, so a match
// never runs on from an unrelated statement into a later `from '…'`.
const FROM_IMPORT = /^\s*(?:import|export)\s+(type\s)?[\w\s{},*$]*?\sfrom\s*['"]([^'"]+)['"]/gm;
// Side-effect imports: `import 'y'`.
const BARE_IMPORT = /^\s*import\s*['"]([^'"]+)['"]/gm;

function runtimeImports(source: string): Set<string> {
  const specifiers = new Set<string>();
  for (const [, typeOnly, specifier] of source.matchAll(FROM_IMPORT)) {
    if (!typeOnly) specifiers.add(specifier);
  }
  for (const [, specifier] of source.matchAll(BARE_IMPORT)) specifiers.add(specifier);
  return specifiers;
}

/**
 * The import specifiers that at least `minImporters` of the given preview
 * modules import at runtime, sorted.
 *
 * The preview-discovery suite imports these once in a warm-up hook so the
 * cold compile of the code most previews share (the renderer store, shared
 * types, UI primitives, the chat message renderer) is not charged to whichever
 * preview happens to load first. Relative specifiers are resolved against the
 * preview's directory into root-absolute paths (`/src/…`), so the same module
 * reached from several previews counts once per preview and can be imported
 * from anywhere.
 *
 * @param sources preview module source text keyed by root-absolute path
 * @param minImporters how many previews must import a specifier for it to count as shared
 */
export function sharedPreviewImports(
  sources: Record<string, string>,
  minImporters: number,
): string[] {
  const importers = new Map<string, number>();
  for (const [path, source] of Object.entries(sources)) {
    const resolved = new Set(
      [...runtimeImports(source)].map((specifier) =>
        specifier.startsWith('.') ? posix.join(posix.dirname(path), specifier) : specifier,
      ),
    );
    for (const specifier of resolved) {
      importers.set(specifier, (importers.get(specifier) ?? 0) + 1);
    }
  }
  return [...importers]
    .filter(([, count]) => count >= minImporters)
    .map(([specifier]) => specifier)
    .sort();
}
