#!/usr/bin/env tsx

/**
 * Fix IPC handlers to pass channel name to validation middleware
 *
 * This script automatically updates all IPC handlers to pass the channel name
 * as the third parameter to createSafeValidatedHandler and createValidatedHandler
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';

const DRY_RUN = process.argv.includes('--dry-run');

interface Fix {
  file: string;
  line: number;
  original: string;
  fixed: string;
  channel: string;
}

const fixes: Fix[] = [];

/**
 * Extract channel variable or string from ipcMain.handle call
 */
function extractChannel(line: string, prevLines: string[]): string | null {
  // Try to extract from the current line
  const handleMatch = line.match(/ipcMain\.handle\s*\(\s*([^,]+),/);
  if (handleMatch) {
    const channel = handleMatch[1].trim();
    // Remove quotes if it's a string literal
    if (channel.startsWith('"') || channel.startsWith("'") || channel.startsWith('`')) {
      return channel.slice(1, -1);
    }
    return channel;
  }

  // Look in previous lines for the channel
  for (let i = prevLines.length - 1; i >= Math.max(0, prevLines.length - 3); i--) {
    const prevLine = prevLines[i];
    const prevMatch = prevLine.match(/ipcMain\.handle\s*\(\s*([^,]+),?$/);
    if (prevMatch) {
      const channel = prevMatch[1].trim();
      if (channel.startsWith('"') || channel.startsWith("'") || channel.startsWith('`')) {
        return channel.slice(1, -1);
      }
      return channel;
    }
  }

  return null;
}

/**
 * Fix a single file
 */
function fixFile(filePath: string): void {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const newLines = [...lines];
  let modified = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check if this line has createSafeValidatedHandler or createValidatedHandler
    if (line.includes('createSafeValidatedHandler') || line.includes('createValidatedHandler')) {
      // Check if it already has a third parameter (channel name)
      const hasThirdParam = /create(?:Safe)?ValidatedHandler\s*\([^,]+,[^,]+,[^)]+\)/.test(line);

      if (!hasThirdParam) {
        // Find the channel name from surrounding context
        const channel = extractChannel(lines.slice(Math.max(0, i - 5), i + 1).join('\n'), lines.slice(0, i));

        if (channel) {
          // Fix the line by adding the channel as third parameter
          const fixedLine = line.replace(
            /(create(?:Safe)?ValidatedHandler\s*\([^,]+,\s*async[^)]+)\)/,
            `$1, ${channel.includes(':') ? `'${channel}'` : channel})`,
          );

          if (fixedLine !== line) {
            fixes.push({
              file: filePath,
              line: i + 1,
              original: line,
              fixed: fixedLine,
              channel,
            });
            newLines[i] = fixedLine;
            modified = true;
          }
        }
      }
    }
  }

  if (modified && !DRY_RUN) {
    fs.writeFileSync(filePath, newLines.join('\n'));
  }
}

/**
 * Main function
 */
async function main() {
  console.log('🔍 Searching for IPC handler files...\n');

  // Find all TypeScript files that might contain IPC handlers
  const files = await glob('src/**/*.ipc.ts', {
    cwd: path.join(process.cwd()),
    absolute: true,
  });

  // Also check main files
  const mainFiles = await glob('src/main/**/*.ts', {
    cwd: path.join(process.cwd()),
    absolute: true,
  });

  const allFiles = [...new Set([...files, ...mainFiles])];

  console.log(`Found ${allFiles.length} files to check\n`);

  // Process each file
  for (const file of allFiles) {
    fixFile(file);
  }

  // Report results
  if (fixes.length === 0) {
    console.log('✅ No fixes needed - all handlers already pass channel names!\n');
  } else {
    console.log(`📝 ${DRY_RUN ? 'Would fix' : 'Fixed'} ${fixes.length} handler${fixes.length === 1 ? '' : 's'}:\n`);

    // Group by file
    const byFile = new Map<string, Fix[]>();
    for (const fix of fixes) {
      if (!byFile.has(fix.file)) {
        byFile.set(fix.file, []);
      }
      byFile.get(fix.file)!.push(fix);
    }

    // Display fixes
    for (const [file, fileFixes] of byFile) {
      const relPath = path.relative(process.cwd(), file);
      console.log(`\n📄 ${relPath}:`);
      for (const fix of fileFixes) {
        console.log(`  Line ${fix.line}: Added channel '${fix.channel}'`);
      }
    }

    if (DRY_RUN) {
      console.log('\n⚠️  This was a dry run. Run without --dry-run to apply fixes.');
    } else {
      console.log('\n✅ All fixes applied successfully!');
    }
  }
}

// Run the script
main().catch(console.error);
