#!/usr/bin/env tsx

/**
 * Verify IPC Handlers
 *
 * This script verifies that all IPC channels have registered handlers.
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Known channel to handler file mapping
const HANDLER_FILES = {
  'workspace:': 'src/features/workspace/main/workspace.ipc.ts',
  'agent:': 'src/features/agent/main/agent.ipc.ts',
  'file:': 'src/features/file/main/file.ipc.ts',
  'git:': 'src/features/git/main/git.ipc.ts',
  'git-tracking:': 'src/features/git-tracking/git-tracking.ipc.ts',
  'file-tracking:': 'src/features/file-tracking/main/file-tracking.ipc.ts',
  'line-changes:': 'src/features/line-changes/line-changes.ipc.ts',
  'settings:': 'src/features/settings/main/settings.ipc.ts',
  'system:': 'src/features/system/main/system.ipc.ts',
  'shell:': 'src/features/system/main/system.ipc.ts',
  'dialog:': 'src/features/system/main/system.ipc.ts',
  'app:': 'src/features/system/main/system.ipc.ts',
  'window:': 'src/features/system/main/system.ipc.ts',
  'events:': 'src/features/events/main/events.ipc.ts',
  'observability:': 'src/features/observability/observability.ipc.ts',
  'terminal:professional:': 'src/features/terminal/main/terminal-professional.ipc.ts',
  'vscode:': 'src/features/ide/main/ide.ipc.ts',
  'jetbrains:': 'src/features/ide/main/ide.ipc.ts',
  'ssh:': 'src/features/ssh/main/ssh.ipc.ts',
  'deep-link:': 'src/features/deeplink/main/deeplink.ipc.ts',
  'universal-agent:': 'src/features/agent/main/agent-missing.ipc.ts',
  'user-rules:': 'src/features/rules/user-rules.ipc.ts',
  'mcp:': 'src/features/mcp/main/mcp.ipc.ts',
  'notes:': 'src/features/notes/main/notes.ipc.ts',
  'note:': 'src/features/notes/main/notes.ipc.ts',
  'config:': 'src/features/agent-config/main/agent-config.ipc.ts',
  'testing:': 'src/features/testing/main/testing.ipc.ts',
  'first-visit-state:': 'src/features/persistence/main/persistence.ipc.ts',
};

// Special channels that need custom handlers
const SPECIAL_CHANNELS = {
  'write_file': 'src/features/deeplink/main/deeplink.ipc.ts',
  'get_workspace_changes': 'src/features/workspace/main/workspace-pr.ipc.ts',
  'generate_pr_content': 'src/features/workspace/main/workspace-pr.ipc.ts',
  'resolve_merge_conflicts': 'src/features/workspace/main/workspace-pr.ipc.ts',
  'test_ssh_connection': 'src/features/ssh/main/ssh.ipc.ts',
  'fs:read': 'src/features/file/main/file.ipc.ts',
  'editor:get-selection': 'src/features/system/main/system.ipc.ts',
};

// Find all channels used in the codebase
function findUsedChannels(): Set<string> {
  const channels = new Set<string>();
  const srcDir = path.join(__dirname, '../src');
  const files = glob.sync('**/*.{ts,svelte}', { cwd: srcDir, absolute: true });

  for (const file of files) {
    if (file.includes('node_modules')) continue;

    const content = fs.readFileSync(file, 'utf-8');

    // Match invoke patterns
    const patterns = [
      /window\.electronAPI\.invoke\(['"`]([^'"`]+)['"`]/g,
      /electronAPI\.invoke\(['"`]([^'"`]+)['"`]/g,
      /invoke\(['"`]([^'"`]+)['"`]/g,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        channels.add(match[1]);
      }
    }
  }

  return channels;
}

// Check if a handler file exists and is registered
function checkHandlerFile(handlerFile: string): boolean {
  const fullPath = path.join(__dirname, '..', handlerFile);

  if (!fs.existsSync(fullPath)) {
    return false;
  }

  // Check if the handler file is imported and registered in main/index.ts
  const mainIndexPath = path.join(__dirname, '../src/main/index.ts');
  const mainContent = fs.readFileSync(mainIndexPath, 'utf-8');

  // Extract the function name from the handler file
  const handlerContent = fs.readFileSync(fullPath, 'utf-8');
  const registerMatch = handlerContent.match(/export\s+function\s+(\w+)\s*\(/);

  if (registerMatch) {
    const functionName = registerMatch[1];
    // Check if this function is called in main/index.ts
    return mainContent.includes(functionName);
  }

  return false;
}

// Main execution
console.log('🔍 Verifying IPC Handlers...\n');

const usedChannels = findUsedChannels();
const unregistered: string[] = [];
const registered: string[] = [];

for (const channel of usedChannels) {
  let handlerFile: string | undefined;

  // Check special channels first
  if (SPECIAL_CHANNELS[channel]) {
    handlerFile = SPECIAL_CHANNELS[channel];
  } else {
    // Find handler file based on channel prefix
    for (const [prefix, file] of Object.entries(HANDLER_FILES)) {
      if (channel.startsWith(prefix)) {
        handlerFile = file;
        break;
      }
    }
  }

  if (handlerFile && checkHandlerFile(handlerFile)) {
    registered.push(channel);
  } else {
    unregistered.push(channel);
  }
}

// Report results
console.log('📊 IPC Handler Verification:\n');
console.log(`Total channels used: ${usedChannels.size}`);
console.log(`Registered handlers: ${registered.length}`);
console.log(`Unregistered channels: ${unregistered.length}`);

if (unregistered.length > 0) {
  console.log('\n❌ Channels without handlers:');
  for (const channel of unregistered.sort()) {
    console.log(`  - ${channel}`);
  }
}

console.log('\n✨ Done!');
