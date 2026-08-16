import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd(), 'src');
const extensions = new Set(['.css', '.svelte', '.ts']);
const semanticExceptions = new Map<string, string[]>([
  ['src/lib/components/tiptap/DetailsBlock.ts', ['border-border/50']],
  ['src/lib/styles/chat-messages.css', ['border-zinc-200', 'border-zinc-800']],
  ['src/lib/components/chat/ToolDetails.svelte', ['border-[#a9b1d6]/10']],
  [
    'src/lib/components/code-walkthrough/WalkthroughAnnotationCard.svelte',
    ['border-slate-200', 'border-slate-700'],
  ],
]);
const forbidden = [
  /\b(?:border|divide|bg)-border\/[0-9]+\b/g,
  /\b(?:border|divide)-sidebar-border(?:\/[0-9]+)?\b/g,
  /\b(?:border|divide)-(?:gray|grey|neutral|slate|zinc)-[0-9]+(?:\/[0-9]+)?\b/g,
  /\b(?:border|divide)-\[(?:#[0-9a-fA-F]{3,8}|rgba?\([^\]]+\))\](?:\/[0-9]+)?\b/g,
];

function productFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name === '__tests__' ||
        entry.name === 'sandbox' ||
        entry.name.startsWith('test-')
      ) {
        return [];
      }
      return productFiles(file);
    }
    if (!extensions.has(path.extname(file)) || /\.(?:spec|test)\.ts$/.test(file)) return [];
    return [file];
  });
}

describe('neutral border source audit', () => {
  it('uses opaque border tokens outside documented semantic content exceptions', () => {
    const violations = productFiles(root).flatMap((file) => {
      const relative = path.relative(process.cwd(), file);
      let source = readFileSync(file, 'utf8');
      for (const exception of semanticExceptions.get(relative) ?? []) {
        source = source.replaceAll(exception, 'semantic-border-exception');
      }
      return forbidden.flatMap((pattern) =>
        [...source.matchAll(pattern)].map((match) => `${relative}: ${match[0]}`),
      );
    });

    expect(violations).toEqual([]);
  });
});
