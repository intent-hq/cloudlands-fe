import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Every browser address bar must normalize typed input through
// normalizeBrowserAddressInput() in the helper below. Three bars once carried
// their own copies of the scheme-inference block and drifted during review of
// cloudlands-fe#2256; this guard rejects a fourth copy under the browser
// component tree.
export const BROWSER_COMPONENTS_DIR = 'src/lib/components/browser';
export const NORMALIZATION_HELPER = `${BROWSER_COMPONENTS_DIR}/embedded-browser-url-validation.ts`;

const SOURCE_EXTENSIONS = new Set(['.ts', '.svelte']);
const QUOTE = `['"\`]`;
const SCHEME_LITERAL = `${QUOTE}https?:\\/\\/${QUOTE}`;
// Whitespace between tokens is matched with \s* so a Prettier line break inside
// the expression (`? 'http://'\n : 'https://'`) cannot hide a copy.
const PATTERNS = [
  {
    // (isLocalhost ? 'http://' : 'https://') or (isRemote ? 'https://' : 'http://')
    regex: new RegExp(`${SCHEME_LITERAL}\\s*:\\s*${SCHEME_LITERAL}`, 'g'),
    reason: 'loopback scheme selection',
  },
  {
    // 'https://' + input
    regex: new RegExp(`${SCHEME_LITERAL}\\s*\\+`, 'g'),
    reason: 'scheme prefixing',
  },
  {
    // `https://${input}`
    regex: /`https?:\/\/\$\{/g,
    reason: 'scheme prefixing',
  },
];

// Line comments, block comments, and Svelte HTML comments are blanked (newlines
// kept) so an example in a comment cannot trigger the gate and line numbers stay
// accurate.
const COMMENT_PATTERN = /\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->|(?<=^|[^:'"`])\/\/[^\n]*/gm;

const normalize = (value) => value.split(path.sep).join('/').replace(/^\.\//, '');

const isTestFile = (filePath) => /\.(?:test|spec|ct\.spec)\.ts$/.test(filePath);

const stripComments = (content) =>
  content.replace(COMMENT_PATTERN, (comment) => comment.replace(/[^\n]/g, ' '));

const lineNumberAt = (content, index) => content.slice(0, index).split('\n').length;

export function findBrowserAddressNormalizationViolations(files) {
  const violations = [];
  for (const file of files) {
    const filePath = normalize(file.path);
    if (!filePath.startsWith(`${BROWSER_COMPONENTS_DIR}/`)) continue;
    if (!SOURCE_EXTENSIONS.has(path.extname(filePath))) continue;
    if (filePath === NORMALIZATION_HELPER || isTestFile(filePath)) continue;
    const content = stripComments(file.content);
    const hits = [];
    for (const { regex, reason } of PATTERNS) {
      for (const match of content.matchAll(regex)) {
        hits.push({ line: lineNumberAt(content, match.index), reason });
      }
    }
    hits.sort((a, b) => a.line - b.line);
    for (const { line, reason } of hits) {
      violations.push(
        `${filePath}:${line}: inline address-bar ${reason}; use normalizeBrowserAddressInput() from ${NORMALIZATION_HELPER}`,
      );
    }
  }
  return violations;
}

function collectFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectFiles(absolute));
    else if (SOURCE_EXTENSIONS.has(path.extname(entry.name)))
      files.push({
        path: normalize(path.relative(process.cwd(), absolute)),
        content: fs.readFileSync(absolute, 'utf8'),
      });
  }
  return files;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = collectFiles(path.resolve(BROWSER_COMPONENTS_DIR));
  if (!files.some((file) => file.path === NORMALIZATION_HELPER)) {
    console.error(`Browser address normalization helper is missing: ${NORMALIZATION_HELPER}`);
    process.exit(1);
  }
  const violations = findBrowserAddressNormalizationViolations(files);
  if (violations.length) {
    console.error(
      ['Browser address normalization violations:', ...violations.map((item) => `- ${item}`)].join(
        '\n',
      ),
    );
    process.exit(1);
  }
  console.log(
    `Browser address normalization valid: ${files.length} files under ${BROWSER_COMPONENTS_DIR} route through ${NORMALIZATION_HELPER}.`,
  );
}
