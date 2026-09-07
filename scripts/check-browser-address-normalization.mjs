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
const PATTERNS = [
  {
    // (isLocalhost ? 'http://' : 'https://')
    regex: new RegExp(`${QUOTE}http:\\/\\/${QUOTE}\\s*:\\s*${QUOTE}https:\\/\\/${QUOTE}`),
    reason: 'loopback scheme selection',
  },
  {
    // 'https://' + input
    regex: new RegExp(`${SCHEME_LITERAL}\\s*\\+`),
    reason: 'scheme prefixing',
  },
  {
    // `https://${input}`
    regex: /`https?:\/\/\$\{/,
    reason: 'scheme prefixing',
  },
];

const normalize = (value) => value.split(path.sep).join('/').replace(/^\.\//, '');

const isTestFile = (filePath) => /\.(?:test|spec|ct\.spec)\.ts$/.test(filePath);

export function findBrowserAddressNormalizationViolations(files) {
  const violations = [];
  for (const file of files) {
    const filePath = normalize(file.path);
    if (!filePath.startsWith(`${BROWSER_COMPONENTS_DIR}/`)) continue;
    if (!SOURCE_EXTENSIONS.has(path.extname(filePath))) continue;
    if (filePath === NORMALIZATION_HELPER || isTestFile(filePath)) continue;
    const lines = file.content.split('\n');
    lines.forEach((line, index) => {
      const match = PATTERNS.find(({ regex }) => regex.test(line));
      if (!match) return;
      violations.push(
        `${filePath}:${index + 1}: inline address-bar ${match.reason}; use normalizeBrowserAddressInput() from ${NORMALIZATION_HELPER}`,
      );
    });
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
