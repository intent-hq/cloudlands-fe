import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import typescriptParser from '@typescript-eslint/parser';
import { parseForESLint } from 'svelte-eslint-parser';
import ts from 'typescript';

// `--report` emits the complete site inventory (including path, signature,
// classification, intended owner, and retained-UI rationale). Update this reviewed
// snapshot only after inspecting that report; the default command fails closed.
const REVIEWED_INVENTORY_DIGEST =
  '6645dfd7cea22c1802f298caca9139b3807bb9d3f2b0faa51fc8eff3b1781001';
const REVIEWED_INVENTORY_COUNTS = {
  'approved lifecycle seam :: async-subscription': 2,
  'approved lifecycle seam :: client-ipc': 3,
  'approved lifecycle seam :: dom-subscription': 10,
  'approved lifecycle seam :: ipc': 4,
  'approved lifecycle seam :: timer': 6,
  'component-local UI behavior :: dom-subscription': 326,
  'component-local UI behavior :: timer': 298,
  'infrastructure adapter :: async-subscription': 16,
  'infrastructure adapter :: client-ipc': 337,
  'infrastructure adapter :: dom-subscription': 5,
  'infrastructure adapter :: ipc': 85,
  'infrastructure adapter :: ipc-registration': 141,
  'infrastructure adapter :: service-factory': 5,
  'infrastructure adapter :: timer': 52,
  'saga-owned business logic :: async-subscription': 54,
  'saga-owned business logic :: client-ipc': 344,
  'saga-owned business logic :: debounce-retry-poll': 17,
  'saga-owned business logic :: dom-subscription': 160,
  'saga-owned business logic :: ipc': 129,
  'saga-owned business logic :: ipc-registration': 1,
  'saga-owned business logic :: network': 4,
  'saga-owned business logic :: storage': 85,
  'saga-owned business logic :: timer': 340,
};

const INVENTORY_EXCLUDED_PATH_PARTS = [
  '/__mocks__/',
  '/__tests__/',
  '/component-catalog/',
  '/generated/',
  '/main/',
  '/tests/',
];

const INFRASTRUCTURE_PATH_PATTERNS = [
  /\.client\.[cm]?[jt]s$/,
  /(?:^|\/)client\//,
  /(?:^|\/)(?:browser-)?(?:websocket|electron-ipc|backend)-transport\.[cm]?[jt]s$/,
  /(?:^|\/)seeders\//,
  /(?:^|\/)middlewares\//,
  /src\/lib\/electron-bridge\.ts$/,
  /src\/store\/renderer\/utils\/(?:backend-scoped-storage|backend-storage-namespace|ipc-channel|safe-local-storage-saga)\.ts$/,
  /src\/store\/utils\/store-guard-middleware\.ts$/,
];

const LIFECYCLE_PATHS = new Set([
  'src/routes/+layout.svelte',
  'src/routes/(app)/+layout.svelte',
  'src/store/renderer/app-store-lifecycle.ts',
  'src/store/renderer/configured-store.ts',
  'src/store/renderer/mock-bootstrap.ts',
]);

const SIDE_EFFECT_IMPORT_PATTERN =
  /(?:^|[./-])(?:api|backend-request|client|electron-bridge|ipc|repository|sdk)(?:[./-]|$)/i;
const DOMAIN_IMPORT_SOURCE_PATTERN =
  /(?:^\$store\/|(?:^|[./$-])(?:api|apis|client|clients|provider|providers|service|services|repository|repositories|sdk|ipc|slice|slices|poll|retry|debounce)(?:[./$-]|$))/i;
const CLIENT_ROOT_PATTERN = /^(?:appClient|backendClient|client|electronAPI|ipc)$/i;
const TIMER_NAMES = new Set(['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval']);
const SUBSCRIPTION_METHODS = new Set(['addListener', 'listenSync', 'once', 'subscribe']);
const DOM_SUBSCRIPTION_METHODS = new Set(['addEventListener', 'removeEventListener']);
const DIRECT_DOMAIN_EFFECT_CUE_PATTERN =
  /\b(?:appClient|backendRequest|electronAPI|fetch|indexedDB|invoke|localStorage|onSave|sessionStorage)\b/;
const DOMAIN_TIMER_CUE_PATTERN =
  /\b(?:backendRequest|fetch|invoke|onSave|handleRefresh|save|persist|refresh|load|poll|retry|debounce)\s*\(|\b(?:save|persist|refresh|fetch|load|poll|retry|debounce)[A-Z0-9_][A-Za-z0-9_]*\s*\(|\b[A-Za-z0-9_]+(?:Save|Persist|Refresh|Fetch|Load|Poll|Retry|Debounce)[A-Za-z0-9_]*\s*\(|\b(?:appClient|backendRequest|electronAPI|fetch|indexedDB|invoke|localStorage|sessionStorage)\b|\b(?:[A-Za-z0-9_]+(?:Save|Persist|Refresh|Fetch|Load|Poll|Retry|Debounce|Auth)|(?:auth|save|persist|refresh|fetch|load|poll|retry|debounce))(?:Timeout|Timer|Interval)\b|\b[A-Z0-9_]*(?:SAVE|PERSIST|REFRESH|FETCH|LOAD|POLL|RETRY|DEBOUNCE|AUTH)_(?:TIMEOUT|TIMER|INTERVAL)(?:_MS)?\b/;

function isProductionRendererFile(filePath) {
  if (!isRendererSource(filePath)) return false;
  if (INVENTORY_EXCLUDED_PATH_PARTS.some((part) => filePath.includes(part))) return false;
  if (/(?:\.test|\.spec|\.generated)\.[^.]+$/.test(filePath)) return false;
  if (filePath.includes('/routes/(app)/test-') || filePath.includes('/routes/observability/')) {
    return false;
  }
  return /\.(?:[cm]?[jt]s|svelte)$/.test(filePath);
}

function isSideEffectImportSource(source) {
  return (
    SIDE_EFFECT_IMPORT_PATTERN.test(source) && !/(?:^|[/.-])client-logger(?:[/.-]|$)/i.test(source)
  );
}

function isDomainImportSource(source) {
  return typeof source === 'string' && DOMAIN_IMPORT_SOURCE_PATTERN.test(source);
}

function rootIdentifier(node) {
  let current = node;
  while (
    current &&
    (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current))
  ) {
    current = current.expression;
  }
  return current && ts.isIdentifier(current) ? current.text : undefined;
}

function staticCalleeName(expression) {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (
    ts.isElementAccessExpression(expression) &&
    ts.isStringLiteral(expression.argumentExpression)
  ) {
    return expression.argumentExpression.text;
  }
  return undefined;
}

function normalizeSignature(text) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 200) return normalized;
  const digest = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 12);
  return `${normalized.slice(0, 180)}…#${digest}`;
}

