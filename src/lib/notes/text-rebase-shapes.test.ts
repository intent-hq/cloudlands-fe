// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { TEXT_REBASE_SHAPE_NAMES, textRebaseShapes } from './text-rebase-shapes';

/** FNV-1a over UTF-16 code units: a short pin of a corpus that must not drift. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

const KIB = 1024;

// A bench figure names its shape, so the bytes behind a name are pinned: a
// change here is a change to what every recorded figure measured.
const PINNED: Record<string, { length: number; hash: string }> = {
  formatted: { length: 98384, hash: '0e2c96c0' },
  mixed: { length: 99065, hash: '1c200852' },
  'link-heavy': { length: 98354, hash: '650bc0f3' },
  'image-heavy': { length: 98316, hash: '88b7533f' },
  'table-heavy': { length: 98933, hash: 'baf5b203' },
  'fenced-code-heavy': { length: 98800, hash: '90bff9f3' },
  '150kib': { length: 153744, hash: 'c77b73fb' },
  '1mib': { length: 1048809, hash: 'd884cac7' },
};

describe('textRebaseShapes', () => {
  const shapes = textRebaseShapes();
  const byName = new Map(shapes.map((shape) => [shape.name, shape.markdown]));
  const count = (text: string, pattern: RegExp) => (text.match(pattern) ?? []).length;

  it('draws every shape in order', () => {
    expect(shapes.map((shape) => shape.name)).toEqual([...TEXT_REBASE_SHAPE_NAMES]);
    expect(Object.keys(PINNED).sort()).toEqual([...TEXT_REBASE_SHAPE_NAMES].sort());
  });

  it('draws the same markdown on every call', () => {
    const again = textRebaseShapes();
    for (const [i, shape] of shapes.entries()) {
      expect(again[i].name).toBe(shape.name);
      expect(again[i].markdown).toBe(shape.markdown);
    }
  });

  it.each(TEXT_REBASE_SHAPE_NAMES)('pins the bytes of %s', (name) => {
    const markdown = byName.get(name)!;
    expect(markdown.length).toBe(PINNED[name].length);
    expect(fnv1a(markdown)).toBe(PINNED[name].hash);
    // ASCII only, so the character count is the byte count.
    expect(/[^\x00-\x7f]/.test(markdown)).toBe(false);
  });

  it('keeps the themed shapes near but under the 128 KiB lexing cap', () => {
    for (const name of TEXT_REBASE_SHAPE_NAMES) {
      if (name === '150kib' || name === '1mib') continue;
      const length = byName.get(name)!.length;
      expect(length).toBeGreaterThanOrEqual(96 * KIB);
      expect(length).toBeLessThan(128 * KIB);
    }
    expect(byName.get('150kib')!.length).toBeGreaterThanOrEqual(150 * KIB);
    expect(byName.get('1mib')!.length).toBeGreaterThanOrEqual(1024 * KIB);
  });

  it('draws each themed shape from its own syntax', () => {
    const formatted = byName.get('formatted')!;
    for (const line of formatted.split('\n')) {
      if (line === '') continue;
      expect(line).toMatch(/\*\*[^*]+\*\*.*\]\(.*\*[^*]+\*/);
    }
    const links = byName.get('link-heavy')!;
    expect(count(links, /\]\(https:/g)).toBeGreaterThan(100);
    expect(count(links, /^\[ref\d+\]: /gm)).toBeGreaterThan(50);
    expect(count(links, /<https:\/\/[^>]+>/g)).toBeGreaterThan(50);
    const images = byName.get('image-heavy')!;
    expect(count(images, /!\[[^\]]*\]\([^)]+\.png/g)).toBeGreaterThan(300);
    const tables = byName.get('table-heavy')!;
    expect(count(tables, /^\|( --- \|)+$/gm)).toBeGreaterThan(100);
    const fences = byName.get('fenced-code-heavy')!;
    expect(count(fences, /^```(ts|rust|sh|json|py)$/gm)).toBeGreaterThan(50);
    expect(count(fences, /^```$/gm)).toBe(count(fences, /^```(ts|rust|sh|json|py)$/gm));
    const mixed = byName.get('mixed')!;
    expect(mixed.startsWith('# ')).toBe(true);
    expect(count(mixed, /^#{2,3} /gm)).toBeGreaterThan(10);
    expect(count(mixed, /^- /gm)).toBeGreaterThan(50);
    expect(count(mixed, /^```/gm)).toBeGreaterThan(10);
  });
});
