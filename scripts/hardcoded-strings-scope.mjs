// Full migration inventory. Existing debt is recorded in the checked-in
// baseline; every path remains scanned so new or changed violations fail.
export const ENFORCED_DIRS = [
  'src/lib/components',
  'src/lib/constants',
  'src/lib/data',
  'src/hooks.client.ts',
  'src/lib/components/settings',
  'src/features/settings',
  'src/routes/(app)/settings',
  'src/lib/components/ui',
  'src/lib/components/workspace',
  'src/lib/components/chat',
  'src/lib/components/layout',
  'src/features/layout',
  'src/routes/(app)/workspace',
  'src/routes/(app)/agent',
  'src/routes/hud',
  'src/lib/components/tiptap',
  'src/routes/(app)/+layout.svelte',
  'src/routes/+layout.svelte',
  'src/routes/(app)/+error.svelte',
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
  'src/features/file-tracking',
  'src/lib/components/code-review',
  'src/lib/components/agent-overview',
  'src/lib/components/diagrams',
  'src/lib/components/code-walkthrough',
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
  // user-facing main-process files. testing/ (harness) and agent-launch-core
  // (prompt building) are intentionally not enforced.
  'src/features/agent/browser',
  'src/features/agent/services',
  'src/features/agent/utils',
  'src/features/agent/errors',
  'src/features/agent/config',
  'src/features/agent/agent-context-registry.ts',
  'src/features/agent/agent-context.ipc.ts',
  'src/features/agent/agent-context.ts',
  'src/features/agent/agent-failure-registry.ts',
  'src/features/agent/agent-read-service.ts',
  'src/features/agent/agent-send.ts',
  'src/features/agent/agent-types.ts',
  'src/features/agent/agent.client.ts',
  'src/features/agent/chat-read-service.ts',
  'src/features/agent/interrupted-agents-service.ts',
  'src/features/agent/main/agent-missing.ipc.ts',
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
  'src/features/antigravity',
  // remaining feature dirs (final flip). agent/testing, agent/agent-launch-core,
  // acp-official main/server + parsers/plans, and cortex/cortex-acp emit
  // agent-facing prompt/wire content — intentionally not enforced.
  'src/features/accept-changes',
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
  'src/features/protocol',
  'src/features/rules',
  'src/features/scripts',
  'src/features/setup-scripts',
  'src/features/specialists',
  'src/features/system',
  'src/features/tasks',
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

export const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  '.svelte-kit',
  '.git',
  '__tests__',
  '__mocks__',
]);

// Developer-facing scaffolding excluded from the gate (intent-hq/monorepo#2248):
// component-catalog visual harnesses (*Harness.svelte), component-test harnesses
// (*.test-harness.svelte), catalog fixtures (*.fixtures.ts), preview definitions
// (*.preview.ts / *.preview.svelte / *.preview-fixtures.ts), catalog metadata
// (*.meta.ts), and playwright configs (*.playwright.config.ts). These files are
// demo/test scaffolding, not product UI; strings surfacing in the in-app component
// catalog (a developer tool) are accepted.
export const SCAFFOLDING_FILE_RE =
  /(?:Harness\.svelte|\.test-harness\.svelte|\.fixtures\.ts|\.preview\.(?:svelte|ts)|\.preview-fixtures\.ts|\.meta\.ts|\.playwright\.config\.ts)$/;

export function isCheckedFile(absPath) {
  const norm = absPath.split('\\').join('/');
  if (norm.endsWith('.d.ts')) return false;
  if (/\.(test|spec)\.(ts|js|mjs|cjs)$/.test(norm)) return false;
  if (SCAFFOLDING_FILE_RE.test(norm)) {
    return false;
  }
  if (!/\.(svelte|ts)$/.test(norm)) return false;
  return true;
}

// Repo-relative membership in the default inventory, including walk exclusions.
// Explicit scanner CLI paths may intentionally live outside this inventory.
export function isEnforcedFile(file) {
  const norm = file.split('\\').join('/');
  if (!isCheckedFile(norm)) return false;
  return ENFORCED_DIRS.some(
    (entry) =>
      norm === entry ||
      (norm.startsWith(`${entry}/`) &&
        !norm
          .slice(entry.length + 1)
          .split('/')
          .slice(0, -1)
          .some((directory) => SKIP_DIRS.has(directory))),
  );
}
