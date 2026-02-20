#!/usr/bin/env tsx

/**
 * Fix IPC handlers that are missing channel names
 * This script specifically targets handlers that don't have the channel name as third parameter
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';

const DRY_RUN = process.argv.includes('--dry-run');

interface HandlerToFix {
  file: string;
  line: number;
  channel: string;
  currentCode: string;
  fixedCode: string;
}

/**
 * Parse a multi-line handler registration to find the channel and handler
 */
function parseHandlerRegistration(
  lines: string[],
  startIdx: number,
): {
  channel: string | null;
  handlerStart: number;
  handlerEnd: number;
} | null {
  // Look for ipcMain.handle pattern
  let channel: string | null = null;
  let handlerStart = -1;
  let handlerEnd = -1;

  // Find the ipcMain.handle line
  for (let i = startIdx - 5; i <= startIdx; i++) {
    if (i < 0) continue;
    const line = lines[i];

    if (line.includes('ipcMain.handle')) {
      // Extract channel from this or next lines
      let searchStr = '';
      for (let j = i; j < Math.min(i + 3, lines.length); j++) {
        searchStr += `${lines[j]  } `;

        const match = searchStr.match(
          /ipcMain\.handle\s*\(\s*([A-Z_]+(?:\.[A-Z_]+)+|['"`][^'"`]+['"`])\s*,/,
        );
        if (match) {
          channel = match[1];
          if (channel.startsWith('"') || channel.startsWith("'") || channel.startsWith('`')) {
            channel = channel.slice(1, -1);
          }
          break;
        }
      }

      // Find where the handler starts
      for (let j = i; j < Math.min(i + 10, lines.length); j++) {
        if (
          lines[j].includes('createSafeValidatedHandler') ||
          lines[j].includes('createValidatedHandler')
        ) {
          handlerStart = j;

          // Find where it ends (look for the closing of ipcMain.handle)
          let parenCount = 0;
          let started = false;
          for (let k = i; k < Math.min(lines.length, i + 50); k++) {
            const line = lines[k];

            if (line.includes('ipcMain.handle')) started = true;

            if (started) {
              for (const char of line) {
                if (char === '(') parenCount++;
                if (char === ')') parenCount--;
              }

              if (parenCount === 0 && k > i) {
                handlerEnd = k;
                break;
              }
            }
          }

          break;
        }
      }

      if (channel && handlerStart >= 0 && handlerEnd >= 0) {
        return { channel, handlerStart, handlerEnd };
      }
    }
  }

  return null;
}

/**
 * Check if a handler already has a channel parameter
 */
function hasChannelParameter(lines: string[], startIdx: number, endIdx: number): boolean {
  const handlerCode = lines.slice(startIdx, endIdx + 1).join(' ');

  // Check if it has three parameters (schema, handler, channel)
  const match = handlerCode.match(/create(?:Safe)?ValidatedHandler\s*\([^,)]+,[^,)]+,[^)]+\)/);
  return !!match;
}

/**
 * Fix a handler by adding the channel parameter
 */
function fixHandler(lines: string[], startIdx: number, endIdx: number, channel: string): string[] {
  const newLines = [...lines];

  // Find the closing of the handler function
  for (let i = endIdx; i >= startIdx; i--) {
    const line = lines[i];

    // Look for patterns like }, CHANNEL) or })
    if (line.includes(')') && (line.includes('}') || lines[i - 1]?.includes('}'))) {
      // Check if this is the closing of createSafeValidatedHandler
      const beforeParen = line.substring(0, line.lastIndexOf(')'));

      // Add the channel parameter
      if (beforeParen.includes('}')) {
        // Pattern: }, XXX)
        if (line.match(/},\s*[A-Z_\.]+\s*\)/)) {
          // Already has something, might be the channel
          continue;
        }
        // Pattern: })
        newLines[i] = line.replace(/}\s*\)/, `}, ${channel})`);
        break;
      } else if (lines[i - 1]?.includes('}')) {
        // Pattern where } is on previous line and ) is on this line
        if (line.trim() === ')' || line.trim() === '),') {
          newLines[i] = `    }, ${channel})${  line.includes(',') ? ',' : ''}`;
          break;
        }
      }
    }
  }

  return newLines;
}

async function main() {
  console.log('🔍 Finding IPC handlers missing channel names...\n');

  const files = await glob('src/**/*.ipc.ts', {
    cwd: process.cwd(),
    absolute: true,
  });

  const toFix: HandlerToFix[] = [];

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.includes('createSafeValidatedHandler') || line.includes('createValidatedHandler')) {
        // Skip imports
        if (line.includes('import')) continue;

        // Parse the handler registration
        const registration = parseHandlerRegistration(lines, i);
        if (registration) {
          const { channel, handlerStart, handlerEnd } = registration;

          // Check if it already has a channel parameter
          if (!hasChannelParameter(lines, handlerStart, handlerEnd)) {
            const currentCode = lines.slice(handlerStart, handlerEnd + 1).join('\n');
            const fixedLines = fixHandler(lines, handlerStart, handlerEnd, channel);
            const fixedCode = fixedLines.slice(handlerStart, handlerEnd + 1).join('\n');

            if (currentCode !== fixedCode) {
              toFix.push({
                file,
                line: handlerStart + 1,
                channel,
                currentCode: `${currentCode.substring(0, 100)  }...`,
                fixedCode: `${fixedCode.substring(0, 100)  }...`,
              });

              // Apply the fix
              if (!DRY_RUN) {
                fs.writeFileSync(file, fixedLines.join('\n'));
              }
            }
          }

          // Skip to the end of this handler
          i = handlerEnd;
        }
      }
    }
  }

  // Report results
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}\n`);

  if (toFix.length === 0) {
    console.log('✅ All handlers already have channel names!');
  } else {
    console.log(`📝 ${DRY_RUN ? 'Would fix' : 'Fixed'} ${toFix.length} handler(s):\n`);

    // Group by file
    const byFile = new Map<string, HandlerToFix[]>();
    for (const fix of toFix) {
      const relPath = path.relative(process.cwd(), fix.file);
      if (!byFile.has(relPath)) {
        byFile.set(relPath, []);
      }
      byFile.get(relPath)!.push(fix);
    }

    for (const [file, fixes] of byFile) {
      console.log(`  ${file}:`);
      for (const fix of fixes) {
        console.log(`    Line ${fix.line}: Added channel '${fix.channel}'`);
      }
    }

    if (DRY_RUN) {
      console.log('\n💡 Run without --dry-run to apply fixes');
    }
  }
}

main().catch(console.error);
