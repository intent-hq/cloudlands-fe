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

    // The global focus rules live inside `@layer base` (indented one level) so
    // Tailwind utilities can override them; see input.test.ts for the layering test.
    expect(appCss).toContain(':focus:not(:focus-visible) {\n    outline: none;');
    expect(appCss).toContain(':focus-visible {\n    outline: 2px solid hsl(var(--ring));');
    expect(appCss).toContain('outline-offset: 2px;');
    expect(appCss).not.toMatch(/(^|\n)\s*:focus\s*\{[^}]*outline:\s*none;/);
    expect(preview).toContain('rounded-md outline-none');
  });

  it('passes the activity event through and targets its exact chat content', () => {
    const preview = source('src/lib/components/workspace/sidebar/ActivityLogPreview.svelte');
    const chat = source('src/lib/components/chat/ChatPanel.svelte');
    const toolCall = source('src/lib/components/chat/ToolCall.svelte');

    expect(preview).toContain('onShowAgent?.(agentId, event)');
    expect(chat).toContain("addEventListener('agent:scroll-to-activity'");
    expect(chat).toContain('[data-tool-call-id=');
    expect(toolCall).toContain('data-tool-call-id={toolUse.toolCallId || undefined}');
  });

  it('keeps compact Activity rows out of the sidebar launcher overview', () => {
    const sidebar = source('src/lib/components/workspace/MultiSelectTabbedSidebar.svelte');

    expect(sidebar).not.toContain('ActivityLogPreview');
    expect(sidebar).not.toContain('onOpenFileEvent={handleOpenActivityFileEvent}');
    expect(sidebar).not.toContain("dispatchWindowEvent('agent:scroll-to-activity'");
  });
});
