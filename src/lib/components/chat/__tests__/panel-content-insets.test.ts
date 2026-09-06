import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function source(relativePath: string) {
  return readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}

describe('panel content insets', () => {
  it('aligns the panel header, transcript, and docked composer content', () => {
    const header = source('src/lib/components/layout/panel-system/PanelTabBar.svelte');
    const panel = source('src/lib/components/chat/ChatPanel.svelte');
    const input = source('src/lib/components/chat/input/SimpleRichInput.svelte');

    expect(header).toContain('bg-card pr-2.5');
    expect(header).toContain(
      '(var(--panel-header-height) - var(--agent-avatar-emphasized-surface-size)) / 2',
    );
    expect(panel).not.toContain('max-w-[var(--content-measure-');
    expect(panel).toContain(": 'px-4 pt-8 sm:px-6'");
    expect(panel).toContain('chatTranscriptBottomInsetClass({');
    expect(panel).toContain('{transcriptBottomInsetClass}');
    expect(panel).not.toContain('eventSubscriptionsOwnEndGap');
    expect(panel).toContain("? 'w-full px-3!'");
    expect(panel).toContain("? 'w-full px-3'");
    expect(panel).toContain('--composer-lane-inset-x: 1rem');
    expect(panel).toContain('--composer-lane-inset-bottom: 1rem');
    expect(panel).toContain('--composer-lane-inset-x: 1.5rem');
    expect(panel).toContain('--composer-lane-inset-bottom: 1.5rem');
    expect(panel).toContain('--composer-lane-inset-x: 0;');
    expect(panel).toContain('--composer-lane-inset-bottom: 0.25rem');
    expect(panel).toContain('--composer-lane-inset-bottom: 0.5rem');
    expect(panel).toContain(
      'padding: 0.5rem var(--composer-lane-inset-x) var(--composer-lane-inset-bottom)',
    );
    expect(input).toContain("contentInsetClassName ?? (edgeDocked ? 'px-4 sm:px-6' : 'px-2')");
    expect(input.match(/\{contentInsetClasses\}/g)?.length).toBe(3);
  });
});
