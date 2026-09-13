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
const ASYNC_STAGES = new Set(['success', 'failure']);
const SELF = 'scripts/check-unconsumed-actions.mjs';
// The ownership gate does not track takeLatestByContext; this rule does, so a
// (pattern, getContext, worker) watcher counts as an explicit consumer.
const PATTERN_CONTEXT_WATCHERS = new Set([...CONTEXT_WATCHERS, 'takeLatestByContext']);
const PATTERN_EFFECTS = new Set([...WILDCARD_EFFECTS, 'takeLatestByContext']);
const NO_MAIN_STORE =
  'main-process store bridge is neutralized (src/store/main/redux-store-bridge.ts mainDispatch is a no-op); no saga middleware or reducer observes main-store actions';
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
  {
    pattern: /terminals-slice\.ts#createTerminalRequested$/,
    rationale:
      'Pre-existing dead dispatch: no reducer case, watcher, or predicate observes it (dispatched from CommandPalette.svelte and menu-ipc-saga.ts putForWorkspace); listed so the gate can land without src/ changes',
  },
  {
    pattern: /terminals-slice\.ts#closeActiveTerminalRequested$/,
    rationale:
      'Pre-existing dead dispatch: no reducer case, watcher, or predicate observes it (dispatched from src/features/terminal/TerminalAdapter.ts); listed so the gate can land without src/ changes',
  },
  {
    pattern: /agent-session-slice\.ts#agentSessionRegenerateFromMessageRequested$/,
    rationale:
      'Pre-existing dead dispatch: no reducer case, watcher, predicate, or mutation middleware observes it (dispatched from ChatPanel.svelte handleRegenerateFromMessage); listed so the gate can land without src/ changes',
  },
  {
    pattern: /src\/store\/main\/slices\/terminal-events\/terminal-events-slice\.ts#/,
    rationale: `Dispatched via mainDispatch from src/features/terminal/main/terminal.ipc.ts; ${NO_MAIN_STORE}`,
  },
  {
    pattern:
      /src\/store\/main\/slices\/workspace-events\/workspace-events-slice\.ts#emitWorkspaceEvent$/,
    rationale: `Dispatched via mainDispatch from src/features/events/main and src/features/log/main; ${NO_MAIN_STORE}`,
  },
  {
    pattern:
      /src\/store\/main\/slices\/workspace-lifecycle-events\/workspace-lifecycle-events-slice\.ts#/,
    rationale: `Dispatched via mainDispatch from src/features/workspace/main/workspace.service.ts; ${NO_MAIN_STORE}`,
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
    if (filePath.includes('.test.')) continue;
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

export function inspectUnconsumedActions(files) {
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
    if (UNCONSUMED_ACTION_EXCEPTIONS.some(({ pattern }) => pattern.test(origin))) {
      exceptionCount++;
      continue;
    }
    const { filePath, line, name } = actions.get(origin);
    violations.push(
      `${filePath}:${line}: action ${name} is dispatched but has no reducer case or explicit watcher; dispatched at ${[...sites].sort().join(', ')}`,
    );
  }
  for (const { pattern } of UNCONSUMED_ACTION_EXCEPTIONS) {
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
