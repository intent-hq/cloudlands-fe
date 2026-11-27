import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  lineOf,
  parseErrors,
  parseSource,
  propertyName,
  stringValue,
  svelteMarkupText,
  ts,
  unwrapExpression,
  walk,
} from './source-ast-lib.mjs';

// Renderer source must not probe the daemon with a bare `client.hello` (no params, or
// `{}`) through `backendRequest` / `transport.request`. On the browser transport every
// outgoing hello starts a new handshake generation, which retires PR monitor sessions
// and makes them re-register: extra daemon requests on every startup and reconnect.
// cloudlands-fe#5090 moved every such capability / version / clientId read to
// `readBackendHello()`, which reads the acknowledged handshake without sending one; the
// unit-test fakes cannot see a regression, so this gate does. Main-process code owns its
// own pooled connection and is not scanned.
export const SCRIPT_PATH = 'scripts/check-hello-probes.mjs';
export const SCAN_ROOT = 'src';
export const SCANNED_EXTENSIONS = new Set(['.ts', '.svelte', '.js', '.mjs']);

// Documented exceptions: repo-relative path → one-line justification. An entry whose
// file no longer carries a probe is reported as stale and must be removed.
export const ALLOWLIST = Object.freeze({});

export const REMEDIATION_HINT = [
  'Read the acknowledged handshake with `readBackendHello()` (src/lib/client/live/backend-transport.ts)',
  'for capabilities, protocol version or the own clientId: it sends nothing on the wire.',
  'An outgoing `client.hello` starts a new handshake, which tears down PR monitors on the',
  'browser transport and makes them re-register (cloudlands-fe#5090). Send one only to',
  're-present identity or capabilities, with those params.',
  'A request in Svelte markup cannot be read: move it into the `<script>` block.',
  `A deliberate exception is an ALLOWLIST entry in ${SCRIPT_PATH} with a one-line justification.`,
].join('\n');

const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'build', '.git', 'paraglide']);
const TEST_PATH_PATTERN =
  /(?:^|\/)(?:__tests__|test)\/|\.(?:test|spec)\.[cm]?[jt]sx?$|\.(?:ct|visual)\.spec\./;
const MOCK_PATH_PATTERN =
  /(?:^|\/)(?:__mocks__|mocks?|__fixtures__|(?:test-)?fixtures)\/|[.-]fixtures?\.[cm]?[jt]s$/;
