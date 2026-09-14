import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Renderer source must reference daemon protocol features by method or field name,
// never by a protocol-version literal. Protocol numbers are provisional until merge
// (docs/protocol/versioning.md): a concurrent protocol PR forces a renumber, and no FE
// constant centralises the version, so literals go stale silently — cloudlands-fe#2447
// shipped five "v9.14" strings after the feature was renumbered to 10.1.
export const ESCAPE_TOKEN = 'protocol-version-ok';
export const SCANNED_EXTENSIONS = new Set(['.ts', '.svelte', '.js', '.mjs']);
export const REMEDIATION_HINT = [
  'Reference the protocol method or field name (e.g. `agent.getMessageBlock`, `capabilities.foo`)',
  'or describe the capability instead of a protocol version number.',
  `For a deliberate exception, append \`// ${ESCAPE_TOKEN}\` to the line.`,
].join('\n');

const SCAN_ROOT = 'src';
// `paraglide` is the gitignored compiled i18n bundle; `src/preload/index.ts` is
// generated from its sibling template, which is scanned in its place.
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'build', '.git', 'paraglide']);
const GENERATED_FILES = new Set(['src/preload/index.ts']);

const KEYWORD_PATTERN = /\b(?:protocol|intentd|daemon)\b/i;
// Two segments of one or two digits, optionally `v`-prefixed. The lookarounds keep
// three-part semver (`2.17.0`, `0.1.0`) and `§`-anchored section references out;
// a preceding word character rules out identifiers and longer numbers.
const VERSION_LITERAL_PATTERN = /(?<![\w.§])[vV]?\d{1,2}\.\d{1,2}(?![\d.])/g;
// Shapes that carry a two-segment number but never a protocol version (section
// references and ranges, JSON-RPC 2.0, the toon-format spec, elapsed times). They
// are blanked before the literal scan so the surrounding line is still checked.
const NON_VERSION_SHAPES = [
  /§\s*\d{1,2}\.\d{1,2}(?:\s*[-–—]\s*\d{1,2}\.\d{1,2})?/g,
  /\bJSON-RPC\s+2\.0\b/gi,
  /\btoon-format\s+v?\d{1,2}\.\d{1,2}/gi,
  /(?<![\w.])~?\d{1,2}\.\d{1,2}\s?(?:ms|s|sec|seconds?|m|min|minutes?|h|hours?)\b/g,
];

const normalize = (value) => value.split(path.sep).join('/').replace(/^\.\//, '');

const isScannedPath = (filePath) =>
  SCANNED_EXTENSIONS.has(path.posix.extname(filePath)) && !GENERATED_FILES.has(filePath);

export function findProtocolVersionLiterals(text) {
  if (text.includes(ESCAPE_TOKEN) || !KEYWORD_PATTERN.test(text)) return [];
  const stripped = NON_VERSION_SHAPES.reduce(
    (line, shape) => line.replace(shape, (match) => ' '.repeat(match.length)),
    text,
  );
  return [...new Set([...stripped.matchAll(VERSION_LITERAL_PATTERN)].map((match) => match[0]))];
}

// One hit per offending line: `{ path, line, matches, text }`.
export function findProtocolVersionLiteralHits(files) {
  const hits = [];
  for (const file of files) {
    const filePath = normalize(file.path);
    if (!isScannedPath(filePath)) continue;
    file.content.split('\n').forEach((text, index) => {
      const matches = findProtocolVersionLiterals(text);
      if (matches.length)
        hits.push({ path: filePath, line: index + 1, matches, text: text.trim() });
    });
  }
  return hits;
}

export const formatHit = ({ path: filePath, line, matches, text }) =>
  `${filePath}:${line}: ${matches.join(', ')}\n    ${text}`;

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
  const unknown = argv.filter((argument) => argument !== '--print-hits');
  if (unknown.length) {
    console.error(
      `Unknown argument(s): ${unknown.join(' ')}\nUsage: node scripts/check-protocol-version-literals.mjs [--print-hits]`,
    );
    return 2;
  }
  const files = collectSourceFiles(root);
  const hits = findProtocolVersionLiteralHits(files);
  if (hits.length) {
    console.error(
      [
        `Protocol version literals in ${SCAN_ROOT}/ (${hits.length}):`,
        ...hits.map(formatHit),
        REMEDIATION_HINT,
      ].join('\n'),
    );
    return 1;
  }
  console.log(
    `Protocol version literals valid: ${files.length} ${SCAN_ROOT}/ files reference protocol features by name.`,
  );
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
