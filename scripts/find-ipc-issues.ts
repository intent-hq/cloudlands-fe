#!/usr/bin/env tsx
/**
 * Script to find all IPC validation issues by analyzing invoke calls
 * and comparing them with their schema definitions
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read all schema definitions from ipc-schemas.ts
const schemaFile = path.join(__dirname, '../src/main/ipc-schemas.ts');
const schemaContent = fs.readFileSync(schemaFile, 'utf-8');

// Extract schema definitions
const schemaMap = new Map<string, string>();

// Parse schemas to understand what each channel expects
const schemaRegex = /export const (\w+Schema) = z\.(object|union|undefined|null|void)/g;
let match;
while ((match = schemaRegex.exec(schemaContent)) !== null) {
  const schemaName = match[1];
  const schemaType = match[2];
  schemaMap.set(schemaName, schemaType);
}

// Channels that expect EmptySchema (undefined/null/void)
const emptySchemaChannels = [
  'app:version',
  'app:get-version',
  'app:name',
  'app:get-memory-usage',
  'app:root',
  'window:minimize',
  'window:maximize',
  'window:close',
  'window:reload',
  'window:toggle-devtools',
  'window:focus',
  'window:blur',
  'window:fullscreen',
  'system:home-directory',
  'system:workspace-root',
  'get_home_directory',
  'settings:getAll',
  'user-rules:get-formatted',
  'user-rules:get-all',
  'user-rules:export',
];

// Find all TypeScript and Svelte files
const srcDir = path.join(__dirname, '../src');
const files = glob.sync('**/*.{ts,svelte}', { cwd: srcDir, absolute: true });

const issues: Array<{
  file: string;
  line: number;
  channel: string;
  issue: string;
  suggestion: string;
}> = [];

for (const file of files) {
  // Skip test files and generated files
  if (file.includes('.test.') || file.includes('.spec.') || file.includes('/generated/')) {
    continue;
  }

  const content = fs.readFileSync(file, 'utf-8');
  const lines = content.split('\n');

  lines.forEach((line, index) => {
    const lineNum = index + 1;

    // Pattern 1: invoke('channel') without second parameter when channel needs object
    const invokeNoParamMatch = line.match(/(?:invoke|window\.electronAPI\.invoke)\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/);
    if (invokeNoParamMatch) {
      const channel = invokeNoParamMatch[1];
      if (!emptySchemaChannels.includes(channel)) {
        issues.push({
          file: path.relative(process.cwd(), file),
          line: lineNum,
          channel,
          issue: 'Missing parameter - channel expects an object',
          suggestion: 'Add second parameter with required object structure',
        });
      }
    }

    // Pattern 2: invoke('channel', rawValue) where rawValue is not an object literal
    const invokeRawValueMatch = line.match(/(?:invoke|window\.electronAPI\.invoke)\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*([^{)][^)]*)\)/);
    if (invokeRawValueMatch) {
      const channel = invokeRawValueMatch[1];
      const value = invokeRawValueMatch[2].trim();

      // Skip if it's already undefined/null for empty schema channels
      if (emptySchemaChannels.includes(channel)) {
        if (value !== 'undefined' && value !== 'null' && value !== 'void 0') {
          issues.push({
            file: path.relative(process.cwd(), file),
            line: lineNum,
            channel,
            issue: `Channel expects EmptySchema but got: ${value}`,
            suggestion: `Change to: invoke('${channel}', undefined)`,
          });
        }
      } else if (!value.startsWith('{') && !value.includes('...') && !value.includes('await')) {
        // It's likely a raw value being passed
        issues.push({
          file: path.relative(process.cwd(), file),
          line: lineNum,
          channel,
          issue: `Passing raw value "${value}" instead of object`,
          suggestion: 'Wrap in object: { /* appropriate properties */ }',
        });
      }
    }

    // Pattern 3: EmptySchema channels called without undefined
    const emptySchemaMatch = line.match(/(?:invoke|window\.electronAPI\.invoke)\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*\{\s*\}\s*\)/);
    if (emptySchemaMatch) {
      const channel = emptySchemaMatch[1];
      if (emptySchemaChannels.includes(channel)) {
        issues.push({
          file: path.relative(process.cwd(), file),
          line: lineNum,
          channel,
          issue: 'Passing empty object {} instead of undefined',
          suggestion: `Change to: invoke('${channel}', undefined)`,
        });
      }
    }
  });
}

// Output results
console.log(`\n🔍 IPC Validation Issue Scanner Results\n${'='.repeat(60)}\n`);

if (issues.length === 0) {
  console.log('✅ No IPC validation issues found!');
} else {
  console.log(`Found ${issues.length} potential IPC validation issues:\n`);

  issues.forEach((issue, index) => {
    console.log(`${index + 1}. ${issue.file}:${issue.line}`);
    console.log(`   Channel: ${issue.channel}`);
    console.log(`   Issue: ${issue.issue}`);
    console.log(`   Suggestion: ${issue.suggestion}\n`);
  });
}
