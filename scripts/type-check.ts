#!/usr/bin/env tsx
/**
 * Type Check Script
 * Validates TypeScript compilation without emitting files
 */

import { execSync } from 'child_process';

const args = process.argv.slice(2);
const quiet = args.includes('quiet') || args.includes('--quiet');

try {
  if (!quiet) console.log('🔍 Running TypeScript type check...');

  // Run tsc in noEmit mode to check types without generating files
  execSync('npx tsc --noEmit', {
    cwd: process.cwd(),
    stdio: quiet ? 'pipe' : 'inherit',
    encoding: 'utf-8',
  });

  if (!quiet) console.log('✅ Type check passed');
  process.exit(0);
} catch (error) {
  // Quiet hides progress, never the diagnostics (manual signed build run 43173439392).
  if (quiet) {
    const { stdout, stderr } = error as { stdout?: string; stderr?: string };
    process.stderr.write(`${stdout ?? ''}${stderr ?? ''}` || `${(error as Error).message}\n`);
  } else console.error('❌ Type check failed');
  process.exit(1);
}
