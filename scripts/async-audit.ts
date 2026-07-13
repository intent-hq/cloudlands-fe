#!/usr/bin/env tsx

/**
 * Async/Await Audit Script
 * Checks for common async/await issues and anti-patterns
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

interface Issue {
  file: string;
  line: number;
  type: string;
  description: string;
}

const issues: Issue[] = [];

function scanFile(filePath: string): void {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const relativePath = path.relative(rootDir, filePath);

  lines.forEach((line, index) => {
    const lineNum = index + 1;

    // Check for missing await on async functions
    if (line.match(/^\s*[a-zA-Z_$][a-zA-Z0-9_$]*\.(create|save|load|fetch|get|post|put|delete|update)\(/)) {
      if (!line.includes('await') && !line.includes('.then(') && !line.includes('.catch(')) {
        // Check if it's in an async context
        const functionContext = getFunctionContext(lines, index);
        if (functionContext && functionContext.includes('async')) {
          issues.push({
            file: relativePath,
            line: lineNum,
            type: 'Missing await',
            description: 'Possible missing await on async operation',
          });
        }
      }
    }

    // Check for forEach with async callback
    if (line.includes('.forEach(async')) {
      issues.push({
        file: relativePath,
        line: lineNum,
        type: 'Async anti-pattern',
        description: 'forEach with async callback - use for...of or Promise.all instead',
      });
    }

    // Check for try/catch without await
    if (line.includes('try {')) {
      const blockEnd = findBlockEnd(lines, index);
      const blockContent = lines.slice(index, blockEnd).join('\n');
      if (!blockContent.includes('await') && blockContent.includes('async')) {
        issues.push({
          file: relativePath,
          line: lineNum,
          type: 'Unnecessary try/catch',
          description: 'try/catch block without await',
        });
      }
    }

    // Check for Promise constructor anti-pattern
    if (line.includes('new Promise') && line.includes('async')) {
      issues.push({
        file: relativePath,
        line: lineNum,
        type: 'Promise anti-pattern',
        description: 'Unnecessary Promise constructor with async function',
      });
    }

    // Check for unhandled promise rejections
    if (line.match(/\.(then|catch)\([^)]*\)$/)) {
      if (!line.includes('.catch(') && !lines[index + 1]?.trim().startsWith('.catch(')) {
        issues.push({
          file: relativePath,
          line: lineNum,
          type: 'Unhandled rejection',
          description: 'Promise chain without error handling',
        });
      }
    }
  });
}

function getFunctionContext(lines: string[], index: number): string | null {
  // Look backwards for function declaration
  for (let i = index; i >= Math.max(0, index - 10); i--) {
    const line = lines[i];
    if (line.includes('function') || line.includes('=>')) {
      return line;
    }
  }
  return null;
}

function findBlockEnd(lines: string[], startIndex: number): number {
  let braceCount = 0;
  let inBlock = false;

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    for (const char of line) {
      if (char === '{') {
        braceCount++;
        inBlock = true;
      } else if (char === '}') {
        braceCount--;
        if (inBlock && braceCount === 0) {
          return i;
        }
      }
    }
  }
  return lines.length;
}

function scanDirectory(dir: string): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!['node_modules', 'dist', '.svelte-kit', 'build', '__tests__'].includes(entry.name)) {
        scanDirectory(fullPath);
      }
    } else if (entry.isFile()) {
      if ((entry.name.endsWith('.ts') || entry.name.endsWith('.svelte')) &&
          !entry.name.includes('.test.') && !entry.name.includes('.spec.')) {
        scanFile(fullPath);
      }
    }
  }
}

console.log('🔍 Starting Async/Await Audit...\n');

scanDirectory(path.join(rootDir, 'src'));

console.log('📊 Async/Await Audit Results');
console.log('='.repeat(60));
console.log(`Total Issues Found: ${issues.length}`);

if (issues.length > 0) {
  console.log('\n⚠️  Issues Found:');
  issues.slice(0, 20).forEach(issue => {
    console.log(`  ${issue.file}:${issue.line}`);
    console.log(`    ${issue.type}: ${issue.description}`);
  });
}

console.log('\n✅ Audit Complete!');
