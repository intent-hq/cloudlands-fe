import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import tailwindcss from '@tailwindcss/postcss';
import postcss from 'postcss';
import {
  DIRECT_QUERY,
  SOURCE_OF_TRUTH_FILES,
} from '../eslint-rules/no-direct-reduced-motion-query.js';

// Reduced motion has one source of truth (`--motion-reduced` in tokens.css, 1 under
// the OS query OR battery saver's `:root[data-reduce-motion]`). ESLint's
// `intent/no-direct-reduced-motion-query` covers script and Svelte files; this scan
// covers what ESLint cannot parse — hand-written `.css` and `.html` under `src/` —
// and audits the compiled Tailwind output so the `motion-reduce:` variant keeps
// compiling to `@container style(--motion-reduced: 1)`, never to the bare OS query
// the built-in variant emits when the `@custom-variant` override in app.css is lost.
export { DIRECT_QUERY, SOURCE_OF_TRUTH_FILES };
export const SCAN_ROOT = 'src';
export const SCANNED_EXTENSIONS = new Set(['.css', '.html']);
export const APP_CSS = 'src/app.css';
export const MOTION_REDUCE_CONTAINER_QUERY = 'style(--motion-reduced: 1)';
// Utilities compiled to prove the variant's output shape; any `motion-reduce:*`
// candidate exercises the same variant.
export const PROBE_CANDIDATES = Object.freeze([
  'motion-reduce:transition-none',
  'motion-reduce:animate-none',
]);
export const REMEDIATION_HINT = [
  `Direct \`${DIRECT_QUERY}\` queries see only the OS preference and bypass battery mode.`,
  `In CSS query \`@container ${MOTION_REDUCE_CONTAINER_QUERY}\` (or use the \`motion-reduce:\` variant);`,
  'in script use the helpers in `$lib/utils/reduced-motion`.',
].join('\n');

const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'build', '.git', 'paraglide']);
const TEST_PATH = /(?:^|\/)(?:__tests__|tests)\/|\.(?:test|spec)\.[^/]+$/;

const normalize = (value) => value.split(path.sep).join('/').replace(/^\.\//, '');

export const isSourceOfTruth = (relativePath) =>
  SOURCE_OF_TRUTH_FILES.some((pattern) => path.matchesGlob(relativePath, pattern));

export const isScannedPath = (relativePath) =>
  relativePath.startsWith(`${SCAN_ROOT}/`) &&
  SCANNED_EXTENSIONS.has(path.extname(relativePath)) &&
  !TEST_PATH.test(relativePath) &&
  !isSourceOfTruth(relativePath);

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

/** Every line spelling the direct query in the given `{ path, content }` files. */
export function findDirectQueryHits(files) {
  const hits = [];
  for (const { path: filePath, content } of files) {
    content.split('\n').forEach((text, index) => {
      if (text.includes(DIRECT_QUERY))
        hits.push({ path: filePath, line: index + 1, text: text.trim() });
    });
  }
  return hits;
}

export const formatHit = ({ path: filePath, line, text }) => `${filePath}:${line}: ${text}`;

const atRuleChain = (node) => {
  const chain = [];
  for (let parent = node.parent; parent && parent.type !== 'root'; parent = parent.parent) {
    if (parent.type === 'atrule') chain.push(parent);
  }
  return chain;
};

/**
 * Audits compiled CSS: every `motion-reduce` utility rule must sit under the
 * `--motion-reduced` container query and never under a bare `prefers-reduced-motion`
 * media query. Returns the audited rule count and the violating rules.
 */
export function auditCompiledMotionReduce(css) {
  const violations = [];
  let motionReduceRules = 0;
  postcss.parse(css).walkRules((rule) => {
    if (!rule.selector.includes('motion-reduce')) return;
    motionReduceRules += 1;
    const chain = atRuleChain(rule);
    const media = chain.find((at) => at.name === 'media' && at.params.includes(DIRECT_QUERY));
    const container = chain.some(
      (at) => at.name === 'container' && at.params.includes(MOTION_REDUCE_CONTAINER_QUERY),
    );
    if (media || !container) {
      violations.push({
        selector: rule.selector,
        wrapper: media ? `@media ${media.params}` : 'no `@container` wrapper',
      });
    }
  });
  return { motionReduceRules, violations };
}

export const formatCompiledViolation = ({ selector, wrapper }) => `${selector} <= ${wrapper}`;

/**
 * Compiles `src/app.css` with only the probe candidates (no source scan), the way
 * the production build does (Tailwind v4 via `@tailwindcss/postcss`). `source`
 * overrides the stylesheet text (tests inject a stripped override).
 */
export async function compileMotionReduceProbe({ root = process.cwd(), source } = {}) {
  const appCss = path.resolve(root, APP_CSS);
  // `$lib/` is a Vite alias; plain postcss resolves imports relative to `from`.
  const stylesheet = (source ?? fs.readFileSync(appCss, 'utf8'))
    .replaceAll("'$lib/", "'./lib/")
    .replace("@import 'tailwindcss';", "@import 'tailwindcss' source(none);");
  const probes = PROBE_CANDIDATES.map((candidate) => `@source inline("${candidate}");`);
  const result = await postcss([tailwindcss()]).process(`${stylesheet}\n${probes.join('\n')}\n`, {
    from: appCss,
  });
  return result.css;
}

export async function main(root = process.cwd()) {
  const files = collectSourceFiles(root);
  const hits = findDirectQueryHits(files);
  const { motionReduceRules, violations } = auditCompiledMotionReduce(
    await compileMotionReduceProbe({ root }),
  );
  const lines = [];
  if (hits.length) {
    lines.push(
      `Direct \`${DIRECT_QUERY}\` queries in ${SCAN_ROOT}/ (${hits.length}):`,
      ...hits.map(formatHit),
    );
  }
  if (motionReduceRules === 0) {
    lines.push(
      `Compiled ${APP_CSS} emitted no \`motion-reduce:\` utility for ${PROBE_CANDIDATES.join(', ')}.`,
    );
  }
  if (violations.length) {
    lines.push(
      `Compiled \`motion-reduce:\` utilities outside \`@container ${MOTION_REDUCE_CONTAINER_QUERY}\` (${violations.length}); restore the \`@custom-variant motion-reduce\` override in ${APP_CSS}:`,
      ...violations.map(formatCompiledViolation),
    );
  }
  if (lines.length) {
    console.error([...lines, REMEDIATION_HINT].join('\n'));
    return 1;
  }
  console.log(
    `Reduced-motion queries valid: ${files.length} ${SCAN_ROOT}/ css/html files and ${motionReduceRules} compiled motion-reduce utilities route through --motion-reduced.`,
  );
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main());
}
