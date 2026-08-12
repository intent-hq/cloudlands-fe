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
 * Longest common subsequence of two line arrays, as the indices of `a` that it
 * keeps. Common prefix and suffix are trimmed first, which reduces the usual
 * case (one edited region) to a handful of lines before the quadratic part.
 */
function commonSubsequenceIndices(a: string[], b: string[]): Set<number> {
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;

  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail++;
  }

  const kept = new Set<number>();
  for (let i = 0; i < head; i++) kept.add(i);
  for (let i = 0; i < tail; i++) kept.add(a.length - 1 - i);

  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);

  // lengths[i][j] = LCS length of midA[i..] and midB[j..]
  const lengths: number[][] = Array.from({ length: midA.length + 1 }, () =>
    new Array<number>(midB.length + 1).fill(0),
  );
  for (let i = midA.length - 1; i >= 0; i--) {
    for (let j = midB.length - 1; j >= 0; j--) {
      lengths[i][j] =
        midA[i] === midB[j]
          ? lengths[i + 1][j + 1] + 1
          : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }

  let i = 0;
  let j = 0;
  while (i < midA.length && j < midB.length) {
    if (midA[i] === midB[j]) {
      kept.add(head + i);
      i++;
      j++;
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }

  return kept;
}

interface DiscardedLine {
  line: string;
  /**
   * The line exists in the template, just not at this position — so the content
   * is not lost, but the output and the template still disagree about order.
   * Either the output was reordered by hand or the template was, and nothing in
   * the two files can tell those apart. Both need a human, so both stop the run.
   */
  reordered: boolean;
}

/**
 * Lines of the generated output that a regeneration would not reproduce —
 * the hand edits this script is about to overwrite.
 *
 * Ordered on purpose. A multiset comparison treats a moved line as present and
 * lets it be overwritten in silence, which is the very failure this guard
 * exists to stop: it would license trust it has not earned.
 *
 * Still one-directional: template-only lines mean the output is merely stale,
 * and regenerating is the correct outcome. Only lines the regeneration would
 * drop are reported.
 */
function discardedLines(generated: string, template: string): DiscardedLine[] {
  const generatedLines = meaningfulLines(generated);
  const templateLines = meaningfulLines(template);
  const kept = commonSubsequenceIndices(generatedLines, templateLines);

  const templateCounts = new Map<string, number>();
  for (const line of templateLines) {
    templateCounts.set(line, (templateCounts.get(line) ?? 0) + 1);
  }

  const discarded: DiscardedLine[] = [];
  for (const [index, line] of generatedLines.entries()) {
    if (kept.has(index)) continue;
    discarded.push({ line, reordered: (templateCounts.get(line) ?? 0) > 0 });
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

    const allReordered = discarded.every((entry) => entry.reordered);

    if (!force) {
      console.error(
        `\n❌ ${relOutput} has ${discarded.length} line(s) that regenerating would not reproduce.\n`,
      );
      console.error(
        `${relOutput} is GENERATED from ${relTemplate} on every 'npm run dev' and every`,
      );
      console.error("'npm run build', so these lines would be deleted now and would never reach a");
      console.error('packaged app:\n');
      for (const entry of preview) {
        console.error(`    ${entry.line}${entry.reordered ? '   [moved]' : ''}`);
      }
      if (discarded.length > preview.length) {
        console.error(`    … and ${discarded.length - preview.length} more`);
      }
      if (allReordered) {
        console.error(
          `\nEvery line above also exists in ${relTemplate}, at a different position, so`,
        );
        console.error('nothing is missing from the template — the two files disagree about order.');
        console.error(`Reorder ${relTemplate} to match, or re-run with --force to take the`);
        console.error("template's order.\n");
      } else {
        console.error(`\nMove the change into ${relTemplate}, then re-run this script.`);
        console.error('If the lines really are obsolete, re-run with --force to discard them.\n');
      }
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
