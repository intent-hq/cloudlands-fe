/**
 * IPC channel reconciliation — automated audit of renderer invoke call sites
 * against the channels bridged by the mock-router seeders.
 *
 * The mock IPC router rejects invokes on unregistered channels
 * (`UnbridgedMockIpcChannelError`) instead of resolving undefined. This suite
 * keeps that guarantee auditable: it statically scans every renderer source
 * file for `invoke(...)` / `typedInvoke(...)` call sites, resolves the channel
 * names (string literals, `X_CHANNELS.KEY`, `IPC_CHANNELS.GROUP.KEY`), and
 * reconciles them against the channels the seeders register.
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

/** invoke( / typedInvoke( call sites, capturing the first argument expression. */
const CALL_SITE_RE = /\b(?:typedInvoke|invoke)\s*(?:<[^>]*>)?\s*\(\s*([^,)\n]+)/g;
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
    for (const match of source.matchAll(CALL_SITE_RE)) {
      const argument = match[1].trim();
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
    expect(invoked.has('git:status')).toBe(true);
    expect(invoked.has('dialog:open')).toBe(true);
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
    const uncovered = [...invoked.keys()]
      .filter(
        (channel) =>
          !registered.has(channel) &&
          !UNBRIDGED_INVOKE_ALLOWLIST.has(channel) &&
          !KNOWN_UNBRIDGED_CHANNELS.has(channel),
      )
      .sort()
      .map((channel) => `${channel}\n    ${invoked.get(channel)!.join('\n    ')}`);
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
    const dead = [...KNOWN_UNBRIDGED_CHANNELS].filter((channel) => !invoked.has(channel));
    expect(
      dead,
      'Channels with no remaining invoke call sites must be removed from KNOWN_UNBRIDGED_CHANNELS',
    ).toEqual([]);
  });
});

/**
 * Audit findings (P3 FE audit): channels invoked by production renderer code
 * with NO mock-router bridge. Every invoke of these channels currently rejects
 * with UnbridgedMockIpcChannelError. Frozen debt — entries may only be REMOVED
 * (when bridged to the daemon or retired with their call sites in P3-1.5);
 * never add to this list for new work.
 */
const KNOWN_UNBRIDGED_CHANNELS: ReadonlySet<string> = new Set([
  'accept-changes:add-remote',
  'accept-changes:check-path-has-changes',
  'accept-changes:execute',
  'accept-changes:export',
  'accept-changes:merge-pr',
  'accept-changes:prepare',
  'agent:activate',
  'agent:backend:list',
  'agent:delete-session',
  'agent:enhance-prompt',
  'agent:generate-layout',
  'agent:lifecycle:start',
  'agent:lifecycle:stop',
  'agent:messaging:receive',
  'agent:messaging:send',
  'agent:persistence:list',
  'analytics:get-config',
  'app:get-version',
  'archive_workspace',
  'assets:save',
  'auggie:authenticate',
  'auggie:check-mcp-claude-code',
  'auggie:check-mcp-codex',
  'auggie:check-mcp-cortex',
  'auggie:check-mcp-droid',
  'auggie:check-mcp-opencode',
  'auggie:check-mcp-pi',
  'auggie:get-user-info',
  'auggie:install',
  'banner:fetch',
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
  'events:query',
  'events:unsubscribe-agent',
  'external-editors:open',
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
  'git-tracking:get-github-branches',
  'git-tracking:get-pull-request',
  'git-tracking:get-remote-url',
  'git:commit',
  'git:diff',
  'git:fetch',
  'git:file-history',
  'git:get-auto-commit-status',
  'git:getBranches',
  'git:getRemotes',
  'git:history',
  'git:isRepository',
  'git:log',
  'git:numstat',
  'git:pull',
  'git:push',
  'git:removeLock',
  'git:rename-branch',
  'git:show-file',
  'git:stage',
  'git:stage-hunk',
  'git:status',
  'git:unstage',
  'git:unstage-hunk',
  'github-auth:cancel',
  'github-auth:logout',
  'github-auth:poll',
  'github-auth:start',
  'jetbrains:open',
  'line-attribution:load',
  'line-changes:calculate-diff',
  'line-changes:clear-agent-stats',
  'line-changes:clear-workspace-stats',
  'line-changes:get-agent-stats',
  'line-changes:get-all-workspace-stats',
  'line-changes:get-workspace-stats',
  'line-changes:update-agent-stats',
  'line-changes:update-workspace-stats',
  'linear-auth:cancel-auth',
  'linear-auth:logout',
  'linear-auth:start-auth',
  'list_workspaces',
  'mcp:call-tool',
  'mcp:create-server',
  'mcp:list-tools',
  'mcp:remove-server',
  'mcp:transition-workspace',
  'opencode:check-availability',
  'patch:apply',
  'patch:revert',
  'persistence:delete',
  'persistence:load',
  'persistence:load-agent-config',
  'persistence:load-session',
  'persistence:save',
  'persistence:save-session',
  'pi:check-mcp-adapter',
  'pi:install-mcp-adapter',
  'pr:create',
  'pr:generateContent',
  'providers:check-single',
  'providers:get-paths',
  'reference:resolve',
  'remote-fs:exists',
  'scripts:save-to-repo',
  'scripts:update',
  'sentry-auth:get-issue',
  'sentry-auth:logout',
  'sentry-auth:save-config',
  'set_current_workspace',
  'settings:get',
  'settings:getAll',
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
  'terminal:createWithCommand',
  'terminal:professional:write',
  'update_workspace',
  'user-mcp:get-settings-file',
  'user-mcp:get-settings-path',
  'user-mcp:initiate-oauth',
  'user-mcp:write-settings-file',
  'vscode:open',
  'vscode:open-git-diff',
  'vscode:openFile',
  'window:open-new',
  'window:set-browser-focused',
  'window:set-in-workspace',
  'window:set-open-workspace-tabs',
  'window:set-title',
  'workspace:add-recent-repository',
  'workspace:archive',
  'workspace:cleanup',
  'workspace:clear-recent-repositories',
  'workspace:close',
  'workspace:create',
  'workspace:delete',
  'workspace:discover-repos',
  'workspace:duplicate',
  'workspace:find-repositories',
  'workspace:get',
  'workspace:get-info',
  'workspace:get-recent-repositories',
  'workspace:get-root',
  'workspace:list',
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
  'workspace:unarchive',
  'workspace:update',
  'workspace:update-current-context',
  'workspace:update_git_info',
  'xcode:open',
]);
