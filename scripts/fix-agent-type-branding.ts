#!/usr/bin/env tsx
/**
 * Script to fix all agentType usages to use branded AgentTypeId
 *
 * This script:
 * 1. Finds all files that pass agentType to agent creation methods
 * 2. Adds import for createAgentTypeId if needed
 * 3. Wraps agentType strings with createAgentTypeId()
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const SRC_DIR = path.join(__dirname, '../src');

// Files to update (from grep results)
const FILES_TO_UPDATE = [
  'features/agent/agent-ui-helpers.ts',
  'features/agent/services/chat.service.ts',
  'lib/components/chat/RegularAgentWelcome.svelte',
  'lib/components/workspace/AgentLaunchMenu.svelte',
  'lib/components/workspace/NoteWithComments.svelte',
  'lib/components/tiptap/BubbleMenu.svelte',
  'lib/components/ui/contextual-menu/ContextualMenu.svelte',
  'routes/workspace/[id]/+page.svelte',
  'features/workspace/first-visit-manager.svelte.ts',
  'features/workspace/main/workspace.service.ts',
];

function addImportIfNeeded(content: string): string {
  // Check if createAgentTypeId is already imported
  if (content.includes('createAgentTypeId')) {
    return content;
  }

  // Find the last import statement
  const lines = content.split('\n');
  let lastImportIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith('import ')) {
      lastImportIndex = i;
    }
  }

  if (lastImportIndex === -1) {
    // No imports found, add at the top after any comments
    let insertIndex = 0;
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].trim().startsWith('//') && !lines[i].trim().startsWith('/*') && !lines[i].trim().startsWith('*') && lines[i].trim() !== '') {
        insertIndex = i;
        break;
      }
    }
    lines.splice(insertIndex, 0, "import { createAgentTypeId } from '$shared/types/agent.types';");
  } else {
    // Add after the last import
    lines.splice(lastImportIndex + 1, 0, "import { createAgentTypeId } from '$shared/types/agent.types';");
  }

  return lines.join('\n');
}

function wrapAgentTypeWithBranding(content: string): string {
  // Pattern 1: agentType: 'string-literal'
  content = content.replace(
    /agentType:\s*['"]([^'"]+)['"]/g,
    (match, typeId) => `agentType: createAgentTypeId('${typeId}')`,
  );

  // Pattern 2: agentType: variableName (where variableName is a string)
  // This is trickier - we need to look for patterns like:
  // const agentType = 'something';
  // agentType: agentType

  return content;
}

function processFile(filePath: string): void {
  const fullPath = path.join(SRC_DIR, filePath);

  if (!fs.existsSync(fullPath)) {
    console.log(`⚠️  File not found: ${filePath}`);
    return;
  }

  console.log(`Processing: ${filePath}`);

  let content = fs.readFileSync(fullPath, 'utf-8');
  const originalContent = content;

  // Add import if needed
  content = addImportIfNeeded(content);

  // Wrap agentType values
  content = wrapAgentTypeWithBranding(content);

  if (content !== originalContent) {
    fs.writeFileSync(fullPath, content, 'utf-8');
    console.log(`✅ Updated: ${filePath}`);
  } else {
    console.log(`⏭️  No changes needed: ${filePath}`);
  }
}

// Main execution
console.log('🔧 Fixing agentType branding across codebase...\n');

for (const file of FILES_TO_UPDATE) {
  try {
    processFile(file);
  } catch (error) {
    console.error(`❌ Error processing ${file}:`, error);
  }
}

console.log('\n✨ Done!');