function targetSagaForPath(filePath) {
  const routes = [
    [
      /settings|preference|provider|mcp/i,
      'src/store/renderer/slices/settings-events/sagas/settings-hydration-saga.ts',
    ],
    [/auth|connection/i, 'src/store/renderer/slices/connections/sagas/connections-saga.ts'],
    [/git|change|commit|pull-request|pr-/i, 'src/store/renderer/slices/git/sagas/git-read-saga.ts'],
    [/file|editor|search|mention/i, 'src/store/renderer/slices/files/sagas/files-read-saga.ts'],
    [
      /onboarding|initializer/i,
      'src/store/renderer/slices/workspace-initializer/sagas/workspace-initializer-saga.ts',
    ],
    [/chat/i, 'src/store/renderer/slices/chat-state/sagas/chat-read-saga.ts'],
    [/agent/i, 'src/store/renderer/slices/agent-session/sagas/agent-mutation-saga.ts'],
    [
      /note|comment|tiptap/i,
      'src/store/renderer/slices/workspace-notes/sagas/workspace-notes-saga.ts',
    ],
    [/terminal|script/i, 'src/store/renderer/slices/terminals/sagas/terminal-persistence-saga.ts'],
    [/browser|websocket/i, 'src/store/renderer/slices/app-layout/sagas/browser-ipc-saga.ts'],
    [
      /hardware-console/i,
      'src/store/renderer/slices/hardware-console/sagas/hardware-console-device-saga.ts',
    ],
    [/voice/i, 'src/store/renderer/slices/voice-settings/sagas/voice-settings-saga.ts'],
    [/release-notes/i, 'src/store/renderer/slices/release-notes/sagas/release-notes-saga.ts'],
    [/auto-update/i, 'src/store/renderer/slices/auto-update/sagas/auto-update-saga.ts'],
    [
      /background-hook/i,
      'src/store/renderer/slices/background-hooks/sagas/background-hooks-saga.ts',
    ],
    [/notification/i, 'src/store/renderer/slices/notifications/sagas/notifications-saga.ts'],
    [/daemon|backend/i, 'src/store/renderer/slices/daemon-health/sagas/daemon-health-saga.ts'],
    [/context/i, 'src/store/renderer/slices/context/sagas/context-saga.ts'],
    [/stats|token/i, 'src/store/renderer/slices/stats/sagas/stats-read-saga.ts'],
    [/workspace/i, 'src/store/renderer/slices/workspace-lifecycle/sagas/lifecycle-read-saga.ts'],
    [
      /layout|panel|navigation|theme|window/i,
      'src/store/renderer/slices/app-layout/sagas/app-layout-navigation-saga.ts',
    ],
  ];
  return (
    routes.find(([pattern]) => pattern.test(filePath))?.[1] ??
    'src/store/renderer/slices/workspace-operations/sagas/workspace-operations-saga.ts'
  );
}

function classifyInventorySite(filePath, kind, { domainTimer = false } = {}) {
  if (filePath.includes('/sagas/') || /-saga\.[cm]?[jt]s$/.test(filePath)) {
    return {
      classification: 'saga-owned business logic',
      owner: filePath,
      rationale: 'The owning saga provides cancellation and ordering for this domain effect.',
    };
  }
  if (INFRASTRUCTURE_PATH_PATTERNS.some((pattern) => pattern.test(filePath))) {
    return {
      classification: 'infrastructure adapter',
      owner: filePath,
      rationale: 'This module is a reviewed transport, storage, middleware, or IPC adapter seam.',
    };
  }
  if (LIFECYCLE_PATHS.has(filePath)) {
    return {
      classification: 'approved lifecycle seam',
      owner: filePath,
      rationale: 'This seam starts, stops, or connects root-owned renderer infrastructure.',
    };
  }
  if (kind === 'dom-subscription' && filePath.endsWith('.svelte')) {
    return {
      classification: 'component-local UI behavior',
      owner: filePath,
      rationale: 'The listener binds to and is cleaned up with this component’s rendered DOM.',
    };
  }
  if (kind === 'timer' && filePath.endsWith('.svelte') && !domainTimer) {
    return {
      classification: 'component-local UI behavior',
      owner: filePath,
      rationale:
        'This call only schedules or cleans up transient presentation state for the component.',
    };
  }
  return {
    classification: 'saga-owned business logic',
    owner: targetSagaForPath(filePath),
    rationale: `Migrate this ${kind} site to the named slice saga; the current direct call is staged legacy.`,
  };
}

