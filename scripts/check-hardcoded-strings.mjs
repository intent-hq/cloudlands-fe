#!/usr/bin/env node
// check-hardcoded-strings.mjs — i18n gate for hardcoded user-facing strings.
//
// Directories that have been migrated to Paraglide messages (`m.*()`) must not
// re-introduce hardcoded user-facing strings. This dependency-free scanner
// checks, inside the enforced directories only:
//   - Svelte template text nodes containing words (after stripping `{...}`
//     expressions and HTML entities) — `{m.some_message()}` passes, literal
//     text fails.
//   - User-facing attributes (placeholder, title, aria-label, alt, label,
//     tooltip, …) with literal string values, including string literals inside
//     expression values like `title={cond ? 'A' : 'B'}`.
//   - `||`-fallback string literals in template render expressions
//     (e.g. `{x || 'Untitled'}`).
//   - TS / Svelte-script string literals that look like user-facing sentences
//     (two or more words that start capitalized or end with sentence
//     punctuation) — a heuristic that tolerates class lists, paths, and keys.
//     Lines routed to console/logger/import/throw are skipped.
//
// Suppress a deliberate literal by putting `i18n-ignore` in a comment on the
// same line or the line above.
//
// Usage: node scripts/check-hardcoded-strings.mjs [dir ...]
//   With no args, scans ENFORCED_DIRS below. Explicit dirs override the list
//   (used by the self-test).
//
import { readFileSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

// Enforced directories or individual files (relative to the repo root). Each
// extraction task adds its migrated directories here. The list starts EMPTY;
// the settings pilot extraction adds the first entry. Individual files are
// listed while their parent directory is only partially migrated.
const ENFORCED_DIRS = [
  'src/lib/components',
  'src/lib/constants',
  'src/lib/data',
  'src/hooks.client.ts',
  'src/lib/components/settings',
  'src/features/settings',
  'src/routes/settings',
  'src/lib/components/ui',
  'src/lib/components/workspace',
  'src/lib/components/chat',
  'src/lib/components/layout',
  'src/features/layout',
  'src/routes/workspace',
  'src/routes/agent',
  'src/routes/hud',
  'src/lib/components/tiptap',
  'src/routes/+page.svelte',
  'src/routes/+layout.svelte',
  'src/routes/+error.svelte',
  'src/features/onboarding',
  'src/features/github-auth',
  'src/features/linear-auth',
  'src/features/sentry-auth',
  'src/lib/components/modals',
  'src/lib/components/shared',
  'src/lib/components/common',
  'src/lib/components/error',
  'src/lib/components/terminal',
  'src/lib/components/editor',
  'src/lib/components/file-explorer',
  'src/lib/components/file-tracking',
  'src/features/terminal',
  'src/features/file-explorer',
  'src/features/files',
  'src/features/file-tracking',
  'src/lib/components/code-review',
  'src/lib/components/agent-overview',
  'src/lib/components/diagrams',
  'src/lib/components/code-walkthrough',
  'src/lib/components/visualization',
  'src/lib/components/notes',
  'src/lib/components/markdown',
  'src/features/notes',
  'src/features/comments',
  'src/features/log',
  'src/features/stats',
  'src/features/daemon-status',
  'src/features/browser',
  'src/lib/components/browser',
  'src/lib/components/debug',
  'src/features/debug',
  'src/features/debug-export',
  'src/lib/services',
  // agent feature: renderer services + browser/services/utils and the two
  // user-facing main-process files. main/instructions/, main/instruction-service,
  // specialists/rules-loader (agent prompt content), testing/ (harness), and
  // agent-launch-core (prompt building) are intentionally not enforced.
  'src/features/agent/browser',
  'src/features/agent/services',
  'src/features/agent/utils',
  'src/features/agent/errors',
  'src/features/agent/config',
  'src/features/agent/types',
  'src/features/agent/active-streams-redux-bridge.ts',
  'src/features/agent/agent-context-registry.ts',
  'src/features/agent/agent-context.ipc.ts',
  'src/features/agent/agent-context.ts',
  'src/features/agent/agent-creation-service.ts',
  'src/features/agent/agent-failure-registry.ts',
  'src/features/agent/agent-failure-toast-service.ts',
  'src/features/agent/agent-mutation-service.ts',
  'src/features/agent/agent-read-service.ts',
  'src/features/agent/agent-stream-lifecycle.ts',
  'src/features/agent/agent-stream-service.ts',
  'src/features/agent/agent-subscription-read-service.ts',
  'src/features/agent/agent-types.ts',
  'src/features/agent/agent.client.ts',
  'src/features/agent/chat-read-service.ts',
  'src/features/agent/chat-send-service.ts',
  'src/features/agent/edit-regenerate-service.ts',
  'src/features/agent/interrupted-agents-service.ts',
  'src/features/agent/main/agent-missing.ipc.ts',
  'src/features/agent/main/agent-validator.ts',
  'src/features/agent/main/stream-manager.ts',
  // provider integrations. acp-official main/server, parsers, and plans emit
  // agent-facing wire content; cortex/cortex-acp is a standalone stdio adapter
  // subprocess — both intentionally not enforced.
  'src/features/acp-official/permissions',
  'src/features/acp-official/types',
  'src/features/acp-official/utils',
  'src/features/auggie',
  'src/features/claude-code',
  'src/features/codex',
  'src/features/cortex/main',
  'src/features/droid',
  'src/features/grok',
  'src/features/opencode',
  'src/features/pi',
  'src/features/providers',
  // remaining feature dirs (final flip). agent/main/instructions, agent/testing,
  // agent/agent-launch-core, acp-official main/server + parsers/plans, and
  // cortex/cortex-acp emit agent-facing prompt/wire content — intentionally
  // not enforced.
  'src/features/accept-changes',
  'src/features/agent-testing',
  'src/features/auto-update',
  'src/features/backend',
  'src/features/cdp',
  'src/features/config',
  'src/features/context',
  'src/features/deeplink',
  'src/features/diffs',
  'src/features/events',
  'src/features/export',
  'src/features/external-editors',
  'src/features/feature-codes',
  'src/features/file',
  'src/features/git',
  'src/features/git-tracking',
  'src/features/hud',
  'src/features/ide',
  'src/features/ipc',
  'src/features/line-changes',
  'src/features/mcp',
  'src/features/memory',
  'src/features/metadata-fs',
  'src/features/navigation',
  'src/features/notifications',
  'src/features/optimization',
  'src/features/permission',
  'src/features/protocol',
  'src/features/rules',
  'src/features/scripts',
  'src/features/setup-scripts',
  'src/features/specialists',
  'src/features/storage',
  'src/features/system',
  'src/features/tasks',
  'src/features/theme',
  'src/features/token-usage',
  'src/features/tools',
  'src/features/user-activity',
  'src/features/workspace',
  // shared error catalog + the extracted seeder file. The rest of src/shared,
  // src/store, src/main, src/lib/utils, and src/lib/client stay unenforced for
  // now (recorded coordinator scope exception in the spec); shared/errors/
  // recovery.ts is a known follow-up.
  'src/shared/errors/index.ts',
  'src/shared/errors/localization.ts',
  'src/shared/errors/messages.ts',
  'src/store/renderer/seeders/provider-status-bridge-seeder.ts',
];

const ROOT = process.cwd();

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  '.svelte-kit',
  '.git',
  '__tests__',
  '__mocks__',
]);

