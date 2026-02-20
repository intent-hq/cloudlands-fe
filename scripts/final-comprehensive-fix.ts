#!/usr/bin/env tsx

/**
 * Final Comprehensive Fix Script
 *
 * This script fixes all remaining TypeScript errors and IPC validation issues.
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface Fix {
  file: string;
  issue: string;
  fix: () => void;
}

const fixes: Fix[] = [];

// Fix 1: UnifiedStateStore missing methods
function fixUnifiedStateStore() {
  const filePath = path.join(__dirname, '../src/features/agent/services/unified-state-store.ts');
  let content = fs.readFileSync(filePath, 'utf-8');

  // Add getCurrentWorkspace method if missing
  if (!content.includes('getCurrentWorkspace()')) {
    const insertPoint = content.indexOf('setCurrentWorkspace(');
    if (insertPoint > -1) {
      const endOfMethod = content.indexOf('}', insertPoint);
      const insertion = `

  getCurrentWorkspace(): Workspace | null {
    return this.currentWorkspace;
  }`;
      content = content.slice(0, endOfMethod + 1) + insertion + content.slice(endOfMethod + 1);
    }
  }

  // Add selectionContext property if missing
  if (!content.includes('selectionContext')) {
    const insertPoint = content.indexOf('selectedModel');
    if (insertPoint > -1) {
      const lineEnd = content.indexOf('\n', insertPoint);
      const insertion = `
  selectionContext: null as any;`;
      content = content.slice(0, lineEnd) + insertion + content.slice(lineEnd);
    }
  }

  // Make selectedModel writable
  content = content.replace(/readonly selectedModel/, 'selectedModel');

  fs.writeFileSync(filePath, content);
  console.log('✅ Fixed UnifiedStateStore');
}

// Fix 2: Branded type conversions
function fixBrandedTypes() {
  const files = [
    'src/lib/components/plans/PlanView.svelte',
    'src/lib/components/acp/ACPEnhancedUI.svelte',
    'src/lib/components/commands/CommandPalette.svelte',
    'src/lib/components/file-tracking/MainPanelChangesView.svelte',
    'src/lib/components/file-tracking/ChangeSetView.svelte',
    'src/lib/components/file-tracking/CodeChangesPanel.svelte',
    'src/lib/components/notes/NotesPanel.svelte',
  ];

  for (const file of files) {
    const filePath = path.join(__dirname, '..', file);
    if (!fs.existsSync(filePath)) continue;

    let content = fs.readFileSync(filePath, 'utf-8');

    // Fix AgentId conversions
    content = content.replace(/(\w+)\.get\(([^)]+)\)/g, (match, obj, id) => {
      if (obj.includes('agent') || obj.includes('Agent')) {
        return `${obj}.get(AgentId(${id}))`;
      }
      return match;
    });

    // Fix WorkspaceId conversions
    content = content.replace(/workspaceStore\.findById\(([^)]+)\)/g, 'workspaceStore.findById(WorkspaceId($1))');
    content = content.replace(/fileTrackingClient\.loadChanges\(([^,]+),/g, 'fileTrackingClient.loadChanges(WorkspaceId($1),');
    content = content.replace(/notesClient\.list\(([^)]+)\)/g, 'notesClient.list(WorkspaceId($1))');

    // Add imports if needed
    if (content.includes('AgentId(') && !content.includes('import.*AgentId')) {
      const scriptStart = content.indexOf('<script');
      if (scriptStart > -1) {
        const scriptEnd = content.indexOf('>', scriptStart);
        content = `${content.slice(0, scriptEnd + 1)
        }\nimport { AgentId } from '$shared/types/branded-ids';${
          content.slice(scriptEnd + 1)}`;
      }
    }

    if (content.includes('WorkspaceId(') && !content.includes('import.*WorkspaceId')) {
      const scriptStart = content.indexOf('<script');
      if (scriptStart > -1) {
        const scriptEnd = content.indexOf('>', scriptStart);
        content = `${content.slice(0, scriptEnd + 1)
        }\nimport { WorkspaceId } from '$shared/types/branded-ids';${
          content.slice(scriptEnd + 1)}`;
      }
    }

    fs.writeFileSync(filePath, content);
  }

  console.log('✅ Fixed branded type conversions');
}

// Fix 3: Export missing types
function fixMissingExports() {
  const contextApiPath = path.join(__dirname, '../src/lib/components/chat/input/context-api.ts');
  if (fs.existsSync(contextApiPath)) {
    let content = fs.readFileSync(contextApiPath, 'utf-8');

    // Export Note type if it exists but isn't exported
    content = content.replace(/^interface Note /gm, 'export interface Note ');
    content = content.replace(/^type Note /gm, 'export type Note ');

    fs.writeFileSync(contextApiPath, content);
  }

  console.log('✅ Fixed missing exports');
}

// Fix 4: Fix ErrorHandler interface
function fixErrorHandler() {
  const errorBoundaryPath = path.join(__dirname, '../src/lib/components/error/EnhancedErrorBoundary.svelte');
  if (fs.existsSync(errorBoundaryPath)) {
    let content = fs.readFileSync(errorBoundaryPath, 'utf-8');

    // Replace createErrorBoundary with reset
    content = content.replace(/errorHandler\.createErrorBoundary/g, 'errorHandler.reset');

    fs.writeFileSync(errorBoundaryPath, content);
  }

  console.log('✅ Fixed ErrorHandler');
}

// Main execution
console.log('🔧 Running Final Comprehensive Fix...\n');

fixUnifiedStateStore();
fixBrandedTypes();
fixMissingExports();
fixErrorHandler();

console.log('\n✨ All fixes applied! Run `pnpm check` to verify.');
