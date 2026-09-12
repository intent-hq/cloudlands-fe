import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  decodeMappings,
  displaySource,
  formatFrame,
  indexSourceMaps,
  lookupMap,
  originalPositionFor,
  parseSourceMap,
  parseStackLine,
  planRendererBuild,
  resolveStack,
  sourcesOnLine,
} from './resolve-stack-lib.mjs';

// The canonical Source Map v3 example (two one-line sources, minified to two
// generated lines); expected positions follow the reference test-suite. Sources
// are relative to the map's directory, .svelte-kit/output/client/app/immutable/chunks/.
const SRC_ONE = '../../../../../../src/one.js';
const SRC_TWO = '../../../../../../src/two.js';
const FIXTURE_MAP = {
  version: 3,
  file: 'Abc123.js',
  names: ['bar', 'baz', 'n'],
  sources: [SRC_ONE, SRC_TWO],
  mappings: 'CAAC,IAAI,IAAM,SAAUA,GAClB,OAAOC,IAAID;CCDb,IAAI,IAAM,SAAUE,GAClB,OAAOA',
};

const temporaryPaths: string[] = [];
afterEach(() => {
  for (const path of temporaryPaths.splice(0)) rmSync(path, { recursive: true, force: true });
});

function fixtureDist() {
  const root = mkdtempSync(join(tmpdir(), 'resolve-stack-test-'));
  temporaryPaths.push(root);
  const dist = join(root, '.svelte-kit', 'output', 'client');
  const chunks = join(dist, 'app', 'immutable', 'chunks');
  const nodes = join(dist, 'app', 'immutable', 'nodes');
  mkdirSync(chunks, { recursive: true });
  mkdirSync(nodes, { recursive: true });
  writeFileSync(join(chunks, 'Abc123.js'), 'var a=1;\nvar b=2;\n');
  writeFileSync(join(chunks, 'Abc123.js.map'), JSON.stringify(FIXTURE_MAP));
  writeFileSync(join(chunks, 'NoMap.js'), 'var c=3;\n');
  writeFileSync(join(nodes, '8.LocalHsh.js'), 'var a=1;\nvar b=2;\n');
  writeFileSync(join(nodes, '8.LocalHsh.js.map'), JSON.stringify(FIXTURE_MAP));
  return { root, dist };
}

describe('parseStackLine', () => {
  it('parses V8 frames with and without a function name', () => {
    expect(
      parseStackLine('    at Qr (app://workspaces/app/immutable/chunks/BqSEhATr.js:52:24785)'),
    ).toMatchObject({ kind: 'frame', fn: 'Qr', file: 'BqSEhATr.js', line: 52, column: 24785 });
    expect(
      parseStackLine('at app://workspaces/app/immutable/nodes/8.sjojx69_.js:70:12'),
    ).toMatchObject({ kind: 'frame', fn: null, file: '8.sjojx69_.js', line: 70, column: 12 });
  });

  it('parses Gecko-style and bare file:line[:col] frames', () => {
    expect(
      parseStackLine('Qr@app://workspaces/app/immutable/chunks/-KQyQ6em.js:1:10395'),
    ).toMatchObject({ kind: 'frame', fn: 'Qr', file: '-KQyQ6em.js', line: 1, column: 10395 });
    expect(parseStackLine('8.sjojx69_.js:70')).toMatchObject({
      kind: 'frame',
      file: '8.sjojx69_.js',
      line: 70,
      column: null,
    });
  });

  it('passes non-frame lines through as text', () => {
    expect(parseStackLine('Error: effect_in_teardown')).toEqual({
      kind: 'text',
      raw: 'Error: effect_in_teardown',
    });
    expect(parseStackLine('')).toEqual({ kind: 'text', raw: '' });
  });
});

describe('source map decoding', () => {
  it('decodes VLQ mappings into per-line segments', () => {
    const lines = decodeMappings(FIXTURE_MAP.mappings);
    expect(lines).toHaveLength(2);
    expect(lines[0][0]).toEqual([1, 0, 0, 1, null]);
    expect(lines[0][3]).toEqual([18, 0, 0, 21, 0]);
    expect(lines[0][4]).toEqual([21, 0, 1, 3, null]);
    expect(lines[1][0]).toEqual([1, 1, 0, 1, null]);
    expect(lines[1][3]).toEqual([18, 1, 0, 21, 2]);
  });

  it('maps 1-based stack positions to the nearest preceding original segment', () => {
    const map = parseSourceMap(JSON.stringify(FIXTURE_MAP));
    expect(originalPositionFor(map, 1, 19)).toEqual({
      source: SRC_ONE,
      line: 1,
      column: 22,
      name: 'bar',
    });
    expect(originalPositionFor(map, 1, 24)).toMatchObject({ source: SRC_ONE, line: 2, column: 4 });
    expect(originalPositionFor(map, 2, 19)).toMatchObject({ source: SRC_TWO, name: 'n' });
    expect(originalPositionFor(map, 1, 1)).toBeNull();
    expect(originalPositionFor(map, 3, 1)).toBeNull();
  });

  it('lists distinct original sources for a column-less frame', () => {
    const map = parseSourceMap(JSON.stringify(FIXTURE_MAP));
    expect(sourcesOnLine(map, 1)).toEqual([{ source: SRC_ONE, firstLine: 1, lastLine: 2 }]);
    expect(sourcesOnLine(map, 9)).toEqual([]);
  });
});

