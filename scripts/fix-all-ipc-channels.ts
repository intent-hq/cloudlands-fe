#!/usr/bin/env tsx

/**
 * Comprehensive script to fix all IPC handlers to include channel names
 * as the third parameter to createSafeValidatedHandler and createValidatedHandler
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';

const DRY_RUN = process.argv.includes('--dry-run');
const VERBOSE = process.argv.includes('--verbose');

interface HandlerInfo {
  file: string;
  line: number;
  content: string;
  channel: string | null;
  handlerType: 'createSafeValidatedHandler' | 'createValidatedHandler';
  hasChannel: boolean;
  fullHandler: string;
}

/**
 * Extract the full handler call that might span multiple lines
 */
function extractFullHandler(
  lines: string[],
  startLine: number,
): { handler: string; endLine: number } {
  let handler = '';
  let parenCount = 0;
  let started = false;
  let endLine = startLine;

  for (let i = startLine; i < lines.length && i < startLine + 50; i++) {
    const line = lines[i];

    // Start counting when we find the handler
    if (
      !started &&
      (line.includes('createSafeValidatedHandler') || line.includes('createValidatedHandler'))
    ) {
      started = true;
    }

    if (started) {
      handler += `${line  }\n`;

      // Count parentheses
      for (const char of line) {
        if (char === '(') parenCount++;
        if (char === ')') parenCount--;
      }

      // If we've closed all parentheses for the handler call, we're done
      if (
        (parenCount === 0 && handler.includes('createSafeValidatedHandler')) ||
        handler.includes('createValidatedHandler')
      ) {
        // Check if this is the end of the handler
        if (handler.match(/create(?:Safe)?ValidatedHandler\s*\([^)]*\)/)) {
          endLine = i;
          break;
        }
      }
    }
  }

  return { handler, endLine };
}

/**
 * Find the channel name from the ipcMain.handle call
 */
function findChannel(lines: string[], handlerLine: number): string | null {
  // Look backwards for ipcMain.handle
  for (let i = handlerLine - 1; i >= Math.max(0, handlerLine - 10); i--) {
    const line = lines[i];

    // Check for ipcMain.handle with a channel
    const match = line.match(/ipcMain\.handle\s*\(\s*([A-Z_\.]+(?:\.[A-Z_]+)*|['"`][^'"`]+['"`])/);
    if (match) {
      let channel = match[1];
      // Remove quotes if present
      if (channel.startsWith('"') || channel.startsWith("'") || channel.startsWith('`')) {
        channel = channel.slice(1, -1);
      }
      return channel;
    }
  }

  return null;
}

/**
 * Fix handlers in a file
 */
function fixFile(filePath: string): HandlerInfo[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const handlers: HandlerInfo[] = [];
  let modified = false;
  const newLines = [...lines];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for handler creation
    if (line.includes('createSafeValidatedHandler') || line.includes('createValidatedHandler')) {
      const handlerType = line.includes('createSafeValidatedHandler')
        ? 'createSafeValidatedHandler'
        : 'createValidatedHandler';

      const { handler, endLine } = extractFullHandler(lines, i);

      // Check if it already has a channel parameter
      const hasChannel = /create(?:Safe)?ValidatedHandler\s*\([^,]+,[^,]+,[^)]+\)/.test(handler);

      const channel = findChannel(lines, i);

      handlers.push({
        file: filePath,
        line: i + 1,
        content: line.trim(),
        channel,
        handlerType,
        hasChannel,
        fullHandler: handler,
      });

      // Fix if needed
      if (!hasChannel && channel) {
        // Find where to insert the channel parameter
        // Look for the closing of the handler function
        for (let j = i; j <= endLine; j++) {
          const currentLine = lines[j];

          // Find the end of the async handler function
          if (currentLine.includes('}')) {
            // Check if this line has the closing parenthesis for createSafeValidatedHandler
            if (currentLine.match(/}\s*\)/)) {
              // Add the channel parameter
              const fixedLine = currentLine.replace(
                /}\s*\)/,
                `}, ${channel.includes('.') ? channel : `'${channel}'`})`,
              );
              newLines[j] = fixedLine;
              modified = true;
              break;
            } else if (lines[j + 1] && lines[j + 1].trim() === ')') {
              // The closing paren is on the next line
              newLines[j + 1] = `    }, ${channel.includes('.') ? channel : `'${channel}'`})`;
              modified = true;
              break;
            }
          }
        }
      }
    }
  }

  if (modified && !DRY_RUN) {
    fs.writeFileSync(filePath, newLines.join('\n'));
  }

  return handlers;
}

async function main() {
  console.log('🔧 Fixing IPC Handler Channel Names\n');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}\n`);

  // Find all IPC handler files
  const ipcFiles = await glob('src/**/*.ipc.ts', {
    cwd: process.cwd(),
    absolute: true,
  });

  const mainFiles = await glob('src/**/main/**/*.ts', {
    cwd: process.cwd(),
    absolute: true,
  });

  const allFiles = [...new Set([...ipcFiles, ...mainFiles])];

  console.log(`Found ${allFiles.length} files to check\n`);

  const allHandlers: HandlerInfo[] = [];
  let filesFixed = 0;

  // Process each file
  for (const file of allFiles) {
    const handlers = fixFile(file);
    if (handlers.length > 0) {
      allHandlers.push(...handlers);

      const needsFix = handlers.filter((h) => !h.hasChannel && h.channel);
      if (needsFix.length > 0) {
        filesFixed++;
      }
    }
  }

  // Report results
  const handlersWithoutChannel = allHandlers.filter((h) => !h.hasChannel);
  const handlersFixed = handlersWithoutChannel.filter((h) => h.channel);
  const handlersUnfixable = handlersWithoutChannel.filter((h) => !h.channel);

  console.log('📊 Summary:');
  console.log(`  Total handlers found: ${allHandlers.length}`);
  console.log(`  Handlers already have channel: ${allHandlers.filter((h) => h.hasChannel).length}`);
  console.log(`  Handlers fixed: ${handlersFixed.length}`);
  console.log(`  Handlers couldn't fix (no channel found): ${handlersUnfixable.length}`);
  console.log(`  Files modified: ${filesFixed}\n`);

  if (VERBOSE && handlersFixed.length > 0) {
    console.log('✅ Fixed handlers:');
    const byFile = new Map<string, HandlerInfo[]>();
    for (const handler of handlersFixed) {
      const relPath = path.relative(process.cwd(), handler.file);
      if (!byFile.has(relPath)) {
        byFile.set(relPath, []);
      }
      byFile.get(relPath)!.push(handler);
    }

    for (const [file, handlers] of byFile) {
      console.log(`\n  ${file}:`);
      for (const handler of handlers) {
        console.log(`    Line ${handler.line}: ${handler.channel}`);
      }
    }
  }

  if (handlersUnfixable.length > 0) {
    console.log('\n⚠️ Handlers that need manual fixing:');
    const byFile = new Map<string, HandlerInfo[]>();
    for (const handler of handlersUnfixable) {
      const relPath = path.relative(process.cwd(), handler.file);
      if (!byFile.has(relPath)) {
        byFile.set(relPath, []);
      }
      byFile.get(relPath)!.push(handler);
    }

    for (const [file, handlers] of byFile) {
      console.log(`\n  ${file}:`);
      for (const handler of handlers) {
        console.log(`    Line ${handler.line}: ${handler.content.substring(0, 60)}...`);
      }
    }
  }

  if (DRY_RUN && handlersFixed.length > 0) {
    console.log('\n💡 Run without --dry-run to apply fixes');
  }
}

main().catch(console.error);
