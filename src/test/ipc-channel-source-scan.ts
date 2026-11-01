/**
 * Static channel-name resolution shared by the IPC source scanners — the
 * renderer invoke reconciliation (`ipc-channel-reconciliation.test.ts`) and
 * the main/renderer path-parity ledger (`ipc-path-parity-ledger.test.ts`).
 *
 * Resolves a call's channel-argument expression (string literals,
 * `X_CHANNELS.KEY`, `IPC_CHANNELS.GROUP.KEY`, and per-file group-alias locals
 * like `const BACKEND = IPC_CHANNELS.BACKEND`) to the concrete channel name.
 */
import fs from 'node:fs';
import path from 'node:path';
import { IPC_CHANNELS } from '$shared/ipc-registry';

/**
 * Extract the first-argument expression of a call whose name ends at `index`,
 * skipping an optional generic argument list with a bracket-depth counter.
 * A regex like `<[^>]*>` stops at the FIRST `>`, so any call site with a
 * nested generic (an invoke typed as `<{ data?: Record<string, any> }>`)
 * failed to match at all and silently escaped the audit (settings:getAll
 * reached the runtime UnbridgedMockIpcChannelError exactly this way).
 */
export function extractFirstArgument(source: string, index: number): string | undefined {
  let i = skipGenericArguments(source, index);
  if (source[i] !== '(') return undefined;
  i += 1;
  while (i < source.length && /\s/.test(source[i])) i += 1;
  return readArgumentExpression(source, i);
}

/** Skip an optional `<...>` generic argument list (plus trailing whitespace). */
export function skipGenericArguments(source: string, index: number): number {
  let i = index;
  if (source[i] !== '<') return i;
  let depth = 0;
  while (i < source.length) {
    const char = source[i];
    // `=>` inside a function-type generic is not a closing bracket.
    if (char === '<') depth += 1;
    else if (char === '>' && source[i - 1] !== '=') {
      depth -= 1;
      if (depth === 0) {
        i += 1;
        break;
      }
    }
    i += 1;
  }
  while (i < source.length && /\s/.test(source[i])) i += 1;
  return i;
}

/** Read one argument expression starting at `index` (up to `,`, `)`, or EOL). */
export function readArgumentExpression(source: string, index: number): string | undefined {
  let i = index;
  while (i < source.length && source[i] !== ',' && source[i] !== ')' && source[i] !== '\n') {
    i += 1;
  }
  return source.slice(index, i).trim() || undefined;
}