const USER_FACING_ATTRS = [
  'placeholder',
  'title',
  'alt',
  'label',
  'tooltip',
  'aria-label',
  'aria-description',
  'aria-placeholder',
  'aria-roledescription',
  'aria-valuetext',
];

const RED = '\x1b[0;31m';
const YELLOW = '\x1b[0;33m';
const CYAN = '\x1b[0;36m';
const NC = '\x1b[0m';

function isCheckedFile(absPath) {
  const norm = absPath.split('\\').join('/');
  if (norm.endsWith('.d.ts')) return false;
  if (/\.(test|spec)\.(ts|js|mjs|cjs)$/.test(norm)) return false;
  if (!/\.(svelte|ts)$/.test(norm)) return false;
  return true;
}

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(full);
    } else if (entry.isFile()) {
      if (isCheckedFile(full)) yield full;
    }
  }
}

function lineAt(src, index) {
  return src.slice(0, index).split('\n').length;
}

function ignoredLines(src) {
  const out = new Set();
  src.split('\n').forEach((line, idx) => {
    if (!line.includes('i18n-ignore')) return;
    // A comment-only line suppresses the line below; an inline comment
    // suppresses only its own line.
    const commentStart = line.search(/\/\/|\/\*|<!--/);
    const beforeComment = commentStart === -1 ? line : line.slice(0, commentStart);
    if (beforeComment.trim() === '') {
      out.add(idx + 2);
    } else {
      out.add(idx + 1);
    }
  });
  return out;
}

