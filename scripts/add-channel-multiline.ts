#!/usr/bin/env tsx

/**
 * Add channel names to multi-line IPC handlers
 */

import * as fs from 'fs';
import * as path from 'path';

interface HandlerFix {
  file: string;
  startLine: number;
  channel: string;
}

const handlers: HandlerFix[] = [
  // system.ipc.ts
  { file: 'src/features/system/main/system.ipc.ts', startLine: 60, channel: 'APP_CHANNELS.VERSION' },
  { file: 'src/features/system/main/system.ipc.ts', startLine: 69, channel: 'APP_CHANNELS.GET_VERSION' },
  { file: 'src/features/system/main/system.ipc.ts', startLine: 74, channel: 'APP_CHANNELS.NAME' },
  { file: 'src/features/system/main/system.ipc.ts', startLine: 83, channel: 'APP_CHANNELS.GET_MEMORY_USAGE' },
  { file: 'src/features/system/main/system.ipc.ts', startLine: 111, channel: 'APP_CHANNELS.ROOT' },
  { file: 'src/features/system/main/system.ipc.ts', startLine: 138, channel: 'WINDOW_CHANNELS.MINIMIZE' },
  { file: 'src/features/system/main/system.ipc.ts', startLine: 149, channel: 'WINDOW_CHANNELS.MAXIMIZE' },
  { file: 'src/features/system/main/system.ipc.ts', startLine: 164, channel: 'WINDOW_CHANNELS.CLOSE' },
  { file: 'src/features/system/main/system.ipc.ts', startLine: 889, channel: 'SETTINGS_CHANNELS.GET_ALL' },
  { file: 'src/features/system/main/system.ipc.ts', startLine: 910, channel: 'SYSTEM_CHANNELS.HOME_DIRECTORY' },
  { file: 'src/features/system/main/system.ipc.ts', startLine: 919, channel: 'SYSTEM_CHANNELS.WORKSPACE_ROOT' },
  { file: 'src/features/system/main/system.ipc.ts', startLine: 932, channel: 'LEGACY_CHANNELS.GET_HOME_DIRECTORY' },

  // Other files
  { file: 'src/features/testing/testing.ipc.ts', startLine: 66, channel: 'TESTING_CHANNELS.GET_PROCESSES' },
  { file: 'src/features/rules/user-rules.ipc.ts', startLine: 35, channel: 'USER_RULES_CHANNELS.GET_ALL' },
  { file: 'src/features/rules/user-rules.ipc.ts', startLine: 49, channel: 'USER_RULES_CHANNELS.GET_FORMATTED' },
  { file: 'src/features/rules/user-rules.ipc.ts', startLine: 99, channel: 'USER_RULES_CHANNELS.EXPORT' },
  { file: 'src/features/mcp/mcp.ipc.ts', startLine: 286, channel: 'MCP_CHANNELS.GET_STATUS' },
  { file: 'src/features/git-tracking/git-tracking.ipc.ts', startLine: 154, channel: 'GIT_TRACKING_CHANNELS.IS_GITHUB_AUTHENTICATED' },
  { file: 'src/features/workspace/main/workspace.ipc.ts', startLine: 311, channel: 'WORKSPACE_CHANNELS.LIST' },
  { file: 'src/features/workspace/main/workspace.ipc.ts', startLine: 809, channel: 'WORKSPACE_CHANNELS.GET_RECENT' },
  { file: 'src/features/workspace/main/workspace.ipc.ts', startLine: 818, channel: 'WORKSPACE_CHANNELS.CLEAR_RECENT' },
  { file: 'src/features/workspace/main/workspace.ipc.ts', startLine: 896, channel: 'WORKSPACE_CHANNELS.GET_RECENT_REPOSITORIES' },
  { file: 'src/features/workspace/main/workspace.ipc.ts', startLine: 916, channel: 'WORKSPACE_CHANNELS.CLEAR_RECENT_REPOSITORIES' },
  { file: 'src/features/workspace/main/workspace.ipc.ts', startLine: 976, channel: 'EDITOR_CHANNELS.GET_SELECTION' },
  { file: 'src/features/events/main/events.ipc.ts', startLine: 165, channel: 'EVENTS_CHANNELS.GET_STATISTICS' },
  { file: 'src/features/config/main/config.ipc.ts', startLine: 144, channel: 'CONFIG_CHANNELS.GET_ALL' },
  { file: 'src/features/agent/main/config.ipc.ts', startLine: 62, channel: 'CONFIG_CHANNELS.GET_ALL_MODELS' },
  { file: 'src/features/agent/main/config.ipc.ts', startLine: 81, channel: 'CONFIG_CHANNELS.CLEAR_CACHE' },
];

function fixHandler(filePath: string, startLine: number, channel: string) {
  const fullPath = path.join(process.cwd(), filePath);
  const content = fs.readFileSync(fullPath, 'utf-8');
  const lines = content.split('\n');

  // Find the closing of createSafeValidatedHandler
  let depth = 0;
  let foundStart = false;
  let endLine = -1;

  for (let i = startLine - 1; i < Math.min(startLine + 20, lines.length); i++) {
    const line = lines[i];

    if (line.includes('createSafeValidatedHandler') || line.includes('createValidatedHandler')) {
      foundStart = true;
    }

    if (foundStart) {
      // Count parentheses
      for (const char of line) {
        if (char === '(') depth++;
        if (char === ')') depth--;
      }

      // Check if we've closed the handler
      if (depth === 0 && line.includes('))')) {
        endLine = i;
        break;
      }
    }
  }

  if (endLine === -1) {
    console.warn(`Could not find end of handler at ${filePath}:${startLine}`);
    return false;
  }

  // Check if already has channel parameter
  if (lines[endLine].includes(`, ${channel})`)) {
    console.log(`Already fixed: ${filePath}:${startLine}`);
    return true;
  }

  // Add channel as third parameter on the closing line
  lines[endLine] = lines[endLine].replace(/\)\)([,;]?)$/, `, ${channel}))$1`);

  fs.writeFileSync(fullPath, lines.join('\n'));
  console.log(`Fixed: ${filePath}:${startLine} - Added ${channel}`);
  return true;
}

// Main
console.log('Adding channel names to multi-line IPC handlers...\n');

// Group by file
const byFile = new Map<string, HandlerFix[]>();
for (const handler of handlers) {
  if (!byFile.has(handler.file)) {
    byFile.set(handler.file, []);
  }
  byFile.get(handler.file)!.push(handler);
}

// Process each file
for (const [file, fixes] of byFile) {
  // Sort by line number in reverse to avoid line shifts
  fixes.sort((a, b) => b.startLine - a.startLine);

  for (const fix of fixes) {
    try {
      fixHandler(fix.file, fix.startLine, fix.channel);
    } catch (error) {
      console.error(`Error fixing ${fix.file}:${fix.startLine}:`, error);
    }
  }
}

console.log('\n✅ Done!');
