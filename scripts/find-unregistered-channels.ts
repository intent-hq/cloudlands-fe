#!/usr/bin/env tsx

/**
 * Find Unregistered IPC Channels
 *
 * This script finds all IPC channels that are being invoked but don't have registered handlers.
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ChannelUsage {
  channel: string;
  files: Set<string>;
  hasHandler: boolean;
}

const channelUsages = new Map<string, ChannelUsage>();

// Find all invoke calls
function findInvokeCalls(filePath: string): void {
  const content = fs.readFileSync(filePath, 'utf-8');

  // Match various invoke patterns
  const patterns = [
    /window\.electronAPI\.invoke\(['"`]([^'"`]+)['"`]/g,
    /electronAPI\.invoke\(['"`]([^'"`]+)['"`]/g,
    /invoke\(['"`]([^'"`]+)['"`]/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const channel = match[1];

      // Skip comments
      const lineStart = content.lastIndexOf('\n', match.index) + 1;
      const lineEnd = content.indexOf('\n', match.index);
      const line = content.substring(lineStart, lineEnd === -1 ? content.length : lineEnd);
      if (line.includes('//')) {
        const commentIndex = line.indexOf('//');
        const matchIndex = match.index - lineStart;
        if (commentIndex < matchIndex) continue;
      }

      if (!channelUsages.has(channel)) {
        channelUsages.set(channel, {
          channel,
          files: new Set(),
          hasHandler: false,
        });
      }

      channelUsages.get(channel)!.files.add(path.relative(process.cwd(), filePath));
    }
  }
}

// Find all handler registrations
function findHandlers(filePath: string): void {
  const content = fs.readFileSync(filePath, 'utf-8');

  // Match handler patterns
  const patterns = [
    /ipcMain\.handle\(['"`]([^'"`]+)['"`]/g,
    /ipcMain\.on\(['"`]([^'"`]+)['"`]/g,
    /createSafeValidatedHandler.*['"`]([^'"`]+)['"`]/g,
    /createValidatedHandler.*['"`]([^'"`]+)['"`]/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const channel = match[1];

      if (channelUsages.has(channel)) {
        channelUsages.get(channel)!.hasHandler = true;
      }
    }
  }

  // Also check for CHANNELS constant usage
  const channelConstantPattern = /([A-Z_]+_CHANNELS)\.([A-Z_]+)/g;
  let match;
  while ((match = channelConstantPattern.exec(content)) !== null) {
    // Try to resolve the channel name from the constant
    // This is a simplified check - in reality we'd need to parse the constants
    const fullMatch = match[0];

    // Check if this is in a handle call
    const handleIndex = content.lastIndexOf('ipcMain.handle(', match.index);
    const handleEndIndex = content.indexOf(')', match.index);

    if (handleIndex !== -1 && handleEndIndex !== -1) {
      const handleContent = content.substring(handleIndex, handleEndIndex);
      if (handleContent.includes(fullMatch)) {
        // Mark any channel that might match this pattern as having a handler
        for (const [channel, usage] of channelUsages) {
          if (channel.includes(':')) {
            const parts = channel.split(':');
            if (parts.length === 2) {
              const prefix = parts[0].toUpperCase();
              const suffix = parts[1].replace(/-/g, '_').toUpperCase();
              if (fullMatch.includes(prefix) || fullMatch.includes(suffix)) {
                usage.hasHandler = true;
              }
            }
          }
        }
      }
    }
  }
}

// Main execution
console.log('🔍 Finding Unregistered IPC Channels...\n');

const srcDir = path.join(__dirname, '../src');
const files = glob.sync('**/*.{ts,svelte}', { cwd: srcDir, absolute: true });

// Find all invoke calls
for (const file of files) {
  if (!file.includes('node_modules')) {
    findInvokeCalls(file);
  }
}

// Find all handlers
for (const file of files) {
  if (!file.includes('node_modules')) {
    findHandlers(file);
  }
}

// Report unregistered channels
const unregistered = Array.from(channelUsages.values())
  .filter(usage => !usage.hasHandler)
  .sort((a, b) => a.channel.localeCompare(b.channel));

if (unregistered.length > 0) {
  console.log(`❌ Found ${unregistered.length} unregistered channels:\n`);

  for (const usage of unregistered) {
    console.log(`  Channel: ${usage.channel}`);
    console.log(`  Used in ${usage.files.size} file(s):`);
    for (const file of Array.from(usage.files).slice(0, 3)) {
      console.log(`    - ${file}`);
    }
    if (usage.files.size > 3) {
      console.log(`    ... and ${usage.files.size - 3} more`);
    }
    console.log();
  }
} else {
  console.log('✅ All channels have registered handlers');
}

console.log(`\n📊 Summary: ${channelUsages.size} total channels, ${unregistered.length} unregistered`);
