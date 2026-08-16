import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const TAB_TYPES_ROOT = path.resolve(import.meta.dirname, '..');
const SRC_ROOT = path.resolve(TAB_TYPES_ROOT, '../../..');

function source(relativePath: string) {
  return fs.readFileSync(path.join(SRC_ROOT, relativePath), 'utf8');
}

describe('note content background contract', () => {
  it('routes every note tab state through one background owner', () => {
    const noteTab = source('features/layout/tab-types/NoteTabType.svelte');

    expect(noteTab.match(/<NoteContentSurface\b/g)).toHaveLength(1);
    expect(noteTab.match(/<\/NoteContentSurface>/g)).toHaveLength(1);
    expect(noteTab).not.toContain('bg-card');
    expect(noteTab).not.toContain('bg-sidebar');
    expect(noteTab).not.toContain('bg-background');
    for (const state of ['loading', 'empty', 'missing', 'read-only', 'editor']) {
      expect(noteTab).toContain(`'${state}'`);
    }
  });

  it('keeps the owner full-size and leaves adjacent panel and widget surfaces alone', () => {
    const owner = source('features/layout/tab-types/NoteContentSurface.svelte');
    const emptyPanel = source('lib/components/layout/panel-system/PanelEmptyState.svelte');
    const notesSidebar = source('lib/components/notes/NotesPanel.svelte');
    const reference = source('lib/components/notes/primitives/ReferenceBlock.svelte');
    const cli = source('lib/components/notes/primitives/CliBlock.svelte');
    const action = source('lib/components/notes/primitives/AgentActionBlock.svelte');

    expect(owner.match(/bg-background/g)).toHaveLength(1);
    expect(owner).toContain('h-full min-h-0 w-full min-w-0 bg-background');
    expect(emptyPanel).toContain('bg-sidebar');
    expect(notesSidebar).not.toContain('data-note-content-surface');
    for (const widget of [reference, cli, action]) expect(widget).toContain('bg-card');
  });
});
