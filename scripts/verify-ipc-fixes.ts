#!/usr/bin/env npx tsx

/**
 * Verify that the IPC validation fixes are working
 */

import * as fs from 'fs';
import * as path from 'path';

const debugFile = '/Users/ameilawattenberger/Library/Application Support/Electron/.augment/ipc-debug/ipc-debug.json';

console.log('🔍 Verifying IPC Validation Fixes\n');

// Check if debug file exists
if (!fs.existsSync(debugFile)) {
  console.log('❌ Debug file not found. Please run the app first.');
  process.exit(1);
}

// Read and parse the debug file
const debugData = JSON.parse(fs.readFileSync(debugFile, 'utf-8'));

// Filter for validation errors
const validationErrors = debugData.filter((entry: any) => entry.type === 'validation_error');

console.log(`📊 Total entries: ${debugData.length}`);
console.log(`❌ Validation errors: ${validationErrors.length}\n`);

// Group errors by pattern
const errorPatterns = new Map<string, number>();

validationErrors.forEach((error: any) => {
  let pattern = 'unknown';

  if (typeof error.data === 'string') {
    if (error.data === 'shortcuts') {
      pattern = 'config:get with string "shortcuts"';
    } else {
      pattern = `string value: "${error.data}"`;
    }
  } else if (Array.isArray(error.data)) {
    if (error.data[0]?.path?.includes('.workspace/agents/')) {
      pattern = 'file:read-batch with array of agent paths';
    } else {
      pattern = 'array passed instead of object';
    }
  } else if (error.data === null || error.data === undefined) {
    pattern = 'null or undefined';
  } else if (typeof error.data === 'object' && Object.keys(error.data).length === 0) {
    pattern = 'empty object';
  }

  errorPatterns.set(pattern, (errorPatterns.get(pattern) || 0) + 1);
});

// Display error patterns
console.log('📋 Error Patterns Found:');
console.log('------------------------');
for (const [pattern, count] of errorPatterns.entries()) {
  console.log(`  ${pattern}: ${count} occurrences`);
}

// Check for specific fixed issues
console.log('\n✅ Checking Fixed Issues:');
console.log('-------------------------');

const shortcutsErrors = validationErrors.filter((e: any) => e.data === 'shortcuts');
const fileReadBatchErrors = validationErrors.filter((e: any) =>
  Array.isArray(e.data) && e.data[0]?.path?.includes('.workspace/agents/'),
);

console.log(`  config:get "shortcuts" errors: ${shortcutsErrors.length} ${shortcutsErrors.length === 0 ? '✅ FIXED!' : '❌ Still present'}`);
console.log(`  file:read-batch array errors: ${fileReadBatchErrors.length} ${fileReadBatchErrors.length === 0 ? '✅ FIXED!' : '❌ Still present'}`);

// Show recent errors
console.log('\n📅 Most Recent Validation Errors (last 5):');
console.log('------------------------------------------');
const recentErrors = validationErrors.slice(-5);
recentErrors.forEach((error: any) => {
  const errorObj = JSON.parse(error.error)[0];
  console.log(`  ${new Date(error.timestamp).toLocaleTimeString()}: ${errorObj.message}`);
  console.log(`    Channel: ${error.channel}`);
  console.log(`    Data: ${JSON.stringify(error.data).substring(0, 100)}...`);
});

// Summary
console.log('\n📊 Summary:');
console.log('-----------');
if (validationErrors.length === 0) {
  console.log('🎉 No validation errors found! All IPC calls are properly formatted.');
} else if (shortcutsErrors.length === 0 && fileReadBatchErrors.length === 0) {
  console.log('✅ The main issues have been fixed!');
  console.log(`⚠️  ${validationErrors.length} other validation errors remain.`);
} else {
  console.log('❌ Some issues still need to be fixed.');
  console.log('   Please run the app again after the fixes to see updated results.');
}
