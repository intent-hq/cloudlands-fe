#!/usr/bin/env tsx

/**
 * Revert the broken IPC handler channel parameter changes
 *
 * The previous script incorrectly placed the channel name as a parameter to the async function
 * This script removes those incorrect channel parameters
 */

import * as fs from 'fs';
import * as path from 'path';

const files = [
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

function revertFile(filePath: string) {
  const fullPath = path.join(process.cwd(), filePath);
  let content = fs.readFileSync(fullPath, 'utf-8');

  // Fix patterns where channel was incorrectly added as async parameter
  // Pattern 1: async (, CHANNEL_NAME) => should be async () =>
  content = content.replace(
    /async \(, ([A-Z_\.]+)\) =>/g,
    'async () =>',
  );

  // Pattern 2: async (event, CHANNEL_NAME) => should be async (event, validated) =>
  content = content.replace(
    /async \(event, ([A-Z_\.]+)\) =>/g,
    'async (event, validated) =>',
  );

  // Pattern 3: async (_event, CHANNEL_NAME) => should be async (_event, validated) =>
  content = content.replace(
    /async \(_event, ([A-Z_\.]+)\) =>/g,
    'async (_event, validated) =>',
  );

  // Pattern 4: async (_, CHANNEL_NAME) => should be async (_, validated) =>
  content = content.replace(
    /async \(_, ([A-Z_\.]+)\) =>/g,
    'async (_, validated) =>',
  );

  fs.writeFileSync(fullPath, content);
  console.log(`Reverted: ${filePath}`);
}

// Main
console.log('Reverting broken IPC handler changes...\n');

for (const file of files) {
  try {
    revertFile(file);
  } catch (error) {
    console.error(`Error reverting ${file}:`, error);
  }
}

console.log('\n✅ All files reverted!');