// Replace a span with spaces, preserving newlines so line numbers survive.
function blankSpan(text) {
  return text.replace(/[^\n]/g, ' ');
}

function stripTsComments(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') {
        out += ' ';
        i++;
      }
    } else if (c === '/' && next === '*') {
      out += '  ';
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        out += src[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (i < src.length) {
        out += '  ';
        i += 2;
      }
    } else if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += c;
      i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\') {
          out += src.slice(i, i + 2);
          i += 2;
          continue;
        }
        if (quote !== '`' && src[i] === '\n') break;
        out += src[i];
        i++;
      }
      if (i < src.length) {
        out += src[i];
        i++;
      }
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

// Strip balanced `{...}` expressions (quote-aware) from a text span.
function stripBraceExpressions(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] === '{') {
      let depth = 0;
      let quote = null;
      let j = i;
      for (; j < text.length; j++) {
        const c = text[j];
        if (quote) {
          if (c === '\\') {
            j++;
            continue;
          }
          if (c === quote) quote = null;
          continue;
        }
        if (c === '"' || c === "'" || c === '`') {
          quote = c;
          continue;
        }
        if (c === '{') depth++;
        else if (c === '}') {
          depth--;
          if (depth === 0) break;
        }
      }
      if (j < text.length) {
        out += blankSpan(text.slice(i, j + 1));
        i = j + 1;
        continue;
      }
    }
    out += text[i];
    i++;
  }
  return out;
}

