#!/usr/bin/env node
// check-redux-state-collections.mjs — Store architecture gate for Redux state.
//
// Redux state may store arrays of primitive/scalar values and ID lists, but
// entity/object lists must use Collection<T, K> from collection-utils instead.
// This dependency-free scanner targets slice state type/interface declarations
// and obvious object-array literals in slice initial state under src/lib/store/slices.

import { readFileSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const ROOT = process.cwd();
const SEARCH_DIR = resolve(ROOT, process.argv[2] ?? 'src/lib/store/slices');

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  '.svelte-kit',
  '.git',
  'cdp-mcp-server',
  'parallel-runner',
  'playwright-report',
  'sagas',
]);

const SCALAR_TYPES = new Set([
  'string',
  'number',
  'boolean',
  'bigint',
  'null',
  'undefined',
  'never',
]);

const RED = '\x1b[0;31m';
const YELLOW = '\x1b[0;33m';
const CYAN = '\x1b[0;36m';
const NC = '\x1b[0m';

function isStoreStateFile(absPath) {
  const norm = absPath.split('\\').join('/');
  if (!norm.endsWith('.ts')) return false;
  if (norm.endsWith('.d.ts')) return false;
  if (/\.(test|spec)\.ts$/.test(norm)) return false;
  if (norm.includes('/__tests__/')) return false;
  if (norm.includes('/sagas/')) return false;
  if (norm.endsWith('-selectors.ts')) return false;
  return norm.endsWith('-types.ts') || norm.endsWith('-slice.ts') || norm.endsWith('/types.ts');
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
      if (isStoreStateFile(full)) yield full;
    }
  }
}

