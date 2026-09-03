// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkboxMetadata } from '../checkbox/checkbox.meta';
import { switchMetadata } from '../switch/switch.meta';
import { toggleGroupMetadata } from '../toggle-group/toggle-group.meta';
import { toggleCompatibilityModes, toggleMetadata } from './toggle.meta';

const repositoryRoot = process.cwd();
const sourceRoot = join(repositoryRoot, 'src');
const families = ['checkbox', 'switch', 'toggle', 'toggle-group'] as const;
const modes = ['group', 'switch', 'indicator'] as const;
const structuralAggregatorPaths = new Set([
  'src/lib/components/ui/index.ts',
  'src/lib/components/ui/manifest.ts',
]);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(svelte|ts)$/.test(entry.name) &&
      !/\.(test(?:-harness)?|fixtures|meta)\./.test(entry.name)
      ? [path]
      : [];
  });
}

function repositoryPath(path: string): string {
  return relative(repositoryRoot, path).split(sep).join('/');
}

function resolveImport(caller: string, specifier: string): string | null {
  if (specifier.startsWith('$lib/')) {
    return resolve(repositoryRoot, 'src/lib', specifier.slice('$lib/'.length));
  }
  return specifier.startsWith('.') ? resolve(dirname(caller), specifier) : null;
}

