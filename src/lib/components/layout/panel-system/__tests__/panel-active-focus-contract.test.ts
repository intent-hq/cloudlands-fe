import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('panel focus ownership', () => {
  it('only exposes stored panel focus from the active visible workspace', () => {
    const layout = readFileSync(resolve(__dirname, '../PanelLayout.svelte'), 'utf8');

    expect(layout).toContain('focusedPanelId={active ? $focusedPanelId$ : null}');
    expect(layout).not.toContain('focusedPanelId={$focusedPanelId$}');
  });

  it('focuses a revealed note at the top instead of scrolling to the bottom', () => {
    const note = readFileSync(
      resolve(__dirname, '../../../workspace/NoteWithComments.svelte'),
      'utf8',
    );
    const panelFocusHandler = note.slice(
      note.indexOf('const handlePanelFocusContent'),
      note.indexOf("window.addEventListener('panel:focus-content'"),
    );

    expect(panelFocusHandler).toContain("editor.commands.focus('start')");
    expect(panelFocusHandler).not.toContain("editor.commands.focus('end')");
  });
});
