/**
 * IPC channel reconciliation — automated audit of renderer invoke call sites
 * against the channels bridged by the mock-router seeders.
 *
 * The mock IPC router rejects invokes on unregistered channels
 * (`UnbridgedMockIpcChannelError`) instead of resolving undefined. This suite
 * keeps that guarantee auditable: it statically scans every renderer source
 * file for `invoke(...)` / `typedInvoke(...)` call sites — including named
 * import aliases such as `import { invoke as invokeIpc }` and locally-declared
 * passthrough wrappers that forward their first parameter to an invoke (the
 * per-provider `invokeModelChannel` helpers) — resolves the channel names
 * (string literals, `X_CHANNELS.KEY`, `IPC_CHANNELS.GROUP.KEY`, and group-alias
 * locals like `const BACKEND = IPC_CHANNELS.BACKEND`), and reconciles them
 * against the channels the seeders register. Channels only ever invoked
 * through a runtime variable are a scanner limitation and must be recorded in
 * `DYNAMIC_INVOKE_CALL_SITES` below.
 *
 * A NEW invoke call site referencing an unregistered channel fails this suite.
 * To make it pass, either bridge the channel in a seeder (preferred), add it to
 * `UNBRIDGED_INVOKE_ALLOWLIST` in ipc-mock-router.ts (only when every caller
 * legitimately tolerates absence), or — for pre-existing audit findings only —
 * keep it listed in `KNOWN_UNBRIDGED_CHANNELS` below. When a channel is bridged
 * or retired, its entry MUST be removed (enforced by the staleness test).
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import './index';
import {
  EMITTED_MOCK_IPC_EVENT_CHANNEL_PREFIXES,
  EMITTED_MOCK_IPC_EVENT_CHANNELS,
  getRegisteredMockIpcChannels,
  isEmittedMockIpcEventChannel,
  UNBRIDGED_INVOKE_ALLOWLIST,
  UNEMITTED_LISTENER_ALLOWLIST,
} from '$shared/ipc-mock-router';
import { IPC_CHANNELS } from '$shared/ipc-registry';

const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** Directory segments that never route through the renderer mock IPC router. */
const EXCLUDED_DIR_SEGMENTS = /(^|\/)(main|preload|__tests__|node_modules)(\/|$)/;
/** Files that are not production renderer invoke surface. */
const EXCLUDED_FILES = /(\.test\.ts|\.spec\.ts|test-setup|\.d\.ts)$/;
const INCLUDED_FILES = /\.(ts|svelte)$/;

