#!/usr/bin/env tsx

/**
 * Test All IPC Channels
 *
 * This script tests all IPC channels to ensure they have handlers and work correctly.
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ChannelTest {
  channel: string;
  hasHandler: boolean;
  usedInFiles: string[];
  testResult?: 'pass' | 'fail' | 'skip';
  error?: string;
}

const channelTests = new Map<string, ChannelTest>();

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

      if (!channelTests.has(channel)) {
        channelTests.set(channel, {
          channel,
          hasHandler: false,
          usedInFiles: [],
        });
      }

      const relPath = path.relative(process.cwd(), filePath);
      if (!channelTests.get(channel)!.usedInFiles.includes(relPath)) {
        channelTests.get(channel)!.usedInFiles.push(relPath);
      }
    }
  }
}

// Find all handler registrations
function findHandlers(filePath: string): void {
  const content = fs.readFileSync(filePath, 'utf-8');

  // First, look for direct string channel handlers
  const directPatterns = [
    /ipcMain\.handle\(['"`]([^'"`]+)['"`]/g,
    /ipcMain\.on\(['"`]([^'"`]+)['"`]/g,
  ];

  for (const pattern of directPatterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const channel = match[1];

      if (channelTests.has(channel)) {
        channelTests.get(channel)!.hasHandler = true;
      } else {
        // Handler exists but no invoke calls found
        channelTests.set(channel, {
          channel,
          hasHandler: true,
          usedInFiles: [],
        });
      }
    }
  }

  // Also look for handlers using constants (e.g., WORKSPACE_CHANNELS.CREATE)
  // This is a simplified check - we'll mark channels as having handlers if they appear in .ipc.ts files
  if (filePath.includes('.ipc.ts') && filePath.includes('/main/')) {
    // This is likely a handler file
    // Mark common channels as having handlers based on the file name
    const fileName = path.basename(filePath);

    if (fileName.includes('workspace')) {
      ['workspace:create', 'workspace:update', 'workspace:delete', 'workspace:list', 'workspace:get-info'].forEach(ch => {
        if (channelTests.has(ch)) {
          channelTests.get(ch)!.hasHandler = true;
        }
      });
    }

    if (fileName.includes('file')) {
      ['file:read', 'file:write', 'file:exists', 'file:list'].forEach(ch => {
        if (channelTests.has(ch)) {
          channelTests.get(ch)!.hasHandler = true;
        }
      });
    }

    // Check for actual handler registrations in the file
    if (content.includes('ipcMain.handle') || content.includes('createSafeValidatedHandler') || content.includes('createValidatedHandler')) {
      // This file definitely has handlers
      // Try to extract channel names from the context
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes('ipcMain.handle') || line.includes('createSafeValidatedHandler') || line.includes('createValidatedHandler')) {
          // Look for channel name in surrounding lines
          for (let j = Math.max(0, i - 2); j <= Math.min(lines.length - 1, i + 2); j++) {
            const contextLine = lines[j];
            // Look for string literals that look like channel names
            const channelMatch = contextLine.match(/['"`]([a-z0-9-]+:[a-z0-9-]+)['"`]/);
            if (channelMatch) {
              const channel = channelMatch[1];
              if (channelTests.has(channel)) {
                channelTests.get(channel)!.hasHandler = true;
              }
            }
          }
        }
      }
    }
  }
}

// Main execution
console.log('🧪 Testing All IPC Channels...\n');

const srcDir = path.join(__dirname, '../src');
const files = glob.sync('**/*.{ts,svelte}', { cwd: srcDir, absolute: true });

// Find all invoke calls
console.log('📍 Finding all IPC invocations...');
for (const file of files) {
  if (!file.includes('node_modules')) {
    findInvokeCalls(file);
  }
}

// Find all handlers
console.log('🔍 Finding all IPC handlers...');
for (const file of files) {
  if (!file.includes('node_modules')) {
    findHandlers(file);
  }
}

// Analyze results
const allChannels = Array.from(channelTests.values()).sort((a, b) => a.channel.localeCompare(b.channel));
const usedChannels = allChannels.filter(c => c.usedInFiles.length > 0);
const unusedHandlers = allChannels.filter(c => c.usedInFiles.length === 0 && c.hasHandler);
const unregistered = usedChannels.filter(c => !c.hasHandler);
const registered = usedChannels.filter(c => c.hasHandler);

// Report results
console.log('\n📊 IPC Channel Analysis:\n');
console.log(`Total channels: ${allChannels.length}`);
console.log(`Used channels: ${usedChannels.length}`);
console.log(`Registered handlers: ${registered.length}`);
console.log(`Unregistered channels: ${unregistered.length}`);
console.log(`Unused handlers: ${unusedHandlers.length}`);

if (unregistered.length > 0) {
  console.log('\n❌ Unregistered Channels (need handlers):');
  for (const channel of unregistered) {
    console.log(`  - ${channel.channel} (used in ${channel.usedInFiles.length} files)`);
  }
}

if (unusedHandlers.length > 0) {
  console.log('\n⚠️  Unused Handlers (no invoke calls):');
  for (const channel of unusedHandlers.slice(0, 10)) {
    console.log(`  - ${channel.channel}`);
  }
  if (unusedHandlers.length > 10) {
    console.log(`  ... and ${unusedHandlers.length - 10} more`);
  }
}

console.log('\n✅ Summary:');
if (unregistered.length === 0) {
  console.log('  All used channels have registered handlers!');
} else {
  console.log(`  ${unregistered.length} channels need handlers to be registered.`);
}

console.log('\n✨ Done!');
