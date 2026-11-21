import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  lineOf,
  parseSource,
  propertyName,
  stringValue,
  svelteMarkupText,
  ts,
  unwrapExpression,
  walk,
} from './source-ast-lib.mjs';

// Non-test source must not request `agent.list` without a `scope` / `retiredOnly`
// option. An unscoped read serves every non-retired session of the workspace: at 459
// sessions the frame passed the daemon's 1 MiB soft budget (intent-hq/intent#5531), and
// the same fan-out was reintroduced four times by callers that needed a few rows.
// Bounded reads exist for every need: `agent.get { agentId }` for known ids,
// `agent.listActive {}` for liveness, and a `scope`d / `retiredOnly` list for one bin.
export const SCRIPT_PATH = 'scripts/check-agent-list-scope.mjs';
export const SCAN_ROOT = 'src';
export const SCANNED_EXTENSIONS = new Set(['.ts', '.svelte', '.js', '.mjs']);

// Documented exceptions: repo-relative path → one-line justification. An entry whose
// file no longer carries an unscoped request is reported as stale and must be removed.
export const ALLOWLIST = Object.freeze({
  'src/lib/client/live/live-agents-client.ts':
    'the AppClient `agents.list` / `agents.listWithMeta` wrapper — the one renderer wire caller; its callers carry the scope',
  'src/features/debug/main/debug.ipc.ts':
    'dev-only (`NODE_ENV === development`) human-triggered debug dump that lists every bin',
});

export const REMEDIATION_HINT = [
  'Bound the read: `agent.get { agentId }` for known ids, `agent.listActive {}` for liveness,',
  'or pass `scope` (a `topLevel` / `delegated` / `background` literal, or a variable) or',
  '`retiredOnly: true` to list one bin — `scope: undefined` / `retiredOnly: false` are still unscoped.',
  'A request in Svelte markup cannot be read: move it into the `<script>` block.',
  'An unscoped list serves every session of the workspace and exceeded the 1 MiB frame budget',
  'at 459 sessions (intent-hq/intent#5531).',
  `A deliberate exception is an ALLOWLIST entry in ${SCRIPT_PATH} with a one-line justification.`,
].join('\n');

const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'build', '.git', 'paraglide']);
const TEST_PATH_PATTERN =
  /(?:^|\/)(?:__tests__|test|mocks)\/|\.(?:test|spec)\.[cm]?[jt]sx?$|\.(?:ct|visual)\.spec\./;
