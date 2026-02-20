#!/usr/bin/env tsx

/**
 * Performance Audit Script
 * Checks for common performance issues and memory leaks
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
  severity: 'low' | 'medium' | 'high';
}

const issues: Issue[] = [];

function scanFile(filePath: string): void {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const relativePath = path.relative(rootDir, filePath);

  lines.forEach((line, index) => {
    const lineNum = index + 1;

    // Check for setInterval without cleanup
    if (line.includes('setInterval') && !line.includes('clearInterval')) {
      // Check if there's a cleanup in the same file
      const hasCleanup = content.includes('clearInterval');
      if (!hasCleanup) {
        issues.push({
          file: relativePath,
          line: lineNum,
          type: 'Memory Leak',
          description: 'setInterval without corresponding clearInterval',
          severity: 'high',
        });
      }
    }

    // Check for event listeners without cleanup
    // Exclude app-lifetime singletons (error-reporter, theme, global-error-handler, debug config)
    // and beforeunload handlers which are intentionally persistent
    const isAppLifetimeSingleton = relativePath.includes('error-reporter') ||
                                    relativePath.includes('theme.ts') ||
                                    relativePath.includes('global-error-handler') ||
                                    relativePath.includes('debug.ts') ||
                                    line.includes('beforeunload');
    if (line.includes('addEventListener') && !line.includes('removeEventListener') && !isAppLifetimeSingleton) {
      const hasCleanup = content.includes('removeEventListener');
      if (!hasCleanup && !line.includes('{ once: true }')) {
        issues.push({
          file: relativePath,
          line: lineNum,
          type: 'Memory Leak',
          description: 'addEventListener without removeEventListener',
          severity: 'medium',
        });
      }
    }

    // Check for large arrays/objects in memory
    // Exclude test files which may intentionally allocate large arrays
    const isTestFile = relativePath.includes('.test.') || relativePath.includes('__tests__');
    // Only flag truly unbounded growth patterns (while(true) with push)
    const hasUnboundedGrowth = line.includes('while') && line.includes('true') && line.includes('.push');
    if (!isTestFile && (line.match(/new Array\(\d{6,}\)/) || hasUnboundedGrowth)) {
      issues.push({
        file: relativePath,
        line: lineNum,
        type: 'Performance',
        description: 'Potential large array allocation or unbounded growth',
        severity: 'medium',
      });
    }

    // Check for synchronous file operations in renderer
    // Exclude main process files (src/main, src/lib/utils/main, src/shared/main)
    const isMainProcess = relativePath.includes('src/main') ||
                          relativePath.includes('/main/') ||
                          relativePath.includes('src/preload');
    if ((relativePath.includes('src/lib') || relativePath.includes('src/routes')) && !isMainProcess) {
      if (line.includes('fs.readFileSync') || line.includes('fs.writeFileSync')) {
        issues.push({
          file: relativePath,
          line: lineNum,
          type: 'Performance',
          description: 'Synchronous file operation in renderer process',
          severity: 'high',
        });
      }
    }

    // Check for console.log in production code
    if (line.includes('console.log') && !relativePath.includes('test') && !relativePath.includes('scripts')) {
      issues.push({
        file: relativePath,
        line: lineNum,
        type: 'Performance',
        description: 'console.log in production code',
        severity: 'low',
      });
    }

    // Check for inefficient array operations
    if (line.includes('.filter(') && line.includes('.map(') && !line.includes('.flatMap(')) {
      issues.push({
        file: relativePath,
        line: lineNum,
        type: 'Performance',
        description: 'Chained filter().map() could be optimized',
        severity: 'low',
      });
    }

    // Check for missing debounce on input handlers
    if ((line.includes('oninput') || line.includes('on:input')) && !content.includes('debounce')) {
      issues.push({
        file: relativePath,
        line: lineNum,
        type: 'Performance',
        description: 'Input handler without debounce',
        severity: 'low',
      });
    }
  });
}

function scanDirectory(dir: string): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      // Skip node_modules and build directories
      if (!['node_modules', 'dist', '.svelte-kit', 'build'].includes(entry.name)) {
        scanDirectory(fullPath);
      }
    } else if (entry.isFile()) {
      // Only scan TypeScript and Svelte files
      if (entry.name.endsWith('.ts') || entry.name.endsWith('.svelte')) {
        scanFile(fullPath);
      }
    }
  }
}

console.log('🔍 Starting Performance Audit...\n');

// Scan src directory
scanDirectory(path.join(rootDir, 'src'));

// Group issues by severity
const highSeverity = issues.filter(i => i.severity === 'high');
const mediumSeverity = issues.filter(i => i.severity === 'medium');
const lowSeverity = issues.filter(i => i.severity === 'low');

// Print results
console.log('📊 Performance Audit Results');
console.log('='.repeat(60));
console.log(`Total Issues Found: ${issues.length}`);
console.log(`  🔴 High Severity: ${highSeverity.length}`);
console.log(`  🟡 Medium Severity: ${mediumSeverity.length}`);
console.log(`  🟢 Low Severity: ${lowSeverity.length}`);

if (highSeverity.length > 0) {
  console.log('\n🔴 High Severity Issues:');
  highSeverity.slice(0, 10).forEach(issue => {
    console.log(`  ${issue.file}:${issue.line}`);
    console.log(`    ${issue.type}: ${issue.description}`);
  });
}

if (mediumSeverity.length > 0) {
  console.log('\n🟡 Medium Severity Issues:');
  mediumSeverity.slice(0, 15).forEach(issue => {
    console.log(`  ${issue.file}:${issue.line}`);
    console.log(`    ${issue.type}: ${issue.description}`);
  });
}

console.log('\n✅ Audit Complete!');
