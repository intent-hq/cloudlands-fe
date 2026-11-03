import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { analyze } from 'eslint-scope';
import { compile, preprocess } from 'svelte/compiler';
import { parseAst, transformWithEsbuild } from 'vite';

/**
 * Message keys the production i18n bundle ships. Packaged builds load only
 * the keys found here, so a missed reference is a runtime
 * "m.<key> is not a function" crash (cloudlands-fe#2865, #4034).
 *
 * Keys come from a scope-aware walk of the compiled JavaScript AST, not
 * from the source text: the messages import is followed through every
 * reference, alias, destructuring pattern and dynamic `import()`. A use
 * whose keys cannot be determined statically (a computed lookup, a rest
 * pattern, the messages object passed around as a value) is reported as a
 * problem so the build fails instead of shipping a gap. The production Vite
 * build runs the same analysis on its real module graph and fails on any
 * key the bundle lacks (vite.config.mjs, use-production-paraglide-bundle).
 */

/** Same match as the `use-production-paraglide-bundle` resolveId hook. */
export function isMessagesSource(source) {
  return typeof source === 'string' && source.endsWith('/paraglide/messages.js');
}

function children(node) {
  const result = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === 'parent') continue;
    for (const child of Array.isArray(value) ? value : [value]) {
      if (child && typeof child.type === 'string') result.push(child);
    }
  }
  return result;
}

function propertyName(node, computed) {
  if (!computed && node.type === 'Identifier') return node.name;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  return null;
}

/**
 * Keys a compiled ES module reads from the Paraglide messages module.
 *
 * @param {object} program ESTree `Program` with `start`/`end` offsets (Rollup's AST).
 * @returns {{ keys: string[], problems: { start: number, end: number, reason: string }[] }}
 */
