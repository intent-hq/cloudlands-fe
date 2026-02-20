#!/usr/bin/env tsx

/**
 * Verify that createSafeValidatedHandler and createValidatedHandler calls
 * have channel names as the third parameter
 */

import * as fs from 'fs';
import * as path from 'path';
import * as glob from 'glob';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface HandlerCall {
  file: string;
  line: number;
  hasChannelName: boolean;
  content: string;
}

function checkFile(filePath: string): HandlerCall[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const calls: HandlerCall[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for createSafeValidatedHandler or createValidatedHandler
    if (line.includes('createSafeValidatedHandler(') || line.includes('createValidatedHandler(')) {
      // Skip import statements
      if (line.includes('import')) continue;

      // Look for the full call (might span multiple lines)
      let callContent = '';
      let openParens = 0;
      let closeParens = 0;
      const startLine = i;

      for (let j = i; j < Math.min(i + 20, lines.length); j++) {
        callContent += `${lines[j]  }\n`;
        openParens += (lines[j].match(/\(/g) || []).length;
        closeParens += (lines[j].match(/\)/g) || []).length;

        // Check if we've found the complete call
        if (openParens > 0 && openParens === closeParens) {
          // Check if there's a third parameter (channel name)
          // Pattern: handler, channel) or handler, 'channel-name')
          const hasChannelName = /,\s*['"`][^'"`]+['"`]\s*\)/.test(callContent) ||
                                /,\s*[A-Z_]+\.[A-Z_]+\s*\)/.test(callContent);

          calls.push({
            file: filePath,
            line: startLine + 1,
            hasChannelName,
            content: lines[startLine].trim(),
          });
          break;
        }
      }
    }
  }

  return calls;
}

// Main execution
console.log('🔍 Verifying Channel Names in IPC Handlers...\n');

const srcDir = path.join(__dirname, '../src');
const files = glob.sync('**/*.{ts,js}', {
  cwd: srcDir,
  absolute: true,
  ignore: ['**/node_modules/**', '**/__tests__/**', '**/*.test.ts'],
});

const missingChannelNames: HandlerCall[] = [];
const hasChannelNames: HandlerCall[] = [];

for (const file of files) {
  const calls = checkFile(file);
  for (const call of calls) {
    if (call.hasChannelName) {
      hasChannelNames.push(call);
    } else {
      missingChannelNames.push(call);
    }
  }
}

// Report results
console.log(`✅ Handlers with channel names: ${hasChannelNames.length}`);
console.log(`❌ Handlers missing channel names: ${missingChannelNames.length}\n`);

if (missingChannelNames.length > 0) {
  console.log('Files with missing channel names:');
  const fileGroups = new Map<string, HandlerCall[]>();

  for (const call of missingChannelNames) {
    const relPath = path.relative(srcDir, call.file);
    if (!fileGroups.has(relPath)) {
      fileGroups.set(relPath, []);
    }
    fileGroups.get(relPath)!.push(call);
  }

  for (const [file, calls] of fileGroups) {
    console.log(`\n  ${file}:`);
    for (const call of calls) {
      console.log(`    Line ${call.line}: ${call.content}`);
    }
  }

  console.log('\n💡 To fix, add the channel name as the third parameter to each handler.');
  console.log('   Example: createSafeValidatedHandler(Schema, handler, "channel:name")');
} else {
  console.log('🎉 All handlers have channel names!');
}

// Show some examples of correct usage
if (hasChannelNames.length > 0) {
  console.log('\n📚 Examples of correct usage:');
  const examples = hasChannelNames.slice(0, 3);
  for (const example of examples) {
    const relPath = path.relative(srcDir, example.file);
    console.log(`  ${relPath}:${example.line}`);
  }
}
