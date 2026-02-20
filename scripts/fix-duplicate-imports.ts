#!/usr/bin/env tsx

/**
 * Fix Duplicate Imports
 *
 * This script removes duplicate imports of branded types.
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function removeDuplicateImports(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;

  let content = fs.readFileSync(filePath, 'utf-8');
  const originalContent = content;

  // Find all import statements
  const importRegex = /import\s*{[^}]+}\s*from\s*['"][^'"]+['"]\s*;?/g;
  const imports = content.match(importRegex) || [];

  // Track seen imports
  const seenImports = new Map<string, Set<string>>();
  const duplicateImports: string[] = [];

  for (const importStatement of imports) {
    // Extract imported items and source
    const match = importStatement.match(/import\s*{([^}]+)}\s*from\s*['"]([^'"]+)['"]/);
    if (!match) continue;

    const [, itemsStr, source] = match;
    const items = itemsStr.split(',').map(item => item.trim());

    if (!seenImports.has(source)) {
      seenImports.set(source, new Set());
    }

    const sourceImports = seenImports.get(source)!;
    let hasDuplicate = false;

    for (const item of items) {
      if (sourceImports.has(item)) {
        hasDuplicate = true;
      } else {
        sourceImports.add(item);
      }
    }

    if (hasDuplicate) {
      duplicateImports.push(importStatement);
    }
  }

  // Remove duplicate imports
  for (const dup of duplicateImports) {
    content = content.replace(dup, '');
  }

  // Clean up extra newlines
  content = content.replace(/\n\n\n+/g, '\n\n');

  if (content !== originalContent) {
    fs.writeFileSync(filePath, content);
    return true;
  }

  return false;
}

// Main execution
console.log('🔧 Fixing Duplicate Imports...\n');

const srcDir = path.join(__dirname, '../src');
const files = glob.sync('**/*.{ts,svelte}', { cwd: srcDir, absolute: true });

let fixedCount = 0;

for (const file of files) {
  if (removeDuplicateImports(file)) {
    console.log(`✅ Fixed: ${path.relative(srcDir, file)}`);
    fixedCount++;
  }
}

console.log(`\n✨ Fixed ${fixedCount} files with duplicate imports.`);
