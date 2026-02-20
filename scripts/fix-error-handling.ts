#!/usr/bin/env tsx
/**
 * Script to fix error handling in IPC files
 * Adds type assertion for error parameters in logger.error calls
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';

async function fixErrorHandling() {
  const files = await glob('src/**/*.ipc.ts', {
    cwd: process.cwd(),
    absolute: true,
  });

  let totalFixed = 0;

  for (const file of files) {
    let content = fs.readFileSync(file, 'utf-8');
    const originalContent = content;

    // Fix logger.error calls with untyped error parameter
    // Match patterns like: logger.error('message', error);
    // Replace with: logger.error('message', error as Error);
    content = content.replace(
      /logger\.error\(([^,]+),\s*error\)/g,
      'logger.error($1, error as Error)',
    );

    // Also fix patterns with additional parameters
    // Match patterns like: logger.error('message', { key: value }, error);
    content = content.replace(
      /logger\.error\(([^,]+,[^,]+),\s*error\)/g,
      'logger.error($1, error as Error)',
    );

    if (content !== originalContent) {
      fs.writeFileSync(file, content, 'utf-8');
      console.log(`✅ Fixed error handling in: ${path.relative(process.cwd(), file)}`);
      totalFixed++;
    }
  }

  console.log(`\n📊 Total files fixed: ${totalFixed}`);
}

fixErrorHandling().catch(console.error);