export function messageReferencesInProgram(program) {
  const parents = new Map();
  const messageNodes = [];
  const stack = [program];
  while (stack.length > 0) {
    const node = stack.pop();
    // eslint-scope resolves references by `range`; Rollup's AST carries offsets only.
    node.range ??= [node.start, node.end];
    if (
      (node.type === 'ImportDeclaration' ||
        node.type === 'ImportExpression' ||
        node.type === 'ExportNamedDeclaration' ||
        node.type === 'ExportAllDeclaration') &&
      node.source?.type === 'Literal' &&
      isMessagesSource(node.source.value)
    ) {
      messageNodes.push(node);
    }
    for (const child of children(node)) {
      parents.set(child, node);
      stack.push(child);
    }
  }
  if (messageNodes.length === 0) return { keys: [], problems: [] };

  const scopeManager = analyze(program, { ecmaVersion: 2024, sourceType: 'module' });
  const variableByIdentifier = new Map();
  for (const scope of scopeManager.scopes) {
    for (const variable of scope.variables) {
      for (const identifier of variable.identifiers) variableByIdentifier.set(identifier, variable);
    }
  }

  const keys = new Set();
  const problems = [];
  const followedVariables = new Set();
  const unsupported = (node, reason) => problems.push({ start: node.start, end: node.end, reason });

  function followVariable(identifier) {
    const variable = variableByIdentifier.get(identifier);
    if (!variable) return unsupported(identifier, 'messages binding has no resolvable scope');
    if (followedVariables.has(variable)) return;
    followedVariables.add(variable);
    // Importers read an exported alias without importing messages themselves,
    // so neither this scan nor the build check would see their keys.
    if (variable.defs.some((def) => parents.get(def.parent)?.type === 'ExportNamedDeclaration')) {
      return unsupported(identifier, 'exported messages alias hides which keys are used');
    }
    for (const reference of variable.references) {
      if (reference.isRead()) followValue(reference.identifier);
    }
  }

  function followPattern(pattern) {
    if (pattern.type === 'Identifier') return followVariable(pattern);
    if (pattern.type === 'AssignmentPattern') return followPattern(pattern.left);
    if (pattern.type !== 'ObjectPattern') {
      return unsupported(pattern, 'messages destructured into a non-object pattern');
    }
    for (const property of pattern.properties) {
      if (property.type === 'RestElement') {
        unsupported(property, 'rest pattern over messages hides which keys are used');
        continue;
      }
      const name = propertyName(property.key, property.computed);
      if (name === null) unsupported(property, 'computed key destructured from messages');
      else if (name === 'm') followPattern(property.value);
      else keys.add(name);
    }
  }

  /** A promise of the messages module, consumed via await or `.then`. */
  function followPromise(node, element) {
    let parent = parents.get(node);
    // typed-redux-saga: `yield* call(() => promise)` evaluates to the promise's value.
    if (parent?.type === 'ArrowFunctionExpression' && parent.body === node) {
      const effect = parents.get(parent);
      if (
        effect?.type === 'CallExpression' &&
        effect.arguments[0] === parent &&
        effect.callee.type === 'Identifier' &&
        effect.callee.name === 'call' &&
        parents.get(effect)?.type === 'YieldExpression'
      ) {
        node = effect;
        parent = parents.get(effect);
      }
    }
    const settle = (pattern) => {
      if (element === undefined) return followPattern(pattern);
      if (pattern?.type === 'ArrayPattern' && pattern.elements[element]) {
        return followPattern(pattern.elements[element]);
      }
      return unsupported(node, 'messages promise result is not destructured by position');
    };
    if (parent?.type === 'AwaitExpression' || parent?.type === 'YieldExpression') {
      const owner = parents.get(parent);
      if (owner?.type === 'VariableDeclarator' && owner.init === parent) return settle(owner.id);
      if (parent.type === 'AwaitExpression' && element === undefined) return followValue(parent);
      return unsupported(parent, 'awaited messages promise is not assigned');
    }
    if (
      parent?.type === 'MemberExpression' &&
      parent.object === node &&
      propertyName(parent.property, parent.computed) === 'then'
    ) {
      const call = parents.get(parent);
      const callback =
        call?.type === 'CallExpression' && call.callee === parent && call.arguments[0];
      if (callback && /Function/.test(callback.type)) {
        if (callback.params.length === 0) return;
        return settle(callback.params[0]);
      }
    }
    return unsupported(node, 'messages import promise is used in an unsupported way');
  }

  /**
   * Vite's production build rewrites `import(x)` before plugins see the AST:
   * `__vitePreload(() => import(x), deps)`, or for `const { a } = await
   * import(x)`, `__vitePreload(async () => { const { a } = await import(x);
   * return { a } }, deps)`. Both resolve to the module the original
   * expression produced, so analysis continues from the wrapper call.
   */
  function unwrapVitePreload(importExpression) {
    let scope = parents.get(importExpression);
    while (scope && !/Function/.test(scope.type)) scope = parents.get(scope);
    const call = scope && parents.get(scope);
    if (
      scope?.type === 'ArrowFunctionExpression' &&
      call?.type === 'CallExpression' &&
      call.arguments[0] === scope &&
      call.callee.type === 'Identifier' &&
      call.callee.name === '__vitePreload'
    ) {
      return call;
    }
    return importExpression;
  }

  /** `node` evaluates to the messages module namespace or its `m` object. */
  function followValue(node) {
    const parent = parents.get(node);
    if (!parent) return unsupported(node, 'messages used as a value');
    if (parent.type === 'MemberExpression' && parent.object === node) {
      const name = propertyName(parent.property, parent.computed);
      if (name === null) return unsupported(parent, 'computed message lookup');
      if (name === 'm') return followValue(parent);
      keys.add(name);
      return;
    }
    if (parent.type === 'ChainExpression' || parent.type === 'ParenthesizedExpression') {
      return followValue(parent);
    }
    if (parent.type === 'VariableDeclarator' && parent.init === node) {
      return followPattern(parent.id);
    }
    if (
      parent.type === 'AssignmentExpression' &&
      parent.right === node &&
      parent.left.type === 'ObjectPattern'
    ) {
      return followPattern(parent.left);
    }
    // `typeof m` and `void m` read no message.
    if (
      parent.type === 'UnaryExpression' &&
      (parent.operator === 'typeof' || parent.operator === 'void')
    ) {
      return;
    }
    return unsupported(node, 'messages object escapes as a value');
  }

  for (const node of messageNodes) {
    if (node.type === 'ImportDeclaration') {
      if (node.importKind === 'type') continue;
      for (const specifier of node.specifiers) {
        if (specifier.importKind === 'type') continue;
        if (specifier.type === 'ImportSpecifier') {
          const name = propertyName(specifier.imported, false);
          if (name === 'm') followVariable(specifier.local);
          else if (name !== null) keys.add(name);
        } else {
          followVariable(specifier.local);
        }
      }
    } else if (node.type === 'ImportExpression') {
      const promise = unwrapVitePreload(node);
      const parent = parents.get(promise);
      const call = parent && parents.get(parent);
      if (
        parent?.type === 'ArrayExpression' &&
        call?.type === 'CallExpression' &&
        call.arguments[0] === parent &&
        call.callee.type === 'MemberExpression' &&
        propertyName(call.callee.property, call.callee.computed) === 'all'
      ) {
        followPromise(call, parent.elements.indexOf(promise));
      } else {
        followPromise(promise);
      }
    } else if (node.exportKind !== 'type') {
      unsupported(node, 're-exporting messages hides which keys are used');
    }
  }
  return { keys: [...keys].sort(), problems };
}

