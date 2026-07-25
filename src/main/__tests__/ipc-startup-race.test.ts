/**
 * IPC Startup Race Condition Regression Guard
 *
 * This test verifies that no race condition exists in the main process startup
 * sequence. The renderer process calls certain IPC channels immediately on
 * startup (via init sagas and component mounts), so those channels must be
 * registered in the critical IPC section of `src/main/index.ts` — NOT in the
 * deferred `setImmediate` callback (secondary IPC block).
 *
 * Previously, some renderer-startup channels were registered in the secondary
 * block, causing "No handler registered for channel" errors because
 * `setImmediate` defers execution until after the current event loop tick.
 * That bug has been fixed; this test ensures it is never reintroduced.
 *
 * HOW THIS TEST WORKS:
 * 1. Reads `src/main/index.ts` and identifies which setup functions are in
 *    the critical section vs the secondary (setImmediate) section.
 * 2. For each secondary setup function, finds the corresponding `.ipc.ts`
 *    file and extracts the IPC channel names it registers.
 * 3. Compares those channels against a known list of channels the renderer
 *    calls on startup.
 * 4. Asserts that NONE of the renderer-startup channels are in the secondary
 *    group. If this assertion fails, a race condition has been reintroduced.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const SRC_ROOT = path.resolve(__dirname, '..', '..');

/**
 * Channels the renderer invokes during startup (init sagas, layout mounts,
 * store initialization). Gathered by auditing:
 * - src/store/renderer/slices/specialists/sagas/init-saga.ts
 * - src/store/renderer/slices/auto-update/sagas/auto-update-saga.ts
 * - src/store/renderer/slices/workspace-settings/sagas/init-saga.ts
 */
const RENDERER_STARTUP_CHANNELS = [
  // Specialists init saga — called immediately on store init
  'specialists:list-bundled',
  'specialists:list-files',
  'specialists:get-folder-path',

  // Auto-update — get-state called during +layout.svelte init
  'auto-update:get-state',
];

