import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const ROOT_SAGAS = 'src/store/renderer/sagas.ts';
const SAGA_SOURCE = /^src\/store\/renderer\/slices\/.+\/sagas\/.+\.ts$/;
const GENERIC_CONTEXT_WATCHERS = new Set([
  'takeEveryByContextFIFO',
  'takeLatestInContext',
  'takeLeadingInContext',
  'takeSingleFlightInContext',
]);
const DOMAIN_CONTEXT_WATCHERS = new Set([
  'takeLatestByWorkspace',
  'takeLeadingByWorkspace',
  'takeLatestByAgent',
  'takeLeadingByAgent',
]);
const CONTEXT_WATCHERS = new Set([...GENERIC_CONTEXT_WATCHERS, ...DOMAIN_CONTEXT_WATCHERS]);
const WATCHERS = new Set([
  'takeEvery',
  'takeLatest',
  'takeLeading',
  'throttle',
  'debounce',
  ...CONTEXT_WATCHERS,
]);
const WILDCARD_EFFECTS = new Set([...WATCHERS, 'take', 'takeMaybe', 'actionChannel']);
const EFFECTS = new Set([...WILDCARD_EFFECTS, 'fork', 'spawn', 'call', 'put', 'cancel']);
const ACTION_FACTORIES = new Set(['createAction', 'createAsyncAction']);
const DUPLICATE_WATCHER_EXCEPTIONS = [
  {
    pattern: /workspace-lifecycle-slice\.ts#workspace(?:Deleted|Unmounted|Mounted)$/,
    rationale: 'lifecycle cleanup and restore fan out across independent domains',
  },
  {
    pattern: /app-layout-slice\.ts#openAgentTabRequested$/,
    rationale: 'layout navigation and hardware display synchronization are independent',
  },
  {
    pattern: /chat-state-slice\.ts#(?:initializeChatRequested|sendMessage)$/,
    rationale: 'chat transport and read/subscription or hardware follow-up are independent',
  },
  {
    pattern: /chat-state-slice\.ts#chatTranscriptSnapshotApplied$/,
    rationale: 'hydration error recovery and scrollback segment invalidation are independent',
  },
  {
    pattern: /connections-slice\.ts#connectionsListReceived$/,
    rationale: 'backend layout restore and sidebar reconciliation are independent',
  },
  {
    pattern: /workspace-notes-slice\.ts#applyNote(?:Created|Updated)$/,
    rationale: 'panel layout note reconciliation and semantic-map manifest refresh are independent',
  },
  {
    pattern: /sidebar-nav-slice\.ts#(?:openPanel|closePanel|togglePanel|closeAll|closeHoverCards)$/,
    rationale: 'sidebar ownership and unread-boundary snapshots are independent',
  },
  {
    pattern:
      /panel-layout-slice\.ts#(?:initializeLayout|openTab|openTabInAdjacentOrSplit|openTabInRightmostColumn|closeTab|closeActiveTab|reopenClosedPanelColumn|reopenClosedTab|setActiveTab|activateVisibleTab|moveTabToPanel|moveTabToSplit|moveTabToSplitLevel|closeOtherTabs|closeTabsToRight|closeAllTabs|closeAllOthersEverywhere|splitPanel|closePanel|resetLayout|goBack|goForward)$/,
    rationale:
      'layout persistence, delayed history, and unread boundaries intentionally observe the same actions',
  },
  {
    pattern:
      /panel-layout-slice\.ts#(?:openTabInNewRootColumn|closeTabsByType|closeTabsByAgentId|destroyTabsByOwnerAgent|destroyOwnedTabsForWorkspace|restoreHiddenTab|selectNextTab|selectPreviousTab|reorderTabs|focusPanel|markPanelTouched|updateSizes|updateSplitSizes|resizePanelLayoutRightEdge|resizePanelLayoutAtRootDivider|toggleExpandPanel|goBackInFocusHistory|goForwardInFocusHistory|setDeferSpecTab|observeDeferredSpecGeneration|revealDeferredSpecTab|resolveNewWorkspaceInitialAgent|reconcileStaleAgentTabs|updateTabTitle|updateTabBrowserUrl|updateTabFavicon|updateFileTabPath|consumePendingFocus)$/,
    rationale: 'layout persistence and specialized panel effects are independent',
  },
  {
    pattern: /workspace-slice\.ts#(?:setWorkspaceEntity|setWorkspaceHasLoaded)$/,
    rationale: 'key-pin persistence and deferred first-open layout seeding are independent',
  },
  {
    pattern: /user-preferences-slice\.ts#setPanelColumnCount$/,
    rationale: 'preference persistence and fixed-column reconciliation are independent',
  },
  {
    pattern: /unread-tracking-slice\.ts#markAgentAsViewed$/,
    rationale: 'subscription read prefetch and switch-timing observation are independent',
  },
  {
    pattern: /background-hooks-slice\.ts#backgroundHooksSubscribeRequested$/,
    rationale: 'hooks subscription transport and switch-timing observation are independent',
  },
];