/** Compile one `.svelte`/`.ts`/`.js` source to the JavaScript the bundler parses. */
export async function compileToJavaScript(source, file) {
  if (file.endsWith('.svelte')) {
    // Styles carry no message references; drop them so PostCSS-only syntax
    // does not need the app's preprocessors.
    const stripped = await preprocess(source, { style: () => ({ code: '' }) }, { filename: file });
    return compile(stripped.code, { filename: file, generate: 'client', css: 'external' }).js.code;
  }
  if (file.endsWith('.ts')) {
    return (await transformWithEsbuild(source, file, { loader: 'ts' })).code;
  }
  return source;
}

/** Human-readable `file: reason (snippet)` lines for analysis problems. */
export function formatProblems(file, code, problems) {
  return problems.map(({ start, end, reason }) => {
    const snippet = code.slice(start, Math.min(end, start + 80)).replace(/\s+/g, ' ');
    return `${file}: ${reason} — \`${snippet}\``;
  });
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolutePath) : [absolutePath];
  });
}

/**
 * Sorted catalog keys read by non-test `.svelte`/`.ts` files under
 * `sourceRoot`. Throws when a reference cannot be resolved to keys.
 */
export async function collectUsedMessageKeys(sourceRoot, catalogKeys) {
  const usedKeys = new Set();
  const problems = [];
  for (const file of walk(sourceRoot)) {
    if (!/\.(?:svelte|ts)$/.test(file) || /(?:__tests__|\.test\.|\.spec\.)/.test(file)) continue;
    if (file.endsWith('.d.ts')) continue;
    const source = readFileSync(file, 'utf8');
    if (!source.includes('paraglide/messages.js')) continue;
    const code = await compileToJavaScript(source, file);
    const result = messageReferencesInProgram(parseAst(code));
    for (const key of result.keys) if (catalogKeys.has(key)) usedKeys.add(key);
    problems.push(...formatProblems(path.relative(sourceRoot, file), code, result.problems));
  }
  if (problems.length > 0) {
    throw new Error(
      `Cannot determine which translation messages these references use, so the ` +
        `production i18n bundle could omit them. Read messages as m.<key> or ` +
        `destructure literal keys:\n  ${problems.join('\n  ')}`,
    );
  }
  return [...usedKeys].sort();
}