function containsName(text, names) {
  return [...names].some((name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`).test(text);
  });
}

function classifyCall({
  calleeName,
  rootName,
  calleeText,
  callText,
  sideEffectImports,
  domainFunctionNames = new Set(),
  domainImportNames = new Set(),
  isSagaFile = false,
}) {
  if (calleeName === 'fetch') return { kind: 'network' };
  if (calleeName === 'backendRequest') return { kind: 'client-ipc' };
  if (calleeName && TIMER_NAMES.has(calleeName)) {
    return {
      kind: 'timer',
      domainTimer:
        DOMAIN_TIMER_CUE_PATTERN.test(callText) || containsName(callText, domainFunctionNames),
    };
  }
  const domainRoot =
    rootName &&
    (CLIENT_ROOT_PATTERN.test(rootName) ||
      sideEffectImports.has(rootName) ||
      domainImportNames.has(rootName));
  const domainCallee =
    calleeName &&
    (sideEffectImports.has(calleeName) ||
      domainImportNames.has(calleeName) ||
      domainFunctionNames.has(calleeName));
  if (
    calleeName &&
    /^(?:debounce|retry|poll)(?:[A-Z0-9_]|$)/.test(calleeName) &&
    (domainRoot || domainCallee || isSagaFile || calleeName === 'debounce')
  ) {
    return { kind: 'debounce-retry-poll' };
  }
  if (calleeName && DOM_SUBSCRIPTION_METHODS.has(calleeName)) {
    return { kind: 'dom-subscription' };
  }
  if (
    (calleeName && SUBSCRIPTION_METHODS.has(calleeName)) ||
    (calleeName === 'on' && calleeText.includes('electronAPI'))
  ) {
    return { kind: 'async-subscription' };
  }
  if (calleeName === 'invoke' || calleeName === 'send') return { kind: 'ipc' };
  if (
    calleeName &&
    ['getItem', 'setItem', 'removeItem', 'clear'].includes(calleeName) &&
    ['indexedDB', 'localStorage', 'sessionStorage'].includes(rootName ?? '')
  ) {
    return { kind: 'storage' };
  }
  if (rootName === 'indexedDB') return { kind: 'storage' };
  if (calleeName && ['registerMockIpcHandler', 'addMockIpcListener'].includes(calleeName)) {
    return { kind: 'ipc-registration' };
  }
  if (
    (rootName && (CLIENT_ROOT_PATTERN.test(rootName) || sideEffectImports.has(rootName))) ||
    (!rootName && calleeName && sideEffectImports.has(calleeName))
  ) {
    return { kind: 'client-ipc' };
  }
  return null;
}

function detectTypeScriptSideEffectSites(file) {
  const sites = [];
  const source = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true);
  const sideEffectImports = new Set();
  const domainImportNames = new Set();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    const sourceText = statement.moduleSpecifier.text;
    if (!isSideEffectImportSource(sourceText) && !isDomainImportSource(sourceText)) continue;
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly) continue;
    const target = isSideEffectImportSource(sourceText) ? sideEffectImports : domainImportNames;
    if (clause.name) target.add(clause.name.text);
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) target.add(bindings.name.text);
    if (bindings && ts.isNamedImports(bindings)) {
      for (const item of bindings.elements) {
        if (!item.isTypeOnly) target.add(item.name.text);
      }
    }
  }
  const addSite = (node, kind, metadata = {}) => {
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    const signature = normalizeSignature(node.getText(source));
    sites.push({
      kind,
      line,
      signature,
      ...classifyInventorySite(file.path, kind, metadata),
    });
  };
  const visit = (node) => {
    if (
      (ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) &&
      node.name &&
      ts.isIdentifier(node.name) &&
      /^create[A-Za-z0-9_]*(?:Service|Middleware|ReduxBridge)$/.test(node.name.text)
    ) {
      addSite(node.name, 'service-factory');
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const result = classifyCall({
        calleeName: staticCalleeName(callee),
        rootName: rootIdentifier(callee),
        calleeText: callee.getText(source),
        callText: node.getText(source),
        sideEffectImports,
        domainImportNames,
        isSagaFile: file.path.includes('/sagas/') || /-saga\.[cm]?[jt]s$/.test(file.path),
      });
      if (result) addSite(node, result.kind, result);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return sites;
}

function unwrapEstree(node) {
  let current = node;
  while (
    current &&
    ['ChainExpression', 'TSAsExpression', 'TSTypeAssertion', 'TSNonNullExpression'].includes(
      current.type,
    )
  ) {
    current = current.expression;
  }
  return current;
}

function estreeStaticPropertyName(node) {
  const current = unwrapEstree(node);
  if (current?.type !== 'MemberExpression') return null;
  const property = unwrapEstree(current.property);
  if (!current.computed && property?.type === 'Identifier') return property.name;
  if (property?.type === 'Literal' && typeof property.value === 'string') return property.value;
  return null;
}

function estreeCalleeName(node) {
  const current = unwrapEstree(node);
  if (current?.type === 'Identifier') return current.name;
  return estreeStaticPropertyName(current);
}

function estreeRootIdentifier(node) {
  let current = unwrapEstree(node);
  while (current?.type === 'MemberExpression') current = unwrapEstree(current.object);
  return current?.type === 'Identifier' ? current.name : undefined;
}

function detectSvelteSideEffectSites(file) {
  const { ast, visitorKeys } = parseForESLint(file.content, {
    filePath: file.path,
    parser: typescriptParser,
  });
  const sites = [];
  const sideEffectImports = new Set();
  const domainImportNames = new Set();
  const text = (node) => file.content.slice(node.range[0], node.range[1]);
  const nodes = [];
  const collectNodes = (node) => {
    nodes.push(node);
    for (const key of visitorKeys[node.type] ?? []) {
      const child = node[key];
      if (Array.isArray(child)) child.forEach((entry) => entry && collectNodes(entry));
      else if (child) collectNodes(child);
    }
  };
  collectNodes(ast);
  for (const node of nodes) {
    if (
      node.type === 'ImportDeclaration' &&
      (isSideEffectImportSource(node.source.value) || isDomainImportSource(node.source.value))
    ) {
      const target = isSideEffectImportSource(node.source.value)
        ? sideEffectImports
        : domainImportNames;
      for (const specifier of node.specifiers) {
        if (specifier.importKind !== 'type') target.add(specifier.local.name);
      }
    }
  }
  const functionBodies = new Map();
  for (const node of nodes) {
    if (node.type === 'FunctionDeclaration' && node.id) {
      functionBodies.set(node.id.name, text(node.body));
    } else if (
      node.type === 'VariableDeclarator' &&
      node.id.type === 'Identifier' &&
      ['ArrowFunctionExpression', 'FunctionExpression'].includes(node.init?.type)
    ) {
      functionBodies.set(node.id.name, text(node.init.body));
    }
  }
  const domainFunctionNames = new Set(
    [...functionBodies.keys()].filter((name) =>
      /^(?:debounce|retry|poll)(?:[A-Z0-9_]|$)/.test(name),
    ),
  );
  let discoveredDomainFunction = true;
  while (discoveredDomainFunction) {
    discoveredDomainFunction = false;
    for (const [name, body] of functionBodies) {
      if (
        !domainFunctionNames.has(name) &&
        (DIRECT_DOMAIN_EFFECT_CUE_PATTERN.test(body) ||
          containsName(body, sideEffectImports) ||
          containsName(body, domainFunctionNames))
      ) {
        domainFunctionNames.add(name);
        discoveredDomainFunction = true;
      }
    }
  }
  const addSite = (node, kind, metadata = {}) => {
    const signature = normalizeSignature(text(node));
    sites.push({
      kind,
      line: node.loc.start.line,
      signature,
      ...classifyInventorySite(file.path, kind, metadata),
    });
  };
  const visit = (node) => {
    if (
      ((node.type === 'FunctionDeclaration' && node.id) || node.type === 'VariableDeclarator') &&
      node.id?.type === 'Identifier' &&
      /^create[A-Za-z0-9_]*(?:Service|Middleware|ReduxBridge)$/.test(node.id.name)
    ) {
      addSite(node.id, 'service-factory');
    }
    if (node.type === 'CallExpression') {
      const callee = unwrapEstree(node.callee);
      const result = classifyCall({
        calleeName: estreeCalleeName(callee),
        rootName: estreeRootIdentifier(callee),
        calleeText: text(callee),
        callText: text(node),
        sideEffectImports,
        domainFunctionNames,
        domainImportNames,
        isSagaFile: file.path.includes('/sagas/') || /-saga\.[cm]?[jt]s$/.test(file.path),
      });
      if (result) addSite(node, result.kind, result);
    }
    for (const key of visitorKeys[node.type] ?? []) {
      const child = node[key];
      if (Array.isArray(child)) child.forEach((entry) => entry && visit(entry));
      else if (child) visit(child);
    }
  };
  visit(ast);
  return sites;
}

function detectSideEffectSites(file) {
  return file.path.endsWith('.svelte')
    ? detectSvelteSideEffectSites(file)
    : detectTypeScriptSideEffectSites(file);
}

export function buildRendererSideEffectInventory(files) {
  const grouped = new Map();
  for (const original of files) {
    const file = { ...original, path: normalize(original.path) };
    if (!isProductionRendererFile(file.path)) continue;
    for (const site of detectSideEffectSites(file)) {
      const key = [
        file.path,
        site.kind,
        site.signature,
        site.classification,
        site.owner,
        site.rationale,
      ].join('\u0000');
      const existing = grouped.get(key);
      if (existing) {
        existing.count += 1;
        existing.lines.push(site.line);
      } else {
        grouped.set(key, { path: file.path, ...site, count: 1, lines: [site.line] });
      }
    }
  }
  return [...grouped.values()].sort((a, b) =>
    `${a.path}\u0000${a.kind}\u0000${a.signature}`.localeCompare(
      `${b.path}\u0000${b.kind}\u0000${b.signature}`,
    ),
  );
}

function inventoryDigest(inventory) {
  const stable = inventory.map(({ line: _line, lines: _lines, ...entry }) => entry);
  return crypto.createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

function inventoryCounts(inventory) {
  const counts = {};
  for (const site of inventory) {
    const key = `${site.classification} :: ${site.kind}`;
    counts[key] = (counts[key] ?? 0) + site.count;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

export function rendererSideEffectInventorySnapshot(files) {
  const inventory = buildRendererSideEffectInventory(files);
  return { digest: inventoryDigest(inventory), counts: inventoryCounts(inventory), inventory };
}

export function findRendererSideEffectInventoryViolations(
  files,
  expected = { digest: REVIEWED_INVENTORY_DIGEST, counts: REVIEWED_INVENTORY_COUNTS },
) {
  const snapshot = rendererSideEffectInventorySnapshot(files);
  const violations = [];
  if (snapshot.digest !== expected.digest) {
    violations.push(
      `renderer side-effect inventory changed (expected ${expected.digest}, received ${snapshot.digest}); run this checker with --report and review ownership before updating the baseline`,
    );
  }
  if (JSON.stringify(snapshot.counts) !== JSON.stringify(expected.counts)) {
    violations.push(
      `renderer side-effect ownership counts changed: ${JSON.stringify(snapshot.counts)}`,
    );
  }
  return violations;
}

const APPROVED_MIDDLEWARE = new Map([
  ['src/store/utils/store-guard-middleware.ts', 'createStoreGuardMiddleware'],
  ['src/store/renderer/middlewares/batch.ts', 'createBatchingMiddleware'],
  ['src/store/renderer/middlewares/action-ring-buffer.ts', 'createActionRingBufferMiddleware'],
  [
    'src/store/renderer/middlewares/state-reference-checks.ts',
    'createReferenceChangeDetectorMiddleware',
  ],
  [
    'src/store/renderer/middlewares/structured-clone-checker.ts',
    'createStructuredCloneCheckerMiddleware',
  ],
]);

const APPROVED_BRIDGE_REGISTRATIONS = new Map([
  ['src/lib/electron-bridge.ts', { addMockIpcListener: 2 }],
  ['src/store/renderer/seeders/active-streams-bridge-seeder.ts', { registerMockIpcHandler: 1 }],
  ['src/store/renderer/seeders/agent-ipc-bridge-seeder.ts', { registerMockIpcHandler: 2 }],
  ['src/store/renderer/seeders/antigravity-setup-bridge-seeder.ts', { registerMockIpcHandler: 2 }],
  ['src/store/renderer/seeders/auto-update-bridge-seeder.ts', { registerMockIpcHandler: 1 }],
  ['src/store/renderer/seeders/backend-status-bridge-seeder.ts', { registerMockIpcHandler: 5 }],
  ['src/store/renderer/seeders/browser-ipc-bridge-seeder.ts', { registerMockIpcHandler: 1 }],
  ['src/store/renderer/seeders/connections-bridge-seeder.ts', { registerMockIpcHandler: 12 }],
  ['src/store/renderer/seeders/file-bridge-seeder.ts', { registerMockIpcHandler: 12 }],
  ['src/store/renderer/seeders/git-bridge-seeder.ts', { registerMockIpcHandler: 9 }],
  ['src/store/renderer/seeders/guest-sessions-bridge-seeder.ts', { registerMockIpcHandler: 3 }],
  ['src/store/renderer/seeders/host-bridge-seeder.ts', { registerMockIpcHandler: 16 }],
  ['src/store/renderer/seeders/integrations-bridge-seeder.ts', { registerMockIpcHandler: 28 }],
  ['src/store/renderer/seeders/invite-consent-bridge-seeder.ts', { registerMockIpcHandler: 1 }],
  ['src/store/renderer/seeders/invite-notice-bridge-seeder.ts', { registerMockIpcHandler: 1 }],
  ['src/store/renderer/seeders/invite-progress-bridge-seeder.ts', { registerMockIpcHandler: 1 }],
  [
    'src/store/renderer/seeders/language-preference-bridge-seeder.ts',
    { registerMockIpcHandler: 1 },
  ],
  ['src/store/renderer/seeders/misc-ui-events-seeder.ts', { registerMockIpcHandler: 1 }],
  ['src/store/renderer/seeders/model-catalog-bridge-seeder.ts', { registerMockIpcHandler: 1 }],
  ['src/store/renderer/seeders/native-dialog-bridge-seeder.ts', { registerMockIpcHandler: 1 }],
  ['src/store/renderer/seeders/notification-bridge-seeder.ts', { registerMockIpcHandler: 2 }],
  ['src/store/renderer/seeders/panel-layout-bridge-seeder.ts', { registerMockIpcHandler: 2 }],
  ['src/store/renderer/seeders/pi-mcp-bridge-seeder.ts', { registerMockIpcHandler: 2 }],
  ['src/store/renderer/seeders/power-bridge-seeder.ts', { registerMockIpcHandler: 1 }],
  ['src/store/renderer/seeders/presence-bridge-seeder.ts', { registerMockIpcHandler: 1 }],
  ['src/store/renderer/seeders/provider-status-bridge-seeder.ts', { registerMockIpcHandler: 6 }],
  ['src/store/renderer/seeders/quit-confirmation-bridge-seeder.ts', { registerMockIpcHandler: 1 }],
  ['src/store/renderer/seeders/release-notes-bridge-seeder.ts', { registerMockIpcHandler: 1 }],
  ['src/store/renderer/seeders/renderer-log-bridge-seeder.ts', { registerMockIpcHandler: 1 }],
  ['src/store/renderer/seeders/repo-config-bridge-seeder.ts', { registerMockIpcHandler: 1 }],
  ['src/store/renderer/seeders/settings-legacy-bridge-seeder.ts', { registerMockIpcHandler: 7 }],
  ['src/store/renderer/seeders/shell-reveal-bridge-seeder.ts', { registerMockIpcHandler: 1 }],
  ['src/store/renderer/seeders/terminals-scripts-seeder.ts', { registerMockIpcHandler: 2 }],
  ['src/store/renderer/seeders/user-activity-bridge-seeder.ts', { registerMockIpcHandler: 1 }],
  ['src/store/renderer/seeders/user-mcp-bridge-seeder.ts', { registerMockIpcHandler: 1 }],
  ['src/store/renderer/seeders/voice-local-bridge-seeder.ts', { registerMockIpcHandler: 3 }],
  ['src/store/renderer/seeders/window-state-bridge-seeder.ts', { registerMockIpcHandler: 7 }],
  [
    'src/store/renderer/seeders/workspace-summaries-bridge-seeder.ts',
    { registerMockIpcHandler: 2 },
  ],
  ['src/store/renderer/seeders/workspaces-seeder.ts', { registerMockIpcHandler: 7 }],
  [
    'src/store/renderer/slices/notifications/sagas/notifications-saga.ts',
    { addMockIpcListener: 1 },
  ],
]);

const IPC_ROUTER_PATH = 'src/shared/ipc-mock-router.ts';
const IPC_REGISTRARS = new Set(['registerMockIpcHandler', 'addMockIpcListener']);
const REGISTRY_PATH = 'src/store/renderer/middleware.ts';
const CONFIGURED_STORE_PATH = 'src/store/renderer/configured-store.ts';
const MIDDLEWARE_REGISTRY_ORIGIN = 'MiddlewareRegistry';
const REGISTRY_BUILDER = 'buildMiddleware';

function normalize(filePath) {
  return filePath.split(path.sep).join('/').replace(/^\.\//, '');
}

function isRendererSource(filePath) {
  return (
    (filePath.startsWith('src/features/') && !filePath.includes('/main/')) ||
    filePath.startsWith('src/lib/') ||
    filePath.startsWith('src/routes/') ||
    filePath.startsWith('src/store/renderer/') ||
    filePath.startsWith('src/store/utils/')
  );
}

export function findRendererSideEffectBoundaryViolations(files) {
  const sources = new Map(
    files
      .filter((file) => file.path.endsWith('.ts'))
      .map((file) => {
        const filePath = normalize(file.path);
        return [
          filePath,
          {
            ...file,
            path: filePath,
            source: ts.createSourceFile(filePath, file.content, ts.ScriptTarget.Latest, true),
          },
        ];
      }),
  );
  const violations = [];
  for (const { path: filePath, source } of sources.values()) {
    const diagnostic = source.parseDiagnostics[0];
    if (diagnostic) {
      const line = source.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line + 1;
      violations.push(`${filePath}:${line}: TypeScript parse failure`);
    }
  }
  const moduleCandidates = (fromPath, specifier) => {
    let base;
    if (specifier.startsWith('.')) base = normalize(path.join(path.dirname(fromPath), specifier));
    else {
      const alias = /^\$(lib|store|features|shared)(?:\/(.*))?$/.exec(specifier);
      if (!alias) return [];
      base = `src/${alias[1]}/${alias[2] ?? ''}`.replace(/\/$/, '');
    }
    const extensionless = base.replace(/\.(?:[cm]?js|[cm]?ts|tsx)$/, '');
    return [...new Set([base, extensionless, `${extensionless}.ts`, `${extensionless}/index.ts`])];
  };
  const resolveModule = (fromPath, specifier) => {
    return moduleCandidates(fromPath, specifier).find((candidate) => sources.has(candidate));
  };
  const directOrigin = (fromPath, specifier, exportedName) => {
    if (specifier === '@augmentcode/themis/types' && exportedName === 'StoreMiddleware') {
      return 'StoreMiddleware';
    }
    if (specifier === '@augmentcode/themis/svelte-store' && exportedName === 'Store') {
      return 'Store';
    }
    const isRouter =
      specifier === '$shared/ipc-mock-router' || specifier === IPC_ROUTER_PATH.replace(/\.ts$/, '');
    if (isRouter && IPC_REGISTRARS.has(exportedName)) return exportedName;
    for (const candidate of moduleCandidates(fromPath, specifier)) {
      if (candidate === REGISTRY_PATH && exportedName === 'middleware') {
        return MIDDLEWARE_REGISTRY_ORIGIN;
      }
      if (APPROVED_MIDDLEWARE.get(candidate) === exportedName) {
        return `middleware:${candidate}#${exportedName}`;
      }
      if (candidate === IPC_ROUTER_PATH && IPC_REGISTRARS.has(exportedName)) return exportedName;
    }
    return undefined;
  };
  const originFromModule = (fromPath, specifier, exportedName, seen) => {
    const direct = directOrigin(fromPath, specifier, exportedName);
    if (direct) return direct;
    const target = resolveModule(fromPath, specifier);
    if (target === IPC_ROUTER_PATH && IPC_REGISTRARS.has(exportedName)) return exportedName;
    return target ? exportedOrigin(target, exportedName, seen) : undefined;
  };
  const resolveTypeOrigin = (filePath, typeNode, seen = new Set()) => {
    if (!typeNode || !ts.isTypeReferenceNode(typeNode)) return undefined;
    const typeName = typeNode.typeName;
    if (ts.isIdentifier(typeName)) {
      return bindingOrigin(filePath, typeName.text, seen);
    }
    if (ts.isQualifiedName(typeName) && ts.isIdentifier(typeName.left)) {
      const source = sources.get(filePath)?.source;
      for (const statement of source?.statements ?? []) {
        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
          continue;
        const bindings = statement.importClause?.namedBindings;
        if (
          bindings &&
          ts.isNamespaceImport(bindings) &&
          bindings.name.text === typeName.left.text
        ) {
          return originFromModule(
            filePath,
            statement.moduleSpecifier.text,
            typeName.right.text,
            seen,
          );
        }
      }
    }
    return undefined;
  };
  const parameterOrigin = (filePath, localName, referenceNode, seen) => {
    let current = referenceNode.parent;
    while (current) {
      if (
        (ts.isFunctionDeclaration(current) ||
          ts.isFunctionExpression(current) ||
          ts.isArrowFunction(current) ||
          ts.isMethodDeclaration(current) ||
          ts.isConstructorDeclaration(current)) &&
        current.parameters
      ) {
        const param = current.parameters.find(
          (p) => ts.isIdentifier(p.name) && p.name.text === localName,
        );
        if (param) {
          return resolveTypeOrigin(filePath, param.type, seen) === 'Store'
            ? 'StoreInstance'
            : undefined;
        }
      }
      current = current.parent;
    }
    return undefined;
  };
  const bindingOrigin = (filePath, localName, seen = new Set(), referenceNode) => {
    const key = `${filePath}#local:${localName}`;
    if (seen.has(key)) return undefined;
    seen.add(key);
    const source = sources.get(filePath)?.source;
    if (!source) return undefined;
    if (referenceNode) {
      const fromParameter = parameterOrigin(filePath, localName, referenceNode, seen);
      if (fromParameter) return fromParameter;
    }
    for (const statement of source.statements) {
      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
        const clause = statement.importClause;
        const specifier = statement.moduleSpecifier.text;
        if (clause?.name?.text === localName) {
          return originFromModule(filePath, specifier, 'default', seen);
        }
        const bindings = clause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings)) {
          const element = bindings.elements.find((item) => item.name.text === localName);
          if (element) {
            return originFromModule(
              filePath,
              specifier,
              element.propertyName?.text ?? element.name.text,
              seen,
            );
          }
        }
      }
      if (ts.isClassDeclaration(statement) && statement.name?.text === localName) {
        const baseClass = statement.heritageClauses
          ?.find((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword)
          ?.types.at(0)?.expression;
        return expressionOrigin(filePath, baseClass, seen) === 'Store' ? 'Store' : undefined;
      }
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === localName) {
          return expressionOrigin(filePath, declaration.initializer, seen);
        }
      }
    }
    return undefined;
  };
  const expressionOrigin = (filePath, expression, seen = new Set()) => {
    if (!expression) return undefined;
    if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression)) {
      return expressionOrigin(filePath, expression.expression, seen);
    }
    if (ts.isIdentifier(expression))
      return bindingOrigin(filePath, expression.text, seen, expression);
    if (ts.isNewExpression(expression)) {
      return expressionOrigin(filePath, expression.expression, seen) === 'Store'
        ? 'StoreInstance'
        : undefined;
    }
    if (!ts.isPropertyAccessExpression(expression) || !ts.isIdentifier(expression.expression)) {
      return undefined;
    }
    const source = sources.get(filePath)?.source;
    for (const statement of source?.statements ?? []) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
        continue;
      const bindings = statement.importClause?.namedBindings;
      if (
        bindings &&
        ts.isNamespaceImport(bindings) &&
        bindings.name.text === expression.expression.text
      ) {
        return originFromModule(
          filePath,
          statement.moduleSpecifier.text,
          expression.name.text,
          seen,
        );
      }
    }
    return undefined;
  };
  const exportedOrigin = (filePath, exportedName, seen = new Set()) => {
    const key = `${filePath}#export:${exportedName}`;
    if (seen.has(key)) return undefined;
    seen.add(key);
    const source = sources.get(filePath)?.source;
    if (!source) return undefined;
    for (const statement of source.statements) {
      const isExported = statement.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      );
      if (
        isExported &&
        ts.isFunctionDeclaration(statement) &&
        statement.name?.text === exportedName
      ) {
        return exportedName;
      }
      if (isExported && ts.isVariableStatement(statement)) {
        const declaration = statement.declarationList.declarations.find(
          (item) => ts.isIdentifier(item.name) && item.name.text === exportedName,
        );
        if (declaration)
          return expressionOrigin(filePath, declaration.initializer, seen) ?? exportedName;
      }
      if (!ts.isExportDeclaration(statement)) continue;
      const specifier =
        statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
          ? statement.moduleSpecifier.text
          : undefined;
      if (!statement.exportClause && specifier) {
        const origin = originFromModule(filePath, specifier, exportedName, seen);
        if (origin) return origin;
      }
      if (!statement.exportClause || !ts.isNamedExports(statement.exportClause)) continue;
      const element = statement.exportClause.elements.find(
        (item) => item.name.text === exportedName,
      );
      if (!element) continue;
      const originalName = element.propertyName?.text ?? element.name.text;
      return specifier
        ? originFromModule(filePath, specifier, originalName, seen)
        : bindingOrigin(filePath, originalName, seen);
    }
    return bindingOrigin(filePath, exportedName, seen);
  };
  const visit = (node, callback) => {
    callback(node);
    ts.forEachChild(node, (child) => visit(child, callback));
  };

  for (const file of sources.values()) {
    const filePath = file.path;
    if (!filePath.endsWith('.ts') || filePath.includes('.test.') || filePath.includes('/test/'))
      continue;
    const storeMiddlewareNames = new Set();
    const storeMiddlewareNamespaces = new Set();
    const storeConstructorNames = new Set();
    const storeConstructorNamespaces = new Set();
    const namespaceImports = new Map();
    for (const statement of file.source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
        continue;
      const specifier = statement.moduleSpecifier.text;
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const item of bindings.elements) {
          const importedName = item.propertyName?.text ?? item.name.text;
          const origin = originFromModule(filePath, specifier, importedName, new Set());
          if (origin === 'StoreMiddleware') storeMiddlewareNames.add(item.name.text);
          if (origin === 'Store') storeConstructorNames.add(item.name.text);
        }
      } else if (bindings && ts.isNamespaceImport(bindings)) {
        namespaceImports.set(bindings.name.text, specifier);
        if (specifier === '@augmentcode/themis/types') {
          storeMiddlewareNamespaces.add(bindings.name.text);
        }
        if (specifier === '@augmentcode/themis/svelte-store') {
          storeConstructorNamespaces.add(bindings.name.text);
        }
      }
    }
    const typeUsesStoreMiddleware = (typeNode) => {
      let found = false;
      if (!typeNode) return false;
      visit(typeNode, (node) => {
        if (ts.isTypeReferenceNode(node)) {
          if (ts.isIdentifier(node.typeName) && storeMiddlewareNames.has(node.typeName.text))
            found = true;
          if (
            ts.isQualifiedName(node.typeName) &&
            ts.isIdentifier(node.typeName.left) &&
            (storeMiddlewareNamespaces.has(node.typeName.left.text) ||
              originFromModule(
                filePath,
                namespaceImports.get(node.typeName.left.text) ?? '',
                node.typeName.right.text,
                new Set(),
              ) === 'StoreMiddleware')
          )
            found = true;
        }
      });
      return found;
    };

    if (
      (storeMiddlewareNames.size > 0 || storeMiddlewareNamespaces.size > 0) &&
      !APPROVED_MIDDLEWARE.has(filePath) &&
      ![CONFIGURED_STORE_PATH, REGISTRY_PATH].includes(filePath)
    ) {
      violations.push(
        `${filePath}: StoreMiddleware is restricted to approved infrastructure middleware`,
      );
    }

    const registryCalls = [];
    const bridgeCalls = { registerMockIpcHandler: 0, addMockIpcListener: 0 };
    let configuredRegistryConsumptions = 0;
    visit(file.source, (node) => {
      let factoryName;
      let returnType;
      if (ts.isFunctionDeclaration(node) && node.name) {
        factoryName = node.name.text;
        returnType = node.type;
      } else if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
      ) {
        factoryName = node.name.text;
        returnType = node.type ?? node.initializer.type;
      }
      if (factoryName) {
        const typedFactory = typeUsesStoreMiddleware(returnType);
        const conventionalFactory =
          /^create[A-Za-z0-9_]*ReduxBridge$/.test(factoryName) ||
          (/^create[A-Za-z0-9_]*Middleware$/.test(factoryName) && isRendererSource(filePath));
        const serviceFactory = /^create[A-Za-z0-9_]*Service$/.test(factoryName) && typedFactory;
        const approvedRegistryBuilder =
          filePath === REGISTRY_PATH && factoryName === REGISTRY_BUILDER;
        if (
          (conventionalFactory || typedFactory || serviceFactory) &&
          APPROVED_MIDDLEWARE.get(filePath) !== factoryName &&
          !approvedRegistryBuilder
        ) {
          violations.push(`${filePath}: unapproved side-effect factory ${factoryName}`);
        }
      }
      if (ts.isCallExpression(node)) {
        const registrar = expressionOrigin(filePath, node.expression);
        if (registrar && IPC_REGISTRARS.has(registrar)) {
          bridgeCalls[registrar] += 1;
          if (!APPROVED_BRIDGE_REGISTRATIONS.has(filePath)) {
            violations.push(
              `${filePath}: new renderer IPC bridge registration requires architecture review`,
            );
          }
        }
        if (
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === 'addMiddleware' &&
          expressionOrigin(filePath, node.expression.expression) === 'StoreInstance'
        ) {
          violations.push(`${filePath}: direct Store middleware registration is not allowed`);
        }
        if (filePath === REGISTRY_PATH) {
          const origin = expressionOrigin(filePath, node.expression);
          const approvedCall = typeof origin === 'string' && origin.startsWith('middleware:');
          const topLevelCall =
            ts.isIdentifier(node.expression) && ts.isExpressionStatement(node.parent);
          const typedArrayElement =
            ts.isArrayLiteralExpression(node.parent) &&
            ts.isVariableDeclaration(node.parent.parent) &&
            typeUsesStoreMiddleware(node.parent.parent.type);
          const typedArrayPush =
            ts.isCallExpression(node.parent) &&
            ts.isPropertyAccessExpression(node.parent.expression) &&
            node.parent.expression.name.text === 'push' &&
            ts.isIdentifier(node.parent.expression.expression) &&
            storeMiddlewareNames.size > 0;
          if (approvedCall || topLevelCall || typedArrayElement || typedArrayPush) {
            registryCalls.push(origin ?? '<unapproved>');
          }
        }
      }
      if (ts.isNewExpression(node)) {
        const constructorOrigin = expressionOrigin(filePath, node.expression);
        const directStore =
          constructorOrigin === 'Store' ||
          (ts.isIdentifier(node.expression) && storeConstructorNames.has(node.expression.text)) ||
          (ts.isPropertyAccessExpression(node.expression) &&
            ts.isIdentifier(node.expression.expression) &&
            storeConstructorNamespaces.has(node.expression.expression.text) &&
            node.expression.name.text === 'Store');
        if (directStore && (node.arguments?.length ?? 0) > 1) {
          const consumesConfiguredRegistry =
            filePath === CONFIGURED_STORE_PATH &&
            (node.arguments?.length ?? 0) >= 2 &&
            expressionOrigin(filePath, node.arguments[1]) === MIDDLEWARE_REGISTRY_ORIGIN;
          if (consumesConfiguredRegistry) configuredRegistryConsumptions += 1;
          else violations.push(`${filePath}: direct Store middleware registration is not allowed`);
        }
      }
    });

    if (filePath === CONFIGURED_STORE_PATH && configuredRegistryConsumptions !== 1) {
      violations.push(
        `${filePath}: configured Store must consume the central middleware registry exactly once`,
      );
    }

    const approvedBridgeCalls = APPROVED_BRIDGE_REGISTRATIONS.get(filePath);
    if (
      approvedBridgeCalls &&
      [...IPC_REGISTRARS].some(
        (registrar) => bridgeCalls[registrar] !== (approvedBridgeCalls[registrar] ?? 0),
      )
    ) {
      violations.push(`${filePath}: reviewed renderer IPC bridge registrations changed`);
    }

    if (filePath === REGISTRY_PATH) {
      const expected = [...APPROVED_MIDDLEWARE]
        .map(([approvedPath, factory]) => `middleware:${approvedPath}#${factory}`)
        .sort();
      if (
        registryCalls.length !== expected.length ||
        registryCalls
          .slice()
          .sort()
          .some((name, i) => name !== expected[i])
      ) {
        violations.push(
          `${filePath}: registry must contain exactly the ${expected.length} approved middleware factories`,
        );
      }
    }
  }
  return violations;
}

function collectRendererSourceFiles(rootDir) {
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (/\.(?:[cm]?[jt]s|svelte)$/.test(entry.name)) {
        files.push({
          path: normalize(path.relative(process.cwd(), absolute)),
          content: fs.readFileSync(absolute, 'utf8'),
        });
      }
    }
  };
  visit(rootDir);
  return files;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = collectRendererSourceFiles(path.resolve('src'));
  const snapshot = rendererSideEffectInventorySnapshot(files);
  if (process.argv.includes('--report')) {
    console.log(JSON.stringify(snapshot, null, 2));
    process.exit(0);
  }
  const violations = [
    ...findRendererSideEffectBoundaryViolations(files),
    ...findRendererSideEffectInventoryViolations(files),
  ];
  if (violations.length > 0) {
    console.error(
      ['Renderer side-effect boundary violations:', ...violations.map((v) => `- ${v}`)].join('\n'),
    );
    process.exit(1);
  }
  console.log('Renderer side-effect boundaries valid.');
}
