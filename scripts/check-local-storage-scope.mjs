import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  lineOf,
  parseErrors,
  parseSource,
  svelteMarkupText,
  ts,
  unwrapExpression,
  walk,
} from './source-ast-lib.mjs';
import { DECLARED_WRITES } from './local-storage-scopes.mjs';

// Every host's view in one app is its own renderer with its own store, but all share
// one localStorage. A preference a view reads only at boot goes stale when another view
// changes it, and the next save writes the stale value back: hidden sidebar icons had to
// be hidden once per host (cloudlands-fe#5028, #5035). So non-test source must not
// write localStorage directly. A per-app or per-host preference goes through
// `sharedPreference` / `sharedPreferenceSaga`, which follow other views; any other
// write is declared in `scripts/local-storage-scopes.mjs` with its scope and the reason
// it needs no helper.
export const SCRIPT_PATH = 'scripts/check-local-storage-scope.mjs';
export const LEDGER_PATH = 'scripts/local-storage-scopes.mjs';
export const SCAN_ROOT = 'src';
export const SCANNED_EXTENSIONS = new Set(['.ts', '.svelte', '.js', '.mjs']);

// The storage wrappers and the shared-preference helper: the only undeclared writers.
export const STORAGE_MODULES = new Set([
  'src/lib/utils/safe-storage.ts',
  'src/lib/utils/shared-preference.ts',
  'src/store/renderer/utils/safe-local-storage-saga.ts',
  'src/store/renderer/utils/shared-preference-saga.ts',
]);

// Scope → what it means. `app` and `host` values are shared between views, so their
// reason must say how the other views stay in step without the helper.
export const SCOPES = Object.freeze({
  app: 'one value for every host view of the app, kept in step without the helper',
  host: 'one value per backend, kept in step without the helper',
  view: 'state of one window or view; each view keeps its own and the last save wins',
  cache: 'derived or re-fetchable data that is safe to lose',
  draft: 'unsent user input that belongs to one agent, proposal or question',
  marker: 'a one-way flag (seen, migrated) that every view writes the same way',
  unsynced:
    'a shared value that views do not follow yet: each view loads it once and saves its own copy (known gap; add no new ones)',
  dev: 'debug flags, logs, previews and test harnesses',
});

export const REMEDIATION_HINT = [
  'A preference every host view must agree on goes through the shared-preference helper,',
  'which loads it, saves it, and follows changes other views make:',
  '  sagas:      `sharedPreferenceSaga({ key, scope, parse, hydrate, persistOn, select })`',
  '              from `$store/renderer/utils/shared-preference-saga`',
  '  elsewhere:  `sharedPreference({ key, scope, parse })` from `$lib/utils/shared-preference`',
  'Scope `app` is one value for the app; `host` is one value per backend (namespaced key).',
  `Any other write needs an entry in ${LEDGER_PATH}: file → key expression → [scope, reason].`,
  `Scopes: ${Object.keys(SCOPES).join(', ')}.`,
  'A write in Svelte markup cannot be read: move it into the `<script>` block.',
].join('\n');

const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'build', '.git', 'paraglide']);
const TEST_PATH_PATTERN =
  /(?:^|\/)(?:__tests__|test|test-helpers|mocks)\/|\.(?:test|spec)\.[cm]?[jt]sx?$|\.(?:ct|visual)\.spec\.|\.test-harness\./;
const STORAGE_OBJECTS = new Set(['localStorage', 'safeLocalStorage']);
const WRITE_METHODS = new Set(['setItem', 'removeItem', 'setJSON', 'clear']);
const SAGA_WRITERS = new Set([
  'setLocalStorageItem',
  'setLocalStorageJSON',
  'removeLocalStorageItem',
]);
// Cheap text filter: a file that cannot contain a write is not parsed.
const CANDIDATE_PATTERN =
  /localStorage|safeLocalStorage|setLocalStorageItem|setLocalStorageJSON|removeLocalStorageItem/i;
// Svelte markup is not parsed, so any write there fails closed.
const MARKUP_WRITE_PATTERN =
  /\b(?:localStorage|safeLocalStorage)\s*\??\.\s*(?:setItem|removeItem|setJSON|clear)\b|\b(?:setLocalStorageItem|setLocalStorageJSON|removeLocalStorageItem)\b/g;

export const ALIAS_KEY = '<alias>';
export const ALL_KEYS = '<all>';
export const UNKNOWN_KEY = '<unknown>';
export const MARKUP_KEY = '<markup>';

