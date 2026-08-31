import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const reviewedSources = [
  'src/lib/styles/comments.css',
  'src/lib/styles/chat-messages.css',
  'src/lib/styles/tiptap-editor.css',
  'src/features/layout/components/panel-tabs/Tab.svelte',
  'src/lib/components/ui/CollapsiblePanel.svelte',
  'src/lib/components/workspace/sidebar/SidebarToggle.svelte',
  'src/features/log/components/ActivityTimeline.svelte',
  'src/features/file-tracking/components/diff/DiffHeader.svelte',
  'src/features/file-tracking/components/diff/TrackedChangeDiffViewer.svelte',
];

function source(file: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');
}

describe('style invalidation contract', () => {
  it('does not use catch-all transitions in reviewed production styles', () => {
    const violations = reviewedSources.flatMap((file) => {
      const matches = source(file).match(/transition(?:-all)?\s*:\s*all\b|transition-all/g) ?? [];
      return matches.map((match) => `${file}: ${match}`);
    });

    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('keeps reviewed state changes on paint or compositor properties', () => {
    expect(source('src/lib/styles/comments.css')).toContain('background-color 0.2s ease');
    expect(source('src/lib/styles/chat-messages.css')).toContain(
      '@apply transition-opacity duration-150;',
    );
    expect(source('src/lib/styles/tiptap-editor.css')).toContain(
      'transition: background-color 0.15s ease;',
    );
    expect(source('src/features/layout/components/panel-tabs/Tab.svelte')).toContain(
      'background-color 0.2s cubic-bezier',
    );
  });
});