export const LITERAL_RE = /^['"`]([^'"`$]+)['"`]$/;
const CHANNELS_CONST_RE = /^([A-Z][A-Z0-9_]*_CHANNELS)\.([A-Z0-9_]+)$/;
const REGISTRY_REF_RE = /^IPC_CHANNELS\.([A-Z0-9_]+(?:\.[A-Z0-9_]+)*)\.([A-Z0-9_]+)$/;
/** Group aliases may name nested groups, e.g. `IPC_CHANNELS.BACKEND.REPOSITORY_RESOURCE`. */
const GROUP_ALIAS_DECL_RE =
  /\b(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*IPC_CHANNELS\.([A-Z0-9_]+(?:\.[A-Z0-9_]+)*)\b/g;
/** `ALIAS.KEY` argument shape, resolved through the file's group aliases. */
const ALIAS_REF_RE = /^([A-Za-z_$][A-Za-z0-9_$]*)\.([A-Z0-9_]+)$/;

/** Map per-file group-alias locals (alias name → complete IPC_CHANNELS group path). */
export function collectGroupAliases(source: string): Map<string, string> {
  const aliases = new Map<string, string>();
  for (const decl of source.matchAll(GROUP_ALIAS_DECL_RE)) aliases.set(decl[1], decl[2]);
  return aliases;
}

function resolveRegistryChannel(group: string, key: string): string | undefined {
  let value: unknown = IPC_CHANNELS;
  for (const segment of [...group.split('.'), key]) {
    if (!value || typeof value !== 'object') return undefined;
    value = (value as Record<string, unknown>)[segment];
  }
  return typeof value === 'string' ? value : undefined;
}

/**
 * Resolve one channel-argument expression to a concrete channel name.
 * `unresolvedConstant` marks constant-style references the resolver could not
 * map (audit-exhaustiveness failures); anything else non-matching (variables,
 * wrapper parameters) is dynamic — the concrete channels show up at the
 * wrappers' call sites, which the scan covers.
 */
export function resolveChannelArgument(
  argument: string,
  groupAliases: Map<string, string>,
): { channel?: string; unresolvedConstant: boolean } {
  let constMatch: RegExpMatchArray | null;
  if ((constMatch = argument.match(LITERAL_RE))) {
    return { channel: constMatch[1], unresolvedConstant: false };
  }
  if ((constMatch = argument.match(CHANNELS_CONST_RE))) {
    const channel = resolveRegistryChannel(constMatch[1].replace(/_CHANNELS$/, ''), constMatch[2]);
    return { channel, unresolvedConstant: !channel };
  }
  if ((constMatch = argument.match(REGISTRY_REF_RE))) {
    const channel = resolveRegistryChannel(constMatch[1], constMatch[2]);
    return { channel, unresolvedConstant: !channel };
  }
  if ((constMatch = argument.match(ALIAS_REF_RE)) && groupAliases.has(constMatch[1])) {
    const channel = resolveRegistryChannel(groupAliases.get(constMatch[1])!, constMatch[2]);
    return { channel, unresolvedConstant: !channel };
  }
  return { unresolvedConstant: false };
}

/** `ipcMain.handle(` call heads (member-call form only; the monkeypatch in main/index.ts is not one). */
const MAIN_HANDLE_HEAD_RE = /\bipcMain\.handle\s*\(/g;
/** A bare identifier argument, e.g. `GET_BATTERY_STATE_CHANNEL`. */
const IDENTIFIER_ARGUMENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
/** `GROUP.KEY` with an upper-case group, e.g. a re-exported `COLLABORATION_AUTH.POLICY`. */
const UPPER_GROUP_REF_RE = /^([A-Z][A-Z0-9_]*)\.([A-Z0-9_]+)$/;

/** Whether the match at `index` sits on a `//` or block-comment (`*`) line. */
function isOnCommentLine(source: string, index: number): boolean {
  const lineStart = source.lastIndexOf('\n', index - 1) + 1;
  const prefix = source.slice(lineStart, index).trimStart();
  return prefix.startsWith('//') || prefix.startsWith('*') || prefix.startsWith('/*');
}

/**
 * Resolve the channel argument of one `ipcMain.handle(...)` call. Beyond
 * {@link resolveChannelArgument} this accepts the two main-process idioms the
 * renderer scan never meets: a module constant aliasing a full registry path
 * (`const GET_BATTERY_STATE_CHANNEL = IPC_CHANNELS.POWER.GET_BATTERY_STATE`)
 * and a group re-exported under its registry name
 * (`COLLABORATION_AUTH_CHANNELS as COLLABORATION_AUTH`, i.e.
 * `IPC_CHANNELS.COLLABORATION_AUTH`).
 */
function resolveMainHandlerChannel(
  argument: string,
  groupAliases: Map<string, string>,
): string | undefined {
  const resolved = resolveChannelArgument(argument, groupAliases);
  if (resolved.channel) return resolved.channel;
  if (IDENTIFIER_ARGUMENT_RE.test(argument) && groupAliases.has(argument)) {
    const segments = groupAliases.get(argument)!.split('.');
    const key = segments.pop()!;
    if (segments.length > 0) return resolveRegistryChannel(segments.join('.'), key);
  }
  const upper = argument.match(UPPER_GROUP_REF_RE);
  if (upper) return resolveRegistryChannel(upper[1], upper[2]);
  return undefined;
}

interface MainHandlerScan {
  /** Channel → `file:line` registration sites (paths relative to `srcRoot`). */
  handled: Map<string, string[]>;
  /** `file:line :: expression` registrations the resolver could not name. */
  unresolved: string[];
}

/**
 * Statically scan every non-test source under `srcRoot` for main-process
 * `ipcMain.handle(CHANNEL, …)` registrations and resolve their channels.
 */
export function scanMainInvokeHandlers(srcRoot: string): MainHandlerScan {
  const handled = new Map<string, string[]>();
  const unresolved: string[] = [];
  const walk = (dir: string, relativeDir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const relative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== '__tests__') {
          walk(path.join(dir, entry.name), relative);
        }
        continue;
      }
      if (!/\.ts$/.test(entry.name) || /\.(test|spec)\.ts$|\.d\.ts$/.test(entry.name)) continue;
      const source = fs.readFileSync(path.join(dir, entry.name), 'utf8');
      if (!source.includes('ipcMain.handle')) continue;
      const groupAliases = collectGroupAliases(source);
      for (const match of source.matchAll(MAIN_HANDLE_HEAD_RE)) {
        if (isOnCommentLine(source, match.index)) continue;
        let i = match.index + match[0].length;
        while (i < source.length && /\s/.test(source[i])) i += 1;
        const argument = readArgumentExpression(source, i);
        if (!argument) continue;
        const site = `${relative}:${source.slice(0, match.index).split('\n').length}`;
        const channel = resolveMainHandlerChannel(argument, groupAliases);
        if (!channel) {
          unresolved.push(`${site} :: ${argument}`);
          continue;
        }
        handled.set(channel, [...(handled.get(channel) ?? []), site]);
      }
    }
  };
  walk(srcRoot, '');
  return { handled, unresolved };
}