const normalize = (value) => value.split(path.sep).join('/').replace(/^\.\//, '');

export const isScannedPath = (filePath) =>
  SCANNED_EXTENSIONS.has(path.posix.extname(filePath)) &&
  !TEST_PATH_PATTERN.test(filePath) &&
  !STORAGE_MODULES.has(filePath);

const keyText = (node) => (node ? node.getText().replace(/\s+/g, ' ') : UNKNOWN_KEY);

// `localStorage`, `safeLocalStorage`, or any `<object>.localStorage`.
function isStorageObject(node) {
  const expression = unwrapExpression(node);
  if (!expression) return false;
  if (ts.isIdentifier(expression)) return STORAGE_OBJECTS.has(expression.text);
  return ts.isPropertyAccessExpression(expression) && expression.name.text === 'localStorage';
}

// The arguments that follow `node` in the call it is passed to, looking through one
// array literal (the saga tuple `[safeLocalStorage, safeLocalStorage.setJSON]`); null
// when `node` is not a call argument.
function followingArguments(node) {
  const parent = node.parent;
  if (ts.isCallExpression(parent) && parent.arguments.includes(node)) {
    return parent.arguments.slice(parent.arguments.indexOf(node) + 1);
  }
  if (ts.isArrayLiteralExpression(parent)) return followingArguments(parent);
  return null;
}

// The key of the write `node` names: the first argument when it is called, or the
// argument after it when it is passed by reference (a saga `call(fn, key, value)`).
function writtenKey(node, clearsAll) {
  if (clearsAll) return ALL_KEYS;
  const parent = node.parent;
  if (ts.isCallExpression(parent) && parent.expression === node) {
    return keyText(parent.arguments[0]);
  }
  return keyText(followingArguments(node)?.[0]);
}

const isDeclarationName = (node) => {
  const parent = node.parent;
  return (
    ts.isImportSpecifier(parent) ||
    ts.isExportSpecifier(parent) ||
    ((ts.isFunctionDeclaration(parent) || ts.isVariableDeclaration(parent)) && parent.name === node)
  );
};

const isObjectKeysCall = (node) =>
  ts.isCallExpression(node) &&
  ts.isPropertyAccessExpression(node.expression) &&
  ts.isIdentifier(node.expression.expression) &&
  node.expression.expression.text === 'Object';

// Whether the browser storage object `node` is used as a value (stored, passed or
// returned), which hides every later write from this check.
function isStorageAlias(node) {
  const expression = unwrapExpression(node);
  const isBrowserStorage =
    (ts.isIdentifier(expression) && expression.text === 'localStorage') ||
    (ts.isPropertyAccessExpression(expression) && expression.name.text === 'localStorage');
  if (!isBrowserStorage) return false;
  let current = node;
  let parent = current.parent;
  while (
    ts.isParenthesizedExpression(parent) ||
    ts.isAsExpression(parent) ||
    ts.isNonNullExpression(parent) ||
    ts.isSatisfiesExpression(parent)
  ) {
    current = parent;
    parent = current.parent;
  }
  if (ts.isVariableDeclaration(parent)) return parent.initializer === current;
  if (ts.isCallExpression(parent)) {
    return parent.arguments.includes(current) && !isObjectKeysCall(parent);
  }
  if (ts.isReturnStatement(parent) || ts.isArrowFunction(parent)) return true;
  if (ts.isPropertyAssignment(parent)) return parent.initializer === current;
  if (ts.isShorthandPropertyAssignment(parent)) return true;
  if (ts.isBinaryExpression(parent)) {
    return parent.operatorToken.kind === ts.SyntaxKind.EqualsToken && parent.right === current;
  }
  return false;
}

// `localStorage[key] = value`.
function assignedElementKey(node) {
  if (!ts.isElementAccessExpression(node) || !isStorageObject(node.expression)) return null;
  const parent = node.parent;
  const assigns =
    ts.isBinaryExpression(parent) &&
    parent.left === node &&
    parent.operatorToken.kind === ts.SyntaxKind.EqualsToken;
  return assigns || ts.isDeleteExpression(parent) ? keyText(node.argumentExpression) : null;
}

// One file's writes (`{ line, key, text }` each) and its first parse error
// (`{ line, message }`, or null). A `.svelte` file is read through its script blocks; a
// write in its markup is always reported.
function scanFile(content, filePath) {
  if (!CANDIDATE_PATTERN.test(content)) return { writes: [], parseError: null };
  const lines = content.split('\n');
  const writes = [];
  const add = (line, key) => writes.push({ line, key, text: lines[line - 1].trim() });
  const source = parseSource(content, filePath);
  walk(source, (node) => {
    if (
      ts.isPropertyAccessExpression(node) &&
      WRITE_METHODS.has(node.name.text) &&
      isStorageObject(node.expression)
    ) {
      add(lineOf(node.name), writtenKey(node, node.name.text === 'clear'));
      return;
    }
    if (ts.isIdentifier(node) && SAGA_WRITERS.has(node.text) && !isDeclarationName(node)) {
      const isMemberName = ts.isPropertyAccessExpression(node.parent) && node.parent.name === node;
      if (!isMemberName) add(lineOf(node), writtenKey(node, false));
      return;
    }
    const elementKey = assignedElementKey(node);
    if (elementKey !== null) {
      add(lineOf(node), elementKey);
      return;
    }
    if ((ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) && isStorageAlias(node)) {
      add(lineOf(node), ALIAS_KEY);
    }
  });
  if (filePath.endsWith('.svelte')) {
    const markup = svelteMarkupText(content);
    for (const match of markup.matchAll(MARKUP_WRITE_PATTERN)) {
      add(markup.slice(0, match.index).split('\n').length, MARKUP_KEY);
    }
  }
  writes.sort((x, y) => x.line - y.line);
  return { writes, parseError: parseErrors(source)[0] ?? null };
}

// Every localStorage write in one file: `{ line, key, text }` per write.
export const findLocalStorageWrites = (content, filePath = 'source.ts') =>
  scanFile(content, filePath).writes;

const isValidDeclaration = (declaration) =>
  Array.isArray(declaration) &&
  Object.hasOwn(SCOPES, declaration[0]) &&
  typeof declaration[1] === 'string' &&
  declaration[1].trim().length > 0;

// Writes with no declaration (`{ path, line, key, text }`), declarations that match no
// write or are malformed (`{ path, key }`), and files the check cannot parse
// (`{ path, line, message }`): a recovered parse can drop a write. A write in Svelte
// markup can never be declared.
export function checkLocalStorageScope(files, declared = DECLARED_WRITES) {
  const undeclared = [];
  const unreadable = [];
  const matched = new Set();
  for (const file of files) {
    const filePath = normalize(file.path);
    if (!isScannedPath(filePath)) continue;
    const { writes, parseError } = scanFile(file.content, filePath);
    if (parseError) unreadable.push({ path: filePath, ...parseError });
    const declarations = Object.hasOwn(declared, filePath) ? declared[filePath] : {};
    for (const write of writes) {
      if (write.key !== MARKUP_KEY && Object.hasOwn(declarations, write.key)) {
        matched.add(`${filePath}\n${write.key}`);
      } else {
        undeclared.push({ path: filePath, ...write });
      }
    }
  }
  const stale = [];
  const invalid = [];
  for (const [filePath, declarations] of Object.entries(declared)) {
    for (const [key, declaration] of Object.entries(declarations)) {
      if (!matched.has(`${filePath}\n${key}`)) stale.push({ path: filePath, key });
      else if (!isValidDeclaration(declaration)) invalid.push({ path: filePath, key });
    }
  }
  return { undeclared, stale, invalid, unreadable };
}

export const formatWrite = ({ path: filePath, line, key, text }) =>
  `${filePath}:${line}  key: ${key}\n    ${text}`;

export function collectSourceFiles(root, directory = path.join(root, SCAN_ROOT)) {
  const files = [];
  if (!fs.existsSync(directory)) return files;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) files.push(...collectSourceFiles(root, absolute));
    } else if (entry.isFile()) {
      const relative = normalize(path.relative(root, absolute));
      if (isScannedPath(relative)) {
        files.push({ path: relative, content: fs.readFileSync(absolute, 'utf8') });
      }
    }
  }
  return files;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = collectSourceFiles(process.cwd());
  const { undeclared, stale, invalid, unreadable } = checkLocalStorageScope(files);
  if (undeclared.length || stale.length || invalid.length || unreadable.length) {
    const lines = [];
    if (unreadable.length) {
      lines.push('Cannot parse, so writes there may be missed (fix the syntax error):');
      lines.push(
        ...unreadable.map(
          ({ path: filePath, line, message }) => `  ${filePath}:${line} ${message}`,
        ),
      );
    }
    if (undeclared.length) {
      lines.push(
        `localStorage write${undeclared.length === 1 ? '' : 's'} with no declared scope in non-test source:`,
      );
      lines.push(...undeclared.map((write) => `  ${formatWrite(write)}`));
      lines.push('', REMEDIATION_HINT);
    }
    if (invalid.length) {
      lines.push(
        `Declarations in ${LEDGER_PATH} that need a known scope and a reason ([scope, reason]):`,
      );
      lines.push(...invalid.map(({ path: filePath, key }) => `  ${filePath}  key: ${key}`));
    }
    if (stale.length) {
      lines.push(
        `Stale ${stale.length === 1 ? 'declaration' : 'declarations'} in ${LEDGER_PATH} (no such write left):`,
      );
      lines.push(...stale.map(({ path: filePath, key }) => `  ${filePath}  key: ${key}`));
    }
    console.error(lines.join('\n'));
    process.exit(1);
  }
  console.log(
    'localStorage scope check passed: every write uses the shared-preference helper or declares its scope.',
  );
}
