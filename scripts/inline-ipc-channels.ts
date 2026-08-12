#!/usr/bin/env tsx

/**
 * Inline IPC Channels into Preload Script
 *
 * This script reads the IPC registry and inlines the channel data
 * directly into the preload script to avoid module resolution issues.
 *
 * It also refuses to run when `src/preload/index.ts` contains hand-written
 * lines that are not in the template: that file is regenerated on every dev
 * run and every build, so such edits are silently deleted and never reach a
 * packaged app. See `discardedLines()` below.
 *
 * Usage: tsx scripts/inline-ipc-channels.ts [projectRoot] [--force]
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  getAllowedChannels,
  DYNAMIC_CHANNEL_PATTERNS,
  EVENT_CHANNELS,
} from '../src/shared/ipc-registry';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const args = process.argv.slice(2);
// --force regenerates even when hand edits would be destroyed (escape hatch for
// deliberately obsolete output).
const force = args.includes('--force');
// An explicit project root keeps the drift guard testable against fixtures.
const projectRoot = args.find((arg) => !arg.startsWith('-')) ?? path.join(__dirname, '..');

const preloadTemplatePath = path.join(projectRoot, 'src/preload/index.template.ts');
const preloadOutputPath = path.join(projectRoot, 'src/preload/index.ts');

// Matches the block this script writes into the output (and any stale copy left
// in the template). It is rewritten on every run, so it never participates in
// drift detection.
const generatedSectionPattern =
  /\/\/ ={40,}\s*\n\/\/ GENERATED IPC CHANNELS[\s\S]*?\/\/ END GENERATED IPC CHANNELS\s*\n\/\/ ={40,}\s*/g;

/**
 * Lines that carry meaning for drift detection: the generated block is dropped
 * (it is regenerated every run) and blank lines are ignored (inserting the
 * block shifts blank lines around it).
 */
function meaningfulLines(source: string): string[] {
  return source
    .replace(generatedSectionPattern, '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line !== '');
}

/**
 * Lines present in the generated output but absent from the template — exactly
 * the hand edits this script is about to overwrite.
 *
 * Deliberately one-directional: template-only lines mean the output is merely
 * stale, and regenerating is the correct outcome. Only output-only lines
 * represent work that is about to be destroyed.
 */
function discardedLines(generated: string, template: string): string[] {
  const available = new Map<string, number>();
  for (const line of meaningfulLines(template)) {
    available.set(line, (available.get(line) ?? 0) + 1);
  }

  const discarded: string[] = [];
  for (const line of meaningfulLines(generated)) {
    const remaining = available.get(line) ?? 0;
    if (remaining > 0) {
      available.set(line, remaining - 1);
    } else {
      discarded.push(line);
    }
  }
  return discarded;
}

// Read the template file
let templateContent: string;
try {
  templateContent = fs.readFileSync(preloadTemplatePath, 'utf-8');
} catch (error) {
  // If template doesn't exist, use the current index.ts as template
  templateContent = fs.readFileSync(preloadOutputPath, 'utf-8');

  // Remove the import statement for generated-channels
  templateContent = templateContent.replace(
    /import\s+{[^}]+}\s+from\s+["']\.\/generated-channels["'];?\s*/g,
    '',
  );

  // Save as template for future use
  fs.writeFileSync(preloadTemplatePath, templateContent, 'utf-8');
}

// Refuse to silently destroy hand edits made to the generated file.
if (fs.existsSync(preloadOutputPath)) {
  const discarded = discardedLines(fs.readFileSync(preloadOutputPath, 'utf-8'), templateContent);

  if (discarded.length > 0) {
    const relOutput = path.relative(projectRoot, preloadOutputPath);
    const relTemplate = path.relative(projectRoot, preloadTemplatePath);
    const preview = discarded.slice(0, 20);

    if (!force) {
      console.error(
        `\n❌ ${relOutput} has ${discarded.length} line(s) that are not in ${relTemplate}.\n`,
      );
      console.error(
        `${relOutput} is GENERATED from ${relTemplate} on every 'npm run dev' and every`,
      );
      console.error("'npm run build', so these lines would be deleted now and would never reach a");
      console.error('packaged app:\n');
      for (const line of preview) console.error(`    ${line}`);
      if (discarded.length > preview.length) {
        console.error(`    … and ${discarded.length - preview.length} more`);
      }
      console.error(`\nMove the change into ${relTemplate}, then re-run this script.`);
      console.error('If the lines really are obsolete, re-run with --force to discard them.\n');
      process.exit(1);
    }

    console.warn(
      `⚠️  --force: discarding ${discarded.length} hand-written line(s) from ${relOutput}`,
    );
  }
}

// Remove any existing generated sections
templateContent = templateContent.replace(generatedSectionPattern, '');

// Generate the inline channel data
const inlineChannels = `
// ============================================
// GENERATED IPC CHANNELS - DO NOT EDIT MANUALLY
// Run 'npm run generate:ipc-channels' to regenerate
// ============================================

// All static IPC channels that are allowed
const ALLOWED_CHANNELS = ${JSON.stringify(getAllowedChannels(), null, 2)};

// Dynamic channel patterns that are matched with startsWith()
const DYNAMIC_CHANNEL_PATTERNS = ${JSON.stringify(DYNAMIC_CHANNEL_PATTERNS, null, 2)};

// Event channels for IPC renderer on() listeners
const EVENT_CHANNELS = ${JSON.stringify(EVENT_CHANNELS, null, 2)};

/**
 * Check if a channel is allowed (either static, dynamic, or event)
 */
function isChannelAllowed(channel: string): boolean {
  return ALLOWED_CHANNELS.includes(channel) ||
         DYNAMIC_CHANNEL_PATTERNS.some(pattern => channel.startsWith(pattern)) ||
         EVENT_CHANNELS.includes(channel);
}

// ============================================
// END GENERATED IPC CHANNELS
// ============================================
`;

// Insert the inline channels at the GENERATED_CHANNELS_PLACEHOLDER marker, or after imports if not found
const placeholderMarker = '// GENERATED_CHANNELS_PLACEHOLDER';
const placeholderIndex = templateContent.indexOf(placeholderMarker);

if (placeholderIndex !== -1) {
  // Replace the placeholder with the generated channels
  const beforePlaceholder = templateContent.slice(0, placeholderIndex);
  const afterPlaceholder = templateContent.slice(placeholderIndex + placeholderMarker.length);
  templateContent = `${beforePlaceholder}${inlineChannels}${afterPlaceholder}`;
} else {
  // Fallback: insert after imports
  const importEndMatch = templateContent.match(/(import[^;]+;[\s\n]*)+/);
  if (importEndMatch) {
    const importEnd = importEndMatch.index! + importEndMatch[0].length;
    const beforeImports = templateContent.slice(0, importEnd);
    const afterImports = templateContent.slice(importEnd);
    templateContent = `${beforeImports}\n${inlineChannels}\n${afterImports}`;
  } else {
    templateContent = `${inlineChannels}\n${templateContent}`;
  }
}

// Write the output file
fs.writeFileSync(preloadOutputPath, templateContent, 'utf-8');

console.log(`✅ Inlined IPC channels into: ${preloadOutputPath}`);
console.log(`📊 Total static channels: ${getAllowedChannels().length}`);
console.log(`🔄 Dynamic patterns: ${DYNAMIC_CHANNEL_PATTERNS.length}`);
