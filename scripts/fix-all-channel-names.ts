#!/usr/bin/env tsx

/**
 * Automatically fix all createSafeValidatedHandler and createValidatedHandler calls
 * to include channel names as the third parameter
 */

import * as fs from 'fs';
import * as path from 'path';
import * as glob from 'glob';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface FixInfo {
  file: string;
  fixes: number;
}

function extractChannelName(lines: string[], startLine: number): string | null {
  // Look backwards for ipcMain.handle() call to find the channel
  for (let i = startLine - 1; i >= Math.max(0, startLine - 10); i--) {
    const line = lines[i];

    // Check for patterns like: ipcMain.handle(CHANNEL_NAME or ipcMain.handle('channel-name'
    const handleMatch = line.match(/ipcMain\.handle\s*\(\s*([A-Z_]+\.[A-Z_]+|['"`][^'"`]+['"`])/);
    if (handleMatch) {
      return handleMatch[1];
    }
  }

  return null;
}

function fixFile(filePath: string): number {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  let fixCount = 0;
  let modified = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for createSafeValidatedHandler or createValidatedHandler
    if ((line.includes('createSafeValidatedHandler(') || line.includes('createValidatedHandler(')) &&
        !line.includes('import') && !line.includes('//')) {

      // Find the complete handler call
      const callLines: string[] = [];
      let openParens = 0;
      let closeParens = 0;
      const startLine = i;
      let endLine = i;

      for (let j = i; j < Math.min(i + 50, lines.length); j++) {
        callLines.push(lines[j]);
        openParens += (lines[j].match(/\(/g) || []).length;
        closeParens += (lines[j].match(/\)/g) || []).length;

        if (openParens > 0 && openParens === closeParens) {
          endLine = j;
          break;
        }
      }

      const callContent = callLines.join('\n');

      // Check if it already has a channel name (third parameter)
      const hasChannelName = /,\s*['"`][^'"`]+['"`]\s*\)/.test(callContent) ||
                            /,\s*[A-Z_]+\.[A-Z_]+\s*\)/.test(callContent);

      if (!hasChannelName) {
        // Extract the channel name from the surrounding context
        const channelName = extractChannelName(lines, startLine);

        if (channelName) {
          // Find where to insert the channel name (before the closing parenthesis)
          const lastLine = lines[endLine];
          const lastParen = lastLine.lastIndexOf(')');

          if (lastParen !== -1) {
            // Insert the channel name before the last closing parenthesis
            lines[endLine] = `${lastLine.slice(0, lastParen)  }, ${  channelName  }${lastLine.slice(lastParen)}`;
            fixCount++;
            modified = true;
          }
        }
      }

      // Skip to the end of this handler
      i = endLine;
    }
  }

  if (modified) {
    fs.writeFileSync(filePath, lines.join('\n'));
  }

  return fixCount;
}

// Main execution
console.log('🔧 Automatically Fixing Channel Names in IPC Handlers...\n');

const srcDir = path.join(__dirname, '../src');

// Files to fix based on the verification script output
const filesToFix = [
  'features/workspace/main/workspace.ipc.ts',
  'features/workspace/main/first-visit-state.ipc.ts',
  'features/testing/testing.ipc.ts',
  'features/terminal/terminal.ipc.ts',
  'features/terminal/main/terminal-professional.ipc.ts',
  'features/system/main/system.ipc.ts',
  'features/rules/user-rules.ipc.ts',
  'features/rules/rules.ipc.ts',
  'features/remote-fs/main/remote-fs.ipc.ts',
  'features/notes/notes.ipc.ts',
  'features/notes/main/line-attribution.ipc.ts',
  'features/memories/memories.ipc.ts',
  'features/line-changes/line-changes.ipc.ts',
  'features/ide/main/ide.ipc.ts',
  'features/git-tracking/git-tracking.ipc.ts',
  'features/git/git.ipc.ts',
  'features/file-tracking/main/file-tracking.ipc.ts',
  'features/events/events.ipc.ts',
  'features/events/main/events.ipc.ts',
  'features/diffs/diffs.ipc.ts',
  'features/comments/main/comments.ipc.ts',
  'features/agent-testing/main/agent-testing.ipc.ts',
  'features/agent/main/persistence.ipc.ts',
  'features/agent/main/init-unified-backend.ts',
  'features/agent/main/config.ipc.ts',
  'features/agent/main/agent-missing.ipc.ts',
];

const results: FixInfo[] = [];

for (const relativePath of filesToFix) {
  const fullPath = path.join(srcDir, relativePath);

  if (fs.existsSync(fullPath)) {
    const fixes = fixFile(fullPath);
    if (fixes > 0) {
      results.push({ file: relativePath, fixes });
      console.log(`✅ Fixed ${fixes} handlers in ${relativePath}`);
    }
  } else {
    console.log(`⚠️  File not found: ${relativePath}`);
  }
}

console.log('\n📊 Summary:');
console.log(`Total files processed: ${filesToFix.length}`);
console.log(`Total fixes applied: ${results.reduce((sum, r) => sum + r.fixes, 0)}`);

if (results.length > 0) {
  console.log('\n✨ Files fixed:');
  for (const result of results) {
    console.log(`  ${result.file}: ${result.fixes} handlers`);
  }
}
