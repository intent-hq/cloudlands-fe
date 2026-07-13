#!/usr/bin/env tsx

/**
 * IPC Debug Checker
 *
 * CLI tool to check for missing IPC handlers and validation errors.
 * Usage: pnpm tsx scripts/check-ipc-debug.ts [command]
 *
 * Commands:
 *   summary - Show summary of IPC debug data
 *   missing - List missing handlers
 *   errors - Show recent validation errors
 *   clear - Clear debug data
 *   path - Show debug file paths
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Determine the debug directory
const userDataPath = path.join(os.homedir(), 'Library', 'Application Support', 'intent-by-augment');
const debugDir = path.join(userDataPath, '.augment', 'ipc-debug');
const debugFilePath = path.join(debugDir, 'ipc-debug.json');
const missingHandlersFilePath = path.join(debugDir, 'missing-handlers.json');

// Alternative paths if running in development
const altDebugDir = path.join(__dirname, '..', '.augment', 'ipc-debug');
const altDebugFilePath = path.join(altDebugDir, 'ipc-debug.json');
const altMissingHandlersFilePath = path.join(altDebugDir, 'missing-handlers.json');

function getDebugFiles() {
  // Check which files exist
  if (fs.existsSync(debugFilePath)) {
    return { debug: debugFilePath, missing: missingHandlersFilePath };
  } else if (fs.existsSync(altDebugFilePath)) {
    return { debug: altDebugFilePath, missing: altMissingHandlersFilePath };
  } else {
    // Create directory if it doesn't exist
    if (!fs.existsSync(altDebugDir)) {
      fs.mkdirSync(altDebugDir, { recursive: true });
    }
    return { debug: altDebugFilePath, missing: altMissingHandlersFilePath };
  }
}

function loadDebugData() {
  const files = getDebugFiles();

  let debugData: any[] = [];
  let missingData: any = {};

  try {
    if (fs.existsSync(files.debug)) {
      debugData = JSON.parse(fs.readFileSync(files.debug, 'utf-8'));
    }
  } catch (error) {
    console.error('Failed to load debug data:', error);
  }

  try {
    if (fs.existsSync(files.missing)) {
      missingData = JSON.parse(fs.readFileSync(files.missing, 'utf-8'));
    }
  } catch (error) {
    console.error('Failed to load missing handlers data:', error);
  }

  return { debugData, missingData };
}

function showSummary() {
  const { debugData, missingData } = loadDebugData();

  const totalCalls = debugData.length;
  const successfulCalls = debugData.filter((e) => e.type === 'success').length;
  const validationErrors = debugData.filter((e) => e.type === 'validation_error').length;
  const missingHandlerCalls = debugData.filter((e) => e.type === 'missing_handler').length;

  console.log('\n📊 IPC Debug Summary\n');
  console.log(`Total IPC Calls: ${totalCalls}`);
  console.log(`✅ Successful: ${successfulCalls}`);
  console.log(`❌ Validation Errors: ${validationErrors}`);
  console.log(`⚠️  Missing Handlers: ${missingHandlerCalls}`);

  if (missingData.channels && missingData.channels.length > 0) {
    console.log(
      `\n🔍 Unique Missing Handlers: ${missingData.count || missingData.channels.length}`,
    );
  }

  // Show recent errors
  const recentErrors = debugData
    .filter((e) => e.type === 'validation_error' || e.type === 'missing_handler')
    .slice(-5);

  if (recentErrors.length > 0) {
    console.log('\n📝 Recent Issues:');
    recentErrors.forEach((error) => {
      console.log(`  - [${error.timestamp}] ${error.channel}: ${error.error || error.type}`);
    });
  }
}

function showMissingHandlers() {
  const { missingData } = loadDebugData();

  if (!missingData.channels || missingData.channels.length === 0) {
    console.log('\n✅ No missing handlers detected!');
    return;
  }

  console.log('\n⚠️  Missing IPC Handlers\n');
  console.log(`Total: ${missingData.count || missingData.channels.length}`);
  console.log(`Last Updated: ${missingData.timestamp || 'Unknown'}\n`);

  console.log('Channels:');
  missingData.channels.forEach((channel: string) => {
    const suggestion = missingData.suggestions?.[channel] || 'No suggestion available';
    console.log(`  • ${channel}`);
    console.log(`    → ${suggestion}`);
  });

  console.log('\n💡 To fix these:');
  console.log('1. Create handler files in the suggested locations');
  console.log('2. Register handlers in src/main/index.ts');
  console.log('3. Add channel definitions to src/shared/ipc/channels.ts');
}

function showErrors() {
  const { debugData } = loadDebugData();

  const errors = debugData.filter((e) => e.type === 'validation_error');

  if (errors.length === 0) {
    console.log('\n✅ No validation errors found!');
    return;
  }

  console.log(`\n❌ Validation Errors (${errors.length} total)\n`);

  // Group by channel
  const byChannel = new Map<string, any[]>();
  errors.forEach((error) => {
    if (!byChannel.has(error.channel)) {
      byChannel.set(error.channel, []);
    }
    byChannel.get(error.channel)!.push(error);
  });

  byChannel.forEach((channelErrors, channel) => {
    console.log(`\n📡 Channel: ${channel} (${channelErrors.length} errors)`);

    // Show last 3 errors for this channel
    channelErrors.slice(-3).forEach((error) => {
      console.log(`  [${error.timestamp}]`);
      console.log(`    Error: ${error.error}`);
      if (error.data) {
        console.log(`    Data: ${JSON.stringify(error.data, null, 2).split('\n').join('\n    ')}`);
      }
    });
  });
}

function clearDebugData() {
  const files = getDebugFiles();

  try {
    if (fs.existsSync(files.debug)) {
      fs.writeFileSync(files.debug, '[]');
    }
    if (fs.existsSync(files.missing)) {
      fs.writeFileSync(
        files.missing,
        JSON.stringify(
          {
            timestamp: new Date().toISOString(),
            count: 0,
            channels: [],
            suggestions: {},
          },
          null,
          2,
        ),
      );
    }
    console.log('✅ Debug data cleared successfully');
  } catch (error) {
    console.error('Failed to clear debug data:', error);
  }
}

function showPaths() {
  const files = getDebugFiles();

  console.log('\n📁 IPC Debug File Paths\n');
  console.log(`Debug Log: ${files.debug}`);
  console.log(`Missing Handlers: ${files.missing}`);

  // Check if files exist
  console.log('\n📊 File Status:');
  console.log(`Debug Log: ${fs.existsSync(files.debug) ? '✅ Exists' : '❌ Not found'}`);
  console.log(`Missing Handlers: ${fs.existsSync(files.missing) ? '✅ Exists' : '❌ Not found'}`);
}

const command = process.argv[2] || 'summary';

switch (command) {
  case 'summary':
    showSummary();
    break;
  case 'missing':
    showMissingHandlers();
    break;
  case 'errors':
    showErrors();
    break;
  case 'clear':
    clearDebugData();
    break;
  case 'path':
  case 'paths':
    showPaths();
    break;
  default:
    console.log('Unknown command:', command);
    console.log('Available commands: summary, missing, errors, clear, path');
}