const WIRE_METHOD = 'agent.list';
const WRAPPER_METHODS = new Set(['list', 'listWithMeta']);
const SCOPE_VALUES = new Set(['topLevel', 'delegated', 'background']);
// Cheap text filter: a file that cannot contain a request is not parsed.
const CANDIDATE_PATTERN = /agent\.list|agents\s*\??\.\s*list/;
// Svelte markup is not parsed, so any request there fails closed.
const MARKUP_REQUEST_PATTERN = /(['"`])agent\.list\1|\.agents\s*\??\.\s*list(?:WithMeta)?\b/g;

const normalize = (value) => value.split(path.sep).join('/').replace(/^\.\//, '');

export const isScannedPath = (filePath) =>
  SCANNED_EXTENSIONS.has(path.posix.extname(filePath)) && !TEST_PATH_PATTERN.test(filePath);

// The arguments that follow `node` in the call it is passed to, looking through one
// array literal (the saga tuple `[client.agents, client.agents.list]`); null when `node`
// is not a call argument.
function followingArguments(node) {
  const parent = node.parent;
  if (ts.isCallExpression(parent) && parent.arguments.includes(node)) {
    return parent.arguments.slice(parent.arguments.indexOf(node) + 1);
  }
  if (ts.isArrayLiteralExpression(parent)) {
    const rest = parent.elements.slice(parent.elements.indexOf(node) + 1);
    return [...rest, ...(followingArguments(parent) ?? [])];
  }
  return null;
}

// The option arguments of a request, or null when the node is not one. A wire request
// is the `'agent.list'` literal as a call argument; a wrapper request is
// `<client>.agents.list` / `.listWithMeta`, called directly or passed by reference (a
// saga `call(fn, …)`, `call([context, fn], …)` or `call({ context, fn }, …)`). A
// wrapper reference used any other way has no visible options and counts as unscoped.
function requestOptions(node) {
  if (ts.isStringLiteralLike(node)) {
    return node.text === WIRE_METHOD ? followingArguments(node) : null;
  }
  if (
    !ts.isPropertyAccessExpression(node) ||
    !WRAPPER_METHODS.has(node.name.text) ||
    !ts.isPropertyAccessExpression(node.expression) ||
    node.expression.name.text !== 'agents'
  ) {
    return null;
  }
  const parent = node.parent;
  if (ts.isCallExpression(parent) && parent.expression === node) return [...parent.arguments];
  if (
    ts.isPropertyAssignment(parent) &&
    propertyName(parent) === 'fn' &&
    ts.isObjectLiteralExpression(parent.parent)
  ) {
    return followingArguments(parent.parent) ?? [];
  }
  return followingArguments(node) ?? [];
}

const isKeywordLiteral = (node) =>
  [ts.SyntaxKind.NullKeyword, ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword].includes(
    node.kind,
  );

// Whether an option property statically bounds the read: `retiredOnly: true`, or `scope`
// as a SCOPE_VALUES literal (`as const` included), the shorthand `{ scope }`, or any
// other expression (`scope: bin`, `scope: props.scope`) except `undefined` or another
// literal.
function isBoundingOption(property) {
  const name = ts.isIdentifier(property.name) ? property.name.text : null;
  if (ts.isShorthandPropertyAssignment(property)) return name === 'scope';
  if (!ts.isPropertyAssignment(property)) return false;
  const value = unwrapExpression(property.initializer);
  if (name === 'retiredOnly') return value.kind === ts.SyntaxKind.TrueKeyword;
  if (name !== 'scope') return false;
  const literal = stringValue(value);
  if (literal !== null) return SCOPE_VALUES.has(literal);
  if (ts.isIdentifier(value)) return value.text !== 'undefined';
  return (
    !ts.isLiteralExpression(value) && !ts.isTemplateExpression(value) && !isKeywordLiteral(value)
  );
}

const isBoundingObject = (node) =>
  ts.isObjectLiteralExpression(node) && node.properties.some(isBoundingOption);

// Whether any option argument, or an object nested in one, carries a bounding property.
const hasBoundingOption = (options) =>
  options.some((option) => {
    let bounded = isBoundingObject(option);
    walk(option, (node) => {
      bounded ||= isBoundingObject(node);
      return !bounded;
    });
    return bounded;
  });

// Every unscoped request in one file: `{ line, text }` per offending call. A `.svelte`
// file is read through its script blocks; a request in its markup is always reported.
export function findUnscopedAgentListRequests(content, filePath = 'source.ts') {
  if (!CANDIDATE_PATTERN.test(content)) return [];
  const lines = content.split('\n');
  const hit = (line) => ({ line, text: lines[line - 1].trim() });
  const hits = [];
  walk(parseSource(content, filePath), (node) => {
    const options = requestOptions(node);
    if (options && !hasBoundingOption(options)) {
      hits.push(hit(lineOf(ts.isPropertyAccessExpression(node) ? node.expression.name : node)));
    }
  });
  if (filePath.endsWith('.svelte')) {
    const markup = svelteMarkupText(content);
    for (const match of markup.matchAll(MARKUP_REQUEST_PATTERN)) {
      hits.push(hit(markup.slice(0, match.index).split('\n').length));
    }
  }
  return hits.sort((a, b) => a.line - b.line);
}

// Hits in non-allowlisted files plus allowlist entries that no longer match anything.
export function checkAgentListScope(files, allowlist = ALLOWLIST) {
  const hits = [];
  const matched = new Set();
  for (const file of files) {
    const filePath = normalize(file.path);
    if (!isScannedPath(filePath)) continue;
    const requests = findUnscopedAgentListRequests(file.content, filePath);
    if (!requests.length) continue;
    if (Object.hasOwn(allowlist, filePath)) matched.add(filePath);
    else hits.push(...requests.map((request) => ({ path: filePath, ...request })));
  }
  const stale = Object.keys(allowlist).filter((filePath) => !matched.has(filePath));
  return { hits, stale };
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
  const { hits, stale } = checkAgentListScope(collectSourceFiles(process.cwd()));
  if (hits.length || stale.length) {
    const lines = [];
    if (hits.length) {
      lines.push(
        `Unscoped \`agent.list\` request${hits.length === 1 ? '' : 's'} in non-test source:`,
      );
      lines.push(...hits.map((hit) => `  ${formatHit(hit)}`));
      lines.push('', REMEDIATION_HINT);
    }
    if (stale.length) {
      lines.push(
        `Stale ALLOWLIST ${stale.length === 1 ? 'entry' : 'entries'} in ${SCRIPT_PATH} (no unscoped request left):`,
      );
      lines.push(...stale.map((filePath) => `  ${filePath}`));
    }
    console.error(lines.join('\n'));
    process.exit(1);
  }
  console.log('agent.list scope check passed: every non-test request is bounded.');
}
