import { describe, expect, it } from 'vitest';
import { inspectReducerShape } from './check-reducer-shape.mjs';

const moduleImport =
  "import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';";
const rendererPath = 'src/store/renderer/slices/example/example-slice.ts';
const mainPath = 'src/store/main/slices/example/example-slice.ts';

function inspect(content: string, path = rendererPath) {
  return inspectReducerShape([{ path, content }]);
}

describe('reducer direct-export shape guard', () => {
  it('accepts direct exports and standalone registrations in any action order', () => {
    const result = inspect(
      [
        moduleImport,
        'export const reducer = createReducer({ value: 0 });',
        'schema.with(rule);',
        'reducer.with(secondAction, secondHandler);',
        'helper.register(reducer);',
        'reducer.with(firstAction, firstHandler);',
      ].join('\n'),
    );
    expect(result).toEqual({ violations: [], reducerCount: 1, registrationCount: 2 });
  });

  it('rejects a chained createReducer export', () => {
    const result = inspect(
      `${moduleImport}\nexport const reducer = createReducer({}).with(action, handler);`,
    );
    expect(result.violations).toEqual([
      expect.stringContaining('createReducer result must be a direct exported const'),
    ]);
  });

  it('rejects createReducer nested inside helper registrations', () => {
    const result = inspect(
      `${moduleImport}\nexport const reducer = outer.register(inner.register(createReducer({})));`,
    );
    expect(result).toEqual({
      violations: [expect.stringContaining('createReducer result must be a direct exported const')],
      reducerCount: 0,
      registrationCount: 0,
    });
  });

  it('rejects assigned and returned reducer.with results', () => {
    const result = inspect(
      [
        moduleImport,
        'export const reducer = createReducer({});',
        'const assigned = reducer.with(action, handler);',
        'export function register() { return reducer.with(otherAction, otherHandler); }',
      ].join('\n'),
    );
    expect(result.violations).toHaveLength(2);
    expect(result.violations).toEqual([
      expect.stringContaining('must be a standalone expression statement'),
      expect.stringContaining('must be a standalone expression statement'),
    ]);
  });

  it('ignores unrelated .with methods and files outside production reducer paths', () => {
    expect(inspect('schema.with(rule);').violations).toEqual([]);
    expect(
      inspectReducerShape([
        { path: 'src/store/renderer/slices/example/example-slice.test.ts', content: 'x.with(y);' },
        { path: 'docs/example.ts', content: 'x.with(y);' },
      ]).violations,
    ).toEqual([]);
  });

  it('ignores unrelated helper registrations when no createReducer is involved', () => {
    expect(inspect('export const value = outer.register(inner.register(builder));')).toEqual({
      violations: [],
      reducerCount: 0,
      registrationCount: 0,
    });
  });

  it('fails closed on malformed source', () => {
    expect(inspect(`${moduleImport}\nexport const reducer = createReducer({;`).violations).toEqual([
      expect.stringContaining('TypeScript parse failure'),
    ]);
  });

  it('follows named, namespace, and local createReducer aliases', () => {
    const named = inspect(
      "import { createReducer as makeReducer } from '@augmentcode/themis/utils/store/create-reducer';\nexport const reducer = makeReducer({});\nreducer.with(action, handler);",
    );
    const namespace = inspect(
      "import * as reducers from '@augmentcode/themis/utils/store/create-reducer';\nconst makeReducer = reducers.createReducer;\nexport const reducer = makeReducer({});",
    );
    expect(named).toEqual({ violations: [], reducerCount: 1, registrationCount: 1 });
    expect(namespace).toEqual({ violations: [], reducerCount: 1, registrationCount: 0 });
  });

  it('rejects export expressions and reassignment of direct reducers', () => {
    const result = inspect(
      [
        moduleImport,
        'export const reducer = createReducer({});',
        'export default reducer.with(action, handler);',
        'reducer = replacement;',
      ].join('\n'),
    );
    expect(result.violations).toEqual([
      expect.stringContaining('must be a standalone expression statement'),
      expect.stringContaining('must not be reassigned'),
    ]);
  });

  it('covers production main and renderer reducer paths', () => {
    const files = [rendererPath, mainPath].map((path) => ({
      path,
      content: `${moduleImport}\nexport const reducer = createReducer({});\nreducer.with(action, handler);`,
    }));
    expect(inspectReducerShape(files)).toEqual({
      violations: [],
      reducerCount: 2,
      registrationCount: 2,
    });
  });
});
