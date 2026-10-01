import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import {
  CONTEXT_WATCHERS,
  WILDCARD_EFFECTS,
  createProvenanceResolvers,
  effectBindingsFor,
  effectForExpression,
  lineFor,
  localArray,
  normalize,
  visit,
  watcherPattern,
} from './check-saga-watcher-ownership.mjs';

const SLICE_SOURCE = /^src\/store\/.+\/slices\/.+-slice\.ts$/;
const SCRIPT_BLOCK = /<script\b[^>]*>([\s\S]*?)<\/script>/g;
// Test-only sources never count as consumers: *.test.*, *.spec.* (incl. .ct.spec /
// .visual.spec), and anything under __tests__/ or __mocks__/.
const TEST_SOURCE = /(?:\.(?:test|spec)\.|(?:^|\/)__(?:tests|mocks)__\/)/;
const ASYNC_STAGES = new Set(['success', 'failure']);
const SELF = 'scripts/check-unconsumed-actions.mjs';
// The ownership gate does not track takeLatestByContext; this rule does, so a
// (pattern, getContext, worker) watcher counts as an explicit consumer.
const PATTERN_CONTEXT_WATCHERS = new Set([...CONTEXT_WATCHERS, 'takeLatestByContext']);
const PATTERN_EFFECTS = new Set([...WILDCARD_EFFECTS, 'takeLatestByContext']);
// Exceptions are anchored per action (`<slice file>#<action name>$`), never per
// file, so a new dispatch in the same slice is not silently exempted. Each entry
// names the non-syntactic consumer that observes the action (today: a predicate
// comparing `action.type` inside a named `actionChannel` filter, which the
// scanner does not follow). An entry whose pattern matches no action origin at all
// fails the gate as stale, so exceptions cannot outlive the action they cover.
//
// Analysis bounds — the gate is syntactic:
// - Actions: top-level `const x = createAction(...)` / `createAsyncAction(...)`
//   declarations in slice files (plus the derived `.success` / `.failure`
//   stages), resolved through the same provenance resolvers as the
//   watcher-ownership gate.
// - Dispatches: any call of a resolved creator (`creator(...)`,
//   `creator.success(...)`), wherever it appears.
// - Consumers: `reducer.with(pattern, ...)` and the recognized watcher effects
//   (`take*`, `actionChannel`, `takeLatestByContext`, ...) whose pattern is a
//   creator, a local creator array, a `creator.type` access, or the literal
//   type string. Inline actionChannel predicates may return finite positive
//   type equalities / disjunctions, with read-only guards and const payload aliases.
//   Every surviving branch must name a type; expansion is capped at 64 branches.
//   Named predicates, control flow, mutations and calls inside predicates are
//   deliberately unsupported; this is not general satisfiability analysis.
// Not covered: creators reached through aliases or re-exports the resolvers
// do not follow, hand-built plain action objects (`{ type: 'x/y' }`), and
// watcher wrappers such as `fork(takeLeading, pattern, worker)` — those
// dispatch or consume without the shapes above and are neither flagged nor
// credited.
const UNCONSUMED_ACTION_EXCEPTIONS = [
  {
    pattern: /settings-events-slice\.ts#settingsChanged$/,
    rationale:
      'Observed by the touchesModelResolutionSettings predicate (action.type === settingsChanged.type) feeding actionChannel(triggersSpecialistRefetch, ...) in src/store/renderer/slices/specialists/sagas/specialists-saga.ts',
  },
  {
    pattern: /specialists-slice\.ts#refetchSpecialistsRequested$/,
    rationale:
      'Observed by the triggersSpecialistRefetch predicate (action.type === refetchSpecialistsRequested.type) feeding actionChannel(triggersSpecialistRefetch, ...) in src/store/renderer/slices/specialists/sagas/specialists-saga.ts',
  },
];

// Keep only the <script> blocks of a .svelte file, padded so line numbers match.
function svelteScript(content) {
  let script = '';
  let emittedLines = 0;
  for (const match of content.matchAll(SCRIPT_BLOCK)) {
    const start = match.index + match[0].length - '</script>'.length - match[1].length;
    const precedingLines = content.slice(0, start).split('\n').length - 1;
    script += '\n'.repeat(precedingLines - emittedLines) + match[1];
    emittedLines = precedingLines + match[1].split('\n').length - 1;
  }
  return script;
}

