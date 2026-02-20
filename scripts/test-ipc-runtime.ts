#!/usr/bin/env tsx

/**
 * Test IPC at Runtime
 *
 * This script tests if IPC handlers are actually registered at runtime.
 */

import { app, ipcMain } from 'electron';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize app
app.whenReady().then(() => {
  console.log('🔍 Testing IPC Handler Registration...\n');

  // Import and initialize all handlers
  const mainIndexPath = path.join(__dirname, '../src/main/index.ts');

  // Get all registered handlers
  const handlers = (ipcMain as any)._events || {};
  const handlerNames = Object.keys(handlers).filter(name => !name.startsWith('ELECTRON'));

  console.log(`Total registered handlers: ${handlerNames.length}\n`);

  // Group handlers by prefix
  const grouped = new Map<string, string[]>();

  for (const handler of handlerNames) {
    const prefix = handler.split(':')[0];
    if (!grouped.has(prefix)) {
      grouped.set(prefix, []);
    }
    grouped.get(prefix)!.push(handler);
  }

  // Display grouped handlers
  for (const [prefix, channels] of grouped) {
    console.log(`${prefix}: (${channels.length} handlers)`);
    for (const channel of channels.slice(0, 5)) {
      console.log(`  - ${channel}`);
    }
    if (channels.length > 5) {
      console.log(`  ... and ${channels.length - 5} more`);
    }
  }

  // Check for specific problematic channels
  const problematicChannels = [
    'git:diff',
    'git:getBranches',
    'git:log',
    'git:status',
    'agent:create',
    'agent:send-message',
    'config:get',
    'config:set',
  ];

  console.log('\n📍 Checking problematic channels:');
  for (const channel of problematicChannels) {
    const hasHandler = handlerNames.includes(channel);
    console.log(`  ${channel}: ${hasHandler ? '✅ Registered' : '❌ Not registered'}`);
  }

  app.quit();
});
