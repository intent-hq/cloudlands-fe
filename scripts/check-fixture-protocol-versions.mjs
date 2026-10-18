import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Fake daemon hellos and daemon-status fixtures in tests must default their
// protocolVersion to CURRENT_PROTOCOL_VERSION (src/test/current-protocol-version.ts,
// generated from the bundled intentd pin), not a literal. Literal defaults froze at
// "14.0" while the daemon moved to 15, so a version cap that hid script lists and
// monitors from every user passed the whole suite (intent-hq/intent#7206). A test about
// a specific older or newer daemon keeps its literal with a reasoned escape comment.
export const ESCAPE_TOKEN = 'fixture-protocol-version';
// A file whose subject is version comparison itself (major-mismatch handling, version
// parsing) may opt out once in its first FILE_ESCAPE_LINES lines instead of per line.
export const FILE_ESCAPE_TOKEN = `${ESCAPE_TOKEN}-file`;
export const FILE_ESCAPE_LINES = 10;
export const REMEDIATION_HINT = [
  "Import { CURRENT_PROTOCOL_VERSION } from 'src/test/current-protocol-version' (relative path) and use it,",
  'so the fixture follows every protocol bump of the bundled daemon.',
  `When the test is about a specific version (a gate, an old daemon, a mismatch), keep the literal and add`,
  `\`// ${ESCAPE_TOKEN}: <reason>\` to the line or the line above. A file about version comparison itself`,
  `may put \`// ${FILE_ESCAPE_TOKEN}: <reason>\` in its first ${FILE_ESCAPE_LINES} lines. Reasons must be non-empty.`,
].join('\n');

const SCAN_ROOT = 'src';
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'build', '.git', 'paraglide']);
const SCANNED_EXTENSIONS = new Set(['.ts', '.js', '.mjs', '.svelte']);
const GENERATED_FILES = new Set(['src/test/current-protocol-version.ts']);
// Test and fixture modules: suites, fixture/mocks helpers, and the shared test tree.
const FIXTURE_PATH_PATTERNS = [
  /\.(?:test|spec)\.[cm]?[jt]s$/,
  /[.-]fixtures?\.[cm]?[jt]s$/,
  /\.test-fixtures?\.[cm]?[jt]s$/,
  /(?:^|\/)__tests__\//,
  /(?:^|\/)__mocks__\//,
  /^src\/test\//,
];
const VERSION_LITERAL = String.raw`['"\`](\d+(?:\.\d+)*)['"\`]`;
// Fixture shapes that hand a daemon protocol version to the code under test:
//   - keys and assignments: `protocolVersion: '14.0'`, `"protocol_version": "14.0"`,
//     `remoteProtocolVersion: '2'`, `stats.protocolVersion = '5.1'`,
//     `{ protocolVersion = '10.4' }` defaults;
//   - mocked getters: `getLocalDaemonProtocolVersion.mockReturnValue('1')`,
//     `fixture.protocol.mockResolvedValueOnce('10.4')`;
//   - getter arrows: `getProtocolVersion: () => '10.4'`.
// Comparisons (`==`, `===`), assertions and calls such as
// `protocolVersionAtLeast('10.4', …)` are not fixture values.
const LITERAL_PATTERNS = [
  new RegExp(
    String.raw`(?<![\w$])['"]?\w*?(?:p|P)rotocol(?:Version|_version)['"]?\s*(?::|=(?![=>]))\s*` +
      VERSION_LITERAL,
    'g',
  ),
  new RegExp(
    String.raw`\b\w*(?:p|P)rotocol\w*\.mock(?:Return|Resolved)Value(?:Once)?\(\s*` +
      VERSION_LITERAL,
    'g',
  ),
  new RegExp(String.raw`\b\w*(?:p|P)rotocol\w*\s*:\s*\(\)\s*=>\s*` + VERSION_LITERAL, 'g'),
];
const escapePattern = (token, openers) => new RegExp(`(?:${openers})\\s*${token}:\\s*(?!\\*/)\\S`);
const ESCAPE_PATTERN = escapePattern(ESCAPE_TOKEN, '//|/\\*');
const FILE_ESCAPE_PATTERN = escapePattern(FILE_ESCAPE_TOKEN, '//|/\\*|^\\s*\\*');
const COMMENT_ONLY_LINE = /^\s*(?:\/\/|\/\*|\*)/;

const normalize = (value) => value.split(path.sep).join('/').replace(/^\.\//, '');

export const isFixturePath = (filePath) =>
  SCANNED_EXTENSIONS.has(path.posix.extname(filePath)) &&
  !GENERATED_FILES.has(filePath) &&
  FIXTURE_PATH_PATTERNS.some((pattern) => pattern.test(filePath));

export function findLiteralVersions(text) {
  return LITERAL_PATTERNS.flatMap((pattern) =>
    [...text.matchAll(pattern)].map((match) => match[1]),
  );
}

const isEscaped = (lines, index) =>
  ESCAPE_PATTERN.test(lines[index]) ||
  (index > 0 && COMMENT_ONLY_LINE.test(lines[index - 1]) && ESCAPE_PATTERN.test(lines[index - 1]));

// One hit per offending line: `{ path, line, matches, text }`.
export function findFixtureProtocolVersionHits(files) {
  const hits = [];
  for (const file of files) {
    const filePath = normalize(file.path);
    if (!isFixturePath(filePath)) continue;
    const lines = file.content.split('\n');
    if (lines.slice(0, FILE_ESCAPE_LINES).some((line) => FILE_ESCAPE_PATTERN.test(line))) continue;
    lines.forEach((text, index) => {
      const matches = findLiteralVersions(text);
      if (matches.length && !isEscaped(lines, index)) {
        hits.push({ path: filePath, line: index + 1, matches, text: text.trim() });
      }
    });
  }
  return hits;
}

export const formatHit = ({ path: filePath, line, matches, text }) =>
  `${filePath}:${line}: ${matches.join(', ')}\n    ${text}`;

export function collectFixtureFiles(root, directory = path.join(root, SCAN_ROOT)) {
  const files = [];
  if (!fs.existsSync(directory)) return files;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) files.push(...collectFixtureFiles(root, absolute));
    } else if (entry.isFile()) {
      const relative = normalize(path.relative(root, absolute));
      if (isFixturePath(relative)) {
        files.push({ path: relative, content: fs.readFileSync(absolute, 'utf8') });
      }
    }
  }
  return files;
}

export function main(argv = process.argv.slice(2), root = process.cwd()) {
  if (argv.length) {
    console.error(
      `Unknown argument(s): ${argv.join(' ')}\nUsage: node scripts/check-fixture-protocol-versions.mjs`,
    );
    return 2;
  }
  const files = collectFixtureFiles(root);
  const hits = findFixtureProtocolVersionHits(files);
  if (hits.length) {
    console.error(
      [
        `Literal protocolVersion in test fixtures (${hits.length}):`,
        ...hits.map(formatHit),
        REMEDIATION_HINT,
      ].join('\n'),
    );
    return 1;
  }
  console.log(
    `Fixture protocol versions valid: ${files.length} test/fixture files default to CURRENT_PROTOCOL_VERSION.`,
  );
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