function loadSources(files) {
  const sources = new Map();
  for (const file of files) {
    const filePath = normalize(file.path);
    if (TEST_SOURCE.test(filePath)) continue;
    let content;
    if (filePath.endsWith('.ts')) content = file.content;
    else if (filePath.endsWith('.svelte')) content = svelteScript(file.content);
    else continue;
    sources.set(
      filePath,
      ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS),
    );
  }
  return sources;
}

function collectActions(sources, actionFactory) {
  const actions = new Map();
  const typeIndex = new Map();
  const register = (origin, action) => {
    actions.set(origin, action);
    for (const type of action.types) typeIndex.set(type, origin);
  };
  for (const [filePath, source] of sources) {
    if (!SLICE_SOURCE.test(filePath) || source.parseDiagnostics.length > 0) continue;
    for (const statement of source.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        const initializer = declaration.initializer;
        if (!ts.isIdentifier(declaration.name) || !initializer || !ts.isCallExpression(initializer))
          continue;
        const factory = actionFactory.resolveExpression(filePath, initializer.expression);
        if (!factory) continue;
        const name = declaration.name.text;
        const origin = `${filePath}#${name}`;
        const line = lineFor(source, declaration);
        const types = initializer.arguments.filter(ts.isStringLiteralLike).map((arg) => arg.text);
        register(origin, { filePath, line, name, types });
        if (factory.name !== 'createAsyncAction') continue;
        // Themis derives the stage types from the second (stages) type argument.
        const stages = types[1];
        for (const stage of ASYNC_STAGES) {
          register(`${origin}.${stage}`, {
            filePath,
            line,
            name: `${name}.${stage}`,
            types: stages ? [`${stages}_${stage.toUpperCase()}`] : [],
          });
        }
      }
    }
  }
  return { actions, typeIndex };
}

// Bind one file lazily: the existing provenance resolver follows module exports,
// while the TypeScript binder distinguishes imports from same-named local bindings.
function predicateBindings(source) {
  const options = { noResolve: true, noLib: true };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = (fileName) => (fileName === source.fileName ? source : undefined);
  const checker = ts.createProgram([source.fileName], options, host).getTypeChecker();
  const symbol = (node) => checker.getSymbolAtLocation(node);
  const sourceReference = (node, seen = new Set()) => {
    if (ts.isPropertyAccessExpression(node)) return sourceReference(node.expression, seen);
    if (!ts.isIdentifier(node)) return false;
    const binding = symbol(node);
    if (!binding || seen.has(binding) || binding.declarations?.length !== 1) return false;
    const declaration = binding.declarations[0];
    if (ts.isImportSpecifier(declaration) || ts.isNamespaceImport(declaration)) return true;
    if (
      !ts.isVariableDeclaration(declaration) ||
      !ts.isVariableDeclarationList(declaration.parent) ||
      !(declaration.parent.flags & ts.NodeFlags.Const) ||
      declaration.parent.parent.parent !== source
    )
      return false;
    seen.add(binding);
    // A creator factory call is resolved by the existing action provenance gate.
    return (
      declaration.initializer &&
      (ts.isCallExpression(declaration.initializer) ||
        sourceReference(declaration.initializer, seen))
    );
  };
  return { symbol, sourceReference };
}

function unwrap(expression) {
  while (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isNonNullExpression(expression) ||
    ts.isSatisfiesExpression(expression)
  )
    expression = expression.expression;
  return expression;
}

