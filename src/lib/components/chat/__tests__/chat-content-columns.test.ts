import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const panel = readFileSync(
  path.resolve(process.cwd(), 'src/lib/components/chat/ChatPanel.svelte'),
  'utf8',
);

describe('chat content column contracts', () => {
  it('caps the transcript without changing the scroll owner', () => {
    expect(panel).toMatch(
      /class="conversation-column[^\"]*w-full[^\"]*min-w-0[^\"]*max-w-\[70em\][^\"]*"[\s\S]*?data-testid="chat-transcript-inner"/,
    );
    expect(panel).toContain('data-testid="chat-transcript-scroll-viewport"');
    expect(panel).not.toMatch(/data-testid="chat-transcript-inner"[^>]*overflow-y-auto/);
  });

  it('keeps the prompt divider full width around a separate capped controls column', () => {
    expect(panel).toContain(
      'class="composer-prompt-layer relative z-10 w-full border-t border-border"',
    );
    expect(panel).toContain('style:padding-inline-end="{scrollbarGutterWidth}px"');
    expect(panel).toMatch(
      /class="mx-auto w-full min-w-0 max-w-\[70em\]"[\s\S]*?data-testid="chat-composer-controls-inner"/,
    );
    expect(panel).toContain('.composer-prompt-layer :global(.rich-input-container)');
  });

  it('caps the pinned prompt lane while its overlay host stays full width', () => {
    expect(panel).toContain('data-testid="pinned-prompt-overlay-host"');
    expect(panel).toMatch(
      /class="mx-auto w-full min-w-0 max-w-\[70em\][^\"]*"[\s\S]*?data-testid="pinned-prompt-overlay-lane"/,
    );
  });
});
