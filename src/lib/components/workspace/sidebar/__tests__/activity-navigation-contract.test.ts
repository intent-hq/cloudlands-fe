import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('activity navigation contract', () => {
  it('provides a semantic keyboard-focus fallback while retaining component-owned styles', () => {
    const appCss = source('src/app.css');
    const preview = source('src/lib/components/workspace/sidebar/ActivityLogPreview.svelte');

    expect(appCss).toContain(':focus:not(:focus-visible) {\n  outline: none;');
    expect(appCss).toContain(':focus-visible {\n  outline: 2px solid hsl(var(--ring));');
    expect(appCss).toContain('outline-offset: 2px;');
    expect(appCss).not.toMatch(/(^|\n):focus\s*\{[^}]*outline:\s*none;/);
    expect(preview).toContain('rounded-md outline-none');
  });

  it('passes the activity event through and targets its exact chat content', () => {
    const preview = source('src/lib/components/workspace/sidebar/ActivityLogPreview.svelte');
    const sidebar = source('src/lib/components/workspace/MultiSelectTabbedSidebar.svelte');
    const chat = source('src/lib/components/chat/ChatPanel.svelte');
    const toolCall = source('src/lib/components/chat/ToolCall.svelte');

    expect(preview).toContain('onShowAgent?.(agentId, event)');
    expect(sidebar).toContain("dispatchWindowEvent('agent:scroll-to-activity'");
    expect(chat).toContain("addEventListener('agent:scroll-to-activity'");
    expect(chat).toContain('[data-tool-call-id=');
    expect(toolCall).toContain('data-tool-call-id={toolUse.toolCallId || undefined}');
  });

  it('opens compact file activity rows as scoped file tabs', () => {
    const sidebar = source('src/lib/components/workspace/MultiSelectTabbedSidebar.svelte');

    expect(sidebar).toContain('onOpenFileEvent={handleOpenActivityFileEvent}');
    expect(sidebar).toContain('function handleOpenActivityFileEvent(event: WorkspaceEvent)');
    expect(sidebar).toContain('normalizeActivityFilePath(eventPath, $workspace)');
    expect(sidebar).toContain('handleOpenFileInPanel(filePath);');
    expect(sidebar).not.toContain('appStore.dispatch(openWorkspaceDiff(workspaceId, change');
  });

  it('initially caps the sidebar activity preview at three rows', () => {
    const sidebar = source('src/lib/components/workspace/MultiSelectTabbedSidebar.svelte');

    expect(sidebar).toContain('maxItems={3}');
  });
});
