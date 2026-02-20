#!/usr/bin/env tsx
/**
 * Script to remove unused imports from TypeScript files
 * Uses TypeScript compiler API to detect and remove unused imports
 */

import * as ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';

// Get all TypeScript files
async function getTypeScriptFiles(): Promise<string[]> {
  const files = await glob('src/**/*.{ts,tsx}', {
    cwd: process.cwd(),
    ignore: [
      '**/node_modules/**',
      '**/dist/**',
      '**/*.d.ts',
      '**/generated-channels.ts',
      '**/shared/generated/**',
    ],
  });
  return files.map(f => path.resolve(process.cwd(), f));
}

// Check if an import is used in the file
function isImportUsed(importName: string, sourceFile: ts.SourceFile): boolean {
  let used = false;

  function visit(node: ts.Node) {
    if (used) return;

    // Check if this is an identifier that matches our import
    if (ts.isIdentifier(node) && node.text === importName) {
      // Make sure it's not the import declaration itself
      let parent = node.parent;
      while (parent) {
        if (ts.isImportDeclaration(parent) || ts.isImportSpecifier(parent)) {
          return;
        }
        parent = parent.parent;
      }
      used = true;
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return used;
}

// Process a single file
function processFile(filePath: string): number {
  const content = fs.readFileSync(filePath, 'utf-8');
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
  );

  const unusedImports: string[] = [];
  const linesToRemove: number[] = [];

  // Find all import declarations
  function findImports(node: ts.Node) {
    if (ts.isImportDeclaration(node)) {
      const importClause = node.importClause;
      if (importClause) {
        // Check default import
        if (importClause.name && !isImportUsed(importClause.name.text, sourceFile)) {
          unusedImports.push(importClause.name.text);
          const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line;
          linesToRemove.push(line);
        }

        // Check named imports
        if (importClause.namedBindings) {
          if (ts.isNamedImports(importClause.namedBindings)) {
            const allUnused = importClause.namedBindings.elements.every(
              spec => !isImportUsed(spec.name.text, sourceFile),
            );
            if (allUnused) {
              const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line;
              linesToRemove.push(line);
              importClause.namedBindings.elements.forEach(spec => {
                unusedImports.push(spec.name.text);
              });
            }
          }
        }
      }
    }

    ts.forEachChild(node, findImports);
  }

  findImports(sourceFile);

  if (linesToRemove.length > 0) {
    // Remove the unused import lines
    const lines = content.split('\n');
    const newLines = lines.filter((_, index) => !linesToRemove.includes(index));
    const newContent = newLines.join('\n');

    fs.writeFileSync(filePath, newContent);
    console.log(`✅ ${path.relative(process.cwd(), filePath)}: Removed ${unusedImports.length} unused imports`);
    unusedImports.forEach(imp => console.log(`   - ${imp}`));

    return unusedImports.length;
  }

  return 0;
}

// Main function
async function main() {
  console.log('🔍 Scanning for unused imports...\n');

  const files = await getTypeScriptFiles();
  console.log(`Found ${files.length} TypeScript files to process\n`);

  let totalRemoved = 0;
  let filesModified = 0;

  for (const file of files) {
    const removed = processFile(file);
    if (removed > 0) {
      totalRemoved += removed;
      filesModified++;
    }
  }

  console.log('\n📊 Summary:');
  console.log(`   Files scanned: ${files.length}`);
  console.log(`   Files modified: ${filesModified}`);
  console.log(`   Unused imports removed: ${totalRemoved}`);
}

main().catch(console.error);