describe('resolveStack', () => {
  it('indexes maps by basename and resolves, flags and passes through frames', () => {
    const { root, dist } = fixtureDist();
    const index = indexSourceMaps(dist);
    expect([...index.keys()].sort()).toEqual(['8.LocalHsh.js', 'Abc123.js']);
    const stack = [
      'Error: boom',
      '    at Qr (app://workspaces/app/immutable/chunks/Abc123.js:1:19)',
      '    at app://workspaces/app/immutable/chunks/Abc123.js:2:19',
      '    at Zz (app://workspaces/app/immutable/chunks/NoMap.js:1:5)',
      '    at Zz (app://workspaces/app/immutable/chunks/Abc123.js:1:1)',
      'Abc123.js:2',
    ].join('\n');
    const lines = resolveStack(stack, { index, baseDir: root }).map((r) => formatFrame(r));
    expect(lines[0]).toBe('Error: boom');
    expect(lines[1]).toBe('src/one.js:1:22 bar    <- Abc123.js:1:19 (Qr)');
    expect(lines[2]).toBe('src/two.js:1:22 n    <- Abc123.js:2:19');
    expect(lines[3]).toContain('    at Zz (app://workspaces/app/immutable/chunks/NoMap.js:1:5)');
    expect(lines[3]).toMatch(/# unresolved: no sourcemap for NoMap\.js/);
    expect(lines[4]).toMatch(/# unresolved: no mapping at 1:1/);
    expect(lines[5]).toBe('src/two.js:1-2 (no column)    <- Abc123.js:2');
  });

  it('falls back to the same route node when only the chunk hash differs', () => {
    const { root, dist } = fixtureDist();
    const index = indexSourceMaps(dist);
    expect(lookupMap(index, '8.LocalHsh.js')).toMatchObject({
      matchedFile: '8.LocalHsh.js',
      approximate: false,
    });
    expect(lookupMap(index, '8.sjojx69_.js')).toMatchObject({
      matchedFile: '8.LocalHsh.js',
      approximate: true,
    });
    expect(lookupMap(index, '9.sjojx69_.js')).toBeNull();
    expect(lookupMap(index, 'Other123.js')).toBeNull();
    const stack = [
      '    at app://workspaces/app/immutable/nodes/8.sjojx69_.js:2',
      '    at Qr (app://workspaces/app/immutable/nodes/8.sjojx69_.js:1:19)',
    ].join('\n');
    const lines = resolveStack(stack, { index, baseDir: root }).map((r) => formatFrame(r));
    expect(lines[0]).toBe(
      'src/two.js:1-2 (no column)    <- 8.sjojx69_.js:2    # approximate: hash mismatch, used 8.LocalHsh.js',
    );
    expect(lines[1]).toBe(
      'src/one.js:1:22 bar    <- 8.sjojx69_.js:1:19 (Qr)    # approximate: hash mismatch, used 8.LocalHsh.js',
    );
  });

  it('keeps virtual and URL sources verbatim in displaySource', () => {
    expect(displaySource('\0vite/preload-helper.js', '/x/map', '/x')).toBe(
      '\0vite/preload-helper.js',
    );
    expect(displaySource('http://example.com/a.js', '/x/map', '/x')).toBe(
      'http://example.com/a.js',
    );
    expect(displaySource('../../src/a.js', '/x/dist/chunks', '/x')).toBe('src/a.js');
  });
});

describe('planRendererBuild', () => {
  it('drops the sourcemap kill switch and splits the chain into spawnable steps', () => {
    const steps = planRendererBuild(
      'pnpm run build:i18n-bundle && cross-env GIT_TERMINAL_PROMPT=0 NODE_ENV=production INTENT_DISABLE_SOURCEMAPS=1 node scripts/vite-build.mjs && node scripts/fix-renderer-paths.js',
    );
    expect(steps).toEqual([
      { command: 'pnpm', args: ['run', 'build:i18n-bundle'], env: {} },
      {
        command: 'node',
        args: ['scripts/vite-build.mjs'],
        env: { GIT_TERMINAL_PROMPT: '0', NODE_ENV: 'production' },
      },
      { command: 'node', args: ['scripts/fix-renderer-paths.js'], env: {} },
    ]);
  });

  it('rejects chains it cannot split safely', () => {
    expect(() => planRendererBuild('node a.js | tee log')).toThrow(/cannot be split/);
    expect(() => planRendererBuild('node "a b.js"')).toThrow(/cannot be split/);
  });
});
