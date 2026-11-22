// @verify-changed-triggers: scripts/source-ast-lib.mjs

import { describe, expect, it } from 'vitest';
import {
  findObjectLiterals,
  lineOf,
  namedImports,
  ownProperty,
  parseErrors,
  parseSource,
  propertyName,
  propertyValue,
  stringValue,
  svelteMarkupText,
  svelteScriptBlocks,
  svelteScriptText,
  ts,
  walk,
} from './source-ast-lib.mjs';

const objectsWith = (text: string, name: string, fileName?: string) =>
  findObjectLiterals(parseSource(text, fileName), name);

const valueOf = (expression: string) => {
  const [object] = objectsWith(`const x = { v: ${expression} };`, 'v');
  return stringValue(propertyValue(object, 'v'));
};

describe('source AST helper', () => {
  it('finds object literals by own property, not by a nested one', () => {
    const text = [
      'const a = { kind: "switch", nested: { id: "inner" } };',
      'const b = { id: "outer" };',
    ].join('\n');
    const found = objectsWith(text, 'id');
    expect(found.map((object) => stringValue(propertyValue(object, 'id')))).toEqual([
      'inner',
      'outer',
    ]);
    expect(objectsWith(text, 'kind')).toHaveLength(1);
    expect(propertyValue(objectsWith(text, 'kind')[0], 'id')).toBeUndefined();
  });

  it('is not confused by braces or quotes in regexes, strings, templates and comments', () => {
    const text = [
      'const re = /[{"]\\}/g;',
      "const s = '{ \"';",
      'const t = `}${"{"}`;',
      '// { kind: "comment" }',
      '/* } */',
      'const entry = { kind: "real", re: /}/ };',
    ].join('\n');
    const [entry] = objectsWith(text, 'kind');
    expect(stringValue(propertyValue(entry, 'kind'))).toBe('real');
    expect(lineOf(entry)).toBe(6);
  });

  it('reads property names of every static shape and none for computed keys', () => {
    const [object] = objectsWith(
      'const o = { a: 1, "b": 2, 3: 3, c, d() {}, get e() { return 1; }, [KEY]: 4, ...rest };',
      'a',
    );
    expect(object.properties.map((property) => propertyName(property))).toEqual([
      'a',
      'b',
      '3',
      'c',
      'd',
      'e',
      null,
      null,
    ]);
    const shorthand = propertyValue(object, 'c');
    expect(shorthand && ts.isIdentifier(shorthand) && shorthand.text).toBe('c');
  });

  it('lets the last duplicate key win', () => {
    const [object] = objectsWith('const o = { id: "first", id: "second" };', 'id');
    expect(stringValue(propertyValue(object, 'id'))).toBe('second');
    expect(ownProperty(object, 'id')?.getText()).toBe('id: "second"');
  });

  it('reads string values through wrappers, and only static ones', () => {
    expect(valueOf("'plain'")).toBe('plain');
    expect(valueOf('`template`')).toBe('template');
    expect(valueOf("('wrapped' as const)")).toBe('wrapped');
    expect(valueOf("'checked' satisfies string")).toBe('checked');
    expect(valueOf("'a\\u0041'")).toBe('aA');
    expect(valueOf('SWITCH_KIND')).toBeNull();
    expect(valueOf('`${prefix}switch`')).toBeNull();
    expect(valueOf("'a' + 'b'")).toBeNull();
    expect(stringValue(undefined)).toBeNull();
  });

  it('reports syntax errors the parser recovered from, with their line', () => {
    expect(parseErrors(parseSource('const ok = { a: 1 };'))).toEqual([]);
    const errors = parseErrors(parseSource("const a = 1;\ncategory: 'labs',\n"));
    expect(errors).toEqual([{ line: 2, message: expect.any(String) }]);
  });

  it('tells regex literals from division in a JavaScript file', () => {
    const source = parseSource('const r = a / b / c; if (ok) /x/.test(r);', 'scripts/x.mjs');
    const regexes: string[] = [];
    walk(source, (node) => {
      if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) regexes.push(node.getText());
    });
    expect(regexes).toEqual(['/x/']);
    expect(parseErrors(source)).toEqual([]);
  });

  it('skips the children of a node when the visitor returns false', () => {
    const source = parseSource('const o = { a: { b: 1 } };');
    const seen: string[] = [];
    walk(source, (node) => {
      if (ts.isPropertyAssignment(node)) seen.push(node.name.getText());
      return !ts.isPropertyAssignment(node);
    });
    expect(seen).toEqual(['a']);
  });

  it('maps named imports to their module, type-only included', () => {
    const source = parseSource(
      [
        "import { a, b as c, type D } from './one';",
        "import Default, { e } from './two';",
        "import * as ns from './three';",
      ].join('\n'),
    );
    expect(Object.fromEntries(namedImports(source))).toEqual({
      a: './one',
      c: './one',
      D: './one',
      e: './two',
    });
  });

  describe('Svelte components', () => {
    const page = [
      '<script module lang="ts">',
      "  export const tag = { id: 'module' };",
      '</script>',
      '<!-- <script>const ghost = { id: "comment" };</script> -->',
      '<script lang="ts" generics="T extends Map<string, { a: 1 }>">',
      "  const entry = { id: 'instance' };",
      '</script>',
      '{#if open}<div style="x: {y}">{ id: "markup" }</div>{/if}',
      '<style>.a { id: x; }</style>',
    ].join('\n');

    it('parses every script block at its original offsets and lines', () => {
      const source = parseSource(page, 'Labs.svelte');
      const found = findObjectLiterals(source, 'id');
      expect(found.map((object) => stringValue(propertyValue(object, 'id')))).toEqual([
        'module',
        'instance',
      ]);
      expect(found.map((object) => lineOf(object))).toEqual([2, 6]);
      expect(page.slice(found[1].getStart(), found[1].end)).toBe("{ id: 'instance' }");
      expect(parseErrors(source)).toEqual([]);
    });

    it('splits a component into script text and markup text of the same length', () => {
      const script = svelteScriptText(page);
      const markup = svelteMarkupText(page);
      expect(script).toHaveLength(page.length);
      expect(markup).toHaveLength(page.length);
      expect(script.split('\n')).toHaveLength(page.split('\n').length);
      expect(script).toContain("{ id: 'instance' }");
      expect(script).not.toContain('ghost');
      expect(script).not.toContain('markup');
      expect(markup).toContain('{ id: "markup" }');
      expect(markup).not.toContain('instance');
      expect(markup).not.toContain('ghost');
      expect(markup).not.toContain('.a {');
    });

    it('splits a component into one same-length text per script block', () => {
      const blocks = svelteScriptBlocks(page);
      expect(blocks.map((block) => block.isModule)).toEqual([true, false]);
      expect(blocks.map((block) => block.text.length)).toEqual([page.length, page.length]);
      const [module, instance] = blocks.map((block) =>
        findObjectLiterals(parseSource(block.text), 'id').map((object) => lineOf(object)),
      );
      expect(module).toEqual([2]);
      expect(instance).toEqual([6]);
      expect(blocks[1].openTag).toBe(
        '<script lang="ts" generics="T extends Map<string, { a: 1 }>">',
      );
      expect(svelteScriptBlocks('<script context="module">x</script>')[0].isModule).toBe(true);
    });

    it('reads a component without a script block as empty code', () => {
      const source = parseSource('<SettingsForm />', 'Empty.svelte');
      expect(source.statements).toHaveLength(0);
    });
  });
});
