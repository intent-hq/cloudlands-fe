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
import { getRegisteredMockIpcChannels, UNBRIDGED_INVOKE_ALLOWLIST } from '$shared/ipc-mock-router';
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
    expect(invoked.size).toBeGreaterThan(200);
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
 * with NO mock-router bridge. Every invoke of these channels currently rejects
 * with UnbridgedMockIpcChannelError. Frozen debt — entries may only be REMOVED
 * (when bridged to the daemon or retired with their call sites in P3-1.5);
 * never add to this list for new work.
 */
const KNOWN_UNBRIDGED_CHANNELS: ReadonlySet<string> = new Set([
  'accept-changes:check-path-has-changes',
  'agent:activate',
  'agent:backend:list',
  'agent:delete-session',
  'agent:lifecycle:start',
  'agent:lifecycle:stop',
  'agent:messaging:receive',
  'agent:messaging:send',
  'agent:persistence:list',
  'analytics:get-config',
  'archive_workspace',
  // Surfaced by the alias-aware scan: invokeIpc site in auto-update.client.ts.
  'auto-update:install',
  'banner:fetch',
  // Surfaced by the alias-aware scan: ipcInvoke site in PanelLayout.svelte.
  'browser:list-tabs-response',
  'browser:register-tab',
  'changes:get-current',
  'changes:mark-agent-active',
  'changes:track-agent',
  'create_workspace',
  'debug:trigger-backend-resume',
  'delete_workspace',
  'dialog:message',
  'dialog:open',
  'dialog:save',
  'diffs:list',
  'diffs:update',
  'external-editors:open-with-other',
  'file:copy',
  'file:delete',
  'file:exists',
  'file:getTreeWithSizes',
  'file:move',
  'file:open',
  'file:read',
  'file:save',
  'file:write',
  'get_current_workspace',
  'get_workspace',
  // 4C-3/D2 moved the git reads onto backendRequest('git.*') (PROTOCOL §5.6);
  // IPC batch 5 dispositioned the remaining git:* debt: push/fetch/hunk
  // staging, numstat, and the branch-base git:diff are bridged through the
  // daemon host.exec (git-bridge-seeder), git:isRepository rides
  // host.directoryStatus, the git-tracking PR/remote lookups and the
  // github-auth OAuth triggers ride github.* / host.exec
  // (integrations-bridge-seeder / git-bridge-seeder), and
  // git:get-auto-commit-status is allowlisted (no daemon status read).
  // git:removeLock / git:rename-branch / git:getRemotes were retired with
  // their caller-less client methods.
  'line-attribution:load',
  'list_workspaces',
  'mcp:call-tool',
  'mcp:create-server',
  'mcp:list-tools',
  'mcp:remove-server',
  'mcp:transition-workspace',
  // Surfaced by the alias-aware scan: invokeIpc sites in panel-layout-history.client.ts.
  'panel-layout:load',
  'panel-layout:save',
  'patch:apply',
  'patch:revert',
  'persistence:delete',
  'persistence:load',
  'persistence:load-agent-config',
  'persistence:load-session',
  'persistence:save',
  'persistence:save-session',
  'reference:resolve',
  'remote-fs:exists',
  // IPC batch 5: scripts:update moved onto the script.create scriptId upsert
  // (§5.8), scripts:get-output was retired with its caller-less client method,
  // and scripts:detect / scripts:save-to-repo are allowlisted shaped failures
  // (no daemon scanner / repo-config surface).
  'sentry-auth:get-issue',
  'sentry-auth:logout',
  'sentry-auth:save-config',
  'set_current_workspace',
  'shell:install-cli',
  'shell:openExternal',
  'shell:showItemInFolder',
  'ssh:connect',
  'ssh:detectEnvironment',
  'ssh:disconnect',
  'ssh:downloadFile',
  'ssh:execute',
  'ssh:get-agent-status',
  'ssh:get-config-hosts',
  'ssh:isConnected',
  'ssh:list-keys',
  'ssh:listDirectory',
  'ssh:test-connection',
  'ssh:uploadFile',
  'system:execute-command',
  'system:home-directory',
  'system:write-clipboard',
  'update_workspace',
  'user-mcp:initiate-oauth',
  'vscode:openFile',
  'window:open-new',
  'workspace:add-recent-repository',
  'workspace:cleanup',
  'workspace:clear-recent-repositories',
  'workspace:close',
  'workspace:discover-repos',
  'workspace:duplicate',
  'workspace:find-repositories',
  'workspace:get',
  'workspace:get-info',
  'workspace:openFile',
  'workspace:openLog',
  'workspace:openMetric',
  'workspace:openNote',
  'workspace:openSpec',
  'workspace:openSymbol',
  'workspace:openTest',
  'workspace:openTimelineEvent',
  'workspace:preflight-clone-check',
  'workspace:rename-branch',
]);
