import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveHashTab } from '../settings-hash-tab';

// Every highlight target the Settings page can render must open its tab from
// /settings#<id>; cloudlands-fe#4746 shipped "machine-rail" without a mapping.
const SRC = path.resolve(__dirname, '../../../..');
const PAGE = path.join(SRC, 'routes/(app)/settings/+page.svelte');
const ALIASES: Record<string, string> = {
  $lib: path.join(SRC, 'lib'),
  $features: path.join(SRC, 'features'),
};

function resolveImport(spec: string, fromFile: string): string | undefined {
  if (spec.startsWith('.')) return path.resolve(path.dirname(fromFile), spec);
  const [alias, ...rest] = spec.split('/');
  const base = ALIASES[alias];
  return base ? path.join(base, ...rest) : undefined;
}

/** The page plus every Svelte component it reaches through imports, minus UI primitives. */
function collectSettingsComponents(): string[] {
  const seen = new Set<string>();
  const queue = [PAGE];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    for (const [, spec] of source.matchAll(/from\s+'([^']+\.svelte)'/g)) {
      const resolved = resolveImport(spec, file);
      if (resolved && existsSync(resolved) && !resolved.includes(`${path.sep}ui${path.sep}`)) {
        queue.push(resolved);
      }
    }
  }
  return [...seen];
}

/** Returns the full opening tag that starts at `start`, skipping `>` inside braces or quotes. */
function readTag(source: string, start: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start + 1; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
    } else if (ch === '>' && depth === 0) {
      return source.slice(start, i + 1);
    }
  }
  return source.slice(start);
}

/** Literal ids on tags that pulse (`use:highlightTarget`) or render `<SettingsSection id>`. */
function collectHighlightIds(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const markup = source.replace(/<script[\s\S]*?<\/script>/g, (s) => ' '.repeat(s.length));
  const ids: string[] = [];
  for (const match of markup.matchAll(/<[A-Za-z][\w.:-]*/g)) {
    const tag = readTag(markup, match.index);
    if (!/\suse:highlightTarget\b/.test(tag) && !tag.startsWith('<SettingsSection')) continue;
    for (const [, id] of tag.matchAll(/\s(?:id|data-highlight-id)="([^"{}]+)"/g)) ids.push(id);
  }
  return ids;
}

const highlightIds = new Map<string, string>();
for (const file of collectSettingsComponents()) {
  for (const id of collectHighlightIds(file)) {
    if (!highlightIds.has(id)) highlightIds.set(id, path.relative(SRC, file));
  }
}

describe('Settings hash → tab mapping', () => {
  it('collects highlight ids from the page and the components it renders', () => {
    expect(highlightIds.get('machine-rail')).toBe('routes/(app)/settings/+page.svelte');
    expect(highlightIds.get('notch-dock')).toBe('lib/components/settings/DockLabSettings.svelte');
    expect(highlightIds.get('mcp-servers')).toBe(
      'lib/components/settings/AdministratorSettings.svelte',
    );
  });

  it('does not resolve an unknown id', () => {
    expect(resolveHashTab('not-a-settings-section')).toBeUndefined();
  });

  it('resolves every highlight id on the Settings page to a tab', () => {
    const unmapped = [...highlightIds]
      .filter(([id]) => resolveHashTab(id) === undefined)
      .map(([id, file]) => `${id} (${file})`);
    expect(
      unmapped,
      'Add each id to hashToTab in settings-hash-tab.ts or to src/shared/app-ui-targets.ts',
    ).toEqual([]);
  });
});
