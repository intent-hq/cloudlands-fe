import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Clients never cap the daemon protocol version (docs/protocol/versioning.md →
// Compatibility Policy). Every protocol gate goes through the minimum-only helper in
// src/shared/protocol-version.ts, or checks an advertised capability. Hand-written
// parsing is how caps crept in: `/^14\.\d+$/.test(hello.server?.protocolVersion)`
// hid script lists and monitors from every protocol 15 daemon (intent-hq/intent#7206),
// and `Number(match[1]) === 15` would have broken registered-root reads on 16. The
// literal-version lint (check-protocol-version-literals.mjs) cannot see either shape.
export const ESCAPE_TOKEN = 'protocol-version-parse-ok';
export const HELPER_PATH = 'src/shared/protocol-version.ts';
export const SCANNED_EXTENSIONS = new Set(['.ts', '.svelte', '.js', '.mjs']);
export const REMEDIATION_HINT = [
  `Gate on an advertised capability, or call \`protocolVersionAtLeast(version, major, minor)\` from ${HELPER_PATH}.`,
  'Never cap the protocol version: no maximum, exact major or allowlist of known majors.',
  `For a deliberate exception, add a \`// ${ESCAPE_TOKEN}: <reason>\` (or \`/* ${ESCAPE_TOKEN}: <reason> */\`) comment to the line.`,
].join('\n');

const SCAN_ROOT = 'src';
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'build', '.git', 'paraglide']);
const GENERATED_FILES = new Set(['src/preload/index.ts']);
// Tests and fixtures feed versions into gates on purpose; the gates they exercise are scanned.
const TEST_PATH_PATTERN =
  /(?:^|\/)__tests__\/|\.(?:test|spec)\.[cm]?[jt]s$|\.fixtures?\.[cm]?[jt]s$/;

// A daemon protocol version, named as `protocolVersion` / `protocol_version` (any
// casing or suffix) or `protocolMajor`. MCP/ACP handshakes also say `protocolVersion`
// but are never parsed, so they do not trip the operations below.
const VERSION_REFERENCE_PATTERN = /protocol_?(?:version|major)/i;
// Hand parsing or comparison of that value: regex use, splitting, string slicing,
// numeric coercion, or a comparison against a quoted number.
const PARSE_PATTERNS = [
  /\.(?:match|matchAll|test|exec|split|startsWith|endsWith|localeCompare|slice|substring|substr|charAt|indexOf)\(/,
  /\bnew\s+RegExp\(|\bRegExp\(/,
  /\bparse(?:Int|Float)\(|\bNumber\(/,
  /(?:===|!==|==|!=|<=|>=|<|>)\s*['"`]\d/,
  /['"`]\d[\d.]*['"`]\s*(?:===|!==|==|!=|<=|>=|<|>)/,
];
const COMMENT_LINE_PATTERN = /^\s*(?:\/\/|\/\*|\*)/;
// An escape counts only as a comment with a non-empty reason.
const LINE_ESCAPE_PATTERN = new RegExp(`(?://|/\\*)\\s*${ESCAPE_TOKEN}:\\s*(?!\\*/)\\S`);

const normalize = (value) => value.split(path.sep).join('/').replace(/^\.\//, '');

export const isScannedPath = (filePath) =>
  SCANNED_EXTENSIONS.has(path.posix.extname(filePath)) &&
  !GENERATED_FILES.has(filePath) &&
  filePath !== HELPER_PATH &&
  !TEST_PATH_PATTERN.test(filePath);

/** Whether one source line parses or compares a protocol version by hand. */
export function isHandParsedProtocolVersion(text) {
  if (COMMENT_LINE_PATTERN.test(text) || LINE_ESCAPE_PATTERN.test(text)) return false;
  if (!VERSION_REFERENCE_PATTERN.test(text)) return false;
  return PARSE_PATTERNS.some((pattern) => pattern.test(text));
}

// One hit per offending line: `{ path, line, text }`.
export function findProtocolVersionParsingHits(files) {
  const hits = [];
  for (const file of files) {
    const filePath = normalize(file.path);
    if (!isScannedPath(filePath)) continue;
    file.content.split('\n').forEach((text, index) => {
      if (isHandParsedProtocolVersion(text))
        hits.push({ path: filePath, line: index + 1, text: text.trim() });
    });
  }
  return hits;
}

export const formatHit = ({ path: filePath, line, text }) => `${filePath}:${line}:\n    ${text}`;

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

export function main(argv = process.argv.slice(2), root = process.cwd()) {
  if (argv.length) {
    console.error(
      `Unknown argument(s): ${argv.join(' ')}\nUsage: node scripts/check-protocol-version-parsing.mjs`,
    );
    return 2;
  }
  const files = collectSourceFiles(root);
  const hits = findProtocolVersionParsingHits(files);
  if (hits.length) {
    console.error(
      [
        `Hand-written protocol version parsing in ${SCAN_ROOT}/ (${hits.length}):`,
        ...hits.map(formatHit),
        REMEDIATION_HINT,
      ].join('\n'),
    );
    return 1;
  }
  console.log(
    `Protocol version parsing valid: ${files.length} ${SCAN_ROOT}/ files gate through ${HELPER_PATH} or capabilities.`,
  );
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
