// @verify-changed-triggers: ../../MultiSelectTabbedSidebar.svelte,
//   ../../../chat/ChatPanel.svelte, ../../../chat/ToolCall.svelte, src/app.css

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('activity navigation contract', () => {
  it('provides a semantic keyboard-focus fallback', () => {
    const appCss = source('src/app.css');

    // The global focus rules live inside `@layer base` (indented one level) so
    // Tailwind utilities can override them; see input.test.ts for the layering test.
    expect(appCss).toContain(':focus:not(:focus-visible) {\n    outline: none;');
    expect(appCss).toContain(':focus-visible {\n    outline: 1px solid hsl(var(--focus-ring));');
    expect(appCss).toContain('outline-offset: 2px;');
    expect(appCss).not.toMatch(/(^|\n)\s*:focus\s*\{[^}]*outline:\s*none;/);
  });

  it('targets the exact chat content of an activity event', () => {
    const chat = source('src/lib/components/chat/ChatPanel.svelte');
    const toolCall = source('src/lib/components/chat/ToolCall.svelte');

    expect(chat).toContain("addEventListener('agent:scroll-to-activity'");
    expect(chat).toContain('[data-tool-call-id=');
    expect(toolCall).toContain('toolCallId={toolUse.toolCallId || undefined}');
  });

  it('keeps compact Activity rows out of the sidebar launcher overview', () => {
    const sidebar = source('src/lib/components/workspace/MultiSelectTabbedSidebar.svelte');

    expect(sidebar).not.toContain('ActivityLogPreview');
    expect(sidebar).not.toContain('onOpenFileEvent={handleOpenActivityFileEvent}');
    expect(sidebar).not.toContain("dispatchWindowEvent('agent:scroll-to-activity'");
  });
});