// This is deliberately a bounded expression interpreter, not a search for `.type`
// anywhere in a callback. Every possible returned branch must positively name an
// action; unsupported syntax invalidates the predicate instead of broadening it.
function inlineChannelConsumers(pattern, bindings, resolveType) {
  const predicate = unwrap(pattern);
  if (
    !(ts.isArrowFunction(predicate) || ts.isFunctionExpression(predicate)) ||
    predicate.asteriskToken ||
    predicate.modifiers?.some((item) => item.kind === ts.SyntaxKind.AsyncKeyword) ||
    predicate.parameters.length !== 1
  )
    return [];
  const parameter = predicate.parameters[0];
  if (!ts.isIdentifier(parameter.name) || parameter.initializer || parameter.dotDotDotToken)
    return [];
  const owner = bindings.symbol(parameter.name);
  const aliases = new Map();
  const expand = (node) => {
    node = unwrap(node);
    return ts.isIdentifier(node) && aliases.has(bindings.symbol(node))
      ? expand(aliases.get(bindings.symbol(node)))
      : node;
  };
  const literal = (node) => {
    if (ts.isStringLiteralLike(node)) return { value: node.text };
    if (ts.isNumericLiteral(node)) return { value: Number(node.text) };
    if (node.kind === ts.SyntaxKind.TrueKeyword) return { value: true };
    if (node.kind === ts.SyntaxKind.FalseKeyword) return { value: false };
    if (node.kind === ts.SyntaxKind.NullKeyword) return { value: null };
    if (ts.isIdentifier(node) && !bindings.symbol(node)?.declarations?.length) {
      if (node.text === 'undefined') return { value: undefined };
      if (node.text === 'NaN') return { value: NaN };
    }
    return undefined;
  };
  // Read-only guard expressions. Calls, assignments, nested functions, dynamic
  // indexing, and type checks on a foreign object never establish consumption.
  const valueKey = (input) => {
    const node = expand(input);
    const constant = literal(node);
    if (constant) return `literal:${typeof constant.value}:${String(constant.value)}`;
    if (ts.isIdentifier(node)) return `id:${node.text}`;
    if (ts.isPropertyAccessExpression(node) && node.name.text !== 'type') {
      const base = valueKey(node.expression);
      // Dot/bracket and optional spelling identify the same static property.
      // Structured keys keep payload["a.b"] distinct from payload.a.b.
      return base && JSON.stringify(['get', base, node.name.text]);
    }
    if (ts.isElementAccessExpression(node) && literal(unwrap(node.argumentExpression))) {
      // Bracket spelling must not bypass the dedicated owner/type analysis.
      if (literal(unwrap(node.argumentExpression)).value === 'type') return undefined;
      const base = valueKey(node.expression);
      return (
        base &&
        JSON.stringify(['get', base, String(literal(unwrap(node.argumentExpression)).value)])
      );
    }
    if (ts.isTypeOfExpression(node)) {
      const operand = valueKey(node.expression);
      return operand && `typeof:${operand}`;
    }
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
      const operand = valueKey(node.operand);
      return operand && `!${operand}`;
    }
    if (ts.isConditionalExpression(node)) {
      const parts = [node.condition, node.whenTrue, node.whenFalse].map(valueKey);
      return parts.every(Boolean) ? JSON.stringify(parts) : undefined;
    }
    if (
      ts.isBinaryExpression(node) &&
      [
        ts.SyntaxKind.AmpersandAmpersandToken,
        ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.EqualsEqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsEqualsToken,
      ].includes(node.operatorToken.kind)
    ) {
      const parts = [valueKey(node.left), valueKey(node.right)];
      return parts.every(Boolean) ? JSON.stringify([node.operatorToken.kind, ...parts]) : undefined;
    }
    return undefined;
  };
  // Compound values require evaluation, not opaque equality facts: for example
  // `(enabled && false) === true` cannot be credited as an unknown owner guard.
  // Refuse them here rather than attempting general boolean/value reasoning.
  const comparisonKey = (input) => {
    const node = expand(input);
    if (ts.isTypeOfExpression(node)) {
      const operand = comparisonKey(node.expression);
      return operand && `typeof:${operand}`;
    }
    if (
      ts.isBinaryExpression(node) ||
      ts.isConditionalExpression(node) ||
      ts.isPrefixUnaryExpression(node)
    )
      return undefined;
    return valueKey(node);
  };
  let returned = predicate.body;
  if (ts.isBlock(returned)) {
    const statements = returned.statements;
    const last = statements.at(-1);
    if (!last || !ts.isReturnStatement(last) || !last.expression) return [];
    for (const statement of statements.slice(0, -1)) {
      if (
        !ts.isVariableStatement(statement) ||
        !(statement.declarationList.flags & ts.NodeFlags.Const)
      )
        return [];
      for (const declaration of statement.declarationList.declarations) {
        if (
          !ts.isIdentifier(declaration.name) ||
          !declaration.initializer ||
          !valueKey(declaration.initializer)
        )
          return [];
        const binding = bindings.symbol(declaration.name);
        // Reject self/forward references, including references inside an alias's
        // initializer. This also keeps recursive alias expansion impossible.
        let forward = false;
        visit(declaration.initializer, (node) => {
          if (!ts.isIdentifier(node)) return;
          const referenced = bindings.symbol(node)?.valueDeclaration;
          if (
            referenced &&
            ts.isVariableDeclaration(referenced) &&
            referenced.parent.parent.parent === predicate.body &&
            !aliases.has(bindings.symbol(node))
          )
            forward = true;
        });
        if (forward) return [];
        aliases.set(binding, declaration.initializer);
      }
    }
    returned = last.expression;
  }
  const ownType = (input) => {
    const node = expand(input);
    return (
      ts.isPropertyAccessExpression(node) &&
      !node.questionDotToken &&
      node.name.text === 'type' &&
      ts.isIdentifier(expand(node.expression)) &&
      bindings.symbol(expand(node.expression)) === owner
    );
  };
  const originFor = (input) => {
    const node = expand(input);
    if (ts.isStringLiteralLike(node)) return resolveType(node);
    return ts.isPropertyAccessExpression(node) &&
      node.name.text === 'type' &&
      bindings.sourceReference(node.expression)
      ? resolveType(node)
      : undefined;
  };
  const branch = (type = undefined, facts = new Map()) => ({ type, facts });
  const merge = (left, right) => {
    if (left.type && right.type && left.type !== right.type) return undefined;
    const facts = new Map(left.facts);
    for (const [key, value] of right.facts) {
      if (facts.has(key) && facts.get(key) !== value) return undefined;
      facts.set(key, value);
    }
    return branch(left.type ?? right.type, facts);
  };
  const evaluate = (input) => {
    const node = expand(input);
    const constant = literal(node);
    if (constant) return constant.value ? [branch()] : [];
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind;
      if (op === ts.SyntaxKind.AmpersandAmpersandToken || op === ts.SyntaxKind.BarBarToken) {
        const left = evaluate(node.left);
        const right = evaluate(node.right);
        if (!left || !right) return undefined;
        if (op === ts.SyntaxKind.BarBarToken) {
          // Even an enclosing type guard does not turn a broad OR into an
          // explicit finite consumer. False arms, however, contribute nothing.
          if ([...left, ...right].some((item) => !item.type)) return undefined;
          return left.length + right.length <= 64 ? [...left, ...right] : undefined;
        }
        if (left.length * right.length > 64) return undefined;
        return left.flatMap((a) => right.map((b) => merge(a, b)).filter(Boolean));
      }
      if (op === ts.SyntaxKind.EqualsEqualsEqualsToken) {
        const origin = ownType(node.left)
          ? originFor(node.right)
          : ownType(node.right)
            ? originFor(node.left)
            : undefined;
        if (origin) return [branch(origin, new Map([[`truth:${valueKey(parameter.name)}`, true]]))];
      }
      if (
        op === ts.SyntaxKind.EqualsEqualsEqualsToken ||
        op === ts.SyntaxKind.ExclamationEqualsEqualsToken
      ) {
        const left = comparisonKey(node.left);
        const right = comparisonKey(node.right);
        if (!left || !right) return undefined;
        const a = literal(expand(node.left));
        const b = literal(expand(node.right));
        const equal = op === ts.SyntaxKind.EqualsEqualsEqualsToken;
        // The intrinsic NaN is never strictly equal to any value, including
        // itself. literal() leaves shadowed identifiers as ordinary guard values.
        if ((a && Number.isNaN(a.value)) || (b && Number.isNaN(b.value)))
          return equal ? [] : [branch()];
        if ((a && b) || left === right)
          return (a && b ? a.value === b.value : true) === equal ? [branch()] : [];
        const facts = new Map([[JSON.stringify([left, right].sort()), equal]]);
        // Distinct strict literal equalities for the same value cannot both hold.
        if (equal && (a || b)) {
          const key = a ? right : left;
          facts.set(`equal:${key}`, a ? left : right);
          facts.set(`truth:${key}`, Boolean((a ?? b).value));
        }
        return [branch(undefined, facts)];
      }
      return undefined;
    }
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
      const operand = expand(node.operand);
      const value = literal(operand);
      if (value) return value.value ? [] : [branch()];
      if (
        !ts.isIdentifier(operand) &&
        !ts.isPropertyAccessExpression(operand) &&
        !ts.isElementAccessExpression(operand)
      )
        return undefined;
      const key = valueKey(operand);
      return key ? [branch(undefined, new Map([[`truth:${key}`, false]]))] : undefined;
    }
    // A conditional return is outside the finite equality grammar. Conditional
    // payload aliases remain usable as read-only values in owner guards.
    if (ts.isConditionalExpression(node)) return undefined;
    const key = valueKey(node);
    return key ? [branch(undefined, new Map([[`truth:${key}`, true]]))] : undefined;
  };
  const branches = evaluate(returned);
  return branches && branches.every((item) => item.type)
    ? [...new Set(branches.map((item) => item.type))]
    : [];
}