function discoverCallers() {
  const callers = Object.fromEntries(families.map((family) => [family, new Set<string>()]));
  const familyRoots = Object.fromEntries(
    families.map((family) => [family, resolve(sourceRoot, `lib/components/ui/${family}`)]),
  );
  const importPattern =
    /(?:import|export)\s+(?:type\s+)?(?:[^'\"]*?\s+from\s+)?['\"]([^'\"]+)['\"]/g;

  for (const caller of sourceFiles(sourceRoot)) {
    const callerPath = repositoryPath(caller);
    if (structuralAggregatorPaths.has(callerPath)) continue;
    for (const match of readFileSync(caller, 'utf8').matchAll(importPattern)) {
      const target = resolveImport(caller, match[1]);
      if (!target) continue;
      for (const family of families) {
        const root = familyRoots[family];
        if (caller.startsWith(`${root}${sep}`)) continue;
        if (target === root || target.startsWith(`${root}${sep}`)) {
          callers[family].add(callerPath);
        }
      }
    }
  }

  return Object.fromEntries(families.map((family) => [family, [...callers[family]].sort()]));
}

function discoverCompatibilityUsages() {
  const usageCounts = Object.fromEntries(modes.map((mode) => [mode, new Map<string, number>()]));

  for (const caller of sourceFiles(sourceRoot).filter((path) => path.endsWith('.svelte'))) {
    const source = readFileSync(caller, 'utf8');
    for (const tag of source.matchAll(/<Toggle\b[\s\S]*?\/>/g)) {
      const variant = tag[0].match(/\bvariant=['\"](group|switch|indicator)['\"]/);
      if (!variant) continue;
      const mode = variant[1] as (typeof modes)[number];
      const path = repositoryPath(caller);
      usageCounts[mode].set(path, (usageCounts[mode].get(path) ?? 0) + 1);
    }
  }

  return Object.fromEntries(
    modes.map((mode) => [
      mode,
      [...usageCounts[mode]]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([path, count]) => ({ path, count })),
    ]),
  );
}

describe('B2 caller metadata regression', () => {
  it('matches current source-derived callers for every field primitive', () => {
    const expected = {
      checkbox: [
        'src/features/onboarding/OnboardingPage.svelte',
        'src/lib/component-catalog/renderers/BasicCatalogPreview.svelte',
        'src/lib/component-catalog/renderers/ProposalCatalogPreview.svelte',
        'src/lib/components/chat/input/ContextPickerButton.svelte',
        'src/lib/components/chat/proposals/BulkProposalItems.svelte',
        'src/lib/components/layout/ConnectBackendModal.svelte',
        'src/lib/components/modals/TransferWorkspaceModal.svelte',
        'src/lib/components/settings/HardwareConsoleSettings.svelte',
        'src/lib/components/tiptap/TaskItemNodeView.svelte',
        'src/lib/components/workspace/initializer/BranchSelector.svelte',
        'src/lib/components/workspace/initializer/RepoAndBranchPicker.svelte',
      ],
      switch: [
        'src/lib/component-catalog/CatalogControls.svelte',
        'src/lib/component-catalog/ChatPolishGeometryControls.svelte',
        'src/lib/component-catalog/renderers/BasicCatalogPreview.svelte',
        'src/lib/components/debug/DebugPanel.svelte',
        'src/lib/components/settings/AgentBackendSettings.svelte',
        'src/lib/components/settings/BackendSyncSettings.svelte',
        'src/lib/components/settings/OpenInAppsSettings.svelte',
        'src/lib/components/settings/mcp/McpServerCard.svelte',
        'src/lib/components/workspace/sidebar/McpServersSection.svelte',
        'src/lib/components/workspace/sidebar/MergePanel.svelte',
        'src/routes/(app)/settings/+page.svelte',
      ],
      toggle: [
        'src/lib/component-catalog/renderers/BasicCatalogPreview.svelte',
        'src/lib/components/settings/AgentFeaturesSettings.svelte',
        'src/lib/components/settings/GitWorkspaceSettings.svelte',
        'src/lib/components/settings/HardwareConsoleSettings.svelte',
        'src/lib/components/settings/LegacyImportSettings.svelte',
        'src/lib/components/settings/McpServersSettings.svelte',
        'src/lib/components/settings/NotificationSettings.svelte',
        'src/lib/components/settings/RtkSettings.svelte',
        'src/lib/components/settings/WebSocketApiSettings.svelte',
        'src/lib/components/settings/WorkspaceApiSettings.svelte',
        'src/lib/components/workspace/sidebar/FileChangesSection.svelte',
        'src/routes/(app)/settings/+page.svelte',
      ],
      'toggle-group': [
        'src/features/layout/tab-types/AgentViewSettingsDropdown.svelte',
        'src/features/layout/tab-types/NoteViewSettingsDropdown.svelte',
        'src/lib/component-catalog/CatalogControls.svelte',
        'src/lib/component-catalog/renderers/BasicCatalogPreview.svelte',
        'src/lib/components/settings/ColorThemeSettings.svelte',
      ],
    };

    const discovered = discoverCallers();
    expect(discovered).toEqual(expected);
    for (const aggregator of structuralAggregatorPaths) {
      expect(Object.values(discovered).flat()).not.toContain(aggregator);
    }
    expect({
      checkbox: checkboxMetadata.callers,
      switch: switchMetadata.callers,
      toggle: toggleMetadata.callers,
      'toggle-group': toggleGroupMetadata.callers,
    }).toEqual(expected);
  });

  it('keeps compatibility usage counts, replacements, and removal gates verifiable', () => {
    const usages = discoverCompatibilityUsages();
    const expectedUsages = {
      group: [
        { path: 'src/lib/component-catalog/renderers/BasicCatalogPreview.svelte', count: 1 },
        { path: 'src/routes/(app)/settings/+page.svelte', count: 3 },
      ],
      switch: [
        { path: 'src/lib/component-catalog/renderers/BasicCatalogPreview.svelte', count: 1 },
        { path: 'src/lib/components/workspace/sidebar/FileChangesSection.svelte', count: 1 },
      ],
      indicator: [
        { path: 'src/lib/component-catalog/renderers/BasicCatalogPreview.svelte', count: 1 },
        { path: 'src/lib/components/settings/AgentFeaturesSettings.svelte', count: 1 },
        { path: 'src/lib/components/settings/GitWorkspaceSettings.svelte', count: 2 },
        { path: 'src/lib/components/settings/HardwareConsoleSettings.svelte', count: 1 },
        { path: 'src/lib/components/settings/LegacyImportSettings.svelte', count: 1 },
        { path: 'src/lib/components/settings/McpServersSettings.svelte', count: 1 },
        { path: 'src/lib/components/settings/NotificationSettings.svelte', count: 3 },
        { path: 'src/lib/components/settings/RtkSettings.svelte', count: 1 },
        { path: 'src/lib/components/settings/WebSocketApiSettings.svelte', count: 2 },
        { path: 'src/lib/components/settings/WorkspaceApiSettings.svelte', count: 1 },
      ],
    };
    const replacements = {
      group: '$lib/components/ui/toggle-group',
      switch: '$lib/components/ui/switch',
      indicator: '$lib/components/ui/switch',
    };

    expect(usages).toEqual(expectedUsages);
    for (const mode of modes) {
      const ledger = toggleCompatibilityModes[mode];
      expect(ledger.callers).toEqual(usages[mode]);
      expect(ledger.staticUsageCount).toBe(
        usages[mode].reduce((total, usage) => total + usage.count, 0),
      );
      expect(ledger.dynamicUsageCount).toBe(0);
      expect(ledger.replacement).toBe(replacements[mode]);
      expect(ledger.removalGate).toBe(
        `Remove only when source-derived static and dynamic variant="${mode}" usage counts both reach zero.`,
      );
    }
  });
});