function stripHtmlEntities(text) {
  return text.replace(/&(?:#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);/g, ' ');
}

// Index of the `}` closing the `{` at openIndex (quote-aware), or -1.
function findBalancedBrace(text, openIndex) {
  let depth = 0;
  let quote = null;
  for (let j = openIndex; j < text.length; j++) {
    const c = text[j];
    if (quote) {
      if (c === '\\') {
        j++;
        continue;
      }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return j;
    }
  }
  return -1;
}

// String literals in a JS expression: [{ start, value }] with template-literal
// `${...}` interpolations blanked out of the value.
function extractStringLiterals(expr) {
  const out = [];
  let i = 0;
  while (i < expr.length) {
    const c = expr[i];
    if (c !== '"' && c !== "'" && c !== '`') {
      i++;
      continue;
    }
    const quote = c;
    const start = i;
    i++;
    let value = '';
    while (i < expr.length && expr[i] !== quote) {
      if (expr[i] === '\\') {
        value += expr[i + 1] ?? '';
        i += 2;
        continue;
      }
      if (quote === '`' && expr[i] === '$' && expr[i + 1] === '{') {
        const end = findBalancedBrace(expr, i + 1);
        value += ' ';
        i = end === -1 ? expr.length : end + 1;
        continue;
      }
      value += expr[i];
      i++;
    }
    i++;
    out.push({ start, value });
  }
  return out;
}

const WORDS_RE = /[A-Za-z]{2,}/;
const SENTENCE_RE = /[A-Za-z]{2,}\s+[A-Za-z]{2,}/;
const CAPITALIZED_START_RE = /^[^A-Za-z]*[A-Z][a-z]/;
const SENTENCE_PUNCT_RE = /[A-Za-z][.!?…](\s|$)/;
const NON_UI_LINE_RE =
  /\b(?:console\.|logger\.|log\.(?:debug|info|warn|error)|import\s|from\s*['"]|require\(|throw\s+new\s|new\s+Error\()/;

function findTagEnd(src, openIndex) {
  let quote = null;
  let brace = 0;
  for (let i = openIndex + 1; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') {
        i++;
        continue;
      }
      if (c === quote) quote = null;
      continue;
    }
    if (brace > 0) {
      if (c === '{') brace++;
      else if (c === '}') brace--;
      else if (c === '"' || c === "'" || c === '`') {
        quote = c;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === '{') {
      brace = 1;
      continue;
    }
    if (c === '>') return i;
  }
  return -1;
}

function extractSvelteParts(src) {
  const scripts = [];
  const scriptRe = /<script\b[^>]*>([\s\S]*?)<\/script\b[^>]*>/gi;
  let m;
  while ((m = scriptRe.exec(src)) !== null) {
    scripts.push({ text: m[1], index: m.index + m[0].indexOf('>') + 1 });
  }
  // Blank scripts, styles, and HTML comments out of the template (line-preserving).
  const template = src
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\b[^>]*>/gi, (block) => blankSpan(block))
    .replace(/<!--[\s\S]*?-->/g, (c) => blankSpan(c));
  return { template, scripts };
}

function checkTemplateText(src, template, start, end, violations) {
  const raw = template.slice(start, end);
  const stripped = stripHtmlEntities(stripBraceExpressions(raw));
  const match = WORDS_RE.exec(stripped);
  if (match) {
    const snippet = stripped.trim().replace(/\s+/g, ' ').slice(0, 60);
    violations.push({
      line: lineAt(src, start + match.index),
      kind: 'template text',
      snippet,
    });
  }
  checkTemplateFallbacks(src, raw, start, violations);
}

// Flag `||`-fallback string literals inside render expressions, e.g.
// `{workspace.title || 'Untitled'}`. Control-flow blocks (`{#if …}` etc.) are
// skipped — they are conditions, not rendered output.
function checkTemplateFallbacks(src, raw, start, violations) {
  let i = 0;
  while (i < raw.length) {
    if (raw[i] !== '{') {
      i++;
      continue;
    }
    const close = findBalancedBrace(raw, i);
    if (close === -1) return;
    const expr = raw.slice(i + 1, close);
    if (!/^[#:/@]/.test(expr.trim())) {
      for (const lit of extractStringLiterals(expr)) {
        if (
          !raw
            .slice(i + 1, i + 1 + lit.start)
            .trimEnd()
            .endsWith('||')
        )
          continue;
        if (!WORDS_RE.test(stripHtmlEntities(lit.value))) continue;
        violations.push({
          line: lineAt(src, start + i + 1 + lit.start),
          kind: 'fallback literal',
          snippet: lit.value.trim().replace(/\s+/g, ' ').slice(0, 60),
        });
      }
    }
    i = close + 1;
  }
}

function checkTagAttributes(src, tag, tagStart, violations) {
  for (const attr of USER_FACING_ATTRS) {
    const attrRe = new RegExp(`(?:^|[\\s{])${attr}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'g');
    let m;
    while ((m = attrRe.exec(tag)) !== null) {
      const value = m[2] ?? m[3] ?? '';
      const stripped = stripHtmlEntities(stripBraceExpressions(value));
      if (!WORDS_RE.test(stripped)) continue;
      violations.push({
        line: lineAt(src, tagStart + m.index),
        kind: `attribute ${attr}`,
        snippet: value.trim().replace(/\s+/g, ' ').slice(0, 60),
      });
    }
    // Expression values: title={cond ? 'A' : 'B'} — any word-bearing string
    // literal inside the expression is user-facing.
    const exprAttrRe = new RegExp(`(?:^|[\\s{])${attr}\\s*=\\s*\\{`, 'g');
    let em;
    while ((em = exprAttrRe.exec(tag)) !== null) {
      const open = em.index + em[0].length - 1;
      const close = findBalancedBrace(tag, open);
      if (close === -1) break;
      const expr = tag.slice(open + 1, close);
      for (const lit of extractStringLiterals(expr)) {
        if (!WORDS_RE.test(stripHtmlEntities(lit.value))) continue;
        violations.push({
          line: lineAt(src, tagStart + open + 1 + lit.start),
          kind: `attribute ${attr}`,
          snippet: lit.value.trim().replace(/\s+/g, ' ').slice(0, 60),
        });
      }
      exprAttrRe.lastIndex = close + 1;
    }
  }
}

function scanTemplate(src, template, violations) {
  let i = 0;
  let textStart = 0;
  while (i < template.length) {
    if (template[i] === '<') {
      checkTemplateText(src, template, textStart, i, violations);
      const tagEnd = findTagEnd(template, i);
      if (tagEnd === -1) return;
      checkTagAttributes(src, template.slice(i, tagEnd + 1), i, violations);
      i = tagEnd + 1;
      textStart = i;
    } else {
      i++;
    }
  }
  checkTemplateText(src, template, textStart, template.length, violations);
}

function looksLikeUserFacingSentence(text) {
  if (!SENTENCE_RE.test(text)) return false;
  return CAPITALIZED_START_RE.test(text) || SENTENCE_PUNCT_RE.test(text);
}

function scanTsSource(src, tsText, baseIndex, violations) {
  const stripped = stripTsComments(tsText);
  const lines = src.split('\n');
  let i = 0;
  while (i < stripped.length) {
    const c = stripped[i];
    if (c !== '"' && c !== "'" && c !== '`') {
      i++;
      continue;
    }
    const quote = c;
    const literalStart = i;
    i++;
    let value = '';
    while (i < stripped.length && stripped[i] !== quote) {
      if (stripped[i] === '\\') {
        value += stripped[i + 1] ?? '';
        i += 2;
        continue;
      }
      if (quote === '`' && stripped[i] === '$' && stripped[i + 1] === '{') {
        let depth = 0;
        let j = i + 1;
        for (; j < stripped.length; j++) {
          if (stripped[j] === '{') depth++;
          else if (stripped[j] === '}') {
            depth--;
            if (depth === 0) break;
          }
        }
        value += ' ';
        i = j + 1;
        continue;
      }
      if (quote !== '`' && stripped[i] === '\n') break;
      value += stripped[i];
      i++;
    }
    i++;
    if (!looksLikeUserFacingSentence(value)) continue;
    const line = lineAt(src, baseIndex + literalStart);
    const lineText = lines[line - 1] ?? '';
    if (NON_UI_LINE_RE.test(lineText)) continue;
    violations.push({
      line,
      kind: 'string literal',
      snippet: value.trim().replace(/\s+/g, ' ').slice(0, 60),
    });
  }
}

function findViolations(relPath, src) {
  const violations = [];
  if (relPath.endsWith('.svelte')) {
    const { template, scripts } = extractSvelteParts(src);
    scanTemplate(src, template, violations);
    for (const script of scripts) {
      scanTsSource(src, script.text, script.index, violations);
    }
  } else {
    scanTsSource(src, src, 0, violations);
  }
  const ignored = ignoredLines(src);
  return violations.filter((v) => !ignored.has(v.line));
}

async function main() {
  const args = process.argv.slice(2);
  const dirs = args.length > 0 ? args : ENFORCED_DIRS;

  console.log(`${CYAN}=== Hardcoded user-facing string gate (i18n) ===${NC}`);
  if (dirs.length === 0) {
    console.log('No enforced directories yet — nothing to scan.');
    console.log(`${CYAN}✓ No hardcoded-string violations found.${NC}`);
    return;
  }

  let total = 0;
  const lines = [];
  const checkFile = (file) => {
    let src;
    try {
      src = readFileSync(file, 'utf8');
    } catch {
      return;
    }
    const rel = relative(ROOT, file).split('\\').join('/');
    for (const v of findViolations(rel, src)) {
      total++;
      lines.push(`  ${YELLOW}${rel}:${v.line}${NC}  [${v.kind}] "${v.snippet}"`);
    }
  };
  for (const dir of dirs) {
    const abs = resolve(ROOT, dir);
    let entry = null;
    try {
      entry = await stat(abs);
    } catch {
      /* ignore */
    }
    if (!entry) {
      console.error(`${RED}Enforced path not found: ${dir}${NC}`);
      process.exit(2);
    }
    if (entry.isDirectory()) {
      console.log(`Scanning: ${relative(ROOT, abs) || '.'}/`);
      for await (const file of walk(abs)) {
        checkFile(file);
      }
    } else {
      console.log(`Scanning: ${relative(ROOT, abs)}`);
      if (isCheckedFile(abs)) checkFile(abs);
    }
  }

  console.log('');
  if (total > 0) {
    console.log(`${RED}[Hardcoded user-facing strings]${NC} — ${total} violation(s):`);
    console.log('  These directories are i18n-migrated: use Paraglide messages (m.some_message())');
    console.log('  instead of literal UI strings. Add keys to messages/en.json.');
    console.log('  For deliberate non-translatable literals, add an `i18n-ignore` comment on the');
    console.log('  same line or the line above.');
    for (const line of lines) console.log(line);
    console.log('');
    console.log(`${RED}✗ Found ${total} hardcoded-string violation(s).${NC}`);
    process.exit(1);
  }
  console.log(`${CYAN}✓ No hardcoded-string violations found.${NC}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