describe('IPC Startup Race Condition', () => {
  it('starts the sidecar before requesting its host environment', () => {
    const indexPath = path.join(SRC_ROOT, 'main', 'index.ts');
    const source = fs.readFileSync(indexPath, 'utf-8');
    const sidecarStart = source.indexOf('await startIntentdSidecar(');
    const hostEnvSeed = source.indexOf('await seedPathFromHostEnv();');

    expect(sidecarStart).toBeGreaterThan(-1);
    expect(hostEnvSeed).toBeGreaterThan(sidecarStart);
  });

  it('should identify setup functions in critical vs secondary sections', () => {
    const indexPath = path.join(SRC_ROOT, 'main', 'index.ts');
    const source = fs.readFileSync(indexPath, 'utf-8');

    // Find the critical section: between startupMetrics.start('criticalIPC')
    // and startupMetrics.end('criticalIPC')
    const criticalStart = source.indexOf("startupMetrics.start('criticalIPC')");
    const criticalEnd = source.indexOf("startupMetrics.end('criticalIPC')");
    expect(criticalStart).toBeGreaterThan(-1);
    expect(criticalEnd).toBeGreaterThan(criticalStart);

    const criticalSection = source.slice(criticalStart, criticalEnd);

    // Find the secondary section: inside setImmediate(async () => { ... })
    // after the criticalIPC end marker
    const afterCritical = source.slice(criticalEnd);
    const setImmediateIdx = afterCritical.indexOf('setImmediate(async');
    expect(setImmediateIdx).toBeGreaterThan(-1);

    // The secondary section runs from setImmediate to the end of its callback
    const secondarySection = afterCritical.slice(setImmediateIdx);

    // Extract setup function calls (setupXxxIPC, registerXxxHandlers patterns)
    const setupCallRegex = /\b(setup\w+IPC|register\w+Handlers)\b/g;

    const criticalFunctions = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = setupCallRegex.exec(criticalSection)) !== null) {
      criticalFunctions.add(match[1]);
    }

    const secondaryFunctions = new Set<string>();
    // Reset regex
    setupCallRegex.lastIndex = 0;
    while ((match = setupCallRegex.exec(secondarySection)) !== null) {
      // Skip commented-out calls (lines starting with //)
      const lineStart = secondarySection.lastIndexOf('\n', match.index) + 1;
      const linePrefix = secondarySection.slice(lineStart, match.index).trim();
      if (linePrefix.startsWith('//')) continue;
      secondaryFunctions.add(match[1]);
    }

    expect(criticalFunctions.size).toBeGreaterThan(0);
    expect(secondaryFunctions.size).toBeGreaterThan(0);

    // Verify known critical functions (moved from secondary to fix race conditions)
    expect(criticalFunctions.has('setupSpecialistsIPC')).toBe(true);
    expect(criticalFunctions.has('setupAutoUpdateIPC')).toBe(true);
  });

  it('should find IPC channels registered by secondary setup functions', () => {
    // Map of secondary setup function -> file that contains it -> channels registered
    const secondaryChannelMap: Record<string, string[]> = {};

    // Find .ipc.ts files and extract channels for known secondary functions
    const ipcFiles = findIPCFiles(SRC_ROOT);

    for (const filePath of ipcFiles) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const channels = extractRegisteredChannels(content);
      if (channels.length > 0) {
        const relativePath = path.relative(SRC_ROOT, filePath);
        secondaryChannelMap[relativePath] = channels;
      }
    }

    // We should find channels in the specialists IPC file
    const specialistsFile = Object.keys(secondaryChannelMap).find((f) =>
      f.includes('specialists.ipc.ts'),
    );
    expect(specialistsFile).toBeDefined();
    expect(secondaryChannelMap[specialistsFile!]).toContain('specialists:list-bundled');
  });

  it('no renderer-startup channels should be in the secondary IPC group', () => {
    const indexPath = path.join(SRC_ROOT, 'main', 'index.ts');
    const source = fs.readFileSync(indexPath, 'utf-8');

    // Extract secondary section
    const criticalEnd = source.indexOf("startupMetrics.end('criticalIPC')");
    expect(criticalEnd, 'Could not find criticalIPC end marker in index.ts').toBeGreaterThan(-1);
    const afterCritical = source.slice(criticalEnd);
    const setImmediateIdx = afterCritical.indexOf('setImmediate(async');
    expect(
      setImmediateIdx,
      'Could not find setImmediate block after critical section in index.ts',
    ).toBeGreaterThan(-1);
    const secondarySection = afterCritical.slice(setImmediateIdx);

    // Get all active (non-commented) setup function names in secondary
    const setupCallRegex = /\b(setup\w+IPC|register\w+Handlers)\b/g;
    const secondaryFunctions = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = setupCallRegex.exec(secondarySection)) !== null) {
      const lineStart = secondarySection.lastIndexOf('\n', match.index) + 1;
      const linePrefix = secondarySection.slice(lineStart, match.index).trim();
      if (linePrefix.startsWith('//')) continue;
      secondaryFunctions.add(match[1]);
    }

    // For each secondary function, find its IPC file and extract channels
    const secondaryChannels = new Set<string>();
    const ipcFiles = findIPCFiles(SRC_ROOT);

    for (const filePath of ipcFiles) {
      const content = fs.readFileSync(filePath, 'utf-8');

      // Check if this file exports any of the secondary functions
      // Use regex with word boundary to avoid matching prefixes of longer identifiers
      const exportsSecondaryFn = [...secondaryFunctions].some((fn) => {
        const pattern = new RegExp(
          `export\\s+(?:async\\s+)?(?:function|const)\\s+${fn}\\b|export\\s*\\{[^}]*\\b${fn}\\b`,
        );
        return pattern.test(content);
      });

      if (exportsSecondaryFn) {
        const channels = extractRegisteredChannels(content);
        for (const ch of channels) {
          secondaryChannels.add(ch);
        }
      }
    }

    // Find which renderer-startup channels are in the secondary group
    const racingChannels = RENDERER_STARTUP_CHANNELS.filter((ch) => secondaryChannels.has(ch));

    // If this fails, renderer-startup channels have been placed in the secondary
    // IPC block, reintroducing the race condition.
    expect(
      racingChannels,
      `RACE CONDITION DETECTED: The following channels are called by the renderer ` +
        `on startup but are only registered in the secondary (setImmediate) IPC block. ` +
        `This means the renderer may call them before they are registered:\n` +
        racingChannels.map((ch) => `  - ${ch}`).join('\n') +
        `\n\nTo fix: move the setup functions that register these channels ` +
        `from the setImmediate block to the critical IPC section.`,
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Recursively find all `.ipc.ts` files under the given root.
 */
function findIPCFiles(root: string): string[] {
  const results: string[] = [];
  const dirsToSearch = ['main', 'features'];

  for (const dir of dirsToSearch) {
    const dirPath = path.join(root, dir);
    if (fs.existsSync(dirPath)) {
      walkDir(dirPath, results);
    }
  }
  return results;
}

function walkDir(dir: string, results: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip node_modules and __tests__
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
      walkDir(fullPath, results);
    } else if (entry.name.endsWith('.ipc.ts')) {
      results.push(fullPath);
    }
  }
}

