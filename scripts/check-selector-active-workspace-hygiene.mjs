#!/usr/bin/env node
// check-selector-active-workspace-hygiene.mjs — Selector architecture gate.
//
// Selector definitions must not internally read active/current workspace selectors.
// Workspace-scoped selectors should accept workspaceId as an explicit argument.

import { readFileSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const ROOT = process.cwd();
const SEARCH_DIR = resolve(ROOT, process.argv[2] ?? 'src/store/renderer/slices');

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.svelte-kit', '.git']);
const ACTIVE_WORKSPACE_SELECTOR_NAME = 'select(?:Active|Current)Workspace(?:Id)?';
const ACTIVE_WORKSPACE_SELECTOR = new RegExp(`^${ACTIVE_WORKSPACE_SELECTOR_NAME}$`);
const IMPORT_RE = /\bimport\s+(?:type\s+)?\{([\s\S]*?)\}\s+from\s+["']([^"']+)["']/g;
const NAMESPACE_IMPORT_RE = /\bimport\s+(?:type\s+)?\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+["']([^"']+)["']/g;
const RED = '\x1b[0;31m';
const YELLOW = '\x1b[0;33m';
const CYAN = '\x1b[0;36m';
const NC = '\x1b[0m';

const BASELINE = new Set([
  'src/store/renderer/slices/workspace-switcher/workspace-switcher-selectors.ts::import::selectActiveWorkspaceId from ../workspace/workspace-selectors',
  'src/store/renderer/slices/workspace-switcher/workspace-switcher-selectors.ts::selector.select::selectActiveWorkspaceId::const activeWorkspaceId = selectActiveWorkspaceId.select(state);',
]);

function isSelectorFile(absPath) {
  const norm = absPath.split('\\').join('/');
  if (!norm.endsWith('-selectors.ts')) return false;
  if (/\.(test|spec)\.ts$/.test(norm)) return false;
  if (norm.includes('/__tests__/')) return false;
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
      if (!SKIP_DIRS.has(entry.name)) yield* walk(full);
    } else if (entry.isFile() && isSelectorFile(full)) {
      yield full;
    }
  }
}

function stripComments(src) {
  let out = '';
  for (let i = 0; i < src.length;) {
    if (src[i] === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') {
        out += ' ';
        i++;
      }
    } else if (src[i] === '/' && src[i + 1] === '*') {
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
    } else {
      out += src[i++];
    }
  }
  return out;
}

function lineAt(src, index) {
  return src.slice(0, index).split('\n').length;
}

function sourceLine(src, index) {
  const start = src.lastIndexOf('\n', index) + 1;
  const end = src.indexOf('\n', index);
  return src.slice(start, end === -1 ? src.length : end).replace(/\s+/g, ' ').trim();
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseImportedSelectors(src) {
  const imports = [];
  IMPORT_RE.lastIndex = 0;
  let match;
  while ((match = IMPORT_RE.exec(src)) !== null) {
    const [, specifiers, source] = match;
    for (const rawSpecifier of specifiers.split(',')) {
      const specifier = rawSpecifier.trim().replace(/^type\s+/, '');
      const parsed = /^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/.exec(specifier);
      if (!parsed || !ACTIVE_WORKSPACE_SELECTOR.test(parsed[1])) continue;
      imports.push({ imported: parsed[1], local: parsed[2] ?? parsed[1], source, index: match.index });
    }
  }
  return imports;
}

function parseNamespaceImports(src) {
  const imports = [];
  NAMESPACE_IMPORT_RE.lastIndex = 0;
  let match;
  while ((match = NAMESPACE_IMPORT_RE.exec(src)) !== null) {
    imports.push({ local: match[1], source: match[2], index: match.index });
  }
  return imports;
}

function findViolations(src, relPath) {
  const stripped = stripComments(src);
  const imports = parseImportedSelectors(stripped);
  const namespaceImports = parseNamespaceImports(stripped);
  const out = [];
  for (const item of imports) {
    out.push({
      kind: 'import',
      line: lineAt(stripped, item.index),
      key: `${relPath}::import::${item.imported} from ${item.source}`,
      snippet: `${item.imported} from ${item.source}`,
    });
  }

  for (const { local } of imports) {
    const escaped = escapeRegExp(local);
    const patterns = [
      { kind: 'selector.select', re: new RegExp(`\\b${escaped}\\s*\\.\\s*select\\b`, 'g') },
      { kind: 'direct selector call', re: new RegExp(`\\b${escaped}\\s*\\(`, 'g') },
    ];
    for (const { kind, re } of patterns) {
      let match;
      while ((match = re.exec(stripped)) !== null) {
        const snippet = sourceLine(src, match.index);
        out.push({
          kind,
          line: lineAt(stripped, match.index),
          key: `${relPath}::${kind}::${local}::${snippet}`,
          snippet,
        });
      }
    }
  }
  for (const { local } of namespaceImports) {
    const escaped = escapeRegExp(local);
    const selectorMember = `${escaped}\\s*\\.\\s*${ACTIVE_WORKSPACE_SELECTOR_NAME}`;
    const patterns = [
      { kind: 'namespace selector.select', re: new RegExp(`\\b${selectorMember}\\s*\\.\\s*select\\b`, 'g') },
      { kind: 'namespace direct selector call', re: new RegExp(`\\b${selectorMember}\\s*\\(`, 'g') },
    ];
    for (const { kind, re } of patterns) {
      let match;
      while ((match = re.exec(stripped)) !== null) {
        const snippet = sourceLine(src, match.index);
        out.push({
          kind,
          line: lineAt(stripped, match.index),
          key: `${relPath}::${kind}::${local}::${snippet}`,
          snippet,
        });
      }
    }
  }
  return out;
}

async function main() {
  let isDir = false;
  try {
    isDir = (await stat(SEARCH_DIR)).isDirectory();
  } catch { /* ignore */ }
  if (!isDir) {
    console.error(`${RED}Search directory not found: ${SEARCH_DIR}${NC}`);
    process.exit(2);
  }

  console.log(`${CYAN}=== selector active-workspace hygiene gate ===${NC}`);
  console.log(`Scanning: ${relative(ROOT, SEARCH_DIR) || '.'}/  (*-selectors.ts only)`);

  let baselineCount = 0;
  const lines = [];
  for await (const file of walk(SEARCH_DIR)) {
    const src = readFileSync(file, 'utf8');
    const rel = relative(ROOT, file).split('\\').join('/');
    for (const violation of findViolations(src, rel)) {
      if (BASELINE.has(violation.key)) {
        baselineCount++;
        continue;
      }
      lines.push(`  ${YELLOW}${rel}:${violation.line}${NC}  [${violation.kind}] ${violation.snippet}`);
    }
  }

  console.log('');
  if (baselineCount > 0) {
    console.log(`${YELLOW}Baseline:${NC} ${baselineCount} existing violation(s) ignored for staged rollout.`);
  }
  if (lines.length > 0) {
    console.log(`${RED}[selector active-workspace hygiene]${NC} — ${lines.length} violation(s):`);
    console.log('  Selector definitions must not read active/current workspace selectors.');
    console.log('  Pass workspaceId as a selector argument and compose workspace-scoped selectors with that id.');
    for (const line of lines) console.log(line);
    console.log('');
    console.log(`${RED}✗ Found ${lines.length} selector active-workspace violation(s).${NC}`);
    process.exit(1);
  }
  console.log(`${CYAN}✓ No new selector active-workspace violations found.${NC}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});