function stripComments(src) {
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
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

function lineAt(src, index) {
  return src.slice(0, index).split('\n').length;
}

function matchingOpen(src, closeIndex, openChar, closeChar) {
  let depth = 0;
  let quote = null;
  for (let i = closeIndex; i >= 0; i--) {
    const c = src[i];
    const prev = src[i - 1];
    if (quote) {
      if (c === quote && prev !== '\\') quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      continue;
    }
    if (c === closeChar) depth++;
    else if (c === openChar) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function matchingClose(src, openIndex, openChar, closeChar) {
  let depth = 0;
  let quote = null;
  for (let i = openIndex; i < src.length; i++) {
    const c = src[i];
    const prev = src[i - 1];
    if (quote) {
      if (c === quote && prev !== '\\') quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      continue;
    }
    if (c === openChar) depth++;
    else if (c === closeChar) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function splitTopLevel(text) {
  const parts = [];
  let start = 0;
  let paren = 0;
  let brace = 0;
  let bracket = 0;
  let angle = 0;
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const prev = text[i - 1];
    if (quote) {
      if (c === quote && prev !== '\\') quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      continue;
    }
    if (c === '(') paren++;
    else if (c === ')') paren--;
    else if (c === '{') brace++;
    else if (c === '}') brace--;
    else if (c === '[') bracket++;
    else if (c === ']') bracket--;
    else if (c === '<') angle++;
    else if (c === '>') angle = Math.max(0, angle - 1);
    else if ((c === ';' || c === ',') && paren === 0 && brace === 0 && bracket === 0 && angle === 0) {
      parts.push({ text: text.slice(start, i), start });
      start = i + 1;
    }
  }
  const tail = text.slice(start);
  if (tail.trim()) parts.push({ text: tail, start });
  return parts;
}

function splitTopLevelBy(text, separator) {
  const out = [];
  let start = 0;
  let paren = 0;
  let brace = 0;
  let bracket = 0;
  let angle = 0;
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const prev = text[i - 1];
    if (quote) {
      if (c === quote && prev !== '\\') quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      continue;
    }
    if (c === '(') paren++;
    else if (c === ')') paren--;
    else if (c === '{') brace++;
    else if (c === '}') brace--;
    else if (c === '[') bracket++;
    else if (c === ']') bracket--;
    else if (c === '<') angle++;
    else if (c === '>') angle = Math.max(0, angle - 1);
    else if (c === separator && paren === 0 && brace === 0 && bracket === 0 && angle === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out;
}

function normalizeType(typeText) {
  let t = typeText.replace(/\s+/g, ' ').trim();
  while (t.startsWith('readonly ')) t = t.slice('readonly '.length).trim();
  while (t.startsWith('(') && t.endsWith(')')) {
    const close = matchingClose(t, 0, '(', ')');
    if (close !== t.length - 1) break;
    t = t.slice(1, -1).trim();
  }
  return t;
}

function isScalarUnion(typeText) {
  const t = normalizeType(typeText);
  const parts = splitTopLevelBy(t, '|').map((part) => normalizeType(part));
  return parts.every((part) => {
    if (SCALAR_TYPES.has(part)) return true;
    if (/^['"`].*['"`]$/.test(part)) return true;
    if (/^-?\d+(?:\.\d+)?$/.test(part)) return true;
    return part === 'true' || part === 'false';
  });
}

function isIdArray(propertyName, elementType) {
  const prop = propertyName.replace(/[^A-Za-z0-9_$]/g, '');
  if (!/(^ids$|Ids$|IDs$|IdList$|IDList$)/.test(prop)) return false;
  const t = normalizeType(elementType);
  if (isScalarUnion(t)) return true;
  if (/(^|[A-Za-z_$])(Id|ID|Uuid|UUID)$/.test(t)) return true;
  if (/\b(Id|ID|Uuid|UUID)\b/.test(t) && !/[{}]/.test(t)) return true;
  return false;
}

function isAllowedArray(propertyName, elementType) {
  const t = normalizeType(elementType);
  if (isScalarUnion(t)) return true;
  if (isIdArray(propertyName, t)) return true;
  return false;
}

function extractArraySuffixElement(typeText, bracketIndex) {
  let end = bracketIndex - 1;
  while (end >= 0 && /\s/.test(typeText[end])) end--;
  if (end < 0) return null;
  if (typeText[end] === ')') {
    const open = matchingOpen(typeText, end, '(', ')');
    return open === -1 ? null : typeText.slice(open + 1, end);
  }
  if (typeText[end] === '}') {
    const open = matchingOpen(typeText, end, '{', '}');
    return open === -1 ? null : typeText.slice(open, end + 1);
  }
  if (typeText[end] === '>') {
    const open = matchingOpen(typeText, end, '<', '>');
    if (open === -1) return null;
    let nameStart = open - 1;
    while (nameStart >= 0 && /[\w$.:]/.test(typeText[nameStart])) nameStart--;
    return typeText.slice(nameStart + 1, end + 1);
  }
  let start = end;
  while (start >= 0 && /[\w$.:"'`-]/.test(typeText[start])) start--;
  return typeText.slice(start + 1, end + 1);
}

function findArrayTypeRefs(typeText) {
  const refs = [];
  for (let i = 0; i < typeText.length - 1; i++) {
    if (typeText[i] === '[' && typeText[i + 1] === ']') {
      const elementType = extractArraySuffixElement(typeText, i);
      if (elementType) refs.push({ elementType, typeText: `${normalizeType(elementType)}[]` });
      i++;
    }
  }

  const genericRe = /\b(?:ReadonlyArray|Array)\s*</g;
  let match;
  while ((match = genericRe.exec(typeText)) !== null) {
    const open = typeText.indexOf('<', match.index);
    const close = matchingClose(typeText, open, '<', '>');
    if (close === -1) continue;
    const elementType = typeText.slice(open + 1, close);
    refs.push({ elementType, typeText: typeText.slice(match.index, close + 1).replace(/\s+/g, ' ') });
    genericRe.lastIndex = close + 1;
  }
  return refs;
}

function memberNameAndType(memberText) {
  const trimmed = memberText.trim();
  if (!trimmed || trimmed.includes('=>')) return null;
  const match = /^(?:readonly\s+)?(?:["']?([A-Za-z_$][\w$-]*)["']?)\??\s*:\s*([\s\S]+)$/.exec(trimmed);
  if (!match) return null;
  return { name: match[1], type: match[2].trim() };
}

function slicePrefixForPath(relPath) {
  const parts = relPath.split(/[\\/]/).filter(Boolean);
  const fileName = parts.pop() ?? '';
  const stem = fileName.replace(/\.(?:mjs|cjs|js|jsx|ts|tsx)$/, '');
  const base = stem === 'types'
    ? parts.at(-1) ?? ''
    : stem.replace(/-(?:types|slice)$/, '');
  if (!base) return '';
  return base
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function typeDeclarations(src) {
  const out = [];
  const declRe = /\b(export\s+)?(?:type|interface)\s+([A-Za-z_$][\w$]*)\b/g;
  let match;
  while ((match = declRe.exec(src)) !== null) {
    const brace = src.indexOf('{', match.index);
    if (brace === -1) continue;
    const between = src.slice(match.index, brace);
    if (between.includes(';')) continue;
    const close = matchingClose(src, brace, '{', '}');
    if (close === -1) continue;
    out.push({ name: match[2], exported: Boolean(match[1]), bodyStart: brace, bodyEnd: close, src });
    declRe.lastIndex = close + 1;
  }
  return out;
}

function isSlicePrefixedStateName(prefix, name) {
  if (!prefix) return false;
  const candidates = new Set([
    `${prefix}State`,
    `${prefix}SliceState`,
    `${prefix}WorkspaceState`,
  ]);
  if (prefix.endsWith('State')) candidates.add(prefix);
  return candidates.has(name);
}

function referencedNestedStateTypeNames(typeText, declarationNames) {
  const out = new Set();
  const re = /\b[A-Za-z_$][\w$]*\b/g;
  let match;
  while ((match = re.exec(typeText)) !== null) {
    const name = match[0];
    if (name.endsWith('State') && declarationNames.has(name)) out.add(name);
  }
  return out;
}

function memberTypesForDeclaration(declaration) {
  const body = declaration.src.slice(declaration.bodyStart + 1, declaration.bodyEnd);
  const types = [];
  for (const part of splitTopLevel(body)) {
    const parsed = memberNameAndType(part.text);
    if (parsed) types.push(parsed.type);
  }
  return types;
}

function collectSliceStateTypeNames(files) {
  const names = new Set();
  const declarationByName = new Map();
  for (const { src, rel } of files) {
    const stripped = stripComments(src);
    const prefix = slicePrefixForPath(rel);

    for (const decl of typeDeclarations(stripped)) {
      declarationByName.set(decl.name, decl);
      if (decl.exported && isSlicePrefixedStateName(prefix, decl.name)) {
        names.add(decl.name);
      }
    }

    const constStateRe = /\b(?:export\s+)?const\s+(?:[A-Za-z_$][\w$]*(?:initialState|InitialState)|empty[A-Za-z0-9_$]*State|Empty[A-Za-z0-9_$]*State)\s*:\s*([A-Za-z_$][\w$]*State[A-Za-z0-9_$]*)\b/g;
    let constMatch;
    while ((constMatch = constStateRe.exec(stripped)) !== null) {
      names.add(constMatch[1]);
    }

    const reducerRe = /\bcreateReducer\s*<\s*([A-Za-z_$][\w$]*State[A-Za-z0-9_$]*)\b/g;
    let reducerMatch;
    while ((reducerMatch = reducerRe.exec(stripped)) !== null) {
      names.add(reducerMatch[1]);
    }
  }

  const declarationNames = new Set(declarationByName.keys());
  let changed = true;
  while (changed) {
    changed = false;
    for (const name of Array.from(names)) {
      const declaration = declarationByName.get(name);
      if (!declaration) continue;
      for (const typeText of memberTypesForDeclaration(declaration)) {
        for (const referenced of referencedNestedStateTypeNames(typeText, declarationNames)) {
          if (!names.has(referenced)) {
            names.add(referenced);
            changed = true;
          }
        }
      }
    }
  }
  return names;
}

function scanTypeBody(src, bodyStart, bodyEnd, declarationName, path = []) {
  const body = src.slice(bodyStart + 1, bodyEnd);
  const out = [];
  for (const part of splitTopLevel(body)) {
    const parsed = memberNameAndType(part.text);
    if (!parsed) continue;
    const propertyPath = [...path, parsed.name];
    for (const arrayRef of findArrayTypeRefs(parsed.type)) {
      if (isAllowedArray(parsed.name, arrayRef.elementType)) continue;
      out.push({
        line: lineAt(src, bodyStart + 1 + part.start),
        declarationName,
        propertyPath: propertyPath.join('.'),
        typeText: arrayRef.typeText,
        elementType: normalizeType(arrayRef.elementType),
        kind: 'state type array',
      });
    }

    const objectStart = parsed.type.indexOf('{');
    if (objectStart !== -1) {
      const objectEnd = matchingClose(parsed.type, objectStart, '{', '}');
      if (objectEnd !== -1) {
        out.push(
          ...scanTypeBody(
            src,
            bodyStart + 1 + part.start + part.text.indexOf(parsed.type) + objectStart,
            bodyStart + 1 + part.start + part.text.indexOf(parsed.type) + objectEnd,
            declarationName,
            propertyPath,
          ),
        );
      }
    }
  }
  return out;
}

function findStateTypeViolations(src, sliceStateTypeNames) {
  const out = [];
  const declRe = /\b(?:export\s+)?(?:type|interface)\s+([A-Za-z_$][\w$]*)\b/g;
  let match;
  while ((match = declRe.exec(src)) !== null) {
    if (!sliceStateTypeNames.has(match[1])) continue;
    const brace = src.indexOf('{', match.index);
    if (brace === -1) continue;
    const between = src.slice(match.index, brace);
    if (between.includes(';')) continue;
    const close = matchingClose(src, brace, '{', '}');
    if (close === -1) continue;
    out.push(...scanTypeBody(src, brace, close, match[1]));
    declRe.lastIndex = close + 1;
  }
  return out;
}

function valueContainsObjectArray(valueText) {
  for (let i = 0; i < valueText.length; i++) {
    if (valueText[i] !== '[') continue;
    const close = matchingClose(valueText, i, '[', ']');
    if (close === -1) continue;
    const inner = valueText.slice(i + 1, close).trim();
    if (inner.startsWith('{')) return true;
    i = close;
  }
  return false;
}

function scanObjectLiteral(src, bodyStart, bodyEnd, declarationName, path = []) {
  const body = src.slice(bodyStart + 1, bodyEnd);
  const out = [];
  for (const part of splitTopLevel(body)) {
    const trimmed = part.text.trim();
    const match = /^(?:["']?([A-Za-z_$][\w$-]*)["']?)\s*:\s*([\s\S]+)$/.exec(trimmed);
    if (!match) continue;
    const name = match[1];
    const value = match[2].trim();
    const propertyPath = [...path, name];
    if (valueContainsObjectArray(value)) {
      out.push({
        line: lineAt(src, bodyStart + 1 + part.start),
        declarationName,
        propertyPath: propertyPath.join('.'),
        typeText: 'object array literal',
        elementType: 'object literal',
        kind: 'initial state object array',
      });
    }
    if (value.startsWith('{')) {
      const close = matchingClose(value, 0, '{', '}');
      if (close !== -1) {
        out.push(
          ...scanObjectLiteral(
            src,
            bodyStart + 1 + part.start + part.text.indexOf(value),
            bodyStart + 1 + part.start + part.text.indexOf(value) + close,
            declarationName,
            propertyPath,
          ),
        );
      }
    }
  }
  return out;
}

function findInitialStateViolations(src, sliceStateTypeNames) {
  const out = [];
  const initRe = /\b(?:export\s+)?const\s+([A-Za-z_$][\w$]*(?:initialState|InitialState)|empty[A-Za-z0-9_$]*State|Empty[A-Za-z0-9_$]*State)\s*:\s*([A-Za-z_$][\w$]*State[A-Za-z0-9_$]*)\s*=\s*{/g;
  let match;
  while ((match = initRe.exec(src)) !== null) {
    if (!sliceStateTypeNames.has(match[2])) continue;
    const open = src.indexOf('{', match.index);
    const close = matchingClose(src, open, '{', '}');
    if (close === -1) continue;
    out.push(...scanObjectLiteral(src, open, close, `${match[1]}:${match[2]}`));
    initRe.lastIndex = close + 1;
  }
  return out;
}

function baselineKey(relPath, violation) {
  return `${relPath}::${violation.declarationName}.${violation.propertyPath}::${violation.typeText}`;
}

const BASELINE = new Set([
  // Existing legacy state shapes kept out of the initial rollout. New violations
  // fail unless they are explicitly added here during a deliberate migration plan.
  'src/lib/store/slices/agent-follow/agent-follow-types.ts::AgentFollowState.pendingChanges::PendingChange[]',
  'src/lib/store/slices/agent-overview/agent-overview-types.ts::AgentOverviewWorkspaceState.events::InteractionEvent[]',
  'src/lib/store/slices/browser/browser-types.ts::BrowserWorkspaceState.recentUrls::RecentUrl[]',
  'src/lib/store/slices/browser/browser-types.ts::BrowserWorkspaceState.pendingZoomByTabId::BrowserZoomAction[]',
  'src/lib/store/slices/changes/changes-types.ts::FileTrackingWorkspaceState.changes::TrackedChange[]',
  'src/lib/store/slices/changes/changes-types.ts::FileTrackingWorkspaceState.transitions::StageTransition[]',
  'src/lib/store/slices/changes/changes-types.ts::FileTrackingWorkspaceState.commits::CommitInfo[]',
  'src/lib/store/slices/changes/changes-types.ts::FileTrackingWorkspaceState.olderCommits::CommitInfo[]',
  'src/lib/store/slices/chat-state/chat-state-types.ts::ChatAgentState.statusEvents::StatusEvent[]',
  'src/lib/store/slices/git/git-types.ts::GitWorkspaceState.diffs::DiffChunk[]',
  'src/lib/store/slices/linear-auth/linear-auth-types.ts::LinearAuthSliceState.issues::LinearIssueResult[]',
  'src/lib/store/slices/mcp-servers/mcp-servers-types.ts::McpServersState.servers::McpServerInfo[]',
  'src/lib/store/slices/mcp-settings/mcp-settings-types.ts::McpSettingsState.servers::McpServerConfig[]',
  'src/lib/store/slices/mcp-settings/mcp-settings-types.ts::McpSettingsState.toolsMap::McpTool[]',
  'src/lib/store/slices/panel-layout/panel-layout-types.ts::PanelState.tabs::PanelTab[]',
  'src/lib/store/slices/panel-layout/panel-layout-types.ts::WorkspacePanelLayoutState.recentlyClosed::RecentlyClosedTab[]',
  'src/lib/store/slices/panel-layout/panel-layout-types.ts::WorkspacePanelLayoutState.layoutHistory::LayoutSnapshot[]',
  'src/lib/store/slices/panel-layout/panel-layout-types.ts::WorkspacePanelLayoutState.focusHistory::FocusHistoryEntry[]',
  'src/lib/store/slices/panel-layout/panel-layout-types.ts::WorkspacePanelLayoutState.savedSizesBeforeExpand::SavedExpandSizes[]',
  'src/lib/store/slices/scripts/scripts-types.ts::ScriptsWorkspaceState.outputBuffers::ScriptOutputLine[]',
  'src/lib/store/slices/sentry-auth/sentry-auth-types.ts::SentryAuthState.projects::SentryProject[]',
  'src/lib/store/slices/sentry-auth/sentry-auth-types.ts::SentryAuthState.issues::SentryIssueResult[]',
  'src/lib/store/slices/skills/skills-types.ts::SkillsWorkspaceState.skills::SkillInfo[]',
  'src/lib/store/slices/specialists/specialists-slice.ts::SpecialistsState.bundledSpecialists::.Specialist[]',
  'src/lib/store/slices/user-preferences/user-preferences-slice.ts::UserPreferencesState.activityLogPresets::ActivityLogPresetPreference[]',
  'src/lib/store/slices/workspace-events/workspace-events-slice.ts::WorkspaceEventsWorkspaceState.events::WorkspaceEvent[]',
  'src/lib/store/slices/workspace-navigation/workspace-navigation-slice.ts::WorkspaceNavigationMainPanelState.chatChanges::JsonValue[]',
  'src/lib/store/slices/workspace-navigation/workspace-navigation-slice.ts::WorkspaceNavigationNavigationState.history::WorkspaceNavigationHistoryEntry[]',
  'src/lib/store/slices/workspace-notes/workspace-notes-types.ts::NoteVersionsState.versions::NoteVersion[]',
  'src/lib/store/slices/workspace-notes/workspace-notes-types.ts::ReadyTasksState.tasks::Note[]',
]);

function findViolations(src, sliceStateTypeNames) {
  const stripped = stripComments(src);
  return [
    ...findStateTypeViolations(stripped, sliceStateTypeNames),
    ...findInitialStateViolations(stripped, sliceStateTypeNames),
  ];
}

async function main() {
  let isDir = false;
  try {
    isDir = (await stat(SEARCH_DIR)).isDirectory();
  } catch {
    /* ignore */
  }
  if (!isDir) {
    console.error(`${RED}Search directory not found: ${SEARCH_DIR}${NC}`);
    process.exit(2);
  }

  console.log(`${CYAN}=== Redux state Collection gate ===${NC}`);
  console.log(`Scanning: ${relative(ROOT, SEARCH_DIR) || '.'}/  (slice/type files only)`);

  const files = [];
  for await (const file of walk(SEARCH_DIR)) {
    try {
      files.push({
        abs: file,
        rel: relative(ROOT, file).split('\\').join('/'),
        src: readFileSync(file, 'utf8'),
      });
    } catch {
      continue;
    }
  }

  const sliceStateTypeNames = collectSliceStateTypeNames(files);

  let baselineCount = 0;
  let total = 0;
  const lines = [];
  for (const { rel, src } of files) {
    for (const v of findViolations(src, sliceStateTypeNames)) {
      const key = baselineKey(rel, v);
      if (BASELINE.has(key)) {
        baselineCount++;
        continue;
      }
      total++;
      lines.push(
        `  ${YELLOW}${rel}:${v.line}${NC}  [${v.kind}] ${v.declarationName}.${v.propertyPath}: ${v.typeText}`,
      );
    }
  }

  console.log('');
  if (baselineCount > 0) {
    console.log(`${YELLOW}Baseline:${NC} ${baselineCount} existing violation(s) ignored for staged rollout.`);
  }
  if (total > 0) {
    console.log(`${RED}[Redux state entity arrays]${NC} — ${total} violation(s):`);
    console.log('  Store entity/object lists as Collection<T, K>, not Entity[] or Array<Entity>.');
    console.log('  Import Collection/createCollection and update through collection utilities in reducers.');
    console.log('  Primitive arrays and ID arrays remain allowed.');
    console.log('  See src/lib/store/AGENTS.md § "Use Collection, Not Arrays".');
    for (const line of lines) console.log(line);
    console.log('');
    console.log(`${RED}✗ Found ${total} Redux state entity-array violation(s).${NC}`);
    process.exit(1);
  }
  console.log(`${CYAN}✓ No new Redux state entity-array violations found.${NC}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