const normalize = (value) => value.split(path.sep).join('/').replace(/^\.\//, '');
const visit = (node, callback) => {
  callback(node);
  ts.forEachChild(node, (child) => visit(child, callback));
};
const lineFor = (source, node) =>
  source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
const lineForDiagnostic = (source, diagnostic) =>
  source.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line + 1;
const isFunction = (node) =>
  ts.isFunctionDeclaration(node) ||
  ts.isFunctionExpression(node) ||
  ts.isArrowFunction(node) ||
  ts.isMethodDeclaration(node);

function moduleCandidates(fromPath, specifier) {
  let base;
  if (specifier.startsWith('.')) base = normalize(path.join(path.dirname(fromPath), specifier));
  else {
    const alias = /^\$(lib|store|features|shared)(?:\/(.*))?$/.exec(specifier);
    if (!alias) return [];
    base = `src/${alias[1]}/${alias[2] ?? ''}`;
  }
  const extensionless = base.replace(/\.(?:[cm]?js|[cm]?ts|tsx)$/, '');
  return [...new Set([base, extensionless, `${extensionless}.ts`, `${extensionless}/index.ts`])];
}

function importsFor(source) {
  const imports = new Map();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue;
    const specifier = statement.moduleSpecifier.text;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const item of bindings.elements) {
      imports.set(item.name.text, {
        imported: item.propertyName?.text ?? item.name.text,
        specifier,
      });
    }
  }
  return imports;
}

function namespaceImportsFor(source) {
  const namespaces = new Map();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) {
      namespaces.set(bindings.name.text, statement.moduleSpecifier.text);
    }
  }
  return namespaces;
}

function effectForExpression(expression, effectNames, effectNamespaces) {
  if (ts.isIdentifier(expression)) return effectNames.get(expression.text);
  if (!ts.isPropertyAccessExpression(expression) || !ts.isIdentifier(expression.expression))
    return undefined;
  return effectNamespaces.get(expression.expression.text)?.get(expression.name.text);
}

