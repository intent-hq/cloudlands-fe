// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = process.cwd();
const settingsRoot = join(repositoryRoot, 'src/lib/components/settings');

const expectedCallers = {
  'src/lib/components/settings/AgentBackendSettings.svelte': 1,
  'src/lib/components/settings/AgentFeaturesSettings.svelte': 1,
  'src/lib/components/settings/BackendSyncSettings.svelte': 1,
  'src/lib/components/settings/GitWorkspaceSettings.svelte': 3,
  'src/lib/components/settings/HardwareConsoleSettings.svelte': 2,
  'src/lib/components/settings/LegacyImportSettings.svelte': 1,
  'src/lib/components/settings/ListenTargetSelector.svelte': 1,
  'src/lib/components/settings/McpServersSettings.svelte': 1,
  'src/lib/components/settings/NotificationSettings.svelte': 3,
  'src/lib/components/settings/OpenInAppsSettings.svelte': 1,
  'src/lib/components/settings/RtkSettings.svelte': 1,
  'src/lib/components/settings/WebSocketApiSettings.svelte': 2,
  'src/lib/components/settings/WorkspaceApiSettings.svelte': 1,
  'src/lib/components/settings/mcp/McpServerCard.svelte': 1,
} as const;

function svelteFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return svelteFiles(path);
    return entry.name.endsWith('.svelte') ? [path] : [];
  });
}

function repositoryPath(path: string): string {
  return relative(repositoryRoot, path).split(sep).join('/');
}

describe('settings Toggle layout', () => {
  it('keeps all 20 settings controls compact, textless, and accessibly named', () => {
    const callers = new Map<string, number>();

    for (const file of svelteFiles(settingsRoot)) {
      const source = readFileSync(file, 'utf8');
      const tags = [...source.matchAll(/<Toggle\b[\s\S]*?\/>/g)].map((match) => match[0]);
      if (tags.length === 0) continue;

      callers.set(repositoryPath(file), tags.length);
      for (const tag of tags) {
        expect(tag).toContain('size="xs"');
        expect(tag).toMatch(/\bariaLabel=/);
        expect(tag).not.toMatch(/\b(?:variant|onLabel|offLabel)=/);
      }
    }

    expect(
      Object.fromEntries([...callers].sort(([left], [right]) => left.localeCompare(right))),
    ).toEqual(expectedCallers);
    expect([...callers.values()].reduce((total, count) => total + count, 0)).toBe(20);
  });
});