// ── Direct preload-bridge callers ──────────────────────────────────────────
//
// The generated `invoke()` always routes through the renderer mock router, so a
// main-process `ipcMain.handle` handler only runs when something calls the
// preload bridge (`window.electronAPI.invoke`) on its channel: a seeder that
// forwards, or code that bypasses the router. This scan finds the second kind.

/** Directories (relative to the package root) whose sources may call the bridge. */
const BRIDGE_CALLER_DIRS = ['src', 'e2e', 'scripts', 'cdp-mcp-server'] as const;

/** Sources the direct-caller scan reads. */
const BRIDGE_SOURCE_FILE_RE = /\.(?:ts|mts|cts|js|mjs|cjs|svelte)$/;
/**
 * Test-only sources, which install fake bridges and never reach a real main
 * process: unit tests, component specs, previews, and fixtures.
 */
const BRIDGE_TEST_ONLY_FILE_RE =
  /(?:^|\/)(?:__tests__|__mocks__|test|fixtures)\/|\.(?:test|spec)\.[cm]?[jt]s$|\.d\.ts$|\.preview\.(?:ts|svelte)$|[.-]preview-fixtures\.ts$|-fixtures?\.ts$|Harness\.svelte$/;

/**
 * `RECEIVER.invoke` heads in a bridge-aware file: `window.electronAPI.invoke`,
 * `?.invoke`, `(window as any).electronAPI.invoke`, `electronAPI().invoke`,
 * and locals holding the bridge (`api.invoke`, `bridge.invoke`, `getBridge().invoke`).
 */
const INVOKE_HEAD_RE = /\b([A-Za-z_$][A-Za-z0-9_$]*)(?:\(\))?!?\s*\??\.\s*invoke\b/g;
/**
 * `.invoke` receivers that are not the preload bridge: class clients and the
 * generated `TypedIpcClient` route through the renderer mock router, and the
 * preload's own `ipcRenderer.invoke` is the bridge implementation.
 */
const NON_BRIDGE_RECEIVERS: ReadonlySet<string> = new Set([
  'this',
  'TypedIpcClient',
  'ipcRenderer',
]);
/** A file may hold bridge calls only if it names the bridge (value or `ElectronAPI` type). */
const BRIDGE_AWARE_RE = /electronAPI/i;

