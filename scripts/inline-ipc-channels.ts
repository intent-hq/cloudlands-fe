#!/usr/bin/env tsx

/**
 * Inline IPC Channels into Preload Script
 *
 * This script reads the IPC registry and inlines the channel data
 * directly into the preload script to avoid module resolution issues.
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

const preloadTemplatePath = path.join(__dirname, '../src/preload/index.template.ts');
const preloadOutputPath = path.join(__dirname, '../src/preload/index.ts');

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

// Remove any existing generated sections
templateContent = templateContent.replace(
  /\/\/ ={40,}\s*\n\/\/ GENERATED IPC CHANNELS[\s\S]*?\/\/ END GENERATED IPC CHANNELS\s*\n\/\/ ={40,}\s*/g,
  '',
);

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
 * Check if a channel is allowed (either static or dynamic)
 */
function isChannelAllowed(channel: string): boolean {
  return ALLOWED_CHANNELS.includes(channel) ||
         DYNAMIC_CHANNEL_PATTERNS.some(pattern => channel.startsWith(pattern));
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
