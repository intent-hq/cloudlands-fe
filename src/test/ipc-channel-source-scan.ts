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