/**
 * Extract IPC channel names registered via `ipcMain.handle(...)` in a file.
 *
 * Looks for patterns like:
 * - ipcMain.handle('channel-name', ...)
 * - ipcMain.handle(SOME_CHANNELS.CONSTANT, ...)
 * - ipcMain.handle(IPC_CHANNELS.SECTION.KEY, ...)
 *
 * For constant references, resolves them by reading the ipc-registry.
 */
function extractRegisteredChannels(fileContent: string): string[] {
  const channels: string[] = [];

  // Pattern 1: Direct string literals
  const directPattern = /ipcMain\.handle\(\s*['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = directPattern.exec(fileContent)) !== null) {
    channels.push(match[1]);
  }

  // Pattern 2: Channel constant references like SPECIALISTS_CHANNELS.LIST_FILES
  // or IPC_CHANNELS.SPECIALISTS.LIST_FILES
  const constPattern = /ipcMain\.handle\(\s*(\w+(?:\.\w+)+)/g;
  while ((match = constPattern.exec(fileContent)) !== null) {
    const resolved = resolveChannelConstant(match[1]);
    if (resolved) {
      channels.push(resolved);
    }
  }

  return channels;
}

/**
 * Resolve a channel constant reference (e.g., SPECIALISTS_CHANNELS.LIST_FILES)
 * to its string value by reading the IPC registry.
 */
function resolveChannelConstant(ref: string): string | null {
  const registryPath = path.join(SRC_ROOT, 'shared', 'ipc-registry.ts');
  const registryContent = fs.readFileSync(registryPath, 'utf-8');

  // Handle IPC_CHANNELS.SECTION.KEY
  if (ref.startsWith('IPC_CHANNELS.')) {
    const parts = ref.replace('IPC_CHANNELS.', '').split('.');
    return resolveFromRegistry(registryContent, parts);
  }

  // Handle aliased constants like SPECIALISTS_CHANNELS.LIST_FILES
  // These are defined in channels.ts as: export const SPECIALISTS_CHANNELS = IPC_CHANNELS.SPECIALISTS;
  const channelsPath = path.join(SRC_ROOT, 'shared', 'ipc', 'channels.ts');
  if (fs.existsSync(channelsPath)) {
    const channelsContent = fs.readFileSync(channelsPath, 'utf-8');
    const parts = ref.split('.');
    const aliasName = parts[0]; // e.g., SPECIALISTS_CHANNELS
    const key = parts.slice(1); // e.g., ['LIST_FILES']

    // Find: export const SPECIALISTS_CHANNELS = IPC_CHANNELS.SPECIALISTS;
    const aliasPattern = new RegExp(
      `export\\s+const\\s+${aliasName}\\s*=\\s*IPC_CHANNELS\\.(\\w+)`,
    );
    const aliasMatch = aliasPattern.exec(channelsContent);
    if (aliasMatch) {
      const section = aliasMatch[1]; // e.g., SPECIALISTS
      return resolveFromRegistry(registryContent, [section, ...key]);
    }
  }

  // Handle AUTO_UPDATE_CHANNELS.CHECK etc (imported from channels.ts)
  // Try direct lookup: strip _CHANNELS suffix, use as section
  const parts = ref.split('.');
  if (parts[0].endsWith('_CHANNELS')) {
    const section = parts[0].replace('_CHANNELS', '');
    return resolveFromRegistry(registryContent, [section, ...parts.slice(1)]);
  }

  return null;
}

/**
 * Look up a channel value in the IPC registry source by section path.
 * e.g., ['SPECIALISTS', 'LIST_FILES'] -> 'specialists:list-files'
 */
function resolveFromRegistry(registryContent: string, parts: string[]): string | null {
  if (parts.length < 2) return null;

  const section = parts[0]; // e.g., SPECIALISTS
  const key = parts[1]; // e.g., LIST_FILES

  // Find the section in the registry, then find the key's string value
  // Pattern: KEY: 'value',
  const sectionPattern = new RegExp(`${section}:\\s*\\{([^}]+)\\}`, 's');
  const sectionMatch = sectionPattern.exec(registryContent);
  if (!sectionMatch) return null;

  const keyPattern = new RegExp(`${key}:\\s*['"]([^'"]+)['"]`);
  const keyMatch = keyPattern.exec(sectionMatch[1]);
  return keyMatch ? keyMatch[1] : null;
}