/** Named-import clauses, whose contents may alias invoke/typedInvoke. */
const IMPORT_CLAUSE_RE = /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"][^'"]+['"]/g;
const INVOKE_ALIAS_RE = /\b(?:typedInvoke|invoke)\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;

/** Function declarations whose first parameter is a string (wrapper candidates). */
const WRAPPER_DECL_RE =
  /(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:<[^(]*?>)?\(\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*:\s*string/g;

/**
 * Collect locally-declared passthrough wrappers: functions whose string-typed
 * first parameter is forwarded verbatim as the first argument of an invoke
 * call (e.g. the per-provider `invokeModelChannel(channel)` helpers, which
 * prefer `window.electronAPI.invoke(channel)`). The wrapper body's own invoke
 * is dynamic (a bare parameter), so the concrete channels only exist at the
 * wrapper's call sites — treating the wrapper name as an invoke head is what
 * lets the audit see them (the 7 `*:get-models` channels escaped this way).
 */
function collectPassthroughWrapperNames(source: string): string[] {
  const names: string[] = [];
  for (const decl of source.matchAll(WRAPPER_DECL_RE)) {
    const [, name, parameter] = decl;
    if (name === 'invoke' || name === 'typedInvoke') continue;
    const forwards = new RegExp(`\\binvoke\\s*(?:<[^(]*?>)?\\(\\s*${parameter}\\s*[,)]`);
    if (forwards.test(source.slice(decl.index))) names.push(name);
  }
  return names;
}

/**
 * Build the invoke( / typedInvoke( call-head regex for one source file,
 * matching up to (but not consuming) the generic argument list or the opening
 * paren. Import aliases declared in the file (e.g. `import { invoke as
 * invokeIpc }`) and locally-declared passthrough wrappers are matched as call
 * sites too, so aliased and wrapped invokes cannot escape the audit.
 */
function buildCallHeadRegex(source: string): RegExp {
  const names = new Set(['typedInvoke', 'invoke']);
  for (const clause of source.matchAll(IMPORT_CLAUSE_RE)) {
    for (const alias of clause[1].matchAll(INVOKE_ALIAS_RE)) names.add(alias[1]);
  }
  for (const wrapper of collectPassthroughWrapperNames(source)) names.add(wrapper);
  const alternation = [...names].sort((a, b) => b.length - a.length).join('|');
  return new RegExp(`\\b(?:${alternation})\\s*(?=[<(])`, 'g');
}

/**
 * Extract the first-argument expression of a call whose name ends at `index`,
 * skipping an optional generic argument list with a bracket-depth counter.
 * A regex like `<[^>]*>` stops at the FIRST `>`, so any call site with a
 * nested generic — `invoke<{ data?: Record<string, any> }>('settings:getAll')`
 * — failed to match at all and silently escaped the audit (settings:getAll
 * reached the runtime UnbridgedMockIpcChannelError exactly this way).
 */
function extractFirstArgument(source: string, index: number): string | undefined {
  let i = index;
  if (source[i] === '<') {
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
  }
  if (source[i] !== '(') return undefined;
  i += 1;
  while (i < source.length && /\s/.test(source[i])) i += 1;
  const start = i;
  while (i < source.length && source[i] !== ',' && source[i] !== ')' && source[i] !== '\n') {
    i += 1;
  }
  return source.slice(start, i).trim() || undefined;
}
const LITERAL_RE = /^['"`]([^'"`$]+)['"`]$/;
const CHANNELS_CONST_RE = /^([A-Z][A-Z0-9_]*_CHANNELS)\.([A-Z0-9_]+)$/;
const REGISTRY_REF_RE = /^IPC_CHANNELS\.([A-Z0-9_]+)\.([A-Z0-9_]+)$/;
/** Group-alias local declarations, e.g. `const BACKEND = IPC_CHANNELS.BACKEND`. */
const GROUP_ALIAS_DECL_RE =
  /\b(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*IPC_CHANNELS\.([A-Z0-9_]+)\b/g;
/** `ALIAS.KEY` argument shape, resolved through the file's group aliases. */
const ALIAS_REF_RE = /^([A-Za-z_$][A-Za-z0-9_$]*)\.([A-Z0-9_]+)$/;

/** Map per-file group-alias locals (alias name → IPC_CHANNELS group name). */
function collectGroupAliases(source: string): Map<string, string> {
  const aliases = new Map<string, string>();
  for (const decl of source.matchAll(GROUP_ALIAS_DECL_RE)) aliases.set(decl[1], decl[2]);
  return aliases;
}

function* walkRendererSources(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    const relative = path.relative(SRC_ROOT, absolute);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIR_SEGMENTS.test(`${relative}/`)) continue;
      yield* walkRendererSources(absolute);
    } else if (
      INCLUDED_FILES.test(entry.name) &&
      !EXCLUDED_FILES.test(entry.name) &&
      !relative.startsWith(path.join('shared', 'generated'))
    ) {
      yield absolute;
    }
  }
}

function resolveRegistryChannel(group: string, key: string): string | undefined {
  const groupObject = (IPC_CHANNELS as Record<string, unknown>)[group];
  if (!groupObject || typeof groupObject !== 'object') return undefined;
  const value = (groupObject as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

interface ScanResult {
  /** Statically resolved channel → call sites (`file:line`). */
  invoked: Map<string, string[]>;
  /** Constant-style references the resolver could not map to a channel. */
  unresolved: string[];
}

/** Scan renderer sources for statically-resolvable IPC invoke call sites. */
function scanInvokedChannels(): ScanResult {
  const invoked = new Map<string, string[]>();
  const unresolved: string[] = [];
  for (const file of walkRendererSources(SRC_ROOT)) {
    const source = fs.readFileSync(file, 'utf8');
    const relative = path.relative(SRC_ROOT, file);
    const groupAliases = collectGroupAliases(source);
    for (const match of source.matchAll(buildCallHeadRegex(source))) {
      const argument = extractFirstArgument(source, match.index + match[0].length);
      if (!argument) continue;
      const line = source.slice(0, match.index).split('\n').length;
      const site = `${relative}:${line}`;
      let channel: string | undefined;
      let constMatch: RegExpMatchArray | null;
      if ((constMatch = argument.match(LITERAL_RE))) {
        channel = constMatch[1];
      } else if ((constMatch = argument.match(CHANNELS_CONST_RE))) {
        channel = resolveRegistryChannel(constMatch[1].replace(/_CHANNELS$/, ''), constMatch[2]);
        if (!channel) unresolved.push(`${site} :: ${argument}`);
      } else if ((constMatch = argument.match(REGISTRY_REF_RE))) {
        channel = resolveRegistryChannel(constMatch[1], constMatch[2]);
        if (!channel) unresolved.push(`${site} :: ${argument}`);
      } else if ((constMatch = argument.match(ALIAS_REF_RE)) && groupAliases.has(constMatch[1])) {
        channel = resolveRegistryChannel(groupAliases.get(constMatch[1])!, constMatch[2]);
        if (!channel) unresolved.push(`${site} :: ${argument}`);
      }
      // Anything else (variables, wrapper parameters) is dynamic: the concrete
      // channels show up at the wrappers' call sites, which this scan covers.
      if (channel) {
        const sites = invoked.get(channel) ?? [];
        sites.push(site);
        invoked.set(channel, sites);
      }
    }
  }
  return { invoked, unresolved };
}

describe('IPC channel reconciliation (renderer invoke surface vs bridged channels)', () => {
  const { invoked, unresolved } = scanInvokedChannels();
  const registered = new Set(getRegisteredMockIpcChannels());

  it('scanner sanity: detects the known invoke surface', () => {
    // Guard against the scanner silently matching nothing after a refactor.
    // (Threshold rebased from 200 after IPC batch 8 retired the caller-less
    // legacy clients — lib/api/{client,mcp-client,ssh-client}.ts and
    // panel-layout-history.client.ts — and their ~25 channels; the scan now
    // resolves ~175 channels.)
    expect(invoked.size).toBeGreaterThan(150);
    // git:status moved to the daemon (backendRequest('git.status'), 4C-3) and
    // git:show-file followed with D2 (backendRequest('git.showFile'));
    // git:numstat remains a local-IPC invoke (bridged via git-bridge-seeder).
    expect(invoked.has('git:numstat')).toBe(true);
    expect(invoked.has('dialog:open')).toBe(true);
    // Aliased import call site (`import { invoke as invokeIpc }`, scripts.client.ts).
    expect(invoked.has('scripts:detect')).toBe(true);
    // Nested-generic call site (`invokeIpc<AutoUpdateResponse<UpdateState>>`,
    // auto-update.client.ts). A `<[^>]*>` matcher stops at the first `>` and
    // drops such call sites entirely — settings:getAll escaped to a runtime
    // UnbridgedMockIpcChannelError that way. Guards the depth-aware parser.
    expect(invoked.has('auto-update:get-state')).toBe(true);
    // Passthrough-wrapper call site (`invokeModelChannel('droid:get-models')`,
    // droid-models.client.ts). Guards the wrapper-name detection — the 7
    // `*:get-models` channels escaped the audit through these wrappers.
    expect(invoked.has('droid:get-models')).toBe(true);
    // Group-alias local (`const BACKEND = IPC_CHANNELS.BACKEND` →
    // `api.invoke(BACKEND.REQUEST, …)`, backend-transport.ts). Guards the
    // per-file alias resolver.
    expect(invoked.has('backend:request')).toBe(true);
    expect([...invoked.keys()].some((channel) => registered.has(channel))).toBe(true);
  });

  it('resolves every constant-style channel reference', () => {
    expect(
      unresolved,
      'Constant-style channel references the resolver could not map — extend ' +
        'resolveRegistryChannel() or the regexes in this file so the audit stays exhaustive.',
    ).toEqual([]);
  });

  it('every invoked channel is bridged, allowlisted, exempt transport, or a recorded audit finding', () => {
    const uncovered = [...new Set([...invoked.keys(), ...DYNAMIC_INVOKE_CALL_SITES.keys()])]
      .filter(
        (channel) =>
          !registered.has(channel) &&
          !UNBRIDGED_INVOKE_ALLOWLIST.has(channel) &&
          !LIVE_TRANSPORT_CHANNELS.has(channel) &&
          !KNOWN_UNBRIDGED_CHANNELS.has(channel),
      )
      .sort()
      .map(
        (channel) =>
          `${channel}\n    ${(invoked.get(channel) ?? [DYNAMIC_INVOKE_CALL_SITES.get(channel)!]).join('\n    ')}`,
      );
    expect(
      uncovered,
      'New invoke call sites reference channels with no registered mock-router bridge. ' +
        'These invokes REJECT at runtime (UnbridgedMockIpcChannelError). Bridge the channel in ' +
        'a seeder under src/store/renderer/seeders/ (preferred), or justify an entry in ' +
        'UNBRIDGED_INVOKE_ALLOWLIST (ipc-mock-router.ts). Do NOT add new KNOWN_UNBRIDGED_CHANNELS ' +
        'entries — that list is frozen audit debt.',
    ).toEqual([]);
  });

  it('KNOWN_UNBRIDGED_CHANNELS holds no stale (now bridged/allowlisted) entries', () => {
    const stale = [...KNOWN_UNBRIDGED_CHANNELS].filter(
      (channel) => registered.has(channel) || UNBRIDGED_INVOKE_ALLOWLIST.has(channel),
    );
    expect(
      stale,
      'Bridged/allowlisted channels must be removed from KNOWN_UNBRIDGED_CHANNELS',
    ).toEqual([]);
  });

  it('LIVE_TRANSPORT_CHANNELS entries stay un-mocked and still have call sites', () => {
    // The exemption is only honest while the transport bypasses the mock
    // router. A mock-bridged or call-site-less entry must be removed.
    const dishonest = [...LIVE_TRANSPORT_CHANNELS].filter(
      (channel) => registered.has(channel) || !invoked.has(channel),
    );
    expect(
      dishonest,
      'LIVE_TRANSPORT_CHANNELS entries must be invoked somewhere and never mock-bridged',
    ).toEqual([]);
  });

  it('KNOWN_UNBRIDGED_CHANNELS holds no dead entries with zero remaining call sites', () => {
    const dead = [...KNOWN_UNBRIDGED_CHANNELS].filter(
      (channel) => !invoked.has(channel) && !DYNAMIC_INVOKE_CALL_SITES.has(channel),
    );
    expect(
      dead,
      'Channels with no remaining invoke call sites must be removed from KNOWN_UNBRIDGED_CHANNELS',
    ).toEqual([]);
  });

  it('DYNAMIC_INVOKE_CALL_SITES holds no entries the scanner now resolves statically', () => {
    const covered = [...DYNAMIC_INVOKE_CALL_SITES.keys()].filter((channel) => invoked.has(channel));
    expect(
      covered,
      'Statically-resolved channels must be removed from DYNAMIC_INVOKE_CALL_SITES',
    ).toEqual([]);
  });

  it('KNOWN_UNBRIDGED_CHANNELS tolerates no startup-critical (store middleware) call sites', () => {
    // Frozen audit debt is only tolerable for interaction-gated call sites
    // (a click on an unported affordance failing loud is acceptable debt).
    // Store middlewares run unconditionally on app/workspace load, so a debt
    // channel invoked there rejects on EVERY load — that is a live bug, not
    // debt (workspace:get-recent-repositories reached runtime exactly this
    // way despite this suite passing). Such channels must be bridged or
    // allowlisted, never parked in KNOWN_UNBRIDGED_CHANNELS.
    const middlewarePrefix = path.join('store', 'renderer', 'middlewares') + path.sep;
    const startupDebt = [...KNOWN_UNBRIDGED_CHANNELS]
      .map((channel) => ({
        channel,
        sites: (invoked.get(channel) ?? []).filter((site) => site.startsWith(middlewarePrefix)),
      }))
      .filter(({ sites }) => sites.length > 0)
      .map(({ channel, sites }) => `${channel}\n    ${sites.join('\n    ')}`);
    expect(
      startupDebt,
      'KNOWN_UNBRIDGED_CHANNELS entries invoked from store middlewares reject on every app ' +
        'load. Bridge the channel in a seeder or justify an UNBRIDGED_INVOKE_ALLOWLIST entry.',
    ).toEqual([]);
  });
});

/**
 * Scanner limitation — dynamically invoked channels. These channels are only
 * ever passed to `invoke` through a runtime variable (e.g. a provider →
 * channel map), so the static argument resolver above cannot see them. Each
 * entry records the call site that dispatches it. They count as invoked for
 * the coverage and dead-entry checks; remove an entry when its call site is
 * retired or rewritten as a statically-resolvable invoke.
 */
const DYNAMIC_INVOKE_CALL_SITES: ReadonlyMap<string, string> = new Map([
  // ProviderSelector.svelte handleSetupMcp(): invoke(channelMap[providerId]).
  ['auggie:setup-mcp-claude-code', 'lib/components/settings/ProviderSelector.svelte'],
  ['auggie:setup-mcp-codex', 'lib/components/settings/ProviderSelector.svelte'],
  ['auggie:setup-mcp-cortex', 'lib/components/settings/ProviderSelector.svelte'],
  ['auggie:setup-mcp-droid', 'lib/components/settings/ProviderSelector.svelte'],
  ['auggie:setup-mcp-opencode', 'lib/components/settings/ProviderSelector.svelte'],
  ['auggie:setup-mcp-pi', 'lib/components/settings/ProviderSelector.svelte'],
]);

/**
 * Live daemon transport — the renderer↔intentd JSON-RPC bridge
 * (`backend-transport.ts`). These channels intentionally BYPASS the mock IPC
 * router: they are invoked on the real `window.electronAPI` so migrated
 * domains reach the live main-process JSON-RPC client, and in environments
 * without a preload bridge `backendRequest()` throws a shaped
 * `BackendError({ code: 'UNAVAILABLE' })` before any IPC is attempted. They
 * must never be mock-bridged (a mock would shadow the daemon seam), so they
 * are exempted explicitly here instead of parked as unbridged debt or hidden
 * from the scan. (`backend:notification` is an event channel, not an invoke.)
 */
const LIVE_TRANSPORT_CHANNELS: ReadonlySet<string> = new Set([
  'backend:request',
  'backend:subscribe',
  'backend:unsubscribe',
]);

/**
 * Audit findings (P3 FE audit): channels invoked by production renderer code
 * with NO mock-router bridge. Every invoke of such a channel rejects with
 * UnbridgedMockIpcChannelError. Frozen debt — entries may only be REMOVED;
 * never add to this list for new work.
 *
 * IPC batch 8 drained the list to empty. The final tranche: the analytics
 * boot family (analytics:get-config allowlisted; app:get-version /
 * auggie:get-user-info were already allowlisted), workspace:get bridged to
 * the daemon workspace.get (workspaces-seeder), sentry-auth:get-issue
 * bridged to sentry.getIssue (integrations-bridge-seeder), shell:openExternal
 * / vscode:openFile bridged in host-bridge-seeder (window.open /
 * host.openInEditor), window:open-new bridged to window.open
 * (misc-ui-events-seeder), persistence:* bridged to namespaced localStorage
 * (settings-legacy-bridge-seeder), workspace:rename-branch bridged to
 * host.exec git branch -m (git-bridge-seeder), the ssh probes / dialogs /
 * patch / reference / misc interaction debt moved to justified
 * UNBRIDGED_INVOKE_ALLOWLIST entries, and the caller-less legacy clients were
 * retired with their channels (src/lib/api/{client,mcp-client,ssh-client}.ts
 * — the snake_case workspace family, changes:*, mcp:*, and 8 ssh:* channels;
 * features/layout/panel-layout-history.client.ts — panel-layout:*; and the
 * uncalled workspaceClient get/close/duplicate/renameBranch/
 * preflightCloneCheck methods, retiring workspace:close / workspace:duplicate
 * / workspace:preflight-clone-check).
 */
const KNOWN_UNBRIDGED_CHANNELS: ReadonlySet<string> = new Set([]);

// ───────────────────────────────────────────────────────────────────────────
// Event-channel reconciliation (silent-gap class)
//
// The invoke audit above catches requests that REJECT; event listeners fail
// the other way — a listener on a channel no emitter delivers simply never
// fires (stale git status, lost ready-task transitions: the transcript-loss
// class). This scan reconciles every renderer event-listener call site
// (`listenSync`/`listen`/`on` from $lib/electron-bridge, plus direct
// `addMockIpcListener`) against the channels production emitters deliver
// (`EMITTED_MOCK_IPC_EVENT_CHANNELS`, kept honest against the scanned
// `emitMockIpcEvent` call sites) and the justified silent listeners
// (`UNEMITTED_LISTENER_ALLOWLIST`). Listeners registered on the REAL preload
// bridge (`window.electronAPI.on` — the backend transport and auto-update
// client) bypass the mock router and are intentionally out of scope.
// ───────────────────────────────────────────────────────────────────────────

/** electron-bridge listener heads (with `as` aliases) named in an import clause. */
const BRIDGE_IMPORT_CLAUSE_RE = /import\s*\{([^}]*)\}\s*from\s*['"]\$lib\/electron-bridge['"]/g;
const BRIDGE_LISTENER_NAME_RE =
  /\b(?:listenSync|listen|on)\b(?:\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*))?/g;
/** mock-router listener/emitter heads named in an import clause. */
const ROUTER_IMPORT_CLAUSE_RE = /import\s*\{([^}]*)\}\s*from\s*['"][^'"]*ipc-mock-router['"]/g;
const ROUTER_LISTENER_NAME_RE = /\baddMockIpcListener\b(?:\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*))?/g;
const ROUTER_EMITTER_NAME_RE = /\bemitMockIpcEvent\b(?:\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*))?/g;

/** Dynamic-family channel template, e.g. `terminal:professional:exit:${id}`. */
const TEMPLATE_PREFIX_RE = /^`([^`$]+)\$\{/;

/**
 * Transport/router internals whose own listener/emit calls forward a caller's
 * channel variable — they ARE the plumbing, not a call site with a concrete
 * channel, so they are excluded from the event scan (their callers are not).
 */
const EVENT_SCAN_EXCLUDED_FILES = new Set([
  path.join('lib', 'electron-bridge.ts'),
  path.join('shared', 'ipc-mock-router.ts'),
]);

interface EventScanResult {
  /** Exact listened channel → call sites. */
  listened: Map<string, string[]>;
  /** Listened dynamic-family prefix (template literal) → call sites. */
  listenedPrefixes: Map<string, string[]>;
  /** Exact emitted channel → emit sites. */
  emitted: Map<string, string[]>;
  /** Emitted dynamic-family prefix (template literal) → emit sites. */
  emittedPrefixes: Map<string, string[]>;
  /** Listener call sites whose channel argument the scan could not resolve. */
  dynamicListenerSites: string[];
}

function collectAliases(source: string, clauseRe: RegExp, nameRe: RegExp): Set<string> {
  const names = new Set<string>();
  for (const clause of source.matchAll(new RegExp(clauseRe.source, clauseRe.flags))) {
    for (const m of clause[1].matchAll(new RegExp(nameRe.source, nameRe.flags))) {
      names.add(m[1] ?? m[0]);
    }
  }
  return names;
}

/** Scan renderer sources for event-listener and mock-emit call sites. */
function scanEventChannels(): EventScanResult {
  const result: EventScanResult = {
    listened: new Map(),
    listenedPrefixes: new Map(),
    emitted: new Map(),
    emittedPrefixes: new Map(),
    dynamicListenerSites: [],
  };
  const record = (map: Map<string, string[]>, key: string, site: string) => {
    const sites = map.get(key) ?? [];
    sites.push(site);
    map.set(key, sites);
  };
  for (const file of walkRendererSources(SRC_ROOT)) {
    const relative = path.relative(SRC_ROOT, file);
    if (EVENT_SCAN_EXCLUDED_FILES.has(relative)) continue;
    const source = fs.readFileSync(file, 'utf8');
    const listenerNames = collectAliases(source, BRIDGE_IMPORT_CLAUSE_RE, BRIDGE_LISTENER_NAME_RE);
    for (const name of collectAliases(source, ROUTER_IMPORT_CLAUSE_RE, ROUTER_LISTENER_NAME_RE)) {
      listenerNames.add(name);
    }
    const emitterNames = collectAliases(source, ROUTER_IMPORT_CLAUSE_RE, ROUTER_EMITTER_NAME_RE);
    const heads: Array<{ names: Set<string>; kind: 'listen' | 'emit' }> = [
      { names: listenerNames, kind: 'listen' },
      { names: emitterNames, kind: 'emit' },
    ];
    for (const { names, kind } of heads) {
      if (names.size === 0) continue;
      const alternation = [...names].sort((a, b) => b.length - a.length).join('|');
      // The lookbehind keeps member calls (`emitter.on(...)`) out of the scan.
      const headRe = new RegExp(`(?<![.\\w$])(?:${alternation})\\s*(?=[<(])`, 'g');
      for (const match of source.matchAll(headRe)) {
        const argument = extractFirstArgument(source, match.index + match[0].length);
        if (!argument) continue;
        const line = source.slice(0, match.index).split('\n').length;
        const site = `${relative}:${line}`;
        let constMatch: RegExpMatchArray | null;
        if ((constMatch = argument.match(LITERAL_RE))) {
          record(kind === 'listen' ? result.listened : result.emitted, constMatch[1], site);
        } else if ((constMatch = argument.match(TEMPLATE_PREFIX_RE))) {
          record(
            kind === 'listen' ? result.listenedPrefixes : result.emittedPrefixes,
            constMatch[1],
            site,
          );
        } else if (kind === 'listen') {
          result.dynamicListenerSites.push(`${site} :: ${argument}`);
        }
      }
    }
  }
  return result;
}

describe('IPC event-channel reconciliation (renderer listener surface vs emitters)', () => {
  const { listened, listenedPrefixes, emitted, emittedPrefixes, dynamicListenerSites } =
    scanEventChannels();

  it('scanner sanity: detects the known listener surface', () => {
    // Simple literal listenSync call sites (WorkspaceProgressCard).
    expect(listened.has('git:status-changed')).toBe(true);
    // Multiline nested-generic call sites (`listenSync<{ workspaceId: string;
    // … }>(\n 'workspace:updated', …)`) — guards the depth-aware argument
    // parser; a naive single-line matcher drops these entirely.
    expect(listened.has('workspace:updated')).toBe(true);
    expect(listened.has('task:ready-tasks-changed')).toBe(true);
    // Bare `on()` import call site (active-streams-tracker.ts).
    expect(listened.has('agent:status-changed')).toBe(true);
    // Template-literal dynamic family (CliBlock.svelte).
    expect(listenedPrefixes.has('terminal:professional:exit:')).toBe(true);
    // Emit sites: seeder literal + template family + daemon-events-bridge relay.
    expect(emitted.has('terminal:created')).toBe(true);
    expect(emitted.has('git:status-changed')).toBe(true);
    expect(emittedPrefixes.has('terminal:professional:exit:')).toBe(true);
  });

  it('resolves every listener channel argument (no unaudited dynamic listeners)', () => {
    expect(
      dynamicListenerSites,
      'Listener call sites with runtime channel arguments escape this audit — rewrite them ' +
        'as statically-resolvable literals/templates or extend the scanner.',
    ).toEqual([]);
  });

  it('every listened channel has a production emitter or a justified allowlist entry', () => {
    const uncovered = [...listened.keys()]
      .filter(
        (channel) =>
          !isEmittedMockIpcEventChannel(channel) && !UNEMITTED_LISTENER_ALLOWLIST.has(channel),
      )
      .sort()
      .map((channel) => `${channel}\n    ${listened.get(channel)!.join('\n    ')}`);
    expect(
      uncovered,
      'New listener call sites reference event channels NO production emitter delivers — the ' +
        'listener never fires (silent-gap class). Wire an emitter (seeder or daemon-events-bridge ' +
        'legacy relay) and declare it in EMITTED_MOCK_IPC_EVENT_CHANNELS, or justify an ' +
        'UNEMITTED_LISTENER_ALLOWLIST entry in src/shared/ipc-mock-router.ts.',
    ).toEqual([]);
  });

  it('every listened dynamic family is covered by a declared emitted prefix', () => {
    const uncovered = [...listenedPrefixes.keys()]
      .filter(
        (prefix) => !EMITTED_MOCK_IPC_EVENT_CHANNEL_PREFIXES.some((p) => prefix.startsWith(p)),
      )
      .sort()
      .map((prefix) => `${prefix}\n    ${listenedPrefixes.get(prefix)!.join('\n    ')}`);
    expect(
      uncovered,
      'Dynamic-family listeners must be covered by EMITTED_MOCK_IPC_EVENT_CHANNEL_PREFIXES.',
    ).toEqual([]);
  });

  it('EMITTED_MOCK_IPC_EVENT_CHANNELS entries are backed by a static emit call site', () => {
    const unbacked = [...EMITTED_MOCK_IPC_EVENT_CHANNELS].filter(
      (channel) => !emitted.has(channel),
    );
    expect(
      unbacked,
      'Declared emitted channels with no emitMockIpcEvent call site overstate the emitter ' +
        'surface — remove the entry or wire the emitter.',
    ).toEqual([]);
    const unbackedPrefixes = EMITTED_MOCK_IPC_EVENT_CHANNEL_PREFIXES.filter(
      (declared) => ![...emittedPrefixes.keys()].some((p) => p.startsWith(declared)),
    );
    expect(unbackedPrefixes, 'Declared emitted prefixes must match an emit template site').toEqual(
      [],
    );
  });

  it('every static emit call site is declared (new emitters must register)', () => {
    const undeclared = [...emitted.keys()]
      .filter((channel) => !isEmittedMockIpcEventChannel(channel))
      .sort()
      .map((channel) => `${channel}\n    ${emitted.get(channel)!.join('\n    ')}`);
    expect(
      undeclared,
      'emitMockIpcEvent call sites must declare their channel in ' +
        'EMITTED_MOCK_IPC_EVENT_CHANNELS (ipc-mock-router.ts) so the listener audit stays honest.',
    ).toEqual([]);
    const undeclaredPrefixes = [...emittedPrefixes.keys()].filter(
      (prefix) => !EMITTED_MOCK_IPC_EVENT_CHANNEL_PREFIXES.some((p) => prefix.startsWith(p)),
    );
    expect(
      undeclaredPrefixes,
      'Template emit sites must declare their family in EMITTED_MOCK_IPC_EVENT_CHANNEL_PREFIXES.',
    ).toEqual([]);
  });

  it('UNEMITTED_LISTENER_ALLOWLIST holds no stale entries', () => {
    const nowEmitted = [...UNEMITTED_LISTENER_ALLOWLIST.keys()].filter((channel) =>
      isEmittedMockIpcEventChannel(channel),
    );
    expect(
      nowEmitted,
      'Channels with a production emitter must be removed from UNEMITTED_LISTENER_ALLOWLIST',
    ).toEqual([]);
    const dead = [...UNEMITTED_LISTENER_ALLOWLIST.keys()].filter(
      (channel) => !listened.has(channel),
    );
    expect(
      dead,
      'Channels with no remaining listener call sites must be removed from ' +
        'UNEMITTED_LISTENER_ALLOWLIST',
    ).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Retired channel stay-retired guard (file-tracking / line-attribution /
// file-attribution surface removed in the P3 FE regression cleanup)
//
// The file-tracking service, line-attribution service, and file-attribution
// helpers were removed alongside their handlers, seeder bridges, and preload
// allowlist entries. Only three channels survive: two live event relays
// (`file-tracking:changes-updated`, `line-attribution:updated`) delivered by
// the daemon-events bridge, and one agent-driven event
// (`file-tracking:agent-file-changed`) emitted by workspace-file-tools. Any
// invoke, listener, or mock-bridge that resurrects a retired name would
// silently reintroduce the class we just drained — pin the ban here so a
// regression fails loud in this suite instead of at runtime.
// ───────────────────────────────────────────────────────────────────────────

const RETIRED_IPC_CHANNELS: ReadonlySet<string> = new Set([
  // Retired FILE_TRACKING request channels (E2/E3 removed the service).
  'file-tracking:init',
  'file-tracking:load',
  'file-tracking:load-commits',
  'file-tracking:load-older-commits',
  'file-tracking:sync',
  'file-tracking:clear',
  'file-tracking:get-changes',
  'file-tracking:get-status',
  'file-tracking:get-line-stats',
  'file-tracking:refresh',
  'file-tracking:track-change',
  'file-tracking:stage-changes',
  'file-tracking:unstage-changes',
  'file-tracking:load-transitions',
  // Retired FILE_TRACKING event channel (listener-ready handshake).
  'file-tracking:listener-ready',
  // Retired LINE_ATTRIBUTION request channels (kept: `line-attribution:updated`).
  'line-attribution:load',
  'line-attribution:compute-now',
  // Retired FILE_ATTRIBUTION namespace (agent-write attribution moved off IPC).
  'file-attribution:record-agent-write',
  'file-attribution:read-file-and-record',
  // Retired zero-caller AGENT adapter surface (C1d-1 removed the adapter methods,
  // their AGENT_CHANNELS entries, the preload allowlist entries, and the schema/
  // handler registrations in init-unified-handlers.ts + unified-agent-handlers.ts).
  'agent:activate',
  'agent:lifecycle:start',
  'agent:lifecycle:stop',
  'agent:messaging:send',
  'agent:messaging:receive',
  'agent:update-session',
  'agent:export-session',
  'agent:import-session',
  'agent:get-history',
  'agent:update-metadata',
  'agent:fork-session',
  'agent:merge-sessions',
  'agent:get-stats',
  'agent:validate-session',
  'agent:repair-session',
  'agent:clear',
  'agent:pause',
  'agent:get-status',
  'agent:get-context',
  'agent:update-context',
  'agent:context:update',
  'agent:context:getByWorkspace',
  'agent:context:getBySession',
  'agent:get-capabilities',
  'agent:set-capabilities',
  'agent:get-metrics',
  'agent:reset-metrics',
  'agent:get-logs',
  'agent:clear-logs',
]);

describe('Retired file-tracking / line-attribution / file-attribution channels stay retired', () => {
  const { invoked } = scanInvokedChannels();
  const { listened, emitted } = scanEventChannels();
  const registered = new Set(getRegisteredMockIpcChannels());

  it('none of the retired channels appear in renderer invoke call sites', () => {
    const resurrected = [...RETIRED_IPC_CHANNELS]
      .filter((channel) => invoked.has(channel))
      .map((channel) => `${channel}\n    ${invoked.get(channel)!.join('\n    ')}`);
    expect(
      resurrected,
      'A retired file-tracking/line-attribution/file-attribution channel has a new invoke call ' +
        'site. The service, handlers, and seeder bridge were removed — re-adding the invoke ' +
        'would reject with UnbridgedMockIpcChannelError. Route the request through the daemon ' +
        'seam instead of resurrecting the retired IPC channel.',
    ).toEqual([]);
  });

  it('none of the retired channels appear in renderer listener or emit call sites', () => {
    const resurrectedListeners = [...RETIRED_IPC_CHANNELS]
      .filter((channel) => listened.has(channel))
      .map((channel) => `${channel}\n    ${listened.get(channel)!.join('\n    ')}`);
    expect(
      resurrectedListeners,
      'A retired file-tracking/line-attribution/file-attribution channel has a new listener ' +
        'call site — no production emitter delivers it (silent-gap regression).',
    ).toEqual([]);
    const resurrectedEmitters = [...RETIRED_IPC_CHANNELS]
      .filter((channel) => emitted.has(channel))
      .map((channel) => `${channel}\n    ${emitted.get(channel)!.join('\n    ')}`);
    expect(
      resurrectedEmitters,
      'A retired file-tracking/line-attribution/file-attribution channel has a new mock emit ' +
        'call site — the surface was drained, not re-bridged.',
    ).toEqual([]);
  });

  it('none of the retired channels are registered by any seeder', () => {
    const rebridged = [...RETIRED_IPC_CHANNELS].filter((channel) => registered.has(channel));
    expect(
      rebridged,
      'A retired channel was bridged again by a mock-router seeder — remove the bridge and ' +
        'reroute through the daemon seam.',
    ).toEqual([]);
  });

  it('IPC_CHANNELS registry no longer exposes retired names', () => {
    const flatten = (obj: unknown, out: string[] = []): string[] => {
      if (typeof obj === 'string') out.push(obj);
      else if (obj && typeof obj === 'object')
        for (const value of Object.values(obj as Record<string, unknown>)) flatten(value, out);
      return out;
    };
    const registryValues = new Set(flatten(IPC_CHANNELS));
    const leaked = [...RETIRED_IPC_CHANNELS].filter((channel) => registryValues.has(channel));
    expect(
      leaked,
      'Retired channel constants must not be re-added to IPC_CHANNELS in src/shared/ipc-registry.ts.',
    ).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Workspace MCP server boundary (dynamic invoke(toolName) blind spot)
//
// `src/features/mcp/servers/{workspace,notes,git}` are the workspace-MCP
// server sources; their dynamic `this.bridge.invoke(toolName, …)` calls
// dispatch through the main-side McpBridge (features/mcp/main/bridge/
// mcp-bridge.ts) IN-PROCESS — they are NOT renderer→main electron IPC, so
// the invoke scan above rightly resolves none of them and they need no
// mock-router bridge or allowlist entry.
// ───────────────────────────────────────────────────────────────────────────

describe('Workspace MCP server sources stay off the renderer IPC surface', () => {
  it('features/mcp/servers/** never import the renderer invoke seam', () => {
    // If one of these files ever imported the renderer invoke seam, its
    // dynamic `invoke(toolName)` dispatch would enter the mock router with
    // runtime-only channel names — invisible to this audit and rejecting at
    // runtime. Keep the boundary structural.
    const serversRoot = path.join(SRC_ROOT, 'features', 'mcp', 'servers');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const absolute = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(absolute);
        } else if (/\.ts$/.test(entry.name)) {
          const source = fs.readFileSync(absolute, 'utf8');
          if (
            /from\s+['"](?:\$shared\/generated\/ipc-client|\$lib\/electron-bridge)['"]/.test(source)
          ) {
            offenders.push(path.relative(SRC_ROOT, absolute));
          }
        }
      }
    };
    walk(serversRoot);
    expect(
      offenders,
      'Workspace MCP server processes must keep dispatching tools through the main-side ' +
        'McpBridge — importing the renderer invoke seam would route dynamic toolName channels ' +
        'through the mock router unaudited.',
    ).toEqual([]);
  });
});
