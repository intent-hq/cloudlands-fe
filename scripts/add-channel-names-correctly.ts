#!/usr/bin/env tsx

/**
 * Add channel names as third parameter to createSafeValidatedHandler and createValidatedHandler
 * This fixes the IPC debug tracking to show actual channel names instead of "unknown"
 */

import * as fs from 'fs';
import * as path from 'path';

// Only fix these specific files that need channel names added
const filesToFix = [
  'src/features/agent/main/config.ipc.ts',
  'src/features/config/main/config.ipc.ts',
  'src/features/events/main/events.ipc.ts',
  'src/features/git-tracking/git-tracking.ipc.ts',
  'src/features/mcp/mcp.ipc.ts',
  'src/features/rules/user-rules.ipc.ts',
  'src/features/system/main/system.ipc.ts',
  'src/features/testing/testing.ipc.ts',
  'src/features/workspace/main/workspace.ipc.ts',
];

// Specific fixes for each file - mapping line numbers to channel names
const fixes: Record<string, Array<{line: number, channel: string}>> = {
  'src/features/testing/testing.ipc.ts': [
    {line: 66, channel: 'TESTING_CHANNELS.GET_PROCESSES'},
  ],
  'src/features/rules/user-rules.ipc.ts': [
    {line: 35, channel: 'USER_RULES_CHANNELS.GET_ALL'},
    {line: 49, channel: 'USER_RULES_CHANNELS.GET_FORMATTED'},
    {line: 99, channel: 'USER_RULES_CHANNELS.EXPORT'},
  ],
  'src/features/mcp/mcp.ipc.ts': [
    {line: 286, channel: 'MCP_CHANNELS.GET_STATUS'},
  ],
  'src/features/git-tracking/git-tracking.ipc.ts': [
    {line: 154, channel: 'GIT_TRACKING_CHANNELS.IS_GITHUB_AUTHENTICATED'},
  ],
  'src/features/workspace/main/workspace.ipc.ts': [
    {line: 311, channel: 'WORKSPACE_CHANNELS.LIST'},
    {line: 809, channel: 'WORKSPACE_CHANNELS.GET_RECENT'},
    {line: 818, channel: 'WORKSPACE_CHANNELS.CLEAR_RECENT'},
    {line: 896, channel: 'WORKSPACE_CHANNELS.GET_RECENT_REPOSITORIES'},
    {line: 916, channel: 'WORKSPACE_CHANNELS.CLEAR_RECENT_REPOSITORIES'},
    {line: 976, channel: 'EDITOR_CHANNELS.GET_SELECTION'},
  ],
  'src/features/system/main/system.ipc.ts': [
    {line: 60, channel: 'APP_CHANNELS.VERSION'},
    {line: 69, channel: 'APP_CHANNELS.GET_VERSION'},
    {line: 74, channel: 'APP_CHANNELS.NAME'},
    {line: 83, channel: 'APP_CHANNELS.GET_MEMORY_USAGE'},
    {line: 111, channel: 'APP_CHANNELS.ROOT'},
    {line: 138, channel: 'WINDOW_CHANNELS.MINIMIZE'},
    {line: 149, channel: 'WINDOW_CHANNELS.MAXIMIZE'},
    {line: 164, channel: 'WINDOW_CHANNELS.CLOSE'},
    {line: 889, channel: 'SETTINGS_CHANNELS.GET_ALL'},
    {line: 910, channel: 'SYSTEM_CHANNELS.HOME_DIRECTORY'},
    {line: 919, channel: 'SYSTEM_CHANNELS.WORKSPACE_ROOT'},
    {line: 932, channel: 'LEGACY_CHANNELS.GET_HOME_DIRECTORY'},
  ],
  'src/features/events/main/events.ipc.ts': [
    {line: 165, channel: 'EVENTS_CHANNELS.GET_STATISTICS'},
  ],
  'src/features/config/main/config.ipc.ts': [
    {line: 144, channel: 'CONFIG_CHANNELS.GET_ALL'},
  ],
  'src/features/agent/main/config.ipc.ts': [
    {line: 62, channel: 'CONFIG_CHANNELS.GET_ALL_MODELS'},
    {line: 81, channel: 'CONFIG_CHANNELS.CLEAR_CACHE'},
  ],
};

function fixFile(filePath: string) {
  const fullPath = path.join(process.cwd(), filePath);
  const content = fs.readFileSync(fullPath, 'utf-8');
  const lines = content.split('\n');

  const fileFixes = fixes[filePath];
  if (!fileFixes) {
    console.log(`No fixes needed for ${filePath}`);
    return;
  }

  // Sort fixes by line number in reverse order to avoid line number shifts
  fileFixes.sort((a, b) => b.line - a.line);

  for (const fix of fileFixes) {
    const lineIndex = fix.line - 1; // Convert to 0-based index
    const line = lines[lineIndex];

    if (!line) {
      console.warn(`Line ${fix.line} not found in ${filePath}`);
      continue;
    }

    // Check if already has third parameter
    if (line.includes(`, ${fix.channel})`)) {
      console.log(`Already fixed: ${filePath}:${fix.line}`);
      continue;
    }

    // Add channel as third parameter
    // Look for patterns like: )) or })) or )})) at end of line
    const patterns = [
      { search: /\)\)$/, replace: `, ${fix.channel}))` },
      { search: /\}\)\)$/, replace: `}, ${fix.channel}))` },
      { search: /\)\}\)\)$/, replace: `)}, ${fix.channel}))` },
      { search: /\)\),?$/, replace: `, ${fix.channel})),` },
    ];

    let fixed = false;
    for (const pattern of patterns) {
      if (pattern.search.test(line)) {
        lines[lineIndex] = line.replace(pattern.search, pattern.replace);
        fixed = true;
        console.log(`Fixed: ${filePath}:${fix.line} - Added ${fix.channel}`);
        break;
      }
    }

    if (!fixed) {
      console.warn(`Could not fix line ${fix.line} in ${filePath}`);
      console.warn(`  Line content: ${line.trim()}`);
    }
  }

  fs.writeFileSync(fullPath, lines.join('\n'));
}

// Main
console.log('Adding channel names to IPC handlers...\n');

for (const file of filesToFix) {
  try {
    fixFile(file);
  } catch (error) {
    console.error(`Error fixing ${file}:`, error);
  }
}

console.log('\n✅ Done!');