/** Module constants bound to a channel literal, e.g. `const X_CHANNEL = 'browser:resolve-url'`. */
const LITERAL_CONST_DECL_RE =
  /\b(?:export\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*(?::[^=\n]+)?=\s*(['"`][^'"`$\n]+['"`])/g;
/** Candidate channel tokens inside an expression: string literals and dotted references. */
const CHANNEL_TOKEN_RE = /(['"`])([^'"`$\n]+)\1|\b[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z0-9_]+)*/g;

/** Per-file resolution context for channel tokens. */
interface FileChannelContext {
  groupAliases: Map<string, string>;
  /** Locals bound through a group alias; one name may be rebound per function. */
  chainedAliases: Map<string, string[]>;
  literalConstants: Map<string, string>;
}

/** `const channels = BACKEND.REPOSITORY_SELECTION` — a local bound through an existing group alias. */
const CHAINED_ALIAS_DECL_RE =
  /\b(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*([A-Za-z_$][A-Za-z0-9_$]*)((?:\.[A-Z0-9_]+)+)\s*[;\n]/g;

function collectFileChannelContext(source: string): FileChannelContext {
  const groupAliases = collectGroupAliases(source);
  const chainedAliases = new Map<string, string[]>();
  for (const decl of source.matchAll(CHAINED_ALIAS_DECL_RE)) {
    const base = groupAliases.get(decl[2]);
    if (base)
      chainedAliases.set(decl[1], [...(chainedAliases.get(decl[1]) ?? []), `${base}${decl[3]}`]);
  }
  const literalConstants = new Map<string, string>();
  for (const decl of source.matchAll(LITERAL_CONST_DECL_RE)) {
    const literal = decl[2].match(LITERAL_RE);
    if (literal) literalConstants.set(decl[1], literal[1]);
  }
  return { groupAliases, chainedAliases, literalConstants };
}

/** Resolve one token (literal, constant reference, or identifier) to a channel. */
function resolveChannelToken(token: string, context: FileChannelContext): string | undefined {
  if (IDENTIFIER_ARGUMENT_RE.test(token) && context.literalConstants.has(token)) {
    return context.literalConstants.get(token);
  }
  const resolved = resolveMainHandlerChannel(token, context.groupAliases);
  if (resolved) return resolved;
  // `ALIAS.NESTED.KEY` through a group alias (`BACKEND.REPOSITORY.RELEASE`) or a
  // local bound through one (`const channels = BACKEND.REPOSITORY_SELECTION`).
  const [head, ...rest] = token.split('.');
  if (rest.length === 0 || !rest.every((segment) => /^[A-Z0-9_]+$/.test(segment))) return undefined;
  const bases = [
    ...(rest.length > 1 && context.groupAliases.has(head) ? [context.groupAliases.get(head)!] : []),
    ...(context.chainedAliases.get(head) ?? []),
  ];
  for (const base of bases) {
    const channel = resolveRegistryChannel([base, ...rest.slice(0, -1)].join('.'), rest.at(-1)!);
    if (channel) return channel;
  }
  return undefined;
}

/**
 * Every channel an expression can name: each literal and constant reference in
 * it, so a ternary (`isGet ? CHANNELS.GET : CHANNELS.SET`) yields both arms.
 */
function channelsInExpression(expression: string, context: FileChannelContext): string[] {
  const channels = new Set<string>();
  for (const match of expression.matchAll(CHANNEL_TOKEN_RE)) {
    const channel = resolveChannelToken(match[0], context);
    if (channel) channels.add(channel);
  }
  return [...channels];
}

/**
 * Read a call's comma-separated arguments starting just after its `(`,
 * tracking brackets, strings, and template literals so multi-line and nested
 * arguments stay whole.
 */
function readCallArguments(source: string, index: number): string[] {
  const args: string[] = [];
  let depth = 0;
  let start = index;
  let quote: string | undefined;
  for (let i = index; i < source.length; i += 1) {
    const char = source[i];
    if (quote) {
      if (char === '\\') i += 1;
      else if (char === quote) quote = undefined;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') quote = char;
    else if (char === '(' || char === '[' || char === '{') depth += 1;
    else if (char === ')' || char === ']' || char === '}') {
      if (depth === 0) {
        const last = source.slice(start, i).trim();
        if (last) args.push(last);
        return args;
      }
      depth -= 1;
    } else if (char === ',' && depth === 0) {
      args.push(source.slice(start, i).trim());
      start = i + 1;
    }
  }
  return args;
}

function previousSignificant(source: string, index: number): { char: string; at: number } {
  let i = index - 1;
  while (i >= 0 && /\s/.test(source[i])) i -= 1;
  return { char: source[i] ?? '', at: i };
}

/**
 * Whether a non-call `…invoke` reference hands the bridge function to other
 * code (`call([api, api.invoke], CH)`, `resolve(url, window.electronAPI?.invoke)`)
 * rather than feature-testing it (`if (!api?.invoke)`, `typeof api.invoke`).
 */
function isInvokeHandoff(source: string, start: number, end: number): boolean {
  let expressionStart = start;
  while (expressionStart > 0 && /[A-Za-z0-9_$.?!]/.test(source[expressionStart - 1])) {
    expressionStart -= 1;
  }
  const before = previousSignificant(source, expressionStart);
  const after = source.slice(end).trimStart()[0] ?? '';
  if (!',)];:}'.includes(after) || after === '') return false;
  if (before.char === '(') {
    return !/\b(?:if|while|Boolean)\s*$/.test(source.slice(0, before.at));
  }
  if (before.char === '?') return source[before.at - 1] !== '?';
  if (before.char === '=') return !'=!<>'.includes(source[before.at - 1] ?? '');
  return before.char === ',' || before.char === '[' || before.char === ':';
}

/** One source file read by the direct-caller scan. */
export interface BridgeSourceFile {
  /** Path relative to the package root, e.g. `src/lib/foo.ts`. */
  file: string;
  source: string;
}

/** List every non-test bridge-caller source under `dirs` (relative to `packageRoot`). */
export function readBridgeCallerSources(
  packageRoot: string,
  dirs: readonly string[] = BRIDGE_CALLER_DIRS,
): BridgeSourceFile[] {
  const files: BridgeSourceFile[] = [];
  const walk = (relativeDir: string) => {
    const absolute = path.join(packageRoot, relativeDir);
    if (!fs.existsSync(absolute)) return;
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
      const relative = `${relativeDir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && !entry.name.startsWith('.')) walk(relative);
        continue;
      }
      if (!BRIDGE_SOURCE_FILE_RE.test(entry.name) || BRIDGE_TEST_ONLY_FILE_RE.test(relative)) {
        continue;
      }
      files.push({
        file: relative,
        source: fs.readFileSync(path.join(packageRoot, relative), 'utf8'),
      });
    }
  };
  for (const dir of dirs) walk(dir);
  return files;
}

/**
 * A wrapper that calls the bridge with a channel it receives as a parameter.
 * Its channels come from its own file plus the call sites of `callers`.
 */
export interface KnownBridgeWrapper {
  /** Why this wrapper exists. */
  reason: string;
  /** Extra files (package-root relative) whose channel tokens the wrapper reaches. */
  channelFiles?: readonly string[];
  /** Exported wrapper functions; the channel tokens of their first argument count at every call site. */
  callers?: readonly string[];
}

export interface BridgeCallerScan {
  /** Channel → `file:line` sites that reach the bridge with that channel. */
  called: Map<string, string[]>;
  /** Bridge calls or handoffs whose channel is not statically named, by file. */
  dynamicSites: Map<string, string[]>;
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

/** Resolve the first-argument channels of every `name(` call in `source`. */
function wrapperCallChannels(source: string, name: string, context: FileChannelContext): string[] {
  const channels: string[] = [];
  const callRe = new RegExp(`\\b${name}\\b`, 'g');
  for (const match of source.matchAll(callRe)) {
    if (isOnCommentLine(source, match.index)) continue;
    let i = skipGenericArguments(source, match.index + match[0].length);
    if (source[i] === '(') {
      const [first] = readCallArguments(source, i + 1);
      if (first) channels.push(...channelsInExpression(first, context));
      continue;
    }
    // Saga form: `call(name<T>, CHANNEL, …)` — the channel is the next argument.
    if (source[i] === ',') {
      const [next] = readCallArguments(source, i + 1);
      if (next) channels.push(...channelsInExpression(next, context));
    }
  }
  return channels;
}

/** Every channel token on a non-comment line of `source`. */
function fileChannelTokens(source: string, context: FileChannelContext): string[] {
  const channels = new Set<string>();
  for (const match of source.matchAll(CHANNEL_TOKEN_RE)) {
    if (isOnCommentLine(source, match.index)) continue;
    const channel = resolveChannelToken(match[0], context);
    if (channel) channels.add(channel);
  }
  return [...channels];
}

/**
 * Statically find every channel called directly through the preload bridge:
 * `electronAPI.invoke(CHANNEL, …)` in any of its spellings, calls through a
 * local alias of the bridge object, and — for wrappers listed in
 * `knownWrappers` (keyed by file) — the channels the wrapper is called with.
 * Call sites and handoffs whose channel cannot be named land in `dynamicSites`
 * so the caller can require each to be a known wrapper.
 */
export function scanDirectBridgeCallers(
  files: readonly BridgeSourceFile[],
  knownWrappers: ReadonlyMap<string, KnownBridgeWrapper> = new Map(),
): BridgeCallerScan {
  const called = new Map<string, string[]>();
  const dynamicSites = new Map<string, string[]>();
  const record = (channel: string, site: string) => {
    const sites = called.get(channel) ?? [];
    if (!sites.includes(site)) called.set(channel, [...sites, site]);
  };
  const byFile = new Map(files.map((entry) => [entry.file, entry.source]));
  const contexts = new Map(
    files.map((entry) => [entry.file, collectFileChannelContext(entry.source)]),
  );

  for (const { file, source } of files) {
    if (!BRIDGE_AWARE_RE.test(source)) continue;
    const context = contexts.get(file)!;
    for (const match of source.matchAll(INVOKE_HEAD_RE)) {
      if (NON_BRIDGE_RECEIVERS.has(match[1]) || isOnCommentLine(source, match.index)) continue;
      const site = `${file}:${lineOf(source, match.index)}`;
      const end = match.index + match[0].length;
      let i = end;
      if (source[i] === '!') i += 1;
      if (source.startsWith('?.', i)) i += 2;
      i = skipGenericArguments(source, i);
      if (source[i] !== '(') {
        // Saga context call: `call([api, api.invoke], CHANNEL, …)`.
        const contextCall = source.slice(end).match(/^\s*\]\s*,/);
        if (contextCall) {
          const [next] = readCallArguments(source, end + contextCall[0].length);
          const channels = next ? channelsInExpression(next, context) : [];
          for (const channel of channels) record(channel, site);
          if (channels.length > 0) continue;
        }
        if (isInvokeHandoff(source, match.index, end)) {
          dynamicSites.set(file, [...(dynamicSites.get(file) ?? []), `${site} :: handoff`]);
        }
        continue;
      }
      const [first] = readCallArguments(source, i + 1);
      const channels = first ? channelsInExpression(first, context) : [];
      if (channels.length === 0) {
        dynamicSites.set(file, [...(dynamicSites.get(file) ?? []), `${site} :: ${first ?? ''}`]);
        continue;
      }
      for (const channel of channels) record(channel, site);
    }
  }

  for (const [file, wrapper] of knownWrappers) {
    const source = byFile.get(file);
    if (source === undefined) continue;
    for (const channelFile of [file, ...(wrapper.channelFiles ?? [])]) {
      const channelSource = byFile.get(channelFile);
      if (channelSource === undefined) continue;
      for (const channel of fileChannelTokens(channelSource, contexts.get(channelFile)!)) {
        record(channel, `${channelFile} (via ${file})`);
      }
    }
    for (const name of wrapper.callers ?? []) {
      for (const entry of files) {
        if (!entry.source.includes(name)) continue;
        for (const channel of wrapperCallChannels(entry.source, name, contexts.get(entry.file)!)) {
          record(channel, `${entry.file} (via ${name})`);
        }
      }
    }
  }
  return { called, dynamicSites };
}
