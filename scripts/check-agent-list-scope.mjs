import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

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
  'src/store/renderer/seeders/agents-seeder.ts':
    'test-harness seeder — `mock-bootstrap` seeders run only in focused tests, never in production',
  'src/lib/constants/specialists.ts':
    'agent-facing prompt text naming the MCP `ws.app.agents.list` binding, not a request',
});

export const REMEDIATION_HINT = [
  'Bound the read: `agent.get { agentId }` for known ids, `agent.listActive {}` for liveness,',
  'or pass `scope` (a `topLevel` / `delegated` / `background` literal, or a variable) or',
  '`retiredOnly: true` to list one bin — `scope: undefined` / `retiredOnly: false` are still unscoped.',
  'An unscoped list serves every session of the workspace and exceeded the 1 MiB frame budget',
  'at 459 sessions (intent-hq/intent#5531).',
  `A deliberate exception is an ALLOWLIST entry in ${SCRIPT_PATH} with a one-line justification.`,
].join('\n');

const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'build', '.git', 'paraglide']);
const TEST_PATH_PATTERN =
  /(?:^|\/)(?:__tests__|test|mocks)\/|\.(?:test|spec)\.[cm]?[jt]sx?$|\.(?:ct|visual)\.spec\./;
const QUOTES = new Set(["'", '"', '`']);
// Wire form: the `'agent.list'` literal as a call argument (`request('agent.list', …)`,
// including a generic `request<T>(\n 'agent.list', …)`). Wrapper form: a direct
// `.agents.list(` / `.agents.listWithMeta(`, the method reference passed to a saga
// `call(appClient.agents.list, …)`, and the saga tuple `[appClient.agents, appClient.agents.list]`.
const WIRE_LITERAL_PATTERN = /(['"`])agent\.list\1/g;
const WRAPPER_PATTERN = /\.agents\.(?:list|listWithMeta)\s*(?=[(\],])/g;
// A call is bounded by an unquoted option property (`{ … , key … }`) whose value is
// statically a bin: `retiredOnly: true`, or `scope` as a literal from SCOPE_VALUES
// (`'topLevel' as const` included), a variable or member path (`scope: bin`,
// `scope: props.scope`), or the shorthand `{ scope }`. `retiredOnly: false` / a variable
// `retiredOnly`, `scope: undefined` / `null` / `''` / an unknown literal, and either word
// inside a string literal or another key (`scoped`) do not bound the read.
const OPTION_KEY_PATTERN = /^(?:scope|retiredOnly)(?![\w$])/;
const OPTION_VALUE_PATTERN = /^\s*:\s*/;
const OPTION_SHORTHAND_PATTERN = /^\s*[,}]/;
const IDENTIFIER_PATTERN = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/;
const SCOPE_VALUES = new Set(['topLevel', 'delegated', 'background']);
const UNBOUNDED_IDENTIFIERS = new Set(['undefined', 'null']);
const OPENERS = new Set(['(', '[', '{']);
const CLOSERS = new Set([')', ']', '}']);
const MAX_ARGUMENT_SPAN = 4000;

const normalize = (value) => value.split(path.sep).join('/').replace(/^\.\//, '');

export const isScannedPath = (filePath) =>
  SCANNED_EXTENSIONS.has(path.posix.extname(filePath)) && !TEST_PATH_PATTERN.test(filePath);

// End (exclusive) of the string or template literal opening at `start`. A quoted string
// left open at a newline ends there, so stray markup apostrophes cannot swallow a file.
function literalEnd(text, start) {
  const quote = text[start];
  for (let i = start + 1; i < text.length; i += 1) {
    const char = text[i];
    if (char === '\\') i += 1;
    else if (char === quote) return i + 1;
    else if (char === '\n' && quote !== '`') return i;
  }
  return text.length;
}

// Line comments, block comments, and Svelte HTML comments are blanked (newlines kept)
// so a documented example cannot trigger the gate — or satisfy the scope check — and
// line numbers stay accurate. String and template literals are walked rather than
// pattern-matched so a `//` inside one (`"https://…"`) never opens a comment that would
// blank a request later on the same line.
function blankComments(text) {
  const parts = [];
  let kept = 0;
  let i = 0;
  const closeAt = (token, from) => {
    const at = text.indexOf(token, from);
    return at === -1 ? text.length : at + token.length;
  };
  const blankTo = (end) => {
    parts.push(text.slice(kept, i), text.slice(i, end).replace(/[^\n]/g, ' '));
    kept = i = end;
  };
  while (i < text.length) {
    const char = text[i];
    if (char === '/' && text[i + 1] === '/') {
      const newline = text.indexOf('\n', i);
      blankTo(newline === -1 ? text.length : newline);
    } else if (char === '/' && text[i + 1] === '*') blankTo(closeAt('*/', i + 2));
    else if (text.startsWith('<!--', i)) blankTo(closeAt('-->', i + 4));
    else if (char === '\\') i += 2;
    else if (QUOTES.has(char)) i = literalEnd(text, i);
    else i += 1;
  }
  parts.push(text.slice(kept));
  return parts.join('');
}

const previousToken = (text, index) => {
  for (let i = index - 1; i >= 0; i -= 1) if (!/\s/.test(text[i])) return text[i];
  return '';
};

const nextToken = (text, index) => {
  for (let i = index; i < text.length; i += 1) if (!/\s/.test(text[i])) return text[i];
  return '';
};

// The argument text of the call the match belongs to: from `start` until the bracket
// depth drops to `stopDepth` (one enclosing `)` for a literal argument or a saga tuple,
// the method's own `(`…`)` for a direct call). Unbalanced text ends at the span cap.
function argumentSpan(text, start, stopDepth) {
  let depth = 0;
  const end = Math.min(text.length, start + MAX_ARGUMENT_SPAN);
  for (let i = start; i < end; i += 1) {
    const char = text[i];
    if (OPENERS.has(char)) depth += 1;
    else if (CLOSERS.has(char)) {
      depth -= 1;
      if (depth === stopDepth) return text.slice(start, i);
    }
  }
  return text.slice(start, end);
}

const isWireRequest = (text, match) =>
  ['(', ','].includes(previousToken(text, match.index)) &&
  nextToken(text, match.index + match[0].length) !== ':';

// Whether the option value starting at `rest` statically bounds the read (see the
// OPTION_* rule above). `rest` begins right after the property key.
function isBoundingOption(key, rest) {
  if (key === 'retiredOnly') return /^\s*:\s*true(?![\w$])/.test(rest);
  if (OPTION_SHORTHAND_PATTERN.test(rest)) return true;
  const separator = OPTION_VALUE_PATTERN.exec(rest);
  if (!separator) return false;
  const value = rest.slice(separator[0].length);
  if (QUOTES.has(value[0])) {
    const end = literalEnd(value, 0);
    return value[end - 1] === value[0] && SCOPE_VALUES.has(value.slice(1, end - 1));
  }
  const identifier = IDENTIFIER_PATTERN.exec(value);
  return identifier !== null && !UNBOUNDED_IDENTIFIERS.has(identifier[0]);
}

// Whether the argument text carries a bounding `scope` / `retiredOnly` option property.
// String and template literals are skipped so a value merely containing the word never
// counts; a key counts only in property position (after `{` or `,`).
function hasBoundingOption(args) {
  let i = 0;
  while (i < args.length) {
    const char = args[i];
    if (char === '\\') i += 2;
    else if (QUOTES.has(char)) i = literalEnd(args, i);
    else {
      const key = OPTION_KEY_PATTERN.exec(args.slice(i))?.[0];
      if (
        key &&
        ['{', ','].includes(previousToken(args, i)) &&
        isBoundingOption(key, args.slice(i + key.length))
      ) {
        return true;
      }
      i += 1;
    }
  }
  return false;
}

// Every unscoped request in one file: `{ line, text }` per offending call.
export function findUnscopedAgentListRequests(content) {
  const text = blankComments(content);
  const spans = [];
  for (const match of text.matchAll(WIRE_LITERAL_PATTERN)) {
    if (!isWireRequest(text, match)) continue;
    spans.push([match.index, argumentSpan(text, match.index + match[0].length, -1)]);
  }
  for (const match of text.matchAll(WRAPPER_PATTERN)) {
    const after = match.index + match[0].length;
    const next = text[after];
    const start = next === '(' ? after + 1 : after;
    spans.push([match.index, argumentSpan(text, start, next === ']' ? -2 : -1)]);
  }
  return spans
    .filter(([, args]) => !hasBoundingOption(args))
    .map(([index]) => {
      const line = text.slice(0, index).split('\n').length;
      return { line, text: content.split('\n')[line - 1].trim() };
    })
    .sort((a, b) => a.line - b.line);
}

// Hits in non-allowlisted files plus allowlist entries that no longer match anything.
export function checkAgentListScope(files, allowlist = ALLOWLIST) {
  const hits = [];
  const matched = new Set();
  for (const file of files) {
    const filePath = normalize(file.path);
    if (!isScannedPath(filePath)) continue;
    const requests = findUnscopedAgentListRequests(file.content);
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