function createExportProvenanceResolver(sources, { externalOrigin, localDeclarationOrigin }) {
  const exportMemo = new Map();
  const localMemo = new Map();
  const resolvingExports = new Set();
  const resolvingLocals = new Set();

  const resolveImport = (fromPath, specifier, imported) => {
    const external = externalOrigin?.(specifier, imported);
    if (external) return external;
    const target = resolvedModulePath(sources, fromPath, specifier);
    return target ? resolveExport(target, imported) : undefined;
  };

  const resolveExpression = (filePath, expression) => {
    const source = sources.get(filePath);
    if (!source || source.parseDiagnostics.length > 0) return undefined;
    if (ts.isIdentifier(expression)) return resolveLocal(filePath, expression.text);
    if (!ts.isPropertyAccessExpression(expression) || !ts.isIdentifier(expression.expression))
      return undefined;
    const specifier = namespaceImportsFor(source).get(expression.expression.text);
    return specifier ? resolveImport(filePath, specifier, expression.name.text) : undefined;
  };

  const resolveLocal = (filePath, localName) => {
    const key = `${filePath}#${localName}`;
    if (localMemo.has(key)) return localMemo.get(key) ?? undefined;
    if (resolvingLocals.has(key)) return undefined;
    resolvingLocals.add(key);
    const source = sources.get(filePath);
    let result;
    if (source && source.parseDiagnostics.length === 0) {
      const binding = importsFor(source).get(localName);
      if (binding) result = resolveImport(filePath, binding.specifier, binding.imported);
      if (!result) {
        for (const statement of source.statements) {
          if (!ts.isVariableStatement(statement)) continue;
          const declaration = statement.declarationList.declarations.find(
            (item) => ts.isIdentifier(item.name) && item.name.text === localName,
          );
          if (!declaration || !ts.isIdentifier(declaration.name)) continue;
          result = localDeclarationOrigin?.(filePath, declaration, resolveExpression);
          if (!result && declaration.initializer)
            result = resolveExpression(filePath, declaration.initializer);
          if (result) break;
        }
      }
    }
    resolvingLocals.delete(key);
    localMemo.set(key, result ?? null);
    return result;
  };

  const resolveExport = (filePath, exportName) => {
    const key = `${filePath}#${exportName}`;
    if (exportMemo.has(key)) return exportMemo.get(key) ?? undefined;
    if (resolvingExports.has(key)) return undefined;
    resolvingExports.add(key);
    const source = sources.get(filePath);
    let result;
    if (source && source.parseDiagnostics.length === 0) {
      for (const statement of source.statements) {
        if (
          ts.isVariableStatement(statement) &&
          statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) &&
          statement.declarationList.declarations.some(
            (declaration) =>
              ts.isIdentifier(declaration.name) && declaration.name.text === exportName,
          )
        ) {
          result = resolveLocal(filePath, exportName);
        } else if (ts.isExportDeclaration(statement)) {
          const specifier =
            statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
              ? statement.moduleSpecifier.text
              : undefined;
          if (!statement.exportClause && specifier) {
            result = resolveImport(filePath, specifier, exportName);
          } else if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
            const item = statement.exportClause.elements.find(
              (element) => element.name.text === exportName,
            );
            if (item) {
              const imported = item.propertyName?.text ?? item.name.text;
              result = specifier
                ? resolveImport(filePath, specifier, imported)
                : resolveLocal(filePath, imported);
            }
          }
        }
        if (result) break;
      }
    }
    resolvingExports.delete(key);
    exportMemo.set(key, result ?? null);
    return result;
  };

  return { resolveExport, resolveExpression, resolveImport };
}

function createProvenanceResolvers(sources) {
  const actionFactory = createExportProvenanceResolver(sources, {
    externalOrigin: (specifier, imported) =>
      /(?:^|\/)create-action$/.test(specifier) && ACTION_FACTORIES.has(imported)
        ? { origin: `${specifier}#${imported}`, name: imported }
        : undefined,
  });
  const actions = createExportProvenanceResolver(sources, {
    localDeclarationOrigin: (filePath, declaration) =>
      declaration.initializer &&
      ts.isCallExpression(declaration.initializer) &&
      actionFactory.resolveExpression(filePath, declaration.initializer.expression)
        ? { origin: `${filePath}#${declaration.name.text}`, name: declaration.name.text }
        : undefined,
  });
  const effects = createExportProvenanceResolver(sources, {
    externalOrigin: (specifier, imported) => {
      const native = specifier === 'typed-redux-saga' || specifier === 'redux-saga/effects';
      const contextual = /(?:^|\/)context-saga-effects$/.test(specifier);
      if ((native && EFFECTS.has(imported)) || (contextual && CONTEXT_WATCHERS.has(imported)))
        return { origin: `${specifier}#${imported}`, name: imported };
      return undefined;
    },
  });
  return { actions, effects };
}

function effectBindingsFor(source, filePath, effects) {
  const effectNames = new Map();
  for (const [local, binding] of importsFor(source)) {
    const provenance = effects.resolveImport(filePath, binding.specifier, binding.imported);
    if (provenance) effectNames.set(local, provenance.name);
  }
  const effectNamespaces = new Map();
  for (const [local, specifier] of namespaceImportsFor(source)) {
    const names = new Map();
    const candidates = new Set(EFFECTS);
    visit(source, (node) => {
      if (
        ts.isPropertyAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === local
      )
        candidates.add(node.name.text);
    });
    for (const imported of candidates) {
      const provenance = effects.resolveImport(filePath, specifier, imported);
      if (provenance) names.set(imported, provenance.name);
    }
    if (names.size > 0) effectNamespaces.set(local, names);
  }
  return { effectNames, effectNamespaces };
}

