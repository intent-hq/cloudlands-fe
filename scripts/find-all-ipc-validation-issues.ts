#!/usr/bin/env npx tsx

/**
 * Find all IPC invoke calls that might cause validation errors
 */

import * as fs from 'fs';
import * as path from 'path';
import * as glob from 'glob';

interface Issue {
  file: string;
  line: number;
  channel: string;
  issue: string;
  code: string;
}

const issues: Issue[] = [];

function analyzeFile(filePath: string) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const relPath = path.relative(process.cwd(), filePath);

  lines.forEach((line, index) => {
    const lineNum = index + 1;

    // Pattern 1: invoke('channel', {}) - empty object
    const emptyObjMatch = line.match(/invoke\s*(?:<[^>]+>)?\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*\{\s*\}\s*\)/);
    if (emptyObjMatch) {
      issues.push({
        file: relPath,
        line: lineNum,
        channel: emptyObjMatch[1],
        issue: 'Passing empty object {} - might be missing required fields',
        code: line.trim(),
      });
    }

    // Pattern 2: invoke('channel', 'string') - raw string
    const stringMatch = line.match(/invoke\s*(?:<[^>]+>)?\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*['"`]([^'"`]+)['"`]\s*\)/);
    if (stringMatch) {
      issues.push({
        file: relPath,
        line: lineNum,
        channel: stringMatch[1],
        issue: `Passing raw string "${stringMatch[2]}" instead of object`,
        code: line.trim(),
      });
    }

    // Pattern 3: invoke('channel', [...]) - raw array
    const arrayMatch = line.match(/invoke\s*(?:<[^>]+>)?\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*\[/);
    if (arrayMatch) {
      issues.push({
        file: relPath,
        line: lineNum,
        channel: arrayMatch[1],
        issue: 'Passing raw array instead of object',
        code: line.trim(),
      });
    }

    // Pattern 4: invoke('channel') - missing second parameter
    const noParamMatch = line.match(/invoke\s*(?:<[^>]+>)?\s*\(\s*['"`]([^'"`]+)['"`]\s*\)(?!\s*\.)/);
    if (noParamMatch) {
      // Check if it's not followed by .then or .catch
      const channel = noParamMatch[1];
      // Skip channels that expect EmptySchema
      const emptySchemaChannels = [
        'app:version', 'app:name', 'system:home-directory',
        'window:minimize', 'window:maximize', 'window:close',
      ];
      if (!emptySchemaChannels.includes(channel)) {
        issues.push({
          file: relPath,
          line: lineNum,
          channel,
          issue: 'Missing second parameter - channel might expect an object',
          code: line.trim(),
        });
      }
    }

    // Pattern 5: window.electronAPI.invoke with same patterns
    const electronAPIMatch = line.match(/window\.electronAPI\.invoke\s*\(\s*['"`]([^'"`]+)['"`]/);
    if (electronAPIMatch) {
      const channel = electronAPIMatch[1];

      // Check for empty object
      if (line.includes('{}')) {
        issues.push({
          file: relPath,
          line: lineNum,
          channel,
          issue: 'electronAPI.invoke with empty object',
          code: line.trim(),
        });
      }

      // Check for raw string
      const afterChannel = line.substring(line.indexOf(channel) + channel.length);
      if (afterChannel.match(/^['"`]\s*,\s*['"`]/)) {
        issues.push({
          file: relPath,
          line: lineNum,
          channel,
          issue: 'electronAPI.invoke with raw string',
          code: line.trim(),
        });
      }
    }
  });
}

// Main execution
console.log('🔍 Finding All IPC Validation Issues\n');

const srcDir = path.join(process.cwd(), 'src');
const files = glob.sync('**/*.{ts,svelte,js}', { cwd: srcDir, absolute: true });

console.log(`Analyzing ${files.length} files...\n`);

for (const file of files) {
  if (!file.includes('node_modules') && !file.includes('.test.')) {
    analyzeFile(file);
  }
}

// Group issues by pattern
const byPattern = new Map<string, Issue[]>();
issues.forEach(issue => {
  const key = issue.issue;
  if (!byPattern.has(key)) {
    byPattern.set(key, []);
  }
  byPattern.get(key)!.push(issue);
});

// Display results
console.log(`📊 Found ${issues.length} potential issues:\n`);

for (const [pattern, patternIssues] of byPattern.entries()) {
  console.log(`\n${pattern} (${patternIssues.length} occurrences):`);
  console.log('─'.repeat(60));

  // Show first 5 examples
  patternIssues.slice(0, 5).forEach(issue => {
    console.log(`  ${issue.file}:${issue.line}`);
    console.log(`    Channel: ${issue.channel}`);
    console.log(`    Code: ${issue.code.substring(0, 80)}...`);
  });

  if (patternIssues.length > 5) {
    console.log(`  ... and ${patternIssues.length - 5} more`);
  }
}

// Summary by channel
console.log('\n📋 Issues by Channel:');
console.log('─'.repeat(60));
const byChannel = new Map<string, number>();
issues.forEach(issue => {
  byChannel.set(issue.channel, (byChannel.get(issue.channel) || 0) + 1);
});

Array.from(byChannel.entries())
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10)
  .forEach(([channel, count]) => {
    console.log(`  ${channel}: ${count} issues`);
  });

console.log('\n✅ Next Steps:');
console.log('1. Check each channel\'s expected schema in src/main/ipc-schemas.ts');
console.log('2. Fix invoke calls to pass correct object structure');
console.log('3. Run the app again to verify fixes');
