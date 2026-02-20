#!/usr/bin/env tsx

import * as ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';
import * as glob from 'glob';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function findChannelFromContext(sourceFile: ts.SourceFile, node: ts.Node): string | null {
  // Look for the parent ipcMain.handle call
  let parent = node.parent;
  while (parent) {
    if (ts.isCallExpression(parent)) {
      const expr = parent.expression;
      if (ts.isPropertyAccessExpression(expr) &&
          expr.name.text === 'handle' &&
          ts.isIdentifier(expr.expression) &&
          expr.expression.text === 'ipcMain') {
        // Found ipcMain.handle, get the first argument (channel)
        if (parent.arguments.length > 0) {
          const channelArg = parent.arguments[0];
          return sourceFile.text.substring(channelArg.pos, channelArg.end).trim();
        }
      }
    }
    parent = parent.parent;
  }
  return null;
}

function fixFile(filePath: string): number {
  const sourceCode = fs.readFileSync(filePath, 'utf-8');
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceCode,
    ts.ScriptTarget.Latest,
    true,
  );

  const fixes: Array<{start: number, end: number, replacement: string}> = [];

  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const expr = node.expression;
      if (ts.isIdentifier(expr) &&
          (expr.text === 'createSafeValidatedHandler' || expr.text === 'createValidatedHandler')) {

        // Check if it already has 3 arguments
        if (node.arguments.length === 2) {
          // Find the channel from context
          const channel = findChannelFromContext(sourceFile, node);
          if (channel) {
            // Add the channel as the third argument
            const lastArg = node.arguments[node.arguments.length - 1];
            const insertPos = lastArg.end;
            fixes.push({
              start: insertPos,
              end: insertPos,
              replacement: `, ${channel}`,
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  if (fixes.length > 0) {
    // Apply fixes in reverse order to maintain positions
    fixes.sort((a, b) => b.start - a.start);
    let modifiedCode = sourceCode;

    for (const fix of fixes) {
      modifiedCode = modifiedCode.slice(0, fix.start) +
                     fix.replacement +
                     modifiedCode.slice(fix.end);
    }

    fs.writeFileSync(filePath, modifiedCode);
    console.log(`✅ Fixed ${fixes.length} handlers in ${path.basename(filePath)}`);
    return fixes.length;
  }

  return 0;
}

// Main execution
console.log('🔧 Fixing IPC Channel Names using TypeScript AST...\n');

const srcDir = path.join(__dirname, '../src');

// Find all relevant files
const patterns = [
  'features/**/*.ipc.ts',
  'features/**/init-unified-backend.ts',
  'main/*.ipc.ts',
];

let totalFixes = 0;
const processedFiles: string[] = [];

for (const pattern of patterns) {
  const files = glob.sync(pattern, {
    cwd: srcDir,
    absolute: true,
    ignore: ['**/node_modules/**', '**/__tests__/**', '**/*.test.ts'],
  });

  for (const file of files) {
    if (!processedFiles.includes(file)) {
      processedFiles.push(file);
      const fixes = fixFile(file);
      totalFixes += fixes;
    }
  }
}

console.log('\n📊 Summary:');
console.log(`Files processed: ${processedFiles.length}`);
console.log(`Total fixes applied: ${totalFixes}`);

if (totalFixes > 0) {
  console.log('\n🎉 Successfully fixed all IPC handlers!');
  console.log('Now run: pnpm run build:main');
} else {
  console.log('\n✨ No fixes needed - all handlers already have channel names!');
}
