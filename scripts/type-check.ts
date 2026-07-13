#!/usr/bin/env tsx
/**
 * Type Check Script
 * Validates TypeScript compilation without emitting files
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const args = process.argv.slice(2);
const mode = args[0] || 'check';
const quiet = args.includes('quiet') || args.includes('--quiet');

try {
  if (!quiet) console.log('🔍 Running TypeScript type check...');

  // Run tsc in noEmit mode to check types without generating files
  const result = execSync('npx tsc --noEmit', {
    cwd: process.cwd(),
    stdio: quiet ? 'pipe' : 'inherit',
    encoding: 'utf-8',
  });

  if (!quiet) console.log('✅ Type check passed');
  process.exit(0);
} catch (error) {
  if (!quiet) console.error('❌ Type check failed');
  process.exit(1);
}
