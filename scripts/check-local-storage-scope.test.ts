// @verify-changed-triggers: src/**, scripts/check-local-storage-scope.mjs, scripts/local-storage-scopes.mjs

import { describe, expect, it } from 'vitest';
import {
  ALIAS_KEY,
  ALL_KEYS,
  checkLocalStorageScope,
  collectSourceFiles,
  findLocalStorageWrites,
  MARKUP_KEY,
  SCOPES,
  UNKNOWN_KEY,
} from './check-local-storage-scope.mjs';
import { DECLARED_WRITES } from './local-storage-scopes.mjs';

const file = (path: string, ...lines: string[]) => ({ path, content: lines.join('\n') });
const keys = (...lines: string[]) =>
  findLocalStorageWrites(lines.join('\n')).map((write) => write.key);

describe('localStorage scope guard', () => {
  it.each([
    ['localStorage.setItem', "localStorage.setItem('theme', value);", "'theme'"],
    ['localStorage.removeItem', 'localStorage.removeItem(KEY);', 'KEY'],
    ['window.localStorage', 'window.localStorage.setItem(storageKey, raw);', 'storageKey'],
    ['globalThis.localStorage', 'globalThis.localStorage?.setItem(KEY, raw);', 'KEY'],
    ['safeLocalStorage.setItem', "safeLocalStorage.setItem(KEY, '1');", 'KEY'],
    ['safeLocalStorage.setJSON', 'safeLocalStorage.setJSON(keyFor(id), value);', 'keyFor(id)'],
    ['safeLocalStorage.removeItem', 'safeLocalStorage.removeItem(`draft:${id}`);', '`draft:${id}`'],
    ['saga writer called', 'yield* setLocalStorageJSON(KEY, value);', 'KEY'],
    ['saga writer by reference', 'yield* call(setLocalStorageItem, KEY, value);', 'KEY'],
    ['saga remover by reference', 'yield* call(removeLocalStorageItem, KEY);', 'KEY'],
    ['saga tuple', 'yield* call([safeLocalStorage, safeLocalStorage.setJSON], KEY, value);', 'KEY'],
    ['clear', 'localStorage.clear();', ALL_KEYS],
    ['element assignment', 'localStorage[KEY] = value;', 'KEY'],
    ['element delete', 'delete localStorage[KEY];', 'KEY'],
    ['alias in a variable', 'const storage = window.localStorage;', ALIAS_KEY],
    ['alias as an argument', 'savePreference(localStorage, value);', ALIAS_KEY],
    ['alias returned', 'const getStorage = () => localStorage;', ALIAS_KEY],
    ['writer stored in a variable', 'const write = setLocalStorageJSON;', UNKNOWN_KEY],
    [
      'key split over lines',
      'localStorage.setItem(\n  keyFor(\n    id,\n  ),\n  value,\n);',
      'keyFor( id, )',
    ],
  ])('finds a write through %s', (_name, source, key) => {
    expect(keys(source)).toEqual([key]);
  });

  it.each([
    ['a read', 'const raw = localStorage.getItem(KEY);'],
    ['a safe read', 'const value = safeLocalStorage.getJSON(KEY);'],
    ['a saga read', 'const value = yield* call(getLocalStorageJSON, KEY);'],
    ['an availability test', "if (typeof localStorage === 'undefined') return;"],
    ['a key listing', 'const all = Object.keys(localStorage);'],
    ['a length read', 'for (let i = 0; i < localStorage.length; i++) localStorage.key(i);'],
    ['an import', "import { setLocalStorageJSON } from './safe-local-storage-saga';"],
    ['a write in a comment', "// localStorage.setItem('theme', value)"],
    ['a write in a string', 'const hint = "localStorage.setItem(\'theme\', value)";'],
    ['a write in a template', 'const page = `<script>localStorage.setItem("theme", t)</script>`;'],
    ['another object with setItem', "sessionStorage.setItem('k', value); cache.setItem(k, v);"],
    ['a shared preference', "const pref = sharedPreference({ key: 'k', scope: 'app', parse });"],
  ])('ignores %s', (_name, source) => {
    expect(keys(source)).toEqual([]);
  });

  it('reads Svelte script blocks and fails closed on writes in markup', () => {
    const component = (markup: string) =>
      [
        '<script lang="ts">',
        '  const save = () => safeLocalStorage.setItem(KEY, value);',
        '</script>',
        markup,
      ].join('\n');
    expect(findLocalStorageWrites(component('<p>Saved</p>'), 'A.svelte')).toEqual([
      { line: 2, key: 'KEY', text: 'const save = () => safeLocalStorage.setItem(KEY, value);' },
    ]);
    const inMarkup = "<button onclick={() => localStorage.setItem('k', 'v')} />";
    expect(
      findLocalStorageWrites(component(inMarkup), 'A.svelte').map(({ line, key }) => [line, key]),
    ).toEqual([
      [2, 'KEY'],
      [4, MARKUP_KEY],
    ]);
  });

  it('passes a declared write and reports an undeclared one', () => {
    const files = [
      file(
        'src/a.ts',
        'localStorage.setItem(CACHE_KEY, raw);',
        'localStorage.setItem(NEW_KEY, raw);',
      ),
      file('src/b.ts', 'const raw = localStorage.getItem(KEY);'),
    ];
    const declared = { 'src/a.ts': { CACHE_KEY: ['cache', 'derived from the daemon'] } };
    expect(checkLocalStorageScope(files, declared)).toEqual({
      undeclared: [
        { path: 'src/a.ts', line: 2, key: 'NEW_KEY', text: 'localStorage.setItem(NEW_KEY, raw);' },
      ],
      stale: [],
      invalid: [],
      unreadable: [],
    });
  });

  it('reports a declaration that matches no write, or has no known scope and reason', () => {
    const files = [
      file('src/a.ts', 'localStorage.setItem(A, raw);', 'localStorage.setItem(B, raw);'),
      file('src/c.ts', 'localStorage.setItem(C, raw);'),
    ];
    const declared = {
      'src/a.ts': { A: ['everywhere', 'unknown scope'], B: ['cache', ' '], GONE: ['cache', 'old'] },
      'src/c.ts': { C: 'cache' },
      'src/removed.ts': { KEY: ['view', 'file was deleted'] },
    };
    const { undeclared, stale, invalid } = checkLocalStorageScope(files, declared as never);
    expect(undeclared).toEqual([]);
    expect(stale).toEqual([
      { path: 'src/a.ts', key: 'GONE' },
      { path: 'src/removed.ts', key: 'KEY' },
    ]);
    expect(invalid).toEqual([
      { path: 'src/a.ts', key: 'A' },
      { path: 'src/a.ts', key: 'B' },
      { path: 'src/c.ts', key: 'C' },
    ]);
  });

  it('never lets a declaration cover a write in Svelte markup', () => {
    const files = [
      file('src/A.svelte', "<button onclick={() => localStorage.setItem('k', 'v')} />"),
    ];
    const declared = { 'src/A.svelte': { [MARKUP_KEY]: ['dev', 'not allowed'] } };
    expect(checkLocalStorageScope(files, declared).undeclared).toHaveLength(1);
  });

  it('skips tests and the storage helper modules, and reports files it cannot parse', () => {
    const write = 'localStorage.setItem(KEY, raw);';
    const result = checkLocalStorageScope(
      [
        file('src/a.test.ts', write),
        file('src/__tests__/a.ts', write),
        file('src/lib/utils/safe-storage.ts', write),
        file('src/lib/utils/shared-preference.ts', write),
        file('src/broken.ts', 'const x = {', write),
      ],
      {},
    );
    expect(result.undeclared.map((hit) => hit.path)).toEqual(['src/broken.ts']);
    expect(result.unreadable.map((hit) => hit.path)).toEqual(['src/broken.ts']);
  });

  it('passes on the repository with every declaration in use', () => {
    expect(checkLocalStorageScope(collectSourceFiles(process.cwd()))).toEqual({
      undeclared: [],
      stale: [],
      invalid: [],
      unreadable: [],
    });
    for (const declarations of Object.values(DECLARED_WRITES)) {
      for (const [scope] of Object.values(declarations)) expect(SCOPES).toHaveProperty(scope);
    }
  });
});