function isImportedReduxPattern(pattern, actions, filePath, actionProvenance) {
  const patterns = actions.length > 0 ? actions : [pattern];
  return patterns.some((candidate) => {
    if (ts.isStringLiteralLike(candidate)) return true;
    return Boolean(actionProvenance.resolveExpression(filePath, candidate));
  });
}

function localArray(source, expression) {
  if (ts.isArrayLiteralExpression(expression)) return expression.elements;
  if (!ts.isIdentifier(expression)) return [];
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === expression.text &&
        declaration.initializer &&
        ts.isArrayLiteralExpression(declaration.initializer)
      ) {
        return declaration.initializer.elements;
      }
    }
  }
  return [];
}

function enclosingFunction(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (isFunction(current)) return current;
  }
  return undefined;
}

function enclosingWhile(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isWhileStatement(current)) return current;
    if (isFunction(current)) return undefined;
  }
  return undefined;
}

function enclosingWorkerCall(node, effectNames, effectNamespaces) {
  for (let current = node.parent; current; current = current.parent) {
    if (
      ts.isCallExpression(current) &&
      current !== node &&
      ['call', 'fork', 'spawn'].includes(
        effectForExpression(current.expression, effectNames, effectNamespaces),
      )
    )
      return current;
    if (ts.isWhileStatement(current) || isFunction(current)) return undefined;
  }
  return undefined;
}

function declarationFor(source, call) {
  for (let current = call.parent; current && current !== source; current = current.parent) {
    if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)) return current;
    if (isFunction(current)) return undefined;
  }
  return undefined;
}

function resultIdentifierFor(source, call) {
  const declaration = declarationFor(source, call);
  if (declaration) return declaration.name;
  for (let current = call.parent; current && current !== source; current = current.parent) {
    if (
      ts.isBinaryExpression(current) &&
      current.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(current.left)
    )
      return current.left;
    if (isFunction(current)) return undefined;
  }
  return undefined;
}

function containsIdentifier(node, name) {
  let found = false;
  visit(node, (child) => {
    if (ts.isIdentifier(child) && child.text === name) found = true;
  });
  return found;
}

function laterWorkerCall(source, node, effectNames, effectNamespaces) {
  const resultIdentifier = resultIdentifierFor(source, node);
  const loop = enclosingWhile(node);
  const owner = enclosingFunction(node);
  if (!resultIdentifier || !loop) return undefined;
  let found;
  visit(loop.statement, (child) => {
    if (
      found ||
      child.pos < node.end ||
      !ts.isCallExpression(child) ||
      enclosingFunction(child) !== owner ||
      !['call', 'fork', 'spawn'].includes(
        effectForExpression(child.expression, effectNames, effectNamespaces),
      )
    )
      return;
    if (
      child.arguments
        .slice(1)
        .some((argument) => containsIdentifier(argument, resultIdentifier.text))
    )
      found = child;
  });
  return found;
}

function containsActionType(node, parameterName) {
  let found = false;
  visit(node, (child) => {
    if (
      ts.isPropertyAccessExpression(child) &&
      child.name.text === 'type' &&
      ts.isIdentifier(child.expression) &&
      child.expression.text === parameterName
    )
      found = true;
  });
  return found;
}

function effectCallCount(node, effectNames, effectNamespaces) {
  let count = 0;
  visit(node, (child) => {
    if (
      ts.isCallExpression(child) &&
      effectForExpression(child.expression, effectNames, effectNamespaces)
    )
      count++;
  });
  return count;
}

function wildcardPattern(effect, call) {
  const index = effect === 'throttle' || effect === 'debounce' ? 1 : 0;
  const pattern = call.arguments[index];
  return (
    (ts.isStringLiteralLike(pattern) && pattern.text === '*') ||
    (ts.isNoSubstitutionTemplateLiteral(pattern) && pattern.text === '*')
  );
}

function watcherPattern(effect, call) {
  return call.arguments[effect === 'throttle' || effect === 'debounce' ? 1 : 0];
}