export function inspectUnconsumedActions(
  files,
  { exceptions = UNCONSUMED_ACTION_EXCEPTIONS } = {},
) {
  const sources = loadSources(files);
  const provenance = createProvenanceResolvers(sources, {
    contextWatchers: PATTERN_CONTEXT_WATCHERS,
  });
  const { actions, typeIndex } = collectActions(sources, provenance.actionFactory);
  const dispatches = new Map();
  const handled = new Set();

  const resolveCreator = (filePath, expression) => {
    const direct = provenance.actions.resolveExpression(filePath, expression)?.origin;
    if (direct && actions.has(direct)) return direct;
    if (!ts.isPropertyAccessExpression(expression) || !ASYNC_STAGES.has(expression.name.text))
      return undefined;
    const base = resolveCreator(filePath, expression.expression);
    const stage = base && `${base}.${expression.name.text}`;
    return stage && actions.has(stage) ? stage : undefined;
  };
  const resolvePattern = (filePath, expression) => {
    if (ts.isStringLiteralLike(expression)) return typeIndex.get(expression.text);
    if (ts.isPropertyAccessExpression(expression) && expression.name.text === 'type') {
      const base = resolveCreator(filePath, expression.expression);
      if (base) return base;
    }
    return resolveCreator(filePath, expression);
  };

  for (const [filePath, source] of sources) {
    if (source.parseDiagnostics.length > 0) continue;
    const { effectNames, effectNamespaces } = effectBindingsFor(
      source,
      filePath,
      provenance.effects,
    );
    let bindings;
    visit(source, (node) => {
      if (!ts.isCallExpression(node)) return;
      const dispatched = resolveCreator(filePath, node.expression);
      if (dispatched) {
        const sites = dispatches.get(dispatched) ?? new Set();
        sites.add(`${filePath}:${lineFor(source, node)}`);
        dispatches.set(dispatched, sites);
      }
      const callee = node.expression;
      if (
        ts.isPropertyAccessExpression(callee) &&
        callee.name.text === 'with' &&
        node.arguments[0]
      ) {
        const origin = resolvePattern(filePath, node.arguments[0]);
        if (origin) handled.add(origin);
      }
      const effect = effectForExpression(callee, effectNames, effectNamespaces);
      if (!effect || !PATTERN_EFFECTS.has(effect)) return;
      const pattern = watcherPattern(effect, node);
      if (!pattern) return;
      if (
        effect === 'actionChannel' &&
        (ts.isArrowFunction(unwrap(pattern)) || ts.isFunctionExpression(unwrap(pattern)))
      ) {
        bindings ??= predicateBindings(source);
        if (bindings.sourceReference(callee)) {
          for (const origin of inlineChannelConsumers(pattern, bindings, (expression) =>
            resolvePattern(filePath, expression),
          ))
            handled.add(origin);
        }
      }
      const candidates = localArray(source, pattern);
      for (const candidate of candidates.length > 0 ? candidates : [pattern]) {
        const origin = resolvePattern(filePath, candidate);
        if (origin) handled.add(origin);
      }
    });
  }

  const violations = [];
  let exceptionCount = 0;
  const origins = [...actions.keys()].sort(
    (left, right) =>
      actions.get(left).filePath.localeCompare(actions.get(right).filePath) ||
      actions.get(left).line - actions.get(right).line ||
      left.localeCompare(right),
  );
  for (const origin of origins) {
    const sites = dispatches.get(origin);
    if (!sites || handled.has(origin)) continue;
    if (exceptions.some(({ pattern }) => pattern.test(origin))) {
      exceptionCount++;
      continue;
    }
    const { filePath, line, name } = actions.get(origin);
    violations.push(
      `${filePath}:${line}: action ${name} is dispatched but has no reducer case or explicit watcher; dispatched at ${[...sites].sort().join(', ')}`,
    );
  }
  for (const { pattern } of exceptions) {
    if (!origins.some((origin) => pattern.test(origin)))
      violations.push(`${SELF}: stale exception ${pattern} matches no action origin`);
  }
  return {
    violations,
    actionCount: actions.size,
    dispatchedCount: dispatches.size,
    exceptionCount,
  };
}

function collectFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectFiles(absolute));
    else if (entry.name.endsWith('.ts') || entry.name.endsWith('.svelte'))
      files.push({
        path: normalize(path.relative(process.cwd(), absolute)),
        content: fs.readFileSync(absolute, 'utf8'),
      });
  }
  return files;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = inspectUnconsumedActions(collectFiles(path.resolve('src')));
  if (result.violations.length) {
    console.error(
      ['Unconsumed action violations:', ...result.violations.map((item) => `- ${item}`)].join('\n'),
    );
    process.exit(1);
  }
  console.log(
    `Unconsumed action check valid: ${result.actionCount} actions, ${result.dispatchedCount} dispatched, ${result.exceptionCount} exceptions.`,
  );
}
