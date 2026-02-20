#!/usr/bin/env tsx

/**
 * Fix the broken IPC handlers from incorrect channel parameter placement
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';

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

function fixFile(filePath: string) {
  const fullPath = path.join(process.cwd(), filePath);
  let content = fs.readFileSync(fullPath, 'utf-8');

  // Fix the broken pattern: async (, CHANNEL_NAME) =>
  // Should be: async (_event, data), CHANNEL_NAME) =>

  // Pattern 1: Fix handlers with EmptySchema
  content = content.replace(
    /createSafeValidatedHandler\(EmptySchema, async \(, ([A-Z_\.]+)\)/g,
    'createSafeValidatedHandler(EmptySchema, async () => {}, $1)',
  );

  // Pattern 2: Fix handlers with other schemas that take parameters
  content = content.replace(
    /createSafeValidatedHandler\(([^,]+Schema), async \(, ([A-Z_\.]+)\)/g,
    'createSafeValidatedHandler($1, async (_event, validated) => {}, $2)',
  );

  // Now fix the actual placement - move channel to third parameter
  // Pattern: createSafeValidatedHandler(Schema, async (...) => {}, CHANNEL)
  const lines = content.split('\n');
  const newLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Check if this line has the broken pattern
    if (line.includes('createSafeValidatedHandler') && line.includes('async') && line.includes(' => {}, ')) {
      // Extract the parts
      const match = line.match(/createSafeValidatedHandler\(([^,]+), async \([^)]*\) => \{\}, ([A-Z_\.]+)\)/);
      if (match) {
        const schema = match[1];
        const channel = match[2];

        // Determine the handler parameters based on schema
        let handlerParams = '()';
        if (!schema.includes('EmptySchema')) {
          handlerParams = '(_event, validated)';
        }

        // Reconstruct the line with channel as third parameter
        line = line.replace(
          /createSafeValidatedHandler\([^,]+, async \([^)]*\) => \{\}, [A-Z_\.]+\)/,
          `createSafeValidatedHandler(${schema}, async ${handlerParams}`,
        );

        // Add the channel as third parameter
        if (line.endsWith(')')) {
          line = `${line.slice(0, -1)  }, ${channel})`;
        } else if (line.endsWith(' => {')) {
          line = line.replace(' => {', `, ${channel}) => {`);
        } else if (line.endsWith(' => ({')) {
          line = line.replace(' => ({', `, ${channel}) => ({`);
        } else {
          // For multi-line handlers, add before the arrow function body
          line = line.replace(/async \([^)]*\)/, `async ${handlerParams}, ${channel}`);
        }
      }
    }

    newLines.push(line);
  }

  fs.writeFileSync(fullPath, newLines.join('\n'));
  console.log(`Fixed: ${filePath}`);
}

// Fix all files
console.log('Fixing broken IPC handlers...\n');
for (const file of files) {
  try {
    fixFile(file);
  } catch (error) {
    console.error(`Error fixing ${file}:`, error);
  }
}

console.log('\n✅ Done!');
