/**
 * IPC channel reconciliation — automated audit of renderer invoke call sites
 * against the channels bridged by the mock-router seeders.
 *
 * The mock IPC router rejects invokes on unregistered channels
 * (`UnbridgedMockIpcChannelError`) instead of resolving undefined. This suite
 * keeps that guarantee auditable: it statically scans every renderer source
 * file for `invoke(...)` / `typedInvoke(...)` call sites — including named
 * import aliases such as `import { invoke as invokeIpc }` — resolves the
 * channel names (string literals, `X_CHANNELS.KEY`, `IPC_CHANNELS.GROUP.KEY`),
 * and reconciles them against the channels the seeders register. Channels only
 * ever invoked through a runtime variable are a scanner limitation and must be
 * recorded in `DYNAMIC_INVOKE_CALL_SITES` below.
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

/**
 * Build the invoke( / typedInvoke( call-head regex for one source file,
 * matching up to (but not consuming) the generic argument list or the opening
 * paren. Import aliases declared in the file (e.g. `import { invoke as
 * invokeIpc }`) are matched as call sites too, so aliased invokes cannot
 * escape the audit.
 */
function buildCallHeadRegex(source: string): RegExp {
  const names = new Set(['typedInvoke', 'invoke']);
  for (const clause of source.matchAll(IMPORT_CLAUSE_RE)) {
    for (const alias of clause[1].matchAll(INVOKE_ALIAS_RE)) names.add(alias[1]);
  }
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
    // git:numstat remains a local-IPC invoke (no daemon arm yet).
    expect(invoked.has('git:numstat')).toBe(true);
    expect(invoked.has('dialog:open')).toBe(true);
    // Aliased import call site (`import { invoke as invokeIpc }`, scripts.client.ts).
    expect(invoked.has('scripts:get-output')).toBe(true);
    // Nested-generic call site (`invokeIpc<AutoUpdateResponse<UpdateState>>`,
    // auto-update.client.ts). A `<[^>]*>` matcher stops at the first `>` and
    // drops such call sites entirely — settings:getAll escaped to a runtime
    // UnbridgedMockIpcChannelError that way. Guards the depth-aware parser.
    expect(invoked.has('auto-update:get-state')).toBe(true);
    expect([...invoked.keys()].some((channel) => registered.has(channel))).toBe(true);
  });

  it('resolves every constant-style channel reference', () => {
    expect(
      unresolved,
      'Constant-style channel references the resolver could not map — extend ' +
        'resolveRegistryChannel() or the regexes in this file so the audit stays exhaustive.',
    ).toEqual([]);
  });

  it('every invoked channel is bridged, allowlisted, or a recorded audit finding', () => {
    const uncovered = [...new Set([...invoked.keys(), ...DYNAMIC_INVOKE_CALL_SITES.keys()])]
      .filter(
        (channel) =>
          !registered.has(channel) &&
          !UNBRIDGED_INVOKE_ALLOWLIST.has(channel) &&
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
    const covered = [...DYNAMIC_INVOKE_CALL_SITES.keys()].filter((channel) =>
      invoked.has(channel),
    );
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
  'app:get-version',
  'archive_workspace',
  'auggie:authenticate',
  'auggie:get-user-info',
  'auggie:install',
  // Surfaced by the alias-aware scan (4A-2 audit debt): invoked only through the
  // provider→channel map in ProviderSelector.svelte (see DYNAMIC_INVOKE_CALL_SITES).
  'auggie:setup-mcp-claude-code',
  'auggie:setup-mcp-codex',
  'auggie:setup-mcp-cortex',
  'auggie:setup-mcp-droid',
  'auggie:setup-mcp-opencode',
  'auggie:setup-mcp-pi',
  // Surfaced by the alias-aware scan: invokeIpc site in auto-update.client.ts.
  'auto-update:install',
  'banner:fetch',
  // Surfaced by the alias-aware scan: ipcInvoke site in PanelLayout.svelte.
  'browser:list-tabs-response',
  'browser:register-tab',
  'changes:get-current',
  'changes:mark-agent-active',
  'changes:track-agent',
  'claude-code:check-availability',
  'codex:check-availability',
  'config:clear-cache',
  'config:get',
  'config:get-stats',
  'config:invalidate',
  // Surfaced by the alias-aware scan: invokeIpc site in acp-official permission-manager.ts.
  'config:set',
  'cortex:check-availability',
  'create_workspace',
  'debug:trigger-backend-resume',
  'delete_workspace',
  'dialog:message',
  'dialog:open',
  'dialog:save',
  'diffs:list',
  'diffs:update',
  'droid:check-availability',
  'external-editors:open-with-other',
  'feature-codes:activate',
  'feature-codes:restart-app',
  'file:copy',
  'file:delete',
  'file:exists',
  'file:getTreeWithSizes',
  'file:move',
  'file:open',
  'file:read',
  'file:save',
  'file:write',
  'first-visit-state:delete',
  'first-visit-state:exists',
  'first-visit-state:load',
  'first-visit-state:save',
  'get_current_workspace',
  'get_workspace',
  'git-tracking:get-pull-request',
  'git-tracking:get-remote-url',
  // 4C-3: git:status/stage/unstage/commit/pull/history/log/file-history were
  // retired here — those reads/mutations now reach the daemon directly via
  // backendRequest('git.*') (PROTOCOL §5.6). D2 retired git:show-file (→
  // git.showFile) and the diff batcher's plain/staged group (→ git.diffs +
  // git.showFile/file.read content composition). git:diff remains only for
  // the branch-base committed diff (baseRef/baseCommitSha) and the
  // walkthrough's staged read; git:numstat still has no daemon arm.
  'git:diff',
  'git:fetch',
  'git:get-auto-commit-status',
  'git:getRemotes',
  'git:isRepository',
  'git:numstat',
  'git:push',
  'git:removeLock',
  'git:rename-branch',
  'git:stage-hunk',
  'git:unstage-hunk',
  'github-auth:cancel',
  'github-auth:logout',
  'github-auth:poll',
  'github-auth:start',
  'line-attribution:load',
  'list_workspaces',
  'mcp:call-tool',
  'mcp:create-server',
  'mcp:list-tools',
  'mcp:remove-server',
  'mcp:transition-workspace',
  'opencode:check-availability',
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
  'pi:install-mcp-adapter',
  'reference:resolve',
  'remote-fs:exists',
  // Surfaced by the alias-aware scan: invokeIpc sites in scripts.client.ts (4A-2 finding).
  'scripts:detect',
  'scripts:get-output',
  'scripts:save-to-repo',
  'scripts:update',
  'sentry-auth:get-issue',
  'sentry-auth:logout',
  'sentry-auth:save-config',
  'set_current_workspace',
  'settings:get',
  'settings:set',
  'settings:update',
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
  'window:set-browser-focused',
  'window:set-in-workspace',
  'window:set-open-workspace-tabs',
  'window:set-title',
  'workspace:add-recent-repository',
  'workspace:cleanup',
  'workspace:clear-recent-repositories',
  'workspace:close',
  'workspace:delete',
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
  // Surfaced by the alias-aware scan: invokeIpc site in workspace.client.ts.
  'workspace:trigger-check',
  'workspace:unarchive',
  'workspace:update-current-context',
  'workspace:update_git_info',
]);
