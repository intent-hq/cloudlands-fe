#!/usr/bin/env tsx
/**
 * Script to fix branded type issues in the codebase
 * Finds and fixes string assignments to branded types
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';

const BRANDED_TYPES = [
  'WorkspaceId',
  'AgentId',
  'NoteId',
  'MessageId',
  'SessionId',
  'StreamId',
  'ToolCallId',
  'UserId',
  'ThreadId',
];

interface Fix {
  file: string;
  line: number;
  column: number;
  type: string;
  original: string;
  fixed: string;
}

async function findAndFixBrandedTypeIssues() {
  const fixes: Fix[] = [];

  // Find all TypeScript and Svelte files
  const files = await glob('src/**/*.{ts,svelte}', {
    cwd: process.cwd(),
    absolute: false,
  });

  console.log(`Scanning ${files.length} files for branded type issues...`);

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    const lines = content.split('\n');
    let modified = false;
    const newLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      const lineNum = i + 1;

      // Check for branded type issues in various patterns
      for (const brandedType of BRANDED_TYPES) {
        // Pattern 1: Direct assignment to branded type variable
        // e.g., selectedNoteId (where selectedNoteId is a string but needs to be NoteId)
        const varPattern = new RegExp(`(\\w+Id)\\s*:\\s*${brandedType}\\s*=\\s*['"]([^'"]+)['"]`, 'g');
        const varMatches = [...line.matchAll(varPattern)];

        for (const match of varMatches) {
          const original = match[0];
          const varName = match[1];
          const value = match[2];
          const fixed = `${varName}: ${brandedType} = ${brandedType}('${value}')`;

          line = line.replace(original, fixed);
          modified = true;

          fixes.push({
            file,
            line: lineNum,
            column: match.index || 0,
            type: brandedType,
            original,
            fixed,
          });
        }

        // Pattern 2: Function calls expecting branded types
        // e.g., initialize(workspaceId, selectedNoteId) where selectedNoteId is string
        // This is harder to detect automatically without type information

        // Pattern 3: Props with wrong types
        // e.g., {noteId} where noteId is string but component expects NoteId
        // Also hard to detect without type information
      }

      newLines.push(line);
    }

    if (modified) {
      fs.writeFileSync(file, newLines.join('\n'));
      console.log(`Fixed ${file}`);
    }
  }

  // Print summary
  console.log(`\nFound and fixed ${fixes.length} branded type issues:`);
  for (const fix of fixes) {
    console.log(`  ${fix.file}:${fix.line} - ${fix.type}`);
  }

  // Now run type check to find remaining issues
  console.log('\nRunning type check to find remaining issues...');
  const { execSync } = require('child_process');

  try {
    const output = execSync('pnpm check 2>&1', { encoding: 'utf-8' });
    const errorLines = output.split('\n').filter(line => line.includes('is not assignable to'));

    console.log('\nRemaining type errors that need manual fixing:');
    for (const line of errorLines) {
      if (BRANDED_TYPES.some(type => line.includes(type))) {
        console.log(line);
      }
    }
  } catch (error: any) {
    // Type check will fail if there are errors, but we still get the output
    const output = error.stdout || error.output?.join('') || '';
    const errorLines = output.split('\n').filter((line: string) =>
      line.includes('is not assignable to') &&
      BRANDED_TYPES.some(type => line.includes(type)),
    );

    if (errorLines.length > 0) {
      console.log('\nRemaining branded type errors that need manual fixing:');
      const fileErrors = new Map<string, string[]>();

      let currentFile = '';
      for (const line of errorLines) {
        if (line.includes('.svelte:') || line.includes('.ts:')) {
          currentFile = line.split(':')[0];
        }
        if (currentFile && line.includes('is not assignable to')) {
          if (!fileErrors.has(currentFile)) {
            fileErrors.set(currentFile, []);
          }
          fileErrors.get(currentFile)!.push(line);
        }
      }

      for (const [file, errors] of fileErrors) {
        console.log(`\n${file}:`);
        for (const error of errors) {
          console.log(`  ${error}`);
        }
      }
    }
  }
}

// Run the script
findAndFixBrandedTypeIssues().catch(console.error);