function watcherWorker(effect, call) {
  if (effect === 'throttle' || effect === 'debounce' || GENERIC_CONTEXT_WATCHERS.has(effect)) {
    return call.arguments[2];
  }
  return call.arguments[1];
}

function resolvedModulePath(sources, fromPath, specifier) {
  return moduleCandidates(fromPath, specifier).find((candidate) => sources.has(candidate));
}

export function inspectSagaWatcherOwnership(files) {
  const sources = new Map(
    files
      .filter((file) => file.path.endsWith('.ts') && !file.path.includes('.test.'))
      .map((file) => {
        const filePath = normalize(file.path);
        return [
          filePath,
          ts.createSourceFile(filePath, file.content, ts.ScriptTarget.Latest, true),
        ];
      }),
  );
  const violations = [];
  const provenance = createProvenanceResolvers(sources);
  const audited = new Set([
    ROOT_SAGAS,
    ...[...sources.keys()].filter((filePath) => SAGA_SOURCE.test(filePath)),
  ]);
  const root = sources.get(ROOT_SAGAS);
  const rootSagas = [];
  if (!root) violations.push(`${ROOT_SAGAS}: root saga registry is missing`);
  else {
    const imports = importsFor(root);
    for (const statement of root.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || declaration.name.text !== 'sagas') continue;
        let array = declaration.initializer;
        while (array && (ts.isAsExpression(array) || ts.isSatisfiesExpression(array)))
          array = array.expression;
        if (!array || !ts.isArrayLiteralExpression(array)) continue;
        for (const element of array.elements) {
          if (!ts.isIdentifier(element)) continue;
          rootSagas.push(element.text);
          const binding = imports.get(element.text);
          const target = binding && resolvedModulePath(sources, ROOT_SAGAS, binding.specifier);
          if (target) audited.add(target);
          else if (!binding && element.text !== 'hardwareConsoleSaga') {
            violations.push(
              `${ROOT_SAGAS}:${lineFor(root, element)}: unresolved root saga ${element.text}`,
            );
          }
        }
      }
    }
    for (const name of new Set(rootSagas)) {
      if (rootSagas.filter((item) => item === name).length > 1)
        violations.push(`${ROOT_SAGAS}: duplicate root saga registration ${name}`);
    }
  }

  // Follow explicitly composed imported child sagas, including children outside
  // the conventional slices/**/sagas tree.
  const queue = [...audited];
  for (let index = 0; index < queue.length; index++) {
    const filePath = queue[index];
    const source = sources.get(filePath);
    if (!source) continue;
    const imports = importsFor(source);
    const { effectNames, effectNamespaces } = effectBindingsFor(
      source,
      filePath,
      provenance.effects,
    );
    const composed = new Set();
    visit(source, (node) => {
      if (!ts.isCallExpression(node)) return;
      const effect = effectForExpression(node.expression, effectNames, effectNamespaces);
      if (!['call', 'fork', 'spawn'].includes(effect)) return;
      const child = node.arguments[0];
      if (child && ts.isIdentifier(child)) composed.add(child.text);
    });
    for (const [local, binding] of imports) {
      if (!composed.has(local) && !/(Saga|Watcher)$/.test(local)) continue;
      const target = resolvedModulePath(sources, filePath, binding.specifier);
      if (target && !audited.has(target)) {
        audited.add(target);
        queue.push(target);
      }
    }
  }

  const watcherOwners = new Map();
  for (const filePath of audited) {
    const source = sources.get(filePath);
    if (!source) continue;
    const diagnostic = source.parseDiagnostics[0];
    if (diagnostic) {
      violations.push(
        `${filePath}:${lineForDiagnostic(source, diagnostic)}: TypeScript parse failure`,
      );
      continue;
    }
    const { effectNames, effectNamespaces } = effectBindingsFor(
      source,
      filePath,
      provenance.effects,
    );
    const typeDeclarations = new Map();
    visit(source, (node) => {
      if ((ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) && node.name)
        typeDeclarations.set(node.name.text, node.getText(source));
    });
    const expandType = (text) => {
      let expanded = text;
      for (let pass = 0; pass < 3; pass++) {
        for (const [name, declaration] of typeDeclarations) {
          if (new RegExp(`\\b${name}\\b`).test(expanded) && !expanded.includes(declaration))
            expanded += ` ${declaration}`;
        }
      }
      return expanded;
    };
    const executionFactories = new Set();
    visit(source, (node) => {
      if (!ts.isFunctionDeclaration(node) || !node.name) return;
      let createsExecution = false;
      visit(node, (child) => {
        if (
          ts.isCallExpression(child) &&
          ['fork', 'spawn'].includes(
            effectForExpression(child.expression, effectNames, effectNamespaces),
          )
        )
          createsExecution = true;
      });
      if (createsExecution) executionFactories.add(node.name.text);
    });
    const executionResults = new Set();
    visit(source, (node) => {
      if (!ts.isCallExpression(node)) return;
      const effect = effectForExpression(node.expression, effectNames, effectNamespaces);
      if (!effect) return;
      const first = node.arguments[0];
      if (WILDCARD_EFFECTS.has(effect) && wildcardPattern(effect, node))
        violations.push(
          `${filePath}:${lineFor(source, node)}: wildcard Redux watcher ${effect}("*")`,
        );

      if (effect === 'fork' || effect === 'spawn') {
        const declaration = declarationFor(source, node);
        if (declaration) executionResults.add(declaration.name.text);
      } else if (effect === 'call' && node.arguments[0] && ts.isIdentifier(node.arguments[0])) {
        const declaration = declarationFor(source, node);
        if (declaration && executionFactories.has(node.arguments[0].text))
          executionResults.add(declaration.name.text);
      }

      const pattern = WATCHERS.has(effect) ? watcherPattern(effect, node) : first;
      const actions = pattern ? localArray(source, pattern) : [];
      if (
        (effect === 'take' || effect === 'takeMaybe') &&
        pattern &&
        enclosingWhile(node) &&
        (enclosingWorkerCall(node, effectNames, effectNamespaces) ||
          laterWorkerCall(source, node, effectNames, effectNamespaces))
      ) {
        if (isImportedReduxPattern(pattern, actions, filePath, provenance.actions))
          violations.push(
            `${filePath}:${lineFor(source, node)}: manual Redux watcher loop; use a native watcher effect`,
          );
      }
      if ((effect === 'take' || effect === 'takeMaybe') && actions.length > 1) {
        const resultIdentifier = resultIdentifierFor(source, node);
        const owner = enclosingFunction(node);
        if (resultIdentifier && owner) {
          let routesByType = false;
          visit(owner, (child) => {
            if (
              ts.isPropertyAccessExpression(child) &&
              child.name.text === 'type' &&
              ts.isIdentifier(child.expression) &&
              child.expression.text === resultIdentifier.text
            )
              routesByType = true;
          });
          if (routesByType)
            violations.push(
              `${filePath}:${lineFor(source, node)}: manual multi-action Redux router`,
            );
        }
      }

      if (WATCHERS.has(effect) && pattern) {
        const watched = actions.length > 0 ? actions : [pattern];
        for (const action of watched) {
          const origin =
            ts.isStringLiteralLike(action) && action.text !== '*'
              ? `action-type:${action.text}`
              : provenance.actions.resolveExpression(filePath, action)?.origin;
          if (!origin) continue;
          const owners = watcherOwners.get(origin) ?? [];
          owners.push(`${filePath}:${lineFor(source, node)}`);
          watcherOwners.set(origin, owners);
        }

        const worker = watcherWorker(effect, node);
        if (actions.length > 1 && worker && ts.isIdentifier(worker)) {
          const declaration = source.statements.find(
            (statement) =>
              ts.isFunctionDeclaration(statement) && statement.name?.text === worker.text,
          );
          if (
            declaration &&
            declaration.parameters[0] &&
            ts.isIdentifier(declaration.parameters[0].name)
          ) {
            const parameter = declaration.parameters[0].name.text;
            let routedBranches = 0;
            visit(declaration.body, (child) => {
              if (ts.isIfStatement(child) && containsActionType(child.expression, parameter)) {
                if (effectCallCount(child.thenStatement, effectNames, effectNamespaces) > 0)
                  routedBranches++;
                if (
                  child.elseStatement &&
                  effectCallCount(child.elseStatement, effectNames, effectNamespaces) > 0
                )
                  routedBranches++;
              } else if (
                ts.isSwitchStatement(child) &&
                containsActionType(child.expression, parameter)
              ) {
                routedBranches += child.caseBlock.clauses.filter(
                  (clause) => effectCallCount(clause, effectNames, effectNamespaces) > 0,
                ).length;
              }
            });
            if (effect !== 'takeEveryByContextFIFO' && routedBranches > 1)
              violations.push(
                `${filePath}:${lineFor(source, declaration)}: shared action.type execution dispatcher`,
              );
          }
        }
      }
    });

    visit(source, (node) => {
      if (
        !ts.isNewExpression(node) ||
        !ts.isIdentifier(node.expression) ||
        !['Map', 'Set'].includes(node.expression.text)
      )
        return;
      const declaration =
        node.parent && ts.isVariableDeclaration(node.parent) ? node.parent : undefined;
      if (!declaration || !ts.isIdentifier(declaration.name)) return;
      const scope = enclosingFunction(node) ?? source;
      const name = declaration.name.text;
      const typeText = expandType(
        `${declaration.type?.getText(source) ?? ''} ${node.typeArguments?.map((arg) => arg.getText(source)).join(' ') ?? ''}`,
      );
      const externalResource = /(EventChannel|Channel<|subscriptionId|unsubscribe|dispose)/i.test(
        typeText,
      );
      const executionType = /\b(Task|SagaTask|WorkerSlot|TrackedTask)\b/i.test(typeText);
      const executionName = /(running|workers?|slots?|debounc|fetch|restore|history)/i.test(name);
      const explicitDomainType =
        /^\s*(?:string|number|boolean)\s*$/i.test(typeText) ||
        /<(?:string|number|boolean)(?:\s*[>,])|\{\s*(?:value|state|snapshot|generation)\b/i.test(
          typeText,
        );
      let storesExecution = false;
      let cancelsEntries = false;
      visit(scope, (child) => {
        if (
          ts.isCallExpression(child) &&
          ts.isPropertyAccessExpression(child.expression) &&
          ts.isIdentifier(child.expression.expression) &&
          child.expression.expression.text === name &&
          ['set', 'add'].includes(child.expression.name.text)
        ) {
          storesExecution ||= child.arguments.some((argument) =>
            [...executionResults].some((result) => containsIdentifier(argument, result)),
          );
        }
        if (
          ts.isCallExpression(child) &&
          effectForExpression(child.expression, effectNames, effectNamespaces) === 'cancel' &&
          containsIdentifier(child, name)
        )
          cancelsEntries = true;
      });
      if (
        !externalResource &&
        (executionType ||
          storesExecution ||
          cancelsEntries ||
          (executionName && !explicitDomainType))
      )
        violations.push(
          `${filePath}:${lineFor(source, node)}: saga-local execution registry ${name}`,
        );
    });
  }
  for (const [origin, owners] of watcherOwners) {
    const exception = DUPLICATE_WATCHER_EXCEPTIONS.find(({ pattern }) => pattern.test(origin));
    if (owners.length < 2 || exception) continue;
    violations.push(
      `${owners[1]}: duplicate watcher ownership for ${origin}; first owned by ${owners[0]}`,
    );
  }
  return {
    violations,
    auditedFiles: [...audited].sort(),
    rootSagas,
    watcherCount: watcherOwners.size,
  };
}

function collectFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectFiles(absolute));
    else if (entry.name.endsWith('.ts'))
      files.push({
        path: normalize(path.relative(process.cwd(), absolute)),
        content: fs.readFileSync(absolute, 'utf8'),
      });
  }
  return files;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = inspectSagaWatcherOwnership(collectFiles(path.resolve('src')));
  if (result.violations.length) {
    console.error(
      ['Saga watcher ownership violations:', ...result.violations.map((item) => `- ${item}`)].join(
        '\n',
      ),
    );
    process.exit(1);
  }
  console.log(
    `Saga watcher ownership valid: ${result.rootSagas.length} roots, ${result.auditedFiles.length} source files, ${result.watcherCount} action owners.`,
  );
}
