import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const rotatedDisclosureFiles = [
  'src/lib/components/chat/AgentSubscriptions.svelte',
  'src/lib/components/chat/ChatOperationalRow.svelte',
  'src/lib/components/chat/QueuedMessageList.svelte',
  'src/lib/components/code-review/ReviewCommentCard.svelte',
  'src/lib/components/file-explorer/VirtualizedFileTree.svelte',
  'src/lib/components/notes/primitives/DiagramBlock.svelte',
  'src/lib/components/settings/mcp/McpServerCard.svelte',
  'src/lib/components/ui/CollapsiblePanel.svelte',
  'src/lib/components/workspace/WorkspaceAgentsList.svelte',
  'src/lib/components/workspace/initializer/BranchSelector.svelte',
  'src/lib/components/workspace/sidebar/CommitsTimeline.svelte',
  'src/lib/components/workspace/sidebar/McpServersSection.svelte',
  'src/lib/components/workspace/sidebar/PRSection.svelte',
  'src/lib/components/workspace/sidebar/SecondaryRootChangesView.svelte',
  'src/lib/components/workspace/sidebar/SkillsSection.svelte',
] as const;

const swappedDisclosureFiles = [
  'src/features/file-tracking/components/diff/DiffHeader.svelte',
  'src/features/workspace/components/WorkspaceActionsMenu.svelte',
  'src/lib/components/ErrorDisplay.svelte',
  'src/lib/components/chat/ChatChangesPanel.svelte',
  'src/lib/components/chat/InlinePermissionRequest.svelte',
  'src/lib/components/chat/LongRunningDebugInfo.svelte',
  'src/lib/components/code-review/walkthrough/CodeWalkthroughSection.svelte',
  'src/lib/components/code-review/walkthrough/WalkthroughCommentThread.svelte',
  'src/lib/components/code-review/walkthrough/WalkthroughFileDiff.svelte',
  'src/lib/components/code-walkthrough/WalkthroughDiffViewer.svelte',
  'src/lib/components/code-walkthrough/WalkthroughSection.svelte',
  'src/lib/components/debug/DebugPanel.svelte',
  'src/lib/components/file-explorer/file-explorer-sidebar.svelte',
  'src/lib/components/file-tracking/TreeNode.svelte',
  'src/lib/components/terminal/QuakeTerminalOverlay.svelte',
  'src/lib/components/workspace/NoteCodeChangesCard.svelte',
  'src/lib/components/workspace/sidebar/ActivityLogPreview.svelte',
] as const;

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('disclosure chevron inventory', () => {
  it('keeps every audited source on the rendered left-closed and down-open contract', () => {
    expect(rotatedDisclosureFiles).toHaveLength(15);
    expect(swappedDisclosureFiles).toHaveLength(18);

    for (const path of rotatedDisclosureFiles) {
      const contents = source(path);
      expect(contents, path).toContain('rotate-90');
      expect(contents, path).not.toMatch(/faChevronDown[\s\S]{0,300}-rotate-90/);
      expect(contents, path).not.toMatch(/faChevronDown[\s\S]{0,300}rotate-180/);
    }

    for (const path of swappedDisclosureFiles) {
      const contents = source(path);
      expect(contents, path).toContain('faChevronLeft');
      expect(contents, path).toContain('faChevronDown');
      expect(contents, path).not.toMatch(/\?\s*faChevronUp\s*:\s*faChevronDown/);
      expect(contents, path).not.toMatch(/\?\s*faChevronDown\s*:\s*faChevronRight/);
    }
  });
});