const MAIN_PROCESS_PATTERN = /^src\/(?:[^/]+\/)*main\//;
const HELLO_METHOD = 'client.hello';
const REQUEST_FUNCTIONS = new Set(['backendRequest', 'request']);
const CALL_EFFECTS = new Set(['call', 'fork', 'spawn']);
// Cheap text filter: a file that cannot contain a probe is not parsed (a constant
// imported from elsewhere is reported where it is exported).
const CANDIDATE_PATTERN = /client\.hello/;
// Svelte markup is not parsed, so a hello literal there fails closed.
const MARKUP_PROBE_PATTERN = /(['"`])client\.hello\1/g;

const normalize = (value) => value.split(path.sep).join('/').replace(/^\.\//, '');

export const isScannedPath = (filePath) =>
  SCANNED_EXTENSIONS.has(path.posix.extname(filePath)) &&
  !TEST_PATH_PATTERN.test(filePath) &&
  !MOCK_PATH_PATTERN.test(filePath) &&
  !MAIN_PROCESS_PATTERN.test(filePath);

// Whether `node` names a request function: `backendRequest` / `request`, a
// `.request` / `.backendRequest` member, either with type arguments
// (`backendRequest<T>`), or a saga `[context, fn]` / `{ context, fn }` holding one.
function isRequestFunction(node) {
  let expression = unwrapExpression(node);
  if (expression && ts.isExpressionWithTypeArguments(expression)) {
    expression = unwrapExpression(expression.expression);
  }
  if (!expression) return false;
  if (ts.isIdentifier(expression)) return REQUEST_FUNCTIONS.has(expression.text);
  if (ts.isPropertyAccessExpression(expression)) {
    return REQUEST_FUNCTIONS.has(expression.name.text);
  }
  if (ts.isArrayLiteralExpression(expression)) {
    return expression.elements.length === 2 && isRequestFunction(expression.elements[1]);
  }
  if (ts.isObjectLiteralExpression(expression)) {
    const fn = expression.properties.find((property) => propertyName(property) === 'fn');
    return !!fn && ts.isPropertyAssignment(fn) && isRequestFunction(fn.initializer);
  }
  return false;
}

// The expression `node` sits in, looking through parentheses, `as`, `satisfies` and `!`.
function outermost(node) {
  let current = node;
  while (
    ts.isParenthesizedExpression(current.parent) ||
    ts.isAsExpression(current.parent) ||
    ts.isSatisfiesExpression(current.parent) ||
    ts.isNonNullExpression(current.parent)
  ) {
    current = current.parent;
  }
  return current;
}

const calleeName = (callee) => {
  if (ts.isIdentifier(callee)) return callee.text;
  return ts.isPropertyAccessExpression(callee) ? callee.name.text : null;
};

// The params of an `apply` whose argument array starts with `node`: a saga
// `apply(context, fn, [method, params])` or `fn.apply(thisArg, [method, params])`.
function applyParams(node, array) {
  if (array.elements.indexOf(node) !== 0) return null;
  const argument = outermost(array);
  const call = argument.parent;
  if (!ts.isCallExpression(call)) return null;
  const callee = unwrapExpression(call.expression);
  if (calleeName(callee) !== 'apply') return null;
  const index = call.arguments.indexOf(argument);
  const viaFunction =
    index === 1 && ts.isPropertyAccessExpression(callee) && isRequestFunction(callee.expression);
  const viaSaga = index === 2 && isRequestFunction(call.arguments[1]);
  return viaFunction || viaSaga ? { params: array.elements[1] } : null;
}

// The params argument slot of a request whose method argument is `node`, or null when
// `node` is not one: `fn(method, params)`; a saga `call` / `fork` / `spawn(fn, method,
// params)`, bare or namespaced (`effects.call`); `fn.call(thisArg, method, params)`; or
// either `apply` form. `undefined` stands for absent params.
function requestParams(node) {
  const argument = outermost(node);
  const parent = argument.parent;
  if (ts.isArrayLiteralExpression(parent)) return applyParams(argument, parent);
  if (!ts.isCallExpression(parent)) return null;
  const index = parent.arguments.indexOf(argument);
  const callee = unwrapExpression(parent.expression);
  if (index === 0 && isRequestFunction(callee)) return { params: parent.arguments[1] };
  if (index !== 1 || !CALL_EFFECTS.has(calleeName(callee))) return null;
  const viaFunction =
    ts.isPropertyAccessExpression(callee) &&
    callee.name.text === 'call' &&
    isRequestFunction(callee.expression);
  return viaFunction || isRequestFunction(parent.arguments[0])
    ? { params: parent.arguments[2] }
    : null;
}

// Same-file `const` names that hold the hello method: `HELLO` for `const HELLO =
// 'client.hello'`, `METHODS.hello` for `const METHODS = { hello: 'client.hello' }`, and
// the exported ones. An importing file need not spell the method, so an exported
// constant is reported where it is declared.
function helloConstants(source) {
  const names = new Set();
  const members = new Set();
  const exported = [];
  walk(source, (node) => {
    if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || !node.initializer) {
      return;
    }
    if (!(node.parent.flags & ts.NodeFlags.Const)) return;
    const value = unwrapExpression(node.initializer);
    if (stringValue(value) === HELLO_METHOD) {
      names.add(node.name.text);
      if (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export) exported.push(node);
    } else if (ts.isObjectLiteralExpression(value)) {
      for (const property of value.properties) {
        if (
          ts.isPropertyAssignment(property) &&
          stringValue(property.initializer) === HELLO_METHOD
        ) {
          members.add(`${node.name.text}.${propertyName(property)}`);
        }
      }
    }
  });
  return { names, members, exported };
}

// Whether `node` spells the hello method: the literal, or a reference to a constant.
function isHelloMethod(node, constants) {
  if (ts.isStringLiteralLike(node)) return node.text === HELLO_METHOD;
  if (ts.isIdentifier(node)) {
    return constants.names.has(node.text) && !ts.isVariableDeclaration(node.parent);
  }
  return (
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    constants.members.has(`${node.expression.text}.${node.name.text}`)
  );
}

// Whether params carry nothing: absent, `undefined`, `void …`, `null` or `{}`.
function isEmptyParams(node) {
  if (!node) return true;
  const value = unwrapExpression(node);
  if (ts.isIdentifier(value)) return value.text === 'undefined';
  if (value.kind === ts.SyntaxKind.NullKeyword || ts.isVoidExpression(value)) return true;
  return ts.isObjectLiteralExpression(value) && value.properties.length === 0;
}

// One file's probes (`{ line, text }` each) and its first parse error (`{ line,
// message }`, or null). A `.svelte` file is read through its script blocks; a hello
// literal in its markup is always reported. A file whose text cannot hold a probe is
// not parsed.
function scanFile(content, filePath) {
  if (!CANDIDATE_PATTERN.test(content)) return { probes: [], parseError: null };
  const lines = content.split('\n');
  const hit = (line) => ({ line, text: lines[line - 1].trim() });
  const probes = [];
  const source = parseSource(content, filePath);
  const constants = helloConstants(source);
  for (const declaration of constants.exported) probes.push(hit(lineOf(declaration)));
  walk(source, (node) => {
    if (!isHelloMethod(node, constants)) return;
    const request = requestParams(node);
    if (request && isEmptyParams(request.params)) probes.push(hit(lineOf(node)));
  });
  if (filePath.endsWith('.svelte')) {
    const markup = svelteMarkupText(content);
    for (const match of markup.matchAll(MARKUP_PROBE_PATTERN)) {
      probes.push(hit(markup.slice(0, match.index).split('\n').length));
    }
  }
  probes.sort((x, y) => x.line - y.line);
  return { probes, parseError: parseErrors(source)[0] ?? null };
}

// Every bare `client.hello` probe in one file: `{ line, text }` per offending call.
export const findHelloProbes = (content, filePath = 'source.ts') =>
  scanFile(content, filePath).probes;

// Hits in non-allowlisted renderer files, allowlist entries that no longer match
// anything, and candidate files the check cannot parse (`{ path, line, message }`,
// allowlisted or not): a recovered parse can drop a probe.
export function checkHelloProbes(files, allowlist = ALLOWLIST) {
  const hits = [];
  const unreadable = [];
  const matched = new Set();
  for (const file of files) {
    const filePath = normalize(file.path);
    if (!isScannedPath(filePath)) continue;
    const { probes, parseError } = scanFile(file.content, filePath);
    if (parseError) unreadable.push({ path: filePath, ...parseError });
    if (!probes.length) continue;
    if (Object.hasOwn(allowlist, filePath)) matched.add(filePath);
    else hits.push(...probes.map((probe) => ({ path: filePath, ...probe })));
  }
  const stale = Object.keys(allowlist).filter((filePath) => !matched.has(filePath));
  return { hits, stale, unreadable };
}

export const formatHit = ({ path: filePath, line, text }) => `${filePath}:${line}\n    ${text}`;

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
  const { hits, stale, unreadable } = checkHelloProbes(collectSourceFiles(process.cwd()));
  if (hits.length || stale.length || unreadable.length) {
    const lines = [];
    if (unreadable.length) {
      lines.push('Cannot parse, so probes there may be missed (fix the syntax error):');
      lines.push(
        ...unreadable.map(
          ({ path: filePath, line, message }) => `  ${filePath}:${line} ${message}`,
        ),
      );
    }
    if (hits.length) {
      lines.push(`Bare \`client.hello\` probe${hits.length === 1 ? '' : 's'} in renderer source:`);
      lines.push(...hits.map((hit) => `  ${formatHit(hit)}`));
      lines.push('', REMEDIATION_HINT);
    }
    if (stale.length) {
      lines.push(
        `Stale ALLOWLIST ${stale.length === 1 ? 'entry' : 'entries'} in ${SCRIPT_PATH} (no probe left):`,
      );
      lines.push(...stale.map((filePath) => `  ${filePath}`));
    }
    console.error(lines.join('\n'));
    process.exit(1);
  }
  console.log('client.hello probe check passed: renderer code reads the acknowledged handshake.');
}
