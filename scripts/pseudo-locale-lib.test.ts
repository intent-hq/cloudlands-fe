import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// @ts-expect-error — plain .mjs build script without type declarations.
import { buildPseudoCatalog, pseudoize, writePseudoCatalog } from './pseudo-locale-lib.mjs';

describe('pseudoize', () => {
  it('wraps the message in ⟦…⟧ markers and accents ASCII letters', () => {
    const result = pseudoize('Save');
    expect(result.startsWith('⟦')).toBe(true);
    expect(result.endsWith('⟧')).toBe(true);
    expect(result).not.toContain('Save');
  });

  it('preserves {param} placeholders verbatim', () => {
    const result = pseudoize('Configure {name} path for {count} items');
    expect(result).toContain('{name}');
    expect(result).toContain('{count}');
    expect(result.match(/\{[a-zA-Z_$][\w$]*\}/g)).toEqual(['{name}', '{count}']);
  });

  it('expands the visible text by roughly 40%', () => {
    const message = 'A reasonably long settings description string';
    const result = pseudoize(message);
    // Strip markers; padding is `·` characters appended after the body.
    const padding = (result.match(/·/g) ?? []).length;
    expect(padding).toBe(Math.ceil(message.length * 0.4));
  });

  it('is deterministic', () => {
    expect(pseudoize('Hello {name}')).toBe(pseudoize('Hello {name}'));
  });
});

describe('buildPseudoCatalog', () => {
  it('transforms every message key and skips $schema', () => {
    const catalog = buildPseudoCatalog({
      $schema: 'https://inlang.com/schema/inlang-message-format',
      a_label: 'Hello',
      b_label: 'World {x}',
    });
    expect(Object.keys(catalog).sort()).toEqual(['$schema', 'a_label', 'b_label']);
    expect(catalog.$schema).toBe('https://inlang.com/schema/inlang-message-format');
    expect(catalog.a_label).not.toBe('Hello');
    expect(catalog.b_label).toContain('{x}');
  });
});

describe('writePseudoCatalog', () => {
  it('writes messages/en-XA.json next to messages/en.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pseudo-locale-'));
    try {
      mkdirSync(join(dir, 'messages'), { recursive: true });
      writeFileSync(join(dir, 'messages/en.json'), JSON.stringify({ a_label: 'Hi {name}' }));
      const outPath = writePseudoCatalog(dir);
      expect(outPath).toBe(join(dir, 'messages/en-XA.json'));
      const written = JSON.parse(readFileSync(outPath, 'utf8'));
      expect(written.a_label).toContain('{name}');
      expect(written.a_label.startsWith('⟦')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
